import type { MinifigSyncConfig, BestOfferThresholds } from './types';

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
    const ceiling = maxSoldPrice;

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
