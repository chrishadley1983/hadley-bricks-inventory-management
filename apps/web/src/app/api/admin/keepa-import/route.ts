/**
 * POST /api/admin/keepa-import
 *
 * Imports historical Amazon UK price data from Keepa API into price_snapshots.
 * Supports importing by specific ASINs or for all retired sets.
 *
 * Body:
 *   - asins?: string[] — specific ASINs to import
 *   - retiredSets?: boolean — import all retired sets with ASINs
 *   - dryRun?: boolean — preview without writing to database
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { validateAuth } from '@/lib/api/validate-auth';
import { KeepaImportService } from '@/lib/keepa';

const ImportSchema = z.object({
  asins: z.array(z.string().min(1)).max(100).optional(),
  retiredSets: z.boolean().optional().default(false),
  dryRun: z.boolean().optional().default(false),
}).refine(
  (data) => data.asins?.length || data.retiredSets,
  { message: 'Must provide either asins array or retiredSets: true' }
);

export async function POST(request: NextRequest) {
  try {
    // Auth check (supports both session and API key)
    const auth = await validateAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Validate input
    const body = await request.json();
    const parsed = ImportSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { asins, retiredSets, dryRun } = parsed.data;

    // Use service role client for writes (bypasses RLS)
    const serviceClient = createServiceRoleClient();
    const importService = new KeepaImportService(serviceClient);

    // Check if Keepa API key is configured
    if (!process.env.KEEPA_API_KEY) {
      return NextResponse.json(
        { error: 'KEEPA_API_KEY environment variable not configured' },
        { status: 503 }
      );
    }

    const result = await importService.importPriceData({
      asins,
      retiredSets,
      dryRun,
    });

    return NextResponse.json({
      success: true,
      message: dryRun
        ? `Dry run: would import ${result.total_snapshots_imported} snapshots for ${result.total_asins} ASINs`
        : `Imported ${result.total_snapshots_imported} snapshots for ${result.total_asins} ASINs`,
      stats: {
        total_asins: result.total_asins,
        total_snapshots_imported: result.total_snapshots_imported,
        successful: result.successful,
        failed: result.failed,
        skipped_no_data: result.skipped_no_data,
        duration_ms: result.duration_ms,
        dry_run: dryRun,
      },
      results: result.results,
    });
  } catch (error) {
    console.error('[POST /api/admin/keepa-import] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
