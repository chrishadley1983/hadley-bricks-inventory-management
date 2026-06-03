/**
 * Unified Markdown — 30-day Suggestion Sweep (recommend, both platforms)
 *
 * Runs daily but only evaluates inventory items DUE that day
 * (next_markdown_eval_at <= today, or null). Writes PENDING proposals using the
 * single pricing engine, rolls each evaluated item's next eval date forward by
 * suggest_interval_days, and emails a digest of suggested changes + auction recs.
 *
 * Nothing is auto-applied here — approvals push live via the proposals routes.
 * The 90-day eBay relist (auto) is a separate cron.
 *
 * See docs/features/unified-markdown/design.md §8a.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { discordService } from '@/lib/notifications/discord.service';
import { jobExecutionService, noopHandle } from '@/lib/services/job-execution.service';
import type { ExecutionHandle } from '@/lib/services/job-execution.service';
import { computeTarget } from '@/lib/pricing/engine';
import { calculateAgingDays } from '@/lib/markdown/diagnosis.service';
import { scheduleAuctions } from '@/lib/markdown/auction-scheduler.service';
import { EbayListingRefreshService } from '@/lib/ebay/ebay-listing-refresh.service';
import { EbayAuthService } from '@/lib/ebay/ebay-auth.service';
import { emailService } from '@/lib/email/email.service';
import type {
  MarkdownDigestSuggestion,
  MarkdownDigestAuction,
} from '@/lib/email/email.service';
import type {
  MarkdownConfig,
  InventoryItemForMarkdown,
  PricingData,
  MarkdownProposal,
} from '@/lib/markdown/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

const DEFAULT_USER_ID = '4b6e94b4-661c-4462-9d14-b21df7d51e5b';
const PAGE_SIZE = 500;

const CONFIG_COLUMNS =
  'mode, amazon_step1_days, amazon_step2_days, amazon_step3_days, amazon_step4_days, amazon_step2_undercut_pct, amazon_step3_undercut_pct, ebay_step1_days, ebay_step2_days, ebay_step3_days, ebay_step4_days, ebay_step1_reduction_pct, ebay_step2_reduction_pct, amazon_fee_rate, ebay_fee_rate, overpriced_threshold_pct, low_demand_sales_rank, auction_default_duration_days, auction_max_per_day, auction_enabled, suggest_interval_days, relist_age_days, min_change_pct, report_email';

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let execution: ExecutionHandle = noopHandle;

  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    execution = await jobExecutionService.start('markdown-evaluation', 'cron');
    const supabase = createServiceRoleClient();
    const today = todayISO();

    // 1. Load config
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase deep type inference workaround
    const { data: configRow, error: configError } = await (supabase as any)
      .from('markdown_config')
      .select(CONFIG_COLUMNS)
      .eq('user_id', DEFAULT_USER_ID)
      .single();

    if (configError || !configRow) {
      await execution.complete({ skipped: 'No config found' }, 200);
      return NextResponse.json({ success: true, skipped: 'No markdown config' });
    }

    const config: MarkdownConfig = {
      mode: configRow.mode,
      amazon_step1_days: configRow.amazon_step1_days,
      amazon_step2_days: configRow.amazon_step2_days,
      amazon_step3_days: configRow.amazon_step3_days,
      amazon_step4_days: configRow.amazon_step4_days,
      amazon_step2_undercut_pct: Number(configRow.amazon_step2_undercut_pct),
      amazon_step3_undercut_pct: Number(configRow.amazon_step3_undercut_pct),
      ebay_step1_days: configRow.ebay_step1_days,
      ebay_step2_days: configRow.ebay_step2_days,
      ebay_step3_days: configRow.ebay_step3_days,
      ebay_step4_days: configRow.ebay_step4_days,
      ebay_step1_reduction_pct: Number(configRow.ebay_step1_reduction_pct),
      ebay_step2_reduction_pct: Number(configRow.ebay_step2_reduction_pct),
      amazon_fee_rate: Number(configRow.amazon_fee_rate),
      ebay_fee_rate: Number(configRow.ebay_fee_rate),
      overpriced_threshold_pct: Number(configRow.overpriced_threshold_pct),
      low_demand_sales_rank: configRow.low_demand_sales_rank,
      auction_default_duration_days: configRow.auction_default_duration_days,
      auction_max_per_day: configRow.auction_max_per_day,
      auction_enabled: configRow.auction_enabled,
      suggest_interval_days: configRow.suggest_interval_days,
      relist_age_days: configRow.relist_age_days,
      min_change_pct: Number(configRow.min_change_pct),
      report_email: configRow.report_email,
    };

    // 2. Existing pending proposals (avoid duplicates)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingProposals } = await (supabase as any)
      .from('markdown_proposals')
      .select('inventory_item_id')
      .eq('user_id', DEFAULT_USER_ID)
      .eq('status', 'PENDING');
    const existingItemIds = new Set(
      (existingProposals || []).map((p: { inventory_item_id: string }) => p.inventory_item_id)
    );

    // 3. Fetch LISTED items DUE for evaluation (next_markdown_eval_at <= today or null)
    const dueItems: InventoryItemForMarkdown[] = [];
    let page = 0;
    let hasMore = true;
    while (hasMore) {
      const from = page * PAGE_SIZE;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: items, error: itemsError } = await (supabase as any)
        .from('inventory_items')
        .select(
          'id, user_id, set_number, item_name, condition, status, cost, listing_value, listing_platform, listing_date, purchase_date, created_at, markdown_hold, amazon_asin, ebay_listing_id, next_markdown_eval_at'
        )
        .eq('user_id', DEFAULT_USER_ID)
        .eq('status', 'LISTED')
        .or(`next_markdown_eval_at.is.null,next_markdown_eval_at.lte.${today}`)
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (itemsError) throw new Error(`Failed to fetch items: ${itemsError.message}`);
      for (const item of items || []) {
        dueItems.push({ ...item, sales_rank: null } as InventoryItemForMarkdown);
      }
      hasMore = (items?.length ?? 0) === PAGE_SIZE;
      page++;
    }

    // 4. Amazon pricing (Keepa) for due Amazon items
    const amazonAsins = dueItems
      .filter((i) => i.amazon_asin && i.listing_platform?.toLowerCase() === 'amazon')
      .map((i) => i.amazon_asin!);
    const pricingMap = new Map<string, PricingData>();
    if (amazonAsins.length > 0) {
      for (let i = 0; i < amazonAsins.length; i += 100) {
        const batch = amazonAsins.slice(i, i + 100);
        const { data: pricingData } = await supabase
          .from('amazon_arbitrage_pricing')
          .select('asin, buy_box_price, was_price_90d, sales_rank')
          .in('asin', batch);
        for (const p of pricingData || []) {
          pricingMap.set(p.asin, {
            marketPrice: p.was_price_90d ? Number(p.was_price_90d) : null,
            buyBoxPrice: p.buy_box_price ? Number(p.buy_box_price) : null,
            salesRank: p.sales_rank,
            was_price_90d: p.was_price_90d ? Number(p.was_price_90d) : null,
          });
        }
      }
    }

    // 5. eBay engagement (watchers + views) for due eBay items
    const ebayDue = dueItems.filter(
      (i) => i.listing_platform?.toLowerCase() === 'ebay' && i.ebay_listing_id
    );
    const engagementMap = new Map<string, { views: number | null; watchers: number }>();
    if (ebayDue.length > 0) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const authService = new EbayAuthService(undefined, supabase as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const refreshSvc = new EbayListingRefreshService(supabase as any, DEFAULT_USER_ID, authService);
        const eligible = await refreshSvc.getEligibleListings({ minAge: config.ebay_step1_days });
        for (const l of eligible) {
          engagementMap.set(String(l.itemId), { views: l.views, watchers: l.watchers });
        }
      } catch (err) {
        console.error('[Markdown] eBay engagement fetch failed (non-blocking):', err);
      }
    }

    // 6. Evaluate each due item
    const newProposals: MarkdownProposal[] = [];
    // Only roll the eval clock for items that reached a genuine decision this run.
    // NOT rolled: items skipped due to an existing pending proposal (so they're
    // re-surfaced promptly if that proposal is later rejected) and items that
    // errored (so a transient failure retries next run).
    const idsToRoll: string[] = [];
    let held = 0;
    let skipped = 0;
    let errors = 0;

    for (const item of dueItems) {
      // Existing pending proposal already covers this item — leave clock untouched.
      if (existingItemIds.has(item.id)) {
        skipped++;
        continue;
      }

      // markdown_hold is a deliberate decision — roll forward, don't re-check daily.
      if (item.markdown_hold) {
        skipped++;
        idsToRoll.push(item.id);
        continue;
      }
      if (!item.listing_value || !item.cost) {
        held++;
        idsToRoll.push(item.id);
        continue;
      }

      const platform = (item.listing_platform?.toLowerCase() === 'amazon' ? 'amazon' : 'ebay') as
        | 'amazon'
        | 'ebay';
      const ageDays = calculateAgingDays(item);
      const pricing = item.amazon_asin ? pricingMap.get(item.amazon_asin) : undefined;
      const engagement = item.ebay_listing_id ? engagementMap.get(item.ebay_listing_id) : undefined;

      try {
        const out = computeTarget({
          platform,
          currentPrice: Number(item.listing_value),
          cost: Number(item.cost),
          condition: item.condition,
          ageDays,
          marketPrice: pricing?.marketPrice ?? null,
          salesRank: pricing?.salesRank ?? null,
          views: engagement?.views ?? null,
          watchers: engagement?.watchers ?? null,
          config,
        });

        if (out.action === 'HOLD') {
          held++;
          idsToRoll.push(item.id);
          continue;
        }
        if (out.action === 'REPRICE' && out.reductionPct < config.min_change_pct) {
          held++;
          idsToRoll.push(item.id);
          continue; // change too small to surface
        }

        idsToRoll.push(item.id);
        newProposals.push({
          user_id: item.user_id,
          inventory_item_id: item.id,
          platform,
          diagnosis: out.diagnosis === 'HOLDING' ? 'OVERPRICED' : out.diagnosis,
          diagnosis_reason: out.reason,
          current_price: Number(item.listing_value),
          proposed_price: out.targetPrice,
          price_floor: out.floor,
          market_price: pricing?.marketPrice ?? null,
          proposed_action: out.action === 'AUCTION' ? 'AUCTION' : 'MARKDOWN',
          markdown_step: out.markdownStep,
          aging_days: ageDays,
          auction_end_date: null,
          auction_duration_days: out.action === 'AUCTION' ? config.auction_default_duration_days : null,
          status: 'PENDING',
          set_number: item.set_number ?? null,
          item_name: item.item_name ?? null,
          sales_rank: pricing?.salesRank ?? null,
        });
      } catch (err) {
        console.error(`[Markdown] Error processing item ${item.id}:`, err);
        errors++;
      }
    }

    // 7. Schedule auction end dates
    const auctionProposals = newProposals.filter((p) => p.proposed_action === 'AUCTION');
    if (auctionProposals.length > 0) {
      await scheduleAuctions(supabase, DEFAULT_USER_ID, auctionProposals, config.auction_max_per_day);
    }

    // 8. Insert proposals
    if (newProposals.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: insertError } = await (supabase as any)
        .from('markdown_proposals')
        .insert(newProposals);
      if (insertError) throw new Error(`Failed to insert proposals: ${insertError.message}`);
    }

    // 9. Roll next_markdown_eval_at forward — only for items decided this run
    const nextEval = new Date();
    nextEval.setDate(nextEval.getDate() + config.suggest_interval_days);
    const nextEvalISO = nextEval.toISOString().split('T')[0];
    for (let i = 0; i < idsToRoll.length; i += 200) {
      const batch = idsToRoll.slice(i, i + 200);
      await supabase
        .from('inventory_items')
        .update({ next_markdown_eval_at: nextEvalISO })
        .in('id', batch);
    }

    // 10. Build + send digest email (only if there is something to report)
    if (newProposals.length > 0) {
      const suggestions: MarkdownDigestSuggestion[] = newProposals
        .filter((p) => p.proposed_action === 'MARKDOWN' && p.proposed_price != null)
        .map((p) => ({
          setNumber: p.set_number,
          itemName: p.item_name,
          platform: p.platform,
          currentPrice: p.current_price,
          suggestedPrice: p.proposed_price as number,
          diagnosisReason: p.diagnosis_reason,
          ageDays: p.aging_days,
          floor: p.price_floor,
        }));
      const auctions: MarkdownDigestAuction[] = newProposals
        .filter((p) => p.proposed_action === 'AUCTION')
        .map((p) => ({
          setNumber: p.set_number,
          itemName: p.item_name,
          currentPrice: p.current_price,
          ageDays: p.aging_days,
          suggestedEndDate: p.auction_end_date,
          reason: p.diagnosis_reason,
        }));

      if (config.report_email) {
        await emailService.sendMarkdownDigest({
          userEmail: config.report_email,
          suggestions,
          auctions,
          appBaseUrl: process.env.NEXT_PUBLIC_APP_URL,
        });
      }
    }

    const result = {
      itemsEvaluated: dueItems.length,
      itemsRolled: idsToRoll.length,
      proposalsCreated: newProposals.length,
      markdownProposals: newProposals.filter((p) => p.proposed_action === 'MARKDOWN').length,
      auctionProposals: auctionProposals.length,
      held,
      skipped,
      errors,
      emailSent: newProposals.length > 0 && !!config.report_email,
    };

    const duration = Date.now() - startTime;
    try {
      await discordService.sendSyncStatus({
        title: '📉 Markdown Suggestions (30-day)',
        message: [
          `**Evaluated:** ${result.itemsEvaluated} due items`,
          `**Suggestions:** ${result.markdownProposals} markdowns, ${result.auctionProposals} auctions`,
          `**Held:** ${result.held} | Skipped: ${result.skipped} | Errors: ${result.errors}`,
          `**Email:** ${result.emailSent ? 'sent' : 'none'}`,
          `**Duration:** ${(duration / 1000).toFixed(1)}s`,
        ].join('\n'),
        success: result.errors === 0,
      });
    } catch {
      console.error('[Markdown] Discord summary failed');
    }

    await execution.complete({ ...result, durationMs: duration }, 200, result.proposalsCreated, result.errors);
    return NextResponse.json({ success: true, ...result, durationMs: duration });
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[Markdown Cron] Error:', error);
    await execution.fail(error instanceof Error ? error : new Error(errorMsg), 500);
    try {
      await discordService.sendAlert({
        title: '🔴 Markdown Evaluation Failed',
        message: `Error: ${errorMsg}\nDuration: ${Math.round(duration / 1000)}s`,
        priority: 'high',
      });
    } catch {
      // ignore
    }
    return NextResponse.json({ error: errorMsg, durationMs: duration }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
