/**
 * Amazon Order Adapter
 *
 * Normalizes Amazon SP-API order data to our standard platform order format.
 */

import type {
  AmazonOrder,
  AmazonOrderItem,
  NormalizedAmazonOrder,
  NormalizedAmazonOrderItem,
} from './types';
import { MARKETPLACE_INFO } from './types';

/**
 * Normalize Amazon order status to our standard statuses
 */
function normalizeStatus(status: string): string {
  const statusMap: Record<string, string> = {
    Pending: 'Pending',
    Unshipped: 'Paid',
    PartiallyShipped: 'Partially Shipped',
    Shipped: 'Shipped',
    Canceled: 'Cancelled/Refunded',
    Unfulfillable: 'Cancelled/Refunded',
    InvoiceUnconfirmed: 'Pending',
    PendingAvailability: 'Pending',
  };
  return statusMap[status] || status;
}

/**
 * Parse Amazon money amount to number
 */
function parseAmount(money?: { Amount: string; CurrencyCode: string }): number {
  if (!money?.Amount) return 0;
  return parseFloat(money.Amount) || 0;
}

/**
 * Get currency from order
 */
function getCurrency(order: AmazonOrder): string {
  if (order.OrderTotal?.CurrencyCode) {
    return order.OrderTotal.CurrencyCode;
  }
  // Fallback to marketplace currency
  const marketplaceInfo = MARKETPLACE_INFO[order.MarketplaceId];
  return marketplaceInfo?.currency || 'GBP';
}

/**
 * Get marketplace name
 */
function getMarketplaceName(marketplaceId: string): string {
  return MARKETPLACE_INFO[marketplaceId]?.name || `Amazon (${marketplaceId})`;
}

/**
 * Normalize a single order item
 */
function normalizeOrderItem(item: AmazonOrderItem, currency: string): NormalizedAmazonOrderItem {
  const unitPrice = parseAmount(item.ItemPrice) / (item.QuantityOrdered || 1);
  const totalPrice = parseAmount(item.ItemPrice);

  return {
    asin: item.ASIN,
    sku: item.SellerSKU,
    title: item.Title || `ASIN: ${item.ASIN}`,
    quantity: item.QuantityOrdered,
    unitPrice,
    totalPrice,
    currency,
  };
}

/**
 * Normalize an Amazon order to our standard format
 */
export function normalizeOrder(
  order: AmazonOrder,
  items: AmazonOrderItem[] = []
): NormalizedAmazonOrder {
  const currency = getCurrency(order);
  const subtotal = parseAmount(order.OrderTotal);

  // Calculate shipping from items
  let shipping = 0;
  items.forEach((item) => {
    shipping += parseAmount(item.ShippingPrice);
  });

  // Amazon doesn't expose fees directly in order data
  // They're typically deducted from payouts
  const fees = 0;

  const total = subtotal;

  // Normalize shipping address
  let shippingAddress: NormalizedAmazonOrder['shippingAddress'];
  if (order.ShippingAddress) {
    const addr = order.ShippingAddress;
    shippingAddress = {
      name: addr.Name || order.BuyerInfo?.BuyerName || 'Unknown',
      address1: addr.AddressLine1,
      address2: [addr.AddressLine2, addr.AddressLine3].filter(Boolean).join(', ') || undefined,
      city: addr.City,
      state: addr.StateOrRegion,
      postalCode: addr.PostalCode,
      countryCode: addr.CountryCode || 'GB',
    };
  }

  // Normalize items
  const normalizedItems = items.map((item) => normalizeOrderItem(item, currency));

  return {
    platformOrderId: order.AmazonOrderId,
    orderDate: new Date(order.PurchaseDate),
    buyerName: order.BuyerInfo?.BuyerName || order.ShippingAddress?.Name || 'Amazon Customer',
    buyerEmail: order.BuyerInfo?.BuyerEmail,
    status: normalizeStatus(order.OrderStatus),
    subtotal,
    shipping,
    fees,
    total,
    currency,
    marketplace: getMarketplaceName(order.MarketplaceId),
    marketplaceId: order.MarketplaceId,
    fulfillmentChannel: order.FulfillmentChannel === 'AFN' ? 'FBA' : 'FBM',
    latestShipDate: order.LatestShipDate ? new Date(order.LatestShipDate) : undefined,
    shippingAddress,
    items: normalizedItems,
    rawData: order,
  };
}

/**
 * Normalize multiple orders
 */
export function normalizeOrders(
  orders: AmazonOrder[],
  itemsByOrderId?: Map<string, AmazonOrderItem[]>
): NormalizedAmazonOrder[] {
  return orders.map((order) => {
    const items = itemsByOrderId?.get(order.AmazonOrderId) || [];
    return normalizeOrder(order, items);
  });
}

// Re-export types
export type { NormalizedAmazonOrder, NormalizedAmazonOrderItem };
