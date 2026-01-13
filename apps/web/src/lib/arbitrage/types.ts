/**
 * Arbitrage Tracker Types
 *
 * Types for Amazon vs BrickLink arbitrage comparison feature.
 */

// ============================================
// Database Types
// ============================================

export type AsinSource = 'inventory' | 'discovery' | 'manual' | 'seeded';
export type AsinStatus = 'active' | 'excluded' | 'pending_review';
export type MatchConfidence = 'exact' | 'probable' | 'manual';
export type SyncJobType = 'inventory_asins' | 'amazon_pricing' | 'bricklink_pricing' | 'asin_mapping' | 'ebay_pricing' | 'seeded_discovery';
export type SyncJobStatus = 'idle' | 'running' | 'completed' | 'failed';
export type ItemType = 'inventory' | 'seeded';
export type DiscoveryStatus = 'pending' | 'found' | 'not_found' | 'multiple' | 'excluded';
export type SeededMatchMethod = 'ean' | 'upc' | 'title_exact' | 'title_fuzzy';

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
 * Amazon offer from offers_json
 */
export interface AmazonOffer {
  sellerId: string;
  condition: string;
  subCondition: string;
  fulfillmentType: 'AFN' | 'MFN';
  listingPrice: number;
  shippingPrice: number;
  totalPrice: number;
  currency: string;
  isPrime: boolean;
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
  // New fields for lowest offer fallback
  lowestOfferPrice: number | null;
  priceIsLowestOffer: boolean;
  lowestOfferSellerId: string | null;
  lowestOfferIsFba: boolean | null;
  lowestOfferIsPrime: boolean | null;
  offersJson: AmazonOffer[] | null;
  totalOfferCount: number | null;
  competitivePrice: number | null;
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

  // Amazon lowest offer data (fallback when no buy box)
  lowestOfferPrice: number | null;
  priceIsLowestOffer: boolean | null;
  lowestOfferSellerId: string | null;
  lowestOfferIsFba: boolean | null;
  lowestOfferIsPrime: boolean | null;
  offersJson: AmazonOffer[] | null;
  totalOfferCount: number | null;
  competitivePrice: number | null;
  effectiveAmazonPrice: number | null; // buy_box_price or lowest_offer_price

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

  // Seeded ASIN fields (only populated for seeded items)
  itemType: ItemType;
  seededAsinId: string | null;
  bricksetSetId: string | null;
  bricksetRrp: number | null;
  bricksetYear: number | null;
  bricksetTheme: string | null;
  bricksetPieces: number | null;
  seededMatchMethod: SeededMatchMethod | null;
  seededMatchConfidence: number | null;
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
  | 'ebay_opportunities'
  | 'with_ebay_data'
  | 'no_ebay_data'
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
  profitMarginPercent: number; // (profit / sale price) * 100
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

export const EBAY_SHOW_FILTER_OPTIONS: { value: ArbitrageShowFilter; label: string }[] = [
  { value: 'all', label: 'All Items' },
  { value: 'ebay_opportunities', label: 'Opportunities Only' },
  { value: 'with_ebay_data', label: 'With eBay Data' },
  { value: 'no_ebay_data', label: 'No eBay Data' },
  { value: 'in_stock', label: 'In Stock (Amazon)' },
  { value: 'zero_qty', label: 'Zero Qty Only' },
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

// ============================================
// Seeded ASIN Types
// ============================================

/**
 * Alternative ASIN for multiple match scenarios
 */
export interface AlternativeAsin {
  asin: string;
  title: string;
  confidence: number;
}

/**
 * Seeded ASIN record from brickset_sets
 */
export interface SeededAsin {
  id: string;
  bricksetSetId: string;
  asin: string | null;
  discoveryStatus: DiscoveryStatus;
  matchMethod: SeededMatchMethod | null;
  matchConfidence: number | null;
  amazonTitle: string | null;
  amazonPrice: number | null;
  amazonImageUrl: string | null;
  amazonBrand: string | null;
  alternativeAsins: AlternativeAsin[] | null;
  lastDiscoveryAttemptAt: string | null;
  discoveryAttempts: number;
  discoveryError: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * User's preference for a seeded ASIN
 */
export interface UserSeededAsinPreference {
  id: string;
  userId: string;
  seededAsinId: string;
  includeInSync: boolean;
  userStatus: 'active' | 'excluded';
  exclusionReason: string | null;
  excludedAt: string | null;
  manualAsinOverride: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Seeded ASIN with Brickset set data
 */
export interface SeededAsinWithBrickset extends SeededAsin {
  bricksetSet: {
    id: string;
    setNumber: string;
    setName: string;
    theme: string | null;
    yearFrom: number | null;
    ukRetailPrice: number | null;
    imageUrl: string | null;
    pieces: number | null;
    ean: string | null;
    upc: string | null;
  };
  userPreference?: UserSeededAsinPreference;
}

/**
 * Discovery job result summary
 */
export interface DiscoveryResult {
  processed: number;
  found: number;
  notFound: number;
  multiple: number;
  errors: number;
  durationMs: number;
}

/**
 * Discovery progress event (for streaming updates)
 */
export interface DiscoveryProgress {
  type: 'start' | 'progress' | 'complete' | 'error';
  processed?: number;
  total?: number;
  found?: number;
  percent?: number;
  currentSet?: string;
  result?: DiscoveryResult;
  error?: string;
}

/**
 * Discovery summary statistics
 */
export interface DiscoverySummary {
  pending: number;
  found: number;
  notFound: number;
  multiple: number;
  excluded: number;
  total: number;
  foundPercent: number;
  avgConfidence: number | null;
  lastDiscoveryAt: string | null;
}

// ============================================
// Seeded ASIN Filter Types
// ============================================

export type SeededShowFilter =
  | 'all'
  | 'inventory'
  | 'seeded'
  | 'opportunities'
  | 'ebay_opportunities'
  | 'with_ebay_data'
  | 'no_ebay_data'
  | 'in_stock'
  | 'zero_qty'
  | 'pending_review';

export interface SeededArbitrageFilterOptions extends ArbitrageFilterOptions {
  showSeeded?: boolean;
  itemType?: ItemType | 'all';
}

// ============================================
// Updated Show Filter Options (with seeded)
// ============================================

export const SHOW_FILTER_OPTIONS_WITH_SEEDED: { value: SeededShowFilter; label: string }[] = [
  { value: 'all', label: 'All Items' },
  { value: 'inventory', label: 'Inventory Only' },
  { value: 'seeded', label: 'Seeded Only' },
  { value: 'opportunities', label: 'Opportunities Only' },
  { value: 'in_stock', label: 'In Stock (Amazon)' },
  { value: 'zero_qty', label: 'Zero Qty Only' },
  { value: 'pending_review', label: 'Pending Review' },
];

export const EBAY_SHOW_FILTER_OPTIONS_WITH_SEEDED: { value: SeededShowFilter; label: string }[] = [
  { value: 'all', label: 'All Items' },
  { value: 'inventory', label: 'Inventory Only' },
  { value: 'seeded', label: 'Seeded Only' },
  { value: 'ebay_opportunities', label: 'Opportunities Only' },
  { value: 'with_ebay_data', label: 'With eBay Data' },
  { value: 'no_ebay_data', label: 'No eBay Data' },
  { value: 'in_stock', label: 'In Stock (Amazon)' },
  { value: 'zero_qty', label: 'Zero Qty Only' },
];
