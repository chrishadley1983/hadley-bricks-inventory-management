import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

interface RouteParams {
  params: Promise<{ orderId: string }>;
}

const ConfirmSchema = z.object({
  skipUnmatched: z.boolean().default(false),
});

/**
 * POST /api/orders/ebay/:orderId/confirm
 * Confirm an eBay order and update inventory
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { orderId } = await params;
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body = await request.json().catch(() => ({}));
    const parsed = ConfirmSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid parameters', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { skipUnmatched } = parsed.data;

    // Fetch order with line items
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: order, error: orderError } = await (supabase as any)
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
          total_amount,
          total_currency,
          fulfilment_status
        )
      `
      )
      .eq('id', orderId)
      .eq('user_id', user.id)
      .single();

    if (orderError) {
      if (orderError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Order not found' }, { status: 404 });
      }
      console.error('[POST /api/orders/ebay/:orderId/confirm] Error:', orderError);
      return NextResponse.json(
        { error: 'Failed to fetch order' },
        { status: 500 }
      );
    }

    // Check order is eligible for confirmation
    if (order.order_fulfilment_status === 'FULFILLED') {
      return NextResponse.json(
        { error: 'Order is already fulfilled' },
        { status: 400 }
      );
    }

    if (order.order_payment_status === 'FULLY_REFUNDED') {
      return NextResponse.json(
        { error: 'Cannot confirm a refunded order' },
        { status: 400 }
      );
    }

    // Get SKU mappings
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: skuMappings } = await (supabase as any)
      .from('ebay_sku_mappings')
      .select('ebay_sku, inventory_item_id')
      .eq('user_id', user.id);

    const mappingsMap = new Map<string, string>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (skuMappings || []).map((m: any) => [m.ebay_sku, m.inventory_item_id] as [string, string])
    );

    // Get inventory items for matching
    const skusToMatch = order.line_items
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((li: any) => li.sku)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((li: any) => li.sku);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let inventoryItems: any[] = [];
    if (skusToMatch.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from('inventory_items')
        .select('id, sku, status')
        .eq('user_id', user.id)
        .in('sku', skusToMatch);
      inventoryItems = data || [];
    }

    const inventoryBySkuMap = new Map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inventoryItems.map((item: any) => [item.sku, item])
    );

    // Check for unmatched items
    const unmatchedItems: string[] = [];
    const itemsToUpdate: Array<{
      inventoryId: string;
      lineItemId: string;
      totalAmount: number;
    }> = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const lineItem of order.line_items) {
      let inventoryId: string | null = null;

      // Check manual mapping first
      if (lineItem.sku && mappingsMap.has(lineItem.sku)) {
        inventoryId = mappingsMap.get(lineItem.sku) || null;
      }

      // Check direct SKU match
      if (!inventoryId && lineItem.sku) {
        const inventory = inventoryBySkuMap.get(lineItem.sku);
        if (inventory) {
          inventoryId = inventory.id;
        }
      }

      if (inventoryId) {
        itemsToUpdate.push({
          inventoryId,
          lineItemId: lineItem.id,
          totalAmount: lineItem.total_amount,
        });
      } else {
        unmatchedItems.push(lineItem.title || lineItem.sku || lineItem.ebay_line_item_id);
      }
    }

    // If there are unmatched items and skipUnmatched is false, return error
    if (unmatchedItems.length > 0 && !skipUnmatched) {
      return NextResponse.json(
        {
          error: 'Order has unmatched items',
          unmatchedItems,
          message: 'Please match all items or confirm with skipUnmatched: true',
        },
        { status: 400 }
      );
    }

    // Update order status
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: orderUpdateError } = await (supabase as any)
      .from('ebay_orders')
      .update({
        order_fulfilment_status: 'FULFILLED',
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId)
      .eq('user_id', user.id);

    if (orderUpdateError) {
      console.error('[POST /api/orders/ebay/:orderId/confirm] Order update error:', orderUpdateError);
      return NextResponse.json(
        { error: 'Failed to update order status' },
        { status: 500 }
      );
    }

    // Update line items status
    const lineItemIds = order.line_items.map((li: { id: string }) => li.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: lineItemUpdateError } = await (supabase as any)
      .from('ebay_order_line_items')
      .update({
        fulfilment_status: 'FULFILLED',
        updated_at: new Date().toISOString(),
      })
      .in('id', lineItemIds);

    if (lineItemUpdateError) {
      console.error('[POST /api/orders/ebay/:orderId/confirm] Line item update error:', lineItemUpdateError);
      // Non-fatal, continue
    }

    // Update inventory items
    let inventoryUpdated = 0;
    let inventorySkipped = 0;

    for (const item of itemsToUpdate) {
      // Only update if status is LISTED or AVAILABLE
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: updated, error: invError } = await (supabase as any)
        .from('inventory_items')
        .update({
          status: 'SOLD',
          sold_date: new Date().toISOString(),
          sold_price: item.totalAmount,
          sold_platform: 'ebay',
          sold_order_id: order.ebay_order_id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', item.inventoryId)
        .eq('user_id', user.id)
        .in('status', ['LISTED', 'AVAILABLE', 'Listed', 'Available'])
        .select();

      if (invError) {
        console.error('[POST /api/orders/ebay/:orderId/confirm] Inventory update error:', invError);
        inventorySkipped++;
      } else if (updated && updated.length > 0) {
        inventoryUpdated++;
      } else {
        inventorySkipped++;
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        orderId,
        ebayOrderId: order.ebay_order_id,
        status: 'FULFILLED',
        inventoryUpdated,
        inventorySkipped,
        unmatchedItems: unmatchedItems.length,
      },
    });
  } catch (error) {
    console.error('[POST /api/orders/ebay/:orderId/confirm] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
