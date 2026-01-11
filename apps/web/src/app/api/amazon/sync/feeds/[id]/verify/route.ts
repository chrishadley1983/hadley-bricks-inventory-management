/**
 * Amazon Feed Price Verification API
 *
 * POST /api/amazon/sync/feeds/[id]/verify
 *
 * Triggers price verification for a feed in done_verifying status.
 * Amazon takes up to 30 minutes to apply prices to new listings.
 * This endpoint queries the Amazon Listings API to check if the
 * submitted price is now visible.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { AmazonSyncService } from '@/lib/amazon/amazon-sync.service';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: feedId } = await params;
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const syncService = new AmazonSyncService(supabase, user.id);
    const result = await syncService.verifyFeedPrices(feedId);

    return NextResponse.json({
      feed: result.feed,
      allVerified: result.allVerified,
      itemResults: result.itemResults,
      message: result.allVerified
        ? 'All prices verified successfully'
        : 'Some prices are still pending verification',
    });
  } catch (error) {
    console.error('[POST /api/amazon/sync/feeds/[id]/verify] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to verify feed prices',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
