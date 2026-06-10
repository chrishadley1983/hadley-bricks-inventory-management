/**
 * GET /api/ebay-stock
 *
 * List eBay listings with pagination and filtering.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { EbayStockService } from '@/lib/platform-stock/ebay';
import { EbayAuthService } from '@/lib/ebay/ebay-auth.service';
import type { ListingFilters, ListingStatus } from '@/lib/platform-stock/types';

export async function GET(request: NextRequest) {
  try {
    // 1. Auth check
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    // 2. Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = Math.min(parseInt(searchParams.get('pageSize') || '50', 10), 100);
    const search = searchParams.get('search') || undefined;
    const status = searchParams.get('status') as ListingStatus | 'all' | undefined;
    const hasQuantity = searchParams.get('hasQuantity') === 'true';
    const sortColumn = searchParams.get('sortColumn') as ListingFilters['sort'] extends {
      column: infer C;
    }
      ? C
      : never;
    const sortDirection = searchParams.get('sortDirection') as 'asc' | 'desc' | null;

    // 3. Build filters
    const filters: ListingFilters = {
      search,
      listingStatus: status,
      hasQuantity: hasQuantity || undefined,
      sort:
        sortColumn && sortDirection ? { column: sortColumn, direction: sortDirection } : undefined,
    };

    // 4. Get listings
    const service = new EbayStockService(supabase, user.id, new EbayAuthService());
    const result = await service.getListings(filters, page, pageSize);
    const latestImport = await service.getLatestImport();

    // 5. Return response
    return NextResponse.json({
      data: {
        listings: result.items,
        latestImport,
        pagination: result.pagination,
      },
    });
  } catch (error) {
    console.error('[GET /api/ebay-stock] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
