/**
 * GET /api/ebay/listing-refresh/eligible
 *
 * Get listings eligible for refresh (older than specified days)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { EbayListingRefreshService } from '@/lib/ebay/ebay-listing-refresh.service';
import type { EligibleListingFilters } from '@/lib/ebay/listing-refresh.types';

export async function GET(request: NextRequest) {
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

    // Parse query params for filters
    const searchParams = request.nextUrl.searchParams;
    const filters: EligibleListingFilters = {};

    const minAge = searchParams.get('minAge');
    if (minAge) {
      filters.minAge = parseInt(minAge, 10);
    }

    const maxPrice = searchParams.get('maxPrice');
    if (maxPrice) {
      filters.maxPrice = parseFloat(maxPrice);
    }

    const minPrice = searchParams.get('minPrice');
    if (minPrice) {
      filters.minPrice = parseFloat(minPrice);
    }

    const condition = searchParams.get('condition');
    if (condition) {
      filters.condition = condition;
    }

    const hasWatchers = searchParams.get('hasWatchers');
    if (hasWatchers === 'true') {
      filters.hasWatchers = true;
    }

    const minWatchers = searchParams.get('minWatchers');
    if (minWatchers) {
      filters.minWatchers = parseInt(minWatchers, 10);
    }

    const search = searchParams.get('search');
    if (search) {
      filters.search = search;
    }

    // Fetch eligible listings
    const service = new EbayListingRefreshService(supabase, user.id);
    const listings = await service.getEligibleListings(filters);

    return NextResponse.json({
      data: listings,
      count: listings.length,
    });
  } catch (error) {
    console.error('[GET /api/ebay/listing-refresh/eligible] Error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
