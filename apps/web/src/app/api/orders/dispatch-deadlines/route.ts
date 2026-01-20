import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

interface OrderWithDeadline {
  id: string;
  platformOrderId: string;
  buyerName: string | null;
  itemName: string | null;
  total: number;
  currency: string;
  dispatchBy: string;
  isOverdue: boolean;
  isUrgent: boolean;
  itemCount: number;
  platform: string;
}

interface PlatformGroup {
  platform: string;
  orders: OrderWithDeadline[];
  orderCount: number;
  earliestDeadline: string | null;
}

/**
 * GET /api/orders/dispatch-deadlines
 * Get orders grouped by platform with dispatch SLA deadlines
 * Includes both platform_orders (Amazon, etc.) and ebay_orders
 */
export async function GET(_request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const now = new Date();
    const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);

    // Fetch platform_orders awaiting dispatch with dispatch_by set
    const { data: platformOrders, error: platformOrdersError } = await supabase
      .from('platform_orders')
      .select(`
        id,
        platform_order_id,
        buyer_name,
        total,
        currency,
        dispatch_by,
        platform,
        order_items(item_name)
      `)
      .eq('user_id', user.id)
      .in('internal_status', ['Paid', 'Processing'])
      .not('dispatch_by', 'is', null)
      .order('dispatch_by', { ascending: true });

    if (platformOrdersError) {
      console.error('[GET /api/orders/dispatch-deadlines] platform_orders error:', platformOrdersError);
      return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 });
    }

    // Fetch eBay orders awaiting dispatch with dispatch_by set
    // Only include orders that are PAID (not PENDING, not refunded)
    const { data: ebayOrders, error: ebayOrdersError } = await supabase
      .from('ebay_orders')
      .select(`
        id,
        ebay_order_id,
        buyer_username,
        pricing_summary,
        dispatch_by,
        ebay_order_line_items(id, title)
      `)
      .eq('user_id', user.id)
      .in('order_fulfilment_status', ['NOT_STARTED', 'IN_PROGRESS'])
      .eq('order_payment_status', 'PAID')
      .not('dispatch_by', 'is', null)
      .order('dispatch_by', { ascending: true });

    if (ebayOrdersError) {
      console.error('[GET /api/orders/dispatch-deadlines] ebay_orders error:', ebayOrdersError);
      // Don't fail completely - just log and continue without eBay orders
    }

    // Transform and group by platform
    const platformGroups: Record<string, OrderWithDeadline[]> = {};
    let overdueCount = 0;
    let urgentCount = 0;

    // Process platform_orders (Amazon, etc.)
    for (const order of platformOrders || []) {
      if (!order.dispatch_by) continue;

      const dispatchBy = new Date(order.dispatch_by);
      const isOverdue = dispatchBy < now;
      const isUrgent = !isOverdue && dispatchBy <= twoHoursFromNow;

      if (isOverdue) overdueCount++;
      if (isUrgent) urgentCount++;

      // Get item name from first item, or join multiple item names
      const orderItems = (order as { order_items?: Array<{ item_name: string | null }> }).order_items || [];
      const itemNames = orderItems.map((i) => i.item_name).filter(Boolean) as string[];
      const itemName = itemNames.length > 0 ? itemNames[0] : null;

      const transformed: OrderWithDeadline = {
        id: order.id,
        platformOrderId: order.platform_order_id,
        buyerName: order.buyer_name,
        itemName,
        total: order.total || 0,
        currency: order.currency || 'GBP',
        dispatchBy: order.dispatch_by,
        isOverdue,
        isUrgent,
        itemCount: orderItems.length,
        platform: order.platform,
      };

      const platform = order.platform || 'other';
      if (!platformGroups[platform]) {
        platformGroups[platform] = [];
      }
      platformGroups[platform].push(transformed);
    }

    // Process eBay orders
    for (const order of ebayOrders || []) {
      if (!order.dispatch_by) continue;

      const dispatchBy = new Date(order.dispatch_by);
      const isOverdue = dispatchBy < now;
      const isUrgent = !isOverdue && dispatchBy <= twoHoursFromNow;

      if (isOverdue) overdueCount++;
      if (isUrgent) urgentCount++;

      // Extract total from pricing_summary
      const pricingSummary = order.pricing_summary as { total?: { value?: string; currency?: string } } | null;
      const total = pricingSummary?.total?.value ? parseFloat(pricingSummary.total.value) : 0;
      const currency = pricingSummary?.total?.currency || 'GBP';

      // Get item name from line items
      const lineItems = (order.ebay_order_line_items || []) as Array<{ id: string; title?: string }>;
      const itemTitles = lineItems.map((li) => li.title).filter(Boolean) as string[];
      const itemName = itemTitles.length > 0 ? itemTitles[0] : null;

      const transformed: OrderWithDeadline = {
        id: order.id,
        platformOrderId: order.ebay_order_id,
        buyerName: order.buyer_username,
        itemName,
        total,
        currency,
        dispatchBy: order.dispatch_by,
        isOverdue,
        isUrgent,
        itemCount: lineItems.length,
        platform: 'ebay',
      };

      if (!platformGroups['ebay']) {
        platformGroups['ebay'] = [];
      }
      platformGroups['ebay'].push(transformed);
    }

    // Sort orders within each platform group by dispatch_by
    for (const platform of Object.keys(platformGroups)) {
      platformGroups[platform].sort((a, b) =>
        new Date(a.dispatchBy).getTime() - new Date(b.dispatchBy).getTime()
      );
    }

    // Convert to array format
    const platforms: PlatformGroup[] = Object.entries(platformGroups).map(
      ([platform, platformOrders]) => ({
        platform,
        orders: platformOrders,
        orderCount: platformOrders.length,
        earliestDeadline: platformOrders.length > 0 ? platformOrders[0].dispatchBy : null,
      })
    );

    // Sort platforms by earliest deadline
    platforms.sort((a, b) => {
      if (!a.earliestDeadline) return 1;
      if (!b.earliestDeadline) return -1;
      return new Date(a.earliestDeadline).getTime() - new Date(b.earliestDeadline).getTime();
    });

    return NextResponse.json({
      platforms,
      overdueCount,
      urgentCount,
    });
  } catch (error) {
    console.error('[GET /api/orders/dispatch-deadlines] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
