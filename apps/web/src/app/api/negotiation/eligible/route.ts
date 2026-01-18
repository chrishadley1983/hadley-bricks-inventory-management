/**
 * GET /api/negotiation/eligible
 *
 * Fetch eligible listings with scores for negotiation offers
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getNegotiationService } from '@/lib/ebay/negotiation.service';

export async function GET(_request: NextRequest) {
  try {
    // Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
