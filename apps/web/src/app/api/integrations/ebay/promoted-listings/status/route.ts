import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { EbayPromotedListingsService } from '@/lib/ebay';

/**
 * GET /api/integrations/ebay/promoted-listings/status
 * Get promotion status for listings.
 *
 * Query params:
 *   listingIds - comma-separated listing IDs (optional, returns all if omitted)
 */
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

    const service = new EbayPromotedListingsService(supabase, user.id);

    const listingIdsParam = request.nextUrl.searchParams.get('listingIds');

    if (listingIdsParam) {
      // Get status for specific listings
      const listingIds = listingIdsParam.split(',').map((id) => id.trim());
      const statuses = await service.getPromotionStatus(listingIds);
      return NextResponse.json({ statuses });
    }

    // Get all promoted ads across campaigns
    const campaignAds = await service.getAllPromotedAds();
    return NextResponse.json({ campaignAds });
  } catch (error) {
    console.error('[GET /api/integrations/ebay/promoted-listings/status] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
