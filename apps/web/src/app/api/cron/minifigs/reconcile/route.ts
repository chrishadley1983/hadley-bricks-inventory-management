/**
 * GET|POST /api/cron/minifigs/reconcile
 *
 * Daily backstop for the minifig cross-platform de-list flows. Re-derives truth
 * from live eBay + Bricqer and flags drift the removal queue can miss:
 *   - DOUBLE-SELL RISK: eBay offer PUBLISHED but Bricqer stock 0 (how pha005
 *     double-sold after a silently-failed de-list).
 *   - STALE LISTED: DB listing_status=PUBLISHED but the eBay offer is not live.
 * Alerts to Discord. Detection only — no mutations.
 *
 * Schedule: daily (GCP Cloud Scheduler).
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/api/cron-auth';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { MinifigReconcilerService } from '@/lib/minifig-sync/reconciler.service';
import { DEFAULT_USER_ID } from '@/lib/minifig-sync/types';
import { jobExecutionService, noopHandle } from '@/lib/services/job-execution.service';
import type { ExecutionHandle } from '@/lib/services/job-execution.service';

export const runtime = 'nodejs';
export const maxDuration = 300;

async function handler(request: NextRequest) {
  const unauthorized = verifyCronAuth(request);
  if (unauthorized) return unauthorized;

  let execution: ExecutionHandle = noopHandle;
  try {
    execution = await jobExecutionService.start('minifig-reconcile', 'cron');
    const supabase = createServiceRoleClient();

    const service = new MinifigReconcilerService(supabase, DEFAULT_USER_ID);
    const result = await service.reconcile();

    await execution.complete(
      {
        checked: result.checked,
        liveOnEbay: result.liveOnEbay,
        doubleSellRisks: result.doubleSellRisks.length,
        staleListed: result.staleListed.length,
        errors: result.errors.length,
        doubleSellRiskItems: result.doubleSellRisks.map((f) => f.bricklinkId ?? f.syncId),
      },
      200,
      result.checked,
      result.doubleSellRisks.length + result.errors.length
    );

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error('[/api/cron/minifigs/reconcile] Error:', error);
    await execution.fail(error, 500);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
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
