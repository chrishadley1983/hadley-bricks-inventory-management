import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

type TimeCategory = 'Development' | 'Listing' | 'Shipping' | 'Sourcing' | 'Admin' | 'Other';

/**
 * GET /api/time-tracking/summary
 * Get daily and weekly time tracking summary by category
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

    // Get today's date in UTC
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayStartISO = todayStart.toISOString();

    // Get week start (Monday)
    const dayOfWeek = now.getDay();
    const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - daysFromMonday);
    const weekStartISO = weekStart.toISOString();

    // Initialize category totals
    const categories: TimeCategory[] = ['Development', 'Listing', 'Shipping', 'Sourcing', 'Admin', 'Other'];
    const createCategoryObject = (): Record<TimeCategory, number> => ({
      Development: 0,
      Listing: 0,
      Shipping: 0,
      Sourcing: 0,
      Admin: 0,
      Other: 0,
    });

    // Fetch today's entries
    const { data: todayEntries, error: todayError } = await supabase
      .from('time_entries')
      .select('category, duration_seconds')
      .eq('user_id', user.id)
      .gte('started_at', todayStartISO)
      .not('ended_at', 'is', null)
      .not('duration_seconds', 'is', null);

    if (todayError) {
      console.error('[GET /api/time-tracking/summary] Today entries error:', todayError);
      return NextResponse.json({ error: 'Failed to fetch today summary' }, { status: 500 });
    }

    // Fetch this week's entries
    const { data: weekEntries, error: weekError } = await supabase
      .from('time_entries')
      .select('category, duration_seconds')
      .eq('user_id', user.id)
      .gte('started_at', weekStartISO)
      .not('ended_at', 'is', null)
      .not('duration_seconds', 'is', null);

    if (weekError) {
      console.error('[GET /api/time-tracking/summary] Week entries error:', weekError);
      return NextResponse.json({ error: 'Failed to fetch week summary' }, { status: 500 });
    }

    // Calculate today's totals
    const todayByCategory = createCategoryObject();
    let todayTotal = 0;

    for (const entry of todayEntries || []) {
      const category = entry.category as TimeCategory;
      const duration = entry.duration_seconds || 0;
      if (categories.includes(category)) {
        todayByCategory[category] += duration;
      }
      todayTotal += duration;
    }

    // Calculate week totals
    const weekByCategory = createCategoryObject();
    let weekTotal = 0;

    for (const entry of weekEntries || []) {
      const category = entry.category as TimeCategory;
      const duration = entry.duration_seconds || 0;
      if (categories.includes(category)) {
        weekByCategory[category] += duration;
      }
      weekTotal += duration;
    }

    return NextResponse.json({
      today: {
        total: todayTotal,
        byCategory: todayByCategory,
      },
      week: {
        total: weekTotal,
        byCategory: weekByCategory,
      },
    });
  } catch (error) {
    console.error('[GET /api/time-tracking/summary] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
