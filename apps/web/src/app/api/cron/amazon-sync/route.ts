/**
 * POST /api/cron/amazon-sync
 *
 * Cron endpoint for processing two-phase Amazon sync feeds in the background.
 * This allows users to navigate away from the Amazon Sync page without
 * interrupting the two-phase sync process.
 *
 * Two-phase sync workflow:
 * 1. Submit price-only feed to Amazon
 * 2. Poll until price feed completes
 * 3. Verify price is live on Amazon (up to 30 min)
 * 4. Submit quantity feed
 * 5. Poll until quantity feed completes
 *
 * This cron job processes feeds stuck in intermediate states:
 * - price_submitted: Poll for price feed completion
 * - price_polling: Continue polling price feed
 * - price_verifying: Verify price is live, then submit quantity
 * - quantity_submitted: Poll for quantity feed completion
 * - quantity_polling: Continue polling quantity feed
 *
 * Recommended schedule: Every 1-2 minutes during business hours
 * Example: "* /2 * * * *" (every 2 minutes)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { AmazonSyncService } from '@/lib/amazon/amazon-sync.service';
import { jobExecutionService, noopHandle } from '@/lib/services/job-execution.service';
import type { ExecutionHandle } from '@/lib/services/job-execution.service';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes max

// Two-phase steps that need processing
const PROCESSABLE_STEPS = [
  'price_submitted',
  'price_polling',
  'price_verifying',
  'quantity_submitted',
  'quantity_polling',
];

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  let execution: ExecutionHandle = noopHandle;
  try {
    // Verify cron secret (Vercel adds Authorization header for cron jobs)
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      console.warn('[Cron AmazonSync] Unauthorized request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    execution = await jobExecutionService.start('amazon-sync', 'cron');

    console.log('[Cron AmazonSync] Starting two-phase sync processing');

    // Use service role client to query across all users
    const supabase = createServiceRoleClient();

    // Find all feeds that need processing (across all users)
    const { data: feeds, error: feedsError } = await supabase
      .from('amazon_sync_feeds')
      .select('id, user_id, two_phase_step, two_phase_user_email, two_phase_started_at, amazon_feed_id')
      .eq('sync_mode', 'two_phase')
      .in('two_phase_step', PROCESSABLE_STEPS)
      .order('two_phase_started_at', { ascending: true })
      .limit(10); // Process max 10 feeds per cron run to avoid timeout

    if (feedsError) {
      console.error('[Cron AmazonSync] Error fetching feeds:', feedsError);
      throw feedsError;
    }

    if (!feeds || feeds.length === 0) {
      console.log('[Cron AmazonSync] No feeds need processing');
      await execution.complete({ message: 'No feeds need processing' }, 200, 0, 0);
      return NextResponse.json({
        success: true,
        message: 'No feeds need processing',
        feedsProcessed: 0,
        duration: Date.now() - startTime,
      });
    }

    console.log(`[Cron AmazonSync] Found ${feeds.length} feed(s) to process`);

    const results: Array<{
      feedId: string;
      userId: string;
      amazonFeedId: string | null;
      previousStep: string | null;
      newStatus: string;
      isComplete: boolean;
      message: string;
      error?: string;
    }> = [];

    // Process each feed
    for (const feed of feeds) {
      try {
        console.log(
          `[Cron AmazonSync] Processing feed ${feed.id} (user: ${feed.user_id}, step: ${feed.two_phase_step})`
        );

        // Create service instance for this user
        const syncService = new AmazonSyncService(supabase, feed.user_id);

        // Process the next step
        const result = await syncService.processTwoPhaseStep(
          feed.id,
          feed.two_phase_user_email || ''
        );

        results.push({
          feedId: feed.id,
          userId: feed.user_id,
          amazonFeedId: feed.amazon_feed_id,
          previousStep: feed.two_phase_step,
          newStatus: result.status,
          isComplete: result.isComplete,
          message: result.message,
        });

        console.log(
          `[Cron AmazonSync] Feed ${feed.id}: ${result.status} - ${result.message}`
        );
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[Cron AmazonSync] Error processing feed ${feed.id}:`, error);

        results.push({
          feedId: feed.id,
          userId: feed.user_id,
          amazonFeedId: feed.amazon_feed_id,
          previousStep: feed.two_phase_step,
          newStatus: 'error',
          isComplete: true,
          message: 'Processing failed',
          error: errorMsg,
        });
      }
    }

    const duration = Date.now() - startTime;
    const completed = results.filter((r) => r.isComplete).length;
    const errors = results.filter((r) => r.error).length;

    console.log(
      `[Cron AmazonSync] Complete: ${feeds.length} processed, ${completed} completed, ${errors} errors (${duration}ms)`
    );

    await execution.complete({ feedsCompleted: completed, feedsWithErrors: errors }, 200, feeds.length, errors);

    return NextResponse.json({
      success: true,
      feedsProcessed: feeds.length,
      feedsCompleted: completed,
      feedsWithErrors: errors,
      duration,
      results,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error('[Cron AmazonSync] Error:', error);
    await execution.fail(error, 500);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Internal error',
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
