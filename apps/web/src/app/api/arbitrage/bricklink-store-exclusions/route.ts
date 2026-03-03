/**
 * BrickLink Store Exclusions API Routes
 *
 * GET /api/arbitrage/bricklink-store-exclusions - Get excluded stores
 * POST /api/arbitrage/bricklink-store-exclusions - Exclude a store
 * DELETE /api/arbitrage/bricklink-store-exclusions - Restore a store
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { BrickLinkStoreExclusionService } from '@/lib/arbitrage/bricklink-store-exclusion.service';

// ============================================================================
// SCHEMAS
// ============================================================================

const ExcludeStoreSchema = z.object({
  storeName: z.string().min(1),
  reason: z.string().optional(),
});

const RestoreStoreSchema = z.object({
  storeName: z.string().min(1),
});

// ============================================================================
// GET - Get excluded BrickLink stores
// ============================================================================

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const service = new BrickLinkStoreExclusionService(supabase);
    const data = await service.getExcludedStores(user.id);

    return NextResponse.json({ data });
  } catch (error) {
    console.error('[GET /api/arbitrage/bricklink-store-exclusions] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================================================
// POST - Exclude a BrickLink store
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = ExcludeStoreSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const service = new BrickLinkStoreExclusionService(supabase);
    await service.excludeStore(user.id, parsed.data.storeName, parsed.data.reason);

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/arbitrage/bricklink-store-exclusions] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================================================
// DELETE - Restore an excluded BrickLink store
// ============================================================================

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = RestoreStoreSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const service = new BrickLinkStoreExclusionService(supabase);
    await service.restoreStore(user.id, parsed.data.storeName);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/arbitrage/bricklink-store-exclusions] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
