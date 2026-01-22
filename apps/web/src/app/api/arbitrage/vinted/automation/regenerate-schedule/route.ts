/**
 * POST /api/arbitrage/vinted/automation/regenerate-schedule
 *
 * Regenerates the scanner schedule starting from NOW.
 * Uses session authentication (for web dashboard).
 *
 * Body:
 *   startInMinutes - How many minutes from now to start (default 2)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { VintedScheduleService, type ScheduleResponse } from '@/lib/services/vinted-schedule.service';

export async function POST(
  request: NextRequest
): Promise<NextResponse<ScheduleResponse | { error: string }>> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse body
    const body = await request.json().catch(() => ({}));
    const startInMinutes = parseInt(body.startInMinutes || '2', 10);

    const scheduleService = new VintedScheduleService(supabase);
    const schedule = await scheduleService.regenerateFromNow(user.id, startInMinutes);

    console.log(
      `[POST /api/arbitrage/vinted/automation/regenerate-schedule] Generated ${schedule.scans.length} scans starting in ${startInMinutes} minutes`
    );

    return NextResponse.json(schedule);
  } catch (error) {
    console.error('[POST /api/arbitrage/vinted/automation/regenerate-schedule] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to regenerate schedule' },
      { status: 500 }
    );
  }
}
