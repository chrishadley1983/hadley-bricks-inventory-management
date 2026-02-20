/**
 * Bricqer API Client
 *
 * Implements API key authentication for Bricqer API.
 * Uses Authorization: Api-Key {key} header.
 */

import type {
  BricqerCredentials,
  BricqerPaginatedResponse,
  BricqerOrder,
  BricqerOrderDetail,
  BricqerOrderItem,
  BricqerOrderListParams,
  BricqerRateLimitInfo,
  BricqerErrorResponse,
  BricqerInventoryItem,
  BricqerInventoryListParams,
  BricqerStorage,
  BricqerColor,
  BricqerBatch,
  BricqerPurchase,
} from './types';

/** Request timeout in milliseconds */
const REQUEST_TIMEOUT = 30000;

/** Max retries for failed requests */
const MAX_RETRIES = 3;

/** Base delay for exponential backoff (ms) */
const BASE_RETRY_DELAY = 1000;

/**
 * Error class for Bricqer API errors
 */
export class BricqerApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'BricqerApiError';
  }
}

/**
 * Error class for rate limit exceeded
 */
export class BricqerRateLimitError extends BricqerApiError {
  constructor(
    message: string,
    public readonly rateLimitInfo: BricqerRateLimitInfo
  ) {
    super(message, 'RATE_LIMIT', 429);
    this.name = 'BricqerRateLimitError';
  }
}

/**
 * Error class for authentication errors
 */
export class BricqerAuthError extends BricqerApiError {
  constructor(message: string) {
    super(message, 'AUTH_ERROR', 401);
    this.name = 'BricqerAuthError';
  }
}

/**
 * Normalize tenant URL to ensure proper format
 */
function normalizeTenantUrl(url: string): string {
  let normalized = url.trim();

  // Remove trailing slash
  if (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  // Add https:// if no protocol
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    normalized = `https://${normalized}`;
  }

  return normalized;
}

/**
 * Bricqer API client with API key authentication
 */
export class BricqerClient {
  private credentials: BricqerCredentials;
  private baseUrl: string;
  private rateLimitInfo: BricqerRateLimitInfo | null = null;

  constructor(credentials: BricqerCredentials) {
    this.credentials = credentials;
    this.baseUrl = `${normalizeTenantUrl(credentials.tenantUrl)}/api/v1`;
  }

  /**
   * Get current rate limit information
   */
  getRateLimitInfo(): BricqerRateLimitInfo | null {
    return this.rateLimitInfo;
  }

  /**
   * Sleep for a given duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Make an authenticated request to the Bricqer API with retry logic
   */
  private async request<T>(
    endpoint: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
      params?: Record<string, string | number | boolean | undefined>;
      body?: unknown;
    } = {}
  ): Promise<T> {
    const { method = 'GET', params, body } = options;

    // Build URL with query parameters
    const url = new URL(`${this.baseUrl}${endpoint}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      });
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const result = await this.makeRequest<T>(url.toString(), method, body);
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry auth errors
        if (error instanceof BricqerAuthError) {
          throw error;
        }

        // Don't retry client errors (4xx except rate limit)
        if (
          error instanceof BricqerApiError &&
          error.statusCode !== undefined &&
          error.statusCode >= 400 &&
          error.statusCode < 500 &&
          error.statusCode !== 429
        ) {
          throw error;
        }

        // Wait before retry with exponential backoff
        if (attempt < MAX_RETRIES - 1) {
          const delay = BASE_RETRY_DELAY * Math.pow(2, attempt);
          console.log(`[Bricqer] Retrying request in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
          await this.sleep(delay);
        }
      }
    }

    throw lastError || new BricqerApiError('Request failed after retries', 'RETRY_FAILED');
  }

  /**
   * Make a single request without retry logic
   */
  private async makeRequest<T>(url: string, method: string, body?: unknown): Promise<T> {
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      const headers: Record<string, string> = {
        Authorization: `Api-Key ${this.credentials.apiKey}`,
        Accept: 'application/json',
      };

      if (body) {
        headers['Content-Type'] = 'application/json';
      }

      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Update rate limit info from headers if available
      this.updateRateLimitInfo(response.headers);

      // Handle rate limiting
      if (response.status === 429) {
        throw new BricqerRateLimitError(
          'Bricqer API rate limit exceeded',
          this.rateLimitInfo || {
            remaining: 0,
            resetTime: new Date(Date.now() + 60 * 1000),
            limit: 100,
          }
        );
      }

      // Handle authentication errors
      if (response.status === 401 || response.status === 403) {
        throw new BricqerAuthError('Invalid API key or unauthorized access');
      }

      // Handle not found
      if (response.status === 404) {
        throw new BricqerApiError('Resource not found', 'NOT_FOUND', 404);
      }

      // Handle other errors
      if (!response.ok) {
        let errorMessage = `Request failed with status ${response.status}`;
        try {
          const errorData = (await response.json()) as BricqerErrorResponse;
          errorMessage = errorData.detail || errorData.error || errorData.message || errorMessage;
        } catch {
          // Ignore JSON parse errors
        }
        throw new BricqerApiError(errorMessage, 'API_ERROR', response.status);
      }

      // Parse response
      const data = await response.json();
      return data as T;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof BricqerApiError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new BricqerApiError('Request timeout', 'TIMEOUT', 408);
      }

      throw new BricqerApiError(
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
    const limit = headers.get('X-RateLimit-Limit');
    const reset = headers.get('X-RateLimit-Reset');

    if (remaining !== null || limit !== null) {
      this.rateLimitInfo = {
        remaining: remaining ? parseInt(remaining, 10) : 0,
        limit: limit ? parseInt(limit, 10) : 100,
        resetTime: reset ? new Date(parseInt(reset, 10) * 1000) : new Date(Date.now() + 60 * 1000),
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
      console.error('[Bricqer testConnection] Error:', error);
      // Return false for auth errors, rethrow others
      if (error instanceof BricqerAuthError) {
        return false;
      }
      if (error instanceof BricqerApiError) {
        if (error.statusCode === 401 || error.statusCode === 403) {
          return false;
        }
      }
      throw error;
    }
  }

  /**
   * Get list of orders
   * @param params Query parameters for filtering orders
   *
   * Note: Bricqer API uses /orders/order/ endpoint (not /orders/)
   * Status values are uppercase: READY, SHIPPED, CANCELLED, etc.
   * Use 'filed' parameter to filter archived orders (filed=true for archived)
   */
  async getOrders(params?: BricqerOrderListParams): Promise<BricqerOrder[]> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};

    if (params?.status) {
      queryParams.status = Array.isArray(params.status)
        ? params.status.join(',')
        : params.status;
    }

    if (params?.payment_status) {
      queryParams.payment_status = params.payment_status;
    }

    if (params?.created_after) {
      queryParams.created_after = params.created_after;
    }

    if (params?.created_before) {
      queryParams.created_before = params.created_before;
    }

    if (params?.limit) {
      queryParams.limit = params.limit;
    }

    if (params?.offset) {
      queryParams.offset = params.offset;
    }

    if (params?.page) {
      queryParams.page = params.page;
    }

    if (params?.ordering) {
      queryParams.ordering = params.ordering;
    }

    if (params?.search) {
      queryParams.search = params.search;
    }

    // Include archived orders filter
    if (params?.filed !== undefined) {
      queryParams.filed = params.filed;
    }

    // Bricqer API uses /orders/order/ endpoint
    const response = await this.request<BricqerPaginatedResponse<BricqerOrder> | BricqerOrder[]>(
      '/orders/order/',
      { params: queryParams }
    );

    // Handle both paginated and array responses
    if (Array.isArray(response)) {
      return response;
    }

    return response.results || [];
  }

  /**
   * Convert order list params to request params
   */
  private convertOrderParams(
    params?: Omit<BricqerOrderListParams, 'limit' | 'offset' | 'page'>
  ): Record<string, string | number | boolean | undefined> {
    if (!params) return {};

    const result: Record<string, string | number | boolean | undefined> = {};

    // Handle status (can be string or array)
    if (params.status) {
      result.status = Array.isArray(params.status)
        ? params.status.join(',')
        : params.status;
    }
    if (params.payment_status) result.payment_status = params.payment_status;
    if (params.created_after) result.created_after = params.created_after;
    if (params.created_before) result.created_before = params.created_before;
    if (params.ordering) result.ordering = params.ordering;
    if (params.search) result.search = params.search;
    // Include archived orders filter
    if (params.filed !== undefined) result.filed = params.filed;

    return result;
  }

  /**
   * Get all orders with pagination
   * Uses page-based pagination (page=1, page=2, etc.) with limit=100 per page
   */
  async getAllOrders(params?: Omit<BricqerOrderListParams, 'limit' | 'offset' | 'page'>): Promise<BricqerOrder[]> {
    const allOrders: BricqerOrder[] = [];
    let page = 1;
    const limit = 100;
    let hasMore = true;
    const maxPages = 50; // Safety limit to prevent infinite loops

    while (hasMore && page <= maxPages) {
      const queryParams = this.convertOrderParams(params);
      queryParams.limit = limit;
      queryParams.page = page;

      const response = await this.request<BricqerPaginatedResponse<BricqerOrder> | BricqerOrder[]>(
        '/orders/order/',
        { params: queryParams }
      );

      if (Array.isArray(response)) {
        allOrders.push(...response);
        // Continue if we got a full page
        hasMore = response.length === limit;
      } else {
        allOrders.push(...(response.results || []));
        // Continue if we got a full page
        hasMore = (response.results?.length || 0) === limit;
      }
      page++;
    }

    return allOrders;
  }

  /**
   * Get a single order by ID with full details
   * @param orderId The Bricqer order ID
   */
  async getOrder(orderId: string | number): Promise<BricqerOrderDetail> {
    const response = await this.request<BricqerOrderDetail>(`/orders/order/${orderId}/`);
    return response;
  }

  /**
   * Get items for an order (if separate endpoint exists)
   * @param orderId The Bricqer order ID
   */
  async getOrderItems(orderId: string | number): Promise<BricqerOrderItem[]> {
    try {
      const response = await this.request<BricqerOrderItem[] | { items: BricqerOrderItem[] }>(
        `/orders/order/${orderId}/items/`
      );

      if (Array.isArray(response)) {
        return response;
      }

      return response.items || [];
    } catch (error) {
      // If items endpoint doesn't exist, fetch from order detail
      if (error instanceof BricqerApiError && error.statusCode === 404) {
        const order = await this.getOrder(orderId);
        return order.items || [];
      }
      throw error;
    }
  }

  /**
   * Get full order details including items
   * @param orderId The Bricqer order ID
   */
  async getOrderWithItems(
    orderId: string | number
  ): Promise<{ order: BricqerOrderDetail; items: BricqerOrderItem[] }> {
    const order = await this.getOrder(orderId);
    const items = order.items || (await this.getOrderItems(orderId));

    return { order, items };
  }

  /**
   * Get sales orders (convenience method)
   */
  async getSalesOrders(
    status?: BricqerOrderListParams['status'],
    limit?: number
  ): Promise<BricqerOrder[]> {
    return this.getOrders({
      status,
      limit,
      ordering: '-created_at',
    });
  }

  // ============================================
  // Inventory Methods
  // ============================================

  /**
   * Convert inventory params to request params
   */
  private convertInventoryParams(
    params?: BricqerInventoryListParams
  ): Record<string, string | number | boolean | undefined> {
    if (!params) return {};

    const result: Record<string, string | number | boolean | undefined> = {};

    if (params.limit) result.limit = params.limit;
    if (params.offset) result.offset = params.offset;
    if (params.storage) result.storage = params.storage;
    if (params.condition) result.condition = params.condition;
    if (params.search) result.search = params.search;
    if (params.ordering) result.ordering = params.ordering;

    return result;
  }

  /**
   * Get inventory items (paginated)
   */
  async getInventoryItems(
    params?: BricqerInventoryListParams
  ): Promise<BricqerInventoryItem[]> {
    const response = await this.request<
      BricqerPaginatedResponse<BricqerInventoryItem> | BricqerInventoryItem[]
    >('/inventory/item/', {
      params: this.convertInventoryParams(params),
    });

    if (Array.isArray(response)) {
      return response;
    }

    return response.results || [];
  }

  /**
   * Get all inventory items with pagination
   */
  async getAllInventoryItems(
    params?: Omit<BricqerInventoryListParams, 'limit' | 'offset'>,
    options?: { onPage?: (fetched: number, total: number) => void | Promise<void> }
  ): Promise<BricqerInventoryItem[]> {
    const allItems: BricqerInventoryItem[] = [];
    let offset = 0;
    const limit = 100;
    let hasMore = true;
    let totalCount = 0;

    while (hasMore) {
      const response = await this.request<
        BricqerPaginatedResponse<BricqerInventoryItem> | BricqerInventoryItem[]
      >('/inventory/item/', {
        params: this.convertInventoryParams({ ...params, limit, offset }),
      });

      if (Array.isArray(response)) {
        allItems.push(...response);
        hasMore = false;
      } else {
        allItems.push(...(response.results || []));
        totalCount = response.count ?? allItems.length;
        hasMore = response.next !== null;
        offset += limit;
      }

      await options?.onPage?.(allItems.length, totalCount);
    }

    return allItems;
  }

  /**
   * Get a single inventory item by ID
   */
  async getInventoryItem(itemId: number): Promise<BricqerInventoryItem> {
    return this.request<BricqerInventoryItem>(`/inventory/item/${itemId}/`);
  }

  /**
   * Delete an inventory item by ID.
   * Used when removing a sold item from Bricqer inventory.
   */
  async deleteInventoryItem(itemId: number): Promise<void> {
    await this.request<void>(`/inventory/item/${itemId}/`, { method: 'DELETE' });
  }

  /**
   * Get all storage locations
   */
  async getStorageLocations(): Promise<BricqerStorage[]> {
    const response = await this.request<BricqerStorage[] | BricqerPaginatedResponse<BricqerStorage>>(
      '/inventory/storage/'
    );

    if (Array.isArray(response)) {
      return response;
    }

    return response.results || [];
  }

  /**
   * Get all colors
   */
  async getColors(): Promise<BricqerColor[]> {
    const response = await this.request<BricqerColor[] | BricqerPaginatedResponse<BricqerColor>>(
      '/inventory/color/'
    );

    if (Array.isArray(response)) {
      return response;
    }

    return response.results || [];
  }

  /**
   * Get purchase batches
   */
  async getBatches(limit?: number): Promise<BricqerBatch[]> {
    const response = await this.request<BricqerBatch[] | BricqerPaginatedResponse<BricqerBatch>>(
      '/inventory/batch/',
      {
        params: limit ? { limit } : undefined,
      }
    );

    if (Array.isArray(response)) {
      return response;
    }

    return response.results || [];
  }

  /**
   * Get purchases
   */
  async getPurchases(limit?: number): Promise<BricqerPurchase[]> {
    const response = await this.request<BricqerPurchase[] | BricqerPaginatedResponse<BricqerPurchase>>(
      '/inventory/purchase/',
      {
        params: limit ? { limit } : undefined,
      }
    );

    if (Array.isArray(response)) {
      return response;
    }

    return response.results || [];
  }

  /**
   * Get inventory statistics
   *
   * Note: Bricqer API returns pagination info in a nested structure:
   * { page: { count: number, ... }, results: [...] }
   */
  async getInventoryStats(): Promise<{
    totalItems: number;
    totalQuantity: number;
    storageLocations: number;
  }> {
    // Get counts from first page of each endpoint
    const [itemsResponse, storageResponse] = await Promise.all([
      this.request<{ page?: { count: number }; count?: number; results: BricqerInventoryItem[] }>(
        '/inventory/item/',
        { params: { limit: 1 } }
      ),
      this.getStorageLocations(),
    ]);

    // Bricqer API returns count inside page object
    const totalItems = itemsResponse.page?.count ?? itemsResponse.count ?? 0;

    // Note: Total quantity would require fetching all items and summing remainingQuantity
    // For now, we return totalItems as a proxy (each lot counted once)
    return {
      totalItems,
      totalQuantity: totalItems, // Would need full fetch to calculate actual quantity
      storageLocations: storageResponse.length,
    };
  }
}
