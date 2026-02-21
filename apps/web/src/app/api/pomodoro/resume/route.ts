import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/pomodoro/resume
 * Resume a paused pomodoro session
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

    // Find paused session
    const { data: session, error: findError } = await supabase
      .from('pomodoro_sessions')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'paused')
      .limit(1)
      .maybeSingle();

    if (findError) {
      console.error('[POST /api/pomodoro/resume] Error:', findError);
      return NextResponse.json({ error: 'Failed to find session' }, { status: 500 });
    }

    if (!session) {
      return NextResponse.json({ error: 'No paused session to resume' }, { status: 400 });
    }

    // Calculate pause duration
    const pausedAt = session.paused_at ? new Date(session.paused_at) : new Date();
    const now = new Date();
    const additionalPauseDuration = Math.floor((now.getTime() - pausedAt.getTime()) / 1000);
    const totalPausedDuration = (session.paused_duration_seconds || 0) + additionalPauseDuration;

    // Determine which phase to return to
    const previousStatus = session.work_completed_at ? 'break' : 'work';

    const { data: updatedSession, error: updateError } = await supabase
      .from('pomodoro_sessions')
      .update({
        paused_at: null,
        paused_duration_seconds: totalPausedDuration,
        status: previousStatus,
        updated_at: now.toISOString(),
      })
      .eq('id', session.id)
      .select()
      .single();

    if (updateError) {
      console.error('[POST /api/pomodoro/resume] Error:', updateError);
      return NextResponse.json({ error: 'Failed to resume session' }, { status: 500 });
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
    console.error('[POST /api/pomodoro/resume] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
