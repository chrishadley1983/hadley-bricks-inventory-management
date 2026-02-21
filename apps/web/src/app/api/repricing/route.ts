/**
 * Repricing API Route
 *
 * GET - Fetch repricing data with cached or fresh Amazon pricing
 * POST - Force sync pricing data (bypass cache)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createRepricingService } from '@/lib/repricing';
import type { RepricingFilters } from '@/lib/repricing';

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

    // 2. Parse query params
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '50', 10);
    const search = searchParams.get('search') || undefined;
    const showOnlyWithCost = searchParams.get('showOnlyWithCost') === 'true';
    const showOnlyBuyBoxLost = searchParams.get('showOnlyBuyBoxLost') === 'true';
    const minQuantity = parseInt(searchParams.get('minQuantity') || '1', 10);
    const forceSync = searchParams.get('forceSync') === 'true';

    const filters: RepricingFilters = {
      search,
      showOnlyWithCost,
      showOnlyBuyBoxLost,
      minQuantity,
    };

    // 3. Get repricing data (uses cache unless forceSync is true)
    const repricingService = createRepricingService(supabase, user.id);
    const data = await repricingService.getRepricingData(filters, page, pageSize, forceSync);

    return NextResponse.json({ data });
  } catch (error) {
    console.error('[GET /api/repricing] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST - Force sync pricing data (clears cache and triggers fresh fetch)
 */
export async function POST() {
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

    // 2. Clear cache
    const repricingService = createRepricingService(supabase, user.id);
    const result = await repricingService.syncPricing();

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error('[POST /api/repricing] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
