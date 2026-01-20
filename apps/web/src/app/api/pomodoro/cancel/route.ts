import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/pomodoro/cancel
 * Cancel the current pomodoro session
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

    // Find active session (work, break, or paused)
    const { data: session, error: findError } = await supabase
      .from('pomodoro_sessions')
      .select('*')
      .eq('user_id', user.id)
      .in('status', ['work', 'break', 'paused'])
      .limit(1)
      .maybeSingle();

    if (findError) {
      console.error('[POST /api/pomodoro/cancel] Error:', findError);
      return NextResponse.json({ error: 'Failed to find session' }, { status: 500 });
    }

    if (!session) {
      return NextResponse.json(
        { error: 'No active session to cancel' },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    const { data: updatedSession, error: updateError } = await supabase
      .from('pomodoro_sessions')
      .update({
        status: 'cancelled',
        updated_at: now,
      })
      .eq('id', session.id)
      .select()
      .single();

    if (updateError) {
      console.error('[POST /api/pomodoro/cancel] Error:', updateError);
      return NextResponse.json({ error: 'Failed to cancel session' }, { status: 500 });
    }

    // Transform to camelCase
    const transformedSession = {
      id: updatedSession.id,
      userId: updatedSession.user_id,
      sessionDate: updatedSession.session_date,
      sessionNumber: updatedSession.session_number,
      mode: updatedSession.mode,
      workMinutes: updatedSession.work_minutes,
      breakMinutes: updatedSession.break_minutes,
      startedAt: updatedSession.started_at,
      workCompletedAt: updatedSession.work_completed_at,
      breakCompletedAt: updatedSession.break_completed_at,
      pausedAt: updatedSession.paused_at,
      pausedDurationSeconds: updatedSession.paused_duration_seconds || 0,
      status: updatedSession.status,
      createdAt: updatedSession.created_at,
      updatedAt: updatedSession.updated_at,
    };

    return NextResponse.json({ session: transformedSession });
  } catch (error) {
    console.error('[POST /api/pomodoro/cancel] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
