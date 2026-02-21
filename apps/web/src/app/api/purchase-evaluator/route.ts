/**
 * Purchase Evaluator API Routes
 *
 * GET - List all evaluations for the user
 * POST - Create a new evaluation with items
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { PurchaseEvaluatorService } from '@/lib/purchase-evaluator/evaluator.service';

const CreateEvaluationSchema = z.object({
  name: z.string().optional(),
  source: z.enum(['csv_upload', 'clipboard_paste', 'photo_analysis']),
  defaultPlatform: z.enum(['amazon', 'ebay']),
  items: z
    .array(
      z.object({
        setNumber: z.string().min(1),
        setName: z.string().optional(),
        condition: z.enum(['New', 'Used']),
        quantity: z.number().int().positive().optional(),
        cost: z.number().nonnegative().optional(),
        // Photo analysis fields
        itemType: z.enum(['set', 'minifig', 'parts_lot', 'non_lego', 'unknown']).optional(),
        boxCondition: z.enum(['Mint', 'Excellent', 'Good', 'Fair', 'Poor']).optional(),
        sealStatus: z.enum(['Factory Sealed', 'Resealed', 'Open Box', 'Unknown']).optional(),
        damageNotes: z.array(z.string()).optional(),
        aiConfidenceScore: z.number().min(0).max(1).optional(),
      })
    )
    .min(1),
  totalPurchasePrice: z.number().nonnegative().optional(),
  costAllocationMethod: z.enum(['per_item', 'proportional', 'equal']).optional(),
  // Photo evaluation fields
  evaluationMode: z.enum(['cost_known', 'max_bid']).optional(),
  targetMarginPercent: z.number().min(0).max(100).optional(),
  photoAnalysisJson: z.record(z.string(), z.unknown()).optional(),
  listingDescription: z.string().optional(),
});

/**
 * GET /api/purchase-evaluator
 * List all evaluations for the authenticated user
 */
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

    const service = new PurchaseEvaluatorService(supabase);
    const evaluations = await service.getEvaluations(user.id);

    return NextResponse.json({ data: evaluations });
  } catch (error) {
    console.error('[GET /api/purchase-evaluator] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/purchase-evaluator
 * Create a new evaluation with items
 */
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
    const parsed = CreateEvaluationSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const service = new PurchaseEvaluatorService(supabase);
    const evaluation = await service.createEvaluation(user.id, parsed.data);

    return NextResponse.json({ data: evaluation }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/purchase-evaluator] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
