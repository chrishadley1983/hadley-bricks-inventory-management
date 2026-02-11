/**
 * POST /api/admin/keepa-discovery
 *
 * Discovers Amazon ASINs for brickset_sets using Keepa API.
 * Two phases:
 *   - 'ean': Batch EAN lookup (cheapest, 1 token/match)
 *   - 'finder': Product Finder dump + title matching (11 tokens/page)
 *
 * Both phases are resumable: if `resume` is non-null in the response,
 * call again with those values to continue.
 *
 * Body:
 *   - phase: 'ean' | 'finder'
 *   - limit?: number (max items, 0 = all within timeout)
 *   - offset?: number (resume cursor for EAN phase)
 *   - finderPage?: number (resume cursor for Finder phase)
 *   - dryRun?: boolean (preview without writing)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { KeepaDiscoveryService } from '@/lib/keepa/keepa-discovery.service';

const DiscoverySchema = z.object({
  phase: z.enum(['ean', 'finder']),
  limit: z.number().int().min(0).optional().default(0),
  offset: z.number().int().min(0).optional().default(0),
  finderPage: z.number().int().min(0).optional().default(0),
  dryRun: z.boolean().optional().default(false),
});

export async function POST(request: NextRequest) {
  try {
    // Auth check: accept either user session or service role key as Bearer token
    const authHeader = request.headers.get('authorization');
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const isServiceRole = serviceRoleKey && authHeader === `Bearer ${serviceRoleKey}`;

    if (!isServiceRole) {
      const supabase = await createClient();
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();
      if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    // Validate input
    const body = await request.json();
    const parsed = DiscoverySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { phase, limit, offset, finderPage, dryRun } = parsed.data;

    // Check Keepa API key
    if (!process.env.KEEPA_API_KEY) {
      return NextResponse.json(
        { error: 'KEEPA_API_KEY environment variable not configured' },
        { status: 503 }
      );
    }

    // Use service role client for writes (bypasses RLS)
    const serviceClient = createServiceRoleClient();
    const discoveryService = new KeepaDiscoveryService(serviceClient);

    let result;

    if (phase === 'ean') {
      result = await discoveryService.discoverByEan(offset, limit, dryRun);
    } else {
      result = await discoveryService.discoverByFinder(finderPage, limit, dryRun);
    }

    return NextResponse.json({
      success: result.success,
      phase: result.phase,
      stats: result.stats,
      resume: result.resume,
      dryRun,
    });
  } catch (error) {
    console.error('[POST /api/admin/keepa-discovery] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
