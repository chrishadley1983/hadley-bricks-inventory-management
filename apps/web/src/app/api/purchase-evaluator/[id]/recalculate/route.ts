/**
 * Purchase Evaluator Recalculate API Route
 *
 * POST - Recalculate costs based on current Amazon prices
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { PurchaseEvaluatorService } from '@/lib/purchase-evaluator/evaluator.service';

/**
 * POST /api/purchase-evaluator/[id]/recalculate
 * Recalculate cost allocation based on current Amazon prices
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const service = new PurchaseEvaluatorService(supabase);

    // Get evaluation to check ownership and get allocation settings
    const evaluation = await service.getEvaluation(user.id, id);
    if (!evaluation) {
      return NextResponse.json({ error: 'Evaluation not found' }, { status: 404 });
    }

    // Only recalculate if using proportional allocation
    if (evaluation.costAllocationMethod === 'proportional' && evaluation.totalPurchasePrice) {
      await service.allocateCosts(user.id, id, 'proportional', evaluation.totalPurchasePrice);
    }

    // Recalculate profitability and summary
    await service.calculateProfitability(user.id, id);
    await service.updateEvaluationSummary(user.id, id);

    // Get updated evaluation
    const updatedEvaluation = await service.getEvaluation(user.id, id);

    return NextResponse.json({ data: updatedEvaluation });
  } catch (error) {
    console.error('[POST /api/purchase-evaluator/[id]/recalculate] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
