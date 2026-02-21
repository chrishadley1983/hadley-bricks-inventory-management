import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/time-tracking/resume
 * Resume a paused time tracking session
 */
export async function POST() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Find active entry
    const { data: entry, error: findError } = await supabase
      .from('time_entries')
      .select('*')
      .eq('user_id', user.id)
      .is('ended_at', null)
      .single();

    if (findError || !entry) {
      return NextResponse.json({ error: 'No active time entry to resume' }, { status: 400 });
    }

    if (!entry.is_paused) {
      return NextResponse.json({ error: 'Time entry is not paused' }, { status: 400 });
    }

    // Calculate how long it was paused
    const pausedAt = entry.updated_at ? new Date(entry.updated_at) : new Date(entry.started_at);
    const now = new Date();
    const pausedDuration = Math.floor((now.getTime() - pausedAt.getTime()) / 1000);

    // Add to total paused duration
    const totalPausedDuration = (entry.paused_duration_seconds || 0) + pausedDuration;

    // Update entry to resumed state
    const { data: updatedEntry, error: updateError } = await supabase
      .from('time_entries')
      .update({
        is_paused: false,
        paused_duration_seconds: totalPausedDuration,
        updated_at: new Date().toISOString(),
      })
      .eq('id', entry.id)
      .select()
      .single();

    if (updateError) {
      console.error('[POST /api/time-tracking/resume] Error:', updateError);
      return NextResponse.json({ error: 'Failed to resume time tracking' }, { status: 500 });
    }

    return NextResponse.json({ entry: updatedEntry });
  } catch (error) {
    console.error('[POST /api/time-tracking/resume] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
