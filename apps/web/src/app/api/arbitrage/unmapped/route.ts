/**
 * Unmapped ASINs API Routes
 *
 * GET /api/arbitrage/unmapped - Get ASINs needing manual mapping
 */

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { ArbitrageService } from '@/lib/arbitrage';

// ============================================================================
// GET - Get unmapped ASINs
// ============================================================================

export async function GET() {
  try {
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const service = new ArbitrageService(supabase);
    const unmapped = await service.getUnmappedAsins(user.id);

    return NextResponse.json({
      data: {
        items: unmapped,
        count: unmapped.length,
      },
    });
  } catch (error) {
    console.error('[GET /api/arbitrage/unmapped] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
