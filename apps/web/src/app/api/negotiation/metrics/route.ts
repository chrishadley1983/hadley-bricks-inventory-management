/**
 * GET /api/negotiation/metrics
 *
 * Get dashboard metrics for negotiation offers
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getNegotiationService } from '@/lib/ebay/negotiation.service';

export async function GET(request: NextRequest) {
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
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
