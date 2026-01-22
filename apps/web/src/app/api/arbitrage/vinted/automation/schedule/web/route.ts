/**
 * GET /api/arbitrage/vinted/automation/schedule/web
 *
 * Web-accessible schedule endpoint (uses session auth instead of API key)
 * Returns the daily scan schedule for display in the UI
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { VintedScheduleService, ScheduleResponse } from '@/lib/services/vinted-schedule.service';

export async function GET(
  request: NextRequest
): Promise<NextResponse<ScheduleResponse | { error: string }>> {
  const supabase = await createClient();

  // Check auth
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Parse query params
    const searchParams = request.nextUrl.searchParams;
    const dateStr = searchParams.get('date');

    // Parse date if provided
    let targetDate: Date | undefined;
    if (dateStr) {
      targetDate = new Date(dateStr);
      if (isNaN(targetDate.getTime())) {
        return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
      }
    }

    // Generate schedule - use service role client to bypass RLS
    const serviceClient = createServiceRoleClient();
    const scheduleService = new VintedScheduleService(serviceClient);

    // Update recovery rate if needed (auto-ramps after CAPTCHA)
    await scheduleService.updateRecoveryRate(user.id);

    const schedule = await scheduleService.generateSchedule(user.id, targetDate);

    return NextResponse.json(schedule);
  } catch (error) {
    console.error('[GET /api/arbitrage/vinted/automation/schedule/web] Error:', error);

    if (error instanceof Error && error.message.includes('config not found')) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    return NextResponse.json({ error: 'Failed to generate schedule' }, { status: 500 });
  }
}
