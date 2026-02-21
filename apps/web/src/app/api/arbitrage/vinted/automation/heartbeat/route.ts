/**
 * POST /api/arbitrage/vinted/automation/heartbeat
 *
 * Receives heartbeat from Windows tray application.
 * Updates connection status and returns version numbers for sync.
 *
 * AUTH1: Validates X-Api-Key header
 * HB1-HB5: Heartbeat handling
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { withApiKeyAuth } from '@/lib/middleware/vinted-api-auth';
import { HeartbeatRequestSchema, type HeartbeatResponse } from '@/types/vinted-automation';

export async function POST(
  request: NextRequest
): Promise<NextResponse<HeartbeatResponse | { error: string }>> {
  return withApiKeyAuth<HeartbeatResponse>(request, async (userId) => {
    try {
      const body = await request.json();
      console.log(
        '[POST /api/arbitrage/vinted/automation/heartbeat] Request body:',
        JSON.stringify(body)
      );
      const parsed = HeartbeatRequestSchema.safeParse(body);

      if (!parsed.success) {
        console.error(
          '[POST /api/arbitrage/vinted/automation/heartbeat] Validation error:',
          JSON.stringify(parsed.error.flatten())
        );
        return NextResponse.json(
          { error: 'Invalid request body', details: parsed.error.flatten() },
          { status: 400 }
        );
      }

      const heartbeat = parsed.data;
      // Use service role client since API key auth bypasses RLS
      const supabase = createServiceRoleClient();

      // Update heartbeat fields in config
      const { data: config, error: updateError } = await supabase
        .from('vinted_scanner_config')
        .update({
          last_heartbeat_at: new Date().toISOString(),
          heartbeat_machine_id: heartbeat.machineId,
          machine_name: heartbeat.machineName || heartbeat.machineId,
          heartbeat_status: heartbeat.status,
          heartbeat_scans_today: heartbeat.scansToday,
          heartbeat_opportunities_today: heartbeat.opportunitiesToday,
          last_scan_at: heartbeat.lastScanAt || null,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .select('config_version, schedule_version')
        .single();

      if (updateError) {
        console.error(
          '[POST /api/arbitrage/vinted/automation/heartbeat] Update error:',
          updateError
        );
        return NextResponse.json({ error: 'Failed to update heartbeat' }, { status: 500 });
      }

      const response: HeartbeatResponse = {
        configVersion: config?.config_version ?? 1,
        scheduleVersion: config?.schedule_version ?? 1,
        serverTime: new Date().toISOString(),
      };

      return NextResponse.json(response);
    } catch (error) {
      console.error('[POST /api/arbitrage/vinted/automation/heartbeat] Error:', error);
      return NextResponse.json({ error: 'Failed to process heartbeat' }, { status: 500 });
    }
  });
}
