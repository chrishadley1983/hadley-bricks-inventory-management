/**
 * POST /api/cron/cost-allocation
 *
 * Daily cost allocation job. Distributes purchase costs proportionally
 * across linked inventory items and BrickLink uploads based on listing value.
 *
 * Recommended schedule: Daily at 9:15pm UK time (Europe/London)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { CostAllocationService } from '@/lib/services/cost-allocation.service';
import { emailService } from '@/lib/email/email.service';
import { discordService, DiscordColors } from '@/lib/notifications';
import { jobExecutionService, noopHandle } from '@/lib/services/job-execution.service';
import type { ExecutionHandle } from '@/lib/services/job-execution.service';

export const runtime = 'nodejs';
export const maxDuration = 300;

const USER_ID = '4b6e94b4-661c-4462-9d14-b21df7d51e5b';
const USER_EMAIL = 'chris@hadleybricks.co.uk';

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let execution: ExecutionHandle = noopHandle;

  try {
    // Verify cron secret (skip if not set - development mode)
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      console.warn('[Cron CostAllocation] Unauthorized request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Detect trigger type
    const trigger = request.headers.get('x-trigger') === 'manual' ? 'manual' : 'cron';
    execution = await jobExecutionService.start('cost-allocation', trigger);

    console.log(`[Cron CostAllocation] Starting (trigger: ${trigger})`);

    const supabase = createServiceRoleClient();
    const service = new CostAllocationService(supabase);
    const summary = await service.allocateAll(USER_ID);

    const durationMs = Date.now() - startTime;

    console.log(
      `[Cron CostAllocation] Complete: ${summary.purchasesProcessed} processed, ` +
        `${summary.purchasesWithChanges} changed, ${summary.totalChanges} items updated, ` +
        `${durationMs}ms`
    );

    // Send Discord summary to #sync-status
    await discordService.send('sync-status', {
      title: summary.totalChanges > 0
        ? `💰 Cost Allocation: ${summary.totalChanges} items updated`
        : '💰 Cost Allocation: No changes',
      description:
        `Purchases: ${summary.purchasesProcessed} processed, ${summary.purchasesSkipped} skipped\n` +
        `Changes: ${summary.totalChanges} items across ${summary.purchasesWithChanges} purchases\n` +
        `Total cost allocated: £${summary.totalCostAllocated.toFixed(2)}\n` +
        `Duration: ${Math.round(durationMs / 1000)}s`,
      color: summary.totalChanges > 0 ? DiscordColors.GREEN : DiscordColors.BLUE,
    });

    // Send email report (only if there are changes)
    if (summary.totalChanges > 0) {
      await emailService.sendCostAllocationReport({
        userEmail: USER_EMAIL,
        summary,
      });
    }

    await execution.complete(
      {
        totalPurchases: summary.totalPurchases,
        purchasesProcessed: summary.purchasesProcessed,
        purchasesSkipped: summary.purchasesSkipped,
        purchasesWithChanges: summary.purchasesWithChanges,
        totalChanges: summary.totalChanges,
      },
      200,
      summary.purchasesProcessed,
      0
    );

    return NextResponse.json({
      success: true,
      totalPurchases: summary.totalPurchases,
      purchasesProcessed: summary.purchasesProcessed,
      purchasesWithChanges: summary.purchasesWithChanges,
      totalChanges: summary.totalChanges,
      duration: durationMs,
    });
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';

    console.error('[Cron CostAllocation] Error:', error);
    await execution.fail(error, 500);

    // Send failure notification to Discord
    await discordService.sendAlert({
      title: '🔴 Cost Allocation Failed',
      message: `Error: ${errorMsg}\nDuration: ${Math.round(durationMs / 1000)}s`,
      priority: 'high',
    });

    return NextResponse.json(
      {
        success: false,
        error: errorMsg,
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
