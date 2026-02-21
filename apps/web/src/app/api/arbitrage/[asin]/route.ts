/**
 * Arbitrage Item API Routes
 *
 * GET /api/arbitrage/[asin] - Get single item details
 * PATCH /api/arbitrage/[asin] - Update item (exclude/restore)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { ArbitrageService } from '@/lib/arbitrage';

// ============================================================================
// SCHEMAS
// ============================================================================

const UpdateSchema = z.object({
  action: z.enum(['exclude', 'restore', 'setOverride']),
  reason: z.string().max(500).optional(),
  minBlPriceOverride: z.number().positive().nullable().optional(),
});

// ============================================================================
// GET - Get single item
// ============================================================================

export async function GET(request: NextRequest, { params }: { params: Promise<{ asin: string }> }) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { asin } = await params;

    if (!asin || asin.length < 10) {
      return NextResponse.json({ error: 'Invalid ASIN' }, { status: 400 });
    }

    const service = new ArbitrageService(supabase);
    const item = await service.getArbitrageItem(user.id, asin);

    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    return NextResponse.json({ data: item });
  } catch (error) {
    console.error('[GET /api/arbitrage/[asin]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================================================
// PATCH - Update item (exclude/restore)
// ============================================================================

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ asin: string }> }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { asin } = await params;

    if (!asin || asin.length < 10) {
      return NextResponse.json({ error: 'Invalid ASIN' }, { status: 400 });
    }

    const body = await request.json();
    const parsed = UpdateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const service = new ArbitrageService(supabase);

    if (parsed.data.action === 'exclude') {
      await service.excludeAsin(user.id, asin, parsed.data.reason);
      return NextResponse.json({
        data: { success: true },
        message: 'ASIN excluded successfully',
      });
    } else if (parsed.data.action === 'setOverride') {
      // Set or clear the minimum BL price override
      const override = parsed.data.minBlPriceOverride ?? null;
      await service.setBlPriceOverride(user.id, asin, override);
      return NextResponse.json({
        data: { success: true, minBlPriceOverride: override },
        message:
          override !== null
            ? `BL price override set to £${override.toFixed(2)}`
            : 'BL price override cleared',
      });
    } else {
      await service.restoreAsin(user.id, asin);
      return NextResponse.json({
        data: { success: true },
        message: 'ASIN restored successfully',
      });
    }
  } catch (error) {
    console.error('[PATCH /api/arbitrage/[asin]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
