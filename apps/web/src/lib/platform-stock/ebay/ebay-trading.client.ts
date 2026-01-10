/**
 * eBay Trading API Client
 *
 * Handles communication with eBay's Trading API (XML-based).
 * Uses OAuth 2.0 access tokens for authentication via X-EBAY-API-IAF-TOKEN header.
 *
 * @see https://developer.ebay.com/Devzone/XML/docs/Reference/eBay/GetSellerList.html
 */

import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type {
  TradingApiConfig,
  GetMyeBaySellingParams,
  GetMyeBaySellingResult,
  GetSellerListResponse,
  TradingApiItem,
  ParsedEbayListing,
  EbayListingData,
} from './types';
import type { ListingStatus } from '../types';

// ============================================================================
// Constants
// ============================================================================

const EBAY_TRADING_API_URL = 'https://api.ebay.com/ws/api.dll';
const EBAY_API_COMPATIBILITY_LEVEL = '1349';
const DEFAULT_ENTRIES_PER_PAGE = 200; // Max allowed by eBay
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

// ============================================================================
// Error Class
// ============================================================================

export class EbayTradingApiError extends Error {
  constructor(
    message: string,
    public errorCode?: string,
    public shortMessage?: string
  ) {
    super(message);
    this.name = 'EbayTradingApiError';
  }
}

// ============================================================================
// Client Class
// ============================================================================

export class EbayTradingClient {
  private accessToken: string;
  private siteId: number;
  private xmlParser: XMLParser;
  private xmlBuilder: XMLBuilder;

  constructor(config: TradingApiConfig) {
    this.accessToken = config.accessToken;
    this.siteId = config.siteId ?? 3; // Default to UK (Site ID 3)

    // Configure XML parser for eBay's response format
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      parseAttributeValue: false,
      trimValues: true,
    });

    // Configure XML builder for request format
    this.xmlBuilder = new XMLBuilder({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      format: true,
      suppressEmptyNode: true,
    });
  }

  /**
   * Update the access token (for token refresh)
   */
  setAccessToken(token: string): void {
    this.accessToken = token;
  }

  /**
   * Call GetSellerList API to fetch active listings
   *
   * Note: We use GetSellerList instead of GetMyeBaySelling because
   * GetSellerList returns ConditionDisplayName and full SellingStatus,
   * while GetMyeBaySelling only returns a limited subset of Item fields.
   */
  async getActiveListings(params: GetMyeBaySellingParams = {}): Promise<GetMyeBaySellingResult> {
    const pageNumber = params.pageNumber ?? 1;
    const entriesPerPage = params.entriesPerPage ?? DEFAULT_ENTRIES_PER_PAGE;

    const requestXml = this.buildGetSellerListRequest({
      ...params,
      pageNumber,
      entriesPerPage,
    });

    const response = await this.executeRequest('GetSellerList', requestXml);
    return this.parseGetSellerListResponse(response, pageNumber);
  }

  /**
   * Fetch all active listings (handles pagination automatically)
   */
  async getAllActiveListings(
    onProgress?: (current: number, total: number) => void
  ): Promise<ParsedEbayListing[]> {
    const allListings: ParsedEbayListing[] = [];
    let currentPage = 1;
    let totalPages = 1;
    let totalEntries = 0;

    do {
      const result = await this.getActiveListings({
        ActiveList: true,
        pageNumber: currentPage,
        entriesPerPage: DEFAULT_ENTRIES_PER_PAGE,
      });

      allListings.push(...result.items);
      totalPages = result.totalPages;
      totalEntries = result.totalEntries;

      if (onProgress) {
        onProgress(allListings.length, totalEntries);
      }

      currentPage++;
    } while (currentPage <= totalPages);

    return allListings;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Build the XML request for GetSellerList
   *
   * Note: We use GetSellerList instead of GetMyeBaySelling because
   * GetSellerList returns ConditionDisplayName and SellingStatus.ListingStatus,
   * while GetMyeBaySelling only returns a limited subset of Item fields.
   *
   * Important: eBay GetSellerList has a 120-day maximum date range limit.
   * We use EndTimeFrom/EndTimeTo to get listings ending within this range.
   */
  private buildGetSellerListRequest(params: GetMyeBaySellingParams): string {
    // Calculate date range - eBay limits to 120 days max
    // Use current time to 120 days in the future to get all active listings
    const now = new Date();
    const startTime = now; // Start from now
    const endTime = new Date(now.getTime() + 120 * 24 * 60 * 60 * 1000); // 120 days from now

    const request: Record<string, unknown> = {
      GetSellerListRequest: {
        '@_xmlns': 'urn:ebay:apis:eBLBaseComponents',
        DetailLevel: 'ReturnAll',
        // Get items ending within the date range
        EndTimeFrom: startTime.toISOString(),
        EndTimeTo: endTime.toISOString(),
        // Include variations
        IncludeVariations: 'true',
        // Granularity
        GranularityLevel: 'Fine',
        // Pagination
        Pagination: {
          EntriesPerPage: String(params.entriesPerPage ?? DEFAULT_ENTRIES_PER_PAGE),
          PageNumber: String(params.pageNumber ?? 1),
        },
        // OutputSelector for specific fields we want
        OutputSelector: [
          'ItemID',
          'Title',
          'SKU',
          'Quantity',
          'QuantityAvailable',
          'SellingStatus',
          'ListingType',
          'ListingDetails',
          'ConditionID',
          'ConditionDisplayName',
          'PrimaryCategory',
          'Storefront',
          'WatchCount',
          'HitCount',
          'TimeLeft',
          'BestOfferEnabled',
          'BestOfferDetails',
          'PictureDetails',
          'PaginationResult',
          'HasMoreItems',
          'ItemsPerPage',
          'PageNumber',
          'ReturnedItemCountActual',
        ],
      },
    };

    const xml = '<?xml version="1.0" encoding="utf-8"?>\n' + this.xmlBuilder.build(request);
    return xml;
  }

  /**
   * Execute a Trading API request with retries
   */
  private async executeRequest(callName: string, requestXml: string): Promise<GetSellerListResponse> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(EBAY_TRADING_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/xml',
            'X-EBAY-API-CALL-NAME': callName,
            'X-EBAY-API-SITEID': String(this.siteId),
            'X-EBAY-API-COMPATIBILITY-LEVEL': EBAY_API_COMPATIBILITY_LEVEL,
            'X-EBAY-API-IAF-TOKEN': this.accessToken,
          },
          body: requestXml,
        });

        if (!response.ok) {
          throw new EbayTradingApiError(
            `HTTP ${response.status}: ${response.statusText}`,
            String(response.status)
          );
        }

        const responseText = await response.text();
        const parsed = this.xmlParser.parse(responseText) as GetSellerListResponse;

        // Check for API-level errors
        const apiResponse = parsed.GetSellerListResponse;
        if (!apiResponse) {
          throw new EbayTradingApiError('Invalid API response: missing GetSellerListResponse');
        }

        if (apiResponse.Ack === 'Failure') {
          const errors = Array.isArray(apiResponse.Errors)
            ? apiResponse.Errors
            : apiResponse.Errors
              ? [apiResponse.Errors]
              : [];

          const errorMessages = errors.map((e) => e.LongMessage || e.ShortMessage).join('; ');
          const errorCode = errors[0]?.ErrorCode;

          throw new EbayTradingApiError(errorMessages || 'Unknown API error', errorCode);
        }

        return parsed;
      } catch (error) {
        lastError = error as Error;

        // Don't retry on auth errors
        if (error instanceof EbayTradingApiError) {
          if (error.errorCode === '931' || error.errorCode === '932') {
            // Auth token errors - don't retry
            throw error;
          }
        }

        if (attempt < MAX_RETRIES - 1) {
          const delayMs = RETRY_DELAY_MS * Math.pow(2, attempt);
          console.warn(`[EbayTradingClient] Request failed, retrying in ${delayMs}ms:`, error);
          await this.delay(delayMs);
        }
      }
    }

    throw lastError || new EbayTradingApiError('Request failed after maximum retries');
  }

  /**
   * Parse GetSellerList response into normalized listings
   */
  private parseGetSellerListResponse(
    parsed: GetSellerListResponse,
    currentPage: number
  ): GetMyeBaySellingResult {
    const response = parsed.GetSellerListResponse;

    // Handle ItemArray - can be single item or array
    let items: TradingApiItem[] = [];
    if (response.ItemArray?.Item) {
      items = Array.isArray(response.ItemArray.Item)
        ? response.ItemArray.Item
        : [response.ItemArray.Item];
    }

    const pagination = response.PaginationResult;
    const totalEntries = pagination?.TotalNumberOfEntries
      ? parseInt(String(pagination.TotalNumberOfEntries), 10)
      : 0;
    const totalPages = pagination?.TotalNumberOfPages
      ? parseInt(String(pagination.TotalNumberOfPages), 10)
      : 0;

    return {
      items: items.map((item) => this.parseItem(item)),
      totalEntries,
      totalPages,
      currentPage,
    };
  }

  /**
   * Parse a single Trading API item into normalized format
   */
  private parseItem(item: TradingApiItem): ParsedEbayListing {
    const sellingStatus = item.SellingStatus || {};
    const listingDetails = item.ListingDetails || {};
    const currentPrice = sellingStatus.CurrentPrice || {};
    const bestOfferDetails = item.BestOfferDetails || {};

    // Extract price value (handles different XML parser attribute formats)
    const priceValue = this.extractTextValue(currentPrice);
    const currency = currentPrice['@_currencyID'] || currentPrice._currencyID || 'GBP';

    // Extract quantities
    const quantityAvailable = parseInt(String(item.QuantityAvailable ?? item.Quantity ?? 0), 10);
    const quantitySold = parseInt(String(sellingStatus.QuantitySold ?? 0), 10);

    // Build eBay-specific data
    const ebayData: EbayListingData = {
      listingId: item.ItemID,
      listingType: item.ListingType,
      format: this.parseFormat(item.ListingType),
      condition: item.ConditionDisplayName || null,
      conditionId: item.ConditionID ? parseInt(String(item.ConditionID), 10) : null,
      categoryId: item.PrimaryCategory?.CategoryID || null,
      categoryName: item.PrimaryCategory?.CategoryName || null,
      storeCategory: item.Storefront?.StoreCategoryName || null,
      storeCategoryId: item.Storefront?.StoreCategoryID || null,
      watchers: parseInt(String(item.WatchCount ?? 0), 10),
      hitCount: item.HitCount ? parseInt(String(item.HitCount), 10) : null,
      timeLeft: item.TimeLeft || null,
      bidCount: sellingStatus.BidCount ? parseInt(String(sellingStatus.BidCount), 10) : null,
      currentBid: priceValue,
      bestOfferEnabled: item.BestOfferEnabled === 'true' || item.BestOfferEnabled === true,
      bestOfferAutoAcceptPrice: this.extractTextValue(bestOfferDetails.BestOfferAutoAcceptPrice),
      minimumBestOfferPrice: this.extractTextValue(bestOfferDetails.MinimumBestOfferPrice),
      listingStartDate: listingDetails.StartTime,
      listingEndDate: listingDetails.EndTime || null,
      quantitySold,
      quantityAvailable,
      galleryUrl: item.PictureDetails?.GalleryURL || null,
      viewItemUrl: listingDetails.ViewItemURL || null,
    };

    return {
      platformItemId: item.ItemID,
      platformSku: item.SKU || null,
      title: item.Title,
      quantity: quantityAvailable,
      price: priceValue ?? 0,
      currency,
      listingStatus: this.mapListingStatus(sellingStatus.ListingStatus),
      ebayData,
    };
  }

  /**
   * Extract text value from XML node (handles different parser formats)
   */
  private extractTextValue(node: unknown): number | null {
    if (!node || typeof node !== 'object') return null;

    const obj = node as Record<string, unknown>;
    const textValue = obj['#text'] ?? obj['_'] ?? null;

    if (textValue === null || textValue === undefined) return null;
    const parsed = parseFloat(String(textValue));
    return isNaN(parsed) ? null : parsed;
  }

  /**
   * Map eBay listing status to normalized status
   */
  private mapListingStatus(status: string | undefined): ListingStatus {
    switch (status) {
      case 'Active':
        return 'Active';
      case 'Completed':
      case 'Ended':
        return 'Inactive';
      default:
        return 'Unknown';
    }
  }

  /**
   * Parse listing type to format
   */
  private parseFormat(listingType: string | undefined): 'FixedPrice' | 'Auction' {
    if (!listingType) return 'FixedPrice';

    const lower = listingType.toLowerCase();
    if (lower.includes('auction')) {
      return 'Auction';
    }
    return 'FixedPrice';
  }

  /**
   * Delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
