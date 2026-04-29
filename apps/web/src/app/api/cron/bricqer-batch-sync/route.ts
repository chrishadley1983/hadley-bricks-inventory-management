/**
 * POST /api/cron/bricqer-batch-sync
 *
 * Pulls Bricqer batches into the `bricklink_uploads` table for every user with
 * Bricqer credentials. The `bricklink_uploads` table feeds the
 * `daily_platform_activity` view that powers /reports/daily-activity, so without
 * this cron, BL upload activity only appears when sync is triggered manually.
 *
 * Recommended schedule: daily (Vercel Hobby tier only allows once-per-day).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { BricqerBatchSyncService } from '@/lib/bricqer/bricqer-batch-sync.service';
import { jobExecutionService, noopHandle } from '@/lib/services/job-execution.service';
import type { ExecutionHandle } from '@/lib/services/job-execution.service';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface UserResult {
  userId: string;
  success: boolean;
  batchesProcessed?: number;
  batchesCreated?: number;
  batchesUpdated?: number;
  error?: string;
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let execution: ExecutionHandle = noopHandle;

  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      console.warn('[Cron BricqerBatchSync] Unauthorized request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    execution = await jobExecutionService.start('bricqer-batch-sync', 'cron');

    const supabase = createServiceRoleClient();

    const { data: creds, error: credsError } = await supabase
      .from('platform_credentials')
      .select('user_id')
      .eq('platform', 'bricqer');

    if (credsError) {
      throw new Error(`Failed to query bricqer credentials: ${credsError.message}`);
    }

    const userIds = [...new Set((creds ?? []).map((c) => c.user_id))];
    console.log(`[Cron BricqerBatchSync] ${userIds.length} user(s) with Bricqer credentials`);

    const syncService = new BricqerBatchSyncService(supabase);
    const results: UserResult[] = [];

    for (const userId of userIds) {
      try {
        const r = await syncService.syncBatches(userId);
        results.push({
          userId,
          success: r.success,
          batchesProcessed: r.batchesProcessed,
          batchesCreated: r.batchesCreated,
          batchesUpdated: r.batchesUpdated,
          error: r.error,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Cron BricqerBatchSync] User ${userId} failed:`, msg);
        results.push({ userId, success: false, error: msg });
      }
    }

    const successes = results.filter((r) => r.success).length;
    const failures = results.length - successes;
    const totalCreated = results.reduce((s, r) => s + (r.batchesCreated ?? 0), 0);
    const totalUpdated = results.reduce((s, r) => s + (r.batchesUpdated ?? 0), 0);
    const durationMs = Date.now() - startTime;

    console.log(
      `[Cron BricqerBatchSync] Complete — users: ${results.length}, ok: ${successes}, failed: ${failures}, created: ${totalCreated}, updated: ${totalUpdated} (${Math.round(durationMs / 1000)}s)`
    );

    await execution.complete(
      { results, totalCreated, totalUpdated },
      200,
      results.length,
      failures
    );

    return NextResponse.json({
      success: failures === 0,
      users: results.length,
      successes,
      failures,
      totalCreated,
      totalUpdated,
      durationMs,
      results,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[Cron BricqerBatchSync] Fatal error:', error);
    await execution.fail(error, 500);
    return NextResponse.json(
      { success: false, error: errorMsg, durationMs: Date.now() - startTime },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
