/**
 * POST /api/cron/amazon-pricing
 *
 * Cron endpoint for daily Amazon pricing sync (seeded ASINs).
 * This runs the slow getCompetitiveSummary API with 30-second rate limits.
 *
 * Syncs pricing data for:
 * - All tracked ASINs (from Amazon inventory)
 * - All seeded ASINs with include_in_sync = true
 *
 * Recommended schedule: Daily at 4am
 * Vercel cron expression: "0 4 * * *"
 *
 * Expected duration: ~2.6 hours for 6,296 ASINs (at 30 sec/batch of 20)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { AmazonArbitrageSyncService } from '@/lib/arbitrage';
import { pushoverService } from '@/lib/notifications';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes - Vercel limit

// Note: This job will take much longer than 5 minutes for large datasets.
// It will be interrupted by Vercel's timeout, but progress is saved incrementally.
// The job should be called repeatedly (e.g., every 5 min) until complete.

const DEFAULT_USER_ID = '4b6e94b4-661c-4462-9d14-b21df7d51e5b';

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const jobId = `amz-pricing-${Date.now()}`;

  try {
    // Verify cron secret (Vercel adds Authorization header for cron jobs)
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      console.warn('[Cron AmazonPricing] Unauthorized request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log(`[Cron AmazonPricing] Starting pricing sync (job: ${jobId})`);

    // Send start notification
    await pushoverService.send({
      title: '🔄 Amazon Pricing Sync Started',
      message: `Daily pricing sync started at ${new Date().toLocaleTimeString('en-GB')}`,
      priority: -1, // Low priority - silent
    });

    // Use service role client
    const supabase = createServiceRoleClient();

    // Get count of ASINs to sync for progress tracking
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
    console.log(`[Cron AmazonPricing] Total ASINs to sync: ${totalAsins} (${seededCount} seeded, ${trackedCount} tracked)`);

    // Run the sync service
    const syncService = new AmazonArbitrageSyncService(supabase);

    let lastProgress = 0;
    const result = await syncService.syncPricing(
      DEFAULT_USER_ID,
      { includeSeeded: true },
      (processed, total) => {
        // Log progress every 100 ASINs
        if (processed - lastProgress >= 100) {
          const percent = total > 0 ? Math.round((processed / total) * 100) : 0;
          console.log(`[Cron AmazonPricing] Progress: ${processed}/${total} (${percent}%)`);
          lastProgress = processed;
        }
      }
    );

    const duration = Date.now() - startTime;
    const durationStr = duration > 60000
      ? `${Math.round(duration / 60000)} min`
      : `${Math.round(duration / 1000)} sec`;

    console.log(`[Cron AmazonPricing] Complete: ${result.updated} updated, ${result.failed} failed (${durationStr})`);

    // Send completion notification
    if (result.failed > 0) {
      await pushoverService.send({
        title: '⚠️ Amazon Pricing Sync Complete (with errors)',
        message:
          `Updated: ${result.updated} ASINs\n` +
          `Failed: ${result.failed} ASINs\n` +
          `Duration: ${durationStr}`,
        priority: 0,
        sound: 'falling',
      });
    } else {
      await pushoverService.send({
        title: '✅ Amazon Pricing Sync Complete',
        message:
          `Updated: ${result.updated} ASINs\n` +
          `Duration: ${durationStr}`,
        priority: -1, // Low priority - silent
      });
    }

    return NextResponse.json({
      success: true,
      jobId,
      updated: result.updated,
      failed: result.failed,
      total: result.total,
      duration,
      durationStr,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';

    console.error('[Cron AmazonPricing] Error:', error);

    // Send failure notification
    await pushoverService.send({
      title: '🔴 Amazon Pricing Sync Failed',
      message: `Error: ${errorMsg}\nDuration: ${Math.round(duration / 1000)}s`,
      priority: 1, // High priority
      sound: 'siren',
    });

    return NextResponse.json(
      {
        error: errorMsg,
        jobId,
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
