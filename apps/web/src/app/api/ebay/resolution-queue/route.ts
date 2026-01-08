import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/ebay/resolution-queue
 * List pending resolution queue items with match candidates
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

    // Fetch pending queue items with order details
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: queueItems, error } = await (supabase as any)
      .from('ebay_inventory_resolution_queue')
      .select(`
        id,
        sku,
        title,
        quantity,
        total_amount,
        order_date,
        status,
        resolution_reason,
        match_candidates,
        quantity_needed,
        created_at,
        ebay_order_id,
        ebay_orders!inner (
          ebay_order_id,
          buyer_username
        )
      `)
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .order('order_date', { ascending: false });

    if (error) {
      console.error('[GET /api/ebay/resolution-queue] Error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch resolution queue' },
        { status: 500 }
      );
    }

    // Get stats
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count: totalPending } = await (supabase as any)
      .from('ebay_inventory_resolution_queue')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('status', 'pending');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count: totalResolved } = await (supabase as any)
      .from('ebay_inventory_resolution_queue')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('status', 'resolved');

    return NextResponse.json({
      data: queueItems || [],
      stats: {
        pending: totalPending || 0,
        resolved: totalResolved || 0,
      },
    });
  } catch (error) {
    console.error('[GET /api/ebay/resolution-queue] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
