/**
 * BrickLink API Client
 *
 * Implements OAuth 1.0a authentication for BrickLink API v3.
 * @see https://www.bricklink.com/v3/api.page
 */

import { createHmac, randomBytes } from 'crypto';
import type {
  BrickLinkCredentials,
  BrickLinkResponse,
  BrickLinkOrderSummary,
  BrickLinkOrderDetail,
  BrickLinkOrderItem,
  BrickLinkOrderListParams,
  BrickLinkPriceGuide,
  BrickLinkPriceGuideParams,
  BrickLinkCatalogItem,
  BrickLinkItemType,
  BrickLinkSubsetEntry,
  BrickLinkSubsetOptions,
  BrickLinkColor,
  RateLimitInfo,
} from './types';

const BASE_URL = 'https://api.bricklink.com/api/store/v1';

/** Default rate limit (BrickLink allows 5000 requests/day) */
const DAILY_LIMIT = 5000;

/** Request timeout in milliseconds (90s to allow for slow API responses) */
const REQUEST_TIMEOUT = 90000;

/**
 * Error class for BrickLink API errors
 */
export class BrickLinkApiError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly description?: string
  ) {
    super(message);
    this.name = 'BrickLinkApiError';
  }
}

/**
 * Error class for rate limit exceeded
 */
export class RateLimitError extends BrickLinkApiError {
  constructor(
    message: string,
    public readonly rateLimitInfo: RateLimitInfo
  ) {
    super(message, 429);
    this.name = 'RateLimitError';
  }
}

/**
 * BrickLink API client with OAuth 1.0a authentication
 */
export class BrickLinkClient {
  private credentials: BrickLinkCredentials;
  private rateLimitInfo: RateLimitInfo | null = null;

  constructor(credentials: BrickLinkCredentials) {
    this.credentials = credentials;
  }

  /**
   * Get current rate limit information
   */
  getRateLimitInfo(): RateLimitInfo | null {
    return this.rateLimitInfo;
  }

  /**
   * Generate OAuth 1.0a signature
   */
  private generateOAuthSignature(
    method: string,
    url: string,
    params: Record<string, string>
  ): string {
    // Sort and encode parameters
    const sortedParams = Object.keys(params)
      .sort()
      .map((key) => `${this.percentEncode(key)}=${this.percentEncode(params[key])}`)
      .join('&');

    // Create signature base string
    const signatureBase = [
      method.toUpperCase(),
      this.percentEncode(url),
      this.percentEncode(sortedParams),
    ].join('&');

    // Create signing key
    const signingKey = `${this.percentEncode(this.credentials.consumerSecret)}&${this.percentEncode(this.credentials.tokenSecret)}`;

    // Generate HMAC-SHA1 signature
    const hmac = createHmac('sha1', signingKey);
    hmac.update(signatureBase);
    return hmac.digest('base64');
  }

  /**
   * RFC 3986 percent encoding
   */
  private percentEncode(str: string): string {
    return encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  }

  /**
   * Generate OAuth 1.0a authorization header
   */
  private generateAuthHeader(
    method: string,
    url: string,
    queryParams?: Record<string, string>
  ): string {
    const nonce = randomBytes(16).toString('hex');
    const timestamp = Math.floor(Date.now() / 1000).toString();

    const oauthParams: Record<string, string> = {
      oauth_consumer_key: this.credentials.consumerKey,
      oauth_token: this.credentials.tokenValue,
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: timestamp,
      oauth_nonce: nonce,
      oauth_version: '1.0',
    };

    // Combine OAuth params with query params for signature
    const allParams: Record<string, string> = { ...oauthParams };
    if (queryParams) {
      Object.entries(queryParams).forEach(([key, value]) => {
        allParams[key] = value;
      });
    }

    // Generate signature with all params (OAuth + query)
    const signature = this.generateOAuthSignature(method, url, allParams);
    oauthParams.oauth_signature = signature;

    // Build authorization header (only OAuth params, not query params)
    const headerParams = Object.keys(oauthParams)
      .sort()
      .map((key) => `${this.percentEncode(key)}="${this.percentEncode(oauthParams[key])}"`)
      .join(', ');

    return `OAuth ${headerParams}`;
  }

  /**
   * Make an authenticated request to the BrickLink API
   */
  private async request<T>(
    method: string,
    endpoint: string,
    queryParams?: Record<string, string | string[] | boolean | undefined>
  ): Promise<T> {
    // Build URL with query parameters and collect string params for OAuth
    const url = new URL(`${BASE_URL}${endpoint}`);
    const stringParams: Record<string, string> = {};

    if (queryParams) {
      Object.entries(queryParams).forEach(([key, value]) => {
        if (value === undefined) return;
        if (Array.isArray(value)) {
          // For arrays, join with comma (BrickLink style)
          const joined = value.join(',');
          url.searchParams.set(key, joined);
          stringParams[key] = joined;
        } else {
          const strValue = String(value);
          url.searchParams.set(key, strValue);
          stringParams[key] = strValue;
        }
      });
    }

    // Generate OAuth header for the base URL with query params included in signature
    const baseUrl = `${BASE_URL}${endpoint}`;
    const authHeader = this.generateAuthHeader(method, baseUrl, stringParams);

    console.log('[BrickLinkClient.request] Full URL:', url.toString());

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      const response = await fetch(url.toString(), {
        method,
        headers: {
          Authorization: authHeader,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Update rate limit info from headers if available
      this.updateRateLimitInfo(response.headers);

      // Handle rate limiting
      if (response.status === 429) {
        throw new RateLimitError(
          'BrickLink API rate limit exceeded',
          this.rateLimitInfo || {
            remaining: 0,
            resetTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
            dailyLimit: DAILY_LIMIT,
            dailyRemaining: 0,
          }
        );
      }

      const data = (await response.json()) as BrickLinkResponse<T>;

      // Check for API errors
      if (data.meta.code !== 200) {
        throw new BrickLinkApiError(data.meta.message, data.meta.code, data.meta.description);
      }

      return data.data;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof BrickLinkApiError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new BrickLinkApiError('Request timeout', 408);
      }

      throw new BrickLinkApiError(
        error instanceof Error ? error.message : 'Unknown error',
        500
      );
    }
  }

  /**
   * Update rate limit info from response headers
   */
  private updateRateLimitInfo(headers: Headers): void {
    // BrickLink may provide rate limit headers
    // This is a placeholder - actual headers may vary
    const remaining = headers.get('X-RateLimit-Remaining');
    const reset = headers.get('X-RateLimit-Reset');

    if (remaining !== null) {
      this.rateLimitInfo = {
        remaining: parseInt(remaining, 10),
        resetTime: reset ? new Date(parseInt(reset, 10) * 1000) : new Date(),
        dailyLimit: DAILY_LIMIT,
        dailyRemaining: parseInt(remaining, 10),
      };
    }
  }

  /**
   * Test the connection with the provided credentials
   */
  async testConnection(): Promise<boolean> {
    try {
      // Try to fetch orders to verify credentials work
      // Use direction=in for sales orders (orders received from buyers)
      await this.getOrders({ direction: 'in' });
      return true;
    } catch (error) {
      console.error('[BrickLink testConnection] Error:', error);
      // Return false for auth errors, rethrow others
      if (error instanceof BrickLinkApiError) {
        if (error.code === 401 || error.code === 403) {
          return false;
        }
      }
      throw error;
    }
  }

  /**
   * Get list of orders
   * @param params Query parameters for filtering orders
   */
  async getOrders(params?: BrickLinkOrderListParams): Promise<BrickLinkOrderSummary[]> {
    const queryParams: Record<string, string | string[] | boolean | undefined> = {};

    if (params?.direction) {
      queryParams.direction = params.direction;
    }

    if (params?.status) {
      queryParams.status = Array.isArray(params.status)
        ? params.status.join(',')
        : params.status;
    }

    if (params?.filed !== undefined) {
      queryParams.filed = params.filed;
    }

    console.log('[BrickLinkClient.getOrders] Query params:', JSON.stringify(queryParams));
    const result = await this.request<BrickLinkOrderSummary[]>('GET', '/orders', queryParams);
    console.log('[BrickLinkClient.getOrders] First order seller_name:', result[0]?.seller_name, 'buyer_name:', result[0]?.buyer_name);
    return result;
  }

  /**
   * Get a single order by ID
   * @param orderId The BrickLink order ID
   */
  async getOrder(orderId: number | string): Promise<BrickLinkOrderDetail> {
    return this.request<BrickLinkOrderDetail>('GET', `/orders/${orderId}`);
  }

  /**
   * Get items for an order
   * @param orderId The BrickLink order ID
   */
  async getOrderItems(orderId: number | string): Promise<BrickLinkOrderItem[][]> {
    return this.request<BrickLinkOrderItem[][]>('GET', `/orders/${orderId}/items`);
  }

  /**
   * Get all sales orders (orders received from buyers - direction=in)
   * This is a convenience method for getting orders you've sold
   * Note: BrickLink API uses 'in' for orders received (sales), 'out' for orders placed (purchases)
   */
  async getSalesOrders(
    status?: BrickLinkOrderListParams['status'],
    includeFiled = false
  ): Promise<BrickLinkOrderSummary[]> {
    return this.getOrders({
      direction: 'in',
      status,
      filed: includeFiled,
    });
  }

  /**
   * Get all purchase orders (orders placed to sellers - direction=out)
   * This is a convenience method for getting orders you've bought
   * Note: BrickLink API uses 'in' for orders received (sales), 'out' for orders placed (purchases)
   */
  async getPurchaseOrders(
    status?: BrickLinkOrderListParams['status'],
    includeFiled = false
  ): Promise<BrickLinkOrderSummary[]> {
    return this.getOrders({
      direction: 'out',
      status,
      filed: includeFiled,
    });
  }

  /**
   * Get full order details including items
   * @param orderId The BrickLink order ID
   */
  async getOrderWithItems(
    orderId: number | string
  ): Promise<{ order: BrickLinkOrderDetail; items: BrickLinkOrderItem[] }> {
    const [order, itemBatches] = await Promise.all([
      this.getOrder(orderId),
      this.getOrderItems(orderId),
    ]);

    // Flatten the item batches
    const items = itemBatches.flat();

    return { order, items };
  }

  // ============================================
  // Price Guide Methods
  // ============================================

  /**
   * Get price guide for an item
   * @param params Price guide query parameters
   * @returns Price guide data including min/max/avg prices and detailed listings
   */
  async getPriceGuide(params: BrickLinkPriceGuideParams): Promise<BrickLinkPriceGuide> {
    const queryParams: Record<string, string | undefined> = {};

    if (params.newOrUsed) {
      queryParams.new_or_used = params.newOrUsed;
    }

    if (params.countryCode) {
      queryParams.country_code = params.countryCode;
    }

    if (params.guideType) {
      queryParams.guide_type = params.guideType;
    }

    if (params.currencyCode) {
      queryParams.currency_code = params.currencyCode;
    }

    if (params.vat) {
      queryParams.vat = params.vat;
    }

    // Endpoint: /items/{type}/{no}/price
    const endpoint = `/items/${params.type}/${encodeURIComponent(params.no)}/price`;

    console.log('[BrickLinkClient.getPriceGuide] Fetching price guide for:', params.type, params.no);
    return this.request<BrickLinkPriceGuide>('GET', endpoint, queryParams);
  }

  /**
   * Get price guide for a SET with common defaults
   * @param setNumber Set number (e.g., "40585-1")
   * @param options Additional options
   * @returns Price guide for the set
   */
  async getSetPriceGuide(
    setNumber: string,
    options: {
      condition?: 'N' | 'U';
      countryCode?: string;
      currencyCode?: string;
    } = {}
  ): Promise<BrickLinkPriceGuide> {
    return this.getPriceGuide({
      type: 'SET',
      no: setNumber,
      newOrUsed: options.condition ?? 'N',
      countryCode: options.countryCode,
      currencyCode: options.currencyCode ?? 'GBP',
      guideType: 'stock',
    });
  }

  // ============================================
  // Catalog Methods
  // ============================================

  /**
   * Get catalog item information
   * @param type Item type
   * @param no Item number
   * @returns Catalog item details
   */
  async getCatalogItem(type: BrickLinkItemType, no: string): Promise<BrickLinkCatalogItem> {
    const endpoint = `/items/${type}/${encodeURIComponent(no)}`;
    return this.request<BrickLinkCatalogItem>('GET', endpoint);
  }

  /**
   * Check if a set exists in the BrickLink catalog
   * @param setNumber Set number (e.g., "40585-1")
   * @returns True if set exists, false otherwise
   */
  async setExists(setNumber: string): Promise<boolean> {
    try {
      await this.getCatalogItem('SET', setNumber);
      return true;
    } catch (error) {
      if (error instanceof BrickLinkApiError && error.code === 404) {
        return false;
      }
      throw error;
    }
  }

  // ============================================
  // Subset Methods (for Partout Value)
  // ============================================

  /**
   * Get subsets (parts) for an item
   * @param type Item type (typically SET)
   * @param no Item number (e.g., "75192-1")
   * @param options Subset options
   * @returns List of subset entries containing parts
   */
  async getSubsets(
    type: BrickLinkItemType,
    no: string,
    options: BrickLinkSubsetOptions = {}
  ): Promise<BrickLinkSubsetEntry[]> {
    const queryParams: Record<string, string | undefined> = {};

    if (options.breakMinifigs !== undefined) {
      queryParams.break_minifigs = options.breakMinifigs ? 'true' : 'false';
    }

    if (options.breakSets !== undefined) {
      queryParams.break_sets = options.breakSets ? 'true' : 'false';
    }

    const endpoint = `/items/${type}/${encodeURIComponent(no)}/subsets`;
    console.log('[BrickLinkClient.getSubsets] Fetching subsets for:', type, no);
    return this.request<BrickLinkSubsetEntry[]>('GET', endpoint, queryParams);
  }

  /**
   * Get price guide for a part with specific color
   * @param type Item type (PART, MINIFIG, etc.)
   * @param no Item number
   * @param colorId Color ID
   * @param options Additional options
   * @returns Price guide for the part
   */
  async getPartPriceGuide(
    type: BrickLinkItemType,
    no: string,
    colorId: number,
    options: {
      condition?: 'N' | 'U';
      countryCode?: string;
      currencyCode?: string;
      guideType?: 'stock' | 'sold';
    } = {}
  ): Promise<BrickLinkPriceGuide> {
    const queryParams: Record<string, string | undefined> = {
      color_id: colorId.toString(),
      new_or_used: options.condition ?? 'N',
      guide_type: options.guideType ?? 'stock',
      // Use GBP by default to get UK pricing
      // The API converts all prices to the specified currency
      currency_code: options.currencyCode ?? 'GBP',
    };

    if (options.countryCode) {
      queryParams.country_code = options.countryCode;
    }

    const endpoint = `/items/${type}/${encodeURIComponent(no)}/price`;
    return this.request<BrickLinkPriceGuide>('GET', endpoint, queryParams);
  }

  // ============================================
  // Color Methods
  // ============================================

  /**
   * Get all colors from BrickLink
   * @returns List of all BrickLink colors
   */
  async getColors(): Promise<BrickLinkColor[]> {
    console.log('[BrickLinkClient.getColors] Fetching all colors');
    return this.request<BrickLinkColor[]>('GET', '/colors');
  }

  /**
   * Get a specific color by ID
   * @param colorId Color ID
   * @returns Color information
   */
  async getColor(colorId: number): Promise<BrickLinkColor> {
    return this.request<BrickLinkColor>('GET', `/colors/${colorId}`);
  }
}
