/**
 * GET /api/arbitrage/vinted/automation/schedule
 *
 * Returns the daily scan schedule for the Windows tray application.
 * Uses seeded random for reproducibility - same date + watchlist = same schedule.
 *
 * AUTH1: Validates X-Api-Key header
 * SCHED1-SCHED10: Schedule generation
 *
 * Query params:
 * - date: Optional ISO date string (defaults to today)
 * - remaining: If 'true', only return scans that haven't happened yet
 * - regenerate: If 'true', regenerate schedule starting from NOW (for late starts)
 * - startInMinutes: How many minutes from now to start (default 2, used with regenerate)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { withApiKeyAuth } from '@/lib/middleware/vinted-api-auth';
import { VintedScheduleService, ScheduleResponse } from '@/lib/services/vinted-schedule.service';

export async function GET(
  request: NextRequest
): Promise<NextResponse<ScheduleResponse | { error: string }>> {
  return withApiKeyAuth<ScheduleResponse>(request, async (userId) => {
    try {
      // Parse query params
      const searchParams = request.nextUrl.searchParams;
      const dateStr = searchParams.get('date');
      const remainingOnly = searchParams.get('remaining') === 'true';
      const regenerate = searchParams.get('regenerate') === 'true';
      const startInMinutes = parseInt(searchParams.get('startInMinutes') || '2', 10);

      // Parse date if provided
      let targetDate: Date | undefined;
      if (dateStr) {
        targetDate = new Date(dateStr);
        if (isNaN(targetDate.getTime())) {
          return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
        }
      }

      // Generate schedule - use service role client since API key auth bypasses RLS
      const supabase = createServiceRoleClient();
      const scheduleService = new VintedScheduleService(supabase);

      let schedule: ScheduleResponse;
      if (regenerate) {
        // Regenerate schedule starting from NOW (for late starts)
        schedule = await scheduleService.regenerateFromNow(userId, startInMinutes);
        console.log(
          `[GET /api/arbitrage/vinted/automation/schedule] Regenerated ${schedule.scans.length} scans starting in ${startInMinutes} mins`
        );
      } else if (remainingOnly) {
        schedule = await scheduleService.generateRemainingSchedule(userId);
      } else {
        schedule = await scheduleService.generateSchedule(userId, targetDate);
      }

      return NextResponse.json(schedule);
    } catch (error) {
      console.error('[GET /api/arbitrage/vinted/automation/schedule] Error:', error);

      if (error instanceof Error && error.message.includes('config not found')) {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }

      return NextResponse.json({ error: 'Failed to generate schedule' }, { status: 500 });
    }
  });
}
