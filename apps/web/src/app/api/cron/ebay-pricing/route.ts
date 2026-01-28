/**
 * POST /api/cron/ebay-pricing
 *
 * Cron endpoint for daily eBay pricing sync using cursor-based batching.
 * Processes up to 1,000 items per day from the arbitrage watchlist.
 *
 * RESUMABLE: This endpoint tracks progress and can be called repeatedly.
 * It will resume from where it left off until the daily limit is reached.
 * Returns { complete: true } when finished.
 *
 * Recommended schedule: Daily at 2am UTC (GitHub Actions calls repeatedly until complete)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { EbayArbitrageSyncService, ArbitrageWatchlistService } from '@/lib/arbitrage';
import { discordService } from '@/lib/notifications';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes - Vercel Pro limit

const DEFAULT_USER_ID = '4b6e94b4-661c-4462-9d14-b21df7d51e5b';
const JOB_TYPE = 'ebay_scheduled_pricing';
const DAILY_LIMIT = 1000; // Max items to sync per day
const BATCH_SIZE = 100; // Items per batch invocation

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const today = new Date().toISOString().split('T')[0];

  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      console.warn('[Cron EbayPricing] Unauthorized request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceRoleClient();
    const watchlistService = new ArbitrageWatchlistService(supabase);
    const ebayService = new EbayArbitrageSyncService(supabase);

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

    console.log(`[Cron EbayPricing] Starting sync - date: ${today}, cursor: ${cursorPosition}, isNewDay: ${isNewDay}`);

    // Get total watchlist count
    const totalWatchlist = await watchlistService.getWatchlistCount(DEFAULT_USER_ID);

    // Calculate how many items we've processed today
    const processedToday = cursorPosition;

    // If we've hit the daily limit, mark as complete
    if (processedToday >= DAILY_LIMIT) {
      console.log(`[Cron EbayPricing] Daily limit reached (${DAILY_LIMIT} items)`);
      return NextResponse.json({
        success: true,
        complete: true,
        message: `Daily limit reached (${DAILY_LIMIT} items)`,
        processedToday: DAILY_LIMIT,
        totalWatchlist,
      });
    }

    // If cursor is 0 and it's a new sync, send start notification
    if (cursorPosition === 0) {
      console.log(`[Cron EbayPricing] Starting new daily sync - ${totalWatchlist} items in watchlist, limit ${DAILY_LIMIT}`);
      await discordService.sendSyncStatus({
        title: '🔄 eBay Pricing Sync Started',
        message: `Daily pricing sync started\n${Math.min(totalWatchlist, DAILY_LIMIT)} items to process`,
      });

      // Update status to running
      await supabase
        .from('arbitrage_sync_status')
        .upsert({
          user_id: DEFAULT_USER_ID,
          job_type: JOB_TYPE,
          status: 'running',
          sync_date: today,
          cursor_position: 0,
          total_items: Math.min(totalWatchlist, DAILY_LIMIT),
          items_processed: 0,
          items_failed: 0,
          last_run_at: new Date().toISOString(),
          error_message: null,
        }, { onConflict: 'user_id,job_type' });
    }

    // Calculate how many items to process in this batch
    const remainingInLimit = DAILY_LIMIT - processedToday;
    const batchLimit = Math.min(BATCH_SIZE, remainingInLimit);

    if (batchLimit <= 0) {
      console.log(`[Cron EbayPricing] No more items to process today`);
      return NextResponse.json({
        success: true,
        complete: true,
        processedToday,
        totalWatchlist,
      });
    }

    // Run the sync service with cursor
    const result = await ebayService.syncPricingBatch(
      DEFAULT_USER_ID,
      {
        offset: cursorPosition,
        limit: batchLimit,
      }
    );

    const newCursorPosition = cursorPosition + result.processed;
    const isComplete = newCursorPosition >= DAILY_LIMIT || result.processed === 0;

    // Update sync status
    const { error: updateError } = await supabase
      .from('arbitrage_sync_status')
      .upsert({
        user_id: DEFAULT_USER_ID,
        job_type: JOB_TYPE,
        status: isComplete ? 'completed' : 'running',
        sync_date: today,
        cursor_position: newCursorPosition,
        total_items: Math.min(totalWatchlist, DAILY_LIMIT),
        items_processed: newCursorPosition,
        items_failed: (syncStatus?.items_failed ?? 0) + result.failed,
        last_run_at: new Date().toISOString(),
        last_success_at: isComplete ? new Date().toISOString() : syncStatus?.last_success_at,
        last_run_duration_ms: Date.now() - startTime,
      }, { onConflict: 'user_id,job_type' });

    if (updateError) {
      console.error('[Cron EbayPricing] Failed to update sync status:', updateError);
    }

    const duration = Date.now() - startTime;
    const durationStr = duration > 60000
      ? `${Math.round(duration / 60000)} min`
      : `${Math.round(duration / 1000)} sec`;

    console.log(`[Cron EbayPricing] Batch complete: ${result.processed} processed, cursor now at ${newCursorPosition}/${DAILY_LIMIT} (${durationStr})`);

    // Send completion notification if done for the day
    if (isComplete) {
      const totalFailed = (syncStatus?.items_failed ?? 0) + result.failed;
      if (totalFailed > 0) {
        await discordService.sendSyncStatus({
          title: '⚠️ eBay Pricing Sync Complete (with errors)',
          message: `Updated: ${newCursorPosition} sets\nFailed: ${totalFailed} sets`,
          success: false,
        });
      } else {
        await discordService.sendSyncStatus({
          title: '✅ eBay Pricing Sync Complete',
          message: `Updated: ${newCursorPosition} sets`,
          success: true,
        });
      }
    }

    return NextResponse.json({
      success: true,
      complete: isComplete,
      processed: result.processed,
      failed: result.failed,
      updated: result.updated,
      cursorPosition: newCursorPosition,
      dailyLimit: DAILY_LIMIT,
      totalWatchlist,
      duration,
      durationStr,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';

    console.error('[Cron EbayPricing] Error:', error);

    // Update status with error
    const supabase = createServiceRoleClient();
    await supabase
      .from('arbitrage_sync_status')
      .upsert({
        user_id: DEFAULT_USER_ID,
        job_type: JOB_TYPE,
        status: 'failed',
        error_message: errorMsg,
        last_run_at: new Date().toISOString(),
        last_run_duration_ms: duration,
      }, { onConflict: 'user_id,job_type' });

    // Send failure notification
    await discordService.sendAlert({
      title: '🔴 eBay Pricing Sync Failed',
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
