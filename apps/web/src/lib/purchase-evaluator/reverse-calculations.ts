/**
 * Reverse Calculations for Purchase Evaluator
 *
 * Calculates maximum purchase price based on expected sell price and target profit margin.
 * This is the inverse of the standard profit calculation.
 *
 * Formula: MaxCost = SellPrice - Fees(SellPrice) - TargetProfit
 * Where: TargetProfit = SellPrice × TargetMargin
 */

import type { EbayFeeBreakdown, AmazonFeeBreakdown, AuctionBreakdown } from './photo-types';

// ============================================
// eBay Fee Constants (UK 2026)
// ============================================

/**
 * eBay final value fee for electronics/collectibles category
 * Standard rate for Store subscribers
 */
const EBAY_FINAL_VALUE_FEE_RATE = 0.128; // 12.8%

/**
 * eBay regulatory operating fee (UK)
 */
const EBAY_REGULATORY_FEE_RATE = 0.0036; // 0.36%

/**
 * eBay per-order fee
 */
const EBAY_PER_ORDER_FEE = 0.3; // £0.30

/**
 * Estimated PayPal/eBay Managed Payments fee
 */
const EBAY_PAYMENT_PROCESSING_RATE = 0.025; // 2.5%

/**
 * Estimated average shipping cost for LEGO sets
 */
const EBAY_ESTIMATED_SHIPPING = 4.0;

// ============================================
// Amazon Fee Constants (UK 2026)
// ============================================

/**
 * Amazon referral fee for Toys & Games category
 */
const AMAZON_REFERRAL_FEE_RATE = 0.15; // 15%

/**
 * Digital Services Tax (DST) on fees
 */
const AMAZON_DST_RATE = 0.02; // 2% of referral fee

/**
 * VAT on Amazon fees
 */
const AMAZON_VAT_RATE = 0.2; // 20%

/**
 * Estimated shipping cost thresholds
 */
const AMAZON_SHIPPING_THRESHOLD = 14;
const AMAZON_SHIPPING_BELOW_THRESHOLD = 3.0;
const AMAZON_SHIPPING_ABOVE_THRESHOLD = 4.0;

// ============================================
// eBay Max Purchase Price Calculation
// ============================================

/**
 * Calculate the maximum purchase price for eBay to achieve target margin
 *
 * Given:
 * - Expected sell price on eBay
 * - Target profit margin (as percentage of sell price)
 *
 * Returns the maximum you should pay for the item to achieve that margin.
 *
 * @param sellPrice - Expected selling price on eBay (Buy It Now)
 * @param targetMarginPercent - Target profit margin as percentage (e.g., 30 for 30%)
 * @returns Fee breakdown and max purchase price
 */
export function calculateMaxPurchasePriceEbay(
  sellPrice: number,
  targetMarginPercent: number
): EbayFeeBreakdown {
  if (sellPrice <= 0) {
    return {
      sellPrice: 0,
      finalValueFee: 0,
      regulatoryFee: 0,
      perOrderFee: 0,
      paymentProcessingFee: 0,
      totalFees: 0,
      shippingCost: 0,
      targetProfit: 0,
      maxPurchasePrice: 0,
    };
  }

  const targetMargin = targetMarginPercent / 100;

  // Calculate fees
  const finalValueFee = sellPrice * EBAY_FINAL_VALUE_FEE_RATE;
  const regulatoryFee = sellPrice * EBAY_REGULATORY_FEE_RATE;
  const paymentProcessingFee = sellPrice * EBAY_PAYMENT_PROCESSING_RATE;
  const perOrderFee = EBAY_PER_ORDER_FEE;
  const totalFees = finalValueFee + regulatoryFee + paymentProcessingFee + perOrderFee;

  // Shipping cost
  const shippingCost = EBAY_ESTIMATED_SHIPPING;

  // Target profit
  const targetProfit = sellPrice * targetMargin;

  // Max purchase price = Sell price - Fees - Shipping - Target Profit
  const maxPurchasePrice = Math.max(0, sellPrice - totalFees - shippingCost - targetProfit);

  return {
    sellPrice,
    finalValueFee: Math.round(finalValueFee * 100) / 100,
    regulatoryFee: Math.round(regulatoryFee * 100) / 100,
    perOrderFee,
    paymentProcessingFee: Math.round(paymentProcessingFee * 100) / 100,
    totalFees: Math.round(totalFees * 100) / 100,
    shippingCost,
    targetProfit: Math.round(targetProfit * 100) / 100,
    maxPurchasePrice: Math.round(maxPurchasePrice * 100) / 100,
  };
}

// ============================================
// Amazon Max Purchase Price Calculation
// ============================================

/**
 * Calculate the maximum purchase price for Amazon FBM to achieve target margin
 *
 * Given:
 * - Expected sell price on Amazon
 * - Target profit margin (as percentage of sell price)
 *
 * Returns the maximum you should pay for the item to achieve that margin.
 *
 * @param sellPrice - Expected selling price on Amazon
 * @param targetMarginPercent - Target profit margin as percentage (e.g., 30 for 30%)
 * @returns Fee breakdown and max purchase price
 */
export function calculateMaxPurchasePriceAmazon(
  sellPrice: number,
  targetMarginPercent: number
): AmazonFeeBreakdown {
  if (sellPrice <= 0) {
    return {
      sellPrice: 0,
      referralFee: 0,
      digitalServicesTax: 0,
      vatOnFees: 0,
      totalFees: 0,
      shippingCost: 0,
      targetProfit: 0,
      maxPurchasePrice: 0,
    };
  }

  const targetMargin = targetMarginPercent / 100;

  // Calculate fees
  const referralFee = sellPrice * AMAZON_REFERRAL_FEE_RATE;
  const digitalServicesTax = referralFee * AMAZON_DST_RATE;
  const vatOnFees = (referralFee + digitalServicesTax) * AMAZON_VAT_RATE;
  const totalFees = referralFee + digitalServicesTax + vatOnFees;

  // Shipping cost based on price threshold
  const shippingCost =
    sellPrice >= AMAZON_SHIPPING_THRESHOLD
      ? AMAZON_SHIPPING_ABOVE_THRESHOLD
      : AMAZON_SHIPPING_BELOW_THRESHOLD;

  // Target profit
  const targetProfit = sellPrice * targetMargin;

  // Max purchase price = Sell price - Fees - Shipping - Target Profit
  const maxPurchasePrice = Math.max(0, sellPrice - totalFees - shippingCost - targetProfit);

  return {
    sellPrice,
    referralFee: Math.round(referralFee * 100) / 100,
    digitalServicesTax: Math.round(digitalServicesTax * 100) / 100,
    vatOnFees: Math.round(vatOnFees * 100) / 100,
    totalFees: Math.round(totalFees * 100) / 100,
    shippingCost,
    targetProfit: Math.round(targetProfit * 100) / 100,
    maxPurchasePrice: Math.round(maxPurchasePrice * 100) / 100,
  };
}

// ============================================
// Combined Max Purchase Price Calculation
// ============================================

/**
 * Platform type for calculations
 */
export type MaxBidPlatform = 'amazon' | 'ebay' | 'both';

/**
 * Combined result for both platforms
 */
export interface MaxPurchasePriceResult {
  amazon: AmazonFeeBreakdown | null;
  ebay: EbayFeeBreakdown | null;
  recommendedMaxPrice: number;
  recommendedPlatform: 'amazon' | 'ebay' | null;
}

/**
 * Calculate max purchase price for both platforms and recommend the better option
 *
 * @param amazonSellPrice - Expected sell price on Amazon (or null if not listing there)
 * @param ebaySellPrice - Expected sell price on eBay (or null if not listing there)
 * @param targetMarginPercent - Target profit margin as percentage
 * @returns Combined results with recommendation
 */
export function calculateMaxPurchasePriceBoth(
  amazonSellPrice: number | null,
  ebaySellPrice: number | null,
  targetMarginPercent: number
): MaxPurchasePriceResult {
  const amazon =
    amazonSellPrice && amazonSellPrice > 0
      ? calculateMaxPurchasePriceAmazon(amazonSellPrice, targetMarginPercent)
      : null;

  const ebay =
    ebaySellPrice && ebaySellPrice > 0
      ? calculateMaxPurchasePriceEbay(ebaySellPrice, targetMarginPercent)
      : null;

  // Determine recommended platform (higher max purchase price = more room to bid)
  let recommendedMaxPrice = 0;
  let recommendedPlatform: 'amazon' | 'ebay' | null = null;

  if (amazon && ebay) {
    if (amazon.maxPurchasePrice >= ebay.maxPurchasePrice) {
      recommendedMaxPrice = amazon.maxPurchasePrice;
      recommendedPlatform = 'amazon';
    } else {
      recommendedMaxPrice = ebay.maxPurchasePrice;
      recommendedPlatform = 'ebay';
    }
  } else if (amazon) {
    recommendedMaxPrice = amazon.maxPurchasePrice;
    recommendedPlatform = 'amazon';
  } else if (ebay) {
    recommendedMaxPrice = ebay.maxPurchasePrice;
    recommendedPlatform = 'ebay';
  }

  return {
    amazon,
    ebay,
    recommendedMaxPrice,
    recommendedPlatform,
  };
}

// ============================================
// Lot Total Calculation
// ============================================

/**
 * Item with pricing for lot calculation
 */
export interface LotItem {
  amazonSellPrice: number | null;
  ebaySellPrice: number | null;
  quantity: number;
}

/**
 * Result for lot total calculation
 */
export interface LotMaxPurchaseResult {
  totalMaxPurchasePrice: number;
  itemCount: number;
  itemsWithPricing: number;
  itemBreakdown: Array<{
    index: number;
    maxPrice: number;
    platform: 'amazon' | 'ebay' | null;
  }>;
}

/**
 * Calculate total maximum purchase price for a lot of items
 *
 * @param items - Array of items with sell prices
 * @param targetMarginPercent - Target profit margin as percentage
 * @returns Total max purchase price for the lot
 */
export function calculateLotMaxPurchasePrice(
  items: LotItem[],
  targetMarginPercent: number
): LotMaxPurchaseResult {
  let totalMaxPurchasePrice = 0;
  let itemsWithPricing = 0;
  const itemBreakdown: LotMaxPurchaseResult['itemBreakdown'] = [];

  items.forEach((item, index) => {
    const result = calculateMaxPurchasePriceBoth(
      item.amazonSellPrice,
      item.ebaySellPrice,
      targetMarginPercent
    );

    const itemMaxPrice = result.recommendedMaxPrice * item.quantity;
    totalMaxPurchasePrice += itemMaxPrice;

    if (result.recommendedMaxPrice > 0) {
      itemsWithPricing++;
    }

    itemBreakdown.push({
      index,
      maxPrice: itemMaxPrice,
      platform: result.recommendedPlatform,
    });
  });

  return {
    totalMaxPurchasePrice: Math.round(totalMaxPurchasePrice * 100) / 100,
    itemCount: items.length,
    itemsWithPricing,
    itemBreakdown,
  };
}

// ============================================
// Formatting Utilities
// ============================================

/**
 * Format currency value for display
 */
export function formatMaxPrice(value: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(value);
}

/**
 * Get color class based on max price viability
 * Higher max price = more room to bid = better
 */
export function getMaxPriceColor(maxPrice: number, sellPrice: number): string {
  if (sellPrice <= 0) return 'text-gray-500';

  const ratio = maxPrice / sellPrice;

  if (ratio >= 0.5) return 'text-emerald-600'; // Can pay up to 50% of sell price
  if (ratio >= 0.4) return 'text-green-600'; // Can pay up to 40%
  if (ratio >= 0.3) return 'text-yellow-600'; // Can pay up to 30%
  if (ratio >= 0.2) return 'text-orange-600'; // Can pay up to 20%
  return 'text-red-600'; // Less than 20% margin for cost
}

// ============================================
// Auction Mode Calculations
// ============================================

/**
 * Calculate platform fees for an item (fees + shipping) without the target profit deduction
 *
 * This is used to calculate the total fees for a lot of items when determining
 * the auction max bid from total revenue.
 *
 * @param sellPrice - Expected selling price
 * @param platform - Target platform ('amazon' or 'ebay')
 * @returns Total fees including platform fees and shipping
 */
export function calculatePlatformFeesOnly(
  sellPrice: number,
  platform: 'amazon' | 'ebay'
): { fees: number; shipping: number; total: number } {
  if (sellPrice <= 0) {
    return { fees: 0, shipping: 0, total: 0 };
  }

  if (platform === 'ebay') {
    const finalValueFee = sellPrice * EBAY_FINAL_VALUE_FEE_RATE;
    const regulatoryFee = sellPrice * EBAY_REGULATORY_FEE_RATE;
    const paymentProcessingFee = sellPrice * EBAY_PAYMENT_PROCESSING_RATE;
    const perOrderFee = EBAY_PER_ORDER_FEE;
    const fees = finalValueFee + regulatoryFee + paymentProcessingFee + perOrderFee;
    const shipping = EBAY_ESTIMATED_SHIPPING;
    return {
      fees: Math.round(fees * 100) / 100,
      shipping,
      total: Math.round((fees + shipping) * 100) / 100,
    };
  } else {
    // Amazon
    const referralFee = sellPrice * AMAZON_REFERRAL_FEE_RATE;
    const digitalServicesTax = referralFee * AMAZON_DST_RATE;
    const vatOnFees = (referralFee + digitalServicesTax) * AMAZON_VAT_RATE;
    const fees = referralFee + digitalServicesTax + vatOnFees;
    const shipping =
      sellPrice >= AMAZON_SHIPPING_THRESHOLD
        ? AMAZON_SHIPPING_ABOVE_THRESHOLD
        : AMAZON_SHIPPING_BELOW_THRESHOLD;
    return {
      fees: Math.round(fees * 100) / 100,
      shipping,
      total: Math.round((fees + shipping) * 100) / 100,
    };
  }
}

/**
 * Calculate auction max bid directly from total revenue and platform fees
 *
 * This is the CORRECT way to calculate max bid for a lot:
 * 1. Calculate target profit: Revenue × Target Margin %
 * 2. Calculate max total paid at auction: Revenue - Platform Fees - Target Profit
 * 3. Convert max total paid to max bid: (Max Total - Auction Shipping) / (1 + Commission Rate)
 *
 * This avoids the double-accounting bug of calculating per-item max purchase prices
 * (which already deduct target profit) and then summing them.
 *
 * @param totalRevenue - Total expected revenue from selling all items
 * @param totalPlatformFees - Total platform fees (selling fees + shipping) for all items
 * @param targetMarginPercent - Target profit margin as percentage (e.g., 10 for 10%)
 * @param commissionPercent - Auction commission as percentage (e.g., 32.94 for 32.94%)
 * @param auctionShippingCost - Shipping cost from auction house
 * @returns Breakdown with max bid, commission, and expected profit
 */
export function calculateAuctionMaxBidFromRevenue(
  totalRevenue: number,
  totalPlatformFees: number,
  targetMarginPercent: number,
  commissionPercent: number,
  auctionShippingCost: number
): AuctionBreakdown & { targetProfit: number; platformFees: number } {
  if (totalRevenue <= 0) {
    return {
      maxBid: 0,
      commission: 0,
      shippingCost: 0,
      totalPaid: 0,
      targetProfit: 0,
      platformFees: 0,
    };
  }

  const targetMargin = targetMarginPercent / 100;
  const commissionRate = commissionPercent / 100;

  // Step 1: Calculate target profit from revenue
  const targetProfit = totalRevenue * targetMargin;

  // Step 2: Calculate max total you can pay at auction
  // MaxTotalPaid = Revenue - Platform Fees - Target Profit
  const maxTotalPaid = Math.max(0, totalRevenue - totalPlatformFees - targetProfit);

  // Step 3: Convert to max bid
  // MaxBid = (MaxTotalPaid - AuctionShipping) / (1 + CommissionRate)
  const availableForBidAndCommission = Math.max(0, maxTotalPaid - auctionShippingCost);
  const maxBid = availableForBidAndCommission / (1 + commissionRate);
  const commission = maxBid * commissionRate;
  const totalPaid = maxBid + commission + auctionShippingCost;

  return {
    maxBid: Math.round(maxBid * 100) / 100,
    commission: Math.round(commission * 100) / 100,
    shippingCost: Math.round(auctionShippingCost * 100) / 100,
    totalPaid: Math.round(totalPaid * 100) / 100,
    targetProfit: Math.round(targetProfit * 100) / 100,
    platformFees: Math.round(totalPlatformFees * 100) / 100,
  };
}

/**
 * Calculate max bid for auction, accounting for commission and shipping
 *
 * The max purchase price is what you can afford to pay total (including all auction costs).
 * We work backwards to find the max bid:
 *
 * Total Paid = Max Bid + (Max Bid × Commission%) + Shipping
 * Total Paid = Max Bid × (1 + Commission%) + Shipping
 * Max Bid = (Total Paid - Shipping) / (1 + Commission%)
 *
 * Where Total Paid = Max Purchase Price (what we calculated from platform fees/margin)
 *
 * @param maxPurchasePrice - Maximum total amount you can pay (from platform calculation)
 * @param commissionPercent - Auction commission as percentage (e.g., 32.94 for 32.94%)
 * @param shippingCost - Shipping cost from auction house
 * @returns Breakdown with max bid, commission, and total paid
 */
export function calculateMaxBidForAuction(
  maxPurchasePrice: number,
  commissionPercent: number,
  shippingCost: number
): AuctionBreakdown {
  if (maxPurchasePrice <= 0) {
    return {
      maxBid: 0,
      commission: 0,
      shippingCost: 0,
      totalPaid: 0,
    };
  }

  const commissionRate = commissionPercent / 100;

  // Calculate how much is available for bid + commission after shipping
  const availableForBidAndCommission = Math.max(0, maxPurchasePrice - shippingCost);

  // Max Bid × (1 + Commission Rate) = Available
  // Max Bid = Available / (1 + Commission Rate)
  const maxBid = availableForBidAndCommission / (1 + commissionRate);
  const commission = maxBid * commissionRate;
  const totalPaid = maxBid + commission + shippingCost;

  return {
    maxBid: Math.round(maxBid * 100) / 100,
    commission: Math.round(commission * 100) / 100,
    shippingCost: Math.round(shippingCost * 100) / 100,
    totalPaid: Math.round(totalPaid * 100) / 100,
  };
}

/**
 * Calculate total paid from a given bid amount
 *
 * Use this when you want to see what a specific bid will cost you total.
 *
 * @param bidAmount - The bid amount you want to enter
 * @param commissionPercent - Auction commission as percentage
 * @param shippingCost - Shipping cost from auction house
 * @returns Commission and total paid
 */
export function calculateTotalPaidFromBid(
  bidAmount: number,
  commissionPercent: number,
  shippingCost: number
): { commission: number; totalPaid: number } {
  if (bidAmount <= 0) {
    return {
      commission: 0,
      totalPaid: shippingCost,
    };
  }

  const commission = bidAmount * (commissionPercent / 100);
  const totalPaid = bidAmount + commission + shippingCost;

  return {
    commission: Math.round(commission * 100) / 100,
    totalPaid: Math.round(totalPaid * 100) / 100,
  };
}

/**
 * Calculate auction breakdown for a lot total
 *
 * For a lot with multiple items, the shipping is for the whole lot,
 * but each item contributes proportionally to the max bid.
 *
 * @param totalMaxPurchasePrice - Total max purchase price for all items
 * @param commissionPercent - Auction commission as percentage
 * @param shippingCost - Shipping cost for entire lot
 * @returns Breakdown for the entire lot
 */
export function calculateLotAuctionBreakdown(
  totalMaxPurchasePrice: number,
  commissionPercent: number,
  shippingCost: number
): AuctionBreakdown {
  return calculateMaxBidForAuction(totalMaxPurchasePrice, commissionPercent, shippingCost);
}
