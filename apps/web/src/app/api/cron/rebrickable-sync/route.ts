/**
 * POST /api/cron/rebrickable-sync
 *
 * Weekly cron endpoint to sync LEGO set data from Rebrickable API into brickset_sets.
 * Inserts new sets and updates existing ones without overwriting Brickset-specific fields.
 *
 * Recommended schedule: Weekly on Sunday at 3am UTC
 *
 * Also supports GET for manual testing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { RebrickableSyncService } from '@/lib/rebrickable';
import { discordService } from '@/lib/notifications';
import { jobExecutionService, noopHandle } from '@/lib/services/job-execution.service';
import type { ExecutionHandle } from '@/lib/services/job-execution.service';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes - Vercel Pro limit

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  let execution: ExecutionHandle = noopHandle;
  try {
    // 1. Verify cron secret
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      console.warn('[Cron RebrickableSync] Unauthorized request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Verify API key exists
    const apiKey = process.env.REBRICKABLE_API_KEY;
    if (!apiKey) {
      const errorMsg = 'REBRICKABLE_API_KEY environment variable is not set';
      console.error(`[Cron RebrickableSync] ${errorMsg}`);

      await discordService.sendAlert({
        title: 'Rebrickable Sync Failed',
        message: errorMsg,
        priority: 'high',
      });

      return NextResponse.json({ error: errorMsg }, { status: 500 });
    }

    execution = await jobExecutionService.start('rebrickable-sync', 'cron');

    // 3. Run sync
    const supabase = createServiceRoleClient();
    const syncService = new RebrickableSyncService(supabase, apiKey);

    console.log('[Cron RebrickableSync] Starting full sync...');
    const result = await syncService.syncAllSets();

    // 4. Send Discord notification
    const duration = Date.now() - startTime;
    await discordService.sendSyncStatus({
      title: 'Rebrickable Sync Complete',
      message: [
        `Processed: ${result.total_processed} / ${result.total_available} sets`,
        `Inserted: ${result.inserted} new sets`,
        `Updated: ${result.updated} existing sets`,
        `Errors: ${result.errors}`,
        `Themes: ${result.theme_map_size}`,
        `Duration: ${(duration / 1000).toFixed(1)}s`,
      ].join('\n'),
      success: result.errors === 0,
    });

    console.log(`[Cron RebrickableSync] Complete in ${duration}ms:`, JSON.stringify(result));

    await execution.complete(
      { inserted: result.inserted, updated: result.updated, themes: result.theme_map_size },
      200,
      result.total_processed,
      result.errors
    );

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    const duration = Date.now() - startTime;

    console.error(`[Cron RebrickableSync] Failed after ${duration}ms:`, error);
    await execution.fail(error, 500);

    // Send Discord alert on failure
    try {
      await discordService.sendAlert({
        title: 'Rebrickable Sync Failed',
        message: `Error: ${errorMsg}\nDuration: ${(duration / 1000).toFixed(1)}s`,
        priority: 'high',
      });
    } catch (discordError) {
      console.error('[Cron RebrickableSync] Failed to send Discord alert:', discordError);
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
