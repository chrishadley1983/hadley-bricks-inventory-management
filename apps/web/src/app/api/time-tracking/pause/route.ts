import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';

/**
 * POST /api/time-tracking/pause
 * Pause the current time tracking session
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
      return NextResponse.json({ error: 'No active time entry to pause' }, { status: 400 });
    }

    if (entry.is_paused) {
      return NextResponse.json({ error: 'Time entry is already paused' }, { status: 400 });
    }

    // Update entry to paused state
    // Store the current time so we can calculate paused duration when resumed
    const { data: updatedEntry, error: updateError } = await supabase
      .from('time_entries')
      .update({
        is_paused: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', entry.id)
      .select()
      .single();

    if (updateError) {
      console.error('[POST /api/time-tracking/pause] Error:', updateError);
      return NextResponse.json({ error: 'Failed to pause time tracking' }, { status: 500 });
    }

    return NextResponse.json({ entry: updatedEntry });
  } catch (error) {
    console.error('[POST /api/time-tracking/pause] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
