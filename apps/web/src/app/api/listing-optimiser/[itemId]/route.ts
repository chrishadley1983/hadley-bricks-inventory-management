/**
 * GET /api/listing-optimiser/[itemId]
 *
 * Get the latest review for a specific listing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getListingOptimiserService } from '@/lib/ebay/listing-optimiser.service';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  try {
    const { itemId } = await params;

    // 1. Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Get latest review
    const service = getListingOptimiserService();
    const review = await service.getLatestReview(user.id, itemId);

    if (!review) {
      return NextResponse.json({ error: 'No review found', code: 'NOT_FOUND' }, { status: 404 });
    }

    // 3. Return response
    return NextResponse.json({
      data: review,
    });
  } catch (error) {
    console.error('[GET /api/listing-optimiser/[itemId]] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
