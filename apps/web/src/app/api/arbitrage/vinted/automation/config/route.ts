/**
 * GET /api/arbitrage/vinted/automation/config
 *
 * Returns scanner configuration for the Windows tray application.
 * Includes version numbers for change detection.
 *
 * AUTH1: Validates X-Api-Key header
 * CFG1-CFG3: Returns config with versions
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { withApiKeyAuth } from '@/lib/middleware/vinted-api-auth';
import type { ConfigResponse } from '@/types/vinted-automation';

export async function GET(request: NextRequest): Promise<NextResponse<ConfigResponse | { error: string }>> {
  return withApiKeyAuth<ConfigResponse>(request, async (userId) => {
    try {
      // Use service role client since API key auth bypasses RLS
      const supabase = createServiceRoleClient();

      const { data: config, error } = await supabase
        .from('vinted_scanner_config')
        .select(
          `
          enabled,
          paused,
          pause_reason,
          broad_sweep_cog_threshold,
          watchlist_cog_threshold,
          near_miss_threshold,
          operating_hours_start,
          operating_hours_end,
          config_version,
          schedule_version,
          recovery_mode,
          recovery_rate_percent,
          captcha_detected_at,
          captcha_count_30d
        `
        )
        .eq('user_id', userId)
        .single();

      if (error || !config) {
        return NextResponse.json({ error: 'Config not found' }, { status: 404 });
      }

      // Query today's scan counts from scan log
      const today = new Date().toISOString().split('T')[0];
      const { data: scanStats } = await supabase
        .from('vinted_scan_log')
        .select('listings_found, opportunities_found')
        .eq('user_id', userId)
        .gte('started_at', `${today}T00:00:00Z`)
        .lt('started_at', `${today}T23:59:59Z`);

      const scansToday = scanStats?.length ?? 0;
      // Use actual opportunities (listings that meet COG threshold), not raw listings
      const opportunitiesToday = scanStats?.reduce((sum, s) => sum + (s.opportunities_found ?? 0), 0) ?? 0;

      const response: ConfigResponse = {
        enabled: config.enabled,
        paused: config.paused,
        pauseReason: config.pause_reason || undefined,
        broadSweepCogThreshold: config.broad_sweep_cog_threshold,
        watchlistCogThreshold: config.watchlist_cog_threshold,
        nearMissThreshold: config.near_miss_threshold,
        operatingHoursStart: config.operating_hours_start as string,
        operatingHoursEnd: config.operating_hours_end as string,
        configVersion: config.config_version ?? 1,
        scheduleVersion: config.schedule_version ?? 1,
        // Recovery mode info
        recoveryMode: config.recovery_mode ?? false,
        recoveryRatePercent: config.recovery_rate_percent ?? 100,
        captchaDetectedAt: config.captcha_detected_at ?? undefined,
        captchaCount30d: config.captcha_count_30d ?? 0,
        // Today's counts (for scanner to restore state on restart)
        scansToday,
        opportunitiesToday,
      };

      return NextResponse.json(response);
    } catch (error) {
      console.error('[GET /api/arbitrage/vinted/automation/config] Error:', error);
      return NextResponse.json({ error: 'Failed to fetch config' }, { status: 500 });
    }
  });
}
