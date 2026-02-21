/**
 * GET /api/listing-optimiser
 *
 * Get all active eBay listings with optimiser data (quality scores, review status).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  getListingOptimiserService,
  type OptimiserFilters,
} from '@/lib/ebay/listing-optimiser.service';

export async function GET(request: NextRequest) {
  try {
    // 1. Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    console.log('[GET /api/listing-optimiser] Auth check:', {
      userId: user?.id,
      authError: authError?.message,
    });

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Check eBay connection (eBay uses its own credentials table)
    const { data: credentials } = await supabase
      .from('ebay_credentials')
      .select('id')
      .eq('user_id', user.id)
      .single();

    console.log('[GET /api/listing-optimiser] eBay credentials:', {
      hasCredentials: !!credentials,
    });

    if (!credentials) {
      return NextResponse.json(
        { error: 'eBay connection required', code: 'EBAY_NOT_CONNECTED' },
        { status: 400 }
      );
    }

    // 3. Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const filters: OptimiserFilters = {
      search: searchParams.get('search') || undefined,
      minAge: searchParams.get('minAge') ? parseInt(searchParams.get('minAge')!, 10) : undefined,
      minViews: searchParams.get('minViews')
        ? parseInt(searchParams.get('minViews')!, 10)
        : undefined,
      maxViews: searchParams.get('maxViews')
        ? parseInt(searchParams.get('maxViews')!, 10)
        : undefined,
      hasWatchers:
        searchParams.get('hasWatchers') === 'true'
          ? true
          : searchParams.get('hasWatchers') === 'false'
            ? false
            : undefined,
      qualityGrade:
        (searchParams.get('qualityGrade') as OptimiserFilters['qualityGrade']) || undefined,
      reviewedStatus:
        (searchParams.get('reviewedStatus') as OptimiserFilters['reviewedStatus']) || undefined,
    };

    // 4. Get listings and summary
    console.log(
      '[GET /api/listing-optimiser] Fetching listings for user:',
      user.id,
      'with filters:',
      filters
    );
    const service = getListingOptimiserService();
    const { listings, summary } = await service.getListings(user.id, filters);

    console.log('[GET /api/listing-optimiser] Result:', { listingCount: listings.length, summary });

    // 5. Return response
    return NextResponse.json({
      data: {
        listings,
        summary,
      },
    });
  } catch (error) {
    console.error('[GET /api/listing-optimiser] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
