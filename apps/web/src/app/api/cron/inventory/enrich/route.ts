/**
 * POST /api/cron/inventory/enrich
 *
 * Daily cron to enrich up to 1,000 inventory items with BrickLink price data.
 * Prioritises most valuable unenriched items. Skips items with fresh cache (<90 days).
 *
 * Recommended schedule: Daily at 3:00am UTC
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { EnrichmentService } from '@/lib/inventory-explorer/enrichment.service';

export const runtime = 'nodejs';
export const maxDuration = 300;

const DEFAULT_USER_ID = '4b6e94b4-661c-4462-9d14-b21df7d51e5b';

export async function POST(request: NextRequest) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceRoleClient();
    const service = new EnrichmentService(supabase, DEFAULT_USER_ID);

    console.log('[Cron InventoryEnrich] Starting daily enrichment (max 1000 items)');

    const result = await service.enrich({
      maxItems: 1000,
      onProgress: (p) => {
        if (p.processed % 100 === 0 || p.status !== 'running') {
          console.log(`[Cron InventoryEnrich] ${p.processed}/${p.total} — fetched: ${p.fetched}, errors: ${p.errors}`);
        }
      },
    });

    console.log(`[Cron InventoryEnrich] Done: ${result.newlyFetched} enriched, ${result.errors} errors`);

    return NextResponse.json({
      data: result,
      message: `Enriched ${result.newlyFetched} items, ${result.errors} errors`,
    });
  } catch (error) {
    console.error('[Cron InventoryEnrich] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
