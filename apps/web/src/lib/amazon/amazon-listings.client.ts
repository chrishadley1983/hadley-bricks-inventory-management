/**
 * Amazon SP-API Listings Client
 *
 * Client for validating listing changes using the Listings API.
 * Used for dry-run validation before submitting feeds and for
 * verifying updates after feed completion.
 *
 * Endpoints:
 * - PATCH /listings/2021-08-01/items/{sellerId}/{sku} with mode=VALIDATION_PREVIEW
 * - GET /listings/2021-08-01/items/{sellerId}/{sku} for verification
 */

import type { AmazonCredentials } from './types';
import type {
  ListingsFeedPatch,
  ListingsValidationResult,
} from './amazon-sync.types';

// ============================================================================
// CONSTANTS
// ============================================================================

/** EU SP-API endpoint */
const EU_ENDPOINT = 'https://sellingpartnerapi-eu.amazon.com';

/** Listings API version path */
const LISTINGS_API_PATH = '/listings/2021-08-01';

/** LWA token endpoint for OAuth refresh */
const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';

/** Buffer time before token expiry to trigger refresh (5 minutes) */
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/** Delay between API calls for rate limiting */
const API_DELAY_MS = 200;

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

/** Listings API PATCH request body */
export interface ListingsPatchRequest {
  productType: string;
  patches: ListingsFeedPatch[];
}

/** Listings API response */
export interface ListingsItemResponse {
  sku: string;
  status: 'VALID' | 'INVALID' | 'ACCEPTED' | 'WARNING' | 'ERROR';
  submissionId?: string;
  issues?: Array<{
    code: string;
    message: string;
    severity: 'ERROR' | 'WARNING' | 'INFO';
    attributeNames?: string[];
  }>;
  attributes?: Record<string, unknown>;
  summaries?: Array<{
    marketplaceId: string;
    asin?: string;
    productType?: string;
    conditionType?: string;
    status?: string[];
    mainImage?: {
      link: string;
      height: number;
      width: number;
    };
  }>;
  fulfillmentAvailability?: Array<{
    fulfillmentChannelCode: string;
    quantity?: number;
  }>;
  offers?: Array<{
    marketplaceId: string;
    offerType: string;
    price?: {
      currency: string;
      amount: number;
    };
    priceToBeat?: {
      currency: string;
      amount: number;
    };
  }>;
}

// ============================================================================
// CLIENT CLASS
// ============================================================================

/**
 * Amazon SP-API Listings Client
 *
 * Provides methods to validate and retrieve listing information.
 * Uses OAuth 2.0 with LWA token refresh.
 */
export class AmazonListingsClient {
  private credentials: AmazonCredentials;
  private endpoint: string;
  private tokenData: TokenData | null = null;

  constructor(credentials: AmazonCredentials) {
    this.credentials = credentials;
    // Use EU endpoint for EU marketplaces
    this.endpoint = EU_ENDPOINT;
  }

  // ==========================================================================
  // PUBLIC METHODS - VALIDATION
  // ==========================================================================

  /**
   * Validate a listing update without applying it (dry run)
   *
   * @param sku - Seller SKU
   * @param productType - Product type (e.g., BUILDING_BLOCKS)
   * @param patches - Patch operations to validate
   * @param marketplaceId - Target marketplace
   * @returns Validation result
   */
  async validateListing(
    sku: string,
    productType: string,
    patches: ListingsFeedPatch[],
    marketplaceId: string
  ): Promise<ListingsValidationResult> {
    console.log(`[AmazonListingsClient] Validating listing for SKU: ${sku}`);

    const sellerId = this.credentials.sellerId;
    const path = `${LISTINGS_API_PATH}/items/${sellerId}/${encodeURIComponent(sku)}`;
    const queryParams = new URLSearchParams({
      marketplaceIds: marketplaceId,
      mode: 'VALIDATION_PREVIEW',
    });

    const body: ListingsPatchRequest = {
      productType,
      patches,
    };

    try {
      const response = await this.request<ListingsItemResponse>(
        `${path}?${queryParams.toString()}`,
        'PATCH',
        body
      );

      const result: ListingsValidationResult = {
        sku,
        status: response.status === 'VALID' || response.status === 'ACCEPTED' ? 'VALID' : 'INVALID',
        submissionId: response.submissionId,
        issues: response.issues?.map((issue) => ({
          code: issue.code,
          message: issue.message,
          severity: issue.severity,
          attributeNames: issue.attributeNames,
        })),
      };

      console.log(`[AmazonListingsClient] Validation result: ${result.status}`);
      return result;
    } catch (error) {
      // Convert error to validation result
      return {
        sku,
        status: 'INVALID',
        issues: [
          {
            code: 'VALIDATION_ERROR',
            message: error instanceof Error ? error.message : 'Unknown error',
            severity: 'ERROR',
          },
        ],
      };
    }
  }

  /**
   * Validate multiple listings (dry run for batch)
   *
   * @param items - Array of items to validate
   * @param marketplaceId - Target marketplace
   * @returns Array of validation results
   */
  async validateListings(
    items: Array<{
      sku: string;
      productType: string;
      patches: ListingsFeedPatch[];
    }>,
    marketplaceId: string
  ): Promise<ListingsValidationResult[]> {
    console.log(
      `[AmazonListingsClient] Validating ${items.length} listings...`
    );

    const results: ListingsValidationResult[] = [];

    for (const item of items) {
      const result = await this.validateListing(
        item.sku,
        item.productType,
        item.patches,
        marketplaceId
      );
      results.push(result);

      // Small delay between requests
      await this.sleep(API_DELAY_MS);
    }

    const validCount = results.filter((r) => r.status === 'VALID').length;
    console.log(
      `[AmazonListingsClient] Validation complete: ${validCount}/${items.length} valid`
    );

    return results;
  }

  // ==========================================================================
  // PUBLIC METHODS - LISTING RETRIEVAL
  // ==========================================================================

  /**
   * Get listing details for a SKU
   *
   * @param sku - Seller SKU
   * @param marketplaceId - Target marketplace
   * @param includedData - Data to include (summaries, attributes, offers, etc.)
   * @returns Listing details
   */
  async getListing(
    sku: string,
    marketplaceId: string,
    includedData: string[] = ['summaries', 'offers', 'fulfillmentAvailability']
  ): Promise<ListingsItemResponse | null> {
    console.log(`[AmazonListingsClient] Getting listing for SKU: ${sku}`);

    const sellerId = this.credentials.sellerId;
    const path = `${LISTINGS_API_PATH}/items/${sellerId}/${encodeURIComponent(sku)}`;
    const queryParams = new URLSearchParams({
      marketplaceIds: marketplaceId,
      includedData: includedData.join(','),
    });

    try {
      const response = await this.request<ListingsItemResponse>(
        `${path}?${queryParams.toString()}`,
        'GET'
      );
      return response;
    } catch (error) {
      console.warn(`[AmazonListingsClient] Failed to get listing: ${error}`);
      return null;
    }
  }

  /**
   * Verify a listing was updated correctly after feed submission
   *
   * @param sku - Seller SKU
   * @param expectedPrice - Expected price after update
   * @param expectedQuantity - Expected quantity after update
   * @param marketplaceId - Target marketplace
   * @returns true if listing matches expected values
   */
  async verifyListingUpdate(
    sku: string,
    expectedPrice: number,
    expectedQuantity: number,
    marketplaceId: string
  ): Promise<{
    verified: boolean;
    actualPrice?: number;
    actualQuantity?: number;
    message: string;
  }> {
    console.log(`[AmazonListingsClient] Verifying listing update for SKU: ${sku}`);

    const listing = await this.getListing(sku, marketplaceId);

    if (!listing) {
      return {
        verified: false,
        message: 'Listing not found',
      };
    }

    // Extract actual price from offers
    const offer = listing.offers?.find((o) => o.marketplaceId === marketplaceId);
    const actualPrice = offer?.price?.amount;

    // Extract actual quantity from fulfillment availability
    const fulfillment = listing.fulfillmentAvailability?.find(
      (f) => f.fulfillmentChannelCode === 'DEFAULT'
    );
    const actualQuantity = fulfillment?.quantity;

    const priceMatch =
      actualPrice !== undefined &&
      Math.abs(actualPrice - expectedPrice) < 0.01;
    const quantityMatch = actualQuantity === expectedQuantity;

    const verified = priceMatch && quantityMatch;

    return {
      verified,
      actualPrice,
      actualQuantity,
      message: verified
        ? 'Listing verified successfully'
        : `Mismatch: expected price=${expectedPrice}/qty=${expectedQuantity}, got price=${actualPrice}/qty=${actualQuantity}`,
    };
  }

  /**
   * Search for existing listings by ASIN
   *
   * Uses the Catalog Items API to find if the seller has any existing
   * listings for a given ASIN. This helps detect SKUs that were created
   * via the app but not yet in the local cache.
   *
   * @param asin - The ASIN to search for
   * @param marketplaceId - Target marketplace
   * @returns Array of existing SKUs for this ASIN, or empty array if none found
   */
  async findListingsByAsin(
    asin: string,
    marketplaceId: string
  ): Promise<Array<{ sku: string; price?: number; quantity?: number }>> {
    console.log(`[AmazonListingsClient] Searching for existing listings with ASIN: ${asin}`);

    const sellerId = this.credentials.sellerId;

    // Use the Listings Items API search endpoint
    // GET /listings/2021-08-01/items/{sellerId}?marketplaceIds={marketplaceId}&identifiersType=ASIN&identifiers={asin}
    const path = `${LISTINGS_API_PATH}/items/${sellerId}`;
    const queryParams = new URLSearchParams({
      marketplaceIds: marketplaceId,
      identifiersType: 'ASIN',
      identifiers: asin,
      includedData: 'offers,fulfillmentAvailability,summaries',
      pageSize: '10',
    });

    try {
      const response = await this.request<{
        items?: ListingsItemResponse[];
        pagination?: { nextToken?: string };
      }>(`${path}?${queryParams.toString()}`, 'GET');

      if (!response.items || response.items.length === 0) {
        console.log(`[AmazonListingsClient] No existing listings found for ASIN: ${asin}`);
        return [];
      }

      console.log(`[AmazonListingsClient] Found ${response.items.length} existing listing(s) for ASIN: ${asin}`);

      // Extract SKU, price, and quantity from each listing
      const results = response.items.map((item) => {
        const offer = item.offers?.find((o) => o.marketplaceId === marketplaceId);
        const fulfillment = item.fulfillmentAvailability?.find(
          (f) => f.fulfillmentChannelCode === 'DEFAULT'
        );

        return {
          sku: item.sku,
          price: offer?.price?.amount,
          quantity: fulfillment?.quantity,
        };
      });

      console.log(`[AmazonListingsClient] Existing listings:`, results);
      return results;
    } catch (error) {
      console.warn(`[AmazonListingsClient] Failed to search listings by ASIN: ${error}`);
      // Return empty array on error - caller will handle as "no existing listings"
      return [];
    }
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
      console.error('[AmazonListingsClient] Connection test failed:', error);
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
    method: 'GET' | 'PATCH',
    body?: unknown
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

    if (body && method === 'PATCH') {
      options.body = JSON.stringify(body);
    }

    // Rate limiting delay
    await this.sleep(API_DELAY_MS);

    const response = await fetch(url, options);

    // Handle rate limiting
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : 60000;
      console.warn(
        `[AmazonListingsClient] Rate limited, waiting ${waitTime / 1000}s...`
      );
      await this.sleep(waitTime);
      return this.request<T>(path, method, body);
    }

    // Handle auth errors
    if (response.status === 401 || response.status === 403) {
      this.tokenData = null;
      throw new Error('Invalid or expired access token');
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
    if (
      this.tokenData &&
      this.tokenData.expiresAt.getTime() > Date.now() + TOKEN_REFRESH_BUFFER_MS
    ) {
      return this.tokenData.accessToken;
    }

    console.log('[AmazonListingsClient] Refreshing access token...');

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
      console.error('[AmazonListingsClient] Token refresh failed:', errorText);
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
 * Factory function to create an Amazon Listings client
 */
export function createAmazonListingsClient(
  credentials: AmazonCredentials
): AmazonListingsClient {
  return new AmazonListingsClient(credentials);
}
