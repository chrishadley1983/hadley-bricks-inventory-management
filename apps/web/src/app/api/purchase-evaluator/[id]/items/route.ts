/**
 * Purchase Evaluator Items API Routes
 *
 * GET - Get all items for an evaluation
 * PATCH - Update multiple items (batch)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { PurchaseEvaluatorService } from '@/lib/purchase-evaluator/evaluator.service';

const UpdateItemSchema = z.object({
  id: z.string().uuid(),
  targetPlatform: z.enum(['amazon', 'ebay']).optional(),
  amazonAsin: z.string().optional(),
  allocatedCost: z.number().nonnegative().nullable().optional(),
  userSellPriceOverride: z.number().nonnegative().nullable().optional(),
  userNotes: z.string().nullable().optional(),
});

const BatchUpdateSchema = z.object({
  items: z.array(UpdateItemSchema).min(1),
});

/**
 * GET /api/purchase-evaluator/[id]/items
 * Get all items for an evaluation
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const service = new PurchaseEvaluatorService(supabase);
    const evaluation = await service.getEvaluation(user.id, id);

    if (!evaluation) {
      return NextResponse.json({ error: 'Evaluation not found' }, { status: 404 });
    }

    return NextResponse.json({ data: evaluation.items || [] });
  } catch (error) {
    console.error('[GET /api/purchase-evaluator/[id]/items] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PATCH /api/purchase-evaluator/[id]/items
 * Update multiple items in batch
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = BatchUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Verify evaluation ownership
    const service = new PurchaseEvaluatorService(supabase);
    const evaluation = await service.getEvaluation(user.id, id);

    if (!evaluation) {
      return NextResponse.json({ error: 'Evaluation not found' }, { status: 404 });
    }

    // Update each item
    const updatedItems = [];
    for (const itemUpdate of parsed.data.items) {
      const { id: itemId, ...updates } = itemUpdate;
      const updated = await service.updateItem(user.id, itemId, updates);
      updatedItems.push(updated);
    }

    // Recalculate profitability and summary after updates
    await service.calculateProfitability(user.id, id);
    await service.updateEvaluationSummary(user.id, id);

    return NextResponse.json({ data: updatedItems });
  } catch (error) {
    console.error('[PATCH /api/purchase-evaluator/[id]/items] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
