/**
 * eBay Finding API Client
 *
 * Client for accessing eBay's Finding API to retrieve completed/sold listings.
 * This is separate from the Browse API and provides historical sales data.
 *
 * API Documentation: https://developer.ebay.com/devzone/finding/Concepts/MakingACall.html
 */

const EBAY_FINDING_API_URL = 'https://svcs.ebay.com/services/search/FindingService/v1';

/**
 * Sold item from Finding API response
 */
export interface EbaySoldItem {
  itemId: string;
  title: string;
  sellingStatus: {
    currentPrice: {
      value: number;
      currencyId: string;
    };
    sellingState: string;
  };
  listingInfo: {
    endTime: string;
    listingType: string;
  };
  condition?: {
    conditionId: string;
    conditionDisplayName: string;
  };
  viewItemURL: string;
  shippingInfo?: {
    shippingServiceCost?: {
      value: number;
      currencyId: string;
    };
  };
}

/**
 * Finding API response structure
 */
interface FindingApiResponse {
  findCompletedItemsResponse?: Array<{
    ack: string[];
    errorMessage?: Array<{
      error: Array<{
        errorId: string[];
        domain: string[];
        severity: string[];
        category: string[];
        message: string[];
      }>;
    }>;
    searchResult: Array<{
      '@count': string;
      item?: EbaySoldItem[];
    }>;
    paginationOutput?: Array<{
      totalEntries: string[];
      totalPages: string[];
    }>;
  }>;
  // Rate limit errors return this structure instead
  errorMessage?: Array<{
    error: Array<{
      errorId: string[];
      domain: string[];
      subdomain?: string[];
      severity: string[];
      category: string[];
      message: string[];
    }>;
  }>;
}

/**
 * Sold listings statistics result
 */
export interface SoldListingsResult {
  minPrice: number | null;
  avgPrice: number | null;
  maxPrice: number | null;
  soldCount: number;
  listings: Array<{
    itemId: string;
    title: string;
    soldPrice: number;
    currency: string;
    soldDate: string;
    condition: string;
    url: string;
  }>;
  /** True if the request was rate limited by eBay */
  rateLimited?: boolean;
}

/**
 * eBay Finding API client for completed/sold listings
 */
export class EbayFindingClient {
  private appId: string;

  constructor() {
    const appId = process.env.EBAY_CLIENT_ID;

    if (!appId) {
      throw new Error('Missing EBAY_CLIENT_ID environment variable');
    }

    this.appId = appId;
  }

  /**
   * Find completed/sold items for a LEGO set
   *
   * @param setNumber - LEGO set number (e.g., "75192")
   * @param condition - 'New' or 'Used' (optional, defaults to New)
   * @param limit - Maximum items to return (default 50)
   * @returns Sold listings statistics and sample listings
   */
  async findCompletedItems(
    setNumber: string,
    condition: 'New' | 'Used' = 'New',
    limit: number = 50
  ): Promise<SoldListingsResult> {
    // Strip -1 suffix if present (e.g., 40585-1 -> 40585)
    const cleanSetNumber = setNumber.replace(/-\d+$/, '');
    const keywords = `LEGO ${cleanSetNumber}`;

    // Build the Finding API request URL
    const url = new URL(EBAY_FINDING_API_URL);
    url.searchParams.set('OPERATION-NAME', 'findCompletedItems');
    url.searchParams.set('SERVICE-VERSION', '1.13.0');
    url.searchParams.set('SECURITY-APPNAME', this.appId);
    url.searchParams.set('RESPONSE-DATA-FORMAT', 'JSON');
    url.searchParams.set('REST-PAYLOAD', '');
    url.searchParams.set('keywords', keywords);
    url.searchParams.set('paginationInput.entriesPerPage', String(Math.min(limit, 100)));

    // Filter by category (19006 = LEGO Complete Sets & Packs)
    url.searchParams.set('categoryId', '19006');

    // Filter by condition
    // eBay condition IDs: 1000 = New, 3000 = Used
    const conditionId = condition === 'New' ? '1000' : '3000';
    url.searchParams.set('itemFilter(0).name', 'Condition');
    url.searchParams.set('itemFilter(0).value', conditionId);

    // Filter by sold items only (not unsold)
    url.searchParams.set('itemFilter(1).name', 'SoldItemsOnly');
    url.searchParams.set('itemFilter(1).value', 'true');

    // Filter by location (UK)
    url.searchParams.set('itemFilter(2).name', 'LocatedIn');
    url.searchParams.set('itemFilter(2).value', 'GB');

    // Sort by end time (most recent first)
    url.searchParams.set('sortOrder', 'EndTimeSoonest');

    console.log(`[EbayFindingClient] Searching completed items for: ${keywords}, condition: ${condition}`);

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });

      // Handle HTTP errors
      if (!response.ok) {
        const errorText = await response.text();

        // Check if it's a rate limit error in the response body
        if (errorText.includes('RateLimiter') || errorText.includes('exceeded the number of times')) {
          console.warn(`[EbayFindingClient] Rate limit exceeded for ${keywords}`);
          // Return empty result instead of throwing - allows other items to still process
          return {
            minPrice: null,
            avgPrice: null,
            maxPrice: null,
            soldCount: 0,
            listings: [],
            rateLimited: true,
          } as SoldListingsResult;
        }

        throw new Error(`eBay Finding API failed: ${response.status} - ${errorText}`);
      }

      const data: FindingApiResponse = await response.json();

      // Also check for rate limit in successful response body (eBay sometimes returns 200 with error)
      if (data.errorMessage) {
        const errorMsg = data.errorMessage?.[0]?.error?.[0]?.message?.[0] || '';
        if (errorMsg.includes('exceeded the number of times')) {
          console.warn(`[EbayFindingClient] Rate limit exceeded for ${keywords}`);
          return {
            minPrice: null,
            avgPrice: null,
            maxPrice: null,
            soldCount: 0,
            listings: [],
            rateLimited: true,
          } as SoldListingsResult;
        }
      }

      const responseData = data.findCompletedItemsResponse?.[0];

      if (!responseData) {
        throw new Error('Invalid response from eBay Finding API');
      }

      // Check for API errors
      if (responseData.ack?.[0] !== 'Success') {
        const errorMsg = responseData.errorMessage?.[0]?.error?.[0]?.message?.[0] || 'Unknown error';
        throw new Error(`eBay Finding API error: ${errorMsg}`);
      }

      const searchResult = responseData.searchResult?.[0];
      const items = searchResult?.item || [];

      console.log(`[EbayFindingClient] Found ${items.length} sold items`);

      // Transform items to our format
      const listings = items.map((item) => ({
        itemId: item.itemId,
        title: item.title,
        soldPrice: item.sellingStatus.currentPrice.value,
        currency: item.sellingStatus.currentPrice.currencyId,
        soldDate: item.listingInfo.endTime,
        condition: item.condition?.conditionDisplayName || condition,
        url: item.viewItemURL,
      }));

      // Calculate statistics
      if (listings.length === 0) {
        return {
          minPrice: null,
          avgPrice: null,
          maxPrice: null,
          soldCount: 0,
          listings: [],
        };
      }

      const prices = listings.map((l) => l.soldPrice);
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      const avgPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;

      return {
        minPrice,
        avgPrice: Math.round(avgPrice * 100) / 100,
        maxPrice,
        soldCount: listings.length,
        listings,
      };
    } catch (error) {
      console.error('[EbayFindingClient] Error:', error);
      throw error;
    }
  }

  /**
   * Find completed items for a LEGO set in New condition
   */
  async findCompletedNewItems(setNumber: string, limit: number = 50): Promise<SoldListingsResult> {
    return this.findCompletedItems(setNumber, 'New', limit);
  }

  /**
   * Find completed items for a LEGO set in Used condition
   */
  async findCompletedUsedItems(setNumber: string, limit: number = 50): Promise<SoldListingsResult> {
    return this.findCompletedItems(setNumber, 'Used', limit);
  }
}

// Singleton instance
let clientInstance: EbayFindingClient | null = null;

/**
 * Get the singleton eBay Finding client instance
 */
export function getEbayFindingClient(): EbayFindingClient {
  if (!clientInstance) {
    clientInstance = new EbayFindingClient();
  }
  return clientInstance;
}

/**
 * Clear the client instance (useful for testing)
 */
export function clearFindingClientInstance(): void {
  clientInstance = null;
}
