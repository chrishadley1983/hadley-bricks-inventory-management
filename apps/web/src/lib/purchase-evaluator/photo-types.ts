/**
 * Photo Analysis Types for Purchase Evaluator
 *
 * Types for the multi-model AI photo analysis pipeline that identifies
 * LEGO items from photos and assesses their condition.
 */

// ============================================
// Item Classification Types
// ============================================

/**
 * Types of items that can be identified from photos
 */
export type PhotoItemType = 'set' | 'minifig' | 'parts_lot' | 'non_lego' | 'unknown';

/**
 * Box condition grading scale (for sealed sets)
 */
export type BoxCondition = 'Mint' | 'Excellent' | 'Good' | 'Fair' | 'Poor';

/**
 * Seal status for LEGO set boxes
 */
export type SealStatus = 'Factory Sealed' | 'Resealed' | 'Open Box' | 'Unknown';

/**
 * AI models used in the analysis pipeline
 */
export type AIModel = 'opus' | 'gemini' | 'brickognize';

// ============================================
// Model Result Types
// ============================================

/**
 * Individual model's identification result for transparency
 */
export interface ModelIdentification {
  model: AIModel;
  setNumber: string | null;
  setName: string | null;
  confidence: number;
  rawResponse?: string;
}

/**
 * Brickognize-specific item result
 */
export interface BrickognizeItem {
  id: string;
  name: string;
  type: 'part' | 'set' | 'minifig' | 'sticker';
  confidence: number;
  thumbnail: string | null;
  externalIds: {
    bricklink?: string;
    rebrickable?: string;
    brickset?: string;
  };
}

/**
 * Gemini extraction result for set numbers
 */
export interface GeminiSetExtraction {
  setNumber: string;
  confidence: number;
  textSource?: string; // Where the number was found (e.g., "box front", "side panel")
}

// ============================================
// Photo Analysis Item
// ============================================

/**
 * Complete analysis result for a single item identified in photos
 */
export interface PhotoAnalysisItem {
  /** Unique identifier for this item in the analysis */
  id: string;

  /** Type of item identified */
  itemType: PhotoItemType;

  /** LEGO set number (for sets) */
  setNumber: string | null;

  /** Set name or item description */
  setName: string | null;

  /** Condition: New (sealed) or Used (opened/built) */
  condition: 'New' | 'Used';

  /** Box condition grade (for sealed sets) */
  boxCondition: BoxCondition | null;

  /** Seal status assessment */
  sealStatus: SealStatus;

  /** Specific damage or condition notes */
  damageNotes: string[];

  /** Combined confidence score from all models (0.0 - 1.0) */
  confidenceScore: number;

  /** Whether this item needs human review */
  needsReview: boolean;

  /** Reason for flagging for review */
  reviewReason: string | null;

  /** AI's raw description of the item */
  rawDescription: string;

  // Multi-model identification results
  /** Individual results from each AI model */
  modelIdentifications: ModelIdentification[];

  /** True if all models that identified this item agree */
  modelsAgree: boolean;

  // Minifigure-specific fields (from Brickognize)
  /** BrickLink minifigure ID (e.g., "sw0001") */
  minifigId: string | null;

  /** Detailed minifigure description */
  minifigDescription: string | null;

  // Parts lot fields (from Brickognize)
  /** Array of BrickLink part IDs identified */
  partIds: string[] | null;

  /** Estimated parts description */
  partsEstimate: string | null;

  /** Estimated quantity of this item */
  quantity: number;

  // Brickognize raw result (for debugging/display)
  /** Raw Brickognize matches for this item */
  brickognizeMatches?: BrickognizeItem[];
}

// ============================================
// Photo Analysis Result
// ============================================

/**
 * Complete result from the photo analysis pipeline
 */
export interface PhotoAnalysisResult {
  /** All items identified in the photos */
  items: PhotoAnalysisItem[];

  /** Overall notes about the lot */
  overallNotes: string;

  /** Overall confidence in the analysis (0.0 - 1.0) */
  analysisConfidence: number;

  /** Warnings or concerns flagged during analysis */
  warnings: string[];

  /** User-provided listing description (if any) */
  sourceDescription: string | null;

  // Pipeline metadata
  /** Which AI models were used */
  modelsUsed: AIModel[];

  /** Total processing time in milliseconds */
  processingTimeMs: number;

  // Image chunking metadata
  /** Whether image chunking was applied */
  wasChunked?: boolean;

  /** Number of image chunks processed */
  chunkCount?: number;

  /** Chunking decision reason */
  chunkingReason?: string;
}

// ============================================
// Analysis Options
// ============================================

/**
 * Primary model for photo analysis
 * - 'claude': Claude Opus for primary, Gemini for verification (default)
 * - 'gemini': Gemini for primary, Claude for verification (better digit reading)
 */
export type PrimaryAnalysisModel = 'claude' | 'gemini';

/**
 * Options for controlling the analysis pipeline
 */
export interface PhotoAnalysisOptions {
  /** Primary model for analysis (default: 'claude') */
  primaryModel?: PrimaryAnalysisModel;

  /** Use Gemini for cross-verification of set numbers (default: true) */
  useGeminiVerification: boolean;

  /** Use Brickognize for parts/minifig identification (default: true) */
  useBrickognize: boolean;

  /** Optional listing description to provide context */
  listingDescription?: string;

  /** Enable smart image chunking to isolate individual items (default: true) */
  useImageChunking?: boolean;

  /** Force chunking even when detection doesn't recommend it */
  forceChunking?: boolean;
}

// ============================================
// Claude Opus Response Types
// ============================================

/**
 * Expected response structure from Claude Opus analysis
 */
export interface OpusAnalysisResponse {
  items: Array<{
    itemType: PhotoItemType;
    setNumber: string | null;
    setName: string | null;
    condition: 'New' | 'Used';
    boxCondition: BoxCondition | null;
    sealStatus: SealStatus;
    damageNotes: string[];
    confidenceScore: number;
    needsReview: boolean;
    reviewReason: string | null;
    rawDescription: string;
    quantity: number;
    // Minifig fields
    minifigDescription?: string | null;
    // Parts fields
    partsEstimate?: string | null;
  }>;
  overallNotes: string;
  analysisConfidence: number;
  warnings: string[];
}

// ============================================
// Gemini Response Types
// ============================================

/**
 * Expected response structure from Gemini extraction
 */
export interface GeminiExtractionResponse {
  setNumbers: GeminiSetExtraction[];
  otherText?: string[]; // Any other relevant text found
}

// ============================================
// Brickognize API Response Types
// ============================================

/**
 * Bounding box from Brickognize detection
 */
export interface BrickognizeBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
}

/**
 * Single search result from Brickognize API
 */
export interface BrickognizeSearchResult {
  listing_id: string;
  bounding_box: BrickognizeBoundingBox | null;
  items: BrickognizeItem[];
}

/**
 * Full response from Brickognize /predict endpoint
 */
export interface BrickognizeResponse {
  results: BrickognizeSearchResult[];
}

// ============================================
// Image Input Types
// ============================================

/**
 * Image input for analysis
 */
export interface AnalysisImageInput {
  /** Base64-encoded image data (without data URL prefix) */
  base64: string;

  /** MIME type of the image */
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

  /** Optional filename for reference */
  filename?: string;
}

// ============================================
// Evaluation Mode Types
// ============================================

/**
 * Evaluation mode determines how costs/prices are calculated
 */
export type EvaluationMode = 'cost_known' | 'max_bid';

/**
 * Fee breakdown for eBay max purchase price calculation
 */
export interface EbayFeeBreakdown {
  sellPrice: number;
  finalValueFee: number;
  regulatoryFee: number;
  perOrderFee: number;
  paymentProcessingFee: number;
  totalFees: number;
  shippingCost: number;
  targetProfit: number;
  maxPurchasePrice: number;
}

/**
 * Fee breakdown for Amazon max purchase price calculation
 */
export interface AmazonFeeBreakdown {
  sellPrice: number;
  referralFee: number;
  digitalServicesTax: number;
  vatOnFees: number;
  totalFees: number;
  shippingCost: number;
  targetProfit: number;
  maxPurchasePrice: number;
}

// ============================================
// Auction Mode Types
// ============================================

/**
 * Settings for auction mode calculations
 * When enabled, calculates max bid accounting for auction commission and shipping
 */
export interface AuctionSettings {
  /** Whether auction mode is enabled */
  enabled: boolean;
  /** Commission rate as percentage (e.g., 32.94 for 32.94%) */
  commissionPercent: number;
  /** Shipping cost from auction house to buyer */
  shippingCost: number;
}

/**
 * Breakdown of auction-related costs
 */
export interface AuctionBreakdown {
  /** Maximum bid to enter in auction */
  maxBid: number;
  /** Commission amount (bid * commissionPercent / 100) */
  commission: number;
  /** Shipping cost */
  shippingCost: number;
  /** Total paid (maxBid + commission + shipping) */
  totalPaid: number;
}

/**
 * Default auction settings
 */
export const DEFAULT_AUCTION_SETTINGS: AuctionSettings = {
  enabled: false,
  commissionPercent: 32.94,
  shippingCost: 0,
};

// ============================================
// Utility Functions
// ============================================

/**
 * Generate a unique ID for a photo analysis item
 */
export function generatePhotoItemId(): string {
  return `photo-item-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Create an empty photo analysis item with defaults
 */
export function createEmptyPhotoAnalysisItem(
  itemType: PhotoItemType = 'unknown'
): PhotoAnalysisItem {
  return {
    id: generatePhotoItemId(),
    itemType,
    setNumber: null,
    setName: null,
    condition: 'New',
    boxCondition: null,
    sealStatus: 'Unknown',
    damageNotes: [],
    confidenceScore: 0,
    needsReview: true,
    reviewReason: 'Manually added item',
    rawDescription: '',
    modelIdentifications: [],
    modelsAgree: false,
    minifigId: null,
    minifigDescription: null,
    partIds: null,
    partsEstimate: null,
    quantity: 1,
  };
}

/**
 * Get display label for item type
 */
export function getItemTypeLabel(itemType: PhotoItemType): string {
  const labels: Record<PhotoItemType, string> = {
    set: 'LEGO Set',
    minifig: 'Minifigure',
    parts_lot: 'Parts Lot',
    non_lego: 'Non-LEGO',
    unknown: 'Unknown',
  };
  return labels[itemType];
}

/**
 * Get color class for box condition badge
 */
export function getBoxConditionColor(condition: BoxCondition | null): string {
  if (!condition) return 'bg-gray-100 text-gray-800';

  const colors: Record<BoxCondition, string> = {
    Mint: 'bg-emerald-100 text-emerald-800',
    Excellent: 'bg-green-100 text-green-800',
    Good: 'bg-yellow-100 text-yellow-800',
    Fair: 'bg-orange-100 text-orange-800',
    Poor: 'bg-red-100 text-red-800',
  };
  return colors[condition];
}

/**
 * Get color class for confidence indicator
 */
export function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.9) return 'text-emerald-600';
  if (confidence >= 0.7) return 'text-green-600';
  if (confidence >= 0.5) return 'text-yellow-600';
  return 'text-red-600';
}

/**
 * Format confidence as percentage string
 */
export function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}
