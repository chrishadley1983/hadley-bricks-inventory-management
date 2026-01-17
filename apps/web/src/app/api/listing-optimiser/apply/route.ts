/**
 * POST /api/listing-optimiser/apply
 *
 * Apply an approved change to an eBay listing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getListingOptimiserService } from '@/lib/ebay/listing-optimiser.service';
import type { ListingSuggestion } from '@/lib/ai/prompts/analyse-listing';

const SuggestionSchema = z.object({
  category: z.enum(['title', 'itemSpecifics', 'description', 'condition', 'seo']),
  field: z.string(),
  priority: z.enum(['high', 'medium', 'low']),
  issue: z.string(),
  currentValue: z.string(),
  suggestedValue: z.string(),
  explanation: z.string(),
});

const ApplyRequestSchema = z.object({
  itemId: z.string().min(1, 'Item ID required'),
  suggestion: SuggestionSchema,
});

export async function POST(request: NextRequest) {
  try {
    // 1. Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Validate input
    const body = await request.json();
    const parsed = ApplyRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { itemId, suggestion } = parsed.data;

    // 3. Check eBay connection (eBay uses its own credentials table)
    const { data: credentials } = await supabase
      .from('ebay_credentials')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (!credentials) {
      return NextResponse.json(
        { error: 'eBay connection required', code: 'EBAY_NOT_CONNECTED' },
        { status: 400 }
      );
    }

    // 4. Initialise service
    const service = getListingOptimiserService();
    const initSuccess = await service.init(user.id);
    if (!initSuccess) {
      return NextResponse.json(
        { error: 'Failed to initialise eBay connection' },
        { status: 500 }
      );
    }

    // 5. Apply the change
    console.log(`[POST /api/listing-optimiser/apply] Applying change to ${itemId}`);
    const result = await service.applyChange(user.id, itemId, suggestion as ListingSuggestion);

    // 6. Return response
    if (!result.success) {
      return NextResponse.json(
        {
          error: result.errorMessage || 'Failed to apply change',
          code: result.errorCode,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      data: {
        success: true,
        itemId: result.itemId,
        message: 'Change applied successfully',
      },
    });
  } catch (error) {
    console.error('[POST /api/listing-optimiser/apply] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
