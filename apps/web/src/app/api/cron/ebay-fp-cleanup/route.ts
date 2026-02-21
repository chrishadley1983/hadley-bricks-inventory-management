/**
 * POST /api/cron/ebay-fp-cleanup
 *
 * Cron endpoint for automated eBay false-positive detection and exclusion.
 * Runs daily at 4am UTC (after eBay pricing sync at 2am) to clean up
 * false positive listings (minifigs, keyrings, instructions, wrong sets, etc.)
 *
 * Scoring: 22 weighted signals, threshold 50 (items scoring 50+ excluded)
 * All items in arbitrage_current_view with eBay data are processed.
 *
 * Recommended schedule: Daily at 4am UTC
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { EbayFpDetectorService, DEFAULT_USER_ID, DEFAULT_THRESHOLD } from '@/lib/arbitrage';
import { discordService } from '@/lib/notifications';
import { jobExecutionService, noopHandle } from '@/lib/services/job-execution.service';
import type { ExecutionHandle } from '@/lib/services/job-execution.service';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes - Vercel Pro limit

const JOB_TYPE = 'ebay_fp_cleanup';

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  let execution: ExecutionHandle = noopHandle;
  try {
    // Verify cron secret (skip if not set - development mode)
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      console.warn('[Cron EbayFpCleanup] Unauthorized request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    execution = await jobExecutionService.start('ebay-fp-cleanup', 'cron');

    console.log('[Cron EbayFpCleanup] Starting false-positive cleanup job');

    const supabase = createServiceRoleClient();
    const fpDetector = new EbayFpDetectorService(supabase);

    // Update status to running
    await supabase.from('arbitrage_sync_status').upsert(
      {
        user_id: DEFAULT_USER_ID,
        job_type: JOB_TYPE,
        status: 'running',
        last_run_at: new Date().toISOString(),
        error_message: null,
      },
      { onConflict: 'user_id,job_type' }
    );

    // Run the cleanup
    const result = await fpDetector.runCleanup({
      threshold: DEFAULT_THRESHOLD,
      userId: DEFAULT_USER_ID,
    });

    const durationMs = Date.now() - startTime;
    const durationStr =
      durationMs > 60000
        ? `${Math.round(durationMs / 60000)} min`
        : `${Math.round(durationMs / 1000)} sec`;

    // Update sync status
    await supabase.from('arbitrage_sync_status').upsert(
      {
        user_id: DEFAULT_USER_ID,
        job_type: JOB_TYPE,
        status: result.success ? 'completed' : 'failed',
        last_run_at: new Date().toISOString(),
        last_success_at: result.success ? new Date().toISOString() : undefined,
        last_run_duration_ms: durationMs,
        items_processed: result.itemsScanned,
        items_failed: result.errors,
        error_message: result.success ? null : 'Cleanup failed with errors',
      },
      { onConflict: 'user_id,job_type' }
    );

    console.log(
      `[Cron EbayFpCleanup] Complete: ${result.itemsScanned} items scanned, ${result.listingsScanned} listings, ${result.itemsFlagged} flagged, ${result.itemsExcluded} excluded (${durationStr})`
    );

    // Send Discord notifications
    if (result.success) {
      // Build message with details
      let message = `Scanned: ${result.itemsScanned} items (${result.listingsScanned} listings)`;
      if (result.itemsFlagged > 0) {
        message += `\nFlagged: ${result.itemsFlagged}`;
        message += `\nExcluded: ${result.itemsExcluded}`;
        if (result.topReasons.length > 0) {
          message += `\nTop reasons: ${result.topReasons.join(', ')}`;
        }
      } else {
        message += '\nNo false positives detected';
      }
      message += `\nDuration: ${durationStr}`;

      await discordService.sendSyncStatus({
        title: '✅ eBay FP Cleanup Complete',
        message,
        success: true,
      });
    } else {
      await discordService.sendAlert({
        title: '🔴 eBay FP Cleanup Failed',
        message: `Error: ${result.errors} errors occurred\nDuration: ${durationStr}`,
        priority: 'high',
      });
    }

    await execution.complete(
      {
        itemsFlagged: result.itemsFlagged,
        itemsExcluded: result.itemsExcluded,
        topReasons: result.topReasons,
      },
      200,
      result.itemsScanned,
      result.errors
    );

    return NextResponse.json({
      success: result.success,
      itemsScanned: result.itemsScanned,
      listingsScanned: result.listingsScanned,
      itemsFlagged: result.itemsFlagged,
      itemsExcluded: result.itemsExcluded,
      errors: result.errors,
      duration: durationMs,
      durationStr,
      topReasons: result.topReasons,
    });
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';

    console.error('[Cron EbayFpCleanup] Error:', error);
    await execution.fail(error, 500);

    // Update status with error
    const supabase = createServiceRoleClient();
    await supabase.from('arbitrage_sync_status').upsert(
      {
        user_id: DEFAULT_USER_ID,
        job_type: JOB_TYPE,
        status: 'failed',
        error_message: errorMsg,
        last_run_at: new Date().toISOString(),
        last_run_duration_ms: durationMs,
      },
      { onConflict: 'user_id,job_type' }
    );

    // Send failure notification
    await discordService.sendAlert({
      title: '🔴 eBay FP Cleanup Failed',
      message: `Error: ${errorMsg}\nDuration: ${Math.round(durationMs / 1000)}s`,
      priority: 'high',
    });

    return NextResponse.json(
      {
        success: false,
        error: errorMsg,
        itemsScanned: 0,
        listingsScanned: 0,
        itemsFlagged: 0,
        itemsExcluded: 0,
        errors: 1,
        duration: durationMs,
      },
      { status: 500 }
    );
  }
}

// Also support GET for manual testing (requires same auth)
export async function GET(request: NextRequest) {
  return POST(request);
}
