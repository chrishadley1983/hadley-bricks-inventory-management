/**
 * Platform Stock Types
 *
 * Types for the platform stock reconciliation feature.
 * Supports multiple platforms (Amazon, eBay, BrickLink) with a normalized interface.
 */

import type { Json } from '@hadley-bricks/database';

// ============================================================================
// PLATFORM TYPES
// ============================================================================

/** Supported platforms for stock reconciliation */
export type StockPlatform = 'amazon' | 'ebay' | 'bricklink';

/** Normalized listing status across platforms */
export type ListingStatus = 'Active' | 'Inactive' | 'Incomplete' | 'Out of Stock' | 'Unknown';

/** Import status */
export type ImportStatus = 'pending' | 'processing' | 'completed' | 'failed';

/** Import type */
export type ImportType = 'full' | 'incremental';

// ============================================================================
// PLATFORM LISTING INTERFACES
// ============================================================================

/**
 * Base listing interface (normalized across platforms)
 */
export interface PlatformListing {
  id: string;
  userId: string;
  platform: StockPlatform;
  platformSku: string | null;
  platformItemId: string; // ASIN for Amazon, Item ID for eBay, Lot ID for BrickLink
  title: string | null;
  quantity: number;
  price: number | null;
  currency: string | null;
  listingStatus: ListingStatus;
  fulfillmentChannel: string | null;
  importId: string;
  rawData: Json;
  createdAt: string;
  updatedAt: string;
}

/**
 * Amazon-specific listing with extended fields
 */
export interface AmazonListing extends PlatformListing {
  platform: 'amazon';
  asin: string; // Alias for platformItemId
  amazonData: AmazonListingData;
}

/**
 * Amazon-specific listing data stored in JSONB
 */
export interface AmazonListingData {
  fnsku: string | null;
  productType: string | null;
  productIdType: string | null;
  itemCondition: string | null;
  itemNote: string | null;
  itemDescription: string | null;
  openDate: string | null;
  willShipInternationally: boolean | null;
  expeditedShipping: boolean | null;
  pendingQuantity: number | null;
  merchantShippingGroup: string | null;
  listingId: string | null;
}

/**
 * eBay-specific listing (for future use)
 */
export interface EbayListing extends PlatformListing {
  platform: 'ebay';
  ebayData: {
    listingType: string | null;
    format: string | null;
    categoryId: string | null;
    storeCategory: string | null;
  };
}

/**
 * BrickLink-specific listing (for future use)
 */
export interface BrickLinkListing extends PlatformListing {
  platform: 'bricklink';
  bricklinkData: {
    lotId: string | null;
    colorId: string | null;
    colorName: string | null;
    categoryId: string | null;
    categoryName: string | null;
  };
}

// ============================================================================
// IMPORT INTERFACES
// ============================================================================

/**
 * Platform listing import record
 */
export interface ListingImport {
  id: string;
  userId: string;
  platform: StockPlatform;
  importType: ImportType;
  status: ImportStatus;
  totalRows: number | null;
  processedRows: number | null;
  errorCount: number | null;
  amazonReportId: string | null;
  amazonReportDocumentId: string | null;
  amazonReportType: string | null;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  errorDetails: Json | null;
  createdAt: string;
}

/**
 * Import trigger response
 */
export interface TriggerImportResponse {
  import: ListingImport;
  message: string;
}

// ============================================================================
// STOCK COMPARISON INTERFACES
// ============================================================================

/** Type of discrepancy between platform and inventory */
export type DiscrepancyType =
  | 'match' // Platform quantity matches inventory count
  | 'platform_only' // Listed on platform but not in inventory
  | 'inventory_only' // In inventory but not listed on platform
  | 'quantity_mismatch' // Both exist but quantities differ
  | 'price_mismatch'; // Both exist but prices differ significantly

/**
 * Stock comparison result for a single item (by ASIN/Item ID)
 */
export interface StockComparison {
  platformItemId: string; // ASIN for Amazon
  platformTitle: string | null;

  // Platform side data
  platformQuantity: number;
  platformListingStatus: string | null;
  platformFulfillmentChannel: string | null;
  platformPrice: number | null;
  platformSku: string | null;

  // Inventory side data
  inventoryQuantity: number;
  inventoryTotalValue: number;
  inventoryItems: InventoryItemSummary[];

  // Discrepancy analysis
  discrepancyType: DiscrepancyType;
  quantityDifference: number; // platform - inventory (positive = more on platform)
  priceDifference: number | null; // platform - avg inventory (positive = platform higher)
}

/**
 * Summary of an inventory item for comparison view
 */
export interface InventoryItemSummary {
  id: string;
  setNumber: string;
  itemName: string | null;
  condition: string | null;
  listingValue: number | null;
  storageLocation: string | null;
  sku: string | null;
  status: string;
  createdAt: string;
}

/**
 * Summary statistics for stock comparison
 */
export interface ComparisonSummary {
  totalPlatformListings: number;
  totalPlatformQuantity: number;
  totalInventoryItems: number;
  matchedItems: number;
  platformOnlyItems: number;
  inventoryOnlyItems: number;
  quantityMismatches: number;
  priceMismatches: number;
  lastImportAt: string | null;
}

// ============================================================================
// FILTER INTERFACES
// ============================================================================

/**
 * Filters for listing view
 */
export interface ListingFilters {
  search?: string;
  listingStatus?: ListingStatus | 'all';
  fulfillmentChannel?: string | 'all';
  hasQuantity?: boolean;
}

/**
 * Filters for comparison view
 */
export interface ComparisonFilters {
  discrepancyType?: DiscrepancyType | 'all';
  search?: string;
  hideZeroQuantities?: boolean;
}

/**
 * Pagination parameters
 */
export interface PaginationParams {
  page: number;
  pageSize: number;
}

/**
 * Paginated response wrapper
 */
export interface PaginatedResponse<T> {
  items: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

// ============================================================================
// API RESPONSE INTERFACES
// ============================================================================

/**
 * GET /api/platform-stock response
 */
export interface PlatformStockListingsResponse {
  listings: PlatformListing[];
  latestImport: ListingImport | null;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

/**
 * GET /api/platform-stock/comparison response
 */
export interface PlatformStockComparisonResponse {
  comparisons: StockComparison[];
  summary: ComparisonSummary;
}

// ============================================================================
// DATABASE ROW TYPES (for mapping from Supabase)
// ============================================================================

/**
 * Raw database row for platform_listings table
 */
export interface PlatformListingRow {
  id: string;
  user_id: string;
  platform: string;
  platform_sku: string | null;
  platform_item_id: string;
  title: string | null;
  quantity: number;
  price: number | null;
  currency: string | null;
  listing_status: string | null;
  fulfillment_channel: string | null;
  amazon_data: Json | null;
  ebay_data: Json | null;
  bricklink_data: Json | null;
  import_id: string;
  raw_data: Json;
  created_at: string;
  updated_at: string;
}

/**
 * Raw database row for platform_listing_imports table
 */
export interface PlatformListingImportRow {
  id: string;
  user_id: string;
  platform: string;
  import_type: string;
  status: string;
  total_rows: number | null;
  processed_rows: number | null;
  error_count: number | null;
  amazon_report_id: string | null;
  amazon_report_document_id: string | null;
  amazon_report_type: string | null;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  error_details: Json | null;
  created_at: string;
}
