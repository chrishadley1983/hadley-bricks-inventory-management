/**
 * Amazon SP-API Product Pricing Client
 *
 * Client for fetching competitive pricing data from Amazon's Product Pricing API.
 * Used for arbitrage tracking to get your price, buy box price, and offer counts.
 *
 * API Version: 2022-05-01
 * Documentation: https://developer-docs.amazon.com/sp-api/docs/product-pricing-api-v2022-05-01-reference
 */

import type { AmazonCredentials } from './types';

// ============================================================================
// CONSTANTS
// ============================================================================

/** EU SP-API endpoint */
const EU_ENDPOINT = 'https://sellingpartnerapi-eu.amazon.com';

/** Product Pricing API v0 path (more widely accessible than v2022-05-01 batch API) */
const PRICING_API_V0_PATH = '/products/pricing/v0';

/** LWA token endpoint for OAuth refresh */
const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';

/** Buffer time before token expiry to trigger refresh (5 minutes) */
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/** Delay between API calls for rate limiting */
const API_DELAY_MS = 200;

/** Maximum ASINs per batch request */
const MAX_BATCH_SIZE = 20;

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

/** Money amount */
interface MoneyType {
  currencyCode: string;
  amount: number;
}

/** Sales rank in response */
interface SalesRank {
  productCategoryId: string;
  rank: number;
}

/** Competitive price entry */
interface CompetitivePrice {
  competitivePriceId: string;
  price: {
    listingPrice: MoneyType;
    shippingPrice?: MoneyType;
    landedPrice?: MoneyType;
  };
  condition?: string;
  subcondition?: string;
  offerType?: string;
  quantityTier?: number;
  quantityDiscountType?: string;
  sellerId?: string;
  belongsToRequester?: boolean;
}

/** Number of offers by condition */
interface NumberOfOffers {
  condition: string;
  fulfillmentChannel: string;
  offerCount: number;
}

/** Featured offer (Buy Box) */
interface FeaturedOffer {
  offerType: string;
  price: {
    listingPrice: MoneyType;
    shippingPrice?: MoneyType;
    points?: {
      pointsNumber: number;
    };
  };
  condition?: string;
  featuredOfferExpectedPrice?: MoneyType;
}

/** Competitive pricing response for a single ASIN */
interface CompetitivePricingResponse {
  asin: string;
  marketplaceId: string;
  status: string;
  competitivePrices?: CompetitivePrice[];
  numberOfOffers?: NumberOfOffers[];
  salesRanks?: SalesRank[];
}

/** Featured offer eligibility response */
interface FeaturedOfferExpectedPriceResponse {
  asin: string;
  marketplaceId: string;
  sku: string;
  status: string;
  featuredOfferExpectedPriceResults?: Array<{
    featuredOfferExpectedPrice?: MoneyType;
    resultStatus: string;
    competingFeaturedOffer?: FeaturedOffer;
    currentFeaturedOffer?: FeaturedOffer;
  }>;
}

/** Batch request item */
interface BatchRequestItem {
  uri: string;
  method: 'GET';
  marketplaceId?: string;
}

/** Batch response wrapper */
interface BatchResponse<T> {
  responses: Array<{
    status: {
      statusCode: number;
      reasonPhrase?: string;
    };
    body: T;
  }>;
}

// ============================================================================
// V0 API TYPES
// ============================================================================

/** V0 API competitive pricing product */
interface CompetitivePricingV0Product {
  ASIN: string;
  status: string;
  Product?: {
    Identifiers: {
      MarketplaceASIN: {
        MarketplaceId: string;
        ASIN: string;
      };
    };
    CompetitivePricing?: {
      CompetitivePrices?: Array<{
        CompetitivePriceId: string;
        Price: {
          LandedPrice?: {
            CurrencyCode: string;
            Amount: number;
          };
          ListingPrice: {
            CurrencyCode: string;
            Amount: number;
          };
          Shipping?: {
            CurrencyCode: string;
            Amount: number;
          };
        };
        condition?: string;
        subcondition?: string;
        belongsToRequester?: boolean;
      }>;
      NumberOfOfferListings?: Array<{
        condition: string;
        Count: number;
      }>;
    };
    SalesRankings?: Array<{
      ProductCategoryId: string;
      Rank: number;
    }>;
  };
}

/** V0 API response wrapper */
interface CompetitivePricingV0Response {
  payload: CompetitivePricingV0Product[];
}

/** Normalized pricing data returned by this client */
export interface AsinPricingData {
  asin: string;
  /** Your current listing price (if you have a listing) */
  yourPrice: number | null;
  /** Buy Box price */
  buyBoxPrice: number | null;
  /** Whether you currently own the Buy Box */
  buyBoxIsYours: boolean;
  /** Number of new offers */
  newOfferCount: number | null;
  /** Number of used offers */
  usedOfferCount: number | null;
  /** Primary sales rank */
  salesRank: number | null;
  /** Sales rank category */
  salesRankCategory: string | null;
  /** Currency code */
  currency: string;
}

// ============================================================================
// CLIENT CLASS
// ============================================================================

/**
 * Amazon SP-API Product Pricing Client
 *
 * Provides methods to fetch competitive pricing data including:
 * - Competitive prices for ASINs
 * - Featured offer (Buy Box) information
 * - Offer counts by condition
 * - Sales rankings
 */
export class AmazonPricingClient {
  private credentials: AmazonCredentials;
  private endpoint: string;
  private tokenData: TokenData | null = null;

  constructor(credentials: AmazonCredentials) {
    this.credentials = credentials;
    this.endpoint = EU_ENDPOINT;
  }

  // ==========================================================================
  // PUBLIC METHODS
  // ==========================================================================

  /**
   * Get competitive pricing for a batch of ASINs
   * Uses Product Pricing API v0 - the standard endpoint
   *
   * @param asins - Array of ASINs (max 20 per batch)
   * @param marketplaceId - Target marketplace (default UK)
   * @returns Array of pricing data for each ASIN
   */
  async getCompetitivePricing(
    asins: string[],
    marketplaceId: string = 'A1F83G8C2ARO7P'
  ): Promise<AsinPricingData[]> {
    if (asins.length === 0) {
      return [];
    }

    if (asins.length > MAX_BATCH_SIZE) {
      // Process in batches
      const results: AsinPricingData[] = [];
      for (let i = 0; i < asins.length; i += MAX_BATCH_SIZE) {
        const batch = asins.slice(i, i + MAX_BATCH_SIZE);
        const batchResults = await this.getCompetitivePricing(batch, marketplaceId);
        results.push(...batchResults);

        // Rate limit between batches
        if (i + MAX_BATCH_SIZE < asins.length) {
          await this.sleep(API_DELAY_MS);
        }
      }
      return results;
    }

    console.log(`[AmazonPricingClient] Fetching competitive pricing for ${asins.length} ASINs`);

    // Build query parameters for v0 API
    // The v0 API accepts Asins as comma-separated list
    const queryParams = new URLSearchParams();
    queryParams.append('MarketplaceId', marketplaceId);
    queryParams.append('ItemType', 'Asin');
    queryParams.append('Asins', asins.join(','));

    const url = `${PRICING_API_V0_PATH}/competitivePrice?${queryParams.toString()}`;
    console.log(`[AmazonPricingClient] Request URL: ${url}`);

    try {
      const response = await this.request<CompetitivePricingV0Response>(
        url,
        'GET'
      );

      console.log(`[AmazonPricingClient] Response payload count: ${response.payload?.length ?? 0}`);

      // Debug: log first item structure
      if (response.payload && response.payload.length > 0) {
        console.log(`[AmazonPricingClient] Sample response item:`, JSON.stringify(response.payload[0], null, 2));
      }

      // The v0 API returns payload as an array
      return (response.payload ?? []).map((item) => this.normalizeCompetitivePricingV0(item));
    } catch (error) {
      console.error('[AmazonPricingClient] Error fetching competitive pricing:', error);
      throw error;
    }
  }

  /**
   * Get pricing for a single ASIN
   *
   * @param asin - ASIN to look up
   * @param marketplaceId - Target marketplace (default UK)
   * @returns Pricing data
   */
  async getAsinPricing(
    asin: string,
    marketplaceId: string = 'A1F83G8C2ARO7P'
  ): Promise<AsinPricingData> {
    const results = await this.getCompetitivePricing([asin], marketplaceId);
    if (results.length === 0) {
      throw new Error(`No pricing data found for ASIN: ${asin}`);
    }
    return results[0];
  }

  /**
   * Get featured offer (Buy Box) expected price for your listings
   * Note: This uses the v2022-05-01 batch API which requires special roles.
   * Use getCompetitivePricing instead for basic pricing data.
   *
   * @param skus - Array of {asin, sku} pairs
   * @param marketplaceId - Target marketplace
   * @returns Featured offer data
   */
  async getFeaturedOfferExpectedPrice(
    skus: Array<{ asin: string; sku: string }>,
    marketplaceId: string = 'A1F83G8C2ARO7P'
  ): Promise<FeaturedOfferExpectedPriceResponse[]> {
    if (skus.length === 0) {
      return [];
    }

    console.log(`[AmazonPricingClient] Fetching featured offer prices for ${skus.length} SKUs`);

    const requests: BatchRequestItem[] = skus.map(({ sku }) => ({
      uri: `/products/pricing/2022-05-01/offer/featuredOfferExpectedPrice?marketplaceId=${marketplaceId}&sku=${encodeURIComponent(sku)}`,
      method: 'GET' as const,
      marketplaceId,
    }));

    try {
      // Note: This endpoint requires special roles and may not be accessible
      const response = await this.request<BatchResponse<FeaturedOfferExpectedPriceResponse>>(
        '/products/pricing/2022-05-01/offer/featuredOfferExpectedPrice',
        'POST',
        { requests }
      );

      return response.responses
        .filter((r) => r.status.statusCode === 200)
        .map((r) => r.body);
    } catch (error) {
      console.error('[AmazonPricingClient] Error fetching featured offer prices:', error);
      throw error;
    }
  }

  /**
   * Test connection
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.getAccessToken();
      return true;
    } catch (error) {
      console.error('[AmazonPricingClient] Connection test failed:', error);
      return false;
    }
  }

  // ==========================================================================
  // PRIVATE METHODS - DATA TRANSFORMATION
  // ==========================================================================

  /**
   * Normalize competitive pricing response into our standard format
   */
  private normalizeCompetitivePricing(data: CompetitivePricingResponse): AsinPricingData {
    // Find your price (belongsToRequester = true)
    const yourOffer = data.competitivePrices?.find((p) => p.belongsToRequester === true);
    const yourPrice = yourOffer?.price?.landedPrice?.amount ?? yourOffer?.price?.listingPrice?.amount ?? null;

    // Find Buy Box price (competitivePriceId = "1" is typically the Buy Box)
    const buyBoxOffer = data.competitivePrices?.find((p) => p.competitivePriceId === '1');
    const buyBoxPrice = buyBoxOffer?.price?.landedPrice?.amount ?? buyBoxOffer?.price?.listingPrice?.amount ?? null;

    // Check if we own the Buy Box
    const buyBoxIsYours = buyBoxOffer?.belongsToRequester ?? false;

    // Count offers by condition
    const newOffers = data.numberOfOffers?.find(
      (o) => o.condition === 'New' || o.condition === 'new'
    );
    const usedOffers = data.numberOfOffers?.find(
      (o) => o.condition === 'Used' || o.condition === 'used'
    );

    // Get primary sales rank
    const primaryRank = data.salesRanks?.[0];

    // Get currency from any price we found
    const currency = yourOffer?.price?.listingPrice?.currencyCode ??
      buyBoxOffer?.price?.listingPrice?.currencyCode ??
      'GBP';

    return {
      asin: data.asin,
      yourPrice,
      buyBoxPrice,
      buyBoxIsYours,
      newOfferCount: newOffers?.offerCount ?? null,
      usedOfferCount: usedOffers?.offerCount ?? null,
      salesRank: primaryRank?.rank ?? null,
      salesRankCategory: primaryRank?.productCategoryId ?? null,
      currency,
    };
  }

  /**
   * Normalize V0 API competitive pricing response into our standard format
   */
  private normalizeCompetitivePricingV0(data: CompetitivePricingV0Product): AsinPricingData {
    const product = data.Product;
    const competitivePricing = product?.CompetitivePricing;
    const competitivePrices = competitivePricing?.CompetitivePrices ?? [];
    const offerListings = competitivePricing?.NumberOfOfferListings ?? [];
    const salesRankings = product?.SalesRankings ?? [];

    // Find your price (belongsToRequester = true)
    const yourOffer = competitivePrices.find((p) => p.belongsToRequester === true);
    const yourPrice = yourOffer?.Price?.LandedPrice?.Amount ?? yourOffer?.Price?.ListingPrice?.Amount ?? null;

    // Find Buy Box price (CompetitivePriceId = "1" is typically the Buy Box)
    const buyBoxOffer = competitivePrices.find((p) => p.CompetitivePriceId === '1');
    const buyBoxPrice = buyBoxOffer?.Price?.LandedPrice?.Amount ?? buyBoxOffer?.Price?.ListingPrice?.Amount ?? null;

    // Check if we own the Buy Box
    const buyBoxIsYours = buyBoxOffer?.belongsToRequester ?? false;

    // Count offers by condition - use Count field (not Value)
    const newOffers = offerListings.find(
      (o) => o.condition.toLowerCase() === 'new'
    );
    const usedOffers = offerListings.find(
      (o) => o.condition.toLowerCase() === 'used'
    );

    // Get primary sales rank (first one is usually the main category)
    const primaryRank = salesRankings[0];

    // Get currency from any price we found
    const currency = yourOffer?.Price?.ListingPrice?.CurrencyCode ??
      buyBoxOffer?.Price?.ListingPrice?.CurrencyCode ??
      'GBP';

    return {
      asin: data.ASIN,
      yourPrice,
      buyBoxPrice,
      buyBoxIsYours,
      newOfferCount: newOffers?.Count ?? null,
      usedOfferCount: usedOffers?.Count ?? null,
      salesRank: primaryRank?.Rank ?? null,
      salesRankCategory: primaryRank?.ProductCategoryId ?? null,
      currency,
    };
  }

  // ==========================================================================
  // PRIVATE METHODS - HTTP
  // ==========================================================================

  /**
   * Make an authenticated request to the SP-API
   */
  private async request<T>(
    path: string,
    method: 'GET' | 'POST',
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

    if (body && method === 'POST') {
      options.body = JSON.stringify(body);
    }

    // Rate limiting delay
    await this.sleep(API_DELAY_MS);

    const response = await fetch(url, options);

    // Handle rate limiting
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : 60000;
      console.warn(`[AmazonPricingClient] Rate limited, waiting ${waitTime / 1000}s...`);
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
        const errorData = (await response.json()) as { errors?: AmazonApiError[] };
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

    console.log('[AmazonPricingClient] Refreshing access token...');

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
      console.error('[AmazonPricingClient] Token refresh failed:', errorText);
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
 * Factory function to create an Amazon Pricing client
 */
export function createAmazonPricingClient(
  credentials: AmazonCredentials
): AmazonPricingClient {
  return new AmazonPricingClient(credentials);
}
