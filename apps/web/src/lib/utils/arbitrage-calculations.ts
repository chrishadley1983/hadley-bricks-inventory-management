/**
 * Arbitrage Calculation Utilities
 *
 * Shared calculations for COG%, profit, and ROI across arbitrage features.
 * Constants and formulas used by both manual and automated Vinted arbitrage.
 *
 * IMPORTANT: Price Extraction
 * The scanner extracts the INCLUSIVE price from Vinted (includes Buyer Protection fee).
 * This is the price shown in bold on listing cards (e.g., £30.54), NOT the base price
 * (e.g., £28.00 shown greyed out).
 *
 * Total cost = Inclusive Vinted price + Shipping
 */

/**
 * Amazon FBM (Fulfilled by Merchant) effective fee rate
 * Includes: referral fee (~15%) + closing fee (~1.8%) + misc fees
 */
export const AMAZON_FEE_RATE = 0.1836;

/**
 * Vinted standard shipping cost (UK)
 * This is added ON TOP of the inclusive price (which includes Buyer Protection).
 * Typical shipping costs: £2.30-£4.50 depending on size/weight.
 * Using £2.30 as a conservative estimate for smaller LEGO sets.
 */
export const VINTED_SHIPPING_COST = 2.3;

/**
 * COG% threshold definitions for opportunity classification
 */
export const COG_THRESHOLDS = {
  EXCELLENT: 30, // < 30% = excellent opportunity
  GOOD: 40, // 30-40% = good opportunity
  MARGINAL: 50, // 40-50% = marginal, consider carefully
  POOR: 60, // 50-60% = poor margin
  // > 60% = not viable
};

/**
 * Calculate the total cost including shipping
 *
 * @param vintedPrice - The Vinted listing price in GBP
 * @param shippingCost - The shipping cost (defaults to standard £2.30)
 * @returns Total cost of acquisition
 */
export function calculateTotalCost(
  vintedPrice: number,
  shippingCost: number = VINTED_SHIPPING_COST
): number {
  return vintedPrice + shippingCost;
}

/**
 * Calculate Cost of Goods percentage (COG%)
 *
 * COG% = (Total Cost / Amazon Price) × 100
 *
 * Lower COG% = higher profit potential:
 * - < 30% = Excellent
 * - 30-40% = Good
 * - 40-50% = Marginal
 * - 50-60% = Poor
 * - > 60% = Not viable
 *
 * @param totalCost - Total acquisition cost (Vinted price + shipping)
 * @param amazonPrice - Amazon selling price
 * @returns COG% rounded to 1 decimal place, or null if prices invalid
 */
export function calculateCogPercent(totalCost: number, amazonPrice: number | null): number | null {
  if (!amazonPrice || amazonPrice <= 0 || totalCost < 0) {
    return null;
  }

  const cogPercent = (totalCost / amazonPrice) * 100;
  return Math.round(cogPercent * 10) / 10;
}

/**
 * Calculate expected profit after Amazon fees
 *
 * Profit = Amazon Price - Amazon Fees - Total Cost
 *        = Amazon Price × (1 - 0.1836) - Total Cost
 *
 * @param amazonPrice - Amazon selling price
 * @param totalCost - Total acquisition cost
 * @param feeRate - Amazon fee rate (defaults to 18.36%)
 * @returns Profit in GBP rounded to 2 decimal places, or null if invalid
 */
export function calculateProfit(
  amazonPrice: number | null,
  totalCost: number,
  feeRate: number = AMAZON_FEE_RATE
): number | null {
  if (!amazonPrice || amazonPrice <= 0 || totalCost < 0) {
    return null;
  }

  const netPayout = amazonPrice * (1 - feeRate);
  const profit = netPayout - totalCost;
  return Math.round(profit * 100) / 100;
}

/**
 * Calculate Return on Investment (ROI) percentage
 *
 * ROI = (Profit / Total Cost) × 100
 *
 * @param profit - Expected profit
 * @param totalCost - Total acquisition cost
 * @returns ROI% rounded to 1 decimal place, or null if invalid
 */
export function calculateRoi(profit: number | null, totalCost: number): number | null {
  if (profit === null || totalCost <= 0) {
    return null;
  }

  const roi = (profit / totalCost) * 100;
  return Math.round(roi * 10) / 10;
}

/**
 * Classify an opportunity based on its COG%
 *
 * @param cogPercent - The COG% value
 * @returns Classification string
 */
export function classifyCogPercent(
  cogPercent: number | null
): 'excellent' | 'good' | 'marginal' | 'poor' | 'not_viable' | 'unknown' {
  if (cogPercent === null) {
    return 'unknown';
  }

  if (cogPercent < COG_THRESHOLDS.EXCELLENT) {
    return 'excellent';
  }
  if (cogPercent < COG_THRESHOLDS.GOOD) {
    return 'good';
  }
  if (cogPercent < COG_THRESHOLDS.MARGINAL) {
    return 'marginal';
  }
  if (cogPercent < COG_THRESHOLDS.POOR) {
    return 'poor';
  }
  return 'not_viable';
}

/**
 * Check if an opportunity is viable based on COG% threshold
 *
 * @param cogPercent - The COG% value
 * @param threshold - The viability threshold (defaults to 40%)
 * @returns true if the opportunity is viable
 */
export function isViable(
  cogPercent: number | null,
  threshold: number = COG_THRESHOLDS.GOOD
): boolean {
  if (cogPercent === null) {
    return false;
  }
  return cogPercent <= threshold;
}

/**
 * Check if an opportunity is a near-miss (above threshold but within range)
 *
 * @param cogPercent - The COG% value
 * @param viableThreshold - The viability threshold
 * @param nearMissThreshold - The near-miss upper threshold
 * @returns true if the opportunity is a near-miss
 */
export function isNearMiss(
  cogPercent: number | null,
  viableThreshold: number = COG_THRESHOLDS.GOOD,
  nearMissThreshold: number = COG_THRESHOLDS.MARGINAL
): boolean {
  if (cogPercent === null) {
    return false;
  }
  return cogPercent > viableThreshold && cogPercent <= nearMissThreshold;
}

/**
 * Full arbitrage calculation for a Vinted listing
 *
 * @param vintedPrice - Vinted listing price in GBP
 * @param amazonPrice - Amazon selling price in GBP (or null if unknown)
 * @param shippingCost - Shipping cost (defaults to £2.30)
 * @returns Complete calculation results
 */
export function calculateArbitrage(
  vintedPrice: number,
  amazonPrice: number | null,
  shippingCost: number = VINTED_SHIPPING_COST
): {
  totalCost: number;
  cogPercent: number | null;
  profit: number | null;
  roi: number | null;
  classification: ReturnType<typeof classifyCogPercent>;
  isViable: boolean;
} {
  const totalCost = calculateTotalCost(vintedPrice, shippingCost);
  const cogPercent = calculateCogPercent(totalCost, amazonPrice);
  const profit = calculateProfit(amazonPrice, totalCost);
  const roi = calculateRoi(profit, totalCost);
  const classification = classifyCogPercent(cogPercent);

  return {
    totalCost,
    cogPercent,
    profit,
    roi,
    classification,
    isViable: isViable(cogPercent),
  };
}
