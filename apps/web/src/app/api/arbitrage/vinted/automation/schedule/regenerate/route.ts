/**
 * POST /api/arbitrage/vinted/automation/schedule/regenerate
 *
 * Regenerates the schedule starting from NOW for late starts.
 * Creates a fresh schedule from current time until end of operating hours.
 *
 * Query params:
 *   startInMinutes - How many minutes from now to start (default 2)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  VintedScheduleService,
  type ScheduleResponse,
} from '@/lib/services/vinted-schedule.service';

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

    // Parse query params
    const { searchParams } = new URL(request.url);
    const startInMinutes = parseInt(searchParams.get('startInMinutes') || '2', 10);

    const scheduleService = new VintedScheduleService(supabase);
    const schedule = await scheduleService.regenerateFromNow(user.id, startInMinutes);

    console.log(
      `[POST /api/arbitrage/vinted/automation/schedule/regenerate] Generated ${schedule.scans.length} scans starting in ${startInMinutes} minutes`
    );

    return NextResponse.json(schedule);
  } catch (error) {
    console.error('[POST /api/arbitrage/vinted/automation/schedule/regenerate] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to regenerate schedule' },
      { status: 500 }
    );
  }
}
