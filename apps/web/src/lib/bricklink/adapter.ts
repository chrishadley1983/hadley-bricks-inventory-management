/**
 * BrickLink Adapter
 *
 * Transforms BrickLink API responses to normalized internal format.
 * Implements the Platform Adapter pattern from the architecture.
 */

import type {
  BrickLinkOrderDetail,
  BrickLinkOrderItem,
  BrickLinkOrderSummary,
  NormalizedOrder,
  NormalizedOrderItem,
} from './types';

/**
 * Map BrickLink order status to normalized status
 */
function normalizeStatus(status: string): string {
  const statusMap: Record<string, string> = {
    PENDING: 'Pending',
    UPDATED: 'Updated',
    PROCESSING: 'Processing',
    READY: 'Ready',
    PAID: 'Paid',
    PACKED: 'Packed',
    SHIPPED: 'Shipped',
    RECEIVED: 'Received',
    COMPLETED: 'Completed',
    OCR: 'Order Cancelled (Refund)',
    NPB: 'Non-Paying Buyer',
    NPX: 'Non-Paying Buyer (Expired)',
    NRS: 'Non-Responding Seller',
    NSS: 'Non-Shipping Seller',
    CANCELLED: 'Cancelled',
  };

  return statusMap[status] || status;
}

/**
 * Parse a currency string to a number
 */
function parseCurrencyValue(value: string | undefined | null): number {
  if (!value) return 0;
  const cleaned = value.replace(/[^0-9.-]/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Normalize a BrickLink order item to internal format
 */
function normalizeOrderItem(item: BrickLinkOrderItem): NormalizedOrderItem {
  const unitPrice = parseCurrencyValue(item.unit_price_final || item.unit_price);
  const quantity = item.quantity;

  return {
    itemNumber: item.item.no,
    itemName: item.item.name,
    itemType: item.item.type,
    colorId: item.color_id,
    colorName: item.color_name,
    quantity,
    condition: item.new_or_used === 'N' ? 'New' : 'Used',
    unitPrice,
    totalPrice: unitPrice * quantity,
    currency: item.currency_code,
  };
}

/**
 * Normalize a BrickLink order to internal format
 */
export function normalizeOrder(
  order: BrickLinkOrderDetail | BrickLinkOrderSummary,
  items: BrickLinkOrderItem[] = []
): NormalizedOrder {
  const cost = order.cost;

  // Calculate financial values
  const subtotal = parseCurrencyValue(cost.subtotal);
  const shipping = parseCurrencyValue(cost.shipping);
  const fees = parseCurrencyValue(cost.salesTax_collected_by_bl);
  const total = parseCurrencyValue(cost.grand_total) || parseCurrencyValue(cost.final_total);

  // Extract shipping address
  let shippingAddress: NormalizedOrder['shippingAddress'];
  if (order.shipping?.address) {
    const addr = order.shipping.address;
    shippingAddress = {
      name: addr.name?.full || addr.full.split('\n')[0],
      address1: addr.address1,
      address2: addr.address2,
      city: addr.city,
      state: addr.state,
      postalCode: addr.postal_code,
      countryCode: addr.country_code,
    };
  }

  return {
    platformOrderId: String(order.order_id),
    platform: 'bricklink',
    orderDate: new Date(order.date_ordered),
    statusChangedAt: order.date_status_changed ? new Date(order.date_status_changed) : undefined,
    status: normalizeStatus(order.status),
    buyerName: order.buyer_name,
    buyerEmail: order.buyer_email,
    subtotal,
    shipping,
    fees,
    total,
    currency: cost.currency_code,
    items: items.map(normalizeOrderItem),
    shippingAddress,
    trackingNumber: order.shipping?.tracking_no,
    rawData: order as BrickLinkOrderDetail,
  };
}

/**
 * Normalize multiple orders
 */
export function normalizeOrders(
  orders: Array<{ order: BrickLinkOrderDetail | BrickLinkOrderSummary; items?: BrickLinkOrderItem[] }>
): NormalizedOrder[] {
  return orders.map(({ order, items }) => normalizeOrder(order, items || []));
}

/**
 * Calculate order statistics
 */
export function calculateOrderStats(orders: NormalizedOrder[]): {
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
