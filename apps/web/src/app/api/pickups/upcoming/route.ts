import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/pickups/upcoming
 * Get upcoming pickups for the next 7 days
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
    const startDate = today.toISOString().split('T')[0];

    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);
    const endDate = nextWeek.toISOString().split('T')[0];

    const { data: pickups, error } = await supabase
      .from('stock_pickups')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'scheduled')
      .gte('scheduled_date', startDate)
      .lte('scheduled_date', endDate)
      .order('scheduled_date', { ascending: true })
      .order('scheduled_time', { ascending: true });

    if (error) {
      console.error('[GET /api/pickups/upcoming] Error:', error);
      return NextResponse.json({ error: 'Failed to fetch upcoming pickups' }, { status: 500 });
    }

    return NextResponse.json({ pickups: pickups || [] });
  } catch (error) {
    console.error('[GET /api/pickups/upcoming] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
