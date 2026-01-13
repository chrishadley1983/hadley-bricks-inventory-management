/**
 * Purchase Evaluator Types
 *
 * Types for the purchase evaluation feature that helps users
 * analyze potential LEGO purchases across Amazon and eBay.
 */

// ============================================
// Database/Status Types
// ============================================

export type EvaluationStatus = 'draft' | 'in_progress' | 'completed' | 'saved' | 'converted';
export type CostAllocationMethod = 'per_item' | 'proportional' | 'equal';
export type TargetPlatform = 'amazon' | 'ebay';
export type LookupStatus = 'pending' | 'found' | 'not_found' | 'multiple' | 'error';
export type AsinSource = 'ean_lookup' | 'upc_lookup' | 'keyword_search' | 'manual';
export type AsinConfidence = 'exact' | 'probable' | 'manual' | 'multiple';

/**
 * Evaluation mode determines calculation approach
 * - cost_known: Traditional mode, purchase price known, calculates profit
 * - max_bid: Photo mode, calculates max purchase price from target margin
 */
export type EvaluationMode = 'cost_known' | 'max_bid';

/**
 * Source of evaluation data
 */
export type EvaluationSource = 'csv_upload' | 'clipboard_paste' | 'photo_analysis';

// ============================================
// Input Types (from CSV/Clipboard)
// ============================================

/**
 * Raw input item from CSV or clipboard paste
 */
export interface EvaluationInputItem {
  setNumber: string;
  setName?: string;
  condition: 'New' | 'Used';
  quantity?: number;
  cost?: number;
  // Photo analysis fields
  itemType?: 'set' | 'minifig' | 'parts_lot' | 'non_lego' | 'unknown';
  boxCondition?: 'Mint' | 'Excellent' | 'Good' | 'Fair' | 'Poor';
  sealStatus?: 'Factory Sealed' | 'Resealed' | 'Open Box' | 'Unknown';
  damageNotes?: string[];
  aiConfidenceScore?: number;
}

/**
 * Error from parsing input
 */
export interface ParseError {
  row: number;
  message: string;
}

/**
 * Result of parsing CSV/clipboard input
 */
export interface ParseResult {
  items: EvaluationInputItem[];
  errors: ParseError[];
  hasCostColumn: boolean;
  hasQuantityColumn: boolean;
}

// ============================================
// Alternative ASIN (for multiple matches)
// ============================================

/**
 * Alternative ASIN found during Amazon search
 */
export interface AlternativeAsin {
  asin: string;
  title: string;
  imageUrl: string | null;
  confidence: number;
}

// ============================================
// Evaluation Item (full data)
// ============================================

/**
 * Complete evaluation item with all pricing data
 */
export interface EvaluationItem {
  id: string;
  evaluationId: string;

  // Item identification
  setNumber: string;
  setName: string | null;
  condition: 'New' | 'Used';
  quantity: number;

  // Cost data
  unitCost: number | null;
  allocatedCost: number | null;

  // Brickset reference
  bricksetSetId: string | null;
  ukRetailPrice: number | null;
  ean: string | null;
  upc: string | null;
  imageUrl: string | null;

  // Platform targeting
  targetPlatform: TargetPlatform;

  // Amazon data
  amazonAsin: string | null;
  amazonAsinSource: AsinSource | null;
  amazonAsinConfidence: AsinConfidence | null;
  amazonAlternativeAsins: AlternativeAsin[] | null;
  amazonBuyBoxPrice: number | null;
  amazonMyPrice: number | null;
  amazonWasPrice: number | null;
  amazonOfferCount: number | null;
  amazonSalesRank: number | null;
  amazonLookupStatus: LookupStatus;
  amazonLookupError: string | null;

  // eBay active listings
  ebayMinPrice: number | null;
  ebayAvgPrice: number | null;
  ebayMaxPrice: number | null;
  ebayListingCount: number | null;

  // eBay sold listings
  ebaySoldMinPrice: number | null;
  ebaySoldAvgPrice: number | null;
  ebaySoldMaxPrice: number | null;
  ebaySoldCount: number | null;
  ebayLookupStatus: LookupStatus;
  ebayLookupError: string | null;

  // Calculated profitability
  expectedSellPrice: number | null;
  cogPercent: number | null;
  grossProfit: number | null;
  profitMarginPercent: number | null;
  roiPercent: number | null;

  // User overrides
  userSellPriceOverride: number | null;
  userNotes: string | null;

  // Status
  needsReview: boolean;

  // Timestamps
  createdAt: string;
  updatedAt: string;
}

// ============================================
// Purchase Evaluation (main record)
// ============================================

/**
 * Purchase evaluation session
 */
export interface PurchaseEvaluation {
  id: string;
  userId: string;

  // Metadata
  name: string | null;
  source: string | null;
  defaultPlatform: TargetPlatform;

  // Evaluation mode (cost_known for traditional, max_bid for photo analysis)
  evaluationMode: EvaluationMode;

  // Cost allocation (traditional mode)
  totalPurchasePrice: number | null;
  costAllocationMethod: CostAllocationMethod | null;

  // Photo analysis mode
  targetMarginPercent: number | null;
  photoAnalysisJson: unknown | null;
  listingDescription: string | null;

  // Summary stats
  itemCount: number;
  totalCost: number | null;
  totalExpectedRevenue: number | null;
  overallMarginPercent: number | null;
  overallRoiPercent: number | null;

  // Status
  status: EvaluationStatus;
  lookupCompletedAt: string | null;

  // Conversion tracking
  convertedAt: string | null;
  convertedPurchaseId: string | null;

  // Timestamps
  createdAt: string;
  updatedAt: string;

  // Related data (populated on detail fetch)
  items?: EvaluationItem[];
}

// ============================================
// Wizard Types
// ============================================

export type EvaluatorWizardStep = 'input' | 'parse' | 'lookup' | 'review' | 'saved';

// ============================================
// Lookup Progress Types
// ============================================

export type LookupPhase = 'brickset' | 'amazon' | 'ebay';

/**
 * Progress update during lookup process
 */
export interface LookupProgress {
  type: 'start' | 'progress' | 'phase_complete' | 'complete' | 'error';
  phase?: LookupPhase;
  processed?: number;
  total?: number;
  percent?: number;
  currentItem?: string;
  message?: string;
  error?: string;
}

// ============================================
// API Request/Response Types
// ============================================

/**
 * Create evaluation request
 */
export interface CreateEvaluationRequest {
  name?: string;
  source: EvaluationSource;
  defaultPlatform: TargetPlatform;
  items: EvaluationInputItem[];

  // Traditional mode (cost_known)
  totalPurchasePrice?: number;
  costAllocationMethod?: CostAllocationMethod;

  // Photo analysis mode (max_bid)
  evaluationMode?: EvaluationMode;
  targetMarginPercent?: number;
  photoAnalysisJson?: unknown;
  listingDescription?: string;
}

/**
 * Update evaluation request
 */
export interface UpdateEvaluationRequest {
  name?: string;
  defaultPlatform?: TargetPlatform;
  totalPurchasePrice?: number;
  costAllocationMethod?: CostAllocationMethod;
  status?: EvaluationStatus;
}

/**
 * Update item request
 */
export interface UpdateItemRequest {
  targetPlatform?: TargetPlatform;
  amazonAsin?: string;
  allocatedCost?: number | null;
  userSellPriceOverride?: number | null;
  userNotes?: string | null;
}

/**
 * Trigger lookup request
 */
export interface TriggerLookupRequest {
  evaluationId: string;
}

/**
 * List evaluations response
 */
export interface EvaluationsListResponse {
  evaluations: PurchaseEvaluation[];
  total: number;
}

// ============================================
// Calculation Types
// ============================================

/**
 * Profitability calculation result
 */
export interface ProfitabilityResult {
  expectedSellPrice: number;
  cogPercent: number;
  grossProfit: number;
  profitMarginPercent: number;
  roiPercent: number;
}

/**
 * Overall evaluation summary
 */
export interface EvaluationSummary {
  itemCount: number;
  itemsWithCost: number;
  itemsWithPrice: number;
  itemsNeedingReview: number;
  totalCost: number;
  totalExpectedRevenue: number;
  totalGrossProfit: number;
  overallMarginPercent: number;
  overallRoiPercent: number;
  averageCogPercent: number;
}

// ============================================
// eBay Sold Listing Types
// ============================================

/**
 * eBay sold listing from Finding API
 */
export interface EbaySoldListing {
  itemId: string;
  title: string;
  soldPrice: number;
  currency: string;
  soldDate: string;
  condition: string;
  url: string;
}

/**
 * eBay sold listings result
 */
export interface EbaySoldResult {
  minPrice: number | null;
  avgPrice: number | null;
  maxPrice: number | null;
  soldCount: number;
  listings: EbaySoldListing[];
}

// ============================================
// Database Row Types (for mapping)
// ============================================

/**
 * Database row type for purchase_evaluations
 */
export interface PurchaseEvaluationRow {
  id: string;
  user_id: string;
  name: string | null;
  source: string | null;
  default_platform: string;
  evaluation_mode: string;
  total_purchase_price: number | null;
  cost_allocation_method: string | null;
  target_margin_percent: number | null;
  photo_analysis_json: unknown | null;
  listing_description: string | null;
  item_count: number;
  total_cost: number | null;
  total_expected_revenue: number | null;
  overall_margin_percent: number | null;
  overall_roi_percent: number | null;
  status: string;
  lookup_completed_at: string | null;
  converted_at: string | null;
  converted_purchase_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Database row type for purchase_evaluation_items
 */
export interface PurchaseEvaluationItemRow {
  id: string;
  evaluation_id: string;
  set_number: string;
  set_name: string | null;
  condition: string;
  quantity: number;
  unit_cost: number | null;
  allocated_cost: number | null;
  brickset_set_id: string | null;
  uk_retail_price: number | null;
  ean: string | null;
  upc: string | null;
  image_url: string | null;
  target_platform: string;
  amazon_asin: string | null;
  amazon_asin_source: string | null;
  amazon_asin_confidence: string | null;
  amazon_alternative_asins: AlternativeAsin[] | null;
  amazon_buy_box_price: number | null;
  amazon_my_price: number | null;
  amazon_was_price: number | null;
  amazon_offer_count: number | null;
  amazon_sales_rank: number | null;
  amazon_lookup_status: string;
  amazon_lookup_error: string | null;
  ebay_min_price: number | null;
  ebay_avg_price: number | null;
  ebay_max_price: number | null;
  ebay_listing_count: number | null;
  ebay_listings_json: unknown | null;
  ebay_sold_min_price: number | null;
  ebay_sold_avg_price: number | null;
  ebay_sold_max_price: number | null;
  ebay_sold_count: number | null;
  ebay_sold_listings_json: EbaySoldListing[] | null;
  ebay_lookup_status: string;
  ebay_lookup_error: string | null;
  expected_sell_price: number | null;
  cog_percent: number | null;
  gross_profit: number | null;
  profit_margin_percent: number | null;
  roi_percent: number | null;
  user_sell_price_override: number | null;
  user_notes: string | null;
  needs_review: boolean;
  created_at: string;
  updated_at: string;
}

// ============================================
// Mapping Functions
// ============================================

/**
 * Convert database row to EvaluationItem
 */
export function rowToEvaluationItem(row: PurchaseEvaluationItemRow): EvaluationItem {
  return {
    id: row.id,
    evaluationId: row.evaluation_id,
    setNumber: row.set_number,
    setName: row.set_name,
    condition: row.condition as 'New' | 'Used',
    quantity: row.quantity,
    unitCost: row.unit_cost,
    allocatedCost: row.allocated_cost,
    bricksetSetId: row.brickset_set_id,
    ukRetailPrice: row.uk_retail_price,
    ean: row.ean,
    upc: row.upc,
    imageUrl: row.image_url,
    targetPlatform: row.target_platform as TargetPlatform,
    amazonAsin: row.amazon_asin,
    amazonAsinSource: row.amazon_asin_source as AsinSource | null,
    amazonAsinConfidence: row.amazon_asin_confidence as AsinConfidence | null,
    amazonAlternativeAsins: row.amazon_alternative_asins,
    amazonBuyBoxPrice: row.amazon_buy_box_price,
    amazonMyPrice: row.amazon_my_price,
    amazonWasPrice: row.amazon_was_price,
    amazonOfferCount: row.amazon_offer_count,
    amazonSalesRank: row.amazon_sales_rank,
    amazonLookupStatus: row.amazon_lookup_status as LookupStatus,
    amazonLookupError: row.amazon_lookup_error,
    ebayMinPrice: row.ebay_min_price,
    ebayAvgPrice: row.ebay_avg_price,
    ebayMaxPrice: row.ebay_max_price,
    ebayListingCount: row.ebay_listing_count,
    ebaySoldMinPrice: row.ebay_sold_min_price,
    ebaySoldAvgPrice: row.ebay_sold_avg_price,
    ebaySoldMaxPrice: row.ebay_sold_max_price,
    ebaySoldCount: row.ebay_sold_count,
    ebayLookupStatus: row.ebay_lookup_status as LookupStatus,
    ebayLookupError: row.ebay_lookup_error,
    expectedSellPrice: row.expected_sell_price,
    cogPercent: row.cog_percent,
    grossProfit: row.gross_profit,
    profitMarginPercent: row.profit_margin_percent,
    roiPercent: row.roi_percent,
    userSellPriceOverride: row.user_sell_price_override,
    userNotes: row.user_notes,
    needsReview: row.needs_review,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Convert database row to PurchaseEvaluation
 */
export function rowToEvaluation(row: PurchaseEvaluationRow): PurchaseEvaluation {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    source: row.source,
    defaultPlatform: row.default_platform as TargetPlatform,
    evaluationMode: (row.evaluation_mode as EvaluationMode) || 'cost_known',
    totalPurchasePrice: row.total_purchase_price,
    costAllocationMethod: row.cost_allocation_method as CostAllocationMethod | null,
    targetMarginPercent: row.target_margin_percent,
    photoAnalysisJson: row.photo_analysis_json,
    listingDescription: row.listing_description,
    itemCount: row.item_count,
    totalCost: row.total_cost,
    totalExpectedRevenue: row.total_expected_revenue,
    overallMarginPercent: row.overall_margin_percent,
    overallRoiPercent: row.overall_roi_percent,
    status: row.status as EvaluationStatus,
    lookupCompletedAt: row.lookup_completed_at,
    convertedAt: row.converted_at,
    convertedPurchaseId: row.converted_purchase_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================
// Conversion Types
// ============================================

/**
 * Editable inventory item for conversion dialog
 */
export interface EditableInventoryItem {
  // Identifying info (from evaluation)
  sourceItemId: string;
  rowIndex: number;

  // Editable fields
  set_number: string;
  item_name: string;
  condition: 'New' | 'Used' | null;
  status: string;
  source: string;
  cost: number | null;
  listing_value: number | null;
  listing_platform: string;
  storage_location: string;
  amazon_asin: string;
  sku: string;
  notes: string;
}

/**
 * Purchase details for conversion
 */
export interface ConversionPurchaseInput {
  purchase_date: string;
  short_description: string;
  cost: number;
  source: string | null;
  payment_method: string | null;
  reference: string | null;
  description: string | null;
}

/**
 * Full conversion request with purchase and inventory items
 */
export interface ConvertEvaluationRequest {
  purchase: ConversionPurchaseInput;
  inventoryItems: Omit<EditableInventoryItem, 'sourceItemId' | 'rowIndex'>[];
}

/**
 * Result of conversion operation
 */
export interface ConversionResult {
  purchase: {
    id: string;
    short_description: string;
    cost: number;
    purchase_date: string;
  };
  inventoryItemCount: number;
  evaluation: PurchaseEvaluation;
}
