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

/**
 * Map Brick Owl order status to normalized status
 */
function normalizeStatus(status: string): string {
  const statusMap: Record<string, string> = {
    'Pending': 'Pending',
    'Payment Received': 'Paid',
    'Payment Submitted': 'Payment Submitted',
    'Processing': 'Processing',
    'Processed': 'Processed',
    'Shipped': 'Shipped',
    'Received': 'Received',
    'Cancelled': 'Cancelled',
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
 * Parse a currency/price string to a number
 */
function parseCurrencyValue(value: string | undefined | null): number {
  if (!value) return 0;
  const cleaned = value.replace(/[^0-9.-]/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Normalize a Brick Owl order item to internal format
 */
function normalizeOrderItem(item: BrickOwlOrderItem, currency: string): NormalizedBrickOwlOrderItem {
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
  // Calculate financial values
  const subtotal = parseCurrencyValue(order.sub_total || order.base_order_total);
  const shipping = parseCurrencyValue(order.total_shipping);
  const fees = parseCurrencyValue(order.sales_tax_collected_by_bo || order.total_tax);
  const total = parseCurrencyValue(order.order_total);
  const currency = order.currency || 'GBP';

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

  // Parse order date - Brick Owl provides ISO format in iso_order_time
  const orderDate = new Date(order.iso_order_time || order.order_time);

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
