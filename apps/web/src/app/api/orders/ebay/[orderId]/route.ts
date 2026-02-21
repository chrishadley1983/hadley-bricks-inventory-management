import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

interface RouteParams {
  params: Promise<{ orderId: string }>;
}

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
 * GET /api/orders/ebay/:orderId
 * Get single eBay order with line items and match status
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
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

    // Fetch order with line items and fulfilments
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: order, error } = await (supabase as any)
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
          item_location,
          taxes,
          properties
        ),
        fulfilments:ebay_shipping_fulfilments(
          id,
          ebay_fulfilment_id,
          shipped_date,
          shipping_carrier_code,
          tracking_number,
          line_items
        )
      `
      )
      .eq('id', orderId)
      .eq('user_id', user.id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Order not found' }, { status: 404 });
      }
      console.error('[GET /api/orders/ebay/:orderId] Error:', error);
      return NextResponse.json({ error: 'Failed to fetch order' }, { status: 500 });
    }

    // Get SKU mappings for this user
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: skuMappings } = await (supabase as any)
      .from('ebay_sku_mappings')
      .select('ebay_sku, inventory_item_id')
      .eq('user_id', user.id);

    const mappingsMap = new Map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (skuMappings || []).map((m: any) => [m.ebay_sku, m.inventory_item_id])
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
        .select('id, sku, set_number, item_name, storage_location, status')
        .eq('user_id', user.id)
        .in('sku', skusToMatch);
      inventoryItems = data || [];
    }

    const inventoryBySkuMap = new Map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inventoryItems.map((item: any) => [item.sku, item])
    );

    // Get inventory items by manual mapping IDs
    const manualMappingIds = Array.from(mappingsMap.values());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let manuallyMappedItems: any[] = [];
    if (manualMappingIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from('inventory_items')
        .select('id, sku, set_number, item_name, storage_location, status')
        .eq('user_id', user.id)
        .in('id', manualMappingIds);
      manuallyMappedItems = data || [];
    }

    const inventoryByIdMap = new Map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      manuallyMappedItems.map((item: any) => [item.id, item])
    );

    // Enhance line items with match status
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const enhancedLineItems = order.line_items.map((lineItem: any) => {
      let matchStatus: 'matched' | 'unmatched' | 'manual' | 'no_sku' = 'unmatched';
      let matchedInventory = null;

      // Items without SKU can't be matched
      if (!lineItem.sku) {
        return {
          ...lineItem,
          match_status: 'no_sku' as const,
          matched_inventory: null,
        };
      }

      // Check manual mapping first
      if (mappingsMap.has(lineItem.sku)) {
        const inventoryId = mappingsMap.get(lineItem.sku);
        const inventory = inventoryByIdMap.get(inventoryId);
        if (inventory) {
          matchStatus = 'manual';
          matchedInventory = inventory;
        }
      }

      // Check direct SKU match
      if (matchStatus === 'unmatched') {
        const inventory = inventoryBySkuMap.get(lineItem.sku);
        if (inventory) {
          matchStatus = 'matched';
          matchedInventory = inventory;
        }
      }

      return {
        ...lineItem,
        match_status: matchStatus,
        matched_inventory: matchedInventory,
      };
    });

    // Parse shipping address from fulfilment_instructions
    let shippingAddress = null;
    if (order.fulfilment_instructions?.shippingInstructions?.shipTo) {
      const shipTo = order.fulfilment_instructions.shippingInstructions.shipTo;
      shippingAddress = {
        name:
          shipTo.fullName ||
          `${shipTo.contactAddress?.firstName || ''} ${shipTo.contactAddress?.lastName || ''}`.trim(),
        addressLine1: shipTo.contactAddress?.addressLine1,
        addressLine2: shipTo.contactAddress?.addressLine2,
        city: shipTo.contactAddress?.city,
        stateOrProvince: shipTo.contactAddress?.stateOrProvince,
        postalCode: shipTo.contactAddress?.postalCode,
        country: shipTo.contactAddress?.countryCode,
        phoneNumber: shipTo.primaryPhone?.phoneNumber,
      };
    }

    // Transform the order
    const transformedOrder = {
      ...order,
      line_items: enhancedLineItems,
      ui_status: mapEbayStatusToUI(order.order_fulfilment_status, order.order_payment_status),
      total: order.pricing_summary?.total?.value || 0,
      currency: order.pricing_summary?.total?.currency || 'GBP',
      shipping_address: shippingAddress,
      shipping_service: order.fulfilment_instructions?.shippingInstructions
        ?.minEstimatedDeliveryDate
        ? `Estimated delivery: ${order.fulfilment_instructions.shippingInstructions.minEstimatedDeliveryDate}`
        : null,
    };

    return NextResponse.json({ data: transformedOrder });
  } catch (error) {
    console.error('[GET /api/orders/ebay/:orderId] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
