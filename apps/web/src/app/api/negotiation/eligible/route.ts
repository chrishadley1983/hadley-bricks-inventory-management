/**
 * GET /api/negotiation/eligible
 *
 * Fetch eligible listings with scores for negotiation offers
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { getNegotiationService } from '@/lib/ebay/negotiation.service';

export async function GET(_request: NextRequest) {
  try {
    // Auth check
    const { user, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    // Get eligible items
    const service = getNegotiationService();
    const initialized = await service.init(user.id);

    if (!initialized) {
      return NextResponse.json(
        { error: 'Failed to connect to eBay. Please check your eBay connection.' },
        { status: 503 }
      );
    }

    const eligibleItems = await service.getEligibleItems(user.id);

    return NextResponse.json({
      data: eligibleItems,
      total: eligibleItems.length,
    });
  } catch (error) {
    console.error('[GET /api/negotiation/eligible] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
