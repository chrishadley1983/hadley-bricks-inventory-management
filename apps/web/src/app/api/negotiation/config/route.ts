/**
 * GET/PUT /api/negotiation/config
 *
 * Read and update negotiation configuration
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getNegotiationService } from '@/lib/ebay/negotiation.service';

const UpdateConfigSchema = z.object({
  automationEnabled: z.boolean().optional(),
  minDaysBeforeOffer: z.number().min(1).max(365).optional(),
  reOfferCooldownDays: z.number().min(1).max(90).optional(),
  reOfferEscalationPercent: z.number().min(0).max(20).optional(),
  weightListingAge: z.number().min(0).max(100).optional(),
  weightStockLevel: z.number().min(0).max(100).optional(),
  weightItemValue: z.number().min(0).max(100).optional(),
  weightCategory: z.number().min(0).max(100).optional(),
  weightWatchers: z.number().min(0).max(100).optional(),
  offerMessageTemplate: z.string().max(2000).optional(),
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

    // Get config
    const service = getNegotiationService();
    const config = await service.getConfig(user.id);

    return NextResponse.json({ data: config });
  } catch (error) {
    console.error('[GET /api/negotiation/config] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
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
    const parsed = UpdateConfigSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Validate that weights sum to 100 if any are being updated
    const updates = parsed.data;
    const weightFields = [
      'weightListingAge',
      'weightStockLevel',
      'weightItemValue',
      'weightCategory',
      'weightWatchers',
    ] as const;

    const hasWeightUpdate = weightFields.some((field) => updates[field] !== undefined);
    const service = getNegotiationService();

    if (hasWeightUpdate) {
      // Get current config to fill in missing values
      const currentConfig = await service.getConfig(user.id);

      const totalWeight =
        (updates.weightListingAge ?? currentConfig.weightListingAge) +
        (updates.weightStockLevel ?? currentConfig.weightStockLevel) +
        (updates.weightItemValue ?? currentConfig.weightItemValue) +
        (updates.weightCategory ?? currentConfig.weightCategory) +
        (updates.weightWatchers ?? currentConfig.weightWatchers);

      if (totalWeight !== 100) {
        return NextResponse.json(
          { error: `Scoring weights must sum to 100. Current sum: ${totalWeight}` },
          { status: 400 }
        );
      }

      // Validate listing age is at least 30%
      const listingAgeWeight = updates.weightListingAge ?? currentConfig.weightListingAge;
      if (listingAgeWeight < 30) {
        return NextResponse.json(
          { error: 'Listing age weight must be at least 30%' },
          { status: 400 }
        );
      }
    }

    // Update config
    const updatedConfig = await service.updateConfig(user.id, updates);

    return NextResponse.json({ data: updatedConfig });
  } catch (error) {
    console.error('[PUT /api/negotiation/config] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
