/**
 * POST /api/cron/amazon-pricing
 *
 * Cron endpoint for daily Amazon pricing sync (seeded ASINs).
 * This runs the slow getCompetitiveSummary API with 30-second rate limits.
 *
 * RESUMABLE: This endpoint tracks progress and can be called repeatedly.
 * It will resume from where it left off until all ASINs are processed.
 * Returns { complete: true } when finished.
 *
 * Syncs pricing data for:
 * - All tracked ASINs (from Amazon inventory)
 * - All seeded ASINs with include_in_sync = true
 *
 * Recommended schedule: Daily at 4am (GitHub Actions calls repeatedly until complete)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { AmazonArbitrageSyncService } from '@/lib/arbitrage';
import { discordService } from '@/lib/notifications';
import { jobExecutionService, noopHandle } from '@/lib/services/job-execution.service';
import type { ExecutionHandle } from '@/lib/services/job-execution.service';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes - Vercel Pro limit

const DEFAULT_USER_ID = '4b6e94b4-661c-4462-9d14-b21df7d51e5b';
const JOB_TYPE = 'pricing_sync';
const BATCH_SIZE = 20; // ASINs per API call
const BATCHES_PER_INVOCATION = 4; // Process ~4 batches per invocation (~2 min with 30s delays)

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const today = new Date().toISOString().split('T')[0];

  let execution: ExecutionHandle = noopHandle;
  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      console.warn('[Cron AmazonPricing] Unauthorized request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    execution = await jobExecutionService.start('amazon-pricing', 'cron');

    const supabase = createServiceRoleClient();

    // Get or create sync status for this job
    const { data: syncStatus } = await supabase
      .from('arbitrage_sync_status')
      .select('*')
      .eq('user_id', DEFAULT_USER_ID)
      .eq('job_type', JOB_TYPE)
      .single();

    // Check if this is a new day - reset cursor if so
    const currentSyncDate = syncStatus?.sync_date;
    const isNewDay = currentSyncDate !== today;
    const cursorPosition = isNewDay ? 0 : (syncStatus?.cursor_position ?? 0);

    console.log(`[Cron AmazonPricing] Starting sync - date: ${today}, cursor: ${cursorPosition}, isNewDay: ${isNewDay}`);

    // Get count of ASINs to sync
    const { count: seededCount } = await supabase
      .from('user_seeded_asin_preferences')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', DEFAULT_USER_ID)
      .eq('include_in_sync', true)
      .eq('user_status', 'active');

    const { count: trackedCount } = await supabase
      .from('tracked_asins')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', DEFAULT_USER_ID)
      .eq('status', 'active');

    const totalAsins = (seededCount ?? 0) + (trackedCount ?? 0);

    // If cursor is 0 and it's a new sync, send start notification
    if (cursorPosition === 0) {
      console.log(`[Cron AmazonPricing] Starting new sync - ${totalAsins} ASINs to process`);
      await discordService.sendSyncStatus({
        title: '🔄 Amazon Pricing Sync Started',
        message: `Daily pricing sync started\n${totalAsins} ASINs to process`,
      });

      // Update status to running
      const { error: upsertError } = await supabase
        .from('arbitrage_sync_status')
        .upsert({
          user_id: DEFAULT_USER_ID,
          job_type: JOB_TYPE,
          status: 'running',
          sync_date: today,
          cursor_position: 0,
          total_items: totalAsins,
          items_processed: 0,
          items_failed: 0,
          last_run_at: new Date().toISOString(),
          error_message: null,
        }, { onConflict: 'user_id,job_type' });

      if (upsertError) {
        console.error('[Cron AmazonPricing] Failed to create sync status:', upsertError);
        throw new Error(`Failed to create sync status: ${upsertError.message}`);
      }
    }

    // If cursor position >= totalAsins, sync is already complete for today
    if (cursorPosition >= totalAsins) {
      console.log(`[Cron AmazonPricing] Sync already complete for ${today}`);
      return NextResponse.json({
        success: true,
        complete: true,
        message: `Sync already complete for ${today}`,
        processed: totalAsins,
        total: totalAsins,
      });
    }

    // Run the sync service with cursor
    const syncService = new AmazonArbitrageSyncService(supabase);

    const result = await syncService.syncPricingBatch(
      DEFAULT_USER_ID,
      {
        includeSeeded: true,
        offset: cursorPosition,
        limit: BATCHES_PER_INVOCATION * BATCH_SIZE,
      }
    );

    const newCursorPosition = cursorPosition + result.processed;
    const isComplete = newCursorPosition >= totalAsins;

    // Update sync status
    const { error: updateError } = await supabase
      .from('arbitrage_sync_status')
      .upsert({
        user_id: DEFAULT_USER_ID,
        job_type: JOB_TYPE,
        status: isComplete ? 'completed' : 'running',
        sync_date: today,
        cursor_position: newCursorPosition,
        total_items: totalAsins,
        items_processed: newCursorPosition,
        items_failed: (syncStatus?.items_failed ?? 0) + result.failed,
        last_run_at: new Date().toISOString(),
        last_success_at: isComplete ? new Date().toISOString() : syncStatus?.last_success_at,
        last_run_duration_ms: Date.now() - startTime,
      }, { onConflict: 'user_id,job_type' });

    if (updateError) {
      console.error('[Cron AmazonPricing] Failed to update sync status:', updateError);
    }

    const duration = Date.now() - startTime;
    const durationStr = duration > 60000
      ? `${Math.round(duration / 60000)} min`
      : `${Math.round(duration / 1000)} sec`;

    console.log(`[Cron AmazonPricing] Batch complete: ${result.processed} processed, cursor now at ${newCursorPosition}/${totalAsins} (${durationStr})`);

    // Send completion notification if done
    if (isComplete) {
      const totalFailed = (syncStatus?.items_failed ?? 0) + result.failed;
      if (totalFailed > 0) {
        await discordService.sendSyncStatus({
          title: '⚠️ Amazon Pricing Sync Complete (with errors)',
          message: `Updated: ${newCursorPosition} ASINs\nFailed: ${totalFailed} ASINs`,
          success: false,
        });
      } else {
        await discordService.sendSyncStatus({
          title: '✅ Amazon Pricing Sync Complete',
          message: `Updated: ${newCursorPosition} ASINs`,
          success: true,
        });
      }
    }

    await execution.complete({ complete: isComplete, cursorPosition: newCursorPosition, total: totalAsins }, 200, result.processed, result.failed);

    return NextResponse.json({
      success: true,
      complete: isComplete,
      processed: result.processed,
      failed: result.failed,
      cursorPosition: newCursorPosition,
      total: totalAsins,
      duration,
      durationStr,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';

    console.error('[Cron AmazonPricing] Error:', error);
    await execution.fail(error, 500);

    // Update status with error
    const supabase = createServiceRoleClient();
    await supabase
      .from('arbitrage_sync_status')
      .upsert({
        user_id: DEFAULT_USER_ID,
        job_type: JOB_TYPE,
        status: 'error',
        error_message: errorMsg,
        last_run_at: new Date().toISOString(),
        last_run_duration_ms: duration,
      }, { onConflict: 'user_id,job_type' });

    // Send failure notification
    await discordService.sendAlert({
      title: '🔴 Amazon Pricing Sync Failed',
      message: `Error: ${errorMsg}\nDuration: ${Math.round(duration / 1000)}s`,
      priority: 'high',
    });

    return NextResponse.json(
      {
        error: errorMsg,
        complete: false,
        duration,
      },
      { status: 500 }
    );
  }
}

// Also support GET for manual testing (requires same auth)
export async function GET(request: NextRequest) {
  return POST(request);
}
