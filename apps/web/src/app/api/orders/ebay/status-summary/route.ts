import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/orders/ebay/status-summary
 * Get summary counts of eBay orders by status
 *
 * Uses separate count queries to avoid Supabase 1000 row limit.
 *
 * Query params:
 * - days: Filter to last N days (7, 30, 90, or 'all') (optional, default: 'all')
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const days = request.nextUrl.searchParams.get('days');

    // Calculate date filter
    let startDate: string | undefined;
    if (days && days !== 'all') {
      const daysNum = parseInt(days, 10);
      if (!isNaN(daysNum) && daysNum > 0) {
        const date = new Date();
        date.setDate(date.getDate() - daysNum);
        startDate = date.toISOString();
      }
    }

    // Use count queries to avoid 1000 row limit
    // Run all count queries in parallel for efficiency

    // Base query builder
    const buildQuery = () => {
      let q = supabase
        .from('ebay_orders')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id);
      if (startDate) {
        q = q.gte('creation_date', startDate);
      }
      return q;
    };

    // Count all orders
    const allQuery = buildQuery();

    // Count Refunded (payment status = FULLY_REFUNDED)
    const refundedQuery = buildQuery().eq('order_payment_status', 'FULLY_REFUNDED');

    // Count Completed/Done (fulfilment status = FULFILLED, not refunded)
    const completedQuery = buildQuery()
      .eq('order_fulfilment_status', 'FULFILLED')
      .neq('order_payment_status', 'FULLY_REFUNDED');

    // Count Packed (fulfilment status = IN_PROGRESS, not refunded)
    const packedQuery = buildQuery()
      .eq('order_fulfilment_status', 'IN_PROGRESS')
      .neq('order_payment_status', 'FULLY_REFUNDED');

    // Execute all queries in parallel
    const [allResult, refundedResult, completedResult, packedResult] = await Promise.all([
      allQuery,
      refundedQuery,
      completedQuery,
      packedQuery,
    ]);

    if (allResult.error) {
      console.error('[GET /api/orders/ebay/status-summary] Error:', allResult.error);
      return NextResponse.json({ error: 'Failed to fetch status summary' }, { status: 500 });
    }

    const all = allResult.count ?? 0;
    const refunded = refundedResult.count ?? 0;
    const completed = completedResult.count ?? 0;
    const packed = packedResult.count ?? 0;

    // Paid = All - Refunded - Completed - Packed
    const paid = all - refunded - completed - packed;

    const summary = {
      all,
      Paid: paid,
      Packed: packed,
      Completed: completed,
      Refunded: refunded,
    };

    return NextResponse.json({ data: summary });
  } catch (error) {
    console.error('[GET /api/orders/ebay/status-summary] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
