/**
 * POST /api/cron/investment-sync
 *
 * Runs investment data enrichment:
 * 1. ASIN linkage from seeded_asins to brickset_sets
 * 2. Auto-classification of investment attributes
 * 3. Price movement alerts
 *
 * Designed to run after the Amazon pricing cron completes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { AsinLinkageService } from '@/lib/investment/asin-linkage.service';
import { InvestmentClassificationService } from '@/lib/investment/classification.service';
import { PriceAlertService } from '@/lib/investment/price-alerts.service';
import { jobExecutionService, noopHandle } from '@/lib/services/job-execution.service';
import type { ExecutionHandle } from '@/lib/services/job-execution.service';

export const runtime = 'nodejs';
export const maxDuration = 300;

async function handleSync() {
  const supabase = createServiceRoleClient();

  const results: Record<string, unknown> = {};

  // 1. ASIN Linkage
  console.log('[InvestmentSync] Starting ASIN linkage...');
  try {
    const linkageService = new AsinLinkageService(supabase);
    results.asin_linkage = await linkageService.linkAll();
  } catch (err) {
    console.error('[InvestmentSync] ASIN linkage error:', err);
    results.asin_linkage = { error: err instanceof Error ? err.message : String(err) };
  }

  // 2. Classification
  console.log('[InvestmentSync] Starting classification...');
  try {
    const classificationService = new InvestmentClassificationService(supabase);
    results.classification = await classificationService.classifyAll();
  } catch (err) {
    console.error('[InvestmentSync] Classification error:', err);
    results.classification = { error: err instanceof Error ? err.message : String(err) };
  }

  // 3. Price Alerts
  console.log('[InvestmentSync] Checking price movements...');
  try {
    const alertService = new PriceAlertService(supabase);
    results.price_alerts = await alertService.checkAndAlert();
  } catch (err) {
    console.error('[InvestmentSync] Price alerts error:', err);
    results.price_alerts = { error: err instanceof Error ? err.message : String(err) };
  }

  return results;
}

export async function POST(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let execution: ExecutionHandle = noopHandle;
  try {
    execution = await jobExecutionService.start('investment-sync', 'cron');
    const results = await handleSync();
    await execution.complete(results as Record<string, unknown>, 200);
    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error('[InvestmentSync] Fatal error:', error);
    await execution.fail(error, 500);
    return NextResponse.json(
      { error: 'Investment sync failed', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

// GET for manual testing
export async function GET(request: NextRequest) {
  return POST(request);
}
