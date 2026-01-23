/**
 * Amazon Sync Types
 *
 * TypeScript types for the Amazon Feed Sync feature.
 * Covers queue items, feeds, feed items, and feed payloads.
 */

import type { Database } from '@hadley-bricks/database';

// ============================================================================
// DATABASE ROW TYPES
// ============================================================================

export type AmazonSyncQueueRow =
  Database['public']['Tables']['amazon_sync_queue']['Row'];
export type AmazonSyncQueueInsert =
  Database['public']['Tables']['amazon_sync_queue']['Insert'];
export type AmazonSyncQueueUpdate =
  Database['public']['Tables']['amazon_sync_queue']['Update'];

export type AmazonSyncFeedRow =
  Database['public']['Tables']['amazon_sync_feeds']['Row'];
export type AmazonSyncFeedInsert =
  Database['public']['Tables']['amazon_sync_feeds']['Insert'];
export type AmazonSyncFeedUpdate =
  Database['public']['Tables']['amazon_sync_feeds']['Update'];

export type AmazonSyncFeedItemRow =
  Database['public']['Tables']['amazon_sync_feed_items']['Row'];
export type AmazonSyncFeedItemInsert =
  Database['public']['Tables']['amazon_sync_feed_items']['Insert'];
export type AmazonSyncFeedItemUpdate =
  Database['public']['Tables']['amazon_sync_feed_items']['Update'];

// ============================================================================
// FEED STATUS TYPES
// ============================================================================

/**
 * Feed processing status
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │                        FEED STATUS REFERENCE TABLE                          │
 * ├─────────────────────┬───────────────────────────────────────────────────────┤
 * │ Status              │ Meaning                                               │
 * ├─────────────────────┼───────────────────────────────────────────────────────┤
 * │ pending             │ Feed created locally, not yet submitted to Amazon     │
 * │ submitted           │ Feed sent to Amazon, waiting for processing to start  │
 * │ processing          │ Amazon is actively processing the feed                │
 * │ done                │ Amazon finished processing - check items for results  │
 * │ done_verifying      │ Feed has new SKUs - waiting to verify price on Amazon │
 * │                     │ (Amazon takes up to 30 min to apply price)            │
 * │ verified            │ All prices verified on Amazon - fully complete!       │
 * │ verification_failed │ Price not applied after 30 min timeout                │
 * │ cancelled           │ Feed was cancelled by Amazon                          │
 * │ fatal               │ Amazon returned a fatal error                         │
 * │ error               │ Client-side error occurred                            │
 * │ processing_timeout  │ Polling timed out after 15 minutes                    │
 * └─────────────────────┴───────────────────────────────────────────────────────┘
 *
 * Flow for NEW SKU submissions (creating offer on existing ASIN):
 *   pending → submitted → processing → done → done_verifying → verified
 *                                                          ↘ verification_failed
 *
 * Flow for EXISTING SKU updates (PATCH operations):
 *   pending → submitted → processing → done
 *
 * Why the verification step?
 * Amazon processes listings in stages with delays:
 *   1. Listing/SKU created (immediate)
 *   2. Quantity updated (~few minutes)
 *   3. Price applied (~up to 30 minutes) ← This is why we verify!
 *
 * The done_verifying status exists because Amazon returns "ACCEPTED" for the
 * feed but the price may not actually be visible on the listing yet.
 */
export type FeedStatus =
  | 'pending'
  | 'submitted'
  | 'processing'
  | 'done'                   // Feed accepted by Amazon, but price may not be applied yet
  | 'done_verifying'         // Verifying price on Amazon (up to 30 min delay)
  | 'verified'               // Price verified on Amazon - fully complete
  | 'verification_failed'    // Price not set correctly after verification period
  | 'cancelled'
  | 'fatal'
  | 'error'
  | 'processing_timeout';

/**
 * Feed item status (per-SKU status within a feed)
 *
 * ┌─────────────────────┬───────────────────────────────────────────────────────┐
 * │ Status              │ Meaning                                               │
 * ├─────────────────────┼───────────────────────────────────────────────────────┤
 * │ pending             │ Awaiting result from Amazon                           │
 * │ accepted            │ Amazon accepted - new SKU awaiting price verification │
 * │ verifying           │ Actively checking if price is on Amazon               │
 * │ success             │ Fully complete - price verified on Amazon             │
 * │ warning             │ Completed with warnings from Amazon                   │
 * │ error               │ Failed - Amazon returned error                        │
 * │ verification_failed │ Price not applied after 30 min timeout                │
 * └─────────────────────┴───────────────────────────────────────────────────────┘
 *
 * Note: 'accepted' is used instead of 'success' for new SKUs because
 * Amazon may return ACCEPTED but the price isn't actually applied yet.
 * Only after price verification do we mark as 'success'.
 */
export type FeedItemStatus =
  | 'pending'
  | 'accepted'               // Amazon accepted the message (new SKU - needs verification)
  | 'verifying'              // Verifying price/quantity on Amazon
  | 'success'                // Successfully updated and verified
  | 'warning'                // Updated with warnings from Amazon
  | 'error'                  // Failed with errors from Amazon
  | 'verification_failed';   // Price/quantity not applied after timeout

// ============================================================================
// QUEUE ITEM TYPES
// ============================================================================

/**
 * Queue item with joined inventory details for display
 */
export interface QueueItemWithDetails extends AmazonSyncQueueRow {
  inventoryItem: {
    id: string;
    set_number: string;
    item_name: string | null;
    condition: string | null;
    storage_location: string | null;
    listing_value: number | null;
  };
  /** Price difference: local - amazon (positive = raising price) */
  priceDifference: number | null;
  /** Quantity difference: local - amazon (positive = adding stock) */
  quantityDifference: number | null;
}

/**
 * Aggregated queue items by ASIN for feed submission
 */
export interface AggregatedQueueItem {
  asin: string;
  amazonSku: string;
  price: number;
  /** Number of items in the queue for this ASIN */
  queueQuantity: number;
  /** Existing quantity on Amazon (0 for new SKUs) */
  existingAmazonQuantity: number;
  /** Total quantity to set on Amazon (existingAmazonQuantity + queueQuantity) */
  totalQuantity: number;
  inventoryItemIds: string[];
  queueItemIds: string[];
  itemNames: string[];
  /** Product type from Amazon Catalog API (e.g., 'TOY', 'BUILDING_BLOCKS') */
  productType: string;
  /** True if this is a new SKU that needs to be created on Amazon */
  isNewSku: boolean;
}

// ============================================================================
// FEED TYPES
// ============================================================================

/**
 * Sync feed with summary for list display (omits large payloads)
 */
export type SyncFeed = Omit<AmazonSyncFeedRow, 'request_payload' | 'response_payload' | 'result_payload'>;

/**
 * Feed item with additional display info
 */
export interface FeedItemWithDetails extends AmazonSyncFeedItemRow {
  /** Item names from the aggregated inventory items */
  itemNames?: string[];
  /** Set numbers from the aggregated inventory items */
  setNumbers?: string[];
}

/**
 * Sync feed with full details including items
 */
export interface SyncFeedWithDetails extends AmazonSyncFeedRow {
  items: FeedItemWithDetails[];
}

// ============================================================================
// SP-API FEEDS TYPES
// ============================================================================

/**
 * Feed processing status from Amazon
 */
export type AmazonFeedProcessingStatus =
  | 'CANCELLED'
  | 'DONE'
  | 'FATAL'
  | 'IN_PROGRESS'
  | 'IN_QUEUE';

/**
 * Create feed document response from Amazon
 */
export interface CreateFeedDocumentResponse {
  feedDocumentId: string;
  url: string;
}

/**
 * Create feed response from Amazon
 */
export interface CreateFeedResponse {
  feedId: string;
}

/**
 * Feed status response from Amazon
 */
export interface FeedStatusResponse {
  feedId: string;
  feedType: string;
  marketplaceIds: string[];
  createdTime: string;
  processingStatus: AmazonFeedProcessingStatus;
  processingStartTime?: string;
  processingEndTime?: string;
  resultFeedDocumentId?: string;
}

/**
 * Feed result document response from Amazon
 */
export interface FeedResultDocumentResponse {
  feedDocumentId: string;
  url: string;
  compressionAlgorithm?: 'GZIP';
}

// ============================================================================
// JSON_LISTINGS_FEED PAYLOAD TYPES
// ============================================================================

/**
 * JSON Listings Feed header
 */
export interface ListingsFeedHeader {
  sellerId: string;
  version: string;
  issueLocale: string;
}

/**
 * JSON Listings Feed patch operation
 */
export interface ListingsFeedPatch {
  op: 'replace' | 'add' | 'delete';
  path: string;
  value: unknown;
}

/**
 * Requirements set for the listing submission
 *
 * - LISTING: Full product facts and sales terms (default)
 * - LISTING_PRODUCT_ONLY: Product facts only
 * - LISTING_OFFER_ONLY: Sales terms only (for offers on existing ASINs)
 */
export type ListingsFeedRequirements =
  | 'LISTING'
  | 'LISTING_PRODUCT_ONLY'
  | 'LISTING_OFFER_ONLY';

/**
 * JSON Listings Feed message for a single SKU
 *
 * - PATCH: Update existing SKU using JSON Patch operations
 * - UPDATE: Create new SKU or full replace (used for new offers on existing ASINs)
 */
export interface ListingsFeedMessage {
  messageId: number;
  sku: string;
  operationType: 'PATCH' | 'UPDATE';
  productType: string;
  /**
   * Requirements set - determines what attributes are validated
   * Use 'LISTING_OFFER_ONLY' when creating an offer on an existing ASIN
   */
  requirements?: ListingsFeedRequirements;
  /** Patches array - used when operationType is 'PATCH' */
  patches?: ListingsFeedPatch[];
  /** Attributes object - used when operationType is 'UPDATE' */
  attributes?: Record<string, unknown>;
}

/**
 * Complete JSON Listings Feed payload
 */
export interface ListingsFeedPayload {
  header: ListingsFeedHeader;
  messages: ListingsFeedMessage[];
}

// ============================================================================
// FEED RESULT TYPES
// ============================================================================

/**
 * Processing report from feed result (actual Amazon response format)
 */
export interface FeedProcessingReport {
  header: {
    sellerId: string;
    version: string;
    feedId: string;
  };
  issues?: FeedResultIssue[];
  summary: {
    errors: number;
    warnings: number;
    messagesProcessed: number;
    messagesAccepted: number;
    messagesInvalid: number;
  };
}

/**
 * Issue from feed processing result
 */
export interface FeedResultIssue {
  messageId: number;
  code: string;
  severity: 'ERROR' | 'WARNING';
  message: string;
  sku: string;
}

/**
 * Error details from feed result (used internally)
 */
export interface FeedResultError {
  code: string;
  message: string;
  details?: string;
}

/**
 * Warning details from feed result (used internally)
 */
export interface FeedResultWarning {
  code: string;
  message: string;
  details?: string;
}

// ============================================================================
// SP-API LISTINGS TYPES (for dry run validation)
// ============================================================================

/**
 * Listings API patch request
 */
export interface ListingsPatchRequest {
  productType: string;
  patches: ListingsFeedPatch[];
}

/**
 * Validation result from dry run
 */
export interface ListingsValidationResult {
  sku: string;
  status: 'VALID' | 'INVALID';
  submissionId?: string;
  issues?: ListingsValidationIssue[];
}

/**
 * Validation issue from dry run
 */
export interface ListingsValidationIssue {
  code: string;
  message: string;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  attributeNames?: string[];
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

/**
 * Response from GET /api/amazon/sync/queue
 */
export interface SyncQueueResponse {
  items: QueueItemWithDetails[];
  aggregated: AggregatedQueueItem[];
  summary: {
    totalItems: number;
    uniqueAsins: number;
    totalQuantity: number;
  };
}

/**
 * Price conflict detected when adding to queue
 *
 * This occurs when:
 * 1. Local price differs from existing Amazon listing price
 * 2. Local price differs from another queued item with the same ASIN
 */
export interface PriceConflict {
  type: 'amazon' | 'queue';
  inventoryItemId: string;
  asin: string;
  setNumber: string;
  itemName: string | null;
  localPrice: number;
  conflictPrice: number;
  /** For queue conflicts, the inventory item ID of the conflicting queued item */
  conflictingQueueItemId?: string;
}

/**
 * Response from POST /api/amazon/sync/queue
 */
export interface AddToQueueResponse {
  item?: AmazonSyncQueueRow;
  priceConflict?: PriceConflict;
  message: string;
}

/**
 * Response from POST /api/amazon/sync/submit
 */
export interface SubmitFeedResponse {
  feed: SyncFeed;
  message: string;
}

/**
 * Response from GET /api/amazon/sync/feeds
 */
export interface FeedHistoryResponse {
  feeds: SyncFeed[];
}

/**
 * Response from GET /api/amazon/sync/feeds/[id]
 */
export interface FeedDetailResponse {
  feed: SyncFeedWithDetails;
}

/**
 * Response from POST /api/amazon/sync/feeds/[id]/poll
 */
export interface PollFeedResponse {
  feed: SyncFeed;
  isComplete: boolean;
  message: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** UK Marketplace ID */
export const UK_MARKETPLACE_ID = 'A1F83G8C2ARO7P';

/** Default product type for Lego items */
export const DEFAULT_PRODUCT_TYPE = 'TOY_BUILDING_BLOCK';

/** Feed polling interval in milliseconds (30 seconds) */
export const POLL_INTERVAL_MS = 30000;

/** Maximum polling duration in milliseconds (30 minutes - extended for new SKUs) */
export const MAX_POLL_DURATION_MS = 30 * 60 * 1000;

/** Maximum number of poll attempts (60 attempts = 30 minutes at 30s intervals) */
export const MAX_POLL_ATTEMPTS = 60;

/** Product type cache TTL in days (180 days = 6 months) */
export const PRODUCT_TYPE_CACHE_TTL_DAYS = 180;

// ============================================================================
// PRICE VERIFICATION CONSTANTS
// ============================================================================

/** How long to wait before first price verification attempt (5 minutes) */
export const VERIFICATION_INITIAL_DELAY_MS = 5 * 60 * 1000;

/** Interval between verification attempts (5 minutes) */
export const VERIFICATION_INTERVAL_MS = 5 * 60 * 1000;

/** Maximum time to wait for price verification (30 minutes) */
export const VERIFICATION_TIMEOUT_MS = 30 * 60 * 1000;

/** Maximum number of verification attempts */
export const MAX_VERIFICATION_ATTEMPTS = 6;

// ============================================================================
// TWO-PHASE SYNC TYPES
// ============================================================================

/**
 * Sync mode determines how price and quantity updates are submitted
 *
 * - single: Current behavior - price and quantity in one feed
 * - two_phase: Price feed first, verify, then quantity feed
 */
export type SyncMode = 'single' | 'two_phase';

/**
 * Phase within a two-phase sync
 */
export type SyncPhase = 'price' | 'quantity';

/**
 * Extended feed status for two-phase sync tracking
 *
 * Combines with FeedStatus for full status tracking:
 * - price_pending: Price feed not yet submitted
 * - price_submitted: Price feed submitted to Amazon
 * - price_processing: Amazon processing price feed
 * - price_verifying: Waiting for price to propagate (up to 30 min)
 * - price_verified: Price confirmed live - ready for quantity
 * - quantity_pending: Quantity feed not yet submitted
 * - quantity_submitted: Quantity feed submitted
 * - quantity_processing: Amazon processing quantity
 * - completed: Both phases complete
 * - failed: Either phase failed
 */
export type TwoPhaseStatus =
  | 'price_pending'
  | 'price_submitted'
  | 'price_processing'
  | 'price_verifying'
  | 'price_verified'
  | 'quantity_pending'
  | 'quantity_submitted'
  | 'quantity_processing'
  | 'completed'
  | 'failed';

/**
 * Options for feed submission
 */
export interface SubmitFeedOptions {
  dryRun: boolean;
  syncMode: SyncMode;
  /** User email for notifications (required for two_phase mode) */
  userEmail?: string;
  /** For two_phase: max time to wait for price verification (ms) */
  priceVerificationTimeout?: number;
  /** For two_phase: polling interval for price verification (ms) */
  priceVerificationInterval?: number;
}

/**
 * Two-phase sync result
 */
export interface TwoPhaseResult {
  priceFeed: SyncFeed;
  quantityFeed?: SyncFeed;
  status: TwoPhaseStatus;
  priceVerifiedAt?: string;
  error?: string;
}

/**
 * Result from processing a single step of two-phase sync
 * Used by the background processor
 */
export interface TwoPhaseStepResult {
  feedId: string;
  status: TwoPhaseStatus;
  /** Current step that was just processed */
  step: 'price_polling' | 'price_verification' | 'quantity_submission' | 'quantity_polling' | 'complete';
  /** Whether processing is complete (success or failure) */
  isComplete: boolean;
  /** Message describing what happened */
  message: string;
  /** Error message if failed */
  error?: string;
  /** Price feed details */
  priceFeed?: SyncFeed;
  /** Quantity feed details (only after quantity submission) */
  quantityFeed?: SyncFeed;
  /** When price was verified (ISO string) */
  priceVerifiedAt?: string;
  /** Recommended delay before next poll (ms) */
  nextPollDelay?: number;
}

// ============================================================================
// TWO-PHASE SYNC CONSTANTS
// ============================================================================

/**
 * Default two-phase sync configuration
 */
export const TWO_PHASE_DEFAULTS = {
  /** Max time to wait for price verification (30 minutes - Amazon can be slow) */
  priceVerificationTimeout: 30 * 60 * 1000,

  /** How often to check if price is live (30 seconds) */
  priceVerificationInterval: 30 * 1000,

  /** Whether two-phase is the default mode */
  defaultSyncMode: 'single' as const,

  /** Email notifications (always enabled for two-phase) */
  emailOnSuccess: true,
  emailOnFailure: true,
};
