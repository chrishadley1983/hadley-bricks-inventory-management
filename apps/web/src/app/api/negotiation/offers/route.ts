/**
 * GET /api/negotiation/offers
 *
 * List sent offers with filtering and pagination
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { getNegotiationService } from '@/lib/ebay/negotiation.service';

export async function GET(request: NextRequest) {
  try {
    // Auth check
    const { user, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    // Parse query params
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || undefined;
    const triggerType = searchParams.get('triggerType') as 'manual' | 'automated' | undefined;
    const listingId = searchParams.get('listingId') || undefined;
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;

    // Get offers
    const service = getNegotiationService();
    const { offers, total } = await service.getOffers(user.id, {
      status,
      triggerType,
      listingId,
      limit,
      offset,
      startDate,
      endDate,
    });

    return NextResponse.json({
      data: offers,
      total,
      limit,
      offset,
    });
  } catch (error) {
    console.error('[GET /api/negotiation/offers] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
