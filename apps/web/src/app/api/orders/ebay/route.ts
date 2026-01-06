import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const QuerySchema = z.object({
  page: z.coerce.number().positive().default(1),
  pageSize: z.coerce.number().positive().max(100).default(20),
  status: z.enum(['all', 'Paid', 'Packed', 'Completed', 'Refunded', 'Cancelled']).optional(),
  search: z.string().optional(),
  sortBy: z.enum(['creation_date', 'buyer_username', 'total']).default('creation_date'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

/**
 * Map eBay status to UI display status
 */
function mapEbayStatusToUI(
  fulfilmentStatus: string,
  paymentStatus: string
): 'Paid' | 'Packed' | 'Completed' | 'Refunded' {
  if (paymentStatus === 'FULLY_REFUNDED') {
    return 'Refunded';
  }
  if (fulfilmentStatus === 'FULFILLED') {
    return 'Completed';
  }
  if (fulfilmentStatus === 'IN_PROGRESS') {
    return 'Packed';
  }
  return 'Paid';
}

/**
 * GET /api/orders/ebay
 * List eBay orders with filters and pagination
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

    const { page, pageSize, status, search, sortBy, sortOrder } = parsed.data;
    const offset = (page - 1) * pageSize;

    // Build query
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase as any)
      .from('ebay_orders')
      .select(
        `
        *,
        line_items:ebay_order_line_items(
          id,
          ebay_line_item_id,
          sku,
          title,
          quantity,
          line_item_cost_amount,
          line_item_cost_currency,
          total_amount,
          total_currency,
          fulfilment_status,
          item_location
        ),
        fulfilments:ebay_shipping_fulfilments(
          id,
          ebay_fulfilment_id,
          shipped_date,
          shipping_carrier_code,
          tracking_number
        )
      `,
        { count: 'exact' }
      )
      .eq('user_id', user.id);

    // Apply status filter
    if (status && status !== 'all') {
      switch (status) {
        case 'Paid':
          query = query
            .eq('order_fulfilment_status', 'NOT_STARTED')
            .neq('order_payment_status', 'FULLY_REFUNDED');
          break;
        case 'Packed':
          query = query.eq('order_fulfilment_status', 'IN_PROGRESS');
          break;
        case 'Completed':
          query = query.eq('order_fulfilment_status', 'FULFILLED');
          break;
        case 'Refunded':
        case 'Cancelled':
          query = query.eq('order_payment_status', 'FULLY_REFUNDED');
          break;
      }
    }

    // Apply search filter
    if (search) {
      query = query.or(
        `ebay_order_id.ilike.%${search}%,buyer_username.ilike.%${search}%`
      );
    }

    // Apply sorting
    const sortColumn =
      sortBy === 'creation_date'
        ? 'creation_date'
        : sortBy === 'buyer_username'
          ? 'buyer_username'
          : 'pricing_summary->total->value';
    query = query.order(sortColumn, { ascending: sortOrder === 'asc' });

    // Apply pagination
    query = query.range(offset, offset + pageSize - 1);

    const { data: orders, error, count } = await query;

    if (error) {
      console.error('[GET /api/orders/ebay] Error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch eBay orders' },
        { status: 500 }
      );
    }

    // Transform orders to include mapped status
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transformedOrders = (orders || []).map((order: any) => ({
      ...order,
      ui_status: mapEbayStatusToUI(
        order.order_fulfilment_status,
        order.order_payment_status
      ),
      total: order.pricing_summary?.total?.value || 0,
      currency: order.pricing_summary?.total?.currency || 'GBP',
    }));

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
    console.error('[GET /api/orders/ebay] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
