/**
 * Brick Owl API types
 *
 * Based on Brick Owl API documentation
 * @see https://www.brickowl.com/api
 */

/** Brick Owl API key credentials */
export interface BrickOwlCredentials {
  apiKey: string;
}

/** Brick Owl API response wrapper */
export interface BrickOwlResponse<T> {
  status: 'success' | 'error';
  error_code?: string;
  error?: string;
  data?: T;
  [key: string]: unknown;
}

/** Brick Owl order status */
export type BrickOwlOrderStatus =
  | 'Pending'
  | 'Payment Received'
  | 'Payment Submitted'
  | 'Processing'
  | 'Processed'
  | 'Shipped'
  | 'Received'
  | 'Cancelled'
  | 'On Hold';

/** Brick Owl payment status */
export type BrickOwlPaymentStatus = 'None' | 'Pending' | 'Submitted' | 'Received' | 'Cleared';

/** Brick Owl item condition */
export type BrickOwlItemCondition = 'new' | 'usedn' | 'usedg' | 'useda';

/** Brick Owl item type */
export type BrickOwlItemType =
  | 'Part'
  | 'Minifigure'
  | 'Set'
  | 'Gear'
  | 'Book'
  | 'Instructions'
  | 'Packaging'
  | 'Custom';

/** Brick Owl order from list endpoint */
export interface BrickOwlOrder {
  order_id: string;
  store_id?: string;
  status: BrickOwlOrderStatus;
  order_time: string;
  iso_order_time: string;
  processed_time?: string;
  shipped_time?: string;
  received_time?: string;
  buyer_name: string;
  buyer_username?: string;
  buyer_email?: string;
  ship_first_name?: string;
  ship_last_name?: string;
  ship_country_code: string;
  ship_country?: string;
  ship_street_1?: string;
  ship_street_2?: string;
  ship_city?: string;
  ship_region?: string;
  ship_post_code?: string;
  ship_phone?: string;
  base_order_total: string;
  order_total: string;
  coupon_discount?: string;
  combined_shipping_discount?: string;
  payment_method_type?: string;
  payment_method_text?: string;
  payment_transaction_id?: string;
  payment_status?: BrickOwlPaymentStatus;
  shipping_method_id?: string;
  shipping_method?: string;
  tracking_number?: string;
  tracking_url?: string;
  sub_total?: string;
  total_tax?: string;
  total_shipping?: string;
  total_discount?: string;
  total_lots?: number;
  total_qty?: number;
  weight?: string;
  affiliate?: string;
  currency?: string;
  buyer_note?: string;
  seller_note?: string;
  public_note?: string;
  buyer_id?: string;
  my_cost?: string;
  sales_tax_collected_by_bo?: string;
}

/** Brick Owl order item */
export interface BrickOwlOrderItem {
  order_item_id: string;
  boid: string;
  lot_id?: string;
  name: string;
  type: string;
  color_name?: string;
  color_id?: string;
  condition: BrickOwlItemCondition;
  ordered_quantity: number;
  remaining_quantity?: number;
  personal_note?: string;
  public_note?: string;
  weight?: string;
  base_price: string;
  unit_price?: string;
  total_price?: string;
  image_small?: string;
}

/** Brick Owl order detail with items */
export interface BrickOwlOrderDetail extends BrickOwlOrder {
  items?: BrickOwlOrderItem[];
}

/** Brick Owl order list query parameters */
export interface BrickOwlOrderListParams {
  /** Filter by status (comma-separated for multiple) */
  status?: BrickOwlOrderStatus | BrickOwlOrderStatus[];
  /** Filter by minimum order ID */
  min_order_id?: string;
  /** Filter by maximum order ID */
  max_order_id?: string;
  /** Limit number of results */
  limit?: number;
  /** Page number for pagination */
  page?: number;
  /** Order direction: 'asc' or 'desc' */
  order_direction?: 'asc' | 'desc';
}

/** Normalized order format for internal use */
export interface NormalizedBrickOwlOrder {
  platformOrderId: string;
  platform: 'brickowl';
  orderDate: Date;
  status: string;
  buyerName: string;
  buyerEmail?: string;
  subtotal: number;
  shipping: number;
  fees: number;
  total: number;
  currency: string;
  items: NormalizedBrickOwlOrderItem[];
  shippingAddress?: {
    name: string;
    address1?: string;
    address2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    countryCode: string;
  };
  trackingNumber?: string;
  rawData: BrickOwlOrderDetail;
}

/** Normalized order item */
export interface NormalizedBrickOwlOrderItem {
  itemNumber: string;
  itemName: string;
  itemType: string;
  colorId?: number;
  colorName?: string;
  quantity: number;
  condition: 'New' | 'Used';
  unitPrice: number;
  totalPrice: number;
  currency: string;
}

/** Rate limit info */
export interface BrickOwlRateLimitInfo {
  remaining: number;
  resetTime: Date;
  dailyLimit: number;
  dailyRemaining: number;
}
