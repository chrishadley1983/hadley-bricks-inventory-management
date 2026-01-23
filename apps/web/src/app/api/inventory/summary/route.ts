import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { InventoryService } from '@/lib/services';
import { createPerfLogger } from '@/lib/perf';

/**
 * GET /api/inventory/summary
 * Get inventory summary statistics
 *
 * Query params:
 * - excludeSold: Set to 'true' to exclude SOLD items from totals
 * - platform: Filter by listing platform (e.g., 'AMAZON', 'EBAY')
 */
export async function GET(request: NextRequest) {
  const perf = createPerfLogger('GET /api/inventory/summary');

  try {
    const endAuth = perf.start('auth');
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    endAuth();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const excludeSold = request.nextUrl.searchParams.get('excludeSold') === 'true';
    const platform = request.nextUrl.searchParams.get('platform') || undefined;

    const service = new InventoryService(supabase, user.id);
    const endQuery = perf.start('getSummary');
    const summary = await service.getSummary({ excludeSold, platform });
    endQuery();

    perf.log('result', { totalItems: summary.totalItems });
    perf.end();

    return NextResponse.json(
      { data: summary },
      {
        headers: {
          'Cache-Control': 'private, max-age=30, stale-while-revalidate=60',
        },
      }
    );
  } catch (error) {
    console.error('[GET /api/inventory/summary] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
