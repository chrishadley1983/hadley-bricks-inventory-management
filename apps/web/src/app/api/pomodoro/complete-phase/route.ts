import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';

/**
 * POST /api/pomodoro/complete-phase
 * Transition from work→break or break→completed
 */
export async function POST() {
  try {
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    // Find active session
    const { data: session, error: findError } = await supabase
      .from('pomodoro_sessions')
      .select('*')
      .eq('user_id', user.id)
      .in('status', ['work', 'break'])
      .limit(1)
      .maybeSingle();

    if (findError) {
      console.error('[POST /api/pomodoro/complete-phase] Error:', findError);
      return NextResponse.json({ error: 'Failed to find session' }, { status: 500 });
    }

    if (!session) {
      return NextResponse.json({ error: 'No active session to complete' }, { status: 400 });
    }

    const now = new Date().toISOString();
    let updateData: Record<string, unknown>;

    if (session.status === 'work') {
      // Transition to break
      updateData = {
        work_completed_at: now,
        status: 'break',
        updated_at: now,
      };
    } else {
      // Break complete - session finished
      updateData = {
        break_completed_at: now,
        status: 'completed',
        updated_at: now,
      };
    }

    const { data: updatedSession, error: updateError } = await supabase
      .from('pomodoro_sessions')
      .update(updateData)
      .eq('id', session.id)
      .select()
      .single();

    if (updateError) {
      console.error('[POST /api/pomodoro/complete-phase] Error:', updateError);
      return NextResponse.json({ error: 'Failed to complete phase' }, { status: 500 });
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
    console.error('[POST /api/pomodoro/complete-phase] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
