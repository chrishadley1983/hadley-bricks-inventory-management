import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/orders/ebay/status-summary
 * Get summary counts of eBay orders by status
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

    // Build query
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase as any)
      .from('ebay_orders')
      .select('order_fulfilment_status, order_payment_status')
      .eq('user_id', user.id);

    if (startDate) {
      query = query.gte('creation_date', startDate);
    }

    const { data: orders, error } = await query;

    if (error) {
      console.error('[GET /api/orders/ebay/status-summary] Error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch status summary' },
        { status: 500 }
      );
    }

    // Count by UI status
    const summary = {
      all: orders?.length || 0,
      Paid: 0,
      Packed: 0,
      Completed: 0,
      Refunded: 0,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const order of orders || []) {
      if (order.order_payment_status === 'FULLY_REFUNDED') {
        summary.Refunded++;
      } else if (order.order_fulfilment_status === 'FULFILLED') {
        summary.Completed++;
      } else if (order.order_fulfilment_status === 'IN_PROGRESS') {
        summary.Packed++;
      } else {
        summary.Paid++;
      }
    }

    return NextResponse.json({ data: summary });
  } catch (error) {
    console.error('[GET /api/orders/ebay/status-summary] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
