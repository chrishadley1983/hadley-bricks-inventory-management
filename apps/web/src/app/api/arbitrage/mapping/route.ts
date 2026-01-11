/**
 * ASIN Mapping API Routes
 *
 * POST /api/arbitrage/mapping - Create manual mapping
 * DELETE /api/arbitrage/mapping - Delete mapping
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { MappingService, ArbitrageService } from '@/lib/arbitrage';

// ============================================================================
// SCHEMAS
// ============================================================================

const CreateMappingSchema = z.object({
  asin: z.string().length(10),
  bricklinkSetNumber: z.string().regex(/^\d{4,6}-\d$/, 'Invalid set number format (e.g., 40585-1)'),
});

const DeleteMappingSchema = z.object({
  asin: z.string().length(10),
});

// ============================================================================
// POST - Create manual mapping
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
    const parsed = CreateMappingSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const mappingService = new MappingService(supabase);

    // Validate the set number exists in BrickLink
    const validation = await mappingService.validateSetNumber(user.id, parsed.data.bricklinkSetNumber);

    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error || 'Invalid set number' },
        { status: 400 }
      );
    }

    // Create the mapping
    const arbitrageService = new ArbitrageService(supabase);
    await arbitrageService.createManualMapping(
      user.id,
      parsed.data.asin,
      validation.setNumber
    );

    return NextResponse.json({
      data: {
        asin: parsed.data.asin,
        bricklinkSetNumber: validation.setNumber,
        setName: validation.setName,
      },
      message: 'Mapping created successfully',
    }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/arbitrage/mapping] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ============================================================================
// DELETE - Delete mapping
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
    const parsed = DeleteMappingSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const mappingService = new MappingService(supabase);
    await mappingService.deleteMapping(user.id, parsed.data.asin);

    return NextResponse.json({
      data: { success: true },
      message: 'Mapping deleted successfully',
    });
  } catch (error) {
    console.error('[DELETE /api/arbitrage/mapping] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
