/**
 * Amazon Sync Configuration
 *
 * Contains the fix for the price=0 issue when creating new listings.
 *
 * ## Problem
 * When creating a new SKU on an existing ASIN, Amazon was accepting
 * the feed but not applying the price (showing as £0.00).
 *
 * ## Root Cause
 * The `audience: "ALL"` field in the `purchasable_offer` attribute
 * was causing Amazon to silently fail to apply the price.
 *
 * ## Solution
 * Remove the `audience` field from `purchasable_offer`. The price is
 * applied correctly without it.
 *
 * ## Additional Requirements
 * - `list_price` attribute is required for UK marketplace (added mid-2024)
 * - Amazon takes up to 30 minutes to apply price to new listings
 *
 * ## Variation System
 * The variation system is kept for future debugging/testing if needed.
 * Set AMAZON_PRICE_VARIATION env var to test different payload structures.
 */

// ============================================================================
// PAYLOAD VARIATIONS
// ============================================================================

/**
 * Available payload variations for testing price submission.
 *
 * - baseline: Original implementation (with audience: ALL) - CAUSES PRICE=0
 * - no_audience: Working fix - removes audience field - DEFAULT
 * - string_price: Price as string "15.00" instead of number 15
 * - with_start_at: Adds start_at timestamp to price schedule
 * - with_offer_type: Adds offer_type: B2C
 * - combined_no_audience: String price + start_at, no audience
 * - combined_with_offer_type: String price + start_at + offer_type
 */
export type PricePayloadVariation =
  | 'baseline'
  | 'no_audience'
  | 'string_price'
  | 'with_start_at'
  | 'with_offer_type'
  | 'combined_no_audience'
  | 'combined_with_offer_type';

/**
 * Current variation being used.
 *
 * IMPORTANT: 'no_audience' is the working fix. Do not change unless testing.
 *
 * Set via AMAZON_PRICE_VARIATION env var to override for testing.
 */
export const PRICE_PAYLOAD_VARIATION: PricePayloadVariation =
  (process.env.AMAZON_PRICE_VARIATION as PricePayloadVariation) || 'no_audience';

// ============================================================================
// VARIATION CONFIGURATION
// ============================================================================

interface VariationConfig {
  /** Use string format for price (e.g., "15.00" instead of 15) */
  priceAsString: boolean;
  /** Include start_at timestamp in schedule */
  includeStartAt: boolean;
  /** Include audience: ALL field (causes price=0 bug!) */
  includeAudience: boolean;
  /** Include offer_type: B2C field */
  includeOfferType: boolean;
}

const VARIATION_CONFIGS: Record<PricePayloadVariation, VariationConfig> = {
  // BROKEN - causes price=0
  baseline: {
    priceAsString: false,
    includeStartAt: false,
    includeAudience: true, // This causes the bug!
    includeOfferType: false,
  },
  // WORKING FIX - use this
  no_audience: {
    priceAsString: false,
    includeStartAt: false,
    includeAudience: false,
    includeOfferType: false,
  },
  // Test variations
  string_price: {
    priceAsString: true,
    includeStartAt: false,
    includeAudience: true,
    includeOfferType: false,
  },
  with_start_at: {
    priceAsString: false,
    includeStartAt: true,
    includeAudience: true,
    includeOfferType: false,
  },
  with_offer_type: {
    priceAsString: false,
    includeStartAt: false,
    includeAudience: true,
    includeOfferType: true,
  },
  combined_no_audience: {
    priceAsString: true,
    includeStartAt: true,
    includeAudience: false,
    includeOfferType: false,
  },
  combined_with_offer_type: {
    priceAsString: true,
    includeStartAt: true,
    includeAudience: false,
    includeOfferType: true,
  },
};

/**
 * Get the configuration for the current variation.
 */
export function getVariationConfig(): VariationConfig {
  return VARIATION_CONFIGS[PRICE_PAYLOAD_VARIATION];
}

// ============================================================================
// PAYLOAD BUILDING HELPERS
// ============================================================================

/**
 * UK Marketplace ID
 */
export const UK_MARKETPLACE_ID = 'A1F83G8C2ARO7P';

/**
 * Build the purchasable_offer structure based on current variation.
 *
 * @param price - The price value (number)
 * @returns The purchasable_offer array structure
 */
export function buildPurchasableOffer(price: number): Record<string, unknown>[] {
  const config = getVariationConfig();

  // Format price based on variation
  const priceValue = config.priceAsString ? price.toFixed(2) : price;

  // Build schedule entry
  const scheduleEntry: Record<string, unknown> = {
    value_with_tax: priceValue,
  };

  if (config.includeStartAt) {
    // Use start of current day in UTC
    const now = new Date();
    now.setUTCHours(0, 0, 0, 0);
    scheduleEntry.start_at = now.toISOString();
  }

  // Build purchasable offer
  const offer: Record<string, unknown> = {
    marketplace_id: UK_MARKETPLACE_ID,
    currency: 'GBP',
    our_price: [
      {
        schedule: [scheduleEntry],
      },
    ],
  };

  // IMPORTANT: audience field causes price=0 bug - only include for testing
  if (config.includeAudience) {
    offer.audience = 'ALL';
  }

  if (config.includeOfferType) {
    offer.offer_type = 'B2C';
  }

  return [offer];
}

/**
 * Log the current variation configuration.
 * Call this at service initialization for debugging.
 */
export function logVariationConfig() {
  const config = getVariationConfig();

  console.log('[AmazonSyncConfig] Price payload variation:', PRICE_PAYLOAD_VARIATION);
  console.log('[AmazonSyncConfig] Configuration:', {
    priceAsString: config.priceAsString,
    includeStartAt: config.includeStartAt,
    includeAudience: config.includeAudience,
    includeOfferType: config.includeOfferType,
  });
}

// ============================================================================
// EXPORTS FOR TESTING
// ============================================================================

export { VARIATION_CONFIGS };
