/**
 * POST /api/cron/ebay-listing-refresh
 *
 * Unified Markdown — 90-day eBay Relist (AUTO).
 * Ends old listings (>= relist_age_days) and recreates them ("Sell Similar")
 * at the unified pricing engine's target price to boost Cassini visibility.
 *
 * Pricing comes from the SINGLE engine (lib/pricing/engine.ts) — this cron has
 * no private pricing logic. Skips items on markdown_hold or with a pending
 * manual markdown proposal (the relist owns the price for items it touches).
 *
 * Query params:
 *   ?report=true  — dry-run: returns eligible listings with calculated prices
 *   ?limit=N      — max listings to process per run (default: 20)
 *
 * See docs/features/unified-markdown/design.md §8b.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/api/cron-auth';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { EbayListingRefreshService } from '@/lib/ebay/ebay-listing-refresh.service';
import { EbayAuthService } from '@/lib/ebay/ebay-auth.service';
import { computeTarget } from '@/lib/pricing/engine';
import type { MarkdownConfig } from '@/lib/markdown/types';
import {
  emailService,
  type ListingRefreshReportItem,
  type ListingRefreshFailedItem,
} from '@/lib/email/email.service';
import { jobExecutionService, noopHandle } from '@/lib/services/job-execution.service';
import type { ExecutionHandle } from '@/lib/services/job-execution.service';
import type { EligibleListing } from '@/lib/ebay/listing-refresh.types';
import { DiscordService } from '@/lib/notifications/discord.service';

export const runtime = 'nodejs';
export const maxDuration = 300;

const JOB_TYPE = 'ebay-listing-refresh';
const USER_ID = '4b6e94b4-661c-4462-9d14-b21df7d51e5b';
const USER_EMAIL = 'chris@hadleybricks.co.uk';

const CONFIG_COLUMNS =
  'mode, amazon_step1_days, amazon_step2_days, amazon_step3_days, amazon_step4_days, amazon_step2_undercut_pct, amazon_step3_undercut_pct, ebay_step1_days, ebay_step2_days, ebay_step3_days, ebay_step4_days, ebay_step1_reduction_pct, ebay_step2_reduction_pct, amazon_fee_rate, ebay_fee_rate, overpriced_threshold_pct, low_demand_sales_rank, auction_default_duration_days, auction_max_per_day, auction_enabled, suggest_interval_days, relist_age_days, min_change_pct, report_email';

interface InvData {
  id: string;
  cost: number;
  condition: string | null;
  set_number: string | null;
  item_name: string | null;
  markdown_hold: boolean;
}

interface EnrichedListing extends EligibleListing {
  newPrice: number;
  oldPrice: number;
  tier: string;
  reductionPct: number;
  floor: number;
  inventoryItemId: string | null;
  cost: number;
}

async function loadConfig(
  supabase: ReturnType<typeof createServiceRoleClient>
): Promise<MarkdownConfig> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('markdown_config')
    .select(CONFIG_COLUMNS)
    .eq('user_id', USER_ID)
    .single();

  // Fall back to sane defaults if config row is missing.
  return {
    mode: data?.mode ?? 'review',
    amazon_step1_days: data?.amazon_step1_days ?? 60,
    amazon_step2_days: data?.amazon_step2_days ?? 90,
    amazon_step3_days: data?.amazon_step3_days ?? 120,
    amazon_step4_days: data?.amazon_step4_days ?? 150,
    amazon_step2_undercut_pct: Number(data?.amazon_step2_undercut_pct ?? 5),
    amazon_step3_undercut_pct: Number(data?.amazon_step3_undercut_pct ?? 10),
    ebay_step1_days: data?.ebay_step1_days ?? 60,
    ebay_step2_days: data?.ebay_step2_days ?? 90,
    ebay_step3_days: data?.ebay_step3_days ?? 120,
    ebay_step4_days: data?.ebay_step4_days ?? 150,
    ebay_step1_reduction_pct: Number(data?.ebay_step1_reduction_pct ?? 5),
    ebay_step2_reduction_pct: Number(data?.ebay_step2_reduction_pct ?? 10),
    amazon_fee_rate: Number(data?.amazon_fee_rate ?? 0.1836),
    ebay_fee_rate: Number(data?.ebay_fee_rate ?? 0.1566),
    overpriced_threshold_pct: Number(data?.overpriced_threshold_pct ?? 10),
    low_demand_sales_rank: data?.low_demand_sales_rank ?? 100000,
    auction_default_duration_days: data?.auction_default_duration_days ?? 7,
    auction_max_per_day: data?.auction_max_per_day ?? 2,
    auction_enabled: data?.auction_enabled ?? true,
    suggest_interval_days: data?.suggest_interval_days ?? 30,
    relist_age_days: data?.relist_age_days ?? 90,
    min_change_pct: Number(data?.min_change_pct ?? 3),
    report_email: data?.report_email ?? USER_EMAIL,
  };
}

/**
 * Inventory cost/condition/hold data keyed by ebay_listing_id.
 */
async function getInventoryData(
  supabase: ReturnType<typeof createServiceRoleClient>,
  ebayListingIds: string[]
): Promise<Map<string, InvData>> {
  const map = new Map<string, InvData>();
  const pageSize = 500;
  for (let offset = 0; offset < ebayListingIds.length; offset += pageSize) {
    const batch = ebayListingIds.slice(offset, offset + pageSize);
    const { data } = await supabase
      .from('inventory_items')
      .select('id, ebay_listing_id, cost, condition, set_number, item_name, markdown_hold')
      .in('ebay_listing_id', batch)
      .limit(1000);
    if (data) {
      for (const row of data) {
        if (row.ebay_listing_id) {
          map.set(row.ebay_listing_id, {
            id: row.id,
            cost: Number(row.cost) || 0,
            condition: row.condition,
            set_number: row.set_number,
            item_name: row.item_name,
            markdown_hold: !!row.markdown_hold,
          });
        }
      }
    }
  }
  return map;
}

/**
 * Inventory item ids that currently have a PENDING markdown proposal.
 */
async function getHeldByProposal(
  supabase: ReturnType<typeof createServiceRoleClient>,
  inventoryIds: string[]
): Promise<Set<string>> {
  const held = new Set<string>();
  const pageSize = 500;
  for (let offset = 0; offset < inventoryIds.length; offset += pageSize) {
    const batch = inventoryIds.slice(offset, offset + pageSize);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from('markdown_proposals')
      .select('inventory_item_id')
      .eq('user_id', USER_ID)
      .eq('status', 'PENDING')
      .in('inventory_item_id', batch);
    for (const row of data || []) held.add(row.inventory_item_id);
  }
  return held;
}

/** Price a listing via the single engine. RELIST always re-lists; price = engine target or current. */
function priceListing(listing: EligibleListing, inv: InvData | undefined, config: MarkdownConfig) {
  const cost = inv?.cost || 0;
  const condition = inv?.condition || listing.condition;
  const out = computeTarget({
    platform: 'ebay',
    currentPrice: listing.price,
    cost,
    condition,
    ageDays: listing.listingAge,
    marketPrice: null,
    salesRank: null,
    views: listing.views,
    watchers: listing.watchers,
    config,
  });
  // Relist at the engine's markdown target when it recommends one, else keep current price.
  const newPrice = out.action === 'REPRICE' && out.targetPrice != null ? out.targetPrice : listing.price;
  return { out, newPrice, cost };
}

/**
 * Report mode: returns eligible listings with calculated prices without making changes
 */
async function generateReport(
  service: EbayListingRefreshService,
  supabase: ReturnType<typeof createServiceRoleClient>,
  config: MarkdownConfig
) {
  const eligible = await service.getEligibleListings({ minAge: config.relist_age_days });
  if (eligible.length === 0) {
    return NextResponse.json({ report: true, eligible: 0, items: [] });
  }

  const enriched = await service.enrichListingsWithViews(eligible);
  const withOffers = await service.enrichWithPendingOffers(enriched);
  const invMap = await getInventoryData(supabase, withOffers.map((l) => l.itemId));

  const items = withOffers.map((listing) => {
    const inv = invMap.get(listing.itemId);
    const { out, newPrice } = priceListing(listing, inv, config);
    return {
      itemId: listing.itemId,
      title: listing.title,
      setNumber: inv?.set_number || null,
      price: listing.price,
      newPrice,
      tier: out.tier,
      reductionPct: out.reductionPct,
      views: listing.views,
      watchers: listing.watchers,
      ageDays: listing.listingAge,
      pendingOffers: listing.pendingOfferCount,
      markdownHold: inv?.markdown_hold ?? false,
      skipped: listing.pendingOfferCount > 0 || (inv?.markdown_hold ?? false),
      floor: out.floor,
    };
  });

  const toRefresh = items.filter((i) => !i.skipped);
  return NextResponse.json({
    report: true,
    eligible: eligible.length,
    toRefresh: toRefresh.length,
    skipped: items.length - toRefresh.length,
    items,
  });
}

export async function POST(request: NextRequest) {
  let execution: ExecutionHandle = noopHandle;

  try {
    const unauthorized = verifyCronAuth(request);
    if (unauthorized) return unauthorized;

    const { searchParams } = new URL(request.url);
    const isReport = searchParams.get('report') === 'true';
    const batchLimit = parseInt(searchParams.get('limit') || '20', 10);

    const supabase = createServiceRoleClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const authService = new EbayAuthService(undefined, supabase as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new EbayListingRefreshService(supabase as any, USER_ID, authService);
    const config = await loadConfig(supabase);

    if (isReport) {
      return generateReport(service, supabase, config);
    }

    execution = await jobExecutionService.start(JOB_TYPE, 'cron');

    // 1. Eligible listings (>= relist_age_days)
    const { eligible, skippedMultiQty } = await service.getEligibleListingsWithSkipped({
      minAge: config.relist_age_days,
    });
    console.log(
      `[ListingRefresh] ${eligible.length} eligible, ${skippedMultiQty.length} skipped (qty>1)`
    );

    if (skippedMultiQty.length > 0) {
      try {
        const discord = new DiscordService();
        const itemLines = skippedMultiQty
          .map(
            (l) =>
              `• **${l.title}** (SKU: ${l.sku || 'none'}) — qty: ${l.quantity}, sold: ${l.quantitySold}, age: ${l.listingAge}d`
          )
          .join('\n');
        await discord.send('alerts', {
          title: `Listing Refresh: ${skippedMultiQty.length} multi-qty item(s) skipped`,
          description: `These listings have quantity > 1 and were excluded from automatic refresh. Please relist manually.\n\n${itemLines}`,
          color: 0xffa500,
        });
      } catch (discordErr) {
        console.error('[ListingRefresh] Discord alert failed (non-blocking):', discordErr);
      }
    }

    if (eligible.length === 0) {
      await execution.complete({ message: 'No eligible listings', refreshed: 0 });
      return NextResponse.json({ success: true, message: 'No eligible listings', refreshed: 0 });
    }

    // 2. Enrich with views + pending offers
    const enrichedWithViews = await service.enrichListingsWithViews(eligible);
    const enrichedFull = await service.enrichWithPendingOffers(enrichedWithViews);

    // 3. Filter: no pending offers, not on hold, no pending manual proposal
    const invMap = await getInventoryData(supabase, enrichedFull.map((l) => l.itemId));
    const invIds = Array.from(invMap.values()).map((v) => v.id);
    const heldByProposal = await getHeldByProposal(supabase, invIds);

    const withoutOffers = enrichedFull.filter((l) => l.pendingOfferCount === 0);
    const offerSkipped = enrichedFull.length - withoutOffers.length;

    let holdSkipped = 0;
    let proposalSkipped = 0;
    const eligibleForRelist = withoutOffers.filter((l) => {
      const inv = invMap.get(l.itemId);
      if (inv?.markdown_hold) {
        holdSkipped++;
        return false;
      }
      if (inv && heldByProposal.has(inv.id)) {
        proposalSkipped++;
        return false;
      }
      return true;
    });

    const filtered = eligibleForRelist.slice(0, batchLimit);
    const deferredCount = eligibleForRelist.length - filtered.length;
    console.log(
      `[ListingRefresh] ${filtered.length} to relist (limit ${batchLimit}); skipped offers=${offerSkipped} hold=${holdSkipped} proposal=${proposalSkipped}; deferred=${deferredCount}`
    );

    if (filtered.length === 0) {
      await execution.complete({ message: 'Nothing eligible to relist', refreshed: 0 });
      return NextResponse.json({ success: true, message: 'Nothing eligible to relist', refreshed: 0 });
    }

    // 4. Price each listing via the unified engine
    const enrichedListings: EnrichedListing[] = filtered.map((listing) => {
      const inv = invMap.get(listing.itemId);
      const { out, newPrice, cost } = priceListing(listing, inv, config);
      return {
        ...listing,
        newPrice,
        oldPrice: listing.price,
        tier: out.tier || 'UNKNOWN',
        reductionPct: out.reductionPct,
        floor: out.floor,
        inventoryItemId: inv?.id || null,
        cost,
      };
    });
    const enrichedMap = new Map<string, EnrichedListing>();
    for (const el of enrichedListings) enrichedMap.set(el.itemId, el);

    // 5. Create refresh job + set modified prices
    const job = await service.createRefreshJob(filtered, false);
    const { data: jobItems } = await supabase
      .from('ebay_listing_refresh_items')
      .select('id, original_item_id')
      .eq('refresh_id', job.id);

    let pricesSet = 0;
    for (const jobItem of jobItems || []) {
      const enriched = enrichedMap.get(jobItem.original_item_id);
      if (!enriched) continue;
      if (enriched.newPrice !== enriched.oldPrice) {
        await service.updateItemBeforeRefresh(jobItem.id, { price: enriched.newPrice });
        pricesSet++;
      }
    }

    // 6. Execute relist (Fetch → End → Create)
    const result = await service.executeRefresh(job.id);
    console.log(`[ListingRefresh] ${result.createdCount} created, ${result.failedCount} failed`);

    // 7. Post-relist: update inventory, reset eval clock, write RELIST audit rows
    const updatedJob = await service.getRefreshJob(job.id);
    const reportItems: ListingRefreshReportItem[] = [];
    const failedItems: ListingRefreshFailedItem[] = [];
    const relistProposals: Record<string, unknown>[] = [];

    const nextEval = new Date();
    nextEval.setDate(nextEval.getDate() + config.suggest_interval_days);
    const nextEvalISO = nextEval.toISOString().split('T')[0];
    const todayISO = new Date().toISOString().split('T')[0];

    let invUpdated = 0;
    if (updatedJob?.items) {
      for (const item of updatedJob.items) {
        const enriched = enrichedMap.get(item.originalItemId);
        const inv = invMap.get(item.originalItemId);

        if (item.status === 'created' && item.newItemId && enriched?.inventoryItemId) {
          const { error: invErr } = await supabase
            .from('inventory_items')
            .update({
              ebay_listing_id: item.newItemId,
              listing_date: todayISO,
              listing_value: enriched.newPrice,
              next_markdown_eval_at: nextEvalISO,
              is_refresh: true,
              updated_at: new Date().toISOString(),
            })
            .eq('id', enriched.inventoryItemId);
          if (invErr) {
            console.error(`[ListingRefresh] inventory update failed for ${item.originalItemId}:`, invErr.message);
          } else {
            invUpdated++;
          }

          // Audit row
          relistProposals.push({
            user_id: USER_ID,
            inventory_item_id: enriched.inventoryItemId,
            platform: 'ebay',
            diagnosis: 'RELIST',
            diagnosis_reason: `90-day auto-relist (${enriched.tier}); £${enriched.oldPrice.toFixed(2)} → £${enriched.newPrice.toFixed(2)}`,
            current_price: enriched.oldPrice,
            proposed_price: enriched.newPrice,
            price_floor: enriched.floor,
            market_price: null,
            proposed_action: 'RELIST',
            markdown_step: null,
            aging_days: enriched.listingAge,
            status: 'AUTO_APPLIED',
            pushed_to_platform: true,
            applied_at: new Date().toISOString(),
            set_number: inv?.set_number || null,
            item_name: inv?.item_name || item.originalTitle,
            sales_rank: null,
          });
        }

        reportItems.push({
          setNumber: inv?.set_number || null,
          itemName: inv?.item_name || item.originalTitle,
          oldPrice: item.originalPrice ?? 0,
          newPrice: enriched?.newPrice ?? item.originalPrice ?? 0,
          tier: enriched?.tier || 'UNKNOWN',
          views: enriched?.views ?? null,
          watchers: enriched?.watchers ?? 0,
          ageDays: enriched?.listingAge ?? 0,
          newListingUrl: item.newItemId ? `https://www.ebay.co.uk/itm/${item.newItemId}` : null,
          failed: item.status === 'failed',
        });
      }
    }

    if (relistProposals.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from('markdown_proposals').insert(relistProposals);
    }

    for (const error of result.errors) {
      failedItems.push({
        title: error.title || error.itemId,
        phase: error.phase,
        errorMessage: error.errorMessage,
      });
    }

    // 8. Email report
    await emailService.sendListingRefreshReport({
      userEmail: config.report_email || USER_EMAIL,
      items: reportItems,
      failedItems,
    });

    const summary = {
      refreshed: result.createdCount,
      failed: result.failedCount,
      skippedOffers: offerSkipped,
      skippedHold: holdSkipped,
      skippedProposal: proposalSkipped,
      skippedMultiQty: skippedMultiQty.length,
      priceReductions: pricesSet,
      inventoryUpdated: invUpdated,
      deferred: deferredCount,
    };
    console.log('[ListingRefresh] Complete:', summary);
    await execution.complete(summary);
    return NextResponse.json({ success: true, ...summary });
  } catch (error) {
    console.error('[ListingRefresh] Fatal error:', error);
    await execution.fail(error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
