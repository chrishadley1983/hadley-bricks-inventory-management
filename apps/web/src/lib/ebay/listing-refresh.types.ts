/**
 * eBay Listing Refresh Types
 *
 * Types for the listing refresh feature that ends old listings
 * and recreates them to boost eBay algorithm visibility.
 */

import type { FullItemDetails } from '@/lib/platform-stock/ebay/types';

// ============================================================================
// Status Types
// ============================================================================

/**
 * Status of a refresh job (batch operation)
 */
export type RefreshJobStatus =
  | 'pending'
  | 'fetching'
  | 'ending'
  | 'creating'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Status of an individual item within a refresh job
 */
export type RefreshItemStatus =
  | 'pending'
  | 'pending_review'
  | 'approved'
  | 'fetching'
  | 'fetched'
  | 'ending'
  | 'ended'
  | 'creating'
  | 'created'
  | 'failed'
  | 'skipped';

// ============================================================================
// Eligible Listing Types
// ============================================================================

/**
 * A listing that is eligible for refresh (>90 days old)
 */
export interface EligibleListing {
  itemId: string;
  title: string;
  price: number;
  currency: string;
  quantity: number;
  quantityAvailable: number;
  quantitySold: number;
  condition: string | null;
  conditionId: number | null;
  watchers: number;
  views: number | null;
  listingStartDate: Date;
  listingAge: number; // Days since listing started
  galleryUrl: string | null;
  viewItemUrl: string | null;
  sku: string | null;
  categoryId: string | null;
  categoryName: string | null;
  listingType: string;
  bestOfferEnabled: boolean;
}

/**
 * Filters for fetching eligible listings
 */
export interface EligibleListingFilters {
  minAge?: number; // Minimum age in days (default: 90)
  maxPrice?: number;
  minPrice?: number;
  condition?: string;
  hasWatchers?: boolean;
  minWatchers?: number;
  search?: string;
}

// ============================================================================
// Refresh Job Types
// ============================================================================

/**
 * A refresh job (batch operation)
 */
export interface RefreshJob {
  id: string;
  userId: string;
  status: RefreshJobStatus;
  reviewMode: boolean;
  totalListings: number;
  fetchedCount: number;
  endedCount: number;
  createdCount: number;
  failedCount: number;
  skippedCount: number;
  startedAt: Date | null;
  fetchPhaseCompletedAt: Date | null;
  endPhaseCompletedAt: Date | null;
  completedAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  items?: RefreshJobItem[];
}

/**
 * An individual item within a refresh job
 */
export interface RefreshJobItem {
  id: string;
  refreshId: string;
  userId: string;

  // Original listing data
  originalItemId: string;
  originalTitle: string;
  originalPrice: number | null;
  originalQuantity: number | null;
  originalCondition: string | null;
  originalConditionId: number | null;
  originalCategoryId: string | null;
  originalCategoryName: string | null;
  originalStoreCategoryId: string | null;
  originalStoreCategoryName: string | null;
  originalListingType: string | null;
  originalListingStartDate: Date | null;
  originalListingEndDate: Date | null;
  originalWatchers: number;
  originalViews: number | null;
  originalQuantitySold: number;
  originalSku: string | null;
  originalGalleryUrl: string | null;
  originalViewItemUrl: string | null;
  originalBestOfferEnabled: boolean;
  originalBestOfferAutoAccept: number | null;
  originalMinimumBestOffer: number | null;

  // Full details (from GetItem)
  originalDescription: string | null;
  originalImageUrls: string[];
  originalShippingProfileId: string | null;
  originalReturnProfileId: string | null;
  originalPaymentProfileId: string | null;

  // Cached full listing data for recreation
  cachedListingData: FullItemDetails | null;

  // Modified values (user edits)
  modifiedTitle: string | null;
  modifiedPrice: number | null;
  modifiedQuantity: number | null;

  // New listing data
  newItemId: string | null;
  newListingUrl: string | null;
  newListingStartDate: Date | null;

  // Status
  status: RefreshItemStatus;
  fetchCompletedAt: Date | null;
  endCompletedAt: Date | null;
  createCompletedAt: Date | null;

  // Error tracking
  errorPhase: 'fetch' | 'end' | 'create' | null;
  errorCode: string | null;
  errorMessage: string | null;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Progress & Results Types
// ============================================================================

/**
 * Progress event during refresh execution
 */
export interface RefreshProgressEvent {
  phase: 'fetching' | 'ending' | 'creating';
  current: number;
  total: number;
  currentItemId: string;
  currentItemTitle: string;
  fetchedCount: number;
  endedCount: number;
  createdCount: number;
  failedCount: number;
  skippedCount: number;
}

/**
 * Callback for progress updates
 */
export type RefreshProgressCallback = (event: RefreshProgressEvent) => void;

/**
 * Final result of a refresh operation
 */
export interface RefreshResult {
  success: boolean;
  jobId: string;
  totalProcessed: number;
  fetchedCount: number;
  endedCount: number;
  createdCount: number;
  failedCount: number;
  skippedCount: number;
  errors: RefreshError[];
  completedAt: Date;
}

/**
 * Individual error from refresh operation
 */
export interface RefreshError {
  itemId: string;
  title: string;
  phase: 'fetch' | 'end' | 'create';
  errorCode: string | null;
  errorMessage: string;
}

// ============================================================================
// API Request/Response Types
// ============================================================================

/**
 * Request to create a new refresh job
 */
export interface CreateRefreshJobRequest {
  itemIds: string[];
  reviewMode: boolean;
}

/**
 * Response from creating a refresh job
 */
export interface CreateRefreshJobResponse {
  job: RefreshJob;
}

/**
 * Request to update an item before refresh
 */
export interface UpdateRefreshItemRequest {
  title?: string;
  price?: number;
  quantity?: number;
}

/**
 * Request to approve/skip items
 */
export interface BulkItemActionRequest {
  itemIds: string[];
}

/**
 * SSE event types for refresh execution
 */
export type RefreshSSEEventType = 'progress' | 'complete' | 'error';

/**
 * SSE event data
 */
export interface RefreshSSEEvent {
  type: RefreshSSEEventType;
  data?: RefreshProgressEvent | RefreshResult;
  error?: string;
}

// ============================================================================
// Views Enrichment Types
// ============================================================================

/**
 * Progress event during views enrichment (GetItem calls)
 */
export interface ViewsEnrichmentProgress {
  current: number;
  total: number;
  currentItemId: string;
  currentItemTitle: string;
}

/**
 * Callback for views enrichment progress
 */
export type ViewsEnrichmentCallback = (event: ViewsEnrichmentProgress) => void;

/**
 * SSE event types for views enrichment
 */
export type ViewsEnrichmentSSEEventType = 'progress' | 'complete' | 'error';

/**
 * SSE event for views enrichment
 */
export interface ViewsEnrichmentSSEEvent {
  type: ViewsEnrichmentSSEEventType;
  data?: ViewsEnrichmentProgress | { listings: EligibleListing[] };
  error?: string;
}

// ============================================================================
// Scope Validation Types
// ============================================================================

/**
 * Result of OAuth scope validation
 */
export interface ScopeValidationResult {
  isConnected: boolean;
  hasScopes: boolean;
  missingScopes: string[];
  currentScopes: string[];
}

// ============================================================================
// Database Row Types
// ============================================================================

/**
 * Raw database row from ebay_listing_refreshes
 */
export interface RefreshJobRow {
  id: string;
  user_id: string;
  status: RefreshJobStatus;
  total_listings: number;
  fetched_count: number;
  ended_count: number;
  created_count: number;
  failed_count: number;
  skipped_count: number;
  review_mode: boolean;
  started_at: string | null;
  fetch_phase_completed_at: string | null;
  end_phase_completed_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Raw database row from ebay_listing_refresh_items
 */
export interface RefreshItemRow {
  id: string;
  refresh_id: string;
  user_id: string;

  original_item_id: string;
  original_title: string;
  original_price: number | null;
  original_quantity: number | null;
  original_condition: string | null;
  original_condition_id: number | null;
  original_category_id: string | null;
  original_category_name: string | null;
  original_store_category_id: string | null;
  original_store_category_name: string | null;
  original_listing_type: string | null;
  original_listing_start_date: string | null;
  original_listing_end_date: string | null;
  original_watchers: number | null;
  original_views: number | null;
  original_quantity_sold: number | null;
  original_sku: string | null;
  original_gallery_url: string | null;
  original_view_item_url: string | null;
  original_best_offer_enabled: boolean | null;
  original_best_offer_auto_accept: number | null;
  original_minimum_best_offer: number | null;

  original_description: string | null;
  original_image_urls: string[] | null;
  original_shipping_policy_id: string | null;
  original_return_policy_id: string | null;
  original_payment_policy_id: string | null;

  cached_listing_data: Record<string, unknown> | null;

  modified_title: string | null;
  modified_price: number | null;
  modified_quantity: number | null;

  new_item_id: string | null;
  new_listing_url: string | null;
  new_listing_start_date: string | null;

  status: RefreshItemStatus;
  fetch_completed_at: string | null;
  end_completed_at: string | null;
  create_completed_at: string | null;

  error_phase: 'fetch' | 'end' | 'create' | null;
  error_code: string | null;
  error_message: string | null;

  created_at: string;
  updated_at: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert database row to RefreshJob
 */
export function rowToRefreshJob(row: RefreshJobRow): RefreshJob {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    reviewMode: row.review_mode,
    totalListings: row.total_listings,
    fetchedCount: row.fetched_count,
    endedCount: row.ended_count,
    createdCount: row.created_count,
    failedCount: row.failed_count,
    skippedCount: row.skipped_count,
    startedAt: row.started_at ? new Date(row.started_at) : null,
    fetchPhaseCompletedAt: row.fetch_phase_completed_at
      ? new Date(row.fetch_phase_completed_at)
      : null,
    endPhaseCompletedAt: row.end_phase_completed_at ? new Date(row.end_phase_completed_at) : null,
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    errorMessage: row.error_message,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Convert database row to RefreshJobItem
 */
export function rowToRefreshJobItem(row: RefreshItemRow): RefreshJobItem {
  return {
    id: row.id,
    refreshId: row.refresh_id,
    userId: row.user_id,

    originalItemId: row.original_item_id,
    originalTitle: row.original_title,
    originalPrice: row.original_price,
    originalQuantity: row.original_quantity,
    originalCondition: row.original_condition,
    originalConditionId: row.original_condition_id,
    originalCategoryId: row.original_category_id,
    originalCategoryName: row.original_category_name,
    originalStoreCategoryId: row.original_store_category_id,
    originalStoreCategoryName: row.original_store_category_name,
    originalListingType: row.original_listing_type,
    originalListingStartDate: row.original_listing_start_date
      ? new Date(row.original_listing_start_date)
      : null,
    originalListingEndDate: row.original_listing_end_date
      ? new Date(row.original_listing_end_date)
      : null,
    originalWatchers: row.original_watchers ?? 0,
    originalViews: row.original_views,
    originalQuantitySold: row.original_quantity_sold ?? 0,
    originalSku: row.original_sku,
    originalGalleryUrl: row.original_gallery_url,
    originalViewItemUrl: row.original_view_item_url,
    originalBestOfferEnabled: row.original_best_offer_enabled ?? false,
    originalBestOfferAutoAccept: row.original_best_offer_auto_accept,
    originalMinimumBestOffer: row.original_minimum_best_offer,

    originalDescription: row.original_description,
    originalImageUrls: row.original_image_urls ?? [],
    originalShippingProfileId: row.original_shipping_policy_id,
    originalReturnProfileId: row.original_return_policy_id,
    originalPaymentProfileId: row.original_payment_policy_id,

    cachedListingData: row.cached_listing_data as FullItemDetails | null,

    modifiedTitle: row.modified_title,
    modifiedPrice: row.modified_price,
    modifiedQuantity: row.modified_quantity,

    newItemId: row.new_item_id,
    newListingUrl: row.new_listing_url,
    newListingStartDate: row.new_listing_start_date ? new Date(row.new_listing_start_date) : null,

    status: row.status,
    fetchCompletedAt: row.fetch_completed_at ? new Date(row.fetch_completed_at) : null,
    endCompletedAt: row.end_completed_at ? new Date(row.end_completed_at) : null,
    createCompletedAt: row.create_completed_at ? new Date(row.create_completed_at) : null,

    errorPhase: row.error_phase,
    errorCode: row.error_code,
    errorMessage: row.error_message,

    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Calculate listing age in days from start date
 */
export function calculateListingAge(startDate: Date | string): number {
  const start = typeof startDate === 'string' ? new Date(startDate) : startDate;
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}
