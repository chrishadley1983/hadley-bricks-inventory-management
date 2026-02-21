/**
 * PUT/DELETE /api/negotiation/rules/[id]
 *
 * Update or delete a single discount rule
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import {
  NegotiationScoringService,
  MIN_DISCOUNT_PERCENTAGE,
} from '@/lib/ebay/negotiation-scoring.service';

const UpdateRuleSchema = z
  .object({
    minScore: z.number().min(0).max(100),
    maxScore: z.number().min(0).max(100),
    discountPercentage: z.number().min(MIN_DISCOUNT_PERCENTAGE).max(50),
  })
  .refine((data) => data.minScore <= data.maxScore, {
    message: 'minScore must be less than or equal to maxScore',
  });

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    // Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse and validate body
    const body = await request.json();
    const parsed = UpdateRuleSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { minScore, maxScore, discountPercentage } = parsed.data;

    // Check rule exists and belongs to user
    const { data: existingRule, error: checkError } = await supabase
      .from('negotiation_discount_rules')
      .select('id')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (checkError || !existingRule) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }

    // Get all rules except this one to check for overlaps
    const { data: otherRules, error: fetchError } = await supabase
      .from('negotiation_discount_rules')
      .select('id, min_score, max_score, discount_percentage')
      .eq('user_id', user.id)
      .neq('id', id);

    if (fetchError) {
      throw fetchError;
    }

    // Validate no overlaps with updated rule
    const allRules = [
      ...(otherRules || []).map((r) => ({
        minScore: r.min_score,
        maxScore: r.max_score,
        discountPercentage: r.discount_percentage,
      })),
      { minScore, maxScore, discountPercentage },
    ];

    const validation = NegotiationScoringService.validateDiscountRules(allRules);
    if (!validation.valid) {
      return NextResponse.json(
        { error: 'Invalid rules configuration', details: validation.errors },
        { status: 400 }
      );
    }

    // Update rule
    const { data: updatedRule, error: updateError } = await supabase
      .from('negotiation_discount_rules')
      .update({
        min_score: minScore,
        max_score: maxScore,
        discount_percentage: discountPercentage,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    return NextResponse.json({
      data: {
        id: updatedRule.id,
        minScore: updatedRule.min_score,
        maxScore: updatedRule.max_score,
        discountPercentage: updatedRule.discount_percentage,
      },
    });
  } catch (error) {
    console.error('[PUT /api/negotiation/rules/[id]] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Delete rule (will only delete if belongs to user due to RLS)
    const { error: deleteError } = await supabase
      .from('negotiation_discount_rules')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);

    if (deleteError) {
      throw deleteError;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/negotiation/rules/[id]] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
