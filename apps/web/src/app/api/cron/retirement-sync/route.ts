/**
 * POST /api/cron/retirement-sync
 *
 * Daily cron endpoint to sync retirement data from multiple sources
 * and calculate retirement status rollup for brickset_sets.
 *
 * Sources:
 * 1. Brickset - extracts retirement status from cached brickset_sets data
 * 2. Brick Tap - parses retirement predictions from Google Sheet
 *
 * Each source is processed independently. One failure doesn't block others.
 *
 * Recommended schedule: Daily at 6am UTC
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { RetirementSyncService } from '@/lib/retirement';
import { discordService } from '@/lib/notifications';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // 1. Verify cron secret
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      console.warn('[Cron RetirementSync] Unauthorized request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Run sync
    const supabase = createServiceRoleClient();
    const syncService = new RetirementSyncService(supabase);

    console.log('[Cron RetirementSync] Starting retirement data sync...');
    const result = await syncService.syncAllSources();

    // 3. Build summary
    const sourcesSummary = Object.entries(result.sources)
      .map(([name, r]) => {
        const status = r.success ? 'OK' : 'FAILED';
        return `${name}: ${status} (${r.records_upserted} records${r.error_message ? `, error: ${r.error_message}` : ''})`;
      })
      .join('\n');

    const duration = Date.now() - startTime;
    const allSuccess = Object.values(result.sources).every((r) => r.success);

    // 4. Send Discord notification
    await discordService.sendSyncStatus({
      title: allSuccess
        ? 'Retirement Sync Complete'
        : 'Retirement Sync Partial',
      message: [
        '**Sources:**',
        sourcesSummary,
        '',
        '**Rollup:**',
        `Sets updated: ${result.rollup.sets_updated}`,
        `Confirmed: ${result.rollup.confirmed} | Likely: ${result.rollup.likely} | Speculative: ${result.rollup.speculative}`,
        `Duration: ${(duration / 1000).toFixed(1)}s`,
      ].join('\n'),
      success: allSuccess,
    });

    console.log(
      `[Cron RetirementSync] Complete in ${duration}ms:`,
      JSON.stringify({ sources: result.sources, rollup: result.rollup })
    );

    return NextResponse.json({
      success: true,
      sources: result.sources,
      rollup: result.rollup,
      duration_ms: duration,
    });
  } catch (error) {
    const errorMsg =
      error instanceof Error ? error.message : 'Unknown error';
    const duration = Date.now() - startTime;

    console.error(
      `[Cron RetirementSync] Failed after ${duration}ms:`,
      error
    );

    try {
      await discordService.sendAlert({
        title: 'Retirement Sync Failed',
        message: `Error: ${errorMsg}\nDuration: ${(duration / 1000).toFixed(1)}s`,
        priority: 'high',
      });
    } catch (discordError) {
      console.error(
        '[Cron RetirementSync] Failed to send Discord alert:',
        discordError
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: errorMsg,
        duration_ms: duration,
      },
      { status: 500 }
    );
  }
}

/** Support GET for manual testing */
export async function GET(request: NextRequest) {
  return POST(request);
}
