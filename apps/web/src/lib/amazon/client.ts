/**
 * Amazon SP-API Client
 *
 * Implements OAuth token management and API requests for Amazon Selling Partner API.
 * Uses LWA (Login with Amazon) for authentication.
 */

import type {
  AmazonCredentials,
  AmazonTokenResponse,
  AmazonAccessToken,
  AmazonOrder,
  AmazonOrderItem,
  AmazonOrdersResponse,
  AmazonOrderItemsResponse,
  AmazonOrderResponse,
  AmazonErrorResponse,
  AmazonRateLimitInfo,
  GetOrdersParams,
  AmazonOrderStatus,
} from './types';
import { EU_ENDPOINT, MARKETPLACE_INFO } from './types';

/** LWA Token endpoint */
const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';

/** Request timeout in milliseconds */
const REQUEST_TIMEOUT = 30000;

/** Max retries for failed requests */
const MAX_RETRIES = 3;

/** Base delay for exponential backoff (ms) */
const BASE_RETRY_DELAY = 1000;

/** Token refresh buffer - refresh 5 minutes before expiry */
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Error class for Amazon API errors
 */
export class AmazonApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'AmazonApiError';
  }
}

/**
 * Error class for rate limit exceeded
 */
export class AmazonRateLimitError extends AmazonApiError {
  constructor(
    message: string,
    public readonly rateLimitInfo: AmazonRateLimitInfo
  ) {
    super(message, 'RATE_LIMIT', 429);
    this.name = 'AmazonRateLimitError';
  }
}

/**
 * Error class for authentication errors
 */
export class AmazonAuthError extends AmazonApiError {
  constructor(message: string) {
    super(message, 'AUTH_ERROR', 401);
    this.name = 'AmazonAuthError';
  }
}

/**
 * Amazon SP-API Client
 */
export class AmazonClient {
  private credentials: AmazonCredentials;
  private accessToken: AmazonAccessToken | null = null;
  private rateLimitInfo: AmazonRateLimitInfo | null = null;
  private endpoint: string;

  constructor(credentials: AmazonCredentials) {
    this.credentials = credentials;
    // Determine endpoint based on first marketplace
    const firstMarketplace = credentials.marketplaceIds[0];
    this.endpoint = MARKETPLACE_INFO[firstMarketplace]?.endpoint || EU_ENDPOINT;
  }

  /**
   * Get current rate limit information
   */
  getRateLimitInfo(): AmazonRateLimitInfo | null {
    return this.rateLimitInfo;
  }

  /**
   * Sleep for a given duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get a valid access token, refreshing if necessary
   */
  private async getAccessToken(): Promise<string> {
    // Check if we have a valid token
    if (
      this.accessToken &&
      this.accessToken.expiresAt.getTime() > Date.now() + TOKEN_REFRESH_BUFFER_MS
    ) {
      return this.accessToken.accessToken;
    }

    // Refresh the token
    console.log('[AmazonClient] Refreshing access token...');

    const response = await fetch(LWA_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.credentials.refreshToken,
        client_id: this.credentials.clientId,
        client_secret: this.credentials.clientSecret,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[AmazonClient] Token refresh failed:', errorText);
      throw new AmazonAuthError(`Failed to refresh token: ${response.status}`);
    }

    const tokenData = (await response.json()) as AmazonTokenResponse;

    this.accessToken = {
      accessToken: tokenData.access_token,
      expiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
    };

    console.log('[AmazonClient] Token refreshed, expires at:', this.accessToken.expiresAt);
    return this.accessToken.accessToken;
  }

  /**
   * Make an authenticated request to the SP-API with retry logic
   */
  private async request<T>(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
      params?: Record<string, string | string[] | undefined>;
      body?: unknown;
    } = {}
  ): Promise<T> {
    const { method = 'GET', params, body } = options;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const result = await this.makeRequest<T>(path, method, params, body);
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry auth errors
        if (error instanceof AmazonAuthError) {
          throw error;
        }

        // Don't retry client errors (4xx except rate limit)
        if (
          error instanceof AmazonApiError &&
          error.statusCode !== undefined &&
          error.statusCode >= 400 &&
          error.statusCode < 500 &&
          error.statusCode !== 429
        ) {
          throw error;
        }

        // For rate limit, wait for reset time
        if (error instanceof AmazonRateLimitError) {
          const waitTime = Math.max(0, error.rateLimitInfo.resetTime.getTime() - Date.now());
          console.log(`[AmazonClient] Rate limited, waiting ${waitTime}ms...`);
          await this.sleep(waitTime + 1000); // Add 1s buffer
          continue;
        }

        // Wait before retry with exponential backoff
        if (attempt < MAX_RETRIES - 1) {
          const delay = BASE_RETRY_DELAY * Math.pow(2, attempt);
          console.log(
            `[AmazonClient] Retrying request in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`
          );
          await this.sleep(delay);
        }
      }
    }

    throw lastError || new AmazonApiError('Request failed after retries', 'RETRY_FAILED');
  }

  /**
   * Make a single request without retry logic
   */
  private async makeRequest<T>(
    path: string,
    method: string,
    params?: Record<string, string | string[] | undefined>,
    body?: unknown
  ): Promise<T> {
    const accessToken = await this.getAccessToken();

    // Build URL with query parameters
    const url = new URL(`${this.endpoint}${path}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          if (Array.isArray(value)) {
            // For array params, join with comma (Amazon's format)
            url.searchParams.set(key, value.join(','));
          } else {
            url.searchParams.set(key, value);
          }
        }
      });
    }

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      const headers: Record<string, string> = {
        'x-amz-access-token': accessToken,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };

      const response = await fetch(url.toString(), {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Update rate limit info from headers
      this.updateRateLimitInfo(response.headers);

      // Handle rate limiting
      if (response.status === 429) {
        throw new AmazonRateLimitError(
          'Amazon API rate limit exceeded',
          this.rateLimitInfo || {
            remaining: 0,
            resetTime: new Date(Date.now() + 60 * 1000),
            limit: 1,
          }
        );
      }

      // Handle authentication errors
      if (response.status === 401 || response.status === 403) {
        // Clear token to force refresh on next request
        this.accessToken = null;
        throw new AmazonAuthError('Invalid or expired access token');
      }

      // Handle not found
      if (response.status === 404) {
        throw new AmazonApiError('Resource not found', 'NOT_FOUND', 404);
      }

      // Handle other errors
      if (!response.ok) {
        let errorMessage = `Request failed with status ${response.status}`;
        try {
          const errorData = (await response.json()) as AmazonErrorResponse;
          if (errorData.errors && errorData.errors.length > 0) {
            errorMessage = errorData.errors.map((e) => e.message).join('; ');
          }
        } catch {
          // Ignore JSON parse errors
        }
        throw new AmazonApiError(errorMessage, 'API_ERROR', response.status);
      }

      // Parse response
      const data = await response.json();
      return data as T;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof AmazonApiError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new AmazonApiError('Request timeout', 'TIMEOUT', 408);
      }

      throw new AmazonApiError(
        error instanceof Error ? error.message : 'Unknown error',
        'NETWORK_ERROR',
        500
      );
    }
  }

  /**
   * Update rate limit info from response headers
   */
  private updateRateLimitInfo(headers: Headers): void {
    const remaining = headers.get('x-amzn-RateLimit-Limit');

    if (remaining !== null) {
      this.rateLimitInfo = {
        remaining: parseFloat(remaining),
        limit: parseFloat(remaining),
        resetTime: new Date(Date.now() + 1000), // SP-API uses per-second limits
      };
    }
  }

  /**
   * Test the connection with the provided credentials
   */
  async testConnection(): Promise<boolean> {
    try {
      // Try to get a token and fetch one order
      // Amazon requires CreatedAfter or LastUpdatedAfter to be specified
      await this.getAccessToken();
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);
      await this.getOrders({
        MaxResultsPerPage: 1,
        CreatedAfter: oneDayAgo.toISOString(),
      });
      return true;
    } catch (error) {
      console.error('[AmazonClient testConnection] Error:', error);
      if (error instanceof AmazonAuthError) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Get orders with optional filters
   */
  async getOrders(params?: Partial<GetOrdersParams>): Promise<AmazonOrder[]> {
    const queryParams: Record<string, string | string[] | undefined> = {
      MarketplaceIds: params?.MarketplaceIds || this.credentials.marketplaceIds,
    };

    if (params?.CreatedAfter) {
      queryParams.CreatedAfter = params.CreatedAfter;
    }
    if (params?.CreatedBefore) {
      queryParams.CreatedBefore = params.CreatedBefore;
    }
    if (params?.LastUpdatedAfter) {
      queryParams.LastUpdatedAfter = params.LastUpdatedAfter;
    }
    if (params?.LastUpdatedBefore) {
      queryParams.LastUpdatedBefore = params.LastUpdatedBefore;
    }
    if (params?.OrderStatuses && params.OrderStatuses.length > 0) {
      queryParams.OrderStatuses = params.OrderStatuses;
    }
    if (params?.FulfillmentChannels && params.FulfillmentChannels.length > 0) {
      queryParams.FulfillmentChannels = params.FulfillmentChannels;
    }
    if (params?.MaxResultsPerPage) {
      queryParams.MaxResultsPerPage = String(params.MaxResultsPerPage);
    }
    if (params?.NextToken) {
      queryParams.NextToken = params.NextToken;
    }
    if (params?.AmazonOrderIds && params.AmazonOrderIds.length > 0) {
      queryParams.AmazonOrderIds = params.AmazonOrderIds;
    }

    const response = await this.request<AmazonOrdersResponse>('/orders/v0/orders', {
      params: queryParams,
    });

    return response.payload.Orders || [];
  }

  /**
   * Get all orders with pagination
   */
  async getAllOrders(params?: Omit<GetOrdersParams, 'NextToken'>): Promise<AmazonOrder[]> {
    const allOrders: AmazonOrder[] = [];
    let nextToken: string | undefined;
    const maxPages = 50; // Safety limit
    let page = 0;

    do {
      page++;
      console.log(`[AmazonClient] Fetching orders page ${page}...`);

      const queryParams: Partial<GetOrdersParams> = {
        ...params,
        MarketplaceIds: params?.MarketplaceIds || this.credentials.marketplaceIds,
        MaxResultsPerPage: params?.MaxResultsPerPage || 100,
      };

      if (nextToken) {
        queryParams.NextToken = nextToken;
      }

      const response = await this.request<AmazonOrdersResponse>('/orders/v0/orders', {
        params: this.buildOrderParams(queryParams),
      });

      const orders = response.payload.Orders || [];
      allOrders.push(...orders);
      nextToken = response.payload.NextToken;

      // Small delay between pages to respect rate limits
      if (nextToken) {
        await this.sleep(200);
      }
    } while (nextToken && page < maxPages);

    console.log(`[AmazonClient] Fetched ${allOrders.length} orders across ${page} pages`);
    return allOrders;
  }

  /**
   * Build order query params
   */
  private buildOrderParams(
    params: Partial<GetOrdersParams>
  ): Record<string, string | string[] | undefined> {
    const queryParams: Record<string, string | string[] | undefined> = {};

    if (params.MarketplaceIds) {
      queryParams.MarketplaceIds = params.MarketplaceIds;
    }
    if (params.CreatedAfter) {
      queryParams.CreatedAfter = params.CreatedAfter;
    }
    if (params.CreatedBefore) {
      queryParams.CreatedBefore = params.CreatedBefore;
    }
    if (params.LastUpdatedAfter) {
      queryParams.LastUpdatedAfter = params.LastUpdatedAfter;
    }
    if (params.LastUpdatedBefore) {
      queryParams.LastUpdatedBefore = params.LastUpdatedBefore;
    }
    if (params.OrderStatuses && params.OrderStatuses.length > 0) {
      queryParams.OrderStatuses = params.OrderStatuses;
    }
    if (params.FulfillmentChannels && params.FulfillmentChannels.length > 0) {
      queryParams.FulfillmentChannels = params.FulfillmentChannels;
    }
    if (params.MaxResultsPerPage) {
      queryParams.MaxResultsPerPage = String(params.MaxResultsPerPage);
    }
    if (params.NextToken) {
      queryParams.NextToken = params.NextToken;
    }
    if (params.AmazonOrderIds && params.AmazonOrderIds.length > 0) {
      queryParams.AmazonOrderIds = params.AmazonOrderIds;
    }

    return queryParams;
  }

  /**
   * Get a single order by ID
   */
  async getOrder(orderId: string): Promise<AmazonOrder> {
    const response = await this.request<AmazonOrderResponse>(`/orders/v0/orders/${orderId}`);
    return response.payload;
  }

  /**
   * Get order items
   */
  async getOrderItems(orderId: string): Promise<AmazonOrderItem[]> {
    const allItems: AmazonOrderItem[] = [];
    let nextToken: string | undefined;

    do {
      const params: Record<string, string | undefined> = {};
      if (nextToken) {
        params.NextToken = nextToken;
      }

      const response = await this.request<AmazonOrderItemsResponse>(
        `/orders/v0/orders/${orderId}/orderItems`,
        { params }
      );

      allItems.push(...(response.payload.OrderItems || []));
      nextToken = response.payload.NextToken;

      if (nextToken) {
        await this.sleep(200);
      }
    } while (nextToken);

    return allItems;
  }

  /**
   * Get order with items
   */
  async getOrderWithItems(
    orderId: string
  ): Promise<{ order: AmazonOrder; items: AmazonOrderItem[] }> {
    const [order, items] = await Promise.all([this.getOrder(orderId), this.getOrderItems(orderId)]);
    return { order, items };
  }

  /**
   * Get orders by status
   */
  async getOrdersByStatus(
    statuses: AmazonOrderStatus[],
    createdAfter?: string
  ): Promise<AmazonOrder[]> {
    return this.getAllOrders({
      OrderStatuses: statuses,
      CreatedAfter: createdAfter,
    });
  }

  /**
   * Get recent orders (last N days)
   */
  async getRecentOrders(days: number = 30): Promise<AmazonOrder[]> {
    const createdAfter = new Date();
    createdAfter.setDate(createdAfter.getDate() - days);

    return this.getAllOrders({
      CreatedAfter: createdAfter.toISOString(),
    });
  }

  /**
   * Get unshipped orders
   */
  async getUnshippedOrders(): Promise<AmazonOrder[]> {
    return this.getAllOrders({
      OrderStatuses: ['Unshipped', 'PartiallyShipped'],
      FulfillmentChannels: ['MFN'], // Only merchant fulfilled
    });
  }
}
