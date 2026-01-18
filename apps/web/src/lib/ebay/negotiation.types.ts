/**
 * eBay Negotiation API Types
 *
 * Type definitions for eBay Negotiation API (Sell Negotiation v1)
 * Used for sending offers to interested buyers (watchers/cart abandoners)
 *
 * @see https://developer.ebay.com/api-docs/sell/negotiation/overview.html
 */

// ============================================================================
// API Response Types
// ============================================================================

/**
 * Eligible item returned from findEligibleItems endpoint
 */
export interface EbayEligibleItem {
  listingId: string;
}

/**
 * Response from findEligibleItems endpoint
 */
export interface EbayEligibleItemsResponse {
  eligibleItems: EbayEligibleItem[];
  href?: string;
  limit: number;
  offset: number;
  total: number;
  next?: string;
  prev?: string;
}

/**
 * Buyer information in offer response
 */
export interface EbayOfferBuyer {
  maskedUsername?: string;
}

/**
 * Item offered in an offer
 */
export interface EbayOfferedItem {
  listingId: string;
  discountPercentage?: string;
  quantity?: number;
}

/**
 * Individual offer in the response
 */
export interface EbaySentOffer {
  offerId: string;
  offerStatus: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'COUNTERED' | 'CANCELLED';
  buyer: EbayOfferBuyer;
  creationDate: string;
  expirationDate?: string;
  offeredItems: EbayOfferedItem[];
  message?: string;
}

/**
 * Response from sendOfferToInterestedBuyers endpoint
 */
export interface EbaySendOfferResponse {
  offers: EbaySentOffer[];
  warnings?: EbayNegotiationWarning[];
}

/**
 * Warning in API response
 */
export interface EbayNegotiationWarning {
  errorId?: number;
  domain?: string;
  category?: string;
  message?: string;
  longMessage?: string;
  parameters?: Array<{ name: string; value: string }>;
}

/**
 * Error response from the API
 */
export interface EbayNegotiationError {
  errorId: number;
  domain: string;
  category: string;
  message: string;
  longMessage?: string;
  parameters?: Array<{ name: string; value: string }>;
}

export interface EbayNegotiationErrorResponse {
  errors: EbayNegotiationError[];
}

// ============================================================================
// API Request Types
// ============================================================================

/**
 * Item to include in offer request
 */
export interface OfferRequestItem {
  listingId: string;
  quantity: number;
  discountPercentage: string;
}

/**
 * Duration for the offer
 */
export interface OfferDuration {
  unit: 'DAY' | 'HOUR';
  value: number;
}

/**
 * Request body for sendOfferToInterestedBuyers
 */
export interface SendOfferRequest {
  allowCounterOffer?: boolean;
  message?: string;
  offeredItems: OfferRequestItem[];
  offerDuration: OfferDuration;
}

// ============================================================================
// Scoring Types
// ============================================================================

/**
 * Configuration for scoring weights
 */
export interface NegotiationScoringWeights {
  listingAge: number;
  stockLevel: number;
  itemValue: number;
  category: number;
  watchers: number;
}

/**
 * Input data for scoring calculation
 */
export interface NegotiationScoringInput {
  originalListingDate: Date;
  stockLevel: number;
  itemCost: number;
  category?: string;
  watcherCount: number;
}

/**
 * Result from score calculation
 */
export interface NegotiationScoreResult {
  score: number;
  factors: {
    listing_age: number;
    stock_level: number;
    item_value: number;
    category: number;
    watchers: number;
  };
}

// ============================================================================
// Service Types
// ============================================================================

/**
 * Enriched eligible item with scoring and listing data
 */
export interface EnrichedEligibleItem {
  listingId: string;
  inventoryItemId?: string;
  title?: string;
  originalListingDate?: Date;
  currentPrice?: number;
  stockLevel: number;
  watcherCount: number;
  /** Number of buyers who previously received offers for this listing */
  previousOfferCount: number;
  category?: string;
  score: number;
  scoreFactors: NegotiationScoreResult['factors'];
  discountPercentage: number;
  isReOffer: boolean;
  previousOfferId?: string;
}

/**
 * Result of sending a single offer
 */
export interface SendOfferResult {
  success: boolean;
  listingId: string;
  ebayOfferId?: string;
  buyerMaskedUsername?: string;
  discountPercentage: number;
  score: number;
  error?: string;
  offersCreated?: number;
}

/**
 * Summary result from processing all offers
 */
export interface ProcessOffersResult {
  offersSent: number;
  offersFailed: number;
  offersSkipped: number;
  eligibleCount: number;
  results: SendOfferResult[];
  errors: string[];
}

/**
 * Negotiation metrics for dashboard
 */
export interface NegotiationMetrics {
  totalOffersSent: number;
  offersAccepted: number;
  offersDeclined: number;
  offersExpired: number;
  offersPending: number;
  acceptanceRate: number;
  avgDiscountSent: number;
  avgDiscountConverted: number;
}

/**
 * Configuration from database
 */
export interface NegotiationConfig {
  id: string;
  userId: string;
  automationEnabled: boolean;
  minDaysBeforeOffer: number;
  reOfferCooldownDays: number;
  reOfferEscalationPercent: number;
  weightListingAge: number;
  weightStockLevel: number;
  weightItemValue: number;
  weightCategory: number;
  weightWatchers: number;
  /**
   * Message template for offers. Supports placeholders:
   * {discount} - discount percentage (e.g., "20")
   * {title} - listing title
   * {price} - original price (e.g., "£19.99")
   * {offer_price} - discounted price (e.g., "£15.99")
   */
  offerMessageTemplate: string;
  lastAutoRunAt?: Date;
  lastAutoRunOffersSent?: number;
}

/**
 * Discount rule from database
 */
export interface NegotiationDiscountRule {
  id: string;
  userId: string;
  minScore: number;
  maxScore: number;
  discountPercentage: number;
}

/**
 * Offer record from database
 */
export interface NegotiationOffer {
  id: string;
  userId: string;
  ebayListingId: string;
  listingTitle?: string;
  inventoryItemId?: string;
  ebayOfferId?: string;
  buyerMaskedUsername?: string;
  discountPercentage: number;
  originalPrice?: number;
  offerPrice?: number;
  score: number;
  scoreFactors: NegotiationScoreResult['factors'];
  offerMessage?: string;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'FAILED';
  isReOffer: boolean;
  previousOfferId?: string;
  triggerType: 'manual' | 'automated';
  sentAt: Date;
  expiresAt?: Date;
  statusUpdatedAt?: Date;
  errorMessage?: string;
}

/**
 * Re-offer eligibility check result
 */
export interface ReOfferEligibility {
  canSend: boolean;
  lastOfferDate?: Date;
  lastDiscount?: number;
  daysSinceLast?: number;
}

// ============================================================================
// API Route Types
// ============================================================================

/**
 * Request for manual send offers
 */
export interface SendOffersApiRequest {
  listingIds?: string[];
  dryRun?: boolean;
}

/**
 * Response from send offers API
 */
export interface SendOffersApiResponse {
  success: boolean;
  data?: ProcessOffersResult;
  error?: string;
}

/**
 * Request for updating config
 */
export interface UpdateConfigApiRequest {
  automationEnabled?: boolean;
  minDaysBeforeOffer?: number;
  reOfferCooldownDays?: number;
  reOfferEscalationPercent?: number;
  weightListingAge?: number;
  weightStockLevel?: number;
  weightItemValue?: number;
  weightCategory?: number;
  weightWatchers?: number;
  /**
   * Message template for offers. Supports placeholders:
   * {discount} - discount percentage (e.g., "20")
   * {title} - listing title
   * {price} - original price (e.g., "£19.99")
   * {offer_price} - discounted price (e.g., "£15.99")
   */
  offerMessageTemplate?: string;
}

/**
 * Request for creating/updating discount rule
 */
export interface DiscountRuleApiRequest {
  minScore: number;
  maxScore: number;
  discountPercentage: number;
}

/**
 * Filter params for offers list
 */
export interface OffersListParams {
  status?: string;
  triggerType?: 'manual' | 'automated';
  listingId?: string;
  limit?: number;
  offset?: number;
  startDate?: string;
  endDate?: string;
}
