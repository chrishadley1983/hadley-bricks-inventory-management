/**
 * Arbitrage Calculations
 *
 * Margin and profit calculation utilities for arbitrage tracking.
 * Includes Amazon FBM UK profit calculations for non-VAT registered sellers.
 */

import type { ProfitCalculation, AmazonFBMProfitBreakdown } from './types';

// ============================================
// Amazon FBM UK Fee Constants (2026)
// ============================================

/**
 * Amazon UK Toys & Games referral fee rate
 */
const AMAZON_REFERRAL_FEE_RATE = 0.15; // 15%

/**
 * UK Digital Services Tax (DST) rate applied to referral fees
 */
const AMAZON_DST_RATE = 0.02; // 2%

/**
 * UK VAT rate (non-reclaimable for non-VAT registered sellers)
 */
const VAT_RATE = 0.20; // 20%

/**
 * Combined effective fee rate: 15% × 1.02 × 1.20 = 18.36%
 */
const AMAZON_EFFECTIVE_FEE_RATE = AMAZON_REFERRAL_FEE_RATE * (1 + AMAZON_DST_RATE) * (1 + VAT_RATE);

/**
 * Shipping cost thresholds for FBM
 */
const SHIPPING_THRESHOLD = 14.00;
const SHIPPING_COST_LOW = 3.00;  // For items < £14
const SHIPPING_COST_HIGH = 4.00; // For items >= £14

/**
 * Calculate margin percentage between Amazon sell price and BrickLink buy price
 *
 * @param amazonPrice - Amazon selling price
 * @param bricklinkPrice - BrickLink minimum buy price
 * @returns Margin percentage (0-100), or 0 if inputs invalid
 */
export function calculateMargin(amazonPrice: number, bricklinkPrice: number): number {
  if (amazonPrice <= 0 || bricklinkPrice <= 0) {
    return 0;
  }
  return ((amazonPrice - bricklinkPrice) / amazonPrice) * 100;
}

/**
 * Calculate gross profit and margin percentage
 *
 * @param amazonPrice - Amazon selling price
 * @param bricklinkPrice - BrickLink buy price
 * @returns Profit calculation with gross profit and margin percent
 */
export function calculateProfit(
  amazonPrice: number,
  bricklinkPrice: number
): ProfitCalculation {
  if (amazonPrice <= 0 || bricklinkPrice <= 0) {
    return { grossProfit: 0, marginPercent: 0 };
  }

  const grossProfit = amazonPrice - bricklinkPrice;
  const marginPercent = (grossProfit / amazonPrice) * 100;

  return { grossProfit, marginPercent };
}

/**
 * Format margin percentage for display
 *
 * @param margin - Margin percentage
 * @returns Formatted string like "+45.2%" or "-12.3%"
 */
export function formatMarginPercent(margin: number | null): string {
  if (margin === null || margin === undefined) {
    return '—';
  }
  const sign = margin >= 0 ? '+' : '';
  return `${sign}${margin.toFixed(1)}%`;
}

/**
 * Determine if an item is an "opportunity" based on margin threshold
 *
 * @param marginPercent - Calculated margin percentage
 * @param threshold - Minimum margin threshold (default 30%)
 * @returns True if margin meets or exceeds threshold
 */
export function isOpportunity(marginPercent: number | null, threshold: number = 30): boolean {
  return marginPercent !== null && marginPercent >= threshold;
}

/**
 * Format currency for UK display
 *
 * @param amount - Amount in GBP
 * @returns Formatted string like "£12.99"
 */
export function formatCurrencyGBP(amount: number | null): string {
  if (amount === null || amount === undefined) {
    return '—';
  }
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(amount);
}

/**
 * Format sales rank with proper number formatting
 *
 * @param rank - Sales rank number
 * @returns Formatted string like "#1,234"
 */
export function formatSalesRank(rank: number | null): string {
  if (rank === null || rank === undefined) {
    return '—';
  }
  return `#${new Intl.NumberFormat('en-GB').format(rank)}`;
}

/**
 * Calculate 90-day median price from historical snapshots
 *
 * @param prices - Array of historical prices
 * @returns Median price, or null if not enough data
 */
export function calculateMedianPrice(prices: number[]): number | null {
  const validPrices = prices.filter((p) => p > 0);

  if (validPrices.length === 0) {
    return null;
  }

  const sorted = [...validPrices].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }

  return sorted[mid];
}

// ============================================
// Amazon FBM UK Profit Calculations
// ============================================

/**
 * Get the shipping cost tier based on sale price
 *
 * @param salePrice - The sale price to customer
 * @returns Shipping cost and tier description
 */
export function getShippingCost(salePrice: number): { cost: number; tier: string } {
  if (salePrice < SHIPPING_THRESHOLD) {
    return { cost: SHIPPING_COST_LOW, tier: `Under £${SHIPPING_THRESHOLD}` };
  }
  return { cost: SHIPPING_COST_HIGH, tier: `£${SHIPPING_THRESHOLD} or over` };
}

/**
 * Calculate Amazon FBM profit breakdown for UK non-VAT registered seller
 *
 * Fee structure (2026 UK Toys & Games):
 * - Referral Fee: 15% of sale price
 * - Digital Services Tax: 2% surcharge on referral fee
 * - VAT on Fees: 20% (non-reclaimable)
 * - Effective total: 18.36% of sale price
 *
 * @param salePrice - Price shown to customer (free shipping)
 * @param productCost - Cost of acquiring the product (e.g., BrickLink price)
 * @returns Full profit breakdown with all fee components
 */
export function calculateAmazonFBMProfit(
  salePrice: number,
  productCost: number
): AmazonFBMProfitBreakdown | null {
  if (salePrice <= 0 || productCost <= 0) {
    return null;
  }

  // Fee calculations
  const referralFee = salePrice * AMAZON_REFERRAL_FEE_RATE;
  const digitalServicesTax = referralFee * AMAZON_DST_RATE;
  const subtotalFee = referralFee + digitalServicesTax;
  const vatOnFees = subtotalFee * VAT_RATE;
  const totalAmazonFee = subtotalFee + vatOnFees;

  // Shipping cost based on price tier
  const shipping = getShippingCost(salePrice);
  const shippingCost = shipping.cost;
  const shippingTier = shipping.tier;

  // Profit calculations
  const netPayout = salePrice - totalAmazonFee - shippingCost;
  const totalProfit = netPayout - productCost;
  const roiPercent = (totalProfit / productCost) * 100;
  const profitMarginPercent = (totalProfit / salePrice) * 100;

  return {
    // Input values
    salePrice,
    productCost,

    // Fee breakdown
    referralFee,
    referralFeeRate: AMAZON_REFERRAL_FEE_RATE,
    digitalServicesTax,
    dstRate: AMAZON_DST_RATE,
    vatOnFees,
    vatRate: VAT_RATE,
    totalAmazonFee,
    effectiveFeeRate: AMAZON_EFFECTIVE_FEE_RATE,

    // Shipping
    shippingCost,
    shippingTier,
    shippingThreshold: SHIPPING_THRESHOLD,

    // Results
    netPayout,
    totalProfit,
    roiPercent,
    profitMarginPercent,
  };
}

/**
 * Format ROI percentage for display
 *
 * @param roi - ROI percentage
 * @returns Formatted string like "+125.3%" or "-15.2%"
 */
export function formatROIPercent(roi: number | null): string {
  if (roi === null || roi === undefined) {
    return '—';
  }
  const sign = roi >= 0 ? '+' : '';
  return `${sign}${roi.toFixed(1)}%`;
}
