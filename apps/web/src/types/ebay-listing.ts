/**
 * Shared eBay listing types
 *
 * Types used across module boundaries (e.g. lib/ai and lib/ebay).
 * Canonical definitions live here to avoid circular dependencies.
 */

// ============================================
// Description Style
// ============================================

/**
 * Description style options for AI-generated content
 */
export type DescriptionStyle =
  | 'Minimalist'
  | 'Standard'
  | 'Professional'
  | 'Friendly'
  | 'Enthusiastic';

// ============================================
// Quality Review Types
// ============================================

/**
 * Individual score breakdown item
 */
export interface QualityScoreItem {
  /** Score for this category */
  score: number;
  /** Feedback for this category */
  feedback: string;
}

/**
 * Category scores for quality review
 */
export interface QualityScoreBreakdown {
  /** Title quality (0-25) */
  title: QualityScoreItem;
  /** Item specifics completeness (0-20) */
  itemSpecifics: QualityScoreItem;
  /** Description quality (0-25) */
  description: QualityScoreItem;
  /** Condition accuracy (0-15) */
  conditionAccuracy: QualityScoreItem;
  /** SEO optimization (0-15) */
  seoOptimization: QualityScoreItem;
}

/**
 * Quality review result from Gemini 3 Pro
 */
export interface QualityReviewResult {
  /** Overall quality score (0-100) */
  score: number;
  /** Letter grade */
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  /** Breakdown by category */
  breakdown: QualityScoreBreakdown;
  /** Critical issues that should be fixed */
  issues: string[];
  /** Non-critical improvement suggestions */
  suggestions: string[];
  /** Things done well */
  highlights: string[];
  /** When the review was completed */
  reviewedAt: string;
  /** AI model used for review */
  reviewerModel: string;
}

// ============================================
// Full Item Details (from Trading API)
// ============================================

/**
 * Shipping service option for listing creation
 */
export interface ShippingServiceOption {
  shippingService: string;
  shippingServiceCost: number;
  shippingServiceAdditionalCost?: number;
  shippingServicePriority: number;
  freeShipping?: boolean;
}

/**
 * Full item details from GetItem response
 * Used to capture complete listing data before ending
 */
export interface FullItemDetails {
  itemId: string;
  title: string;
  description: string;
  sku: string | null;
  quantity: number;
  startPrice: number;
  currency: string;
  conditionId: number | null;
  conditionDescription: string | null;
  categoryId: string;
  categoryName: string | null;
  storeCategoryId: string | null;
  storeCategoryName: string | null;
  listingType: string;
  listingDuration: string | null;
  pictureUrls: string[];
  galleryUrl: string | null;
  viewItemUrl: string | null;

  // Best offer settings
  bestOfferEnabled: boolean;
  bestOfferAutoAcceptPrice: number | null;
  minimumBestOfferPrice: number | null;

  // Shipping and return policies (IDs for business policies)
  shippingProfileId: string | null;
  returnProfileId: string | null;
  paymentProfileId: string | null;

  // Shipping details (fallback if no business policies)
  shippingServiceOptions: ShippingServiceOption[];
  dispatchTimeMax: number | null;

  // Return policy details (fallback if no business policies)
  returnsAccepted: boolean;
  returnsWithin: string | null;
  refundOption: string | null;
  shippingCostPaidBy: string | null;

  // Item specifics
  itemSpecifics: Array<{ name: string; value: string }>;

  // Location
  location: string | null;
  country: string | null;
  postalCode: string | null;

  // Dates
  listingStartDate: string;
  listingEndDate: string | null;

  // Engagement
  watchers: number;
  hitCount: number | null;
  quantitySold: number;
  quantityAvailable: number;
}
