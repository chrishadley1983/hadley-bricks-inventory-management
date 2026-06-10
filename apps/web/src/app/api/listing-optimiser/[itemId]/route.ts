/**
 * GET /api/listing-optimiser/[itemId]
 *
 * Get the latest review for a specific listing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { getListingOptimiserService } from '@/lib/ebay/listing-optimiser.service';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  try {
    const { itemId } = await params;

    // 1. Auth check
    const { user, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

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
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
