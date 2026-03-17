/**
 * Refresh Pricing Engine
 *
 * Calculates engagement-based price reductions for stale eBay listings.
 * Used by the automated listing refresh cron to set smart prices when
 * recreating listings after 90+ days.
 */

// ============================================================================
// Types
// ============================================================================

export type EngagementTier = 'HOT' | 'WARM' | 'COOL' | 'COLD';

export interface RefreshPriceResult {
  tier: EngagementTier;
  reductionPct: number;
  oldPrice: number;
  newPrice: number;
  floorPrice: number;
  wasFloored: boolean;
  wasUnchanged: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const TIER_REDUCTION: Record<EngagementTier, number> = {
  HOT: 0,
  WARM: 5,
  COOL: 10,
  COLD: 15,
};

const USED_CONDITION_EXTRA_PCT = 5;
const DEFAULT_EBAY_FEE_RATE = 0.1323;

// ============================================================================
// Functions
// ============================================================================

/**
 * Round UP to the nearest .99.
 * Examples: 14.20 → 14.99, 15.10 → 15.99, 15.99 → 15.99, 16.00 → 16.99, 0.50 → 0.99
 */
export function roundUpToNearest99(price: number): number {
  if (price <= 0) return 0.99;
  return Math.floor(price) + 0.99;
}

/**
 * Classify a listing into an engagement tier based on views, watchers, and age.
 *
 * Evaluated in order:
 * - HOT:  watchers >= 5
 * - WARM: viewsPerDay >= 1.0 AND watchers >= 2
 * - COOL: viewsPerDay < 1.0 OR watchers <= 1 (catch-all that isn't COLD)
 * - COLD: viewsPerDay < 0.5 AND watchers == 0
 */
export function getEngagementTier(
  views: number,
  watchers: number,
  ageDays: number
): EngagementTier {
  const viewsPerDay = ageDays > 0 ? views / ageDays : 0;

  // HOT: strong watcher interest
  if (watchers >= 5) return 'HOT';

  // COLD: no engagement at all
  if (viewsPerDay < 0.5 && watchers === 0) return 'COLD';

  // WARM: decent views and some watchers
  if (viewsPerDay >= 1.0 && watchers >= 2) return 'WARM';

  // COOL: everything else
  return 'COOL';
}

/**
 * Get the total reduction percentage for a tier and condition.
 * Used condition adds +5% to the base tier reduction.
 */
export function getReductionPct(tier: EngagementTier, condition: string | null): number {
  const base = TIER_REDUCTION[tier];
  const conditionExtra = condition?.toLowerCase() === 'used' ? USED_CONDITION_EXTRA_PCT : 0;
  return base + conditionExtra;
}

/**
 * Calculate the price floor (breakeven after eBay fees).
 * floor = cost / (1 - feeRate)
 */
export function calculateFloorPrice(cost: number, feeRate: number = DEFAULT_EBAY_FEE_RATE): number {
  if (cost <= 0) return 0;
  return cost / (1 - feeRate);
}

/**
 * Calculate the refreshed price for a listing based on its engagement tier.
 *
 * 1. Apply tier-based reduction (+ Used condition modifier)
 * 2. Round up to nearest .99
 * 3. Clamp to floor price (cost-based breakeven)
 * 4. Never increase price
 */
export function calculateRefreshPrice(
  currentPrice: number,
  cost: number,
  tier: EngagementTier,
  condition: string | null,
  feeRate: number = DEFAULT_EBAY_FEE_RATE
): RefreshPriceResult {
  const reductionPct = getReductionPct(tier, condition);
  const floorRaw = calculateFloorPrice(cost, feeRate);
  const floorPrice = floorRaw > 0 ? roundUpToNearest99(floorRaw) : 0;

  // Apply reduction
  const reducedPrice = currentPrice * (1 - reductionPct / 100);
  let newPrice = roundUpToNearest99(reducedPrice);

  // Clamp to floor
  let wasFloored = false;
  if (newPrice < floorPrice) {
    newPrice = floorPrice;
    wasFloored = true;
  }

  // Never increase price
  let wasUnchanged = false;
  if (newPrice >= currentPrice) {
    newPrice = currentPrice;
    wasUnchanged = true;
  }

  return {
    tier,
    reductionPct,
    oldPrice: currentPrice,
    newPrice,
    floorPrice,
    wasFloored,
    wasUnchanged,
  };
}
