/**
 * POST /api/cron/ebay-listing-refresh/reprice
 *
 * One-off: applies engagement-based pricing to listings that were
 * recreated at original prices due to the ItemID type mismatch bug.
 * Uses ReviseFixedPriceItem to update price only (no end/create).
 *
 * Query params:
 *   ?job=<id>      — comma-separated refresh job IDs (defaults to known unpriced jobs)
 *   ?dry=true      — dry-run mode, returns calculated prices without applying
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { EbayAuthService } from '@/lib/ebay/ebay-auth.service';
import { EbayTradingClient } from '@/lib/platform-stock/ebay/ebay-trading.client';
import {
  getEngagementTier,
  calculateRefreshPrice,
} from '@/lib/ebay/refresh-pricing';

export const runtime = 'nodejs';
export const maxDuration = 300;

const USER_ID = '4b6e94b4-661c-4462-9d14-b21df7d51e5b';
const EBAY_FEE_RATE = 0.1323;
const RATE_LIMIT_DELAY_MS = 150;

// Jobs created before the ItemID type fix — need retroactive repricing
const DEFAULT_JOB_IDS = [
  '01d60f42-9ba3-4f03-904c-c598420fc737',  // 2026-03-17 19:00 (20 items)
  '69991a48-8edf-4b28-a7fb-7a3d5c096e4b',  // 2026-03-18 19:00 (20 items)
];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const dryRun = searchParams.get('dry') === 'true';
    const jobIds = searchParams.get('job')
      ? searchParams.get('job')!.split(',').map((s) => s.trim())
      : DEFAULT_JOB_IDS;

    const supabase = createServiceRoleClient();

    // Get created items with engagement data across all specified jobs
    const { data: items, error } = await supabase
      .from('ebay_listing_refresh_items')
      .select(`
        new_item_id,
        original_title,
        original_price,
        original_watchers,
        original_views,
        original_listing_start_date
      `)
      .in('refresh_id', jobIds)
      .eq('status', 'created')
      .not('new_item_id', 'is', null);

    if (error || !items) {
      return NextResponse.json({ error: 'Failed to fetch items' }, { status: 500 });
    }

    // Get inventory data (cost + current listing_value) for already-reduced check
    const newItemIds = items.map((i) => i.new_item_id).filter(Boolean) as string[];
    const costMap = new Map<string, { cost: number; condition: string | null; id: string; listingValue: number | null }>();

    for (let offset = 0; offset < newItemIds.length; offset += 500) {
      const batch = newItemIds.slice(offset, offset + 500);
      const { data: invRows } = await supabase
        .from('inventory_items')
        .select('id, ebay_listing_id, cost, condition, listing_value')
        .in('ebay_listing_id', batch);

      if (invRows) {
        for (const row of invRows) {
          if (row.ebay_listing_id) {
            costMap.set(row.ebay_listing_id, {
              cost: Number(row.cost) || 0,
              condition: row.condition,
              id: row.id,
              listingValue: row.listing_value != null ? Number(row.listing_value) : null,
            });
          }
        }
      }
    }

    // Calculate prices
    const now = new Date();
    const repriceItems: Array<{
      newItemId: string;
      title: string;
      oldPrice: number;
      newPrice: number;
      tier: string;
      reductionPct: number;
      views: number;
      watchers: number;
      inventoryId: string | null;
    }> = [];
    let alreadyReduced = 0;

    for (const item of items) {
      if (!item.new_item_id) continue;

      const oldPrice = Number(item.original_price) || 0;
      const inv = costMap.get(item.new_item_id);

      // Guard: skip items where listing_value is already below original_price
      // This means the reprice script (or manual edit) already reduced the price
      if (inv?.listingValue != null && inv.listingValue < oldPrice) {
        alreadyReduced++;
        continue;
      }

      const views = item.original_views || 0;
      const watchers = item.original_watchers || 0;
      const startDate = item.original_listing_start_date
        ? new Date(item.original_listing_start_date)
        : now;
      const ageDays = Math.max(1, Math.floor((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));

      const cost = inv?.cost || 0;
      const condition = inv?.condition || null;

      const tier = getEngagementTier(views, watchers, ageDays);
      const pricing = calculateRefreshPrice(oldPrice, cost, tier, condition, EBAY_FEE_RATE);

      if (pricing.newPrice < oldPrice) {
        repriceItems.push({
          newItemId: item.new_item_id,
          title: item.original_title || '',
          oldPrice,
          newPrice: pricing.newPrice,
          tier,
          reductionPct: pricing.reductionPct,
          views,
          watchers,
          inventoryId: inv?.id || null,
        });
      }
    }

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        jobIds,
        totalItems: items.length,
        toReprice: repriceItems.length,
        alreadyReduced,
        unchanged: items.length - repriceItems.length - alreadyReduced,
        items: repriceItems.map((i) => ({
          title: i.title.slice(0, 60),
          oldPrice: i.oldPrice,
          newPrice: i.newPrice,
          tier: i.tier,
          reductionPct: i.reductionPct,
        })),
      });
    }

    // Apply price changes via ReviseFixedPriceItem
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const authService = new EbayAuthService(undefined, supabase as any);
    const accessToken = await authService.getAccessToken(USER_ID);
    if (!accessToken) {
      return NextResponse.json({ error: 'eBay auth failed' }, { status: 500 });
    }

    const client = new EbayTradingClient({ accessToken, siteId: 3 });

    let revised = 0;
    let failed = 0;
    const results: Array<{ itemId: string; title: string; oldPrice: number; newPrice: number; error?: string }> = [];

    for (const item of repriceItems) {
      try {
        const result = await client.reviseFixedPriceItem({
          itemId: item.newItemId,
          startPrice: item.newPrice,
        });

        if (result.success) {
          // Update inventory_items
          if (item.inventoryId) {
            await supabase
              .from('inventory_items')
              .update({ listing_value: item.newPrice, updated_at: new Date().toISOString() })
              .eq('id', item.inventoryId);
          }

          revised++;
          results.push({
            itemId: item.newItemId,
            title: item.title,
            oldPrice: item.oldPrice,
            newPrice: item.newPrice,
          });
        } else {
          throw new Error(result.errorMessage || 'Revise failed');
        }

        await delay(RATE_LIMIT_DELAY_MS);
      } catch (err) {
        failed++;
        results.push({
          itemId: item.newItemId,
          title: item.title,
          oldPrice: item.oldPrice,
          newPrice: item.newPrice,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return NextResponse.json({
      success: true,
      jobIds,
      totalItems: items.length,
      revised,
      failed,
      alreadyReduced,
      unchanged: items.length - repriceItems.length - alreadyReduced,
      results,
    });
  } catch (error) {
    console.error('[ListingRefresh Reprice] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 }
    );
  }
}
