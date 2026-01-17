/**
 * eBay Stock Types
 *
 * Types specific to eBay stock management and Trading API responses.
 */

import type { Json } from '@hadley-bricks/database';
import type {
  PlatformListing,
  StockComparison,
  ListingStatus,
  DiscrepancyType,
} from '../types';

// ============================================================================
// TRADING API RESPONSE TYPES
// ============================================================================

/**
 * Trading API error structure
 */
export interface TradingApiError {
  ShortMessage: string;
  LongMessage: string;
  ErrorCode: string;
  SeverityCode: 'Error' | 'Warning';
  ErrorParameters?: Array<{ Value: string }>;
}

/**
 * Trading API item from GetMyeBaySelling response
 */
export interface TradingApiItem {
  ItemID: string;
  Title: string;
  SKU?: string;
  Quantity: string | number;
  QuantityAvailable: string | number;
  SellingStatus: {
    CurrentPrice: {
      '#text'?: string;
      _?: string;
      '@_currencyID'?: string;
      _currencyID?: string;
    };
    QuantitySold: string | number;
    ListingStatus: string;
    BidCount?: string | number;
    HighBidder?: { UserID: string };
  };
  ListingType: string;
  ListingDetails: {
    StartTime: string;
    EndTime?: string;
    ViewItemURL: string;
  };
  ConditionID?: string | number;
  ConditionDisplayName?: string;
  ConditionDescription?: string; // Seller's custom condition notes (different from ConditionDisplayName)
  PrimaryCategory?: {
    CategoryID: string;
    CategoryName: string;
  };
  Storefront?: {
    StoreCategoryID: string;
    StoreCategoryName: string;
  };
  WatchCount?: string | number;
  HitCount?: string | number;
  TimeLeft?: string;
  BestOfferEnabled?: string | boolean;
  BestOfferDetails?: {
    BestOfferAutoAcceptPrice?: {
      '#text'?: string;
      _?: string;
      '@_currencyID'?: string;
      _currencyID?: string;
    };
    MinimumBestOfferPrice?: {
      '#text'?: string;
      _?: string;
      '@_currencyID'?: string;
      _currencyID?: string;
    };
  };
  PictureDetails?: {
    GalleryURL?: string;
  };
}

/**
 * Pagination result from Trading API
 */
export interface TradingApiPaginationResult {
  TotalNumberOfEntries: string | number;
  TotalNumberOfPages: string | number;
}

/**
 * GetSellerList API Response (parsed from XML)
 * This API returns ConditionDisplayName and full SellingStatus fields.
 */
export interface GetSellerListResponse {
  GetSellerListResponse: {
    Ack: 'Success' | 'Failure' | 'Warning' | 'PartialFailure';
    Errors?: TradingApiError | TradingApiError[];
    ItemArray?: {
      Item: TradingApiItem | TradingApiItem[];
    };
    HasMoreItems?: boolean | string;
    ItemsPerPage?: number | string;
    PageNumber?: number | string;
    PaginationResult?: TradingApiPaginationResult;
    ReturnedItemCountActual?: number | string;
    Timestamp?: string;
    Version?: string;
    Build?: string;
  };
}

// ============================================================================
// EBAY LISTING DATA (Stored in JSONB)
// ============================================================================

/**
 * eBay-specific listing data stored in platform_listings.ebay_data
 */
export interface EbayListingData {
  // Core identifiers
  listingId: string;

  // Listing type & format
  listingType: string; // 'FixedPriceItem' | 'StoreInventory' | 'Auction' | 'AuctionWithBIN'
  format: 'FixedPrice' | 'Auction';

  // Condition
  condition: string | null;
  conditionId: number | null;

  // Categories
  categoryId: string | null;
  categoryName: string | null;
  storeCategory: string | null;
  storeCategoryId: string | null;

  // Engagement metrics
  watchers: number;
  hitCount: number | null;

  // Auction-specific
  timeLeft: string | null; // ISO 8601 duration (P3D2H15M)
  bidCount: number | null;
  currentBid: number | null;

  // Best offer
  bestOfferEnabled: boolean;
  bestOfferAutoAcceptPrice: number | null;
  minimumBestOfferPrice: number | null;

  // Dates
  listingStartDate: string;
  listingEndDate: string | null;

  // Sales tracking
  quantitySold: number;
  quantityAvailable: number;

  // Image & URL
  galleryUrl: string | null;
  viewItemUrl: string | null;
}

// ============================================================================
// PARSED EBAY LISTING (Intermediate type)
// ============================================================================

/**
 * Parsed eBay listing (normalized from Trading API response)
 */
export interface ParsedEbayListing {
  platformItemId: string;
  platformSku: string | null;
  title: string;
  quantity: number;
  price: number;
  currency: string;
  listingStatus: ListingStatus;
  ebayData: EbayListingData;
}

// ============================================================================
// EBAY LISTING (Extended PlatformListing)
// ============================================================================

/**
 * eBay listing type extending base PlatformListing
 */
export interface EbayListing extends PlatformListing {
  platform: 'ebay';
  itemId: string; // Alias for platformItemId
  ebayData: EbayListingData;
}

// ============================================================================
// SKU VALIDATION TYPES
// ============================================================================

/**
 * Type of SKU issue
 */
export type SkuIssueType = 'empty' | 'duplicate';

/**
 * A single SKU issue
 */
export interface SkuIssue {
  id: string;
  sku: string | null;
  itemId: string;
  title: string;
  quantity: number;
  price: number | null;
  listingStatus: string | null;
  issueType: SkuIssueType;
  duplicateCount?: number;
  duplicateItems?: Array<{
    id: string;
    itemId: string;
    title: string;
  }>;
  viewItemUrl?: string | null;
}

/**
 * Result of SKU validation
 */
export interface SkuValidationResult {
  hasIssues: boolean;
  emptySkuCount: number;
  duplicateSkuCount: number;
  totalIssueCount: number;
  issues: SkuIssue[];
}

// ============================================================================
// EBAY STOCK COMPARISON (Extended)
// ============================================================================

/**
 * eBay-specific stock comparison with condition tracking
 */
export interface EbayStockComparison extends StockComparison {
  // eBay-specific fields
  ebayCondition: string | null;
  inventoryCondition: string | null;
  conditionMismatch: boolean;
  listingType: string | null;
  ebayItemId: string | null;
  viewItemUrl: string | null;
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

/**
 * Filters for eBay listings view
 */
export interface EbayListingFilters {
  search?: string;
  listingStatus?: ListingStatus | 'all';
  condition?: string | 'all';
  listingType?: string | 'all';
  hasQuantity?: boolean;
}

/**
 * Filters for eBay comparison view
 */
export interface EbayComparisonFilters {
  discrepancyType?: DiscrepancyType | 'all';
  search?: string;
  hideZeroQuantities?: boolean;
  showConditionMismatchOnly?: boolean;
}

/**
 * Response from GET /api/ebay-stock/sku-issues
 */
export interface SkuIssuesResponse {
  issues: SkuIssue[];
  summary: {
    emptySkuCount: number;
    duplicateSkuCount: number;
    totalIssueCount: number;
  };
}

// ============================================================================
// DATABASE ROW TYPES
// ============================================================================

/**
 * Raw database row from ebay_sku_issues view
 */
export interface EbaySkuIssueRow {
  id: string;
  user_id: string;
  platform_sku: string | null;
  platform_item_id: string;
  title: string | null;
  quantity: number;
  price: number | null;
  listing_status: string | null;
  ebay_data: Json | null;
  sku_count: number;
  issue_type: string;
  created_at: string;
}

// ============================================================================
// TRADING API CLIENT TYPES
// ============================================================================

/**
 * Configuration for Trading API client
 */
export interface TradingApiConfig {
  accessToken: string;
  siteId?: number; // 3 = UK, 0 = US, 77 = Germany, etc.
}

/**
 * Parameters for GetMyeBaySelling call
 */
export interface GetMyeBaySellingParams {
  ActiveList?: boolean;
  SoldList?: boolean;
  UnsoldList?: boolean;
  pageNumber?: number;
  entriesPerPage?: number;
}

/**
 * Result from GetMyeBaySelling call
 */
export interface GetMyeBaySellingResult {
  items: ParsedEbayListing[];
  totalEntries: number;
  totalPages: number;
  currentPage: number;
}

// ============================================================================
// LISTING MANAGEMENT TYPES (End, Create, Get Full Details)
// ============================================================================

/**
 * Reason codes for ending a listing
 * @see https://developer.ebay.com/Devzone/XML/docs/Reference/eBay/types/EndReasonCodeType.html
 */
export type EndReasonCode =
  | 'NotAvailable'
  | 'Incorrect'
  | 'LostOrBroken'
  | 'OtherListingError'
  | 'SellToHighBidder'
  | 'Sold';

/**
 * Result from EndFixedPriceItem call
 */
export interface EndItemResult {
  success: boolean;
  itemId: string;
  endTime?: string;
  errorCode?: string;
  errorMessage?: string;
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
 * Request data for creating a new fixed price listing
 */
export interface AddFixedPriceItemRequest {
  title: string;
  description: string;
  sku?: string;
  startPrice: number;
  quantity: number;
  currency?: string;
  conditionId?: number;
  conditionDescription?: string;
  categoryId: string;
  storeCategoryId?: string;
  listingDuration?: string;
  pictureUrls: string[];

  // Best offer
  bestOfferEnabled?: boolean;
  bestOfferAutoAcceptPrice?: number;
  minimumBestOfferPrice?: number;

  // Business policies (preferred)
  shippingProfileId?: string;
  returnProfileId?: string;
  paymentProfileId?: string;

  // Shipping details (fallback)
  shippingServiceOptions?: ShippingServiceOption[];
  dispatchTimeMax?: number;

  // Return policy (fallback)
  returnsAccepted?: boolean;
  returnsWithin?: string;
  refundOption?: string;
  shippingCostPaidBy?: string;

  // Item specifics
  itemSpecifics?: Array<{ name: string; value: string }>;

  // Location
  location?: string;
  country?: string;
  postalCode?: string;
}

/**
 * Result from AddFixedPriceItem call
 */
export interface AddItemResult {
  success: boolean;
  itemId?: string;
  startTime?: string;
  endTime?: string;
  fees?: EbayFee[];
  errorCode?: string;
  errorMessage?: string;
  warnings?: string[];
}

/**
 * Fee information from listing creation
 */
export interface EbayFee {
  name: string;
  fee: number;
  currency: string;
}

/**
 * Generic Trading API response structure
 */
export interface TradingApiResponse {
  Ack: 'Success' | 'Failure' | 'Warning' | 'PartialFailure';
  Errors?: TradingApiError | TradingApiError[];
  Timestamp?: string;
  Version?: string;
  Build?: string;
}

/**
 * GetItem API Response (parsed from XML)
 */
export interface GetItemResponse {
  GetItemResponse: TradingApiResponse & {
    Item?: TradingApiFullItem;
  };
}

/**
 * EndFixedPriceItem API Response
 */
export interface EndItemResponse {
  EndFixedPriceItemResponse: TradingApiResponse & {
    EndTime?: string;
  };
}

/**
 * AddFixedPriceItem API Response
 */
export interface AddItemResponse {
  AddFixedPriceItemResponse: TradingApiResponse & {
    ItemID?: string;
    StartTime?: string;
    EndTime?: string;
    Fees?: {
      Fee?: TradingApiFee | TradingApiFee[];
    };
  };
}

/**
 * Fee from Trading API response
 */
export interface TradingApiFee {
  Name: string;
  Fee: {
    '#text'?: string;
    _?: string;
    '@_currencyID'?: string;
    _currencyID?: string;
  };
}

/**
 * Full item from GetItem response with all details
 */
export interface TradingApiFullItem extends TradingApiItem {
  Description?: string;
  PictureDetails?: {
    GalleryURL?: string;
    PictureURL?: string | string[];
  };
  ListingDuration?: string;
  ShippingDetails?: {
    ShippingServiceOptions?: TradingApiShippingOption | TradingApiShippingOption[];
    ShippingType?: string;
  };
  ReturnPolicy?: {
    ReturnsAcceptedOption?: string;
    ReturnsWithinOption?: string;
    RefundOption?: string;
    ShippingCostPaidByOption?: string;
    Description?: string;
  };
  SellerProfiles?: {
    SellerShippingProfile?: { ShippingProfileID?: string };
    SellerReturnProfile?: { ReturnProfileID?: string };
    SellerPaymentProfile?: { PaymentProfileID?: string };
  };
  ItemSpecifics?: {
    NameValueList?: TradingApiNameValue | TradingApiNameValue[];
  };
  Location?: string;
  Country?: string;
  PostalCode?: string;
  DispatchTimeMax?: string | number;
}

/**
 * Shipping option from Trading API
 */
export interface TradingApiShippingOption {
  ShippingService?: string;
  ShippingServiceCost?: {
    '#text'?: string;
    _?: string;
    '@_currencyID'?: string;
    _currencyID?: string;
  };
  ShippingServiceAdditionalCost?: {
    '#text'?: string;
    _?: string;
    '@_currencyID'?: string;
    _currencyID?: string;
  };
  ShippingServicePriority?: string | number;
  FreeShipping?: string | boolean;
}

/**
 * Name-value pair from item specifics
 */
export interface TradingApiNameValue {
  Name: string;
  Value: string | string[];
}

// ============================================================================
// REVISE ITEM TYPES
// ============================================================================

/**
 * Request data for revising an existing listing
 * All fields are optional - only provided fields will be updated
 */
export interface ReviseItemRequest {
  itemId: string;
  title?: string;
  description?: string;
  startPrice?: number;
  quantity?: number;
  conditionId?: number;
  conditionDescription?: string;
  itemSpecifics?: Array<{ name: string; value: string }>;
  pictureUrls?: string[];
}

/**
 * Result from ReviseFixedPriceItem call
 */
export interface ReviseItemResult {
  success: boolean;
  itemId: string;
  startTime?: string;
  endTime?: string;
  fees?: EbayFee[];
  errorCode?: string;
  errorMessage?: string;
  warnings?: string[];
}

/**
 * ReviseFixedPriceItem API Response
 */
export interface ReviseItemResponse {
  ReviseFixedPriceItemResponse: TradingApiResponse & {
    ItemID?: string;
    StartTime?: string;
    EndTime?: string;
    Fees?: {
      Fee?: TradingApiFee | TradingApiFee[];
    };
  };
}
