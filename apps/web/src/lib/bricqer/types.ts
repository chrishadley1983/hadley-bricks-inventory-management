/**
 * Bricqer API types
 *
 * Based on Bricqer API documentation
 * @see https://api.bricqer.com/docs
 */

/** Bricqer API credentials */
export interface BricqerCredentials {
  tenantUrl: string;
  apiKey: string;
}

/** Bricqer API response wrapper for paginated data */
export interface BricqerPaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

/** Bricqer order status */
export type BricqerOrderStatus =
  | 'pending'
  | 'paid'
  | 'processing'
  | 'packed'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded'
  | 'on_hold';

/** Bricqer payment status */
export type BricqerPaymentStatus =
  | 'pending'
  | 'paid'
  | 'partial'
  | 'refunded'
  | 'failed';

/** Bricqer shipping address */
export interface BricqerAddress {
  name?: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  address_1?: string;
  address_2?: string;
  city?: string;
  state?: string;
  postcode?: string;
  country?: string;
  country_code?: string;
  phone?: string;
  email?: string;
}

/** Bricqer order item */
export interface BricqerOrderItem {
  id: number | string;
  sku?: string;
  name: string;
  quantity: number;
  price: string | number;
  total: string | number;
  item_type?: string;
  condition?: string;
  color?: string;
  color_id?: number;
  bricklink_id?: string;
  brickowl_id?: string;
  lego_id?: string;
  weight?: number;
  image_url?: string;
}

/** Bricqer order from list endpoint */
export interface BricqerOrder {
  id: number | string;
  order_number: string;
  external_order_id?: string;
  status: BricqerOrderStatus;
  payment_status?: BricqerPaymentStatus;
  created_at: string;
  updated_at?: string;
  ordered_at?: string;
  paid_at?: string;
  shipped_at?: string;
  delivered_at?: string;
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  billing_address?: BricqerAddress;
  shipping_address?: BricqerAddress;
  subtotal: string | number;
  shipping_cost: string | number;
  tax?: string | number;
  discount?: string | number;
  total: string | number;
  currency: string;
  items?: BricqerOrderItem[];
  tracking_number?: string;
  tracking_url?: string;
  shipping_method?: string;
  notes?: string;
  internal_notes?: string;
  source?: string;
  channel?: string;
  tags?: string[];
}

/** Bricqer order detail with full items */
export interface BricqerOrderDetail extends BricqerOrder {
  items: BricqerOrderItem[];
}

/** Bricqer order list query parameters */
export interface BricqerOrderListParams {
  /** Filter by status */
  status?: BricqerOrderStatus | BricqerOrderStatus[];
  /** Filter by payment status */
  payment_status?: BricqerPaymentStatus;
  /** Filter by date range start (ISO format) */
  created_after?: string;
  /** Filter by date range end (ISO format) */
  created_before?: string;
  /** Limit number of results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Page number */
  page?: number;
  /** Order by field */
  ordering?: string;
  /** Search query */
  search?: string;
}

/** Normalized order format for internal use */
export interface NormalizedBricqerOrder {
  platformOrderId: string;
  platform: 'bricqer';
  orderDate: Date;
  status: string;
  buyerName: string;
  buyerEmail?: string;
  subtotal: number;
  shipping: number;
  fees: number;
  total: number;
  currency: string;
  items: NormalizedBricqerOrderItem[];
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
  rawData: BricqerOrderDetail;
}

/** Normalized order item */
export interface NormalizedBricqerOrderItem {
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
export interface BricqerRateLimitInfo {
  remaining: number;
  resetTime: Date;
  limit: number;
}

/** API error response */
export interface BricqerErrorResponse {
  detail?: string;
  error?: string;
  message?: string;
  code?: string;
}

// ============================================
// Inventory Types
// ============================================

/** Bricqer item definition (part/set/minifig info) */
export interface BricqerItemDefinition {
  description: string;
  legoType: string; // 'P' for part, 'S' for set, 'M' for minifig
  legoId: string;
  legoIdFull: string;
  legoPicture?: string;
  picture?: string;
  legoCategoryId?: number;
  primaryColorId?: number;
  weight?: number;
}

/** Bricqer inventory item */
export interface BricqerInventoryItem {
  id: number;
  storageId: number;
  storageLabel: string;
  definitionTypeId: number;
  definitionId: number;
  definition: BricqerItemDefinition & {
    condition?: 'N' | 'U';
    color?: {
      id: number;
      rgb: string;
      name: string;
      blid?: number;
    };
    price?: number;
  };
  colorId?: number;
  colorName?: string;
  condition?: 'N' | 'U'; // New or Used
  quantity?: number;
  remainingQuantity?: number;
  price?: string | number;
  remarks?: string;
  batchId?: number;
  purchaseId?: number;
  created?: string;
  updated?: string;
}

/** Bricqer storage location */
export interface BricqerStorage {
  id: number;
  storageId: string;
  itemCount: number;
  storageType: string;
  displayAs: string;
  skipSuggestions: boolean;
  isDropship: boolean;
  isStorefront: boolean;
  priority: number;
}

/** Bricqer color */
export interface BricqerColor {
  id: number;
  bricklinkId: number;
  brickowlId: number;
  name: string;
  nameTranslated?: string | null;
  rgb: string;
  isManaged: boolean;
}

/** Bricqer purchase batch */
export interface BricqerBatch {
  id: number;
  purchase: number;
  activationDate?: string;
  activateUpdatePrices: boolean;
  activated: boolean;
  definition: string;
  lots: number;
  batchItemCount: number;
  totalQuantity: number;
  totalPrice: string;
  remainingQuantity: number;
  remainingPrice: string;
  condition: 'N' | 'U';
  reference?: string;
  supportedShops: string[];
  created: string;
}

/** Bricqer purchase */
export interface BricqerPurchase {
  id: number;
  journal: {
    id: number;
    reference?: string;
    contact?: {
      id: number;
      contactType: string;
      name: string;
      address?: string | null;
      email?: string | null;
      phone?: string | null;
      remarks?: string | null;
      country?: number;
    };
  };
  condition: 'N' | 'U';
  totalQuantity: number;
  remainingQuantity: number;
  locked: boolean;
}

/** Bricqer item link to external platforms */
export interface BricqerItemLink {
  id: number;
  definitionId: number;
  provider: string; // 'BrickLink', 'BrickOwl', 'eBay'
  externalData: string;
  active: boolean;
  definitionType: number;
}

/** Normalized inventory item for internal use */
export interface NormalizedBricqerInventoryItem {
  externalId: string;
  itemNumber: string;
  itemName: string;
  itemType: 'Part' | 'Set' | 'Minifig' | 'Other';
  colorId?: number;
  colorName?: string;
  condition: 'New' | 'Used';
  quantity: number;
  price?: number;
  storageLocation: string;
  imageUrl?: string;
  batchId?: number;
  purchaseId?: number;
  remarks?: string;
  rawData: BricqerInventoryItem;
}

/** Inventory list query parameters */
export interface BricqerInventoryListParams {
  /** Limit number of results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Filter by storage */
  storage?: number;
  /** Filter by condition */
  condition?: 'N' | 'U';
  /** Search query */
  search?: string;
  /** Order by field */
  ordering?: string;
}
