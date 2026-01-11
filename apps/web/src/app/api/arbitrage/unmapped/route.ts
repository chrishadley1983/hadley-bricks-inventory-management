/**
 * Unmapped ASINs API Routes
 *
 * GET /api/arbitrage/unmapped - Get ASINs needing manual mapping
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ArbitrageService } from '@/lib/arbitrage';

// ============================================================================
// GET - Get unmapped ASINs
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
    const unmapped = await service.getUnmappedAsins(user.id);

    return NextResponse.json({
      data: {
        items: unmapped,
        count: unmapped.length,
      },
    });
  } catch (error) {
    console.error('[GET /api/arbitrage/unmapped] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
