import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/time-tracking/current
 * Returns the currently active time entry (if any)
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

    // Find active entry (no ended_at)
    const { data: entry, error } = await supabase
      .from('time_entries')
      .select('*')
      .eq('user_id', user.id)
      .is('ended_at', null)
      .single();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = no rows returned, which is fine
      console.error('[GET /api/time-tracking/current] Error:', error);
      return NextResponse.json({ error: 'Failed to fetch current entry' }, { status: 500 });
    }

    if (!entry) {
      return NextResponse.json({ entry: null });
    }

    // Calculate elapsed seconds
    const startedAt = new Date(entry.started_at);
    const now = new Date();
    let elapsedSeconds = Math.floor((now.getTime() - startedAt.getTime()) / 1000);

    // Subtract paused duration
    elapsedSeconds -= entry.paused_duration_seconds || 0;

    // If currently paused, we need to account for the current pause
    if (entry.is_paused) {
      // The paused_duration_seconds already includes paused time up to when pause was triggered
      // No additional calculation needed
    }

    return NextResponse.json({
      entry: {
        id: entry.id,
        category: entry.category,
        startedAt: entry.started_at,
        elapsedSeconds: Math.max(0, elapsedSeconds),
        isPaused: entry.is_paused,
        pausedDurationSeconds: entry.paused_duration_seconds || 0,
      },
    });
  } catch (error) {
    console.error('[GET /api/time-tracking/current] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
