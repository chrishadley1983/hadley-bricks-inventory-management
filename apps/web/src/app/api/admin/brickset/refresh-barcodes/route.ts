/**
 * Refresh Barcodes API Route
 *
 * POST - Re-fetch EAN/UPC data from Brickset API for sets with missing barcodes
 *
 * The Brickset API key is retrieved from the user's stored credentials,
 * or can be provided in the request body, or via BRICKSET_API_KEY env var.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { BricksetApiClient } from '@/lib/brickset/brickset-api';
import { BricksetCredentialsService } from '@/lib/services/brickset-credentials.service';
import { z } from 'zod';

const RefreshSchema = z.object({
  apiKey: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(500).optional().default(100),
  dryRun: z.boolean().optional().default(false),
});

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check auth
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse body
    const body = await request.json();
    const parsed = RefreshSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { apiKey: bodyApiKey, limit, dryRun } = parsed.data;

    // Get Brickset API key from: 1) request body, 2) stored credentials, 3) env var
    let apiKey: string | undefined = bodyApiKey;
    if (!apiKey) {
      const bricksetCredService = new BricksetCredentialsService(supabase);
      apiKey = (await bricksetCredService.getApiKey(user.id)) || undefined;
    }
    if (!apiKey) {
      apiKey = process.env.BRICKSET_API_KEY;
    }
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Brickset API key not configured. Set up Brickset in Settings > Integrations.' },
        { status: 400 }
      );
    }

    // Find sets with missing EAN or UPC
    const { data: setsToRefresh, error: queryError } = await supabase
      .from('brickset_sets')
      .select('id, set_number, set_name, ean, upc')
      .or('ean.is.null,upc.is.null')
      .order('year_from', { ascending: false })
      .limit(limit);

    if (queryError) {
      console.error('[refresh-barcodes] Query error:', queryError);
      return NextResponse.json({ error: 'Failed to query sets' }, { status: 500 });
    }

    if (!setsToRefresh || setsToRefresh.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No sets need barcode refresh',
        stats: { found: 0, updated: 0, failed: 0 },
      });
    }

    if (dryRun) {
      return NextResponse.json({
        success: true,
        dryRun: true,
        message: `Would refresh ${setsToRefresh.length} sets`,
        sampleSets: setsToRefresh.slice(0, 10).map((s) => ({
          setNumber: s.set_number,
          setName: s.set_name,
          currentEan: s.ean,
          currentUpc: s.upc,
        })),
      });
    }

    // Fetch from Brickset API and update
    const apiClient = new BricksetApiClient(apiKey);
    const serviceClient = createServiceRoleClient();

    let updated = 0;
    let failed = 0;
    const errors: Array<{ setNumber: string; error: string }> = [];

    for (const set of setsToRefresh) {
      try {
        // Add small delay to avoid rate limiting (5000 req/day = ~3.5/sec max)
        await new Promise((resolve) => setTimeout(resolve, 300));

        const apiSet = await apiClient.getSetByNumber(set.set_number);

        if (!apiSet) {
          errors.push({ setNumber: set.set_number, error: 'Not found in Brickset API' });
          failed++;
          continue;
        }

        const newEan = apiSet.barcode?.EAN || null;
        const newUpc = apiSet.barcode?.UPC || null;

        // Only update if we got new data
        if (newEan || newUpc) {
          const updateData: Record<string, string | null> = {};
          if (newEan && !set.ean) updateData.ean = newEan;
          if (newUpc && !set.upc) updateData.upc = newUpc;

          if (Object.keys(updateData).length > 0) {
            const { error: updateError } = await serviceClient
              .from('brickset_sets')
              .update(updateData)
              .eq('id', set.id);

            if (updateError) {
              errors.push({ setNumber: set.set_number, error: updateError.message });
              failed++;
            } else {
              updated++;
              console.log(
                `[refresh-barcodes] Updated ${set.set_number}: EAN=${newEan}, UPC=${newUpc}`
              );
            }
          }
        } else {
          // API returned no barcode data for this set
          errors.push({ setNumber: set.set_number, error: 'No barcode data in API response' });
          failed++;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        errors.push({ setNumber: set.set_number, error: message });
        failed++;
      }
    }

    return NextResponse.json({
      success: true,
      message: `Refreshed ${updated} sets, ${failed} failed`,
      stats: {
        found: setsToRefresh.length,
        updated,
        failed,
      },
      errors: errors.slice(0, 20), // Only return first 20 errors
    });
  } catch (error) {
    console.error('[POST /api/admin/brickset/refresh-barcodes] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const supabase = await createClient();

    // Check auth
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Count sets with missing barcodes
    const { count: missingEan } = await supabase
      .from('brickset_sets')
      .select('*', { count: 'exact', head: true })
      .is('ean', null);

    const { count: missingUpc } = await supabase
      .from('brickset_sets')
      .select('*', { count: 'exact', head: true })
      .is('upc', null);

    const { count: missingBoth } = await supabase
      .from('brickset_sets')
      .select('*', { count: 'exact', head: true })
      .is('ean', null)
      .is('upc', null);

    const { count: total } = await supabase
      .from('brickset_sets')
      .select('*', { count: 'exact', head: true });

    return NextResponse.json({
      stats: {
        total: total ?? 0,
        missingEan: missingEan ?? 0,
        missingUpc: missingUpc ?? 0,
        missingBoth: missingBoth ?? 0,
        completeEan: (total ?? 0) - (missingEan ?? 0),
        completeUpc: (total ?? 0) - (missingUpc ?? 0),
      },
    });
  } catch (error) {
    console.error('[GET /api/admin/brickset/refresh-barcodes] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
