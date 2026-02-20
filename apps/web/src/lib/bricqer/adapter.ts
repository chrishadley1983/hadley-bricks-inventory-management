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
 * Bricqer uses uppercase status values: READY, SHIPPED, etc.
 */
function normalizeStatus(status: string): string {
  const statusMap: Record<string, string> = {
    ready: 'Paid',
    picked: 'Packed',
    packed: 'Packed',
    shipped: 'Shipped',
    delivered: 'Completed',
    cancelled: 'Cancelled/Refunded',
    refunded: 'Cancelled/Refunded',
    on_hold: 'Pending',
    // Legacy lowercase values
    pending: 'Pending',
    paid: 'Paid',
    processing: 'Paid',
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
 * Detailed orders have journal.contact, list orders have contact
 */
function getBuyerName(order: BricqerOrder | BricqerOrderDetail): string {
  // Try journal.contact first (detailed order response from /orders/order/{id}/)
  const detail = order as BricqerOrderDetail;
  if (detail.journal?.contact?.name) return detail.journal.contact.name;

  // Try contact (list response from /orders/order/)
  if (order.contact?.name) return order.contact.name;

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
 * Get buyer email from order
 */
function getBuyerEmail(order: BricqerOrder | BricqerOrderDetail): string | undefined {
  const detail = order as BricqerOrderDetail;
  return (
    detail.journal?.contact?.email ||
    order.contact?.email ||
    order.customer_email ||
    order.shipping_address?.email ||
    order.billing_address?.email ||
    undefined
  );
}

/**
 * Get buyer phone from order
 */
function getBuyerPhone(order: BricqerOrder | BricqerOrderDetail): string | undefined {
  const detail = order as BricqerOrderDetail;
  return (
    detail.journal?.contact?.phone ||
    order.shipping_address?.phone ||
    order.billing_address?.phone ||
    undefined
  );
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
 * Parse address from journal.contact.address or contact.address string
 * Format: "Street\nCity Line\nPostcode City\nCounty" (newline separated)
 */
function parseAddressString(
  address: string,
  contactName: string,
  countryCode?: string
): NormalizedBricqerOrder['shippingAddress'] {
  const lines = address.split('\n').filter((l) => l.trim());

  if (lines.length === 0) {
    return {
      name: contactName,
      countryCode: countryCode || 'GB',
    };
  }

  // Last line typically has postcode + city (e.g., "DN3 2HN Doncaster")
  const lastLine = lines[lines.length - 1] || '';
  // UK postcodes are typically at the start, followed by city
  const postcodeMatch = lastLine.match(/^([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})\s+(.+)$/i);

  let postalCode: string | undefined;
  let city: string | undefined;

  if (postcodeMatch) {
    postalCode = postcodeMatch[1];
    city = postcodeMatch[2];
  } else {
    // Try reverse - city might be first
    const reversedMatch = lastLine.match(/^(.+?)\s+([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})$/i);
    if (reversedMatch) {
      city = reversedMatch[1];
      postalCode = reversedMatch[2];
    } else {
      // Just use the whole line as city
      city = lastLine;
    }
  }

  return {
    name: contactName,
    address1: lines[0],
    address2: lines.length > 2 ? lines[1] : undefined,
    city,
    state: lines.length > 3 ? lines[lines.length - 1] : undefined,
    postalCode,
    countryCode: countryCode || 'GB',
  };
}

/**
 * Normalize a Bricqer order to internal format
 */
export function normalizeOrder(
  order: BricqerOrder | BricqerOrderDetail,
  items?: BricqerOrderItem[]
): NormalizedBricqerOrder {
  const detail = order as BricqerOrderDetail;
  const orderItems = items || detail.items || [];
  const currency = order.currency || 'GBP';

  // Handle API field names for costs
  // - costShipping is the actual field name for shipping in detailed response
  // - shipping_cost was the old/assumed field name (doesn't exist)
  const subtotal = parseNumeric(order.costSubtotal) || parseNumeric(order.subtotal);
  const shipping = parseNumeric(detail.costShipping) || parseNumeric(order.shipping_cost);
  const tax = parseNumeric(detail.costTax) || parseNumeric(order.tax);
  const total =
    parseNumeric(order.costGrandtotal) || parseNumeric(order.total) || subtotal + shipping + tax;

  // Build shipping address - prefer journal.contact.address (detailed), then contact.address (list)
  let shippingAddress: NormalizedBricqerOrder['shippingAddress'];
  const countryCode = order.countryCode || 'GB';

  if (detail.journal?.contact?.address) {
    // Parse address from journal.contact (detailed order response)
    shippingAddress = parseAddressString(
      detail.journal.contact.address,
      detail.journal.contact.name || 'Unknown',
      countryCode
    );
  } else if (order.contact?.address) {
    // Parse address from contact (list order response)
    shippingAddress = parseAddressString(
      order.contact.address,
      order.contact.name || 'Unknown',
      countryCode
    );
  } else if (order.shipping_address) {
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

  // Get order date - try various field names
  const orderDateStr = order.paymentDate || order.created || order.created_at || order.ordered_at;
  const orderDate = orderDateStr ? new Date(orderDateStr) : new Date();

  // Use displayName as order ID if order_number not available
  const platformOrderId = order.displayName || order.order_number || String(order.id);

  // Get lot count - available directly from API
  const lotCount = order.lotCount;

  // Calculate piece count from batchSet.itemSet (sum of quantities)
  // This is available for BrickLink/BrickOwl orders, but empty for eBay orders
  let pieceCount: number | undefined;
  if (detail.batchSet && detail.batchSet.length > 0) {
    let totalQuantity = 0;
    for (const batch of detail.batchSet) {
      if (Array.isArray(batch.itemSet)) {
        for (const item of batch.itemSet) {
          totalQuantity += item.quantity || 0;
        }
      }
    }
    pieceCount = totalQuantity > 0 ? totalQuantity : undefined;
  }

  return {
    platformOrderId,
    platform: 'bricqer',
    orderDate,
    status: normalizeStatus(order.status),
    buyerName: getBuyerName(order),
    buyerEmail: getBuyerEmail(order),
    buyerPhone: getBuyerPhone(order),
    subtotal,
    shipping,
    fees: tax,
    total,
    currency,
    items: orderItems.map((item) => normalizeOrderItem(item, currency)),
    lotCount,
    pieceCount,
    orderDescription: detail.description,
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
): NormalizedBricqerInventoryItem | null {
  const definition = item.definition;

  // Some items have no definition (deleted or corrupted) — skip them
  if (!definition) return null;

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
  return items.map(normalizeInventoryItem).filter(
    (item): item is NormalizedBricqerInventoryItem => item !== null,
  );
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
