import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { EbayPromotedListingsService } from '@/lib/ebay';
import { z } from 'zod';

const UpdateBidSchema = z.object({
  campaignId: z.string().min(1),
  listings: z.array(
    z.object({
      listingId: z.string().min(1),
      bidPercentage: z
        .string()
        .refine(
          (val) => {
            const num = parseFloat(val);
            return !isNaN(num) && num >= 2.0 && num <= 100.0 && /^\d+(\.\d)?$/.test(val);
          },
          { message: 'bidPercentage must be 2.0-100.0 with single decimal precision (e.g. 4.1, 5.0)' }
        ),
    })
  ).min(1),
});

/**
 * POST /api/integrations/ebay/promoted-listings/ads/update
 * Update bid percentages for listings in a campaign
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
    const parsed = UpdateBidSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const service = new EbayPromotedListingsService(supabase, user.id);
    const result = await service.updateBidPercentages(
      parsed.data.campaignId,
      parsed.data.listings
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error('[POST /api/integrations/ebay/promoted-listings/ads/update] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
