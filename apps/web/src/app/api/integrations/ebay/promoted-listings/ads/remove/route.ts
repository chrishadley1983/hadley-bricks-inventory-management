import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { EbayPromotedListingsService } from '@/lib/ebay';
import { z } from 'zod';

const RemoveAdsSchema = z.object({
  campaignId: z.string().min(1),
  listingIds: z.array(z.string().min(1)).min(1),
});

/**
 * POST /api/integrations/ebay/promoted-listings/ads/remove
 * Remove listings from a campaign
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = RemoveAdsSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const service = new EbayPromotedListingsService(supabase, user.id);
    const result = await service.removeListings(parsed.data.campaignId, parsed.data.listingIds);

    return NextResponse.json(result);
  } catch (error) {
    console.error('[POST /api/integrations/ebay/promoted-listings/ads/remove] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
