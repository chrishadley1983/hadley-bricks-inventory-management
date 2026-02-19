import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Total minifigs in Bricqer inventory
    const { count: totalInBricqer } = await supabase
      .from('minifig_sync_items')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id);

    // Total meeting threshold
    const { count: totalMeetingThreshold } = await supabase
      .from('minifig_sync_items')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('meets_threshold', true);

    // Count by status
    const { data: statusCounts } = await supabase
      .from('minifig_sync_items')
      .select('listing_status')
      .eq('user_id', user.id);

    const countByStatus: Record<string, number> = {};
    for (const row of statusCounts ?? []) {
      const status = row.listing_status || 'UNKNOWN';
      countByStatus[status] = (countByStatus[status] || 0) + 1;
    }

    // Revenue from sold items (both eBay and Bricqer sales)
    const { data: executedRemovals } = await supabase
      .from('minifig_removal_queue')
      .select('sale_price')
      .eq('user_id', user.id)
      .eq('status', 'EXECUTED');

    let totalRevenue = 0;
    for (const removal of executedRemovals ?? []) {
      totalRevenue += Number(removal.sale_price) || 0;
    }

    // Fee savings: 3.5% Bricqer fee avoided on eBay sales
    const { data: ebayExecuted } = await supabase
      .from('minifig_removal_queue')
      .select('sale_price')
      .eq('user_id', user.id)
      .eq('status', 'EXECUTED')
      .eq('sold_on', 'EBAY');

    let feeSavings = 0;
    for (const removal of ebayExecuted ?? []) {
      feeSavings += (Number(removal.sale_price) || 0) * 0.035;
    }

    // Average time to sell (days between created_at and updated_at for sold items)
    const { data: soldItems } = await supabase
      .from('minifig_sync_items')
      .select('created_at, updated_at')
      .eq('user_id', user.id)
      .in('listing_status', ['SOLD_EBAY', 'SOLD_BRICQER']);

    let avgTimeToSell: number | null = null;
    if (soldItems && soldItems.length > 0) {
      let totalDays = 0;
      for (const item of soldItems) {
        const created = new Date(item.created_at || '').getTime();
        const updated = new Date(item.updated_at || '').getTime();
        if (created && updated) {
          totalDays += (updated - created) / (1000 * 60 * 60 * 24);
        }
      }
      avgTimeToSell = Math.round((totalDays / soldItems.length) * 10) / 10;
    }

    // Pending removals count
    const { count: pendingRemovals } = await supabase
      .from('minifig_removal_queue')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('status', 'PENDING');

    return NextResponse.json({
      data: {
        totalInBricqer: totalInBricqer ?? 0,
        totalMeetingThreshold: totalMeetingThreshold ?? 0,
        countByStatus,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        feeSavings: Math.round(feeSavings * 100) / 100,
        avgTimeToSell,
        pendingRemovals: pendingRemovals ?? 0,
      },
    });
  } catch (error) {
    console.error('[GET /api/minifigs/dashboard] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch dashboard metrics',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
