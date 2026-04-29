/**
 * POST /api/cron/brickowl-transaction-sync
 *
 * Daily incremental sync of Brick Owl orders into `brickowl_transactions`.
 * The Profit & Loss report reads from this table — without a regular sync,
 * BO gross sales show £0 for the current period.
 *
 * Scope: transactions only (skips the slower per-order `platform_orders`
 * fetch that the manual integration sync also runs).
 *
 * Recommended schedule: Daily at 07:05 Europe/London (just before the
 * 07:35 bricqer-sync-status report so it reflects fresh data).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { createBrickOwlTransactionSyncService } from '@/lib/brickowl/brickowl-transaction-sync.service';
import { CredentialsRepository } from '@/lib/repositories/credentials.repository';
import { DEFAULT_USER_ID } from '@/lib/minifig-sync/types';
import { discordService } from '@/lib/notifications';
import { jobExecutionService, noopHandle } from '@/lib/services/job-execution.service';
import type { ExecutionHandle } from '@/lib/services/job-execution.service';

export const runtime = 'nodejs';
export const maxDuration = 300;

async function handler(request: NextRequest) {
  const startTime = Date.now();
  let execution: ExecutionHandle = noopHandle;

  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      console.warn('[Cron BrickOwlTransactionSync] Unauthorized request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    execution = await jobExecutionService.start('brickowl-transaction-sync', 'cron');

    const supabase = createServiceRoleClient();
    const credRepo = new CredentialsRepository(supabase);
    const hasCreds = await credRepo.hasCredentials(DEFAULT_USER_ID, 'brickowl');
    if (!hasCreds) {
      throw new Error('Brick Owl credentials not configured');
    }

    const syncService = createBrickOwlTransactionSyncService(supabase);
    const result = await syncService.syncTransactions(DEFAULT_USER_ID, { fullSync: false });

    const durationMs = Date.now() - startTime;

    if (!result.success) {
      throw new Error(result.error || 'Brick Owl transaction sync failed');
    }

    console.log(
      `[Cron BrickOwlTransactionSync] Complete: processed=${result.ordersProcessed}, created=${result.ordersCreated}, updated=${result.ordersUpdated}, duration=${durationMs}ms`
    );

    await execution.complete(
      {
        syncMode: result.syncMode,
        ordersProcessed: result.ordersProcessed,
        ordersCreated: result.ordersCreated,
        ordersUpdated: result.ordersUpdated,
        ordersSkipped: result.ordersSkipped,
      },
      200
    );

    return NextResponse.json({
      success: true,
      data: {
        syncMode: result.syncMode,
        ordersProcessed: result.ordersProcessed,
        ordersCreated: result.ordersCreated,
        ordersUpdated: result.ordersUpdated,
        ordersSkipped: result.ordersSkipped,
      },
      duration: durationMs,
    });
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Cron BrickOwlTransactionSync] Error:', error);
    await execution.fail(error, 500);

    await discordService.sendAlert({
      title: '🔴 Brick Owl transaction sync failed',
      message: `Error: ${errorMsg}\nDuration: ${Math.round(durationMs / 1000)}s`,
      priority: 'high',
    });

    return NextResponse.json(
      { success: false, error: errorMsg, duration: durationMs },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return handler(request);
}

export async function GET(request: NextRequest) {
  return handler(request);
}
