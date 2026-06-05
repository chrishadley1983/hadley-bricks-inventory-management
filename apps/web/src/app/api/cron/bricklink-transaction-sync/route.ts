/**
 * POST /api/cron/bricklink-transaction-sync
 *
 * Daily incremental sync of BrickLink orders into `bricklink_transactions`.
 * The Profit & Loss report reads from this table — without a regular sync,
 * BL gross sales show £0 for the current period.
 *
 * Scope: transactions only (skips the slower per-order `platform_orders`
 * fetch that the manual integration sync also runs).
 *
 * Recommended schedule: Daily at 07:00 Europe/London (just before the
 * 07:35 bricqer-sync-status report so it reflects fresh data).
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/api/cron-auth';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { createBrickLinkTransactionSyncService } from '@/lib/bricklink/bricklink-transaction-sync.service';
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
    const unauthorized = verifyCronAuth(request, 'BrickLinkTransactionSync');
    if (unauthorized) return unauthorized;

    execution = await jobExecutionService.start('bricklink-transaction-sync', 'cron');

    const supabase = createServiceRoleClient();
    const credRepo = new CredentialsRepository(supabase);
    const hasCreds = await credRepo.hasCredentials(DEFAULT_USER_ID, 'bricklink');
    if (!hasCreds) {
      throw new Error('BrickLink credentials not configured');
    }

    // includeFiled=true so archived/filed orders are picked up too. Without
    // this, any order the seller files quickly after fulfilment is excluded
    // from `bricklink_transactions` and thus from the P&L report.
    const syncService = createBrickLinkTransactionSyncService(supabase);
    const result = await syncService.syncTransactions(DEFAULT_USER_ID, {
      fullSync: false,
      includeFiled: true,
    });

    const durationMs = Date.now() - startTime;

    if (!result.success) {
      throw new Error(result.error || 'BrickLink transaction sync failed');
    }

    console.log(
      `[Cron BrickLinkTransactionSync] Complete: processed=${result.ordersProcessed}, created=${result.ordersCreated}, updated=${result.ordersUpdated}, duration=${durationMs}ms`
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
    console.error('[Cron BrickLinkTransactionSync] Error:', error);
    await execution.fail(error, 500);

    await discordService.sendAlert({
      title: '🔴 BrickLink transaction sync failed',
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
