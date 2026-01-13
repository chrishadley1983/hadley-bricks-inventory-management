/**
 * Repricing Feature Types
 *
 * Types for the Amazon repricing tab that displays live competitive pricing,
 * calculates profit based on cost, and allows instant price updates.
 */

// ============================================================================
// CORE TYPES
// ============================================================================

/**
 * Combined repricing item with inventory cost and live Amazon pricing
 */
export interface RepricingItem {
  // Identification
  asin: string;
  sku: string;
  title: string | null;

  // Inventory data
  inventoryItemId: string | null;
  inventoryCost: number | null; // from inventory_items.cost

  // Amazon listing data (from platform_listings)
  quantity: number;
  yourPrice: number; // current listing price
  listingStatus: string;
  fulfillmentChannel: string | null;

  // Live competitive pricing (from Amazon Pricing API)
  buyBoxPrice: number | null;
  buyBoxIsYours: boolean;
  wasPrice: number | null; // 90-day median
  lowestOfferPrice: number | null;
  offerCount: number | null;
  salesRank: number | null;
  salesRankCategory: string | null;
  pricingFetchedAt: string; // When live data was fetched

  // Calculated fields
  buyBoxDiff: number | null; // yourPrice - buyBoxPrice
  effectivePrice: number | null; // buyBoxPrice or lowestOfferPrice fallback
  priceSource: 'buybox' | 'lowest' | 'none'; // Indicates where effectivePrice comes from
}

/**
 * Profit calculation result for a repricing scenario
 */
export interface RepricingProfit {
  salePrice: number;
  productCost: number;
  referralFee: number;
  digitalServicesTax: number;
  vatOnFees: number;
  totalAmazonFee: number;
  shippingCost: number;
  netPayout: number;
  totalProfit: number;
  profitMarginPercent: number;
  roiPercent: number;
}

/**
 * Price push request
 */
export interface PushPriceRequest {
  sku: string;
  newPrice: number;
  productType?: string; // For validation
}

/**
 * Price push response
 */
export interface PushPriceResponse {
  success: boolean;
  sku: string;
  previousPrice: number;
  newPrice: number;
  message: string;
  validationIssues?: Array<{
    code: string;
    message: string;
    severity: 'ERROR' | 'WARNING' | 'INFO';
  }>;
}

/**
 * Push status for UI feedback
 */
export type PushStatus = 'idle' | 'pushing' | 'success' | 'error';

// ============================================================================
// FILTER TYPES
// ============================================================================

export interface RepricingFilters {
  search?: string;
  showOnlyWithCost?: boolean; // Only items with inventory cost
  showOnlyBuyBoxLost?: boolean; // Only items where buyBoxIsYours = false
  minQuantity?: number;
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

export interface RepricingDataResponse {
  items: RepricingItem[];
  summary: {
    totalListings: number;
    withCostData: number;
    buyBoxOwned: number;
    buyBoxLost: number;
    pricingDataAge: string; // e.g., "fetched just now" or "2 hours ago"
    pricingCachedAt: string | null; // ISO timestamp of when pricing was cached
    isCached: boolean; // true if data came from cache
  };
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

// ============================================================================
// ROW STATE TYPES (for UI)
// ============================================================================

export interface RepricingRowState {
  sku: string;
  editedPrice: number | null; // null = not editing
  useManualCost: boolean; // false = use inventory cost
  manualCost: number | null; // User-entered cost override
  pushStatus: PushStatus;
  pushError: string | null;
}

// ============================================================================
// SERVICE TYPES
// ============================================================================

/**
 * Platform listing row from database
 */
export interface PlatformListingRow {
  id: string;
  platform_item_id: string; // ASIN
  platform_sku: string | null;
  title: string | null;
  quantity: number;
  price: number | null;
  listing_status: string | null;
  fulfillment_channel: string | null;
  raw_data: Record<string, unknown> | null;
}

/**
 * Inventory item row for cost lookup
 */
export interface InventoryItemCost {
  id: string;
  amazon_asin: string;
  cost: number | null;
}
