import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';

/**
 * POST /api/time-tracking/stop
 * Stop the current time tracking session
 */
export async function POST() {
  try {
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    // Find active entry
    const { data: entry, error: findError } = await supabase
      .from('time_entries')
      .select('*')
      .eq('user_id', user.id)
      .is('ended_at', null)
      .single();

    if (findError || !entry) {
      return NextResponse.json({ error: 'No active time entry to stop' }, { status: 400 });
    }

    // Calculate duration
    const startedAt = new Date(entry.started_at);
    const endedAt = new Date();
    let durationSeconds = Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000);

    // Subtract paused duration
    durationSeconds -= entry.paused_duration_seconds || 0;
    durationSeconds = Math.max(0, durationSeconds);

    // Update entry with end time and duration
    const { data: updatedEntry, error: updateError } = await supabase
      .from('time_entries')
      .update({
        ended_at: endedAt.toISOString(),
        duration_seconds: durationSeconds,
        is_paused: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', entry.id)
      .select()
      .single();

    if (updateError) {
      console.error('[POST /api/time-tracking/stop] Error:', updateError);
      return NextResponse.json({ error: 'Failed to stop time tracking' }, { status: 500 });
    }

    return NextResponse.json({ entry: updatedEntry });
  } catch (error) {
    console.error('[POST /api/time-tracking/stop] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
