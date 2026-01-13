/**
 * eBay Browse API Client
 *
 * Client for accessing eBay's Browse API using application tokens (client credentials grant).
 * Used for searching LEGO sets and retrieving pricing data for arbitrage tracking.
 */

const EBAY_TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const EBAY_BROWSE_API_BASE = 'https://api.ebay.com/buy/browse/v1';
const BROWSE_API_SCOPE = 'https://api.ebay.com/oauth/api_scope';

// Token cache
let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * eBay Browse API response types
 */
export interface EbayItemSummary {
  itemId: string;
  title: string;
  price?: {
    value: string;
    currency: string;
  };
  condition?: string;
  conditionId?: string;
  itemWebUrl?: string;
  image?: {
    imageUrl: string;
  };
  seller?: {
    username: string;
    feedbackPercentage: string;
    feedbackScore: number;
  };
  shippingOptions?: Array<{
    shippingCost?: {
      value: string;
      currency: string;
    };
    type: string;
  }>;
  itemLocation?: {
    country: string;
    postalCode?: string;
  };
}

export interface EbaySearchResponse {
  href: string;
  total: number;
  limit: number;
  offset: number;
  itemSummaries?: EbayItemSummary[];
}

export interface EbaySearchOptions {
  /** Category ID (19006 for LEGO Complete Sets & Packs) */
  categoryId?: string;
  /** Filter string (e.g., 'conditions:{NEW},buyingOptions:{FIXED_PRICE},itemLocationCountry:GB') */
  filter?: string;
  /** Sort order (e.g., 'price') */
  sort?: string;
  /** Max results (1-200) */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

/**
 * eBay Browse API client for application-level access
 */
export class EbayBrowseClient {
  private clientId: string;
  private clientSecret: string;

  constructor() {
    const clientId = process.env.EBAY_CLIENT_ID;
    const clientSecret = process.env.EBAY_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET environment variables');
    }

    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  /**
   * Get an application access token using client credentials grant.
   * Tokens are cached and reused until near expiry.
   */
  async getApplicationToken(): Promise<string> {
    // Check if we have a valid cached token (with 5 minute buffer)
    if (cachedToken && cachedToken.expiresAt > Date.now() + 5 * 60 * 1000) {
      return cachedToken.token;
    }

    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

    const response = await fetch(EBAY_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: BROWSE_API_SCOPE,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get eBay application token: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const expiresInMs = (data.expires_in || 7200) * 1000; // Default 2 hours

    // Cache the token
    cachedToken = {
      token: data.access_token,
      expiresAt: Date.now() + expiresInMs,
    };

    return data.access_token;
  }

  /**
   * Search for items using the Browse API
   */
  async searchItems(query: string, options: EbaySearchOptions = {}): Promise<EbaySearchResponse> {
    const token = await this.getApplicationToken();

    const url = new URL(`${EBAY_BROWSE_API_BASE}/item_summary/search`);
    url.searchParams.set('q', query);

    if (options.categoryId) {
      url.searchParams.set('category_ids', options.categoryId);
    }
    if (options.filter) {
      url.searchParams.set('filter', options.filter);
    }
    if (options.sort) {
      url.searchParams.set('sort', options.sort);
    }
    if (options.limit) {
      url.searchParams.set('limit', String(Math.min(options.limit, 200)));
    }
    if (options.offset) {
      url.searchParams.set('offset', String(options.offset));
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`eBay Browse API search failed: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  /**
   * Search for LEGO sets with default filters for arbitrage tracking.
   * Searches category 19006 (LEGO Complete Sets & Packs), New condition,
   * Buy It Now only, UK sellers, sorted by price ascending.
   */
  async searchLegoSet(setNumber: string, limit: number = 50): Promise<EbaySearchResponse> {
    // Strip -1 suffix if present (e.g., 40585-1 -> 40585)
    const cleanSetNumber = setNumber.replace(/-\d+$/, '');

    return this.searchItems(`LEGO ${cleanSetNumber}`, {
      categoryId: '19006',
      filter: 'conditions:{NEW},buyingOptions:{FIXED_PRICE},itemLocationCountry:GB',
      sort: 'price',
      limit,
    });
  }

  /**
   * Search for USED LEGO sets.
   * Searches category 19006 (LEGO Complete Sets & Packs), Used condition,
   * Buy It Now only, UK sellers, sorted by price ascending.
   */
  async searchLegoSetUsed(setNumber: string, limit: number = 50): Promise<EbaySearchResponse> {
    // Strip -1 suffix if present (e.g., 40585-1 -> 40585)
    const cleanSetNumber = setNumber.replace(/-\d+$/, '');

    // eBay condition IDs: 3000 = Used, 1500 = Open box, 2500 = Seller refurbished
    // Using USED filter which covers various used conditions
    return this.searchItems(`LEGO ${cleanSetNumber}`, {
      categoryId: '19006',
      filter: 'conditions:{USED},buyingOptions:{FIXED_PRICE},itemLocationCountry:GB',
      sort: 'price',
      limit,
    });
  }

  /**
   * Get a specific item by ID
   */
  async getItem(itemId: string): Promise<unknown> {
    const token = await this.getApplicationToken();
    const url = `${EBAY_BROWSE_API_BASE}/item/${encodeURIComponent(itemId)}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`eBay Browse API get item failed: ${response.status} - ${errorText}`);
    }

    return response.json();
  }
}

// Singleton instance for convenience
let clientInstance: EbayBrowseClient | null = null;

/**
 * Get the singleton eBay Browse client instance
 */
export function getEbayBrowseClient(): EbayBrowseClient {
  if (!clientInstance) {
    clientInstance = new EbayBrowseClient();
  }
  return clientInstance;
}

/**
 * Clear the token cache (useful for testing or when credentials change)
 */
export function clearTokenCache(): void {
  cachedToken = null;
}
