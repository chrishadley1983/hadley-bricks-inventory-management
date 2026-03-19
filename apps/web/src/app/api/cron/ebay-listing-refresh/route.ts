/**
 * POST /api/cron/ebay-listing-refresh
 *
 * Automated weekly refresh of stale eBay listings (90+ days old).
 * Ends old listings and recreates them as new ("Sell Similar") with
 * engagement-based price reductions to boost Cassini visibility.
 *
 * Query params:
 *   ?report=true  — dry-run: returns eligible listings with calculated prices, no changes
 *   ?limit=N      — max listings to process per run (default: 20)
 *
 * Recommended schedule: Daily at 7 PM UK time (Europe/London)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { EbayListingRefreshService } from '@/lib/ebay/ebay-listing-refresh.service';
import { EbayAuthService } from '@/lib/ebay/ebay-auth.service';
import {
  getEngagementTier,
  calculateRefreshPrice,
  type RefreshPriceResult,
} from '@/lib/ebay/refresh-pricing';
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
const EBAY_FEE_RATE = 0.1323;

interface EnrichedListing extends EligibleListing {
  pricing: RefreshPriceResult;
  inventoryItemId: string | null;
  cost: number;
}

/**
 * Fetch inventory cost data for eligible listings, keyed by ebay_listing_id
 */
async function getInventoryCosts(
  supabase: ReturnType<typeof createServiceRoleClient>,
  ebayListingIds: string[]
): Promise<Map<string, { id: string; cost: number; condition: string | null; set_number: string | null; item_name: string | null }>> {
  const map = new Map<string, { id: string; cost: number; condition: string | null; set_number: string | null; item_name: string | null }>();
  const pageSize = 500; // Keep well under Supabase 1000-row response limit

  for (let offset = 0; offset < ebayListingIds.length; offset += pageSize) {
    const batch = ebayListingIds.slice(offset, offset + pageSize);
    const { data } = await supabase
      .from('inventory_items')
      .select('id, ebay_listing_id, cost, condition, set_number, item_name')
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
          });
        }
      }
    }
  }

  return map;
}

/**
 * Report mode: returns eligible listings with calculated prices without making changes
 */
async function generateReport(
  service: EbayListingRefreshService,
  supabase: ReturnType<typeof createServiceRoleClient>
) {
  console.log('[ListingRefresh] Report mode — fetching eligible listings');

  const eligible = await service.getEligibleListings();
  if (eligible.length === 0) {
    return NextResponse.json({ report: true, eligible: 0, items: [] });
  }

  // Enrich with views
  const enriched = await service.enrichListingsWithViews(eligible);
  const withOffers = await service.enrichWithPendingOffers(enriched);

  // Get costs from DB
  const ebayIds = withOffers.map((l) => l.itemId);
  const costMap = await getInventoryCosts(supabase, ebayIds);

  // Calculate pricing
  const items = withOffers.map((listing) => {
    const inv = costMap.get(listing.itemId);
    const cost = inv?.cost || 0;
    const condition = inv?.condition || listing.condition;
    const tier = getEngagementTier(listing.views || 0, listing.watchers, listing.listingAge);
    const pricing = calculateRefreshPrice(listing.price, cost, tier, condition, EBAY_FEE_RATE);

    return {
      itemId: listing.itemId,
      title: listing.title,
      setNumber: inv?.set_number || null,
      price: listing.price,
      newPrice: pricing.newPrice,
      tier,
      reductionPct: pricing.reductionPct,
      views: listing.views,
      watchers: listing.watchers,
      ageDays: listing.listingAge,
      pendingOffers: listing.pendingOfferCount,
      skipped: listing.pendingOfferCount > 0,
      condition,
      cost,
      floorPrice: pricing.floorPrice,
      wasFloored: pricing.wasFloored,
      wasUnchanged: pricing.wasUnchanged,
    };
  });

  const toRefresh = items.filter((i) => !i.skipped);
  const skipped = items.filter((i) => i.skipped);

  return NextResponse.json({
    report: true,
    eligible: eligible.length,
    toRefresh: toRefresh.length,
    skipped: skipped.length,
    items,
  });
}

export async function POST(request: NextRequest) {
  let execution: ExecutionHandle = noopHandle;

  try {
    // Auth guard
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const isReport = searchParams.get('report') === 'true';
    const batchLimit = parseInt(searchParams.get('limit') || '20', 10);

    const supabase = createServiceRoleClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const authService = new EbayAuthService(undefined, supabase as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new EbayListingRefreshService(supabase as any, USER_ID, authService);

    // Report mode
    if (isReport) {
      return generateReport(service, supabase);
    }

    execution = await jobExecutionService.start(JOB_TYPE, 'cron');

    // 1. Get eligible listings (90+ days old) from eBay
    console.log('[ListingRefresh] Fetching eligible listings from eBay');
    const { eligible, skippedMultiQty } = await service.getEligibleListingsWithSkipped();
    console.log(`[ListingRefresh] Found ${eligible.length} eligible listings, ${skippedMultiQty.length} skipped (qty > 1)`);

    // Send Discord alert for multi-qty items that need manual review
    if (skippedMultiQty.length > 0) {
      try {
        const discord = new DiscordService();
        const itemLines = skippedMultiQty.map(
          (l) => `• **${l.title}** (SKU: ${l.sku || 'none'}) — qty: ${l.quantity}, sold: ${l.quantitySold}, age: ${l.listingAge}d`
        ).join('\n');
        await discord.send('alerts', {
          title: `Listing Refresh: ${skippedMultiQty.length} multi-qty item(s) skipped`,
          description: `The following listings have quantity > 1 and were excluded from automatic refresh. Please review and relist manually with correct quantities.\n\n${itemLines}`,
          color: 0xffa500, // Orange
        });
      } catch (discordErr) {
        console.error('[ListingRefresh] Discord alert failed (non-blocking):', discordErr);
      }
    }

    if (eligible.length === 0) {
      await execution.complete({ message: 'No eligible listings', refreshed: 0, skippedMultiQty: skippedMultiQty.length });
      return NextResponse.json({ success: true, message: 'No eligible listings', refreshed: 0, skippedMultiQty: skippedMultiQty.length });
    }

    // 2. Enrich with views and pending offers
    console.log('[ListingRefresh] Enriching with views and pending offers');
    const enrichedWithViews = await service.enrichListingsWithViews(eligible);
    const enrichedFull = await service.enrichWithPendingOffers(enrichedWithViews);

    // 3. Filter out items with pending offers, apply batch limit
    const withoutOffers = enrichedFull.filter((l) => l.pendingOfferCount === 0);
    const skippedCount = enrichedFull.length - withoutOffers.length;
    const filtered = withoutOffers.slice(0, batchLimit);
    const deferredCount = withoutOffers.length - filtered.length;
    console.log(`[ListingRefresh] ${filtered.length} to refresh (limit ${batchLimit}), ${skippedCount} skipped (pending offers), ${deferredCount} deferred to next run`);

    if (filtered.length === 0) {
      await execution.complete({ message: 'All eligible listings have pending offers', refreshed: 0, skipped: skippedCount });
      return NextResponse.json({ success: true, message: 'All eligible listings have pending offers', refreshed: 0, skipped: skippedCount });
    }

    // 4. Get inventory costs from DB
    const ebayIds = filtered.map((l) => l.itemId);
    const costMap = await getInventoryCosts(supabase, ebayIds);

    // 5. Calculate engagement tier and new price for each listing
    const enrichedListings: EnrichedListing[] = filtered.map((listing) => {
      const inv = costMap.get(listing.itemId);
      const cost = inv?.cost || 0;
      const condition = inv?.condition || listing.condition;
      const tier = getEngagementTier(listing.views || 0, listing.watchers, listing.listingAge);
      const pricing = calculateRefreshPrice(listing.price, cost, tier, condition, EBAY_FEE_RATE);

      return {
        ...listing,
        pricing,
        inventoryItemId: inv?.id || null,
        cost,
      };
    });

    // Build a lookup map for O(1) matching
    const enrichedMap = new Map<string, EnrichedListing>();
    for (const el of enrichedListings) {
      enrichedMap.set(el.itemId, el);
    }
    console.log(`[ListingRefresh] Built enrichedMap with ${enrichedMap.size} entries, sample key: "${enrichedListings[0]?.itemId}"`);

    // 6. Create refresh job (immediate mode, no review)
    console.log('[ListingRefresh] Creating refresh job');
    const job = await service.createRefreshJob(filtered, false);

    // 7. Set modified_price on each item
    const { data: jobItems, error: jobItemsErr } = await supabase
      .from('ebay_listing_refresh_items')
      .select('id, original_item_id')
      .eq('refresh_id', job.id);

    let pricesSet = 0;
    if (jobItemsErr) {
      console.error('[ListingRefresh] jobItems query error:', jobItemsErr.message);
    } else if (jobItems && jobItems.length > 0) {
      console.log(`[ListingRefresh] Got ${jobItems.length} job items, sample original_item_id: "${jobItems[0].original_item_id}", map has it: ${enrichedMap.has(jobItems[0].original_item_id)}`);
      for (const jobItem of jobItems) {
        const enriched = enrichedMap.get(jobItem.original_item_id);
        if (!enriched) {
          console.warn(`[ListingRefresh] No match for "${jobItem.original_item_id}"`);
          continue;
        }
        if (enriched.pricing.newPrice !== enriched.pricing.oldPrice) {
          await service.updateItemBeforeRefresh(jobItem.id, {
            price: enriched.pricing.newPrice,
          });
          pricesSet++;
        }
      }
      console.log(`[ListingRefresh] Set modified_price on ${pricesSet} of ${jobItems.length} items`);
    } else {
      console.error('[ListingRefresh] jobItems query returned empty');
    }

    // 8. Execute refresh (Fetch → End → Create)
    console.log('[ListingRefresh] Executing refresh');
    const result = await service.executeRefresh(job.id);
    console.log(`[ListingRefresh] Result: ${result.createdCount} created, ${result.failedCount} failed`);

    // 9. Update inventory_items with new listing data
    const updatedJob = await service.getRefreshJob(job.id);
    const reportItems: ListingRefreshReportItem[] = [];
    const failedItems: ListingRefreshFailedItem[] = [];

    let invUpdated = 0;
    if (updatedJob?.items) {
      for (const item of updatedJob.items) {
        const enriched = enrichedMap.get(item.originalItemId);
        const inv = costMap.get(item.originalItemId);

        if (item.status === 'created' && item.newItemId && enriched?.inventoryItemId) {
          // Update inventory_items with new listing info
          const { error: invErr } = await supabase
            .from('inventory_items')
            .update({
              ebay_listing_id: item.newItemId,
              listing_date: new Date().toISOString().split('T')[0],
              listing_value: enriched.pricing.newPrice,
              is_refresh: true,
              updated_at: new Date().toISOString(),
            })
            .eq('id', enriched.inventoryItemId);

          if (invErr) {
            console.error(`[ListingRefresh] Failed to update inventory for ${item.originalItemId}:`, invErr.message);
          } else {
            invUpdated++;
          }
        } else if (item.status === 'created' && !enriched) {
          console.warn(`[ListingRefresh] No enriched match for created item ${item.originalItemId}`);
        } else if (item.status === 'created' && !enriched?.inventoryItemId) {
          console.warn(`[ListingRefresh] No inventory record for created item ${item.originalItemId}`);
        }

        reportItems.push({
          setNumber: inv?.set_number || null,
          itemName: inv?.item_name || item.originalTitle,
          oldPrice: item.originalPrice ?? 0,
          newPrice: enriched?.pricing.newPrice ?? item.originalPrice ?? 0,
          tier: enriched?.pricing.tier || 'UNKNOWN',
          views: enriched?.views ?? null,
          watchers: enriched?.watchers ?? 0,
          ageDays: enriched?.listingAge ?? 0,
          newListingUrl: item.newItemId ? `https://www.ebay.co.uk/itm/${item.newItemId}` : null,
          failed: item.status === 'failed',
        });
      }
    }

    // Collect failed items for report
    for (const error of result.errors) {
      failedItems.push({
        title: error.title || error.itemId,
        phase: error.phase,
        errorMessage: error.errorMessage,
      });
    }

    // 10. Send email report
    console.log('[ListingRefresh] Sending email report');
    await emailService.sendListingRefreshReport({
      userEmail: USER_EMAIL,
      items: reportItems,
      failedItems,
    });

    console.log(`[ListingRefresh] Inventory updated: ${invUpdated}, prices set: ${pricesSet}`);

    const summary = {
      refreshed: result.createdCount,
      failed: result.failedCount,
      skipped: skippedCount,
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
