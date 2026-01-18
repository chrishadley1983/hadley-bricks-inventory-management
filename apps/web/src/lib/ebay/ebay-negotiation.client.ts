/**
 * eBay Negotiation API Client
 *
 * Handles communication with eBay's Sell Negotiation API (REST).
 * Used for sending offers to interested buyers (watchers and cart abandoners).
 *
 * @see https://developer.ebay.com/api-docs/sell/negotiation/overview.html
 */

import type {
  EbayEligibleItem,
  EbayEligibleItemsResponse,
  EbaySendOfferResponse,
  SendOfferRequest,
  EbayNegotiationErrorResponse,
} from './negotiation.types';

// ============================================================================
// Constants
// ============================================================================

const EBAY_NEGOTIATION_API_URL = 'https://api.ebay.com/sell/negotiation/v1';
const DEFAULT_LIMIT = 200;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
// Offer duration in days (4 days for EBAY_GB marketplace)
const OFFER_DURATION_DAYS = 4;

// ============================================================================
// Error Class
// ============================================================================

export class EbayNegotiationApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public errorId?: number,
    public errors?: EbayNegotiationErrorResponse['errors']
  ) {
    super(message);
    this.name = 'EbayNegotiationApiError';
  }

  /**
   * Check if this is a rate limit error
   */
  isRateLimitError(): boolean {
    return this.statusCode === 429;
  }

  /**
   * Check if this is an "no interested buyers" error (150020)
   */
  isNoInterestedBuyersError(): boolean {
    return this.errors?.some((e) => e.errorId === 150020) ?? false;
  }

  /**
   * Check if this is a "max offers reached" error (150022)
   */
  isMaxOffersReachedError(): boolean {
    return this.errors?.some((e) => e.errorId === 150022) ?? false;
  }
}

// ============================================================================
// Client Class
// ============================================================================

export interface EbayNegotiationClientConfig {
  accessToken: string;
  marketplaceId?: string;
}

export class EbayNegotiationClient {
  private accessToken: string;
  private marketplaceId: string;

  constructor(config: EbayNegotiationClientConfig) {
    this.accessToken = config.accessToken;
    this.marketplaceId = config.marketplaceId ?? 'EBAY_GB';
  }

  /**
   * Update the access token (for token refresh)
   */
  setAccessToken(token: string): void {
    this.accessToken = token;
  }

  /**
   * Find all eligible items that have interested buyers
   *
   * @param limit Number of items per page (max 200)
   * @param offset Pagination offset
   * @returns Response with eligible items
   */
  async findEligibleItems(
    limit: number = DEFAULT_LIMIT,
    offset: number = 0
  ): Promise<EbayEligibleItemsResponse> {
    const url = `${EBAY_NEGOTIATION_API_URL}/find_eligible_items?limit=${limit}&offset=${offset}`;

    const response = await this.makeRequest<EbayEligibleItemsResponse>(url, {
      method: 'GET',
    });

    return response;
  }

  /**
   * Find ALL eligible items, handling pagination automatically
   *
   * @returns Array of all eligible items
   */
  async findAllEligibleItems(): Promise<EbayEligibleItem[]> {
    const allItems: EbayEligibleItem[] = [];
    let offset = 0;
    const limit = DEFAULT_LIMIT;

    while (true) {
      const response = await this.findEligibleItems(limit, offset);

      // Handle empty response
      if (!response.eligibleItems || response.eligibleItems.length === 0) {
        break;
      }

      allItems.push(...response.eligibleItems);

      // Check if we've fetched all items
      if (!response.next || response.eligibleItems.length < limit) {
        break;
      }

      offset += limit;
    }

    return allItems;
  }

  /**
   * Send an offer to all interested buyers for a listing
   *
   * @param listingId The eBay listing ID
   * @param discountPercentage The discount percentage (10-50)
   * @param message Optional message to include with the offer
   * @param quantity Quantity to offer (default 1)
   * @returns Response with created offers
   */
  async sendOfferToInterestedBuyers(
    listingId: string,
    discountPercentage: number,
    message?: string,
    quantity: number = 1
  ): Promise<EbaySendOfferResponse> {
    const url = `${EBAY_NEGOTIATION_API_URL}/send_offer_to_interested_buyers`;

    const body: SendOfferRequest = {
      allowCounterOffer: false, // We don't handle counter-offers in V1
      offeredItems: [
        {
          listingId,
          quantity,
          discountPercentage: discountPercentage.toString(),
        },
      ],
      offerDuration: {
        unit: 'DAY',
        value: OFFER_DURATION_DAYS,
      },
      ...(message && { message }),
    };

    const response = await this.makeRequest<EbaySendOfferResponse>(url, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    return response;
  }

  /**
   * Make a request to the eBay Negotiation API with retry logic
   *
   * @param url The full URL to request
   * @param options Fetch options
   * @returns Parsed JSON response
   */
  private async makeRequest<T>(
    url: string,
    options: RequestInit
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(url, {
          ...options,
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-EBAY-C-MARKETPLACE-ID': this.marketplaceId,
            ...options.headers,
          },
        });

        // Handle rate limiting with retry
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const delayMs = retryAfter
            ? parseInt(retryAfter, 10) * 1000
            : RETRY_DELAY_MS * attempt;

          console.warn(
            `[EbayNegotiationClient] Rate limited, retrying in ${delayMs}ms (attempt ${attempt}/${MAX_RETRIES})`
          );

          await this.delay(delayMs);
          continue;
        }

        // Handle error responses
        if (!response.ok) {
          const errorText = await response.text();
          let errorData: EbayNegotiationErrorResponse | null = null;

          try {
            errorData = JSON.parse(errorText);
          } catch {
            // Response wasn't JSON
          }

          const errorMessage = errorData?.errors?.[0]?.message
            || `API request failed: ${response.status}`;

          throw new EbayNegotiationApiError(
            errorMessage,
            response.status,
            errorData?.errors?.[0]?.errorId,
            errorData?.errors
          );
        }

        // Parse successful response
        const data = await response.json();
        return data as T;
      } catch (error) {
        lastError = error as Error;

        // Don't retry on non-retryable errors
        if (
          error instanceof EbayNegotiationApiError &&
          !error.isRateLimitError()
        ) {
          throw error;
        }

        // Retry on network errors
        if (attempt < MAX_RETRIES) {
          console.warn(
            `[EbayNegotiationClient] Request failed, retrying (attempt ${attempt}/${MAX_RETRIES}):`,
            error instanceof Error ? error.message : 'Unknown error'
          );
          await this.delay(RETRY_DELAY_MS * attempt);
        }
      }
    }

    throw lastError || new Error('Request failed after max retries');
  }

  /**
   * Delay execution for the specified milliseconds
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
