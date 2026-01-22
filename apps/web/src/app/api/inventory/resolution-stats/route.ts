import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export interface ResolutionStats {
  pendingReview: number;
  unlinkedSince2026: number;
  totalUnlinked: number;
}

/**
 * GET /api/inventory/resolution-stats
 * Returns unified resolution statistics for inventory matching
 */
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

    // Run all counts in parallel for performance
    const [ebayPending, amazonPending, unlinked2026, totalUnlinked] = await Promise.all([
      // eBay pending review count
      supabase
        .from('ebay_inventory_resolution_queue')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'pending'),

      // Amazon pending review count
      supabase
        .from('amazon_inventory_resolution_queue')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'pending'),

      // Unlinked order items since Jan 2026 (when app became primary data source)
      // Uses combined function that includes both platform_orders AND eBay orders
      supabase.rpc('count_all_unlinked_order_items_since', {
        p_user_id: user.id,
        p_since_date: '2026-01-01',
      }),

      // Total unlinked order items across ALL platforms (platform_orders + eBay)
      supabase.rpc('count_total_unlinked_order_items', {
        p_user_id: user.id,
      }),
    ]);

    const stats: ResolutionStats = {
      pendingReview: (ebayPending.count ?? 0) + (amazonPending.count ?? 0),
      unlinkedSince2026: unlinked2026.data ?? 0,
      totalUnlinked: totalUnlinked.data ?? 0,
    };

    return NextResponse.json({ data: stats });
  } catch (error) {
    console.error('[GET /api/inventory/resolution-stats] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
