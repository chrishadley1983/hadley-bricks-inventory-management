/**
 * Excluded ASINs API Routes
 *
 * GET /api/arbitrage/excluded - Get all excluded ASINs
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ArbitrageService } from '@/lib/arbitrage';

// ============================================================================
// GET - Get excluded ASINs
// ============================================================================

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const service = new ArbitrageService(supabase);
    const excluded = await service.getExcludedAsins(user.id);

    return NextResponse.json({ data: excluded });
  } catch (error) {
    console.error('[GET /api/arbitrage/excluded] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
