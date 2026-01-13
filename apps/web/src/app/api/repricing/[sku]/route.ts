/**
 * Repricing SKU API Route
 *
 * PATCH - Push price update to Amazon instantly
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createRepricingService } from '@/lib/repricing';

// Request validation schema
const PushPriceSchema = z.object({
  newPrice: z.number().positive().max(100000),
  productType: z.string().optional(), // Will be auto-detected from listing if not provided
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sku: string }> }
) {
  try {
    // 1. Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Get SKU from params
    const { sku } = await params;
    if (!sku) {
      return NextResponse.json({ error: 'SKU is required' }, { status: 400 });
    }

    // 3. Validate request body
    const body = await request.json();
    const parsed = PushPriceSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { newPrice, productType } = parsed.data;

    // 4. Push price update
    const repricingService = createRepricingService(supabase, user.id);
    const result = await repricingService.pushPrice(sku, newPrice, productType);

    // 5. Return result
    if (result.success) {
      return NextResponse.json({ data: result });
    } else {
      return NextResponse.json({ error: result.message, data: result }, { status: 400 });
    }
  } catch (error) {
    console.error('[PATCH /api/repricing/[sku]] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
