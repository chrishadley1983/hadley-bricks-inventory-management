/**
 * GET/POST /api/negotiation/rules
 *
 * List and create discount rules
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { NegotiationScoringService, MIN_DISCOUNT_PERCENTAGE } from '@/lib/ebay/negotiation-scoring.service';

const CreateRuleSchema = z.object({
  minScore: z.number().min(0).max(100),
  maxScore: z.number().min(0).max(100),
  discountPercentage: z.number().min(MIN_DISCOUNT_PERCENTAGE).max(50),
}).refine((data) => data.minScore <= data.maxScore, {
  message: 'minScore must be less than or equal to maxScore',
});

export async function GET(_request: NextRequest) {
  try {
    // Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get discount rules
    const { data: rules, error } = await supabase
      .from('negotiation_discount_rules')
      .select('*')
      .eq('user_id', user.id)
      .order('min_score', { ascending: true });

    if (error) {
      throw error;
    }

    // Map to response format
    const mappedRules = rules?.map((rule) => ({
      id: rule.id,
      minScore: rule.min_score,
      maxScore: rule.max_score,
      discountPercentage: rule.discount_percentage,
    })) || [];

    return NextResponse.json({ data: mappedRules });
  } catch (error) {
    console.error('[GET /api/negotiation/rules] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
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
    const parsed = CreateRuleSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { minScore, maxScore, discountPercentage } = parsed.data;

    // Get existing rules to check for overlaps
    const { data: existingRules, error: fetchError } = await supabase
      .from('negotiation_discount_rules')
      .select('id, min_score, max_score, discount_percentage')
      .eq('user_id', user.id);

    if (fetchError) {
      throw fetchError;
    }

    // Validate no overlaps with new rule
    const allRules = [
      ...(existingRules || []).map((r) => ({
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

    // Insert new rule
    const { data: newRule, error: insertError } = await supabase
      .from('negotiation_discount_rules')
      .insert({
        user_id: user.id,
        min_score: minScore,
        max_score: maxScore,
        discount_percentage: discountPercentage,
      })
      .select()
      .single();

    if (insertError) {
      throw insertError;
    }

    return NextResponse.json({
      data: {
        id: newRule.id,
        minScore: newRule.min_score,
        maxScore: newRule.max_score,
        discountPercentage: newRule.discount_percentage,
      },
    }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/negotiation/rules] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
