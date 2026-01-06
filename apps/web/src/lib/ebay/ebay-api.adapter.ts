/**
 * eBay API Adapter
 *
 * HTTP client wrapper for eBay REST APIs with rate limiting, error handling,
 * and automatic token refresh.
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
} from './types';

// ============================================================================
// Constants
// ============================================================================

const EBAY_API_BASE_URL = 'https://api.ebay.com';
const EBAY_SANDBOX_API_BASE_URL = 'https://api.sandbox.ebay.com';

const FULFILMENT_API_PATH = '/sell/fulfillment/v1';
const FINANCES_API_PATH = '/sell/finances/v1';

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
}

export interface EbayApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  params?: Record<string, string | number | undefined>;
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

  constructor(config: EbayApiAdapterConfig) {
    this.accessToken = config.accessToken;
    this.marketplaceId = config.marketplaceId || 'EBAY_GB';
    this.baseUrl = config.sandbox ? EBAY_SANDBOX_API_BASE_URL : EBAY_API_BASE_URL;
  }

  /**
   * Update the access token (for token refresh)
   */
  setAccessToken(token: string): void {
    this.accessToken = token;
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
  // Finances API Methods
  // ============================================================================

  /**
   * Get transactions with optional filtering
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
    });
  }

  /**
   * Get payouts with optional filtering
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
    });
  }

  /**
   * Get a specific payout by ID
   * @see https://developer.ebay.com/api-docs/sell/finances/resources/payout/methods/getPayout
   */
  async getPayout(payoutId: string): Promise<EbayPayoutResponse> {
    return this.request<EbayPayoutResponse>(
      `${FINANCES_API_PATH}/payout/${encodeURIComponent(payoutId)}`
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

    if (fromDate) {
      parts.push(`${field}:[${fromDate}..]`);
    }

    if (toDate) {
      if (fromDate) {
        // Replace the range end
        parts[0] = `${field}:[${fromDate}..${toDate}]`;
      } else {
        parts.push(`${field}:[..${toDate}]`);
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

    if (fromDate) {
      parts.push(`transactionDate:[${fromDate}..]`);
    }

    if (toDate) {
      if (fromDate) {
        parts[0] = `transactionDate:[${fromDate}..${toDate}]`;
      } else {
        parts.push(`transactionDate:[..${toDate}]`);
      }
    }

    return parts.join(',');
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Make an API request with rate limiting and retry logic
   */
  private async request<T>(path: string, options: EbayApiRequestOptions = {}): Promise<T> {
    // Rate limiting - ensure minimum delay between requests
    await this.enforceRateLimit();

    const url = new URL(`${this.baseUrl}${path}`);

    // Add query parameters
    if (options.params) {
      Object.entries(options.params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-EBAY-C-MARKETPLACE-ID': this.marketplaceId,
      ...options.headers,
    };

    let lastError: Error | undefined;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(url.toString(), {
          method: options.method || 'GET',
          headers,
          body: options.body ? JSON.stringify(options.body) : undefined,
        });

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

          throw new EbayApiError(
            errorResponse?.errors?.[0]?.message || `HTTP ${response.status}: ${response.statusText}`,
            response.status,
            errorResponse?.errors
          );
        }

        return (await response.json()) as T;
      } catch (error) {
        lastError = error as Error;

        // Don't retry on non-retryable errors
        if (error instanceof EbayApiError) {
          // 401 Unauthorized - token expired, don't retry
          if (error.statusCode === 401) {
            throw error;
          }

          // 403 Forbidden - insufficient scopes, don't retry
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
