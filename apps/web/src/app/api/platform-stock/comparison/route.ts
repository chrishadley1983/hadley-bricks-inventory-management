/**
 * Platform Stock Comparison API
 *
 * GET /api/platform-stock/comparison - Get stock comparison between platform and inventory
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { AmazonStockService } from '@/lib/platform-stock';
import type { ComparisonFilters, DiscrepancyType } from '@/lib/platform-stock';

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

    console.log(`[API /platform-stock/comparison] Authenticated user: ${user.id}, email: ${user.email}`);

    const { searchParams } = new URL(request.url);

    // Parse query parameters
    const platform = searchParams.get('platform') || 'amazon';

    // Build filters
    const filters: ComparisonFilters = {};

    const discrepancyType = searchParams.get('discrepancyType');
    if (discrepancyType && discrepancyType !== 'all') {
      filters.discrepancyType = discrepancyType as DiscrepancyType;
    }

    const search = searchParams.get('search');
    if (search) {
      filters.search = search;
    }

    // Get service based on platform
    if (platform === 'amazon') {
      // Debug: Test raw query to see what the authenticated user can see
      const { data: debugData, error: debugError } = await supabase
        .from('inventory_items')
        .select('id, set_number, listing_platform, amazon_asin, status')
        .eq('user_id', user.id)
        .eq('status', 'LISTED')
        .ilike('listing_platform', '%amazon%')
        .is('amazon_asin', null)
        .limit(10);

      console.log(`[DEBUG] User ${user.id} missing ASIN query: error=${debugError?.message || 'none'}, count=${debugData?.length || 0}`);
      if (debugData && debugData.length > 0) {
        console.log(`[DEBUG] First item:`, JSON.stringify(debugData[0]));
      }

      const service = new AmazonStockService(supabase, user.id);
      const result = await service.getStockComparison(filters);

      return NextResponse.json({
        data: {
          comparisons: result.comparisons,
          summary: result.summary,
        },
      });
    }

    // Platform not supported yet
    return NextResponse.json(
      { error: `Platform '${platform}' is not yet supported` },
      { status: 400 }
    );
  } catch (error) {
    console.error('[GET /api/platform-stock/comparison] Error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}
