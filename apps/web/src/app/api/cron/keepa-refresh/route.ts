/**
 * POST /api/cron/keepa-refresh
 *
 * Daily budgeted refresh of Keepa price/rank snapshots so post-retirement
 * training labels keep accruing and the scoring demand factor stays fresh.
 * (The original 2026-02 backfill was a one-off — without this cron the feed
 * simply stops.)
 *
 * Picks the stalest sets from keepa_refresh_candidates (active/retiring sets
 * plus sets retired in the last 4 years, all with ASINs), imports them in
 * Keepa batches of 10, and stops early on a wall-clock guard so Vercel's
 * maxDuration never kills a run mid-batch. Staleness ordering makes the whole
 * candidate pool rotate through automatically across days.
 *
 * Protected by CRON_SECRET header.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/api/cron-auth';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { KeepaImportService } from '@/lib/keepa/keepa-import.service';
import { jobExecutionService, noopHandle } from '@/lib/services/job-execution.service';
import type { ExecutionHandle } from '@/lib/services/job-execution.service';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes

const DEFAULT_ASIN_LIMIT = 200;
const DEFAULT_TIME_BUDGET_MS = 200_000; // headroom under Vercel maxDuration
const MAX_TIME_BUDGET_MS = 1_800_000; // local runs (no platform cap) may go longer
const KEEPA_BATCH_SIZE = 10;

export async function POST(request: NextRequest) {
  let execution: ExecutionHandle = noopHandle;
  try {
    const unauthorized = verifyCronAuth(request);
    if (unauthorized) return unauthorized;

    execution = await jobExecutionService.start('keepa-refresh', 'cron');

    const startTime = Date.now();
    const limitParam = request.nextUrl.searchParams.get('limit');
    const limit = Math.min(Math.max(parseInt(limitParam ?? '', 10) || DEFAULT_ASIN_LIMIT, 10), 1000);
    const budgetParam = request.nextUrl.searchParams.get('time_budget_ms');
    const timeBudgetMs = Math.min(
      Math.max(parseInt(budgetParam ?? '', 10) || DEFAULT_TIME_BUDGET_MS, 30_000),
      MAX_TIME_BUDGET_MS
    );

    const supabase = createServiceRoleClient();

    // Stalest candidates first (never-imported sets sort before everything)
    const { data: candidates, error } = await supabase
      .from('keepa_refresh_candidates' as never)
      .select('set_number, amazon_asin, last_keepa_date')
      .order('last_keepa_date', { ascending: true, nullsFirst: true })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to fetch refresh candidates: ${error.message}`);
    }

    const asins = ((candidates ?? []) as unknown as Record<string, unknown>[])
      .map((c) => c.amazon_asin as string | null)
      .filter((a): a is string => !!a);

    const importService = new KeepaImportService(supabase);

    let processed = 0;
    let snapshotsImported = 0;
    let failed = 0;
    let stoppedEarly = false;

    for (let i = 0; i < asins.length; i += KEEPA_BATCH_SIZE) {
      if (Date.now() - startTime > timeBudgetMs) {
        stoppedEarly = true;
        break;
      }

      const batch = asins.slice(i, i + KEEPA_BATCH_SIZE);
      const summary = await importService.importPriceData({ asins: batch });
      processed += batch.length;
      snapshotsImported += summary.total_snapshots_imported;
      failed += summary.failed;
    }

    const result = {
      candidates: asins.length,
      asins_processed: processed,
      snapshots_imported: snapshotsImported,
      failed,
      stopped_early_on_time_budget: stoppedEarly,
      duration_ms: Date.now() - startTime,
    };

    console.log('[KeepaRefresh] Complete:', JSON.stringify(result));

    await execution.complete(result, 200, processed, failed);

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('[POST /api/cron/keepa-refresh] Error:', error);
    await execution.fail(error, 500);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Support GET for manual testing (requires same auth)
export async function GET(request: NextRequest) {
  return POST(request);
}
