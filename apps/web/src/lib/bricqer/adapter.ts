/**
 * Bricqer Adapter
 *
 * Normalizes Bricqer API data to internal formats.
 */

import type {
  BricqerOrder,
  BricqerOrderDetail,
  BricqerOrderItem,
  NormalizedBricqerOrder,
  NormalizedBricqerOrderItem,
  BricqerInventoryItem,
  NormalizedBricqerInventoryItem,
} from './types';

/**
 * Parse a numeric value from string or number
 */
function parseNumeric(value: string | number | undefined | null): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'number') return value;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Map Bricqer status to a normalized status string
 */
function normalizeStatus(status: string): string {
  const statusMap: Record<string, string> = {
    pending: 'Pending',
    paid: 'Paid',
    processing: 'Processing',
    packed: 'Packed',
    shipped: 'Shipped',
    delivered: 'Completed',
    cancelled: 'Cancelled',
    refunded: 'Refunded',
    on_hold: 'On Hold',
  };

  return statusMap[status.toLowerCase()] || status;
}

/**
 * Map Bricqer item condition to internal format
 */
function normalizeCondition(condition: string | undefined): 'New' | 'Used' {
  if (!condition) return 'New';
  const lower = condition.toLowerCase();
  if (lower === 'used' || lower.startsWith('used')) return 'Used';
  return 'New';
}

/**
 * Get buyer name from order
 */
function getBuyerName(order: BricqerOrder): string {
  if (order.customer_name) return order.customer_name;

  const shipping = order.shipping_address;
  if (shipping) {
    if (shipping.name) return shipping.name;
    const firstName = shipping.first_name || '';
    const lastName = shipping.last_name || '';
    if (firstName || lastName) return `${firstName} ${lastName}`.trim();
  }

  const billing = order.billing_address;
  if (billing) {
    if (billing.name) return billing.name;
    const firstName = billing.first_name || '';
    const lastName = billing.last_name || '';
    if (firstName || lastName) return `${firstName} ${lastName}`.trim();
  }

  return 'Unknown';
}

/**
 * Normalize a Bricqer order item
 */
export function normalizeOrderItem(
  item: BricqerOrderItem,
  currency: string
): NormalizedBricqerOrderItem {
  const unitPrice = parseNumeric(item.price);
  const quantity = item.quantity || 1;
  const totalPrice = parseNumeric(item.total) || unitPrice * quantity;

  return {
    itemNumber: item.sku || item.bricklink_id || item.lego_id || String(item.id),
    itemName: item.name || 'Unknown Item',
    itemType: item.item_type || 'Part',
    colorId: item.color_id,
    colorName: item.color,
    quantity,
    condition: normalizeCondition(item.condition),
    unitPrice,
    totalPrice,
    currency,
  };
}

/**
 * Normalize a Bricqer order to internal format
 */
export function normalizeOrder(
  order: BricqerOrder | BricqerOrderDetail,
  items?: BricqerOrderItem[]
): NormalizedBricqerOrder {
  const orderItems = items || (order as BricqerOrderDetail).items || [];
  const currency = order.currency || 'GBP';

  const subtotal = parseNumeric(order.subtotal);
  const shipping = parseNumeric(order.shipping_cost);
  const tax = parseNumeric(order.tax);
  const total = parseNumeric(order.total) || subtotal + shipping + tax;

  // Build shipping address
  let shippingAddress: NormalizedBricqerOrder['shippingAddress'];
  if (order.shipping_address) {
    const addr = order.shipping_address;
    shippingAddress = {
      name: addr.name || `${addr.first_name || ''} ${addr.last_name || ''}`.trim() || 'Unknown',
      address1: addr.address_1,
      address2: addr.address_2,
      city: addr.city,
      state: addr.state,
      postalCode: addr.postcode,
      countryCode: addr.country_code || addr.country || 'GB',
    };
  }

  return {
    platformOrderId: order.order_number || String(order.id),
    platform: 'bricqer',
    orderDate: new Date(order.ordered_at || order.created_at),
    status: normalizeStatus(order.status),
    buyerName: getBuyerName(order),
    buyerEmail: order.customer_email || order.shipping_address?.email || order.billing_address?.email,
    subtotal,
    shipping,
    fees: tax,
    total,
    currency,
    items: orderItems.map((item) => normalizeOrderItem(item, currency)),
    shippingAddress,
    trackingNumber: order.tracking_number,
    rawData: order as BricqerOrderDetail,
  };
}

/**
 * Normalize multiple Bricqer orders
 */
export function normalizeOrders(
  orders: BricqerOrder[]
): NormalizedBricqerOrder[] {
  return orders.map((order) => normalizeOrder(order));
}

/**
 * Calculate order statistics
 */
export function calculateOrderStats(orders: NormalizedBricqerOrder[]): {
  totalOrders: number;
  totalRevenue: number;
  totalItems: number;
  averageOrderValue: number;
  statusBreakdown: Record<string, number>;
} {
  const stats = {
    totalOrders: orders.length,
    totalRevenue: 0,
    totalItems: 0,
    averageOrderValue: 0,
    statusBreakdown: {} as Record<string, number>,
  };

  for (const order of orders) {
    stats.totalRevenue += order.total;
    stats.totalItems += order.items.reduce((sum, item) => sum + item.quantity, 0);

    const status = order.status;
    stats.statusBreakdown[status] = (stats.statusBreakdown[status] || 0) + 1;
  }

  stats.averageOrderValue = orders.length > 0 ? stats.totalRevenue / orders.length : 0;

  return stats;
}

// ============================================
// Inventory Normalization
// ============================================

/**
 * Map Bricqer LEGO type to item type
 */
function mapLegoType(legoType: string): 'Part' | 'Set' | 'Minifig' | 'Other' {
  const typeMap: Record<string, 'Part' | 'Set' | 'Minifig' | 'Other'> = {
    P: 'Part',
    S: 'Set',
    M: 'Minifig',
    G: 'Other', // Gear
    B: 'Other', // Book
    C: 'Other', // Catalog
    I: 'Other', // Instruction
    O: 'Other', // Original Box
  };

  return typeMap[legoType.toUpperCase()] || 'Other';
}

/**
 * Map Bricqer inventory condition to internal format
 */
function mapInventoryCondition(condition: 'N' | 'U' | undefined): 'New' | 'Used' {
  if (!condition) return 'New';
  return condition === 'N' ? 'New' : 'Used';
}

/**
 * Normalize a Bricqer inventory item
 */
export function normalizeInventoryItem(
  item: BricqerInventoryItem
): NormalizedBricqerInventoryItem {
  const definition = item.definition;

  // Get condition from item or definition
  const condition = item.condition || definition.condition || 'N';

  // Get color info from definition if not on item
  const colorId = item.colorId || definition.color?.id;
  const colorName = item.colorName || definition.color?.name;

  // Get quantity - use remainingQuantity if quantity not present
  const quantity = item.quantity || item.remainingQuantity || 1;

  // Get price from item or definition
  const price = item.price ? parseNumeric(item.price) : definition.price;

  return {
    externalId: String(item.id),
    itemNumber: definition.legoId || String(item.definitionId),
    itemName: definition.description || 'Unknown Item',
    itemType: mapLegoType(definition.legoType),
    colorId,
    colorName,
    condition: mapInventoryCondition(condition),
    quantity,
    price,
    storageLocation: item.storageLabel,
    imageUrl: definition.picture || definition.legoPicture,
    batchId: item.batchId,
    purchaseId: item.purchaseId,
    remarks: item.remarks,
    rawData: item,
  };
}

/**
 * Normalize multiple Bricqer inventory items
 */
export function normalizeInventoryItems(
  items: BricqerInventoryItem[]
): NormalizedBricqerInventoryItem[] {
  return items.map(normalizeInventoryItem);
}

/**
 * Calculate inventory statistics
 */
export function calculateInventoryStats(items: NormalizedBricqerInventoryItem[]): {
  totalLots: number;
  totalQuantity: number;
  totalValue: number;
  conditionBreakdown: Record<string, number>;
  typeBreakdown: Record<string, number>;
} {
  const stats = {
    totalLots: items.length,
    totalQuantity: 0,
    totalValue: 0,
    conditionBreakdown: {} as Record<string, number>,
    typeBreakdown: {} as Record<string, number>,
  };

  for (const item of items) {
    stats.totalQuantity += item.quantity;
    stats.totalValue += (item.price || 0) * item.quantity;

    stats.conditionBreakdown[item.condition] =
      (stats.conditionBreakdown[item.condition] || 0) + item.quantity;
    stats.typeBreakdown[item.itemType] =
      (stats.typeBreakdown[item.itemType] || 0) + item.quantity;
  }

  return stats;
}
