/**
 * POST /api/cron/inventory/enrich
 *
 * Daily cron to enrich up to 1,000 inventory items with BrickLink price data.
 * Prioritises most valuable unenriched items. Skips items with fresh cache (<90 days).
 *
 * Recommended schedule: Daily at 3:00am UTC (GCP Cloud Scheduler)
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/api/cron-auth';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { EnrichmentService, MAX_ITEMS_DAILY_REFRESH } from '@/lib/inventory-explorer/enrichment.service';
import { discordService } from '@/lib/notifications';
import { jobExecutionService, noopHandle } from '@/lib/services/job-execution.service';
import type { ExecutionHandle } from '@/lib/services/job-execution.service';

export const runtime = 'nodejs';
export const maxDuration = 300;

const DEFAULT_USER_ID = '4b6e94b4-661c-4462-9d14-b21df7d51e5b';
const JOB_NAME = 'inventory-bricklink-enrich';

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let execution: ExecutionHandle = noopHandle;

  try {
    // Verify cron secret
    const unauthorized = verifyCronAuth(request);
    if (unauthorized) return unauthorized;

    // Kill-switch: set INVENTORY_ENRICH_CRON_ENABLED=false in env to pause this
    // cron without redeploying (e.g. while running the cache-cleanup script
    // and waiting for the colour-id-pollution fix to verify in production).
    if (process.env.INVENTORY_ENRICH_CRON_ENABLED === 'false') {
      console.log('[Cron InventoryEnrich] Skipped: INVENTORY_ENRICH_CRON_ENABLED=false');
      return NextResponse.json({ skipped: true, reason: 'disabled by env flag' });
    }

    execution = await jobExecutionService.start(JOB_NAME, 'cron');

    const supabase = createServiceRoleClient();
    const service = new EnrichmentService(supabase, DEFAULT_USER_ID);

    console.log(`[Cron InventoryEnrich] Starting daily enrichment (max ${MAX_ITEMS_DAILY_REFRESH} items)`);

    await discordService.sendSyncStatus({
      title: '🔄 Inventory BL Enrichment Started',
      message: `Daily enrichment started\nMax ${MAX_ITEMS_DAILY_REFRESH} items to process`,
    });

    const result = await service.enrich({
      maxItems: MAX_ITEMS_DAILY_REFRESH,
      onProgress: (p) => {
        if (p.processed % 100 === 0 || p.status !== 'running') {
          console.log(`[Cron InventoryEnrich] ${p.processed}/${p.total} — fetched: ${p.fetched}, errors: ${p.errors}`);
        }
      },
    });

    const duration = Math.round((Date.now() - startTime) / 1000);

    if (result.errors > 0) {
      await discordService.sendSyncStatus({
        title: '⚠️ Inventory BL Enrichment Complete (with errors)',
        message: `Enriched: ${result.newlyFetched} items\nErrors: ${result.errors}\nDuration: ${duration}s`,
        success: false,
      });
    } else if (result.newlyFetched === 0) {
      await discordService.sendSyncStatus({
        title: '✅ Inventory BL Enrichment — All Up To Date',
        message: `No unenriched items found\nDuration: ${duration}s`,
        success: true,
      });
    } else {
      await discordService.sendSyncStatus({
        title: '✅ Inventory BL Enrichment Complete',
        message: `Enriched: ${result.newlyFetched} items\nDuration: ${duration}s`,
        success: true,
      });
    }

    console.log(`[Cron InventoryEnrich] Done: ${result.newlyFetched} enriched, ${result.errors} errors, ${duration}s`);

    await execution.complete(
      { newlyFetched: result.newlyFetched, errors: result.errors, durationSec: duration },
      200,
      result.newlyFetched,
      result.errors
    );

    return NextResponse.json({
      data: result,
      message: `Enriched ${result.newlyFetched} items, ${result.errors} errors`,
    });
  } catch (error) {
    const duration = Math.round((Date.now() - startTime) / 1000);
    const errorMsg = error instanceof Error ? error.message : String(error);

    console.error('[Cron InventoryEnrich] Error:', errorMsg);

    await execution.fail(error, 500);

    await discordService.sendAlert({
      title: '🔴 Inventory BL Enrichment Failed',
      message: `Error: ${errorMsg}\nDuration: ${duration}s`,
      priority: 'high',
    });

    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
