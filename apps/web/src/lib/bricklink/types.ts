/**
 * BrickLink API types
 *
 * Based on BrickLink API v3 documentation
 * @see https://www.bricklink.com/v3/api.page
 */

/** BrickLink OAuth 1.0a credentials */
export interface BrickLinkCredentials {
  consumerKey: string;
  consumerSecret: string;
  tokenValue: string;
  tokenSecret: string;
}

/** BrickLink API response wrapper */
export interface BrickLinkResponse<T> {
  meta: {
    code: number;
    message: string;
    description?: string;
  };
  data: T;
}

/** BrickLink order status */
export type BrickLinkOrderStatus =
  | 'PENDING'
  | 'UPDATED'
  | 'PROCESSING'
  | 'READY'
  | 'PAID'
  | 'PACKED'
  | 'SHIPPED'
  | 'RECEIVED'
  | 'COMPLETED'
  | 'OCR'
  | 'NPB'
  | 'NPX'
  | 'NRS'
  | 'NSS'
  | 'CANCELLED';

/** BrickLink payment status */
export type BrickLinkPaymentStatus = 'None' | 'Sent' | 'Received' | 'Clearing' | 'Returned';

/** BrickLink order item condition */
export type BrickLinkItemCondition = 'N' | 'U';

/** BrickLink item type */
export type BrickLinkItemType =
  | 'MINIFIG'
  | 'PART'
  | 'SET'
  | 'BOOK'
  | 'GEAR'
  | 'CATALOG'
  | 'INSTRUCTION'
  | 'UNSORTED_LOT'
  | 'ORIGINAL_BOX';

/** BrickLink cost entry */
export interface BrickLinkCost {
  currency_code: string;
  subtotal: string;
  grand_total: string;
  salesTax_collected_by_bl?: string;
  final_total?: string;
  etc1?: string;
  etc2?: string;
  insurance?: string;
  shipping?: string;
  credit?: string;
  coupon?: string;
  vat_rate?: string;
  vat_amount?: string;
}

/** BrickLink shipping info */
export interface BrickLinkShipping {
  method_id?: number;
  method?: string;
  tracking_no?: string;
  tracking_link?: string;
  date_shipped?: string;
  address?: {
    name?: {
      full: string;
      first?: string;
      last?: string;
    };
    full: string;
    address1?: string;
    address2?: string;
    country_code: string;
    city?: string;
    state?: string;
    postal_code?: string;
  };
}

/** BrickLink payment info */
export interface BrickLinkPayment {
  method?: string;
  currency_code?: string;
  date_paid?: string;
  status?: BrickLinkPaymentStatus;
}

/** BrickLink order item */
export interface BrickLinkOrderItem {
  inventory_id: number;
  item: {
    no: string;
    name: string;
    type: BrickLinkItemType;
    category_id: number;
  };
  color_id: number;
  color_name?: string;
  quantity: number;
  new_or_used: BrickLinkItemCondition;
  completeness?: string;
  unit_price: string;
  unit_price_final?: string;
  disp_unit_price?: string;
  disp_unit_price_final?: string;
  currency_code: string;
  disp_currency_code?: string;
  remarks?: string;
  description?: string;
  weight?: string;
}

/** BrickLink order summary (from list endpoint) */
export interface BrickLinkOrderSummary {
  order_id: number;
  date_ordered: string;
  date_status_changed?: string;
  seller_name: string;
  store_name: string;
  buyer_name: string;
  buyer_email?: string;
  require_insurance?: boolean;
  status: BrickLinkOrderStatus;
  is_invoiced?: boolean;
  is_filed?: boolean;
  drive_thru_sent?: boolean;
  remarks?: string;
  total_count: number;
  unique_count: number;
  total_weight?: string;
  payment?: BrickLinkPayment;
  shipping?: BrickLinkShipping;
  cost: BrickLinkCost;
  disp_cost?: BrickLinkCost;
}

/** BrickLink order detail (includes items) */
export interface BrickLinkOrderDetail extends BrickLinkOrderSummary {
  // Additional fields that may be present in detail view
  salesTax_collected_by_bl?: boolean;
}

/** BrickLink order list query parameters */
export interface BrickLinkOrderListParams {
  /**
   * Order direction:
   * - 'in' = orders received (you are the SELLER, customers buying from you)
   * - 'out' = orders placed (you are the BUYER, you buying from other stores)
   */
  direction?: 'in' | 'out';
  /** Filter by status */
  status?: BrickLinkOrderStatus | BrickLinkOrderStatus[];
  /** Include filed orders */
  filed?: boolean;
}

/** Normalized order format for internal use */
export interface NormalizedOrder {
  platformOrderId: string;
  platform: 'bricklink';
  orderDate: Date;
  status: string;
  buyerName: string;
  buyerEmail?: string;
  subtotal: number;
  shipping: number;
  fees: number;
  total: number;
  currency: string;
  items: NormalizedOrderItem[];
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
  rawData: BrickLinkOrderDetail;
}

/** Normalized order item */
export interface NormalizedOrderItem {
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
export interface RateLimitInfo {
  remaining: number;
  resetTime: Date;
  dailyLimit: number;
  dailyRemaining: number;
}

// ============================================
// Price Guide Types
// ============================================

/** BrickLink price guide type */
export type BrickLinkGuideType = 'sold' | 'stock';

/** BrickLink price guide detail entry */
export interface BrickLinkPriceDetail {
  quantity: number;
  unit_price: string;
  shipping_available: boolean;
  seller_country_code: string;
  buyer_country_code?: string;
  date_ordered?: string;
}

/** BrickLink price guide response */
export interface BrickLinkPriceGuide {
  item: {
    no: string;
    type: BrickLinkItemType;
  };
  new_or_used: BrickLinkItemCondition;
  currency_code: string;
  min_price: string;
  max_price: string;
  avg_price: string;
  qty_avg_price: string;
  unit_quantity: number;
  total_quantity: number;
  price_detail: BrickLinkPriceDetail[];
}

/** BrickLink price guide query parameters */
export interface BrickLinkPriceGuideParams {
  /** Item type (SET, PART, MINIFIG, etc.) */
  type: BrickLinkItemType;
  /** Item number (e.g., "40585-1") */
  no: string;
  /** Condition: N = New, U = Used */
  newOrUsed?: BrickLinkItemCondition;
  /** Country code to filter sellers (e.g., "UK") */
  countryCode?: string;
  /** Guide type: stock (current listings) or sold (past sales) */
  guideType?: BrickLinkGuideType;
  /** Currency code (e.g., "GBP") */
  currencyCode?: string;
  /** VAT option for European items */
  vat?: 'N' | 'Y' | 'O';
}

/** BrickLink catalog item info */
export interface BrickLinkCatalogItem {
  no: string;
  name: string;
  type: BrickLinkItemType;
  category_id: number;
  alternate_no?: string;
  image_url?: string;
  thumbnail_url?: string;
  weight?: string;
  dim_x?: string;
  dim_y?: string;
  dim_z?: string;
  year_released?: number;
  is_obsolete?: boolean;
}
