/**
 * Amazon SP-API Catalog Items Client
 *
 * Client for fetching product information from Amazon's Catalog Items API.
 * Used to look up product types for ASINs before submitting listing feeds.
 *
 * API Version: 2022-04-01
 * Documentation: https://developer-docs.amazon.com/sp-api/docs/catalog-items-api-v2022-04-01-reference
 */

import type { AmazonCredentials } from './types';

// ============================================================================
// CONSTANTS
// ============================================================================

/** EU SP-API endpoint */
const EU_ENDPOINT = 'https://sellingpartnerapi-eu.amazon.com';

/** Catalog Items API version path */
const CATALOG_API_PATH = '/catalog/2022-04-01';

/** LWA token endpoint for OAuth refresh */
const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';

/** Buffer time before token expiry to trigger refresh (5 minutes) */
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/** Delay between API calls for rate limiting */
const API_DELAY_MS = 200;

/** Maximum retries for rate-limited requests */
const MAX_RETRIES = 3;

// ============================================================================
// TYPES
// ============================================================================

/** Token data for auth management */
interface TokenData {
  accessToken: string;
  expiresAt: Date;
}

/** Error response from API */
interface AmazonApiError {
  code: string;
  message: string;
  details?: string;
}

/** Catalog Item Response from API */
export interface CatalogItemResponse {
  asin: string;
  summaries?: Array<{
    marketplaceId: string;
    brandName?: string;
    brand?: string;
    itemName?: string;
  }>;
  /** Product types - separate from summaries, requires includedData=productTypes */
  productTypes?: Array<{
    marketplaceId: string;
    productType: string;
  }>;
}

/** Result of product type lookup */
export interface ProductTypeResult {
  asin: string;
  productType: string | null;
  title: string | null;
  brand: string | null;
  raw: CatalogItemResponse;
}

// ============================================================================
// CLIENT CLASS
// ============================================================================

/**
 * Amazon SP-API Catalog Items Client
 *
 * Provides methods to fetch product information including product types
 * from Amazon's Catalog Items API. Uses OAuth 2.0 with LWA token refresh.
 */
export class AmazonCatalogClient {
  private credentials: AmazonCredentials;
  private endpoint: string;
  private tokenData: TokenData | null = null;

  constructor(credentials: AmazonCredentials) {
    this.credentials = credentials;
    // Use EU endpoint for EU marketplaces (UK, DE, FR, IT, ES)
    this.endpoint = EU_ENDPOINT;
  }

  // ==========================================================================
  // PUBLIC METHODS
  // ==========================================================================

  /**
   * Get catalog item by ASIN
   *
   * Fetches product information including product type from the Catalog Items API.
   *
   * @param asin - The ASIN to look up
   * @param marketplaceId - Target marketplace (default UK: A1F83G8C2ARO7P)
   * @returns Product type and metadata
   */
  async getCatalogItem(
    asin: string,
    marketplaceId: string = 'A1F83G8C2ARO7P'
  ): Promise<ProductTypeResult> {
    console.log(`[AmazonCatalogClient] Looking up ASIN: ${asin}`);

    // Request summaries AND productTypes - productTypes is a separate includedData option
    const includedData = 'summaries,productTypes';

    const response = await this.request<CatalogItemResponse>(
      `${CATALOG_API_PATH}/items/${asin}?marketplaceIds=${marketplaceId}&includedData=${includedData}`,
      'GET'
    );

    // Extract data from the summary for the requested marketplace
    const summary = response.summaries?.find(
      (s) => s.marketplaceId === marketplaceId
    );

    // Product types are at the top level, not inside summaries
    const productTypeEntry = response.productTypes?.find(
      (pt) => pt.marketplaceId === marketplaceId
    );

    // Get the product type from the productTypes array
    const productType = productTypeEntry?.productType ?? null;
    const title = summary?.itemName ?? null;
    const brand = summary?.brand ?? summary?.brandName ?? null;

    console.log(
      `[AmazonCatalogClient] Found product type: ${productType ?? 'none'} for ASIN ${asin}`
    );

    return {
      asin,
      productType,
      title,
      brand,
      raw: response,
    };
  }

  /**
   * Test connection by attempting to get access token
   *
   * @returns true if connection is successful
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.getAccessToken();
      return true;
    } catch (error) {
      console.error('[AmazonCatalogClient] Connection test failed:', error);
      return false;
    }
  }

  // ==========================================================================
  // PRIVATE METHODS - HTTP
  // ==========================================================================

  /**
   * Make an authenticated request to the SP-API
   */
  private async request<T>(
    path: string,
    method: 'GET',
    retryCount: number = 0
  ): Promise<T> {
    const accessToken = await this.getAccessToken();

    const url = `${this.endpoint}${path}`;
    const headers: Record<string, string> = {
      'x-amz-access-token': accessToken,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    const options: RequestInit = {
      method,
      headers,
    };

    // Rate limiting delay
    await this.sleep(API_DELAY_MS);

    const response = await fetch(url, options);

    // Handle rate limiting with retry
    if (response.status === 429) {
      if (retryCount >= MAX_RETRIES) {
        throw new Error('Rate limit exceeded after maximum retries');
      }

      const retryAfter = response.headers.get('Retry-After');
      const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : 60000;
      console.warn(
        `[AmazonCatalogClient] Rate limited, waiting ${waitTime / 1000}s (retry ${retryCount + 1}/${MAX_RETRIES})...`
      );
      await this.sleep(waitTime);
      return this.request<T>(path, method, retryCount + 1);
    }

    // Handle auth errors
    if (response.status === 401 || response.status === 403) {
      this.tokenData = null; // Clear token to force refresh

      // Retry once after clearing token
      if (retryCount === 0) {
        console.warn(
          '[AmazonCatalogClient] Auth error, refreshing token and retrying...'
        );
        return this.request<T>(path, method, 1);
      }

      throw new Error('Invalid or expired access token');
    }

    // Handle 404 - ASIN not found
    if (response.status === 404) {
      throw new Error(`ASIN not found in Amazon catalog: ${path.split('/').pop()?.split('?')[0]}`);
    }

    if (!response.ok) {
      let errorMessage = `Request failed with status ${response.status}`;
      try {
        const errorData = (await response.json()) as {
          errors?: AmazonApiError[];
        };
        if (errorData.errors && errorData.errors.length > 0) {
          errorMessage = errorData.errors.map((e) => e.message).join('; ');
        }
      } catch {
        // Ignore JSON parse errors
      }
      throw new Error(errorMessage);
    }

    return response.json() as Promise<T>;
  }

  // ==========================================================================
  // PRIVATE METHODS - AUTH
  // ==========================================================================

  /**
   * Get or refresh the access token
   */
  private async getAccessToken(): Promise<string> {
    // Check if we have a valid token
    if (
      this.tokenData &&
      this.tokenData.expiresAt.getTime() > Date.now() + TOKEN_REFRESH_BUFFER_MS
    ) {
      return this.tokenData.accessToken;
    }

    console.log('[AmazonCatalogClient] Refreshing access token...');

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
      console.error('[AmazonCatalogClient] Token refresh failed:', errorText);
      throw new Error(`Failed to refresh token: ${response.status}`);
    }

    const tokenData = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };

    this.tokenData = {
      accessToken: tokenData.access_token,
      expiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
    };

    console.log(
      '[AmazonCatalogClient] Token refreshed, expires at:',
      this.tokenData.expiresAt
    );

    return this.tokenData.accessToken;
  }

  // ==========================================================================
  // PRIVATE METHODS - UTILITIES
  // ==========================================================================

  /**
   * Sleep for a given duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Factory function to create an Amazon Catalog client
 */
export function createAmazonCatalogClient(
  credentials: AmazonCredentials
): AmazonCatalogClient {
  return new AmazonCatalogClient(credentials);
}
