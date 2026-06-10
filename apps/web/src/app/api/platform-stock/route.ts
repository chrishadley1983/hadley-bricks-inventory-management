/**
 * Platform Stock Listings API
 *
 * GET /api/platform-stock - Fetch platform listings with pagination and filters
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { AmazonStockService } from '@/lib/platform-stock';
import type { ListingFilters, ListingStatus } from '@/lib/platform-stock';

export async function GET(request: NextRequest) {
  try {
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const { searchParams } = new URL(request.url);

    // Parse query parameters
    const platform = searchParams.get('platform') || 'amazon';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = Math.min(parseInt(searchParams.get('pageSize') || '50', 10), 100);

    // Build filters
    const filters: ListingFilters = {};

    const search = searchParams.get('search');
    if (search) {
      filters.search = search;
    }

    const status = searchParams.get('status');
    if (status && status !== 'all') {
      filters.listingStatus = status as ListingStatus;
    }

    const channel = searchParams.get('channel');
    if (channel && channel !== 'all') {
      filters.fulfillmentChannel = channel;
    }

    const hasQuantity = searchParams.get('hasQuantity');
    if (hasQuantity === 'true') {
      filters.hasQuantity = true;
    }

    // Get service based on platform
    if (platform === 'amazon') {
      const service = new AmazonStockService(supabase, user.id);

      const [listingsResult, latestImport] = await Promise.all([
        service.getListings(filters, page, pageSize),
        service.getLatestImport(),
      ]);

      return NextResponse.json({
        data: {
          listings: listingsResult.items,
          latestImport,
          pagination: listingsResult.pagination,
        },
      });
    }

    // Platform not supported yet
    return NextResponse.json(
      { error: `Platform '${platform}' is not yet supported` },
      { status: 400 }
    );
  } catch (error) {
    console.error('[GET /api/platform-stock] Error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
      },
      { status: 500 }
    );
  }
}
