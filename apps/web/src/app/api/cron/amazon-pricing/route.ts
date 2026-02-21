/**
 * POST /api/cron/amazon-pricing
 *
 * Cron endpoint for daily Amazon pricing sync via Keepa API.
 * Replaces the SP-API approach (~45+ hours) with Keepa (~2.5 hours for 1,500 ASINs/day).
 *
 * WEEKLY REFRESH: Processes ~1,500 ASINs per day (configurable via KEEPA_DAILY_LIMIT),
 * ordered by oldest snapshot_date first. All ~8,875 ASINs refresh over ~6 days.
 *
 * RESUMABLE: This endpoint tracks progress and can be called repeatedly.
 * It will resume from where it left off until all today's ASINs are processed.
 * Returns { complete: true } when finished.
 *
 * Token rate is configurable via KEEPA_TOKENS_PER_MINUTE:
 * - EUR 49 plan:  20 tokens/min (default)
 * - EUR 129 plan: 60 tokens/min
 *
 * Recommended schedule: Daily at 4am (GCP Cloud Scheduler calls repeatedly until complete)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { KeepaArbitrageSyncService } from '@/lib/arbitrage';
import { discordService } from '@/lib/notifications';
import { jobExecutionService, noopHandle } from '@/lib/services/job-execution.service';
import type { ExecutionHandle } from '@/lib/services/job-execution.service';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes - Vercel Pro limit

const DEFAULT_USER_ID = '4b6e94b4-661c-4462-9d14-b21df7d51e5b';
const JOB_TYPE = 'pricing_sync';

/**
 * Calculate how many ASINs we can process per 5-minute invocation.
 * Keepa: 10 ASINs per request, ~1 token per ASIN, ~3s per request (rate limit wait).
 * At 20 tokens/min → ~100 ASINs/invocation. At 50 tokens/min → ~250 ASINs/invocation.
 */
function getAsinsPerInvocation(): number {
  const tokensPerMin = parseInt(process.env.KEEPA_TOKENS_PER_MINUTE ?? '20', 10);
  // In 4.5 minutes (leaving 30s buffer), we can do tokensPerMin * 4.5 tokens
  // Each 10-ASIN batch costs ~1 token per ASIN
  // Conservative: assume we get tokensPerMin * 4 tokens in the window
  return Math.floor(tokensPerMin * 4);
}

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

    console.log(
      `[Cron AmazonPricing] Starting Keepa sync - date: ${today}, cursor: ${cursorPosition}, isNewDay: ${isNewDay}`
    );

    // If already completed today, short-circuit to avoid expensive re-query
    if (!isNewDay && syncStatus?.status === 'completed') {
      console.log(`[Cron AmazonPricing] Sync already complete for ${today}`);
      return NextResponse.json({
        success: true,
        complete: true,
        message: `Sync already complete for ${today}`,
        processed: 0,
        total: syncStatus.total_items ?? 0,
      });
    }

    const asinsPerInvocation = getAsinsPerInvocation();

    // Run the Keepa sync service with cursor
    const syncService = new KeepaArbitrageSyncService(supabase);

    const result = await syncService.syncPricingBatch(DEFAULT_USER_ID, {
      offset: cursorPosition,
      limit: asinsPerInvocation,
    });

    const totalForToday = result.totalForToday;
    const newCursorPosition = cursorPosition + result.processed;
    const isComplete = newCursorPosition >= totalForToday;

    // If cursor is 0 and this is the first invocation, send start notification
    if (cursorPosition === 0 && result.processed > 0) {
      await discordService.sendSyncStatus({
        title: '🔄 Keepa Pricing Sync Started',
        message: `Daily pricing sync started (Keepa)\n${totalForToday} ASINs to refresh today (oldest first)`,
      });
    }

    // Update sync status
    const { error: updateError } = await supabase.from('arbitrage_sync_status').upsert(
      {
        user_id: DEFAULT_USER_ID,
        job_type: JOB_TYPE,
        status: isComplete ? 'completed' : 'running',
        sync_date: today,
        cursor_position: newCursorPosition,
        total_items: totalForToday,
        items_processed: newCursorPosition,
        items_failed: (isNewDay ? 0 : (syncStatus?.items_failed ?? 0)) + result.failed,
        last_run_at: new Date().toISOString(),
        last_success_at: isComplete ? new Date().toISOString() : syncStatus?.last_success_at,
        last_run_duration_ms: Date.now() - startTime,
        error_message: null,
      },
      { onConflict: 'user_id,job_type' }
    );

    if (updateError) {
      console.error('[Cron AmazonPricing] Failed to update sync status:', updateError);
    }

    const duration = Date.now() - startTime;
    const durationStr =
      duration > 60000
        ? `${Math.round(duration / 60000)} min`
        : `${Math.round(duration / 1000)} sec`;

    console.log(
      `[Cron AmazonPricing] Keepa batch complete: ${result.processed} processed, cursor now at ${newCursorPosition}/${totalForToday} (${durationStr})`
    );

    // Send completion notification if done
    if (isComplete) {
      const totalFailed = (syncStatus?.items_failed ?? 0) + result.failed;
      if (totalFailed > 0) {
        await discordService.sendSyncStatus({
          title: '⚠️ Keepa Pricing Sync Complete (with errors)',
          message: `Updated: ${newCursorPosition} ASINs\nFailed: ${totalFailed} ASINs`,
          success: false,
        });
      } else {
        await discordService.sendSyncStatus({
          title: '✅ Keepa Pricing Sync Complete',
          message: `Updated: ${newCursorPosition} ASINs (daily batch)`,
          success: true,
        });
      }
    }

    await execution.complete(
      { complete: isComplete, cursorPosition: newCursorPosition, total: totalForToday },
      200,
      result.processed,
      result.failed
    );

    return NextResponse.json({
      success: true,
      complete: isComplete,
      processed: result.processed,
      failed: result.failed,
      cursorPosition: newCursorPosition,
      total: totalForToday,
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
    await supabase.from('arbitrage_sync_status').upsert(
      {
        user_id: DEFAULT_USER_ID,
        job_type: JOB_TYPE,
        status: 'error',
        error_message: errorMsg,
        last_run_at: new Date().toISOString(),
        last_run_duration_ms: duration,
      },
      { onConflict: 'user_id,job_type' }
    );

    // Send failure notification
    await discordService.sendAlert({
      title: '🔴 Keepa Pricing Sync Failed',
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
