import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/orders/amazon/status-summary
 * Get Amazon order counts by status
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

    // Get all Amazon orders with pagination to handle >1000 orders
    const pageSize = 1000;
    let page = 0;
    let hasMore = true;
    const statusCounts: Record<string, number> = {
      Pending: 0,
      Paid: 0,
      Shipped: 0,
      Completed: 0,
      Cancelled: 0,
    };
    let total = 0;

    while (hasMore) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: orders, error } = await (supabase as any)
        .from('platform_orders')
        .select('status, internal_status')
        .eq('user_id', user.id)
        .eq('platform', 'amazon')
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (error) {
        console.error('[GET /api/orders/amazon/status-summary] Error:', error);
        return NextResponse.json({ error: 'Failed to fetch order summary' }, { status: 500 });
      }

      for (const order of orders || []) {
        total++;
        const normalizedStatus = normalizeStatus(order.internal_status || order.status);
        if (statusCounts[normalizedStatus] !== undefined) {
          statusCounts[normalizedStatus]++;
        } else {
          // Default to Pending for unknown statuses
          statusCounts.Pending++;
        }
      }

      hasMore = (orders?.length || 0) === pageSize;
      page++;
    }

    return NextResponse.json({
      data: {
        all: total,
        ...statusCounts,
      },
    });
  } catch (error) {
    console.error('[GET /api/orders/amazon/status-summary] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Normalize raw status to internal status
 */
function normalizeStatus(rawStatus: string | null): string {
  if (!rawStatus) return 'Pending';
  const lower = rawStatus.toLowerCase();

  if (lower.includes('completed') || lower.includes('received') || lower.includes('delivered'))
    return 'Completed';
  if (lower.includes('shipped') || lower.includes('dispatched')) return 'Shipped';
  if (lower.includes('packed') || lower.includes('ready')) return 'Packed';
  if (lower.includes('paid') || lower.includes('payment')) return 'Paid';
  if (lower.includes('cancel') || lower.includes('npb') || lower.includes('refund'))
    return 'Cancelled';

  return 'Pending';
}
