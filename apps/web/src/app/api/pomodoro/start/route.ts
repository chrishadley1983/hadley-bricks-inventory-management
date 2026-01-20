import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';

const StartSchema = z.object({
  mode: z.enum(['classic', 'long', 'custom']),
  workMinutes: z.number().min(1).max(120).optional(),
  breakMinutes: z.number().min(1).max(60).optional(),
});

// Default durations per mode
const MODE_DEFAULTS = {
  classic: { work: 25, break: 5 },
  long: { work: 50, break: 10 },
  custom: { work: 25, break: 5 },
};

/**
 * POST /api/pomodoro/start
 * Start a new pomodoro session
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = StartSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { mode, workMinutes, breakMinutes } = parsed.data;

    // Check if there's already an active session
    const { data: existingSession } = await supabase
      .from('pomodoro_sessions')
      .select('id')
      .eq('user_id', user.id)
      .in('status', ['work', 'break', 'paused'])
      .limit(1)
      .maybeSingle();

    if (existingSession) {
      return NextResponse.json(
        { error: 'Session already in progress' },
        { status: 400 }
      );
    }

    // Get today's session count
    const today = new Date().toISOString().split('T')[0];
    const { count: sessionCount } = await supabase
      .from('pomodoro_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('session_date', today);

    const sessionNumber = (sessionCount || 0) + 1;

    // Get durations
    const defaults = MODE_DEFAULTS[mode];
    const finalWorkMinutes = mode === 'custom' && workMinutes ? workMinutes : defaults.work;
    const finalBreakMinutes = mode === 'custom' && breakMinutes ? breakMinutes : defaults.break;

    // Create new session
    const { data: session, error: createError } = await supabase
      .from('pomodoro_sessions')
      .insert({
        user_id: user.id,
        session_date: today,
        session_number: sessionNumber,
        mode,
        work_minutes: finalWorkMinutes,
        break_minutes: finalBreakMinutes,
        started_at: new Date().toISOString(),
        status: 'work',
      })
      .select()
      .single();

    if (createError) {
      console.error('[POST /api/pomodoro/start] Error:', createError);
      return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
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

    return NextResponse.json({ session: transformedSession }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/pomodoro/start] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
