import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { fetchAllRecords } from '@/lib/supabase/pagination';

/**
 * GET /api/orders/amazon/status-summary
 * Get Amazon order counts by status
 */
export async function GET() {
  try {
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    // Get all Amazon orders with pagination to handle >1000 orders
    const statusCounts: Record<string, number> = {
      Pending: 0,
      Paid: 0,
      Shipped: 0,
      Completed: 0,
      Cancelled: 0,
    };
    let total = 0;

    const orders = (await fetchAllRecords(supabase, 'platform_orders', {
      select: 'status, internal_status',
      eq: { user_id: user.id, platform: 'amazon' },
    })) as unknown as Array<{ status: string | null; internal_status: string | null }>;

    for (const order of orders) {
      total++;
      const normalizedStatus = normalizeStatus(order.internal_status || order.status);
      if (statusCounts[normalizedStatus] !== undefined) {
        statusCounts[normalizedStatus]++;
      } else {
        // Default to Pending for unknown statuses
        statusCounts.Pending++;
      }
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
      { error: 'Internal server error' },
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
