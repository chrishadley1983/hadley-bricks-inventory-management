/**
 * API Route: /api/cost-modelling/scenarios/[id]
 * GET - Get single scenario with package costs
 * PUT - Update scenario
 * DELETE - Delete scenario
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import {
  CostModellingRepository,
  scenarioToFormData,
} from '@/lib/repositories/cost-modelling.repository';

const UpdateScenarioSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),

  // Sales Volume & Pricing
  blSalesPerMonth: z.number().min(0).optional(),
  blAvgSaleValue: z.number().min(0).optional(),
  blAvgPostageCost: z.number().min(0).optional(),
  amazonSalesPerMonth: z.number().min(0).optional(),
  amazonAvgSaleValue: z.number().min(0).optional(),
  amazonAvgPostageCost: z.number().min(0).optional(),
  ebaySalesPerMonth: z.number().min(0).optional(),
  ebayAvgSaleValue: z.number().min(0).optional(),
  ebayAvgPostageCost: z.number().min(0).optional(),

  // Fee Rates
  blFeeRate: z.number().min(0).max(1).optional(),
  amazonFeeRate: z.number().min(0).max(1).optional(),
  ebayFeeRate: z.number().min(0).max(1).optional(),

  // COG Percentages
  blCogPercent: z.number().min(0).max(1).optional(),
  amazonCogPercent: z.number().min(0).max(1).optional(),
  ebayCogPercent: z.number().min(0).max(1).optional(),

  // Fixed Costs
  fixedShopify: z.number().min(0).optional(),
  fixedEbayStore: z.number().min(0).optional(),
  fixedSellerTools: z.number().min(0).optional(),
  fixedAmazon: z.number().min(0).optional(),
  fixedStorage: z.number().min(0).optional(),
  annualAccountantCost: z.number().min(0).optional(),
  annualMiscCosts: z.number().min(0).optional(),

  // VAT Settings
  isVatRegistered: z.boolean().optional(),
  vatFlatRate: z.number().min(0).max(1).optional(),
  accountantCostIfVat: z.number().min(0).optional(),

  // Tax Settings
  targetAnnualProfit: z.number().min(0).optional(),
  personalAllowance: z.number().min(0).optional(),
  incomeTaxRate: z.number().min(0).max(1).optional(),
  niRate: z.number().min(0).max(1).optional(),

  // Lego Parts
  legoPartsPercent: z.number().min(0).max(1).optional(),
  legoPartsPercentBl: z.number().min(0).max(1).optional(),

  // Package Costs
  packageCosts: z
    .array(
      z.object({
        packageType: z.enum([
          'large_parcel_amazon',
          'small_parcel_amazon',
          'large_letter_amazon',
          'large_parcel_ebay',
          'small_parcel_ebay',
          'large_letter_ebay',
        ]),
        postage: z.number().min(0),
        cardboard: z.number().min(0),
        bubbleWrap: z.number().min(0),
        legoCard: z.number().min(0),
        businessCard: z.number().min(0),
      })
    )
    .optional(),

  // For conflict detection
  knownUpdatedAt: z.string().optional(),
});

/**
 * GET /api/cost-modelling/scenarios/[id]
 * Returns full scenario with package costs
 * F4: Load all data for form
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

    const repository = new CostModellingRepository(supabase);
    const scenario = await repository.findById(id);

    if (!scenario) {
      return NextResponse.json({ error: 'Scenario not found' }, { status: 404 });
    }

    // Ensure user owns scenario (RLS should handle this, but double-check)
    if (scenario.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Convert to form data format for client
    const formData = scenarioToFormData(scenario);

    return NextResponse.json({
      data: {
        ...scenario,
        formData,
      },
    });
  } catch (error) {
    console.error('[GET /api/cost-modelling/scenarios/[id]] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch scenario' }, { status: 500 });
  }
}

/**
 * PUT /api/cost-modelling/scenarios/[id]
 * Updates scenario and package costs
 * F5: Returns 200 on success
 * E7: Checks for concurrent edit conflict
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
    const parsed = UpdateScenarioSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const repository = new CostModellingRepository(supabase);

    // E7: Check for concurrent edit conflict
    if (parsed.data.knownUpdatedAt) {
      const hasConflict = await repository.checkConflict(id, parsed.data.knownUpdatedAt);
      if (hasConflict) {
        return NextResponse.json(
          {
            error: 'Conflict',
            message: 'This scenario was modified elsewhere. Please refresh and try again.',
          },
          { status: 409 }
        );
      }
    }

    // Remove conflict detection field before update
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { knownUpdatedAt: _, ...updateData } = parsed.data;

    const scenario = await repository.update(id, updateData, user.id);

    // Clear draft after successful save
    await repository.clearDraft(id, user.id);

    return NextResponse.json({ data: scenario });
  } catch (error) {
    console.error('[PUT /api/cost-modelling/scenarios/[id]] Error:', error);

    if (error instanceof Error && error.message.includes('duplicate')) {
      return NextResponse.json(
        { error: 'A scenario with this name already exists' },
        { status: 409 }
      );
    }

    return NextResponse.json({ error: 'Failed to update scenario' }, { status: 500 });
  }
}

/**
 * DELETE /api/cost-modelling/scenarios/[id]
 * Deletes scenario
 * F7: Returns 200 on success
 * E5: Prevents deletion of last scenario
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

    // E5: Check if this is the last scenario
    const count = await repository.getScenarioCount(user.id);
    if (count <= 1) {
      return NextResponse.json({ error: 'Cannot delete the last scenario' }, { status: 400 });
    }

    await repository.delete(id, user.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/cost-modelling/scenarios/[id]] Error:', error);
    return NextResponse.json({ error: 'Failed to delete scenario' }, { status: 500 });
  }
}
