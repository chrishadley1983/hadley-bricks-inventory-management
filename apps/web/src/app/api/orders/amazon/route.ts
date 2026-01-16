import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const QuerySchema = z.object({
  page: z.coerce.number().positive().default(1),
  pageSize: z.coerce.number().positive().max(100).default(20),
  status: z.enum(['all', 'Pending', 'Paid', 'Shipped', 'Completed', 'Cancelled']).optional(),
  matchFilter: z.enum(['all', 'matched', 'unmatched', 'no_asin']).optional(),
  search: z.string().optional(),
  sortBy: z.enum(['order_date', 'buyer_name', 'total']).default('order_date'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

/**
 * Normalize raw status to internal status
 */
function normalizeStatus(rawStatus: string | null): string {
  if (!rawStatus) return 'Pending';
  const lower = rawStatus.toLowerCase();

  if (lower.includes('completed') || lower.includes('received') || lower.includes('delivered')) return 'Completed';
  if (lower.includes('shipped') || lower.includes('dispatched')) return 'Shipped';
  if (lower.includes('packed') || lower.includes('ready')) return 'Packed';
  if (lower.includes('paid') || lower.includes('payment')) return 'Paid';
  if (lower.includes('cancel') || lower.includes('npb') || lower.includes('refund')) return 'Cancelled';

  return 'Pending';
}

/**
 * GET /api/orders/amazon
 * List Amazon orders with items and ASIN match status
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

    // Parse query parameters
    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const parsed = QuerySchema.safeParse(searchParams);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid parameters', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { page, pageSize, status, matchFilter, search, sortBy, sortOrder } = parsed.data;
    const offset = (page - 1) * pageSize;

    // Build query for Amazon orders with items
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase as any)
      .from('platform_orders')
      .select(
        `
        *,
        items:order_items(
          id,
          item_number,
          item_name,
          quantity,
          unit_price,
          total_price,
          currency,
          condition,
          inventory_item_id,
          amazon_linked_at,
          amazon_link_method
        )
      `,
        { count: 'exact' }
      )
      .eq('user_id', user.id)
      .eq('platform', 'amazon');

    // Apply status filter
    if (status && status !== 'all') {
      // Use internal_status if available, otherwise pattern match on status
      switch (status) {
        case 'Pending':
          query = query.or('internal_status.eq.Pending,and(internal_status.is.null,status.not.ilike.%shipped%,status.not.ilike.%completed%,status.not.ilike.%cancel%,status.not.ilike.%delivered%)');
          break;
        case 'Paid':
          query = query.or('internal_status.eq.Paid,and(internal_status.is.null,or(status.ilike.%paid%,status.ilike.%payment%))');
          break;
        case 'Shipped':
          query = query.or('internal_status.eq.Shipped,and(internal_status.is.null,or(status.ilike.%shipped%,status.ilike.%dispatched%))');
          break;
        case 'Completed':
          query = query.or('internal_status.eq.Completed,and(internal_status.is.null,or(status.ilike.%completed%,status.ilike.%received%,status.ilike.%delivered%))');
          break;
        case 'Cancelled':
          query = query.or('internal_status.eq.Cancelled,and(internal_status.is.null,or(status.ilike.%cancel%,status.ilike.%refund%))');
          break;
      }
    }

    // Apply search filter
    if (search) {
      query = query.or(
        `platform_order_id.ilike.%${search}%,buyer_name.ilike.%${search}%,buyer_email.ilike.%${search}%`
      );
    }

    // Apply match filter
    // This uses inventory_link_status on platform_orders which is set during sync
    if (matchFilter && matchFilter !== 'all') {
      switch (matchFilter) {
        case 'matched':
          // Show orders where all items are linked to inventory
          query = query.eq('inventory_link_status', 'complete');
          break;
        case 'unmatched':
          // Show orders with items that have ASIN but aren't linked
          // These are orders that are pending or partial linking, excluding complete
          query = query.or('inventory_link_status.is.null,inventory_link_status.eq.pending,inventory_link_status.eq.partial');
          break;
        case 'no_asin':
          // This requires checking order_items - we'll handle this with a raw query
          // For now, include orders that may have no_asin items (not complete status)
          query = query.or('inventory_link_status.is.null,inventory_link_status.neq.complete');
          break;
      }
    }

    // Apply sorting
    const sortColumn = sortBy === 'order_date' ? 'order_date' : sortBy === 'buyer_name' ? 'buyer_name' : 'total';
    query = query.order(sortColumn, { ascending: sortOrder === 'asc', nullsFirst: false });

    // Apply pagination
    query = query.range(offset, offset + pageSize - 1);

    const { data: orders, error, count } = await query;

    if (error) {
      console.error('[GET /api/orders/amazon] Error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch Amazon orders' },
        { status: 500 }
      );
    }

    // Get all ASINs from order items to check for matches
    const allAsins = (orders || [])
      .flatMap((order: { items?: Array<{ item_number: string | null }> }) =>
        (order.items || []).map((item) => item.item_number).filter(Boolean)
      ) as string[];

    // Fetch inventory items that have matching ASINs
    let matchedAsins = new Set<string>();
    if (allAsins.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: inventoryMatches } = await (supabase as any)
        .from('inventory_items')
        .select('amazon_asin')
        .eq('user_id', user.id)
        .in('amazon_asin', allAsins)
        .in('status', ['BACKLOG', 'LISTED', 'AVAILABLE', 'Available', 'Listed']);
      matchedAsins = new Set(
        (inventoryMatches || []).map((i: { amazon_asin: string }) => i.amazon_asin).filter(Boolean)
      );
    }

    // Transform orders to include UI status and match info
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transformedOrders = (orders || []).map((order: any) => {
      const uiStatus = order.internal_status || normalizeStatus(order.status);

      // Check match status for each order item
      const itemsWithMatch = (order.items || []).map((item: {
        item_number: string | null;
        inventory_item_id: string | null;
        amazon_linked_at: string | null;
      }) => {
        // If already linked, it's matched
        if (item.amazon_linked_at) {
          return {
            ...item,
            match_status: 'linked' as const,
          };
        }

        // Check if ASIN exists in inventory
        const hasAsinMatch = item.item_number && matchedAsins.has(item.item_number);

        // Items without ASIN are considered "no_asin"
        const matchStatus = !item.item_number
          ? 'no_asin'
          : hasAsinMatch
            ? 'matched'
            : 'unmatched';

        return {
          ...item,
          match_status: matchStatus,
        };
      });

      // Calculate order-level match summary
      const itemsWithAsin = itemsWithMatch.filter(
        (item: { match_status: string }) => item.match_status !== 'no_asin'
      );
      const unmatchedCount = itemsWithAsin.filter(
        (item: { match_status: string }) => item.match_status === 'unmatched'
      ).length;
      const noAsinCount = itemsWithMatch.filter(
        (item: { match_status: string }) => item.match_status === 'no_asin'
      ).length;
      const linkedCount = itemsWithMatch.filter(
        (item: { match_status: string }) => item.match_status === 'linked'
      ).length;

      return {
        ...order,
        items: itemsWithMatch,
        ui_status: uiStatus,
        match_summary: {
          total: itemsWithMatch.length,
          unmatched: unmatchedCount,
          no_asin: noAsinCount,
          linked: linkedCount,
          all_matched: unmatchedCount === 0 && noAsinCount === 0,
        },
      };
    });

    return NextResponse.json({
      data: transformedOrders,
      pagination: {
        page,
        pageSize,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / pageSize),
      },
    });
  } catch (error) {
    console.error('[GET /api/orders/amazon] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
