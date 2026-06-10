/**
 * GET /api/negotiation/metrics
 *
 * Get dashboard metrics for negotiation offers
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
    const days = parseInt(searchParams.get('days') || '30', 10);

    // Get metrics
    const service = getNegotiationService();
    const metrics = await service.getMetrics(user.id, days);

    return NextResponse.json({ data: metrics });
  } catch (error) {
    console.error('[GET /api/negotiation/metrics] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
