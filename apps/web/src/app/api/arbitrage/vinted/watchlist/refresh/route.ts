/**
 * Vinted Watchlist Refresh API
 *
 * POST - Materialise watchlist from sales data and rankings
 *
 * The watchlist consists of:
 * - Top 100 best sellers (from platform_orders, last 13 months)
 * - Top 100 popular retired sets (from seeded_asin_rankings, excluding best sellers)
 *
 * Manual exclusions are applied before materialisation.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { fromBricksetFormat } from '@/lib/utils/set-number-extraction';

const BEST_SELLERS_LIMIT = 100;
const POPULAR_RETIRED_LIMIT = 100;
const TOTAL_WATCHLIST_SIZE = 200;

// =============================================================================
// POST - Refresh watchlist
// =============================================================================

export async function POST(_request: NextRequest) {
  const supabase = await createClient();

  // Check auth
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Get manual exclusions
    const { data: exclusions } = await supabase
      .from('vinted_watchlist_exclusions')
      .select('set_number')
      .eq('user_id', user.id);

    const excludedSetNumbers = new Set(exclusions?.map((e) => e.set_number) || []);

    // =========================================================================
    // STEP 1: Get top 100 best sellers from platform_orders (last 13 months)
    // =========================================================================

    // Get orders with set numbers and ASINs from linked inventory items
    const thirteenMonthsAgo = new Date();
    thirteenMonthsAgo.setMonth(thirteenMonthsAgo.getMonth() - 13);

    const { data: orderData, error: ordersError } = await supabase
      .from('platform_orders')
      .select(
        `
        id,
        order_items!inner (
          inventory_item_id,
          inventory_items!order_items_inventory_item_id_fkey!inner (
            set_number,
            amazon_asin
          )
        )
      `
      )
      .gte('order_date', thirteenMonthsAgo.toISOString())
      .in('status', ['completed', 'Completed', 'Shipped']);

    if (ordersError) {
      console.error('[watchlist/refresh] Failed to fetch orders:', ordersError);
      return NextResponse.json(
        { error: 'Failed to fetch sales data' },
        { status: 500 }
      );
    }

    // Count units sold per set number
    const setNumberSales = new Map<
      string,
      { count: number; asin: string | null }
    >();

    interface OrderItemWithInventory {
      inventory_item_id: string | null;
      inventory_items: {
        set_number: string | null;
        amazon_asin: string | null;
      } | null;
    }

    for (const order of orderData || []) {
      const orderItems = order.order_items as unknown as OrderItemWithInventory[];
      for (const item of orderItems) {
        const setNumber = item.inventory_items?.set_number;
        if (!setNumber) continue;

        // Convert from Brickset format if needed
        const rawSetNumber = fromBricksetFormat(setNumber);

        // Skip if excluded
        if (excludedSetNumbers.has(rawSetNumber)) continue;

        const existing = setNumberSales.get(rawSetNumber) || {
          count: 0,
          asin: null,
        };
        existing.count += 1;
        // Capture ASIN from inventory item if available (prefer first non-null)
        if (!existing.asin && item.inventory_items?.amazon_asin) {
          existing.asin = item.inventory_items.amazon_asin;
        }
        setNumberSales.set(rawSetNumber, existing);
      }
    }

    // Sort by count descending and take top 100
    const bestSellers = [...setNumberSales.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, BEST_SELLERS_LIMIT)
      .map(([setNumber, data]) => ({
        setNumber,
        asin: data.asin,
        source: 'best_seller' as const,
        salesRank: null,
      }));

    const bestSellerSetNumbers = new Set(bestSellers.map((b) => b.setNumber));

    // =========================================================================
    // STEP 2: Get top 100 popular retired sets from seeded_asin_rankings
    // =========================================================================

    // Get retired sets with sales rankings
    const { data: rankingsData, error: rankingsError } = await supabase
      .from('seeded_asin_rankings')
      .select(
        `
        asin,
        sales_rank,
        seeded_asins!inner (
          id,
          brickset_sets!inner (
            set_number,
            set_name,
            exit_date
          )
        )
      `
      )
      .not('sales_rank', 'is', null)
      .order('sales_rank', { ascending: true });

    if (rankingsError) {
      console.error('[watchlist/refresh] Failed to fetch rankings:', rankingsError);
      // Continue without rankings - best sellers only
    }

    interface RankingRow {
      asin: string;
      sales_rank: number;
      seeded_asins: {
        id: string;
        brickset_sets: {
          set_number: string;
          set_name: string;
          exit_date: string | null;
        };
      };
    }

    const popularRetired: Array<{
      setNumber: string;
      asin: string | null;
      source: 'popular_retired';
      salesRank: number | null;
    }> = [];

    const seenSetNumbers = new Set(bestSellerSetNumbers);

    for (const ranking of (rankingsData as RankingRow[] | null) || []) {
      if (popularRetired.length >= POPULAR_RETIRED_LIMIT) break;

      const bricksetSet = ranking.seeded_asins.brickset_sets;

      // Only include retired sets (has exit_date)
      if (!bricksetSet.exit_date) continue;

      const rawSetNumber = fromBricksetFormat(bricksetSet.set_number);

      // Skip if already in best sellers or excluded
      if (seenSetNumbers.has(rawSetNumber)) continue;
      if (excludedSetNumbers.has(rawSetNumber)) continue;

      popularRetired.push({
        setNumber: rawSetNumber,
        asin: ranking.asin,
        source: 'popular_retired' as const,
        salesRank: ranking.sales_rank,
      });
      seenSetNumbers.add(rawSetNumber);
    }

    // =========================================================================
    // STEP 3: Combine and deduplicate (max 200 total)
    // =========================================================================

    const combinedWatchlist = [...bestSellers, ...popularRetired].slice(
      0,
      TOTAL_WATCHLIST_SIZE
    );

    // =========================================================================
    // STEP 4: Clear existing watchlist and insert new entries
    // =========================================================================

    // Delete existing watchlist
    const { error: deleteError } = await supabase
      .from('vinted_watchlist')
      .delete()
      .eq('user_id', user.id);

    if (deleteError) {
      console.error('[watchlist/refresh] Failed to clear watchlist:', deleteError);
      return NextResponse.json(
        { error: 'Failed to clear existing watchlist' },
        { status: 500 }
      );
    }

    // Insert new watchlist entries
    if (combinedWatchlist.length > 0) {
      const watchlistEntries = combinedWatchlist.map((entry) => ({
        user_id: user.id,
        set_number: entry.setNumber,
        asin: entry.asin,
        source: entry.source,
        sales_rank: entry.salesRank,
      }));

      const { error: insertError } = await supabase
        .from('vinted_watchlist')
        .insert(watchlistEntries);

      if (insertError) {
        console.error('[watchlist/refresh] Failed to insert watchlist:', insertError);
        return NextResponse.json(
          { error: 'Failed to create watchlist' },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      success: true,
      summary: {
        bestSellersAdded: bestSellers.length,
        popularRetiredAdded: popularRetired.length,
        totalSets: combinedWatchlist.length,
        exclusionsApplied: excludedSetNumbers.size,
      },
    });
  } catch (error) {
    console.error('[watchlist/refresh] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
