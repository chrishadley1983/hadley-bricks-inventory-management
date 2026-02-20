import type { MinifigSyncConfig, BestOfferThresholds } from './types';

/**
 * Round a price down to the nearest charm price ending (.49 or .99).
 *
 * Examples:
 *   14.61 → 14.49
 *    6.25 →  5.99
 *    4.10 →  3.99
 *    5.49 →  5.49 (already charm)
 *    5.99 →  5.99 (already charm)
 */
export function roundToNearestCharm(price: number): number {
  if (price < 0.99) return 0.99;

  const whole = Math.floor(price);
  // Round fractional pence to avoid floating-point comparison errors
  // e.g. 5.49 - 5 can yield 0.48999… in IEEE 754
  const frac = Math.round((price - whole) * 100) / 100;

  if (frac >= 0.99) return whole + 0.99;
  if (frac >= 0.49) return whole + 0.49;
  // fraction < 0.49 → drop to previous whole's .99
  return (whole - 1) + 0.99;
}

/**
 * Calculate the markup-based recommended price.
 * Formula: bricqerPrice × 1.25, rounded down to nearest .49 or .99.
 */
export function calculateMarkupPrice(bricqerPrice: number): number {
  const raw = bricqerPrice * 1.25;
  return roundToNearestCharm(raw);
}

export class PricingEngine {
  constructor(private config: MinifigSyncConfig) {}

  /**
   * Evaluate whether a minifigure meets all threshold criteria for eBay listing.
   * All 4 criteria must pass.
   */
  evaluateThreshold(params: {
    soldCount: number;
    sellThroughRate: number;
    avgSoldPrice: number;
    avgShipping: number;
  }): boolean {
    const { soldCount, sellThroughRate, avgSoldPrice, avgShipping } = params;

    if (soldCount < this.config.min_sold_count) return false;
    if (sellThroughRate < this.config.min_sell_through_rate) return false;
    if (avgSoldPrice < this.config.min_avg_sold_price) return false;

    const profit = this.calculateProfit(avgSoldPrice, avgShipping);
    if (profit < this.config.min_estimated_profit) return false;

    return true;
  }

  /**
   * Calculate estimated profit after eBay fees, shipping, and packaging.
   * Formula: avgSoldPrice - (avgSoldPrice * fvfRate) - avgShipping - packagingCost
   */
  calculateProfit(avgSoldPrice: number, avgShipping: number): number {
    const feeAmount = avgSoldPrice * this.config.ebay_fvf_rate;
    return (
      avgSoldPrice - feeAmount - avgShipping - this.config.packaging_cost
    );
  }

  /**
   * Calculate the recommended listing price.
   * Base: avg_sold_price * 1.05 (5% markup for Best Offer negotiation)
   * Clamped between floor (bricqer_price + £1.00) and ceiling (max_sold_price)
   */
  calculateRecommendedPrice(params: {
    avgSoldPrice: number;
    maxSoldPrice: number;
    bricqerPrice: number;
  }): number {
    const { avgSoldPrice, maxSoldPrice, bricqerPrice } = params;

    const base = Math.round(avgSoldPrice * 1.05 * 100) / 100;
    const floor = bricqerPrice + 1.0;
    const ceiling = maxSoldPrice > 0 ? maxSoldPrice : Infinity;

    // If floor exceeds ceiling, floor wins (never list below cost + margin)
    if (floor > ceiling) {
      return Math.round(floor * 100) / 100;
    }

    return Math.round(Math.min(Math.max(base, floor), ceiling) * 100) / 100;
  }

  /**
   * Calculate Best Offer auto-accept and auto-decline thresholds.
   * Auto-accept: >= 95% of listed price
   * Auto-decline: <= 75% of listed price
   */
  calculateBestOfferThresholds(price: number): BestOfferThresholds {
    return {
      autoAccept: Math.round(price * 0.95 * 100) / 100,
      autoDecline: Math.round(price * 0.75 * 100) / 100,
    };
  }
}
