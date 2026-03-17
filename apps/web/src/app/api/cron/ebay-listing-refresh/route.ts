/**
 * POST /api/cron/ebay-listing-refresh
 *
 * Automated weekly refresh of stale eBay listings (90+ days old).
 * Ends old listings and recreates them as new ("Sell Similar") with
 * engagement-based price reductions to boost Cassini visibility.
 *
 * Query params:
 *   ?report=true  — dry-run: returns eligible listings with calculated prices, no changes
 *
 * Recommended schedule: Sunday 7 PM UK time (Europe/London)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { EbayListingRefreshService } from '@/lib/ebay/ebay-listing-refresh.service';
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

export const runtime = 'nodejs';
export const maxDuration = 300;

const JOB_TYPE = 'ebay-listing-refresh';
const USER_ID = '4b6e94b4-661c-4462-9d14-b21df7d51e5b';
const USER_EMAIL = 'chris@hadleybricks.co.uk';
const EBAY_FEE_RATE = 0.1323;
const RATE_LIMIT_DELAY_MS = 150;

interface EnrichedListing extends EligibleListing {
  pricing: RefreshPriceResult;
  inventoryItemId: string | null;
  cost: number;
}

/**
 * Sleep helper for rate limiting
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

    const supabase = createServiceRoleClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new EbayListingRefreshService(supabase as any, USER_ID);

    // Report mode
    if (isReport) {
      return generateReport(service, supabase);
    }

    execution = await jobExecutionService.start(JOB_TYPE, 'cron');

    // 1. Get eligible listings (90+ days old) from eBay
    console.log('[ListingRefresh] Fetching eligible listings from eBay');
    const eligible = await service.getEligibleListings();
    console.log(`[ListingRefresh] Found ${eligible.length} eligible listings`);

    if (eligible.length === 0) {
      await execution.complete({ message: 'No eligible listings', refreshed: 0 });
      return NextResponse.json({ success: true, message: 'No eligible listings', refreshed: 0 });
    }

    // 2. Enrich with views and pending offers
    console.log('[ListingRefresh] Enriching with views and pending offers');
    const enrichedWithViews = await service.enrichListingsWithViews(eligible);
    const enrichedFull = await service.enrichWithPendingOffers(enrichedWithViews);

    // 3. Filter out items with pending offers
    const filtered = enrichedFull.filter((l) => l.pendingOfferCount === 0);
    const skippedCount = enrichedFull.length - filtered.length;
    console.log(`[ListingRefresh] ${filtered.length} to refresh, ${skippedCount} skipped (pending offers)`);

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

    // 6. Create refresh job (immediate mode, no review)
    console.log('[ListingRefresh] Creating refresh job');
    const job = await service.createRefreshJob(filtered, false);

    // 7. Set modified_price on each item
    const { data: jobItems } = await supabase
      .from('ebay_listing_refresh_items')
      .select('id, original_item_id')
      .eq('refresh_id', job.id);

    if (jobItems) {
      for (const jobItem of jobItems) {
        const enriched = enrichedListings.find((l) => l.itemId === jobItem.original_item_id);
        if (enriched && enriched.pricing.newPrice !== enriched.pricing.oldPrice) {
          await service.updateItemBeforeRefresh(jobItem.id, {
            price: enriched.pricing.newPrice,
          });
        }
      }
    }

    // 8. Execute refresh (Fetch → End → Create)
    console.log('[ListingRefresh] Executing refresh');
    const result = await service.executeRefresh(job.id);
    console.log(`[ListingRefresh] Result: ${result.createdCount} created, ${result.failedCount} failed`);

    // 9. Update inventory_items with new listing data
    const updatedJob = await service.getRefreshJob(job.id);
    const reportItems: ListingRefreshReportItem[] = [];
    const failedItems: ListingRefreshFailedItem[] = [];

    if (updatedJob?.items) {
      for (const item of updatedJob.items) {
        const enriched = enrichedListings.find((l) => l.itemId === item.originalItemId);
        const inv = costMap.get(item.originalItemId);

        if (item.status === 'created' && item.newItemId && enriched?.inventoryItemId) {
          // Update inventory_items with new listing info
          await supabase
            .from('inventory_items')
            .update({
              ebay_listing_id: item.newItemId,
              listing_date: new Date().toISOString().split('T')[0],
              listing_value: enriched.pricing.newPrice,
              updated_at: new Date().toISOString(),
            })
            .eq('id', enriched.inventoryItemId);
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

    const summary = {
      refreshed: result.createdCount,
      failed: result.failedCount,
      skipped: skippedCount,
      priceReductions: enrichedListings.filter(
        (l) => l.pricing.newPrice < l.pricing.oldPrice
      ).length,
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
