/**
 * API Route: /api/cost-modelling/scenarios/[id]/draft
 * GET - Check if draft exists
 * PUT - Save draft data (auto-save)
 * DELETE - Clear draft data
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { CostModellingRepository } from '@/lib/repositories/cost-modelling.repository';
import type { CostModelScenarioFormData } from '@/types/cost-modelling';

const DraftSchema = z.object({
  name: z.string(),
  description: z.string(),
  blSalesPerMonth: z.number(),
  blAvgSaleValue: z.number(),
  blAvgPostageCost: z.number(),
  amazonSalesPerMonth: z.number(),
  amazonAvgSaleValue: z.number(),
  amazonAvgPostageCost: z.number(),
  ebaySalesPerMonth: z.number(),
  ebayAvgSaleValue: z.number(),
  ebayAvgPostageCost: z.number(),
  blFeeRate: z.number(),
  amazonFeeRate: z.number(),
  ebayFeeRate: z.number(),
  blCogPercent: z.number(),
  amazonCogPercent: z.number(),
  ebayCogPercent: z.number(),
  fixedShopify: z.number(),
  fixedEbayStore: z.number(),
  fixedSellerTools: z.number(),
  fixedAmazon: z.number(),
  fixedStorage: z.number(),
  annualAccountantCost: z.number(),
  annualMiscCosts: z.number(),
  isVatRegistered: z.boolean(),
  vatFlatRate: z.number(),
  accountantCostIfVat: z.number(),
  targetAnnualProfit: z.number(),
  personalAllowance: z.number(),
  incomeTaxRate: z.number(),
  niRate: z.number(),
  legoPartsPercent: z.number(),
  packageCosts: z
    .array(
      z.object({
        id: z.string().optional(),
        packageType: z.string(),
        postage: z.number(),
        cardboard: z.number(),
        bubbleWrap: z.number(),
        legoCard: z.number(),
        businessCard: z.number(),
      })
    )
    .optional(),
});

/**
 * GET /api/cost-modelling/scenarios/[id]/draft
 * Returns draft data if it exists
 * F48: Check for draft on page load
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

    const { data, error } = await supabase
      .from('cost_model_scenarios')
      .select('draft_data, draft_updated_at')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Scenario not found' }, { status: 404 });
      }
      throw error;
    }

    return NextResponse.json({
      hasDraft: data.draft_data !== null,
      draftData: data.draft_data,
      draftUpdatedAt: data.draft_updated_at,
    });
  } catch (error) {
    console.error('[GET /api/cost-modelling/scenarios/[id]/draft] Error:', error);
    return NextResponse.json({ error: 'Failed to check draft' }, { status: 500 });
  }
}

/**
 * PUT /api/cost-modelling/scenarios/[id]/draft
 * Saves draft data for auto-save
 * F47: Auto-save every 30 seconds
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    const parsed = DraftSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const repository = new CostModellingRepository(supabase);
    await repository.saveDraft(id, user.id, parsed.data as CostModelScenarioFormData);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PUT /api/cost-modelling/scenarios/[id]/draft] Error:', error);
    return NextResponse.json({ error: 'Failed to save draft' }, { status: 500 });
  }
}

/**
 * DELETE /api/cost-modelling/scenarios/[id]/draft
 * Clears draft data (discard draft)
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

    const repository = new CostModellingRepository(supabase);
    await repository.clearDraft(id, user.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/cost-modelling/scenarios/[id]/draft] Error:', error);
    return NextResponse.json({ error: 'Failed to clear draft' }, { status: 500 });
  }
}
