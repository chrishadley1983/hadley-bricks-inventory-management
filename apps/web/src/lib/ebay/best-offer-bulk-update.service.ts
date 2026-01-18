/**
 * Best Offer Bulk Update Service
 *
 * Updates auto-accept and auto-decline thresholds for multiple eBay listings
 * based on percentage rules.
 *
 * @see https://developer.ebay.com/api-docs/user-guides/static/trading-user-guide/best-offers-auto.html
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { EbayTradingClient, EbayTradingApiError } from '@/lib/platform-stock/ebay/ebay-trading.client';
import { EbayAuthService } from './ebay-auth.service';

// ============================================================================
// Types
// ============================================================================

/**
 * Input for a single listing to update
 */
export interface ListingInput {
  itemId: string;           // eBay listing ID
  currentPrice: number;     // Current BIN price
  currency: string;         // e.g. "GBP", "USD"
}

/**
 * Rules for Best Offer auto-accept/decline thresholds
 */
export interface BestOfferRules {
  autoDeclinePercent: number;   // e.g. 70 = reject offers below 70%
  autoAcceptPercent: number;    // e.g. 90 = accept offers at/above 90%
  enableBestOffer: boolean;     // Whether to enable Best Offer
}

/**
 * Result for a successfully updated listing
 */
export interface UpdatedListing {
  itemId: string;
  minimumBestOfferPrice: number;
  bestOfferAutoAcceptPrice: number;
}

/**
 * Reason codes for failed updates
 */
export type FailureReason =
  | 'PENDING_OFFER'
  | 'CATEGORY_NOT_SUPPORTED'
  | 'INVALID_PRICE'
  | 'API_ERROR'
  | 'VALIDATION_ERROR';

/**
 * Result for a failed listing update
 */
export interface FailedListing {
  itemId: string;
  errorCode: string;
  errorMessage: string;
  reason: FailureReason;
}

/**
 * Bulk update result
 */
export interface BulkUpdateResult {
  successful: UpdatedListing[];
  failed: FailedListing[];
  summary: {
    total: number;
    succeeded: number;
    failed: number;
  };
}

/**
 * Progress callback for bulk operations
 */
export type BulkUpdateProgressCallback = (current: number, total: number) => void | Promise<void>;

// ============================================================================
// Constants
// ============================================================================

/**
 * Delay between API calls to avoid rate limiting (ms)
 */
const API_CALL_DELAY_MS = 100;

// ============================================================================
// BestOfferBulkUpdateService Class
// ============================================================================

export class BestOfferBulkUpdateService {
  private supabase: SupabaseClient<Database>;
  private userId: string;
  private ebayAuth: EbayAuthService;

  constructor(supabase: SupabaseClient<Database>, userId: string) {
    this.supabase = supabase;
    this.userId = userId;
    this.ebayAuth = new EbayAuthService();
  }

  /**
   * Bulk update Best Offer thresholds for multiple listings
   *
   * @param listings - Array of listings with their current prices
   * @param rules - Best Offer rules to apply
   * @param onProgress - Optional progress callback
   * @returns Aggregated results with successful and failed updates
   */
  async bulkUpdateBestOfferThresholds(
    listings: ListingInput[],
    rules: BestOfferRules,
    onProgress?: BulkUpdateProgressCallback
  ): Promise<BulkUpdateResult> {
    console.log(`[BestOfferBulkUpdate] Starting bulk update for ${listings.length} listings`);
    console.log(`[BestOfferBulkUpdate] Rules: autoDecline=${rules.autoDeclinePercent}%, autoAccept=${rules.autoAcceptPercent}%, enabled=${rules.enableBestOffer}`);

    // Validate rules
    const validationError = this.validateRules(rules);
    if (validationError) {
      throw new Error(validationError);
    }

    // Get access token
    const accessToken = await this.ebayAuth.getAccessToken(this.userId);
    if (!accessToken) {
      throw new Error('eBay not connected. Please connect your eBay account first.');
    }

    // Create Trading API client
    const tradingClient = new EbayTradingClient({
      accessToken,
      siteId: 3, // UK
    });

    const successful: UpdatedListing[] = [];
    const failed: FailedListing[] = [];

    for (let i = 0; i < listings.length; i++) {
      const listing = listings[i];

      try {
        // Calculate thresholds
        const thresholds = this.calculateThresholds(listing.currentPrice, rules);

        // Validate calculated thresholds
        const priceValidation = this.validateThresholds(thresholds, listing.currentPrice);
        if (priceValidation) {
          failed.push({
            itemId: listing.itemId,
            errorCode: 'VALIDATION',
            errorMessage: priceValidation,
            reason: 'VALIDATION_ERROR',
          });
          continue;
        }

        // Call eBay API to update the listing
        const result = await tradingClient.reviseFixedPriceItem({
          itemId: listing.itemId,
          bestOfferEnabled: rules.enableBestOffer,
          bestOfferAutoAcceptPrice: thresholds.autoAcceptPrice,
          minimumBestOfferPrice: thresholds.autoDeclinePrice,
          currency: listing.currency,
        });

        if (result.success) {
          successful.push({
            itemId: listing.itemId,
            minimumBestOfferPrice: thresholds.autoDeclinePrice,
            bestOfferAutoAcceptPrice: thresholds.autoAcceptPrice,
          });
          console.log(`[BestOfferBulkUpdate] ✓ Updated ${listing.itemId}: decline=${thresholds.autoDeclinePrice}, accept=${thresholds.autoAcceptPrice}`);
        } else {
          const reason = this.categorizeError(result.errorCode, result.errorMessage);
          failed.push({
            itemId: listing.itemId,
            errorCode: result.errorCode || 'UNKNOWN',
            errorMessage: result.errorMessage || 'Unknown error',
            reason,
          });
          console.warn(`[BestOfferBulkUpdate] ✗ Failed ${listing.itemId}: ${result.errorMessage}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const errorCode = error instanceof EbayTradingApiError ? error.errorCode || 'API_ERROR' : 'UNKNOWN';

        failed.push({
          itemId: listing.itemId,
          errorCode,
          errorMessage,
          reason: 'API_ERROR',
        });
        console.error(`[BestOfferBulkUpdate] ✗ Exception for ${listing.itemId}:`, error);
      }

      // Report progress
      if (onProgress) {
        await onProgress(i + 1, listings.length);
      }

      // Rate limiting delay between API calls
      if (i < listings.length - 1) {
        await this.delay(API_CALL_DELAY_MS);
      }
    }

    const result: BulkUpdateResult = {
      successful,
      failed,
      summary: {
        total: listings.length,
        succeeded: successful.length,
        failed: failed.length,
      },
    };

    console.log(`[BestOfferBulkUpdate] Complete: ${successful.length} succeeded, ${failed.length} failed`);
    return result;
  }

  /**
   * Get all active eBay listings with Best Offer enabled status
   * Uses data from the last eBay stock import
   */
  async getActiveListingsForUpdate(): Promise<ListingInput[]> {
    const { data, error } = await this.supabase
      .from('platform_listings')
      .select('platform_item_id, price, currency, ebay_data')
      .eq('user_id', this.userId)
      .eq('platform', 'ebay')
      .eq('listing_status', 'Active')
      .not('price', 'is', null);

    if (error) {
      throw new Error(`Failed to fetch listings: ${error.message}`);
    }

    return (data || []).map((row) => ({
      itemId: row.platform_item_id,
      currentPrice: Number(row.price),
      currency: row.currency || 'GBP',
    }));
  }

  /**
   * Get listings that currently have Best Offer disabled
   */
  async getListingsWithoutBestOffer(): Promise<ListingInput[]> {
    const { data, error } = await this.supabase
      .from('platform_listings')
      .select('platform_item_id, price, currency, ebay_data')
      .eq('user_id', this.userId)
      .eq('platform', 'ebay')
      .eq('listing_status', 'Active')
      .not('price', 'is', null);

    if (error) {
      throw new Error(`Failed to fetch listings: ${error.message}`);
    }

    // Filter to listings where Best Offer is not enabled
    return (data || [])
      .filter((row) => {
        const ebayData = row.ebay_data as { bestOfferEnabled?: boolean } | null;
        return !ebayData?.bestOfferEnabled;
      })
      .map((row) => ({
        itemId: row.platform_item_id,
        currentPrice: Number(row.price),
        currency: row.currency || 'GBP',
      }));
  }

  /**
   * Get listings that have Best Offer enabled but no auto-accept/decline thresholds
   */
  async getListingsWithMissingThresholds(): Promise<ListingInput[]> {
    const { data, error } = await this.supabase
      .from('platform_listings')
      .select('platform_item_id, price, currency, ebay_data')
      .eq('user_id', this.userId)
      .eq('platform', 'ebay')
      .eq('listing_status', 'Active')
      .not('price', 'is', null);

    if (error) {
      throw new Error(`Failed to fetch listings: ${error.message}`);
    }

    // Filter to listings where Best Offer is enabled but thresholds are missing
    return (data || [])
      .filter((row) => {
        const ebayData = row.ebay_data as {
          bestOfferEnabled?: boolean;
          bestOfferAutoAcceptPrice?: number | null;
          minimumBestOfferPrice?: number | null;
        } | null;
        return ebayData?.bestOfferEnabled === true && (
          ebayData?.bestOfferAutoAcceptPrice == null ||
          ebayData?.minimumBestOfferPrice == null
        );
      })
      .map((row) => ({
        itemId: row.platform_item_id,
        currentPrice: Number(row.price),
        currency: row.currency || 'GBP',
      }));
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Validate the Best Offer rules
   */
  private validateRules(rules: BestOfferRules): string | null {
    if (rules.autoDeclinePercent < 0 || rules.autoDeclinePercent > 100) {
      return 'autoDeclinePercent must be between 0 and 100';
    }
    if (rules.autoAcceptPercent < 0 || rules.autoAcceptPercent > 100) {
      return 'autoAcceptPercent must be between 0 and 100';
    }
    if (rules.autoDeclinePercent >= rules.autoAcceptPercent) {
      return 'autoDeclinePercent must be less than autoAcceptPercent';
    }
    return null;
  }

  /**
   * Calculate threshold prices based on percentage rules
   */
  private calculateThresholds(
    currentPrice: number,
    rules: BestOfferRules
  ): { autoDeclinePrice: number; autoAcceptPrice: number } {
    const autoDeclinePrice = Math.round((currentPrice * (rules.autoDeclinePercent / 100)) * 100) / 100;
    const autoAcceptPrice = Math.round((currentPrice * (rules.autoAcceptPercent / 100)) * 100) / 100;
    return { autoDeclinePrice, autoAcceptPrice };
  }

  /**
   * Validate calculated thresholds
   */
  private validateThresholds(
    thresholds: { autoDeclinePrice: number; autoAcceptPrice: number },
    currentPrice: number
  ): string | null {
    if (thresholds.autoDeclinePrice <= 0) {
      return 'Auto-decline price must be greater than 0';
    }
    if (thresholds.autoAcceptPrice >= currentPrice) {
      return 'Auto-accept price must be less than current price';
    }
    if (thresholds.autoDeclinePrice >= thresholds.autoAcceptPrice) {
      return 'Auto-decline price must be less than auto-accept price';
    }
    return null;
  }

  /**
   * Categorize error code into a failure reason
   */
  private categorizeError(errorCode: string | undefined, errorMessage: string | undefined): FailureReason {
    const code = errorCode?.toLowerCase() || '';
    const message = errorMessage?.toLowerCase() || '';

    // Check for pending offer errors
    if (message.includes('pending') || message.includes('counter offer') || code.includes('240')) {
      return 'PENDING_OFFER';
    }

    // Check for category not supported
    if (message.includes('category') || message.includes('not supported') || code.includes('21919188')) {
      return 'CATEGORY_NOT_SUPPORTED';
    }

    // Check for invalid price
    if (message.includes('price') || message.includes('invalid') || code.includes('21916587')) {
      return 'INVALID_PRICE';
    }

    return 'API_ERROR';
  }

  /**
   * Delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a BestOfferBulkUpdateService instance
 */
export function createBestOfferBulkUpdateService(
  supabase: SupabaseClient<Database>,
  userId: string
): BestOfferBulkUpdateService {
  return new BestOfferBulkUpdateService(supabase, userId);
}
