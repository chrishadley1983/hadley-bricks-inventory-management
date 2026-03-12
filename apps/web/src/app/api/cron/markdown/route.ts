/**
 * Smart Auto-Markdown Cron
 *
 * Daily evaluation of LISTED inventory items.
 * Generates markdown proposals based on aging, pricing data, and diagnosis.
 * In auto mode, OVERPRICED markdown proposals are applied immediately.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { discordService } from '@/lib/notifications/discord.service';
import { jobExecutionService, noopHandle } from '@/lib/services/job-execution.service';
import type { ExecutionHandle } from '@/lib/services/job-execution.service';
import { generateProposal } from '@/lib/markdown/markdown-engine.service';
import { scheduleAuctions } from '@/lib/markdown/auction-scheduler.service';
import type {
  MarkdownConfig,
  InventoryItemForMarkdown,
  PricingData,
  MarkdownProposal,
  CronResult,
} from '@/lib/markdown/types';

export const runtime = 'nodejs';
export const maxDuration = 120;

const DEFAULT_USER_ID = '4b6e94b4-661c-4462-9d14-b21df7d51e5b';
const PAGE_SIZE = 500;

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let execution: ExecutionHandle = noopHandle;

  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    execution = await jobExecutionService.start('markdown-evaluation', 'cron');
    const supabase = createServiceRoleClient();

    // 1. Load config
    const { data: configRow, error: configError } = await supabase
      .from('markdown_config')
      .select('*')
      .eq('user_id', DEFAULT_USER_ID)
      .single();

    if (configError || !configRow) {
      await execution.complete({ skipped: 'No config found' }, 200);
      return NextResponse.json({ success: true, skipped: 'No markdown config' });
    }

    const config: MarkdownConfig = {
      mode: configRow.mode as 'review' | 'auto',
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
    };

    // 2. Get existing pending proposals to avoid duplicates
    const { data: existingProposals } = await supabase
      .from('markdown_proposals')
      .select('inventory_item_id')
      .eq('user_id', DEFAULT_USER_ID)
      .eq('status', 'PENDING');

    const existingItemIds = new Set((existingProposals || []).map((p) => p.inventory_item_id));

    // 3. Fetch LISTED inventory items (paginated)
    const allItems: InventoryItemForMarkdown[] = [];
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const { data: items, error: itemsError } = await supabase
        .from('inventory_items')
        .select(
          'id, user_id, set_number, item_name, condition, status, cost, listing_value, listing_platform, listing_date, purchase_date, created_at, markdown_hold, amazon_asin, ebay_listing_id'
        )
        .eq('user_id', DEFAULT_USER_ID)
        .eq('status', 'LISTED')
        .range(from, to);

      if (itemsError) throw new Error(`Failed to fetch items: ${itemsError.message}`);

      for (const item of items || []) {
        allItems.push({ ...item, sales_rank: null } as InventoryItemForMarkdown);
      }
      hasMore = (items?.length ?? 0) === PAGE_SIZE;
      page++;
    }

    // 4. Fetch Amazon pricing data (Keepa) for items with ASINs
    const amazonAsins = allItems
      .filter((i) => i.amazon_asin && i.listing_platform?.toLowerCase() === 'amazon')
      .map((i) => i.amazon_asin!);

    const pricingMap = new Map<string, PricingData>();

    if (amazonAsins.length > 0) {
      // Fetch in batches of 100
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

    // 5. Generate proposals
    const result: CronResult = {
      itemsEvaluated: allItems.length,
      proposalsCreated: 0,
      markdownProposals: 0,
      auctionProposals: 0,
      autoApplied: 0,
      skipped: 0,
      held: 0,
      errors: 0,
    };

    const newProposals: MarkdownProposal[] = [];

    for (const item of allItems) {
      // Skip items with existing pending proposals
      if (existingItemIds.has(item.id)) {
        result.skipped++;
        continue;
      }

      // Skip held items
      if (item.markdown_hold) {
        result.held++;
        continue;
      }

      // Get pricing data
      const pricing = item.amazon_asin
        ? pricingMap.get(item.amazon_asin) || { marketPrice: null, buyBoxPrice: null, salesRank: null, was_price_90d: null }
        : { marketPrice: null, buyBoxPrice: null, salesRank: null, was_price_90d: null };

      // For eBay items without Amazon pricing, use listing value as approximate market
      // (eBay pricing sync doesn't provide the same granular data)
      if (item.listing_platform?.toLowerCase() === 'ebay' && !pricing.marketPrice) {
        // eBay items are diagnosed based on aging and rank only
        // We'll set market price to current listing value so the diagnosis focuses on age/rank
        pricing.marketPrice = item.listing_value;
      }

      try {
        const proposal = generateProposal(item, pricing, config, config.mode);
        if (proposal) {
          newProposals.push(proposal);
        } else {
          result.skipped++;
        }
      } catch (err) {
        console.error(`[Markdown] Error processing item ${item.id}:`, err);
        result.errors++;
      }
    }

    // 6. Schedule auctions (assign end dates)
    const auctionProposals = newProposals.filter((p) => p.proposed_action === 'AUCTION');
    if (auctionProposals.length > 0) {
      await scheduleAuctions(supabase, DEFAULT_USER_ID, auctionProposals, config.auction_max_per_day);
    }

    // 7. Insert proposals into database
    if (newProposals.length > 0) {
      const { error: insertError } = await supabase
        .from('markdown_proposals')
        .insert(newProposals);

      if (insertError) {
        throw new Error(`Failed to insert proposals: ${insertError.message}`);
      }
    }

    // 8. Auto-apply OVERPRICED markdowns if in auto mode
    const autoApplyProposals = newProposals.filter((p) => p.status === 'AUTO_APPLIED');
    for (const proposal of autoApplyProposals) {
      try {
        if (proposal.proposed_price !== null) {
          await supabase
            .from('inventory_items')
            .update({ listing_value: proposal.proposed_price, updated_at: new Date().toISOString() })
            .eq('id', proposal.inventory_item_id);
          result.autoApplied++;
        }
      } catch (err) {
        console.error(`[Markdown] Auto-apply failed for ${proposal.inventory_item_id}:`, err);
        // Mark as FAILED
        await supabase
          .from('markdown_proposals')
          .update({ status: 'FAILED', error_message: String(err) })
          .eq('inventory_item_id', proposal.inventory_item_id)
          .eq('status', 'AUTO_APPLIED');
        result.errors++;
      }
    }

    // 9. Tally results
    result.proposalsCreated = newProposals.length;
    result.markdownProposals = newProposals.filter((p) => p.proposed_action === 'MARKDOWN').length;
    result.auctionProposals = auctionProposals.length;

    // 10. Send Discord summary
    const duration = Date.now() - startTime;
    try {
      await discordService.sendSyncStatus({
        title: `📉 Markdown Evaluation Complete`,
        message: [
          `**Mode:** ${config.mode}`,
          `**Items evaluated:** ${result.itemsEvaluated}`,
          `**Proposals created:** ${result.proposalsCreated}`,
          `  ↳ Markdowns: ${result.markdownProposals} | Auctions: ${result.auctionProposals}`,
          `**Auto-applied:** ${result.autoApplied}`,
          `**Skipped:** ${result.skipped} | Held: ${result.held} | Errors: ${result.errors}`,
          `**Duration:** ${(duration / 1000).toFixed(1)}s`,
        ].join('\n'),
        success: result.errors === 0,
      });
    } catch {
      console.error('[Markdown] Failed to send Discord summary');
    }

    await execution.complete(
      { ...result, durationMs: duration },
      200,
      result.proposalsCreated,
      result.errors
    );

    return NextResponse.json({ success: true, ...result, durationMs: duration });
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[Markdown Cron] Error:', error);

    await execution.fail(error, 500);

    try {
      await discordService.sendAlert({
        title: '🔴 Markdown Evaluation Failed',
        message: `Error: ${errorMsg}\nDuration: ${Math.round(duration / 1000)}s`,
        priority: 'high',
      });
    } catch {
      // Ignore Discord failure
    }

    return NextResponse.json({ error: errorMsg, durationMs: duration }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
