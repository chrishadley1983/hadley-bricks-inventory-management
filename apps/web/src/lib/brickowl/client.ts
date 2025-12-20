/**
 * Brick Owl API Client
 *
 * Implements API key authentication for Brick Owl API.
 * @see https://www.brickowl.com/api
 */

import type {
  BrickOwlCredentials,
  BrickOwlResponse,
  BrickOwlOrder,
  BrickOwlOrderDetail,
  BrickOwlOrderItem,
  BrickOwlOrderListParams,
  BrickOwlRateLimitInfo,
} from './types';

const BASE_URL = 'https://api.brickowl.com/v1';

/** Default rate limit (Brick Owl has generous limits) */
const DAILY_LIMIT = 10000;

/** Request timeout in milliseconds */
const REQUEST_TIMEOUT = 30000;

/**
 * Error class for Brick Owl API errors
 */
export class BrickOwlApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'BrickOwlApiError';
  }
}

/**
 * Error class for rate limit exceeded
 */
export class BrickOwlRateLimitError extends BrickOwlApiError {
  constructor(
    message: string,
    public readonly rateLimitInfo: BrickOwlRateLimitInfo
  ) {
    super(message, 'RATE_LIMIT', 429);
    this.name = 'BrickOwlRateLimitError';
  }
}

/**
 * Brick Owl API client with API key authentication
 */
export class BrickOwlClient {
  private credentials: BrickOwlCredentials;
  private rateLimitInfo: BrickOwlRateLimitInfo | null = null;

  constructor(credentials: BrickOwlCredentials) {
    this.credentials = credentials;
  }

  /**
   * Get current rate limit information
   */
  getRateLimitInfo(): BrickOwlRateLimitInfo | null {
    return this.rateLimitInfo;
  }

  /**
   * Make an authenticated request to the Brick Owl API
   */
  private async request<T>(
    endpoint: string,
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    // Build URL with query parameters including API key
    const url = new URL(`${BASE_URL}${endpoint}`);
    url.searchParams.set('key', this.credentials.apiKey);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      });
    }

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Update rate limit info from headers if available
      this.updateRateLimitInfo(response.headers);

      // Handle rate limiting
      if (response.status === 429) {
        throw new BrickOwlRateLimitError(
          'Brick Owl API rate limit exceeded',
          this.rateLimitInfo || {
            remaining: 0,
            resetTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
            dailyLimit: DAILY_LIMIT,
            dailyRemaining: 0,
          }
        );
      }

      const data = (await response.json()) as BrickOwlResponse<T>;

      // Check for API errors
      if (data.status === 'error') {
        throw new BrickOwlApiError(
          data.error || 'Unknown error',
          data.error_code || 'UNKNOWN',
          response.status
        );
      }

      // Brick Owl returns data in various formats depending on endpoint
      // For order list, data is in the response itself
      // For order view, data is also in the response
      return (data.data !== undefined ? data.data : data) as T;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof BrickOwlApiError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new BrickOwlApiError('Request timeout', 'TIMEOUT', 408);
      }

      throw new BrickOwlApiError(
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
      await this.getOrders({ limit: 1 });
      return true;
    } catch (error) {
      console.error('[BrickOwl testConnection] Error:', error);
      // Return false for auth errors, rethrow others
      if (error instanceof BrickOwlApiError) {
        if (error.statusCode === 401 || error.statusCode === 403 || error.code === 'INVALID_KEY') {
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
  async getOrders(params?: BrickOwlOrderListParams): Promise<BrickOwlOrder[]> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};

    if (params?.status) {
      queryParams.status = Array.isArray(params.status)
        ? params.status.join(',')
        : params.status;
    }

    if (params?.min_order_id) {
      queryParams.min_order_id = params.min_order_id;
    }

    if (params?.max_order_id) {
      queryParams.max_order_id = params.max_order_id;
    }

    if (params?.limit) {
      queryParams.limit = params.limit;
    }

    if (params?.page) {
      queryParams.page = params.page;
    }

    if (params?.order_direction) {
      queryParams.order_direction = params.order_direction;
    }

    const response = await this.request<BrickOwlOrder[] | Record<string, BrickOwlOrder>>(
      '/order/list',
      queryParams
    );

    // Brick Owl may return an object with order IDs as keys or an array
    if (Array.isArray(response)) {
      return response;
    }

    // Convert object to array if needed
    return Object.values(response);
  }

  /**
   * Get a single order by ID with full details
   * @param orderId The Brick Owl order ID
   */
  async getOrder(orderId: string): Promise<BrickOwlOrderDetail> {
    const response = await this.request<BrickOwlOrderDetail>('/order/view', {
      order_id: orderId,
    });
    return response;
  }

  /**
   * Get items for an order
   * @param orderId The Brick Owl order ID
   */
  async getOrderItems(orderId: string): Promise<BrickOwlOrderItem[]> {
    const response = await this.request<BrickOwlOrderItem[] | Record<string, BrickOwlOrderItem>>(
      '/order/items',
      { order_id: orderId }
    );

    // Handle both array and object response formats
    if (Array.isArray(response)) {
      return response;
    }

    return Object.values(response);
  }

  /**
   * Get all sales orders (sold to buyers)
   * This is a convenience method for getting orders
   */
  async getSalesOrders(
    status?: BrickOwlOrderListParams['status'],
    limit?: number
  ): Promise<BrickOwlOrder[]> {
    return this.getOrders({
      status,
      limit,
      order_direction: 'desc',
    });
  }

  /**
   * Get full order details including items
   * @param orderId The Brick Owl order ID
   */
  async getOrderWithItems(
    orderId: string
  ): Promise<{ order: BrickOwlOrderDetail; items: BrickOwlOrderItem[] }> {
    const [order, items] = await Promise.all([
      this.getOrder(orderId),
      this.getOrderItems(orderId),
    ]);

    return { order, items };
  }
}
