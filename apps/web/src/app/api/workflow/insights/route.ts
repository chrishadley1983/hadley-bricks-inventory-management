import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/workflow/insights
 * Get weekly insights for the workflow dashboard
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const weekOffset = parseInt(searchParams.get('weekOffset') || '0', 10);

    // Calculate week boundaries
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayOfWeek = today.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

    // Calculate the start of the requested week
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() + mondayOffset - (weekOffset * 7));
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);

    // Previous week for comparison
    const prevWeekStart = new Date(weekStart);
    prevWeekStart.setDate(prevWeekStart.getDate() - 7);
    const prevWeekEnd = new Date(prevWeekStart);
    prevWeekEnd.setDate(prevWeekStart.getDate() + 6);

    const weekStartStr = weekStart.toISOString().split('T')[0];
    const weekEndStr = weekEnd.toISOString().split('T')[0];
    const prevWeekStartStr = prevWeekStart.toISOString().split('T')[0];
    const prevWeekEndStr = prevWeekEnd.toISOString().split('T')[0];

    // Fetch all data in parallel
    const [
      timeEntriesResult,
      prevTimeEntriesResult,
      pomodoroResult,
      listingsResult,
      ordersResult,
      pickupsResult,
    ] = await Promise.all([
      // Time entries for current week
      supabase
        .from('time_entries')
        .select('duration_seconds, category, started_at')
        .eq('user_id', user.id)
        .gte('started_at', weekStartStr)
        .lte('started_at', weekEndStr + 'T23:59:59')
        .not('duration_seconds', 'is', null),

      // Time entries for previous week (for trend)
      supabase
        .from('time_entries')
        .select('duration_seconds')
        .eq('user_id', user.id)
        .gte('started_at', prevWeekStartStr)
        .lte('started_at', prevWeekEndStr + 'T23:59:59')
        .not('duration_seconds', 'is', null),

      // Pomodoro sessions for current week
      supabase
        .from('pomodoro_sessions')
        .select('status, started_at')
        .eq('user_id', user.id)
        .eq('status', 'completed')
        .gte('started_at', weekStartStr)
        .lte('started_at', weekEndStr + 'T23:59:59'),

      // Listings created this week
      supabase
        .from('inventory_items')
        .select('listing_value, status, created_at')
        .eq('user_id', user.id)
        .gte('created_at', weekStartStr)
        .lte('created_at', weekEndStr + 'T23:59:59'),

      // Orders (sold) this week
      supabase
        .from('platform_orders')
        .select('total, order_date')
        .eq('user_id', user.id)
        .gte('order_date', weekStartStr)
        .lte('order_date', weekEndStr + 'T23:59:59'),

      // Completed pickups this week
      supabase
        .from('stock_pickups')
        .select('final_amount_paid, mileage, completed_at')
        .eq('user_id', user.id)
        .eq('status', 'completed')
        .gte('completed_at', weekStartStr)
        .lte('completed_at', weekEndStr + 'T23:59:59'),
    ]);

    // Process time tracking data
    const timeEntries = timeEntriesResult.data || [];
    const prevTimeEntries = prevTimeEntriesResult.data || [];

    const totalMinutes = timeEntries.reduce(
      (sum, entry) => sum + (entry.duration_seconds || 0) / 60,
      0
    );
    const prevTotalMinutes = prevTimeEntries.reduce(
      (sum, entry) => sum + (entry.duration_seconds || 0) / 60,
      0
    );

    // Group by category
    const categoryMinutes: Record<string, number> = {};
    timeEntries.forEach((entry) => {
      const category = entry.category || 'other';
      categoryMinutes[category] = (categoryMinutes[category] || 0) + (entry.duration_seconds || 0) / 60;
    });

    // Category colors (match the default config)
    const categoryColors: Record<string, string> = {
      sourcing: '#3B82F6',
      listing: '#10B981',
      shipping: '#F59E0B',
      admin: '#8B5CF6',
      sorting: '#EC4899',
      other: '#6B7280',
    };

    const byCategory = Object.entries(categoryMinutes).map(([name, minutes]) => ({
      name,
      minutes: Math.round(minutes),
      color: categoryColors[name] || '#6B7280',
    }));

    // Calculate time trend
    const timeTrend =
      prevTotalMinutes > 0
        ? Math.round(((totalMinutes - prevTotalMinutes) / prevTotalMinutes) * 100)
        : totalMinutes > 0
          ? 100
          : 0;

    // Process pomodoro data
    const pomodoroSessions = pomodoroResult.data || [];
    const pomodoroCompleted = pomodoroSessions.length;

    // Calculate streak (consecutive days with completed pomodoros)
    const daysWithPomodoro = new Set<string>();
    pomodoroSessions.forEach((session) => {
      if (session.started_at) {
        daysWithPomodoro.add(session.started_at.split('T')[0]);
      }
    });
    const streak = daysWithPomodoro.size;

    // Get daily target from config
    const { data: config } = await supabase
      .from('workflow_config')
      .select('pomodoro_daily_target')
      .eq('user_id', user.id)
      .single();

    const pomodoroTarget = (config?.pomodoro_daily_target || 4) * 7; // Weekly target

    // Process listings data
    const listings = listingsResult.data || [];
    const listingsCreated = listings.length;
    const listedValue = listings.reduce(
      (sum, item) => sum + (item.listing_value || 0),
      0
    );

    // Process orders data
    const orders = ordersResult.data || [];
    const soldCount = orders.length;
    const soldValue = orders.reduce((sum, order) => sum + (order.total || 0), 0);

    // Process pickups data
    const pickups = pickupsResult.data || [];
    const pickupsCompleted = pickups.length;
    const totalSpent = pickups.reduce(
      (sum, pickup) => sum + (pickup.final_amount_paid || 0),
      0
    );
    const totalMileage = pickups.reduce(
      (sum, pickup) => sum + (pickup.mileage || 0),
      0
    );

    // Calculate productivity score (simplified)
    // Based on: pomodoro completion rate, time tracked consistency, listings vs target
    const pomodoroRate = pomodoroTarget > 0 ? Math.min(pomodoroCompleted / pomodoroTarget, 1) : 0;
    const timeRate = Math.min(totalMinutes / (40 * 60), 1); // Assume 40 hour week max
    const listingRate = Math.min(listingsCreated / 50, 1); // Assume 50 listings/week target

    const productivityScore = Math.round(
      ((pomodoroRate * 0.3 + timeRate * 0.4 + listingRate * 0.3) * 100)
    );

    // Find best day and most productive hour
    const dayMinutes: Record<string, number> = {};
    const hourMinutes: Record<number, number> = {};

    timeEntries.forEach((entry) => {
      if (entry.started_at) {
        const date = new Date(entry.started_at);
        const dayName = date.toLocaleDateString('en-GB', { weekday: 'long' });
        const hour = date.getHours();

        dayMinutes[dayName] = (dayMinutes[dayName] || 0) + (entry.duration_seconds || 0) / 60;
        hourMinutes[hour] = (hourMinutes[hour] || 0) + (entry.duration_seconds || 0) / 60;
      }
    });

    const bestDay =
      Object.entries(dayMinutes).sort(([, a], [, b]) => b - a)[0]?.[0] || 'Monday';

    const mostProductiveHour =
      Object.entries(hourMinutes).sort(([, a], [, b]) => b - a)[0]?.[0] || '9';

    return NextResponse.json({
      timeTracked: {
        total: Math.round(totalMinutes),
        byCategory,
        trend: timeTrend,
      },
      pomodoro: {
        completed: pomodoroCompleted,
        target: pomodoroTarget,
        streak,
        averagePerDay: Math.round((pomodoroCompleted / 7) * 10) / 10,
      },
      listings: {
        created: listingsCreated,
        sold: soldCount,
        listedValue: Math.round(listedValue * 100) / 100,
        soldValue: Math.round(soldValue * 100) / 100,
      },
      pickups: {
        completed: pickupsCompleted,
        totalSpent: Math.round(totalSpent * 100) / 100,
        mileage: Math.round(totalMileage * 10) / 10,
      },
      productivity: {
        score: productivityScore,
        bestDay,
        mostProductiveHour: parseInt(mostProductiveHour, 10),
      },
    });
  } catch (error) {
    console.error('[GET /api/workflow/insights] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
