import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/pickups/stats
 * Get pickup statistics
 */
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

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    // Calculate week boundaries (Monday to Sunday)
    const dayOfWeek = today.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(today);
    monday.setDate(today.getDate() + mondayOffset);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const weekStart = monday.toISOString().split('T')[0];
    const weekEnd = sunday.toISOString().split('T')[0];

    // Calculate month boundaries
    const monthStart = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}-01`;
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const monthEnd = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${lastDay}`;

    // Fetch all stats in parallel
    const [upcomingResult, thisWeekResult, completedResult] = await Promise.all([
      // Upcoming pickups (scheduled, from today onwards)
      supabase
        .from('stock_pickups')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'scheduled')
        .gte('scheduled_date', todayStr),

      // Pickups this week (scheduled)
      supabase
        .from('stock_pickups')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'scheduled')
        .gte('scheduled_date', weekStart)
        .lte('scheduled_date', weekEnd),

      // Completed pickups this month with total value
      supabase
        .from('stock_pickups')
        .select('final_amount_paid')
        .eq('user_id', user.id)
        .eq('status', 'completed')
        .gte('completed_at', monthStart)
        .lte('completed_at', monthEnd + 'T23:59:59'),
    ]);

    const completedThisMonth = completedResult.data?.length ?? 0;
    const totalValueThisMonth =
      completedResult.data?.reduce((sum, pickup) => sum + (pickup.final_amount_paid || 0), 0) ?? 0;

    return NextResponse.json({
      upcoming: upcomingResult.count ?? 0,
      thisWeek: thisWeekResult.count ?? 0,
      completedThisMonth,
      totalValueThisMonth,
    });
  } catch (error) {
    console.error('[GET /api/pickups/stats] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
