import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { EbayPromotedListingsService } from '@/lib/ebay';

/**
 * GET /api/integrations/ebay/promoted-listings/campaigns
 * List all CPS (Promoted Listings Standard) campaigns
 */
export async function GET() {
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
    const campaigns = await service.getCampaigns();

    return NextResponse.json({ campaigns });
  } catch (error) {
    console.error('[GET /api/integrations/ebay/promoted-listings/campaigns] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
