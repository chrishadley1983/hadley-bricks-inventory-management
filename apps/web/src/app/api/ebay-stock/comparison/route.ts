/**
 * GET /api/ebay-stock/comparison
 *
 * Get stock comparison between eBay listings and inventory.
 * Matches on SKU with condition mismatch tracking.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { EbayStockService } from '@/lib/platform-stock/ebay';
import type { ComparisonFilters, DiscrepancyType } from '@/lib/platform-stock/types';

export async function GET(request: NextRequest) {
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

    // 2. Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const discrepancyType = searchParams.get('discrepancyType') as
      | DiscrepancyType
      | 'all'
      | undefined;
    const search = searchParams.get('search') || undefined;
    const hideZeroQuantities = searchParams.get('hideZeroQuantities') === 'true';

    // 3. Build filters
    const filters: ComparisonFilters = {
      discrepancyType,
      search,
      hideZeroQuantities,
    };

    // 4. Get comparison
    const service = new EbayStockService(supabase, user.id);
    const result = await service.getStockComparison(filters);

    // 5. Return response
    return NextResponse.json({
      data: {
        comparisons: result.comparisons,
        summary: result.summary,
      },
    });
  } catch (error) {
    console.error('[GET /api/ebay-stock/comparison] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
