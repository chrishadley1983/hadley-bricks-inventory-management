/**
 * Purchase Evaluator Single Evaluation API Routes
 *
 * GET - Get evaluation with items
 * PATCH - Update evaluation metadata
 * DELETE - Delete evaluation
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { PurchaseEvaluatorService } from '@/lib/purchase-evaluator/evaluator.service';

const UpdateEvaluationSchema = z.object({
  name: z.string().optional(),
  defaultPlatform: z.enum(['amazon', 'ebay']).optional(),
  totalPurchasePrice: z.number().nonnegative().optional(),
  costAllocationMethod: z.enum(['per_item', 'proportional', 'equal']).optional(),
  status: z.enum(['draft', 'in_progress', 'completed', 'saved']).optional(),
});

/**
 * GET /api/purchase-evaluator/[id]
 * Get a single evaluation with all items
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    return NextResponse.json({ data: evaluation });
  } catch (error) {
    console.error('[GET /api/purchase-evaluator/[id]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PATCH /api/purchase-evaluator/[id]
 * Update evaluation metadata
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    const parsed = UpdateEvaluationSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const service = new PurchaseEvaluatorService(supabase);
    const evaluation = await service.updateEvaluation(user.id, id, parsed.data);

    return NextResponse.json({ data: evaluation });
  } catch (error) {
    console.error('[PATCH /api/purchase-evaluator/[id]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/purchase-evaluator/[id]
 * Delete an evaluation and all its items
 */
export async function DELETE(
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
    await service.deleteEvaluation(user.id, id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/purchase-evaluator/[id]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
