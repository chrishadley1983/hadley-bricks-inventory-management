import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/pomodoro/stats
 * Get daily completed sessions count, target, and streak
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

    const today = new Date().toISOString().split('T')[0];

    // Get today's completed sessions count
    const { count: sessionsToday, error: countError } = await supabase
      .from('pomodoro_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('session_date', today)
      .eq('status', 'completed');

    if (countError) {
      console.error('[GET /api/pomodoro/stats] Count error:', countError);
    }

    // Get daily target from workflow config
    const { data: config } = await supabase
      .from('workflow_config')
      .select('pomodoro_daily_target')
      .eq('user_id', user.id)
      .maybeSingle();

    const dailyTarget = config?.pomodoro_daily_target ?? 8;

    // Calculate streak
    // Get all dates with completed sessions, ordered by date descending
    const { data: sessionDates, error: streakError } = await supabase
      .from('pomodoro_sessions')
      .select('session_date')
      .eq('user_id', user.id)
      .eq('status', 'completed')
      .order('session_date', { ascending: false });

    if (streakError) {
      console.error('[GET /api/pomodoro/stats] Streak error:', streakError);
    }

    // Calculate streak
    let streakDays = 0;
    if (sessionDates && sessionDates.length > 0) {
      // Get unique dates
      const uniqueDates = [...new Set(sessionDates.map((s) => s.session_date))];

      // Check if today has sessions
      const yesterdayDate = new Date(today);
      yesterdayDate.setDate(yesterdayDate.getDate() - 1);
      const yesterday = yesterdayDate.toISOString().split('T')[0];

      // Start counting from today or yesterday
      let checkDate = uniqueDates[0] === today ? today : yesterday;

      // Only count streak if most recent session is today or yesterday
      if (uniqueDates[0] === today || uniqueDates[0] === yesterday) {
        for (const dateStr of uniqueDates) {
          if (dateStr === checkDate) {
            streakDays++;
            // Move to previous day
            const prevDate = new Date(checkDate);
            prevDate.setDate(prevDate.getDate() - 1);
            checkDate = prevDate.toISOString().split('T')[0];
          } else if (dateStr < checkDate) {
            // Gap in dates, streak broken
            break;
          }
        }
      }
    }

    return NextResponse.json({
      sessionsToday: sessionsToday || 0,
      dailyTarget,
      streakDays,
    });
  } catch (error) {
    console.error('[GET /api/pomodoro/stats] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
