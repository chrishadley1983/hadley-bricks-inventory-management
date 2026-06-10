import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { EbayPromotedListingsService } from '@/lib/ebay';

/**
 * GET /api/integrations/ebay/promoted-listings/campaigns
 * List all CPS (Promoted Listings Standard) campaigns
 */
export async function GET() {
  try {
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const service = new EbayPromotedListingsService(supabase, user.id);
    const campaigns = await service.getCampaigns();

    return NextResponse.json({ campaigns });
  } catch (error) {
    console.error('[GET /api/integrations/ebay/promoted-listings/campaigns] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
