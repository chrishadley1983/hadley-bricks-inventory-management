/**
 * Arbitrage Tracker Types
 *
 * Types for Amazon vs BrickLink arbitrage comparison feature.
 */

// ============================================
// Database Types
// ============================================

export type AsinSource = 'inventory' | 'discovery' | 'manual';
export type AsinStatus = 'active' | 'excluded' | 'pending_review';
export type MatchConfidence = 'exact' | 'probable' | 'manual';
export type SyncJobType = 'inventory_asins' | 'amazon_pricing' | 'bricklink_pricing' | 'asin_mapping' | 'ebay_pricing';
export type SyncJobStatus = 'idle' | 'running' | 'completed' | 'failed';

/**
 * Tracked ASIN record
 */
export interface TrackedAsin {
  asin: string;
  userId: string;
  source: AsinSource;
  status: AsinStatus;
  name: string | null;
  imageUrl: string | null;
  sku: string | null;
  addedAt: string;
  excludedAt: string | null;
  exclusionReason: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * ASIN to BrickLink set mapping
 */
export interface AsinBricklinkMapping {
  asin: string;
  userId: string;
  bricklinkSetNumber: string;
  matchConfidence: MatchConfidence;
  matchMethod: string | null;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Amazon pricing snapshot
 */
export interface AmazonArbitragePricing {
  id: string;
  userId: string;
  asin: string;
  snapshotDate: string;
  yourPrice: number | null;
  yourQty: number;
  buyBoxPrice: number | null;
  buyBoxIsYours: boolean;
  offerCount: number | null;
  wasPrice90d: number | null;
  salesRank: number | null;
  salesRankCategory: string | null;
  createdAt: string;
}

/**
 * BrickLink price detail entry
 */
export interface BricklinkPriceDetail {
  quantity: number;
  unit_price: string;
  seller_country_code: string;
}

/**
 * eBay listing entry (from listings_json)
 */
export interface EbayListing {
  itemId: string;
  title: string;
  price: number;
  currency: string;
  shipping: number;
  totalPrice: number;
  seller: string;
  sellerFeedback: number;
  url: string;
}

/**
 * BrickLink pricing snapshot
 */
export interface BricklinkArbitragePricing {
  id: string;
  userId: string;
  bricklinkSetNumber: string;
  snapshotDate: string;
  condition: 'N' | 'U';
  countryCode: string;
  minPrice: number | null;
  avgPrice: number | null;
  maxPrice: number | null;
  qtyAvgPrice: number | null;
  totalLots: number | null;
  totalQty: number | null;
  priceDetailJson: BricklinkPriceDetail[] | null;
  createdAt: string;
}

/**
 * Sync job status
 */
export interface ArbitrageSyncStatus {
  id: string;
  userId: string;
  jobType: SyncJobType;
  status: SyncJobStatus;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  nextScheduledAt: string | null;
  lastRunDurationMs: number | null;
  itemsProcessed: number;
  itemsFailed: number;
  errorMessage: string | null;
  errorDetails: unknown | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================
// View/Combined Types
// ============================================

/**
 * Denormalized arbitrage item from view
 */
export interface ArbitrageItem {
  asin: string;
  userId: string;
  name: string | null;
  imageUrl: string | null;
  sku: string | null;
  source: AsinSource;
  status: AsinStatus;
  bricklinkSetNumber: string | null;
  matchConfidence: MatchConfidence | null;

  // Amazon latest
  yourPrice: number | null;
  yourQty: number | null;
  buyBoxPrice: number | null;
  buyBoxIsYours: boolean | null;
  offerCount: number | null;
  wasPrice90d: number | null;
  salesRank: number | null;
  salesRankCategory: string | null;
  amazonSnapshotDate: string | null;

  // BrickLink latest (New, UK)
  blMinPrice: number | null;
  blAvgPrice: number | null;
  blMaxPrice: number | null;
  blTotalLots: number | null;
  blTotalQty: number | null;
  blPriceDetail: BricklinkPriceDetail[] | null;
  blSnapshotDate: string | null;

  // eBay latest (New, GB)
  ebayMinPrice: number | null;
  ebayAvgPrice: number | null;
  ebayMaxPrice: number | null;
  ebayTotalListings: number | null;
  ebayListings: EbayListing[] | null;
  ebaySnapshotDate: string | null;

  // Calculated margins (BrickLink)
  marginPercent: number | null;
  marginAbsolute: number | null;

  // Calculated margins (eBay)
  ebayMarginPercent: number | null;
  ebayMarginAbsolute: number | null;

  // Convenience URLs
  amazonUrl: string | null;
}

/**
 * Excluded ASIN for display
 */
export interface ExcludedAsin {
  asin: string;
  name: string | null;
  bricklinkSetNumber: string | null;
  excludedAt: string;
  exclusionReason: string | null;
}

/**
 * Unmapped ASIN for manual mapping
 */
export interface UnmappedAsin {
  asin: string;
  name: string | null;
  imageUrl: string | null;
  detectedSetNumber: string | null;
  suggestedMatch: string | null;
  addedAt: string;
}

// ============================================
// Filter Types
// ============================================

export type ArbitrageShowFilter =
  | 'all'
  | 'opportunities'
  | 'in_stock'
  | 'zero_qty'
  | 'pending_review';

export type ArbitrageSortField =
  | 'margin'
  | 'bl_price'
  | 'ebay_price'
  | 'ebay_margin'
  | 'sales_rank'
  | 'name';

export type SortDirection = 'asc' | 'desc';

export interface ArbitrageFilters {
  minMargin: number;
  show: ArbitrageShowFilter;
  sortField: ArbitrageSortField;
  sortDirection: SortDirection;
  search: string;
}

export interface ArbitrageFilterOptions {
  minMargin?: number;
  show?: ArbitrageShowFilter;
  sortField?: ArbitrageSortField;
  sortDirection?: SortDirection;
  search?: string;
  page?: number;
  pageSize?: number;
}

// ============================================
// API Request/Response Types
// ============================================

export interface ArbitrageDataResponse {
  items: ArbitrageItem[];
  totalCount: number;
  opportunityCount: number;
  hasMore: boolean;
}

export interface ExcludeAsinRequest {
  asin: string;
  reason?: string;
}

export interface RestoreAsinRequest {
  asin: string;
}

export interface MapAsinRequest {
  asin: string;
  bricklinkSetNumber: string;
}

export interface SyncStatusResponse {
  inventoryAsins: ArbitrageSyncStatus | null;
  amazonPricing: ArbitrageSyncStatus | null;
  bricklinkPricing: ArbitrageSyncStatus | null;
  asinMapping: ArbitrageSyncStatus | null;
}

export interface TriggerSyncRequest {
  jobType: SyncJobType;
}

export interface TriggerSyncResponse {
  success: boolean;
  message: string;
  jobId?: string;
}

// ============================================
// Mapping Types
// ============================================

export interface SetNumberExtraction {
  setNumber: string | null;
  confidence: MatchConfidence | null;
  method: string | null;
}

export interface MappingValidation {
  valid: boolean;
  setNumber: string;
  setName?: string;
  error?: string;
}

// ============================================
// Profit Calculation Types
// ============================================

export interface ProfitCalculation {
  grossProfit: number;
  marginPercent: number;
}

/**
 * Amazon FBM UK Profit Breakdown
 *
 * Complete breakdown of fees and profit for Amazon FBM sales
 * in the UK market for non-VAT registered sellers (2026 rules).
 */
export interface AmazonFBMProfitBreakdown {
  // Input values
  salePrice: number;
  productCost: number;

  // Fee breakdown
  referralFee: number;        // 15% of sale price
  referralFeeRate: number;    // 0.15
  digitalServicesTax: number; // 2% of referral fee
  dstRate: number;            // 0.02
  vatOnFees: number;          // 20% of (referral + DST)
  vatRate: number;            // 0.20
  totalAmazonFee: number;     // Total fees (18.36% effective)
  effectiveFeeRate: number;   // 0.1836

  // Shipping
  shippingCost: number;       // £3 or £4 depending on price
  shippingTier: string;       // Description of which tier
  shippingThreshold: number;  // £14 threshold

  // Results
  netPayout: number;          // Sale price - fees - shipping
  totalProfit: number;        // Net payout - product cost
  roiPercent: number;         // (profit / cost) * 100
}

// ============================================
// UI State Types
// ============================================

export interface ArbitrageTableSortConfig {
  field: ArbitrageSortField;
  direction: SortDirection;
}

export interface ArbitrageDetailModalData {
  item: ArbitrageItem;
  isOpen: boolean;
}

// ============================================
// Constants
// ============================================

export const DEFAULT_MIN_MARGIN = 30;

export const SHOW_FILTER_OPTIONS: { value: ArbitrageShowFilter; label: string }[] = [
  { value: 'all', label: 'All Items' },
  { value: 'opportunities', label: 'Opportunities Only' },
  { value: 'in_stock', label: 'In Stock (Amazon)' },
  { value: 'zero_qty', label: 'Zero Qty Only' },
  { value: 'pending_review', label: 'Pending Review' },
];

export const SORT_OPTIONS: { value: ArbitrageSortField; label: string }[] = [
  { value: 'margin', label: 'Margin (BL)' },
  { value: 'bl_price', label: 'BL Price' },
  { value: 'sales_rank', label: 'Sales Rank' },
  { value: 'name', label: 'Name' },
];

export const EBAY_SORT_OPTIONS: { value: ArbitrageSortField; label: string }[] = [
  { value: 'ebay_margin', label: 'Margin (eBay)' },
  { value: 'ebay_price', label: 'eBay Price' },
  { value: 'sales_rank', label: 'Sales Rank' },
  { value: 'name', label: 'Name' },
];
