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

    // Run all independent queries in parallel (M2)
    const [
      { count: totalInBricqer },
      { count: totalMeetingThreshold },
      { data: statusCounts },
      { data: executedRemovals },
      { data: soldItems },
      { count: pendingRemovals },
    ] = await Promise.all([
      // Total minifigs in Bricqer inventory
      supabase
        .from('minifig_sync_items')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id),
      // Total meeting threshold
      supabase
        .from('minifig_sync_items')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('meets_threshold', true),
      // Count by status
      supabase
        .from('minifig_sync_items')
        .select('listing_status')
        .eq('user_id', user.id),
      // Revenue + fee savings (merged query)
      supabase
        .from('minifig_removal_queue')
        .select('sale_price, sold_on')
        .eq('user_id', user.id)
        .eq('status', 'EXECUTED'),
      // Average time to sell
      supabase
        .from('minifig_sync_items')
        .select('created_at, updated_at')
        .eq('user_id', user.id)
        .in('listing_status', ['SOLD_EBAY', 'SOLD_BRICQER']),
      // Pending removals count
      supabase
        .from('minifig_removal_queue')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'PENDING'),
    ]);

    const countByStatus: Record<string, number> = {};
    for (const row of statusCounts ?? []) {
      const status = row.listing_status || 'UNKNOWN';
      countByStatus[status] = (countByStatus[status] || 0) + 1;
    }

    // Calculate revenue and fee savings in a single pass
    let totalRevenue = 0;
    let feeSavings = 0;
    for (const removal of executedRemovals ?? []) {
      const price = Number(removal.sale_price) || 0;
      totalRevenue += price;
      if (removal.sold_on === 'EBAY') {
        feeSavings += price * 0.035;
      }
    }

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
        details: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : undefined,
      },
      { status: 500 },
    );
  }
}
