/**
 * Platform Stock Listings API
 *
 * GET /api/platform-stock - Fetch platform listings with pagination and filters
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { AmazonStockService } from '@/lib/platform-stock';
import type { ListingFilters, ListingStatus } from '@/lib/platform-stock';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);

    // Parse query parameters
    const platform = searchParams.get('platform') || 'amazon';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = Math.min(
      parseInt(searchParams.get('pageSize') || '50', 10),
      100
    );

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
        error:
          error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}
