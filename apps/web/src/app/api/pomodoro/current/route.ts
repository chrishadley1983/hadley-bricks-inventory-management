import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/pomodoro/current
 * Get the currently active pomodoro session
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

    // Find active session (work, break, or paused)
    const { data: session, error } = await supabase
      .from('pomodoro_sessions')
      .select('*')
      .eq('user_id', user.id)
      .in('status', ['work', 'break', 'paused'])
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[GET /api/pomodoro/current] Error:', error);
      return NextResponse.json({ error: 'Failed to fetch session' }, { status: 500 });
    }

    if (!session) {
      return NextResponse.json({
        session: null,
        remainingSeconds: 0,
        phaseEndTime: null,
      });
    }

    // Calculate remaining seconds based on phase
    const now = new Date();
    let remainingSeconds = 0;
    let phaseEndTime: Date | null = null;

    if (session.status === 'paused') {
      // When paused, calculate based on when it was paused
      const phaseStart = session.status === 'paused' && session.work_completed_at
        ? new Date(session.work_completed_at)
        : new Date(session.started_at);

      const phaseDuration = session.work_completed_at
        ? session.break_minutes * 60
        : session.work_minutes * 60;

      const pausedAt = session.paused_at ? new Date(session.paused_at) : now;
      const elapsedBeforePause = Math.floor((pausedAt.getTime() - phaseStart.getTime()) / 1000) - (session.paused_duration_seconds || 0);
      remainingSeconds = Math.max(0, phaseDuration - elapsedBeforePause);
    } else {
      const phaseStart = session.status === 'break'
        ? new Date(session.work_completed_at!)
        : new Date(session.started_at);

      const phaseDuration = session.status === 'break'
        ? session.break_minutes * 60
        : session.work_minutes * 60;

      const elapsed = Math.floor((now.getTime() - phaseStart.getTime()) / 1000) - (session.paused_duration_seconds || 0);
      remainingSeconds = Math.max(0, phaseDuration - elapsed);

      phaseEndTime = new Date(phaseStart.getTime() + (phaseDuration + (session.paused_duration_seconds || 0)) * 1000);
    }

    // Transform to camelCase
    const transformedSession = {
      id: session.id,
      userId: session.user_id,
      sessionDate: session.session_date,
      sessionNumber: session.session_number,
      mode: session.mode,
      workMinutes: session.work_minutes,
      breakMinutes: session.break_minutes,
      startedAt: session.started_at,
      workCompletedAt: session.work_completed_at,
      breakCompletedAt: session.break_completed_at,
      pausedAt: session.paused_at,
      pausedDurationSeconds: session.paused_duration_seconds || 0,
      status: session.status,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
    };

    return NextResponse.json({
      session: transformedSession,
      remainingSeconds,
      phaseEndTime: phaseEndTime?.toISOString() ?? null,
    });
  } catch (error) {
    console.error('[GET /api/pomodoro/current] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
