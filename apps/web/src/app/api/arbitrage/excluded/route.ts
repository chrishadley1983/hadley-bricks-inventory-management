/**
 * Excluded ASINs API Routes
 *
 * GET /api/arbitrage/excluded - Get all excluded ASINs
 */

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { ArbitrageService } from '@/lib/arbitrage';

// ============================================================================
// GET - Get excluded ASINs
// ============================================================================

export async function GET() {
  try {
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const service = new ArbitrageService(supabase);
    const excluded = await service.getExcludedAsins(user.id);

    return NextResponse.json({ data: excluded });
  } catch (error) {
    console.error('[GET /api/arbitrage/excluded] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
