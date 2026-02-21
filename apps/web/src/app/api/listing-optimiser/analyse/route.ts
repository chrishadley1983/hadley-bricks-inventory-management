/**
 * POST /api/listing-optimiser/analyse
 *
 * Analyse one or more listings for quality and pricing optimization.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getListingOptimiserService } from '@/lib/ebay/listing-optimiser.service';

const AnalyseRequestSchema = z.object({
  itemIds: z.array(z.string()).min(1, 'At least one item ID required'),
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
    const parsed = AnalyseRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { itemIds } = parsed.data;

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

    // 4. Check Gemini is configured
    const service = getListingOptimiserService();
    if (!service.isGeminiConfigured()) {
      return NextResponse.json(
        { error: 'Gemini API not configured', code: 'GEMINI_NOT_CONFIGURED' },
        { status: 400 }
      );
    }

    // 5. Initialise service with eBay credentials
    const initSuccess = await service.init(user.id);
    if (!initSuccess) {
      return NextResponse.json({ error: 'Failed to initialise eBay connection' }, { status: 500 });
    }

    // 6. Analyse listings (process sequentially to avoid API rate limits)
    const results = [];
    const errors = [];

    for (const itemId of itemIds) {
      try {
        console.log(`[POST /api/listing-optimiser/analyse] Analysing ${itemId}`);
        const result = await service.analyseListing(user.id, itemId);
        results.push(result);
      } catch (error) {
        console.error(`[POST /api/listing-optimiser/analyse] Error for ${itemId}:`, error);
        errors.push({
          itemId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // 7. Return response
    return NextResponse.json({
      data: {
        results,
        errors,
        summary: {
          total: itemIds.length,
          successful: results.length,
          failed: errors.length,
        },
      },
    });
  } catch (error) {
    console.error('[POST /api/listing-optimiser/analyse] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
