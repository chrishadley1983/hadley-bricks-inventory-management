import { NextRequest, NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/api/cron-auth';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { InventoryPullService } from '@/lib/minifig-sync/inventory-pull.service';
import { OrderPollService } from '@/lib/minifig-sync/order-poll.service';
import { DEFAULT_USER_ID } from '@/lib/minifig-sync/types';
import { jobExecutionService, noopHandle } from '@/lib/services/job-execution.service';
import type { ExecutionHandle } from '@/lib/services/job-execution.service';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Daily maintenance cron — runs all daily tasks in sequence:
 * 1. Crash recovery (stuck PUBLISHING items)
 * 2. Inventory pull from Bricqer
 * 3. Bricqer order polling
 * 4. Research refresh (expired cache)
 */
async function handler(request: NextRequest) {
  let execution: ExecutionHandle = noopHandle;
  try {
    const unauthorized = verifyCronAuth(request);
    if (unauthorized) return unauthorized;

    execution = await jobExecutionService.start('minifig-daily-inventory', 'cron');

    const supabase = createServiceRoleClient();
    const results: Record<string, unknown> = {};

    // 1. CR-002: Reset any items stuck in PUBLISHING status (crash recovery)
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: stuckItems } = await supabase
      .from('minifig_sync_items')
      .update({ listing_status: 'STAGED', updated_at: new Date().toISOString() })
      .eq('user_id', DEFAULT_USER_ID)
      .eq('listing_status', 'PUBLISHING')
      .lt('updated_at', fiveMinAgo)
      .select('id');

    if (stuckItems && stuckItems.length > 0) {
      console.log(
        `[daily-inventory] Reset ${stuckItems.length} stuck PUBLISHING items back to STAGED`
      );
    }
    results.stuckItemsReset = stuckItems?.length ?? 0;

    // 2. Inventory pull (time-budgeted to leave room for other tasks)
    const pullService = new InventoryPullService(supabase, DEFAULT_USER_ID);
    results.inventoryPull = await pullService.pull({ maxDurationMs: 40_000 });

    // 3. Bricqer order polling
    try {
      const orderPollService = new OrderPollService(supabase, DEFAULT_USER_ID);
      results.bricqerOrderPoll = await orderPollService.pollBricqerOrders();
    } catch (err) {
      console.error('[daily-inventory] Bricqer order poll failed:', err);
      results.bricqerOrderPoll = { error: err instanceof Error ? err.message : String(err) };
    }

    // 4. Research refresh — DISABLED: Terapeak requires local Playwright + Chrome session.
    // Re-enable once Chrome extension or alternative approach is in place.
    results.researchRefresh = { message: 'Research refresh disabled', itemsRefreshed: 0 };

    // Step 5 (Monday repricing) removed — was making 1 unbounded BL API call per
    // stale PUBLISHED minifig, contributing to BL daily-quota overage.
    results.repricing = { skipped: true, reason: 'Disabled — unbounded BL API calls' };

    const itemsProcessed =
      (typeof results.inventoryPull === 'object' && results.inventoryPull !== null
        ? (results.inventoryPull as Record<string, unknown>).itemsProcessed
        : 0) as number;

    await execution.complete(results, 200, itemsProcessed ?? 0, 0);

    return NextResponse.json({ data: results });
  } catch (error) {
    console.error('[/api/cron/minifigs/daily-inventory] Error:', error);
    await execution.fail(error, 500);
    return NextResponse.json(
      {
        error: 'Daily inventory pull failed',
        details:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : String(error)
            : undefined,
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return handler(request);
}

export async function POST(request: NextRequest) {
  return handler(request);
}
