import type { ShopifyConfig, ShopifyProductPayload, ShopifyProductResponse } from './types';

class RetryableError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = 'RetryableError';
  }
}

class ShopifyValidationError extends Error {
  constructor(
    message: string,
    public details: unknown
  ) {
    super(message);
    this.name = 'ShopifyValidationError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Shopify Admin API client with OAuth client_credentials token refresh
 * and bucket-based rate limiting.
 *
 * Since Jan 2026, Shopify custom apps use client_credentials grant
 * with 24-hour rotating access tokens.
 */
export class ShopifyClient {
  private shopDomain: string;
  private clientId: string;
  private clientSecret: string;
  private apiVersion: string;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  private bucket = 40;

  constructor(config: ShopifyConfig) {
    this.shopDomain = config.shop_domain;
    this.clientId = config.client_id;
    this.clientSecret = config.client_secret;
    this.apiVersion = config.api_version;
  }

  /** Exchange client credentials for an access token (cached with 5min buffer) */
  private async getToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 300_000) {
      return this.accessToken;
    }

    const res = await fetch(
      `https://${this.shopDomain}/admin/oauth/access_token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.clientId,
          client_secret: this.clientSecret,
        }),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Token exchange failed (${res.status}): ${text}`);
    }

    const data = await res.json();
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;
    return this.accessToken!;
  }

  /** Make an authenticated request to the Shopify Admin API */
  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    attempt = 1
  ): Promise<T> {
    const token = await this.getToken();
    await this.waitForBucket();

    const url = `https://${this.shopDomain}/admin/api/${this.apiVersion}${path}`;
    const response = await fetch(url, {
      method,
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    // Update bucket from rate limit header
    const callLimit = response.headers.get('X-Shopify-Shop-Api-Call-Limit');
    if (callLimit) {
      const [used, max] = callLimit.split('/').map(Number);
      this.bucket = max - used;
    }

    // Rate limited — wait and retry
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After') || '2';
      console.warn(`[ShopifyClient] Rate limited, retrying after ${retryAfter}s`);
      await sleep(parseFloat(retryAfter) * 1000);
      return this.request<T>(method, path, body, attempt);
    }

    // Server error — retry with backoff (max 3 attempts)
    if (response.status >= 500) {
      if (attempt < 3) {
        const delay = Math.pow(2, attempt) * 1000;
        console.warn(
          `[ShopifyClient] Server error ${response.status}, retry ${attempt}/3 after ${delay}ms`
        );
        await sleep(delay);
        return this.request<T>(method, path, body, attempt + 1);
      }
      throw new RetryableError(
        `Shopify server error after ${attempt} attempts`,
        response.status
      );
    }

    // Validation error — don't retry
    if (response.status === 422) {
      const error = await response.json();
      throw new ShopifyValidationError(
        `Shopify validation error: ${JSON.stringify(error)}`,
        error
      );
    }

    // Not found
    if (response.status === 404) {
      throw new Error(`Shopify resource not found: ${path}`);
    }

    // No content (e.g. DELETE)
    if (response.status === 204 || response.status === 200 && response.headers.get('content-length') === '0') {
      return {} as T;
    }

    return response.json() as Promise<T>;
  }

  /** Wait for rate limit bucket to have capacity */
  private async waitForBucket(): Promise<void> {
    if (this.bucket <= 2) {
      await sleep(1000);
      this.bucket += 2;
    }
    this.bucket--;
  }

  // ── Product Operations ──────────────────────────────────────

  async createProduct(payload: ShopifyProductPayload): Promise<ShopifyProductResponse> {
    return this.request<ShopifyProductResponse>('POST', '/products.json', payload);
  }

  async updateProduct(
    productId: string,
    payload: Partial<ShopifyProductPayload['product']>
  ): Promise<ShopifyProductResponse> {
    return this.request<ShopifyProductResponse>(
      'PUT',
      `/products/${productId}.json`,
      { product: payload }
    );
  }

  async archiveProduct(productId: string): Promise<ShopifyProductResponse> {
    return this.updateProduct(productId, { status: 'archived' });
  }

  async deleteProduct(productId: string): Promise<void> {
    await this.request('DELETE', `/products/${productId}.json`);
  }

  async getProduct(productId: string): Promise<ShopifyProductResponse> {
    return this.request<ShopifyProductResponse>('GET', `/products/${productId}.json`);
  }

  // ── Variant Operations ──────────────────────────────────────

  async updateVariant(
    variantId: string,
    data: { price?: string; compare_at_price?: string; sku?: string }
  ): Promise<unknown> {
    return this.request('PUT', `/variants/${variantId}.json`, { variant: data });
  }

  // ── Inventory Operations ────────────────────────────────────

  async setInventoryLevel(
    inventoryItemId: string,
    locationId: string,
    quantity: number
  ): Promise<unknown> {
    return this.request('POST', '/inventory_levels/set.json', {
      location_id: locationId,
      inventory_item_id: inventoryItemId,
      available: quantity,
    });
  }

  async getLocations(): Promise<{ locations: Array<{ id: number; name: string }> }> {
    return this.request('GET', '/locations.json');
  }

  // ── GraphQL ───────────────────────────────────────────────

  /** Make an authenticated GraphQL request to the Shopify Admin API */
  async graphql<T = unknown>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<T> {
    const token = await this.getToken();
    await this.waitForBucket();

    const url = `https://${this.shopDomain}/admin/api/${this.apiVersion}/graphql.json`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After') || '2';
      console.warn(`[ShopifyClient] GraphQL rate limited, retrying after ${retryAfter}s`);
      await sleep(parseFloat(retryAfter) * 1000);
      return this.graphql<T>(query, variables);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Shopify GraphQL error (${response.status}): ${text}`);
    }

    const json = await response.json();
    if (json.errors?.length) {
      throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
    }

    return json.data as T;
  }
}
