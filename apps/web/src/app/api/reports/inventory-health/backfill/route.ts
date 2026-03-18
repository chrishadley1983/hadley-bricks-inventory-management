import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { validateAuth } from '@/lib/api/validate-auth';

/**
 * POST /api/reports/inventory-health/backfill
 * Backfill the last 8 weeks of inventory_weekly_snapshots from existing data.
 * Best-effort — historical listed counts are approximated.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await validateAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceRoleClient();
    const userId = auth.userId;

    // Get Monday of current week
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const currentMonday = new Date(now.getFullYear(), now.getMonth(), diff);

    // ── Fetch current listed items ONCE (paginated for >1000) ──
    const PAGE_SIZE = 1000;
    let offset = 0;
    const allListedItems: Array<{ cost: number | null; listing_value: number | null }> = [];

    while (true) {
      const { data, error } = await supabase
        .from('inventory_items')
        .select('cost, listing_value')
        .eq('user_id', userId)
        .eq('status', 'LISTED')
        .ilike('listing_platform', 'amazon')
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) throw new Error(`Failed to fetch listed items: ${error.message}`);
      allListedItems.push(...(data || []));
      if (!data || data.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    const currentListedCount = allListedItems.length;
    const totalCog = allListedItems.reduce((sum, i) => sum + (i.cost || 0), 0);
    const totalListValue = allListedItems.reduce((sum, i) => sum + (i.listing_value || 0), 0);

    const results: Array<{ week: string; sold: number; bought: number }> = [];

    for (let w = 0; w < 8; w++) {
      const weekStart = new Date(currentMonday);
      weekStart.setDate(weekStart.getDate() - w * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);

      const weekStartStr = weekStart.toISOString().split('T')[0];
      const weekEndStr = weekEnd.toISOString().split('T')[0];

      // Run per-week queries in parallel
      const [soldResult, boughtResult, listedResult] = await Promise.all([
        // Items sold on Amazon this week
        supabase
          .from('inventory_items')
          .select('id, cost, sold_price, listing_value')
          .eq('user_id', userId)
          .eq('status', 'SOLD')
          .ilike('sold_platform', 'amazon')
          .gte('sold_date', weekStartStr)
          .lte('sold_date', weekEndStr),

        // Items bought this week (all platforms)
        supabase
          .from('inventory_items')
          .select('id, cost')
          .eq('user_id', userId)
          .gte('purchase_date', weekStartStr)
          .lte('purchase_date', weekEndStr),

        // Items listed on Amazon this week
        supabase
          .from('inventory_items')
          .select('id, listing_value')
          .eq('user_id', userId)
          .ilike('listing_platform', 'amazon')
          .gte('listing_date', weekStartStr)
          .lte('listing_date', weekEndStr),
      ]);

      const sold = soldResult.data || [];
      const itemsSold = sold.length;
      const grossRevenue = sold.reduce((sum, i) => sum + (i.sold_price || 0), 0);

      const bought = boughtResult.data || [];
      const itemsBought = bought.length;
      const totalCogBought = bought.reduce((sum, i) => sum + (i.cost || 0), 0);
      const avgCogBought = itemsBought > 0 ? totalCogBought / itemsBought : 0;

      const listed = listedResult.data || [];
      const avgListValueListed =
        listed.length > 0
          ? listed.reduce((sum, i) => sum + (i.listing_value || 0), 0) / listed.length
          : 0;

      // Approximate listed count — best we can do without point-in-time snapshots
      const approxListedCount = currentListedCount;
      const sellThroughPct =
        approxListedCount > 0 ? (itemsSold / approxListedCount) * 100 : 0;

      // Upsert into snapshots
      const { error: upsertError } = await supabase
        .from('inventory_weekly_snapshots')
        .upsert(
          {
            user_id: userId,
            week_start: weekStartStr,
            platform: 'amazon',
            listed_count: approxListedCount,
            total_cog: Math.round(totalCog * 100) / 100,
            total_list_value: Math.round(totalListValue * 100) / 100,
            items_sold: itemsSold,
            gross_revenue: Math.round(grossRevenue * 100) / 100,
            items_bought: itemsBought,
            avg_cog_bought: Math.round(avgCogBought * 100) / 100,
            avg_list_value_listed: Math.round(avgListValueListed * 100) / 100,
            sell_through_pct: Math.round(sellThroughPct * 100) / 100,
          },
          { onConflict: 'user_id,week_start,platform' }
        );

      if (upsertError) {
        console.error(`Backfill week ${weekStartStr} failed:`, upsertError);
      }

      results.push({ week: weekStartStr, sold: itemsSold, bought: itemsBought });
    }

    return NextResponse.json({
      success: true,
      message: `Backfilled ${results.length} weeks`,
      weeks: results,
    });
  } catch (error) {
    console.error('[POST /api/reports/inventory-health/backfill] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
