/**
 * Brick Owl Adapter
 *
 * Transforms Brick Owl API responses to normalized internal format.
 * Implements the Platform Adapter pattern from the architecture.
 */

import type {
  BrickOwlOrder,
  BrickOwlOrderDetail,
  BrickOwlOrderItem,
  BrickOwlItemCondition,
  NormalizedBrickOwlOrder,
  NormalizedBrickOwlOrderItem,
} from './types';
import { parseCurrencyValue } from '@/lib/utils/currency';

/**
 * Parse a Brick Owl timestamp. Detail payloads (/order/view) provide ISO
 * strings; list payloads (/order/list) only carry unix SECONDS (e.g.
 * order_date: "1783529823"). `new Date("1783529823")` is Invalid Date, which
 * silently broke every summary-path order sync — hence the explicit handling.
 */
export function parseBrickOwlTime(raw: string | number | undefined | null): Date {
  if (raw === undefined || raw === null || raw === '') return new Date(NaN);
  if (typeof raw === 'number') return new Date(raw < 1e12 ? raw * 1000 : raw);
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    const n = parseInt(trimmed, 10);
    return new Date(n < 1e12 ? n * 1000 : n);
  }
  return new Date(trimmed);
}

/**
 * Map Brick Owl order status to normalized status
 */
export function normalizeStatus(status: string): string {
  const statusMap: Record<string, string> = {
    Pending: 'Pending',
    'Payment Received': 'Paid',
    'Payment Submitted': 'Payment Submitted',
    Processing: 'Processing',
    Processed: 'Processed',
    Shipped: 'Shipped',
    Received: 'Received',
    Cancelled: 'Cancelled',
    'On Hold': 'On Hold',
  };

  return statusMap[status] || status;
}

/**
 * Map Brick Owl condition to normalized condition
 */
function normalizeCondition(condition: BrickOwlItemCondition): 'New' | 'Used' {
  // 'new' = New, 'usedn' = Used Near Mint, 'usedg' = Used Good, 'useda' = Used Acceptable
  return condition === 'new' ? 'New' : 'Used';
}

/**
 * Normalize a Brick Owl order item to internal format
 */
function normalizeOrderItem(
  item: BrickOwlOrderItem,
  currency: string
): NormalizedBrickOwlOrderItem {
  const unitPrice = parseCurrencyValue(item.unit_price || item.base_price);
  const quantity = item.ordered_quantity;

  return {
    itemNumber: item.boid,
    itemName: item.name,
    itemType: item.type,
    colorId: item.color_id ? parseInt(item.color_id, 10) : undefined,
    colorName: item.color_name,
    quantity,
    condition: normalizeCondition(item.condition),
    unitPrice,
    totalPrice: parseCurrencyValue(item.total_price) || unitPrice * quantity,
    currency,
  };
}

/**
 * Normalize a Brick Owl order to internal format
 */
export function normalizeOrder(
  order: BrickOwlOrderDetail | BrickOwlOrder,
  items: BrickOwlOrderItem[] = []
): NormalizedBrickOwlOrder {
  // Calculate financial values.
  // Live BO API uses different field names than the public docs:
  //   - `ship_total` is shipping (not `total_shipping`)
  //   - `base_order_total` is the gross paid total (not `order_total`, which is omitted)
  //   - `brickowl_fee` is the BO commission (not `sales_tax_collected_by_bo`)
  // Fall back to the documented names so legacy/cached payloads still work.
  const subtotal = parseCurrencyValue(order.sub_total || order.base_order_total);
  const total = parseCurrencyValue(
    order.order_total || order.payment_total || order.base_order_total
  );
  const shippingExplicit = parseCurrencyValue(order.ship_total || order.total_shipping);
  const shipping =
    shippingExplicit > 0
      ? shippingExplicit
      : subtotal > 0 && total > subtotal
      ? Math.round((total - subtotal) * 100) / 100
      : 0;
  const fees = parseCurrencyValue(
    order.brickowl_fee || order.sales_tax_collected_by_bo || order.tax_amount || order.total_tax
  );
  const currency = order.currency || order.base_currency || 'GBP';

  // Build shipping address
  let shippingAddress: NormalizedBrickOwlOrder['shippingAddress'];
  if (order.ship_country_code) {
    const firstName = order.ship_first_name || '';
    const lastName = order.ship_last_name || '';
    const fullName = `${firstName} ${lastName}`.trim() || order.buyer_name;

    shippingAddress = {
      name: fullName,
      address1: order.ship_street_1,
      address2: order.ship_street_2,
      city: order.ship_city,
      state: order.ship_region,
      postalCode: order.ship_post_code,
      countryCode: order.ship_country_code,
    };
  }

  // Parse order date — detail payloads have iso_order_time; list summaries
  // only have unix-seconds order_date.
  const orderDate = parseBrickOwlTime(
    order.iso_order_time ?? order.order_time ?? order.order_date
  );
  if (isNaN(orderDate.getTime())) {
    throw new Error(
      `Cannot parse Brick Owl order time (iso_order_time=${order.iso_order_time}, ` +
        `order_time=${order.order_time}, order_date=${order.order_date})`
    );
  }

  return {
    platformOrderId: order.order_id,
    platform: 'brickowl',
    orderDate,
    status: normalizeStatus(order.status),
    buyerName: order.buyer_name,
    buyerEmail: order.buyer_email,
    subtotal,
    shipping,
    fees,
    total,
    currency,
    items: items.map((item) => normalizeOrderItem(item, currency)),
    shippingAddress,
    trackingNumber: order.tracking_number,
    rawData: order as BrickOwlOrderDetail,
  };
}

/**
 * Normalize multiple orders
 */
export function normalizeOrders(
  orders: Array<{ order: BrickOwlOrderDetail | BrickOwlOrder; items?: BrickOwlOrderItem[] }>
): NormalizedBrickOwlOrder[] {
  return orders.map(({ order, items }) => normalizeOrder(order, items || []));
}

/**
 * Calculate order statistics
 */
export function calculateOrderStats(orders: NormalizedBrickOwlOrder[]): {
  totalOrders: number;
  totalRevenue: number;
  totalItems: number;
  averageOrderValue: number;
  byStatus: Record<string, number>;
} {
  const stats = {
    totalOrders: orders.length,
    totalRevenue: 0,
    totalItems: 0,
    averageOrderValue: 0,
    byStatus: {} as Record<string, number>,
  };

  for (const order of orders) {
    stats.totalRevenue += order.total;
    stats.totalItems += order.items.reduce((sum, item) => sum + item.quantity, 0);

    if (!stats.byStatus[order.status]) {
      stats.byStatus[order.status] = 0;
    }
    stats.byStatus[order.status]++;
  }

  stats.averageOrderValue = orders.length > 0 ? stats.totalRevenue / orders.length : 0;

  return stats;
}
