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

    // Get all SKUs from line items to check for matches
    const allSkus = (orders || [])
      .flatMap((order: { line_items?: Array<{ sku: string | null }> }) =>
        (order.line_items || []).map((li) => li.sku).filter(Boolean)
      ) as string[];

    // Fetch SKU mappings for this user
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: skuMappings } = await (supabase as any)
      .from('ebay_sku_mappings')
      .select('ebay_sku')
      .eq('user_id', user.id);
    const mappedSkus = new Set((skuMappings || []).map((m: { ebay_sku: string }) => m.ebay_sku));

    // Fetch inventory items that match SKUs directly
    let matchedInventorySkus = new Set<string>();
    if (allSkus.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: inventoryMatches } = await (supabase as any)
        .from('inventory_items')
        .select('sku')
        .eq('user_id', user.id)
        .in('sku', allSkus);
      matchedInventorySkus = new Set(
        (inventoryMatches || []).map((i: { sku: string }) => i.sku)
      );
    }

    // Transform orders to include mapped status and match info
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transformedOrders = (orders || []).map((order: any) => {
      const uiStatus = mapEbayStatusToUI(
        order.order_fulfilment_status,
        order.order_payment_status
      );

      // Check match status for each line item
      const lineItemsWithMatch = (order.line_items || []).map((li: { sku: string | null }) => {
        const hasMapping = li.sku && mappedSkus.has(li.sku);
        const hasDirectMatch = li.sku && matchedInventorySkus.has(li.sku);
        // Items without SKU are considered "no_sku" - can't be matched
        const matchStatus = !li.sku
          ? 'no_sku'
          : hasMapping
            ? 'manual'
            : hasDirectMatch
              ? 'matched'
              : 'unmatched';
        return {
          ...li,
          match_status: matchStatus,
        };
      });

      // Calculate order-level match summary
      // Only count items WITH SKUs that are unmatched (items without SKUs can't be linked via SKU)
      const itemsWithSku = lineItemsWithMatch.filter(
        (li: { match_status: string }) => li.match_status !== 'no_sku'
      );
      const unmatchedCount = itemsWithSku.filter(
        (li: { match_status: string }) => li.match_status === 'unmatched'
      ).length;
      const noSkuCount = lineItemsWithMatch.filter(
        (li: { match_status: string }) => li.match_status === 'no_sku'
      ).length;

      return {
        ...order,
        line_items: lineItemsWithMatch,
        ui_status: uiStatus,
        total: order.pricing_summary?.total?.value || 0,
        currency: order.pricing_summary?.total?.currency || 'GBP',
        match_summary: {
          total: lineItemsWithMatch.length,
          unmatched: unmatchedCount,
          no_sku: noSkuCount,
          all_matched: unmatchedCount === 0 && noSkuCount === 0,
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
    console.error('[GET /api/orders/ebay] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
