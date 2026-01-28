/**
 * eBay API Adapter
 *
 * HTTP client wrapper for eBay REST APIs with rate limiting, error handling,
 * and automatic token refresh.
 *
 * The Finances API requires digital signatures for EU/UK-domiciled sellers.
 * This adapter supports both signed and unsigned requests.
 */

import type {
  EbayOrdersResponse,
  EbayOrderResponse,
  EbayShippingFulfilmentsResponse,
  EbayTransactionsResponse,
  EbayPayoutsResponse,
  EbayPayoutResponse,
  EbayOrderFetchParams,
  EbayTransactionFetchParams,
  EbayPayoutFetchParams,
  EbayErrorResponse,
  // Account API types
  EbayFulfillmentPoliciesResponse,
  EbayPaymentPoliciesResponse,
  EbayReturnPoliciesResponse,
  // Inventory API types
  EbayInventoryItem,
  EbayOfferRequest,
  EbayCreateOfferResponse,
  EbayPublishOfferResponse,
  EbayOfferResponse,
  EbayInventoryLocation,
  EbayInventoryLocationInput,
  // Taxonomy API types
  EbayCategorySuggestionsResponse,
  EbayItemAspectsResponse,
} from './types';
import type { EbaySigningKeys, SignedRequestHeaders } from './ebay-signature.service';
import { ebaySignatureService } from './ebay-signature.service';

// ============================================================================
// Constants
// ============================================================================

const EBAY_API_BASE_URL = 'https://api.ebay.com';
const EBAY_SIGNED_API_BASE_URL = 'https://apiz.ebay.com'; // Signed requests MUST use apiz.ebay.com
const EBAY_SANDBOX_API_BASE_URL = 'https://api.sandbox.ebay.com';

const FULFILMENT_API_PATH = '/sell/fulfillment/v1';
const FINANCES_API_PATH = '/sell/finances/v1';
const ACCOUNT_API_PATH = '/sell/account/v1';
const INVENTORY_API_PATH = '/sell/inventory/v1';
const TAXONOMY_API_PATH = '/commerce/taxonomy/v1';

// UK category tree ID for LEGO items
const UK_CATEGORY_TREE_ID = '3';

const DEFAULT_RATE_LIMIT_DELAY_MS = 100;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

// ============================================================================
// Types
// ============================================================================

export interface EbayApiAdapterConfig {
  accessToken: string;
  marketplaceId?: string;
  sandbox?: boolean;
  signingKeys?: EbaySigningKeys;
  userId?: string; // Required for auto-fetching signing keys
}

export interface EbayApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  params?: Record<string, string | number | undefined>;
  requiresSignature?: boolean; // If true, request will be signed
}

export class EbayApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public errors?: EbayErrorResponse['errors']
  ) {
    super(message);
    this.name = 'EbayApiError';
  }
}

// ============================================================================
// EbayApiAdapter Class
// ============================================================================

export class EbayApiAdapter {
  private accessToken: string;
  private marketplaceId: string;
  private baseUrl: string;
  private lastRequestTime = 0;
  private signingKeys?: EbaySigningKeys;
  private userId?: string;

  constructor(config: EbayApiAdapterConfig) {
    this.accessToken = config.accessToken;
    this.marketplaceId = config.marketplaceId || 'EBAY_GB';
    this.baseUrl = config.sandbox ? EBAY_SANDBOX_API_BASE_URL : EBAY_API_BASE_URL;
    this.signingKeys = config.signingKeys;
    this.userId = config.userId;
  }

  /**
   * Update the access token (for token refresh)
   */
  setAccessToken(token: string): void {
    this.accessToken = token;
  }

  /**
   * Set signing keys for Finances API requests
   */
  setSigningKeys(keys: EbaySigningKeys): void {
    this.signingKeys = keys;
  }

  /**
   * Ensure signing keys are available (fetch if needed)
   */
  private async ensureSigningKeys(): Promise<EbaySigningKeys | null> {
    if (this.signingKeys) {
      return this.signingKeys;
    }

    if (!this.userId) {
      console.warn('[EbayApiAdapter] No userId set, cannot fetch signing keys');
      return null;
    }

    // Try to get signing keys
    const keys = await ebaySignatureService.getSigningKeys(this.userId, this.accessToken);
    if (keys) {
      this.signingKeys = keys;
    }
    return keys;
  }

  // ============================================================================
  // Fulfilment API Methods
  // ============================================================================

  /**
   * Get orders with optional filtering
   * @see https://developer.ebay.com/api-docs/sell/fulfillment/resources/order/methods/getOrders
   */
  async getOrders(params?: EbayOrderFetchParams): Promise<EbayOrdersResponse> {
    const queryParams: Record<string, string | number | undefined> = {
      limit: params?.limit || 50,
      offset: params?.offset || 0,
    };

    if (params?.filter) {
      queryParams.filter = params.filter;
    }

    if (params?.orderIds) {
      queryParams.orderIds = params.orderIds;
    }

    return this.request<EbayOrdersResponse>(`${FULFILMENT_API_PATH}/order`, {
      params: queryParams,
    });
  }

  /**
   * Get a specific order by ID
   * @see https://developer.ebay.com/api-docs/sell/fulfillment/resources/order/methods/getOrder
   */
  async getOrder(orderId: string): Promise<EbayOrderResponse> {
    return this.request<EbayOrderResponse>(
      `${FULFILMENT_API_PATH}/order/${encodeURIComponent(orderId)}`
    );
  }

  /**
   * Get shipping fulfilments for an order
   * @see https://developer.ebay.com/api-docs/sell/fulfillment/resources/order/shipping_fulfillment/methods/getShippingFulfillments
   */
  async getShippingFulfilments(orderId: string): Promise<EbayShippingFulfilmentsResponse> {
    return this.request<EbayShippingFulfilmentsResponse>(
      `${FULFILMENT_API_PATH}/order/${encodeURIComponent(orderId)}/shipping_fulfillment`
    );
  }

  // ============================================================================
  // Finances API Methods (Requires Digital Signatures for EU/UK sellers)
  // ============================================================================

  /**
   * Get transactions with optional filtering
   * Note: Finances API requires digital signatures for EU/UK-domiciled sellers
   * @see https://developer.ebay.com/api-docs/sell/finances/resources/transaction/methods/getTransactions
   */
  async getTransactions(params?: EbayTransactionFetchParams): Promise<EbayTransactionsResponse> {
    const queryParams: Record<string, string | number | undefined> = {
      limit: params?.limit || 50,
      offset: params?.offset || 0,
    };

    if (params?.filter) {
      queryParams.filter = params.filter;
    }

    if (params?.transactionType) {
      queryParams.transactionType = params.transactionType;
    }

    return this.request<EbayTransactionsResponse>(`${FINANCES_API_PATH}/transaction`, {
      params: queryParams,
      requiresSignature: true,
    });
  }

  /**
   * Get payouts with optional filtering
   * Note: Finances API requires digital signatures for EU/UK-domiciled sellers
   * @see https://developer.ebay.com/api-docs/sell/finances/resources/payout/methods/getPayouts
   */
  async getPayouts(params?: EbayPayoutFetchParams): Promise<EbayPayoutsResponse> {
    const queryParams: Record<string, string | number | undefined> = {
      limit: params?.limit || 50,
      offset: params?.offset || 0,
    };

    if (params?.filter) {
      queryParams.filter = params.filter;
    }

    if (params?.payoutStatus) {
      queryParams.payoutStatus = params.payoutStatus;
    }

    return this.request<EbayPayoutsResponse>(`${FINANCES_API_PATH}/payout`, {
      params: queryParams,
      requiresSignature: true,
    });
  }

  /**
   * Get a specific payout by ID
   * Note: Finances API requires digital signatures for EU/UK-domiciled sellers
   * @see https://developer.ebay.com/api-docs/sell/finances/resources/payout/methods/getPayout
   */
  async getPayout(payoutId: string): Promise<EbayPayoutResponse> {
    return this.request<EbayPayoutResponse>(
      `${FINANCES_API_PATH}/payout/${encodeURIComponent(payoutId)}`,
      { requiresSignature: true }
    );
  }

  // ============================================================================
  // Account API Methods (Business Policies)
  // ============================================================================

  /**
   * Get all fulfillment (shipping) policies
   * @see https://developer.ebay.com/api-docs/sell/account/resources/fulfillment_policy/methods/getFulfillmentPolicies
   */
  async getFulfillmentPolicies(): Promise<EbayFulfillmentPoliciesResponse> {
    return this.request<EbayFulfillmentPoliciesResponse>(
      `${ACCOUNT_API_PATH}/fulfillment_policy`,
      { params: { marketplace_id: this.marketplaceId } }
    );
  }

  /**
   * Get all payment policies
   * @see https://developer.ebay.com/api-docs/sell/account/resources/payment_policy/methods/getPaymentPolicies
   */
  async getPaymentPolicies(): Promise<EbayPaymentPoliciesResponse> {
    return this.request<EbayPaymentPoliciesResponse>(
      `${ACCOUNT_API_PATH}/payment_policy`,
      { params: { marketplace_id: this.marketplaceId } }
    );
  }

  /**
   * Get all return policies
   * @see https://developer.ebay.com/api-docs/sell/account/resources/return_policy/methods/getReturnPolicies
   */
  async getReturnPolicies(): Promise<EbayReturnPoliciesResponse> {
    return this.request<EbayReturnPoliciesResponse>(
      `${ACCOUNT_API_PATH}/return_policy`,
      { params: { marketplace_id: this.marketplaceId } }
    );
  }

  // ============================================================================
  // Inventory API Methods
  // ============================================================================

  /**
   * Create or replace an inventory item
   * @see https://developer.ebay.com/api-docs/sell/inventory/resources/inventory_item/methods/createOrReplaceInventoryItem
   */
  async createOrReplaceInventoryItem(sku: string, item: EbayInventoryItem): Promise<void> {
    await this.request<void>(
      `${INVENTORY_API_PATH}/inventory_item/${encodeURIComponent(sku)}`,
      {
        method: 'PUT',
        body: item,
        headers: {
          'Content-Language': 'en-GB',
        },
      }
    );
  }

  /**
   * Get an inventory item by SKU
   * @see https://developer.ebay.com/api-docs/sell/inventory/resources/inventory_item/methods/getInventoryItem
   */
  async getInventoryItem(sku: string): Promise<EbayInventoryItem> {
    return this.request<EbayInventoryItem>(
      `${INVENTORY_API_PATH}/inventory_item/${encodeURIComponent(sku)}`
    );
  }

  /**
   * Delete an inventory item by SKU
   * @see https://developer.ebay.com/api-docs/sell/inventory/resources/inventory_item/methods/deleteInventoryItem
   */
  async deleteInventoryItem(sku: string): Promise<void> {
    await this.request<void>(
      `${INVENTORY_API_PATH}/inventory_item/${encodeURIComponent(sku)}`,
      { method: 'DELETE' }
    );
  }

  /**
   * Create an offer for an inventory item
   * @see https://developer.ebay.com/api-docs/sell/inventory/resources/offer/methods/createOffer
   */
  async createOffer(offer: EbayOfferRequest): Promise<EbayCreateOfferResponse> {
    return this.request<EbayCreateOfferResponse>(
      `${INVENTORY_API_PATH}/offer`,
      {
        method: 'POST',
        body: offer,
        headers: {
          'Content-Language': 'en-GB',
          'Accept-Language': 'en-GB',
        },
      }
    );
  }

  /**
   * Update an existing offer
   * @see https://developer.ebay.com/api-docs/sell/inventory/resources/offer/methods/updateOffer
   */
  async updateOffer(offerId: string, offer: Partial<EbayOfferRequest>): Promise<EbayOfferResponse> {
    return this.request<EbayOfferResponse>(
      `${INVENTORY_API_PATH}/offer/${encodeURIComponent(offerId)}`,
      {
        method: 'PUT',
        body: offer,
        headers: {
          'Content-Language': 'en-GB',
          'Accept-Language': 'en-GB',
        },
      }
    );
  }

  /**
   * Get an offer by ID
   * @see https://developer.ebay.com/api-docs/sell/inventory/resources/offer/methods/getOffer
   */
  async getOffer(offerId: string): Promise<EbayOfferResponse> {
    return this.request<EbayOfferResponse>(
      `${INVENTORY_API_PATH}/offer/${encodeURIComponent(offerId)}`
    );
  }

  /**
   * Publish an offer to create an eBay listing
   * @see https://developer.ebay.com/api-docs/sell/inventory/resources/offer/methods/publishOffer
   */
  async publishOffer(offerId: string): Promise<EbayPublishOfferResponse> {
    return this.request<EbayPublishOfferResponse>(
      `${INVENTORY_API_PATH}/offer/${encodeURIComponent(offerId)}/publish`,
      {
        method: 'POST',
        headers: {
          'Content-Language': 'en-GB',
          'Accept-Language': 'en-GB',
        },
      }
    );
  }

  /**
   * Withdraw an offer (end a listing)
   * @see https://developer.ebay.com/api-docs/sell/inventory/resources/offer/methods/withdrawOffer
   */
  async withdrawOffer(offerId: string): Promise<void> {
    await this.request<void>(
      `${INVENTORY_API_PATH}/offer/${encodeURIComponent(offerId)}/withdraw`,
      {
        method: 'POST',
        headers: {
          'Content-Language': 'en-GB',
          'Accept-Language': 'en-GB',
        },
      }
    );
  }

  // ============================================================================
  // Merchant Location API Methods
  // ============================================================================

  /**
   * Get merchant locations
   * @see https://developer.ebay.com/api-docs/sell/inventory/resources/location/methods/getInventoryLocations
   */
  async getInventoryLocations(): Promise<{ locations: EbayInventoryLocation[] }> {
    return this.request<{ locations: EbayInventoryLocation[] }>(
      `${INVENTORY_API_PATH}/location`,
      {
        headers: {
          'Accept-Language': 'en-GB',
        },
      }
    );
  }

  /**
   * Create or update a merchant inventory location
   * @see https://developer.ebay.com/api-docs/sell/inventory/resources/location/methods/createInventoryLocation
   */
  async createInventoryLocation(merchantLocationKey: string, location: EbayInventoryLocationInput): Promise<void> {
    await this.request<void>(
      `${INVENTORY_API_PATH}/location/${encodeURIComponent(merchantLocationKey)}`,
      {
        method: 'POST',
        body: location,
        headers: {
          'Content-Language': 'en-GB',
          'Accept-Language': 'en-GB',
        },
      }
    );
  }

  // ============================================================================
  // Taxonomy API Methods
  // ============================================================================

  /**
   * Get category suggestions based on keywords
   * @see https://developer.ebay.com/api-docs/commerce/taxonomy/resources/category_tree/methods/getCategorySuggestions
   */
  async getCategorySuggestions(keywords: string): Promise<EbayCategorySuggestionsResponse> {
    return this.request<EbayCategorySuggestionsResponse>(
      `${TAXONOMY_API_PATH}/category_tree/${UK_CATEGORY_TREE_ID}/get_category_suggestions`,
      { params: { q: keywords } }
    );
  }

  /**
   * Get item aspects (required fields) for a category
   * @see https://developer.ebay.com/api-docs/commerce/taxonomy/resources/category_tree/methods/getItemAspectsForCategory
   */
  async getItemAspectsForCategory(categoryId: string): Promise<EbayItemAspectsResponse> {
    return this.request<EbayItemAspectsResponse>(
      `${TAXONOMY_API_PATH}/category_tree/${UK_CATEGORY_TREE_ID}/get_item_aspects_for_category`,
      { params: { category_id: categoryId } }
    );
  }

  // ============================================================================
  // Pagination Helpers
  // ============================================================================

  /**
   * Fetch all orders using pagination
   */
  async getAllOrders(
    params?: Omit<EbayOrderFetchParams, 'offset'>
  ): Promise<EbayOrderResponse[]> {
    const allOrders: EbayOrderResponse[] = [];
    let offset = 0;
    const limit = params?.limit || 50;

    while (true) {
      const response = await this.getOrders({ ...params, limit, offset });
      allOrders.push(...response.orders);

      if (offset + limit >= response.total) {
        break;
      }

      offset += limit;
    }

    return allOrders;
  }

  /**
   * Fetch all transactions using pagination
   */
  async getAllTransactions(
    params?: Omit<EbayTransactionFetchParams, 'offset'>
  ): Promise<EbayTransactionsResponse['transactions']> {
    const allTransactions: EbayTransactionsResponse['transactions'] = [];
    let offset = 0;
    const limit = params?.limit || 50;

    while (true) {
      const response = await this.getTransactions({ ...params, limit, offset });
      allTransactions.push(...response.transactions);

      if (offset + limit >= response.total) {
        break;
      }

      offset += limit;
    }

    return allTransactions;
  }

  /**
   * Fetch all payouts using pagination
   */
  async getAllPayouts(
    params?: Omit<EbayPayoutFetchParams, 'offset'>
  ): Promise<EbayPayoutResponse[]> {
    const allPayouts: EbayPayoutResponse[] = [];
    let offset = 0;
    const limit = params?.limit || 50;

    while (true) {
      const response = await this.getPayouts({ ...params, limit, offset });
      allPayouts.push(...response.payouts);

      if (offset + limit >= response.total) {
        break;
      }

      offset += limit;
    }

    return allPayouts;
  }

  // ============================================================================
  // Filter Builder Helpers
  // ============================================================================

  /**
   * Convert a date string to UTC format with Z suffix.
   * eBay API has issues with + in timezone offsets due to URL encoding.
   * Using Z (UTC) format avoids this issue.
   */
  private static toUtcFormat(dateString: string): string {
    const date = new Date(dateString);
    // Return ISO string which always uses Z suffix for UTC
    return date.toISOString();
  }

  /**
   * Build a date range filter for orders
   * @param fromDate Start date (ISO string)
   * @param toDate End date (ISO string)
   * @param field Filter field ('creationdate' or 'lastmodifieddate')
   */
  static buildOrderDateFilter(
    fromDate?: string,
    toDate?: string,
    field: 'creationdate' | 'lastmodifieddate' = 'creationdate'
  ): string | undefined {
    if (!fromDate && !toDate) return undefined;

    const parts: string[] = [];

    // Convert dates to UTC format to avoid URL encoding issues with +
    const utcFromDate = fromDate ? this.toUtcFormat(fromDate) : undefined;
    const utcToDate = toDate ? this.toUtcFormat(toDate) : undefined;

    if (utcFromDate) {
      parts.push(`${field}:[${utcFromDate}..]`);
    }

    if (utcToDate) {
      if (utcFromDate) {
        // Replace the range end
        parts[0] = `${field}:[${utcFromDate}..${utcToDate}]`;
      } else {
        parts.push(`${field}:[..${utcToDate}]`);
      }
    }

    return parts.join(',');
  }

  /**
   * Build a fulfilment status filter for orders
   */
  static buildFulfilmentStatusFilter(
    statuses: ('FULFILLED' | 'IN_PROGRESS' | 'NOT_STARTED')[]
  ): string {
    return `orderfulfillmentstatus:{${statuses.join('|')}}`;
  }

  /**
   * Build a date range filter for transactions
   */
  static buildTransactionDateFilter(fromDate?: string, toDate?: string): string | undefined {
    if (!fromDate && !toDate) return undefined;

    const parts: string[] = [];

    // Convert dates to UTC format to avoid URL encoding issues with +
    const utcFromDate = fromDate ? this.toUtcFormat(fromDate) : undefined;
    const utcToDate = toDate ? this.toUtcFormat(toDate) : undefined;

    if (utcFromDate) {
      parts.push(`transactionDate:[${utcFromDate}..]`);
    }

    if (utcToDate) {
      if (utcFromDate) {
        parts[0] = `transactionDate:[${utcFromDate}..${utcToDate}]`;
      } else {
        parts.push(`transactionDate:[..${utcToDate}]`);
      }
    }

    return parts.join(',');
  }

  /**
   * Build a date range filter for payouts
   */
  static buildPayoutDateFilter(fromDate?: string, toDate?: string): string | undefined {
    if (!fromDate && !toDate) return undefined;

    // Convert dates to UTC format to avoid URL encoding issues with +
    const utcFromDate = fromDate ? this.toUtcFormat(fromDate) : undefined;
    const utcToDate = toDate ? this.toUtcFormat(toDate) : undefined;

    if (utcFromDate && utcToDate) {
      return `payoutDate:[${utcFromDate}..${utcToDate}]`;
    } else if (utcFromDate) {
      return `payoutDate:[${utcFromDate}..]`;
    } else if (utcToDate) {
      return `payoutDate:[..${utcToDate}]`;
    }

    return undefined;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Make an API request with rate limiting, retry logic, and optional digital signatures
   */
  private async request<T>(path: string, options: EbayApiRequestOptions = {}): Promise<T> {
    // Rate limiting - ensure minimum delay between requests
    await this.enforceRateLimit();

    // IMPORTANT: Signed requests MUST use apiz.ebay.com, not api.ebay.com
    // The regular api.ebay.com endpoint returns 404 for signed requests
    const baseUrlForRequest = options.requiresSignature
      ? EBAY_SIGNED_API_BASE_URL
      : this.baseUrl;
    const url = new URL(`${baseUrlForRequest}${path}`);

    // Add query parameters
    if (options.params) {
      Object.entries(options.params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    console.log(`[EbayApiAdapter] Request: ${options.method || 'GET'} ${url.toString()}`);
    console.log(`[EbayApiAdapter] Requires signature: ${options.requiresSignature || false}`);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken.substring(0, 20)}...`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-EBAY-C-MARKETPLACE-ID': this.marketplaceId,
      ...options.headers,
    };

    // Use full token for actual request
    const requestHeaders: Record<string, string> = {
      ...headers,
      Authorization: `Bearer ${this.accessToken}`,
    };

    // Add digital signature headers if required
    let signedHeaders: SignedRequestHeaders | null = null;
    if (options.requiresSignature) {
      const signingKeys = await this.ensureSigningKeys();
      if (signingKeys) {
        console.log('[EbayApiAdapter] Signing request with digital signature');
        const bodyString = options.body ? JSON.stringify(options.body) : undefined;
        signedHeaders = ebaySignatureService.signRequest(
          signingKeys,
          options.method || 'GET',
          url.toString(),
          bodyString
        );

        // Add signature headers to request
        requestHeaders['x-ebay-signature-key'] = signedHeaders['x-ebay-signature-key'];
        requestHeaders['x-ebay-enforce-signature'] = signedHeaders['x-ebay-enforce-signature'];
        requestHeaders['Signature'] = signedHeaders['Signature'];
        requestHeaders['Signature-Input'] = signedHeaders['Signature-Input'];
        if (signedHeaders['Content-Digest']) {
          requestHeaders['Content-Digest'] = signedHeaders['Content-Digest'];
        }
        console.log('[EbayApiAdapter] Signature headers added');
      } else {
        console.warn('[EbayApiAdapter] Digital signatures required but no signing keys available');
        // Continue without signature - API will return 403 if signatures are actually required
      }
    }

    let lastError: Error | undefined;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        console.log(`[EbayApiAdapter] Attempt ${attempt + 1}/${MAX_RETRIES}`);
        const response = await fetch(url.toString(), {
          method: options.method || 'GET',
          headers: requestHeaders,
          body: options.body ? JSON.stringify(options.body) : undefined,
        });

        console.log(`[EbayApiAdapter] Response status: ${response.status} ${response.statusText}`);

        // Handle rate limiting
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const delayMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : RETRY_DELAY_MS * (attempt + 1);
          console.warn(`[EbayApiAdapter] Rate limited, retrying after ${delayMs}ms`);
          await this.delay(delayMs);
          continue;
        }

        // Handle other errors
        if (!response.ok) {
          const errorBody = await response.json().catch(() => null);
          const errorResponse = errorBody as EbayErrorResponse | null;
          console.error(`[EbayApiAdapter] Error response:`, JSON.stringify(errorResponse, null, 2));

          // Check if this is a signature error - provide more helpful message
          const errorMessage = errorResponse?.errors?.[0]?.message || `HTTP ${response.status}: ${response.statusText}`;
          const isSignatureError = errorMessage.toLowerCase().includes('signature') ||
            errorMessage.toLowerCase().includes('x-ebay-signature-key');

          if (isSignatureError && !signedHeaders) {
            throw new EbayApiError(
              'Digital signature required. Please reconnect your eBay account to enable API signing.',
              response.status,
              errorResponse?.errors
            );
          }

          throw new EbayApiError(
            errorMessage,
            response.status,
            errorResponse?.errors
          );
        }

        // Handle 204 No Content responses (e.g., createOrReplaceInventoryItem)
        if (response.status === 204) {
          console.log(`[EbayApiAdapter] Success - 204 No Content`);
          return undefined as T;
        }

        const data = (await response.json()) as T;
        console.log(`[EbayApiAdapter] Success - received data`);
        return data;
      } catch (error) {
        lastError = error as Error;
        console.error(`[EbayApiAdapter] Request error:`, error);

        // Don't retry on non-retryable errors
        if (error instanceof EbayApiError) {
          // 401 Unauthorized - token expired, don't retry
          if (error.statusCode === 401) {
            throw error;
          }

          // 403 Forbidden - insufficient scopes or signature issue, don't retry
          if (error.statusCode === 403) {
            throw error;
          }

          // 4xx errors (except 429) - don't retry
          if (error.statusCode >= 400 && error.statusCode < 500) {
            throw error;
          }
        }

        // Exponential backoff for server errors
        if (attempt < MAX_RETRIES - 1) {
          const delayMs = RETRY_DELAY_MS * Math.pow(2, attempt);
          console.warn(`[EbayApiAdapter] Request failed, retrying in ${delayMs}ms`, error);
          await this.delay(delayMs);
        }
      }
    }

    throw lastError || new Error('Request failed after maximum retries');
  }

  /**
   * Enforce rate limiting between requests
   */
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < DEFAULT_RATE_LIMIT_DELAY_MS) {
      await this.delay(DEFAULT_RATE_LIMIT_DELAY_MS - timeSinceLastRequest);
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
