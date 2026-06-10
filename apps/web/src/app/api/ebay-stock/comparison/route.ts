/**
 * GET /api/ebay-stock/comparison
 *
 * Get stock comparison between eBay listings and inventory.
 * Matches on SKU with condition mismatch tracking.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { EbayStockService } from '@/lib/platform-stock/ebay';
import { EbayAuthService } from '@/lib/ebay/ebay-auth.service';
import type { ComparisonFilters, DiscrepancyType } from '@/lib/platform-stock/types';

export async function GET(request: NextRequest) {
  try {
    // 1. Auth check
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

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
    const service = new EbayStockService(supabase, user.id, new EbayAuthService());
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
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
