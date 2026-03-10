/**
 * POST /api/cron/amazon-pricing
 *
 * Cron endpoint for Amazon pricing sync via Keepa API.
 *
 * BUDGET-SPREAD STRATEGY:
 * Called every 30 minutes by Cloud Scheduler. Each invocation processes
 * a small budget of ASINs (~57), prioritising in-stock items for same-day
 * freshness. Non-in-stock items refresh over a 3-4 day cycle.
 *
 * Each call is self-contained (no cursor/resume needed) — it picks the
 * highest-priority ASINs, syncs them, and returns.
 *
 * Returns { complete: true } always so the GCP driver exits after one call.
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

/** Alert if zero-progress invocations exceed this threshold */
const ZERO_PROGRESS_ALERT_THRESHOLD = 3;

export async function POST(request: NextRequest) {
  const startTime = Date.now();

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

    // Get current sync status
    const { data: syncStatus } = await supabase
      .from('arbitrage_sync_status')
      .select('*')
      .eq('user_id', DEFAULT_USER_ID)
      .eq('job_type', JOB_TYPE)
      .single();

    // Run the Keepa sync service
    const syncService = new KeepaArbitrageSyncService(supabase);

    const result = await syncService.syncPricingBatch(DEFAULT_USER_ID, {
      maxDurationMs: maxDuration * 1000,
      startTime,
    });

    const duration = Date.now() - startTime;
    const durationStr =
      duration > 60000
        ? `${Math.round(duration / 60000)} min`
        : `${Math.round(duration / 1000)} sec`;

    console.log(
      `[Cron AmazonPricing] Batch done: ${result.processed} processed (${result.inStockSynced} in-stock, ${result.staleSynced} stale), ${result.failed} failed (${durationStr})`
    );

    // Track zero-progress for stuck detection
    const prevZeroCount = syncStatus?.zero_progress_count ?? 0;
    const zeroProgressCount = result.processed === 0 ? prevZeroCount + 1 : 0;

    // Update sync status
    const today = new Date().toISOString().split('T')[0];
    const { error: updateError } = await supabase.from('arbitrage_sync_status').upsert(
      {
        user_id: DEFAULT_USER_ID,
        job_type: JOB_TYPE,
        status: result.rateLimited ? 'rate_limited' : 'completed',
        sync_date: today,
        cursor_position: 0, // No cursor needed — budget-based
        total_items: result.processed,
        items_processed: result.processed,
        items_failed: result.failed,
        last_run_at: new Date().toISOString(),
        last_success_at: result.processed > 0 ? new Date().toISOString() : syncStatus?.last_success_at,
        last_run_duration_ms: duration,
        error_message: result.rateLimited ? 'Rate limited by Keepa' : null,
        zero_progress_count: zeroProgressCount,
      },
      { onConflict: 'user_id,job_type' }
    );

    if (updateError) {
      console.error('[Cron AmazonPricing] Failed to update sync status:', updateError);
    }

    // Stuck detection: alert if consecutive zero-progress invocations
    if (zeroProgressCount >= ZERO_PROGRESS_ALERT_THRESHOLD) {
      await discordService.sendAlert({
        title: '⚠️ Keepa Pricing Sync Stalled',
        message: `${zeroProgressCount} consecutive invocations with 0 ASINs processed.\nLast success: ${syncStatus?.last_success_at ?? 'never'}\n${result.rateLimited ? 'Reason: Keepa rate limited' : 'Check KEEPA_API_KEY and token budget.'}`,
        priority: 'high',
      });
    }

    // Rate limit alert (first occurrence)
    if (result.rateLimited && prevZeroCount === 0) {
      await discordService.sendSyncStatus({
        title: '⚡ Keepa Pricing Sync — Rate Limited',
        message: `Processed ${result.processed} ASINs before hitting Keepa rate limit.\nWill resume next invocation.`,
        success: false,
      });
    }

    // Log in-stock remaining for visibility
    if (result.inStockRemaining > 0 && result.processed > 0) {
      console.log(
        `[Cron AmazonPricing] ${result.inStockRemaining} in-stock ASINs still need refresh today`
      );
    }

    await execution.complete(
      {
        processed: result.processed,
        inStockSynced: result.inStockSynced,
        staleSynced: result.staleSynced,
        inStockRemaining: result.inStockRemaining,
        rateLimited: result.rateLimited,
      },
      200,
      result.processed,
      result.failed
    );

    return NextResponse.json({
      success: true,
      complete: true, // Always true — each invocation is self-contained
      processed: result.processed,
      failed: result.failed,
      inStockSynced: result.inStockSynced,
      staleSynced: result.staleSynced,
      inStockRemaining: result.inStockRemaining,
      rateLimited: result.rateLimited,
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
        complete: true, // Still true so the driver doesn't retry into the same error
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
