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
  EndReasonCode,
  EndItemResult,
  EndItemResponse,
  FullItemDetails,
  GetItemResponse,
  TradingApiFullItem,
  TradingApiShippingOption,
  TradingApiNameValue,
  AddFixedPriceItemRequest,
  AddItemResult,
  AddItemResponse,
  TradingApiFee,
  ShippingServiceOption,
  ReviseItemRequest,
  ReviseItemResult,
  ReviseItemResponse,
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
  // Listing Management Methods
  // ============================================================================

  /**
   * Get full item details including description and images
   * Required for capturing complete listing data before ending
   *
   * @see https://developer.ebay.com/Devzone/XML/docs/Reference/eBay/GetItem.html
   */
  async getItem(itemId: string): Promise<FullItemDetails> {
    const requestXml = this.buildGetItemRequest(itemId);
    const response = await this.executeGenericRequest<GetItemResponse>('GetItem', requestXml);

    const apiResponse = response.GetItemResponse;
    if (!apiResponse) {
      throw new EbayTradingApiError('Invalid API response: missing GetItemResponse');
    }

    this.checkApiErrors(apiResponse);

    if (!apiResponse.Item) {
      throw new EbayTradingApiError(`Item not found: ${itemId}`, '17');
    }

    return this.parseFullItem(apiResponse.Item);
  }

  /**
   * End a fixed-price listing
   *
   * @see https://developer.ebay.com/Devzone/XML/docs/Reference/eBay/EndFixedPriceItem.html
   */
  async endFixedPriceItem(
    itemId: string,
    reason: EndReasonCode = 'NotAvailable'
  ): Promise<EndItemResult> {
    const requestXml = this.buildEndItemRequest(itemId, reason);

    try {
      const response = await this.executeGenericRequest<EndItemResponse>(
        'EndFixedPriceItem',
        requestXml
      );

      const apiResponse = response.EndFixedPriceItemResponse;
      if (!apiResponse) {
        throw new EbayTradingApiError('Invalid API response: missing EndFixedPriceItemResponse');
      }

      // Check for errors but don't throw - return result instead
      if (apiResponse.Ack === 'Failure') {
        const errors = this.extractErrors(apiResponse.Errors);
        return {
          success: false,
          itemId,
          errorCode: errors[0]?.ErrorCode,
          errorMessage: errors.map((e) => e.LongMessage || e.ShortMessage).join('; '),
        };
      }

      return {
        success: true,
        itemId,
        endTime: apiResponse.EndTime,
      };
    } catch (error) {
      if (error instanceof EbayTradingApiError) {
        return {
          success: false,
          itemId,
          errorCode: error.errorCode,
          errorMessage: error.message,
        };
      }
      throw error;
    }
  }

  /**
   * Create a new fixed-price listing
   *
   * @see https://developer.ebay.com/Devzone/XML/docs/Reference/eBay/AddFixedPriceItem.html
   */
  async addFixedPriceItem(item: AddFixedPriceItemRequest): Promise<AddItemResult> {
    const requestXml = this.buildAddItemRequest(item);

    try {
      const response = await this.executeGenericRequest<AddItemResponse>(
        'AddFixedPriceItem',
        requestXml
      );

      const apiResponse = response.AddFixedPriceItemResponse;
      if (!apiResponse) {
        throw new EbayTradingApiError('Invalid API response: missing AddFixedPriceItemResponse');
      }

      // Extract warnings if any
      const warnings = this.extractWarnings(apiResponse.Errors);

      // Check for errors
      if (apiResponse.Ack === 'Failure') {
        const errors = this.extractErrors(apiResponse.Errors);
        return {
          success: false,
          errorCode: errors[0]?.ErrorCode,
          errorMessage: errors.map((e) => e.LongMessage || e.ShortMessage).join('; '),
          warnings: warnings.length > 0 ? warnings : undefined,
        };
      }

      // Parse fees
      const fees = this.parseFees(apiResponse.Fees?.Fee);

      return {
        success: true,
        itemId: apiResponse.ItemID,
        startTime: apiResponse.StartTime,
        endTime: apiResponse.EndTime,
        fees,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (error) {
      if (error instanceof EbayTradingApiError) {
        return {
          success: false,
          errorCode: error.errorCode,
          errorMessage: error.message,
        };
      }
      throw error;
    }
  }

  /**
   * Revise an existing fixed-price listing
   *
   * @see https://developer.ebay.com/Devzone/XML/docs/Reference/eBay/ReviseFixedPriceItem.html
   */
  async reviseFixedPriceItem(request: ReviseItemRequest): Promise<ReviseItemResult> {
    // Validate required itemId
    if (!request.itemId?.trim()) {
      return {
        success: false,
        itemId: request.itemId ?? '',
        errorMessage: 'itemId is required and cannot be empty',
      };
    }

    const requestXml = this.buildReviseItemRequest(request);
    console.log(`[EbayTradingClient] ===== ReviseFixedPriceItem for ${request.itemId} =====`);
    console.log(
      `[EbayTradingClient] Request details:`,
      JSON.stringify(
        {
          itemId: request.itemId,
          hasTitle: !!request.title,
          hasDescription: !!request.description,
          hasItemSpecifics: !!(request.itemSpecifics && request.itemSpecifics.length > 0),
          itemSpecificsCount: request.itemSpecifics?.length || 0,
          itemSpecifics: request.itemSpecifics?.map((s) => ({ name: s.name, value: s.value })),
        },
        null,
        2
      )
    );
    console.log(`[EbayTradingClient] Full Request XML:\n`, requestXml);

    try {
      const response = await this.executeGenericRequestWithRawResponse<ReviseItemResponse>(
        'ReviseFixedPriceItem',
        requestXml
      );

      const apiResponse = response.parsed.ReviseFixedPriceItemResponse;
      console.log(`[EbayTradingClient] Response Ack:`, apiResponse?.Ack);
      console.log(`[EbayTradingClient] Full Response XML:\n`, response.rawXml);

      if (!apiResponse) {
        throw new EbayTradingApiError('Invalid API response: missing ReviseFixedPriceItemResponse');
      }

      // Log all errors/warnings from the response
      if (apiResponse.Errors) {
        console.log(
          `[EbayTradingClient] Response Errors/Warnings:`,
          JSON.stringify(apiResponse.Errors, null, 2)
        );
      }

      // Extract warnings if any
      const warnings = this.extractWarnings(apiResponse.Errors);
      if (warnings.length > 0) {
        console.log(`[EbayTradingClient] Extracted warnings:`, warnings);
      }

      // Check for errors
      if (apiResponse.Ack === 'Failure') {
        const errors = this.extractErrors(apiResponse.Errors);
        console.error(`[EbayTradingClient] ReviseFixedPriceItem FAILED:`, errors);
        return {
          success: false,
          itemId: request.itemId,
          errorCode: errors[0]?.ErrorCode,
          errorMessage: errors.map((e) => e.LongMessage || e.ShortMessage).join('; '),
          warnings: warnings.length > 0 ? warnings : undefined,
        };
      }

      // Parse fees
      const fees = this.parseFees(apiResponse.Fees?.Fee);
      console.log(`[EbayTradingClient] ReviseFixedPriceItem SUCCESS for ${request.itemId}`);

      return {
        success: true,
        itemId: apiResponse.ItemID || request.itemId,
        startTime: apiResponse.StartTime,
        endTime: apiResponse.EndTime,
        fees,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (error) {
      console.error(`[EbayTradingClient] ReviseFixedPriceItem EXCEPTION:`, error);
      if (error instanceof EbayTradingApiError) {
        return {
          success: false,
          itemId: request.itemId,
          errorCode: error.errorCode,
          errorMessage: error.message,
        };
      }
      throw error;
    }
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
        // IMPORTANT: Must explicitly request watch count
        IncludeWatchCount: 'true',
        // Pagination
        Pagination: {
          EntriesPerPage: String(params.entriesPerPage ?? DEFAULT_ENTRIES_PER_PAGE),
          PageNumber: String(params.pageNumber ?? 1),
        },
      },
    };

    const xml = '<?xml version="1.0" encoding="utf-8"?>\n' + this.xmlBuilder.build(request);
    return xml;
  }

  /**
   * Execute a Trading API request with retries
   */
  private async executeRequest(
    callName: string,
    requestXml: string
  ): Promise<GetSellerListResponse> {
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

    // Debug: Check if WatchCount exists in raw items
    if (items.length > 0) {
      // Find the Dobby's Release item (known to have watchers)
      const dobbyItem = items.find((i) => i.ItemID === '177476194025');
      if (dobbyItem) {
        console.log(
          '[EbayTradingClient] Dobby item raw data:',
          JSON.stringify(
            {
              ItemID: dobbyItem.ItemID,
              WatchCount: dobbyItem.WatchCount,
              HitCount: dobbyItem.HitCount,
              PictureDetails: dobbyItem.PictureDetails,
              allKeys: Object.keys(dobbyItem),
            },
            null,
            2
          )
        );
      }
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

    // Debug: Log raw engagement data from eBay
    if (process.env.NODE_ENV === 'development') {
      console.log('[EbayTradingClient] Raw item data:', {
        itemId: item.ItemID,
        title: item.Title?.substring(0, 50),
        WatchCount: item.WatchCount,
        HitCount: item.HitCount,
        PictureDetails: item.PictureDetails,
      });
    }

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

  // ============================================================================
  // Request Builders
  // ============================================================================

  /**
   * Build XML request for GetItem
   */
  private buildGetItemRequest(itemId: string): string {
    const request = {
      GetItemRequest: {
        '@_xmlns': 'urn:ebay:apis:eBLBaseComponents',
        ItemID: itemId,
        DetailLevel: 'ReturnAll',
        IncludeItemSpecifics: 'true',
        IncludeWatchCount: 'true',
      },
    };

    return '<?xml version="1.0" encoding="utf-8"?>\n' + this.xmlBuilder.build(request);
  }

  /**
   * Build XML request for EndFixedPriceItem
   */
  private buildEndItemRequest(itemId: string, reason: EndReasonCode): string {
    const request = {
      EndFixedPriceItemRequest: {
        '@_xmlns': 'urn:ebay:apis:eBLBaseComponents',
        ItemID: itemId,
        EndingReason: reason,
      },
    };

    return '<?xml version="1.0" encoding="utf-8"?>\n' + this.xmlBuilder.build(request);
  }

  /**
   * Build XML request for AddFixedPriceItem
   */
  private buildAddItemRequest(item: AddFixedPriceItemRequest): string {
    const itemNode: Record<string, unknown> = {
      Title: item.title,
      Description: { '#text': item.description },
      PrimaryCategory: { CategoryID: item.categoryId },
      StartPrice: {
        '@_currencyID': item.currency || 'GBP',
        '#text': String(item.startPrice),
      },
      Quantity: String(item.quantity),
      ListingDuration: item.listingDuration || 'GTC',
      ListingType: 'FixedPriceItem',
      Country: item.country || 'GB',
      Currency: item.currency || 'GBP',
    };

    // Optional fields
    if (item.sku) {
      itemNode.SKU = item.sku;
    }

    if (item.conditionId) {
      itemNode.ConditionID = String(item.conditionId);
    }

    if (item.conditionDescription) {
      itemNode.ConditionDescription = item.conditionDescription;
    }

    if (item.storeCategoryId) {
      itemNode.Storefront = { StoreCategoryID: item.storeCategoryId };
    }

    if (item.location) {
      itemNode.Location = item.location;
    }

    if (item.postalCode) {
      itemNode.PostalCode = item.postalCode;
    }

    // Picture URLs
    if (item.pictureUrls && item.pictureUrls.length > 0) {
      itemNode.PictureDetails = {
        PictureURL: item.pictureUrls,
      };
    }

    // Best offer
    if (item.bestOfferEnabled) {
      itemNode.BestOfferDetails = {
        BestOfferEnabled: 'true',
      };
      if (item.bestOfferAutoAcceptPrice) {
        (itemNode.BestOfferDetails as Record<string, unknown>).BestOfferAutoAcceptPrice = {
          '@_currencyID': item.currency || 'GBP',
          '#text': String(item.bestOfferAutoAcceptPrice),
        };
      }
      if (item.minimumBestOfferPrice) {
        (itemNode.BestOfferDetails as Record<string, unknown>).MinimumBestOfferPrice = {
          '@_currencyID': item.currency || 'GBP',
          '#text': String(item.minimumBestOfferPrice),
        };
      }
    }

    // Business policies (preferred)
    if (item.shippingProfileId || item.returnProfileId || item.paymentProfileId) {
      itemNode.SellerProfiles = {};
      if (item.shippingProfileId) {
        (itemNode.SellerProfiles as Record<string, unknown>).SellerShippingProfile = {
          ShippingProfileID: item.shippingProfileId,
        };
      }
      if (item.returnProfileId) {
        (itemNode.SellerProfiles as Record<string, unknown>).SellerReturnProfile = {
          ReturnProfileID: item.returnProfileId,
        };
      }
      if (item.paymentProfileId) {
        (itemNode.SellerProfiles as Record<string, unknown>).SellerPaymentProfile = {
          PaymentProfileID: item.paymentProfileId,
        };
      }
    } else {
      // Fallback: Shipping details
      if (item.shippingServiceOptions && item.shippingServiceOptions.length > 0) {
        itemNode.ShippingDetails = {
          ShippingType: 'Flat',
          ShippingServiceOptions: item.shippingServiceOptions.map((opt) => ({
            ShippingService: opt.shippingService,
            ShippingServiceCost: {
              '@_currencyID': item.currency || 'GBP',
              '#text': String(opt.shippingServiceCost),
            },
            ShippingServicePriority: String(opt.shippingServicePriority),
            FreeShipping: opt.freeShipping ? 'true' : 'false',
          })),
        };
      }

      // Fallback: Return policy
      if (item.returnsAccepted !== undefined) {
        itemNode.ReturnPolicy = {
          ReturnsAcceptedOption: item.returnsAccepted ? 'ReturnsAccepted' : 'ReturnsNotAccepted',
        };
        if (item.returnsWithin) {
          (itemNode.ReturnPolicy as Record<string, unknown>).ReturnsWithinOption =
            item.returnsWithin;
        }
        if (item.refundOption) {
          (itemNode.ReturnPolicy as Record<string, unknown>).RefundOption = item.refundOption;
        }
        if (item.shippingCostPaidBy) {
          (itemNode.ReturnPolicy as Record<string, unknown>).ShippingCostPaidByOption =
            item.shippingCostPaidBy;
        }
      }
    }

    // Dispatch time
    if (item.dispatchTimeMax) {
      itemNode.DispatchTimeMax = String(item.dispatchTimeMax);
    }

    // Item specifics
    if (item.itemSpecifics && item.itemSpecifics.length > 0) {
      itemNode.ItemSpecifics = {
        NameValueList: item.itemSpecifics.map((spec) => ({
          Name: spec.name,
          Value: spec.value,
        })),
      };
    }

    const request = {
      AddFixedPriceItemRequest: {
        '@_xmlns': 'urn:ebay:apis:eBLBaseComponents',
        Item: itemNode,
      },
    };

    return '<?xml version="1.0" encoding="utf-8"?>\n' + this.xmlBuilder.build(request);
  }

  /**
   * Build XML request for ReviseFixedPriceItem
   */
  private buildReviseItemRequest(request: ReviseItemRequest): string {
    const itemNode: Record<string, unknown> = {
      ItemID: request.itemId,
    };

    // Only include fields that are being updated
    if (request.title !== undefined) {
      itemNode.Title = request.title;
    }

    if (request.description !== undefined) {
      itemNode.Description = { '#text': request.description };
    }

    if (request.startPrice !== undefined) {
      itemNode.StartPrice = {
        '@_currencyID': 'GBP',
        '#text': String(request.startPrice),
      };
    }

    if (request.quantity !== undefined) {
      itemNode.Quantity = String(request.quantity);
    }

    if (request.conditionId !== undefined) {
      itemNode.ConditionID = String(request.conditionId);
    }

    if (request.conditionDescription !== undefined) {
      itemNode.ConditionDescription = request.conditionDescription;
    }

    if (request.pictureUrls !== undefined && request.pictureUrls.length > 0) {
      itemNode.PictureDetails = {
        PictureURL: request.pictureUrls,
      };
    }

    if (request.itemSpecifics !== undefined && request.itemSpecifics.length > 0) {
      console.log(
        `[EbayTradingClient] Building ItemSpecifics with ${request.itemSpecifics.length} items:`,
        request.itemSpecifics.map((s) => `${s.name}=${s.value}`).join(', ')
      );
      itemNode.ItemSpecifics = {
        NameValueList: request.itemSpecifics.map((spec) => ({
          Name: spec.name,
          Value: spec.value,
        })),
      };
    }

    // Best Offer fields
    if (request.bestOfferEnabled !== undefined) {
      const currency = request.currency || 'GBP';
      const bestOfferDetails: Record<string, unknown> = {
        BestOfferEnabled: request.bestOfferEnabled ? 'true' : 'false',
      };

      // Only include prices when enabling Best Offer
      if (request.bestOfferEnabled) {
        if (request.bestOfferAutoAcceptPrice !== undefined) {
          bestOfferDetails.BestOfferAutoAcceptPrice = {
            '@_currencyID': currency,
            '#text': String(request.bestOfferAutoAcceptPrice),
          };
        }
        if (request.minimumBestOfferPrice !== undefined) {
          bestOfferDetails.MinimumBestOfferPrice = {
            '@_currencyID': currency,
            '#text': String(request.minimumBestOfferPrice),
          };
        }
      }

      itemNode.BestOfferDetails = bestOfferDetails;
    } else if (
      request.bestOfferAutoAcceptPrice !== undefined ||
      request.minimumBestOfferPrice !== undefined
    ) {
      // Update just the prices without changing BestOfferEnabled status
      const currency = request.currency || 'GBP';
      const bestOfferDetails: Record<string, unknown> = {};

      if (request.bestOfferAutoAcceptPrice !== undefined) {
        bestOfferDetails.BestOfferAutoAcceptPrice = {
          '@_currencyID': currency,
          '#text': String(request.bestOfferAutoAcceptPrice),
        };
      }
      if (request.minimumBestOfferPrice !== undefined) {
        bestOfferDetails.MinimumBestOfferPrice = {
          '@_currencyID': currency,
          '#text': String(request.minimumBestOfferPrice),
        };
      }

      itemNode.BestOfferDetails = bestOfferDetails;
    }

    const xmlRequest = {
      ReviseFixedPriceItemRequest: {
        '@_xmlns': 'urn:ebay:apis:eBLBaseComponents',
        Item: itemNode,
      },
    };

    return '<?xml version="1.0" encoding="utf-8"?>\n' + this.xmlBuilder.build(xmlRequest);
  }

  // ============================================================================
  // Generic Request Execution
  // ============================================================================

  /**
   * Execute a Trading API request with retries (generic version)
   */
  private async executeGenericRequest<T>(callName: string, requestXml: string): Promise<T> {
    const result = await this.executeGenericRequestWithRawResponse<T>(callName, requestXml);
    return result.parsed;
  }

  /**
   * Execute a Trading API request with retries, returning both parsed and raw response
   */
  private async executeGenericRequestWithRawResponse<T>(
    callName: string,
    requestXml: string
  ): Promise<{ parsed: T; rawXml: string }> {
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
        return {
          parsed: this.xmlParser.parse(responseText) as T,
          rawXml: responseText,
        };
      } catch (error) {
        lastError = error as Error;

        // Don't retry on auth errors
        if (error instanceof EbayTradingApiError) {
          if (error.errorCode === '931' || error.errorCode === '932') {
            throw error;
          }
        }

        if (attempt < MAX_RETRIES - 1) {
          const delayMs = RETRY_DELAY_MS * Math.pow(2, attempt);
          console.warn(`[EbayTradingClient] ${callName} failed, retrying in ${delayMs}ms:`, error);
          await this.delay(delayMs);
        }
      }
    }

    throw lastError || new EbayTradingApiError('Request failed after maximum retries');
  }

  // ============================================================================
  // Response Parsers
  // ============================================================================

  /**
   * Parse full item from GetItem response
   */
  private parseFullItem(item: TradingApiFullItem): FullItemDetails {
    const sellingStatus = item.SellingStatus || {};
    const listingDetails = item.ListingDetails || {};
    const currentPrice = sellingStatus.CurrentPrice || {};
    const bestOfferDetails = item.BestOfferDetails || {};
    const shippingDetails = item.ShippingDetails || {};
    const returnPolicy = item.ReturnPolicy || {};
    const sellerProfiles = item.SellerProfiles || {};
    const pictureDetails = item.PictureDetails || {};

    // Extract price
    const priceValue = this.extractTextValue(currentPrice) ?? 0;
    const currency = currentPrice['@_currencyID'] || currentPrice._currencyID || 'GBP';

    // Extract picture URLs
    const pictureUrls: string[] = [];
    if (pictureDetails.PictureURL) {
      if (Array.isArray(pictureDetails.PictureURL)) {
        pictureUrls.push(...pictureDetails.PictureURL);
      } else {
        pictureUrls.push(pictureDetails.PictureURL);
      }
    }

    // Extract shipping options
    const shippingOptions = this.parseShippingOptions(shippingDetails.ShippingServiceOptions);

    // Extract item specifics
    const itemSpecifics = this.parseItemSpecifics(item.ItemSpecifics?.NameValueList);

    return {
      itemId: item.ItemID,
      title: item.Title,
      description: item.Description || '',
      sku: item.SKU || null,
      quantity: parseInt(String(item.QuantityAvailable ?? item.Quantity ?? 0), 10),
      startPrice: priceValue,
      currency,
      conditionId: item.ConditionID ? parseInt(String(item.ConditionID), 10) : null,
      // ConditionDescription is the seller's custom condition notes (e.g., "Minor shelf wear on box")
      // ConditionDisplayName is the eBay condition name (e.g., "New", "Used")
      conditionDescription: item.ConditionDescription || null,
      categoryId: item.PrimaryCategory?.CategoryID || '',
      categoryName: item.PrimaryCategory?.CategoryName || null,
      storeCategoryId: item.Storefront?.StoreCategoryID || null,
      storeCategoryName: item.Storefront?.StoreCategoryName || null,
      listingType: item.ListingType || 'FixedPriceItem',
      listingDuration: item.ListingDuration || null,
      pictureUrls,
      galleryUrl: pictureDetails.GalleryURL || null,
      viewItemUrl: listingDetails.ViewItemURL || null,

      // Best offer
      bestOfferEnabled: item.BestOfferEnabled === 'true' || item.BestOfferEnabled === true,
      bestOfferAutoAcceptPrice: this.extractTextValue(bestOfferDetails.BestOfferAutoAcceptPrice),
      minimumBestOfferPrice: this.extractTextValue(bestOfferDetails.MinimumBestOfferPrice),

      // Business policies
      shippingProfileId: sellerProfiles.SellerShippingProfile?.ShippingProfileID || null,
      returnProfileId: sellerProfiles.SellerReturnProfile?.ReturnProfileID || null,
      paymentProfileId: sellerProfiles.SellerPaymentProfile?.PaymentProfileID || null,

      // Shipping details
      shippingServiceOptions: shippingOptions,
      dispatchTimeMax: item.DispatchTimeMax ? parseInt(String(item.DispatchTimeMax), 10) : null,

      // Return policy
      returnsAccepted: returnPolicy.ReturnsAcceptedOption === 'ReturnsAccepted',
      returnsWithin: returnPolicy.ReturnsWithinOption || null,
      refundOption: returnPolicy.RefundOption || null,
      shippingCostPaidBy: returnPolicy.ShippingCostPaidByOption || null,

      // Item specifics
      itemSpecifics,

      // Location
      location: item.Location || null,
      country: item.Country || null,
      postalCode: item.PostalCode || null,

      // Dates
      listingStartDate: listingDetails.StartTime || '',
      listingEndDate: listingDetails.EndTime || null,

      // Engagement
      watchers: parseInt(String(item.WatchCount ?? 0), 10),
      hitCount: item.HitCount ? parseInt(String(item.HitCount), 10) : null,
      quantitySold: parseInt(String(sellingStatus.QuantitySold ?? 0), 10),
      quantityAvailable: parseInt(String(item.QuantityAvailable ?? item.Quantity ?? 0), 10),
    };
  }

  /**
   * Parse shipping service options from Trading API response
   */
  private parseShippingOptions(
    options: TradingApiShippingOption | TradingApiShippingOption[] | undefined
  ): ShippingServiceOption[] {
    if (!options) return [];

    const optionsArray = Array.isArray(options) ? options : [options];

    return optionsArray.map((opt) => ({
      shippingService: opt.ShippingService || '',
      shippingServiceCost: this.extractTextValue(opt.ShippingServiceCost) ?? 0,
      shippingServiceAdditionalCost:
        this.extractTextValue(opt.ShippingServiceAdditionalCost) ?? undefined,
      shippingServicePriority: parseInt(String(opt.ShippingServicePriority ?? 1), 10),
      freeShipping: opt.FreeShipping === 'true' || opt.FreeShipping === true,
    }));
  }

  /**
   * Parse item specifics from Trading API response
   */
  private parseItemSpecifics(
    specifics: TradingApiNameValue | TradingApiNameValue[] | undefined
  ): Array<{ name: string; value: string }> {
    if (!specifics) return [];

    const specificsArray = Array.isArray(specifics) ? specifics : [specifics];

    return specificsArray.flatMap((spec) => {
      const values = Array.isArray(spec.Value) ? spec.Value : [spec.Value];
      return values.map((value) => ({
        name: spec.Name,
        value: String(value),
      }));
    });
  }

  /**
   * Parse fees from Trading API response
   */
  private parseFees(fees: TradingApiFee | TradingApiFee[] | undefined): Array<{
    name: string;
    fee: number;
    currency: string;
  }> {
    if (!fees) return [];

    const feesArray = Array.isArray(fees) ? fees : [fees];

    return feesArray.map((fee) => ({
      name: fee.Name,
      fee: this.extractTextValue(fee.Fee) ?? 0,
      currency: fee.Fee?.['@_currencyID'] || fee.Fee?._currencyID || 'GBP',
    }));
  }

  // ============================================================================
  // Error Handling Helpers
  // ============================================================================

  /**
   * Check API response for errors and throw if found
   */
  private checkApiErrors(response: { Ack: string; Errors?: unknown }): void {
    if (response.Ack === 'Failure') {
      const errors = this.extractErrors(response.Errors);
      const errorMessages = errors.map((e) => e.LongMessage || e.ShortMessage).join('; ');
      const errorCode = errors[0]?.ErrorCode;
      throw new EbayTradingApiError(errorMessages || 'Unknown API error', errorCode);
    }
  }

  /**
   * Extract error objects from API response
   */
  private extractErrors(
    errors: unknown
  ): Array<{ ErrorCode?: string; ShortMessage?: string; LongMessage?: string }> {
    if (!errors) return [];
    const errorsArray = Array.isArray(errors) ? errors : [errors];
    return errorsArray.filter(
      (e) => (e as { SeverityCode?: string }).SeverityCode === 'Error'
    ) as Array<{ ErrorCode?: string; ShortMessage?: string; LongMessage?: string }>;
  }

  /**
   * Extract warning messages from API response
   */
  private extractWarnings(errors: unknown): string[] {
    if (!errors) return [];
    const errorsArray = Array.isArray(errors) ? errors : [errors];
    return errorsArray
      .filter((e) => (e as { SeverityCode?: string }).SeverityCode === 'Warning')
      .map(
        (e) =>
          (e as { LongMessage?: string; ShortMessage?: string }).LongMessage ||
          (e as { ShortMessage?: string }).ShortMessage ||
          ''
      )
      .filter(Boolean);
  }
}
