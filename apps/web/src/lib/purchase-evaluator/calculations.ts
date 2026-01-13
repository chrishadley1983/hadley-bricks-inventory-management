/**
 * Purchase Evaluator Calculations
 *
 * Profit and cost calculation utilities specific to purchase evaluation.
 */

import type {
  EvaluationItem,
  EvaluationSummary,
  ProfitabilityResult,
  TargetPlatform,
} from './types';
import { calculateAmazonFBMProfit } from '../arbitrage/calculations';

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
const EBAY_PER_ORDER_FEE = 0.30; // £0.30

/**
 * Estimated PayPal/eBay Managed Payments fee
 */
const EBAY_PAYMENT_PROCESSING_RATE = 0.025; // 2.5%

/**
 * Estimated average shipping cost for LEGO sets
 */
const EBAY_ESTIMATED_SHIPPING = 4.00;

// ============================================
// COG Percentage Calculation
// ============================================

/**
 * Calculate Cost of Goods percentage
 *
 * COG% = (Cost / Selling Price) × 100
 *
 * @param cost - Product cost
 * @param sellPrice - Expected selling price
 * @returns COG percentage (0-100), or null if invalid
 */
export function calculateCOGPercent(cost: number, sellPrice: number): number | null {
  if (cost <= 0 || sellPrice <= 0) {
    return null;
  }
  return (cost / sellPrice) * 100;
}

// ============================================
// eBay Profitability Calculation
// ============================================

/**
 * Calculate eBay selling profitability
 *
 * Fee structure:
 * - Final Value Fee: 12.8%
 * - Regulatory Operating Fee: 0.36%
 * - Per-order fee: £0.30
 * - Payment processing: ~2.5%
 * - Shipping: estimated £4
 *
 * @param sellPrice - Expected selling price (Buy It Now)
 * @param productCost - Cost of acquiring the product
 * @returns Profitability breakdown, or null if invalid
 */
export function calculateEbayProfit(
  sellPrice: number,
  productCost: number
): {
  sellPrice: number;
  productCost: number;
  finalValueFee: number;
  regulatoryFee: number;
  perOrderFee: number;
  paymentProcessingFee: number;
  totalFees: number;
  shippingCost: number;
  netPayout: number;
  totalProfit: number;
  roiPercent: number;
  profitMarginPercent: number;
} | null {
  if (sellPrice <= 0 || productCost <= 0) {
    return null;
  }

  // Fee calculations
  const finalValueFee = sellPrice * EBAY_FINAL_VALUE_FEE_RATE;
  const regulatoryFee = sellPrice * EBAY_REGULATORY_FEE_RATE;
  const paymentProcessingFee = sellPrice * EBAY_PAYMENT_PROCESSING_RATE;
  const perOrderFee = EBAY_PER_ORDER_FEE;
  const totalFees = finalValueFee + regulatoryFee + paymentProcessingFee + perOrderFee;

  // Shipping
  const shippingCost = EBAY_ESTIMATED_SHIPPING;

  // Profit calculations
  const netPayout = sellPrice - totalFees - shippingCost;
  const totalProfit = netPayout - productCost;
  const roiPercent = (totalProfit / productCost) * 100;
  const profitMarginPercent = (totalProfit / sellPrice) * 100;

  return {
    sellPrice,
    productCost,
    finalValueFee,
    regulatoryFee,
    perOrderFee,
    paymentProcessingFee,
    totalFees,
    shippingCost,
    netPayout,
    totalProfit,
    roiPercent,
    profitMarginPercent,
  };
}

// ============================================
// Unified Profitability Calculation
// ============================================

/**
 * Calculate profitability for an item based on target platform
 *
 * @param item - Evaluation item with pricing data
 * @returns Profitability result
 */
export function calculateItemProfitability(item: {
  targetPlatform: TargetPlatform;
  allocatedCost: number | null;
  unitCost: number | null;
  amazonBuyBoxPrice: number | null;
  amazonWasPrice: number | null;
  ebaySoldAvgPrice: number | null;
  ebayAvgPrice: number | null;
  userSellPriceOverride: number | null;
}): ProfitabilityResult | null {
  // Get cost (allocated or unit)
  const cost = item.allocatedCost ?? item.unitCost;
  if (!cost || cost <= 0) {
    return null;
  }

  // Determine expected sell price
  let expectedSellPrice: number | null = null;

  // User override takes precedence
  if (item.userSellPriceOverride && item.userSellPriceOverride > 0) {
    expectedSellPrice = item.userSellPriceOverride;
  } else if (item.targetPlatform === 'amazon') {
    // For Amazon: prefer buy box, then was price
    expectedSellPrice = item.amazonBuyBoxPrice ?? item.amazonWasPrice ?? null;
  } else {
    // For eBay: prefer sold average, then active average
    expectedSellPrice = item.ebaySoldAvgPrice ?? item.ebayAvgPrice ?? null;
  }

  if (!expectedSellPrice || expectedSellPrice <= 0) {
    return null;
  }

  // Calculate platform-specific profitability
  if (item.targetPlatform === 'amazon') {
    const amazonProfit = calculateAmazonFBMProfit(expectedSellPrice, cost);
    if (!amazonProfit) return null;

    return {
      expectedSellPrice,
      cogPercent: (cost / expectedSellPrice) * 100,
      grossProfit: amazonProfit.totalProfit,
      profitMarginPercent: amazonProfit.profitMarginPercent,
      roiPercent: amazonProfit.roiPercent,
    };
  } else {
    const ebayProfit = calculateEbayProfit(expectedSellPrice, cost);
    if (!ebayProfit) return null;

    return {
      expectedSellPrice,
      cogPercent: (cost / expectedSellPrice) * 100,
      grossProfit: ebayProfit.totalProfit,
      profitMarginPercent: ebayProfit.profitMarginPercent,
      roiPercent: ebayProfit.roiPercent,
    };
  }
}

// ============================================
// Cost Allocation
// ============================================

/**
 * Allocate total purchase cost proportionally based on listing price
 *
 * Formula: Item Cost = (Total Cost / Sum of all listing prices) × Item Listing Price
 *
 * Priority for price:
 * 1. Amazon Buy Box price
 * 2. Amazon Was Price
 * 3. User sell price override (manual entry)
 *
 * Items without any pricing get £0 allocated (user can override manually).
 *
 * @param items - Items with pricing data
 * @param totalCost - Total purchase price
 * @returns Array of allocated costs in same order as items
 */
export function allocateCostsByBuyBox(
  items: Array<{
    amazonBuyBoxPrice: number | null;
    amazonWasPrice: number | null;
    userSellPriceOverride: number | null;
    quantity: number;
  }>,
  totalCost: number
): number[] {
  if (items.length === 0 || totalCost <= 0) {
    return items.map(() => 0);
  }

  // Get effective price for each item (Buy Box, then Was Price, then user override)
  const effectivePrices = items.map((item) => {
    if (item.amazonBuyBoxPrice && item.amazonBuyBoxPrice > 0) {
      return item.amazonBuyBoxPrice;
    }
    if (item.amazonWasPrice && item.amazonWasPrice > 0) {
      return item.amazonWasPrice;
    }
    if (item.userSellPriceOverride && item.userSellPriceOverride > 0) {
      return item.userSellPriceOverride;
    }
    return null;
  });

  // Calculate total effective price for items that have pricing
  let totalEffectivePrice = 0;
  for (let i = 0; i < items.length; i++) {
    const price = effectivePrices[i];
    if (price !== null) {
      totalEffectivePrice += price * items[i].quantity;
    }
  }

  // If no items have pricing, return all zeros (user must manually input)
  if (totalEffectivePrice === 0) {
    return items.map(() => 0);
  }

  // Calculate cost per price unit
  const costPerPriceUnit = totalCost / totalEffectivePrice;

  // Allocate to items with pricing, £0 for items without
  const allocations: number[] = [];

  for (let i = 0; i < items.length; i++) {
    const price = effectivePrices[i];
    if (price !== null) {
      const allocated = price * costPerPriceUnit;
      allocations.push(allocated);
    } else {
      // No pricing available - user must manually input cost
      allocations.push(0);
    }
  }

  return allocations;
}

/**
 * @deprecated Use allocateCostsByBuyBox instead
 * Allocate total purchase cost proportionally based on RRP
 *
 * Formula: Item Cost = (Total Cost / Sum of all RRPs) × Item RRP
 *
 * Items without RRP get equal share of remaining unallocated amount
 *
 * @param items - Items with ukRetailPrice (RRP)
 * @param totalCost - Total purchase price
 * @returns Array of allocated costs in same order as items
 */
export function allocateCostsProportionally(
  items: Array<{ ukRetailPrice: number | null; quantity: number }>,
  totalCost: number
): number[] {
  if (items.length === 0 || totalCost <= 0) {
    return items.map(() => 0);
  }

  // Calculate total RRP for items that have it
  let totalRrp = 0;
  let itemsWithRrp = 0;
  let itemsWithoutRrp = 0;

  for (const item of items) {
    if (item.ukRetailPrice && item.ukRetailPrice > 0) {
      totalRrp += item.ukRetailPrice * item.quantity;
      itemsWithRrp += item.quantity;
    } else {
      itemsWithoutRrp += item.quantity;
    }
  }

  // If no items have RRP, split equally
  if (totalRrp === 0) {
    const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
    const costPerItem = totalCost / totalQuantity;
    return items.map((_item) => costPerItem);
  }

  // Calculate cost per RRP unit
  const costPerRrpUnit = totalCost / totalRrp;

  // Allocate to items with RRP
  const allocations: number[] = [];
  let allocatedTotal = 0;

  for (const item of items) {
    if (item.ukRetailPrice && item.ukRetailPrice > 0) {
      const allocated = item.ukRetailPrice * costPerRrpUnit;
      allocations.push(allocated);
      allocatedTotal += allocated * item.quantity;
    } else {
      // Placeholder for items without RRP
      allocations.push(0);
    }
  }

  // If there are items without RRP, give them average of allocated items
  if (itemsWithoutRrp > 0 && itemsWithRrp > 0) {
    const avgAllocated = allocatedTotal / itemsWithRrp;
    for (let i = 0; i < allocations.length; i++) {
      if (allocations[i] === 0) {
        allocations[i] = avgAllocated;
      }
    }
  }

  return allocations;
}

/**
 * Allocate costs equally across all items
 *
 * @param items - Items to allocate to
 * @param totalCost - Total purchase price
 * @returns Array of allocated costs (all equal)
 */
export function allocateCostsEqually(
  items: Array<{ quantity: number }>,
  totalCost: number
): number[] {
  if (items.length === 0 || totalCost <= 0) {
    return items.map(() => 0);
  }

  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const costPerItem = totalCost / totalQuantity;

  return items.map(() => costPerItem);
}

// ============================================
// Summary Calculation
// ============================================

/**
 * Calculate overall evaluation summary
 *
 * @param items - Evaluation items with profitability data
 * @returns Summary statistics
 */
export function calculateEvaluationSummary(
  items: EvaluationItem[]
): EvaluationSummary {
  const itemCount = items.length;
  let itemsWithCost = 0;
  let itemsWithPrice = 0;
  let itemsNeedingReview = 0;
  let totalCost = 0;
  let totalExpectedRevenue = 0;
  let totalGrossProfit = 0;
  let cogPercentSum = 0;
  let cogPercentCount = 0;

  for (const item of items) {
    const qty = item.quantity || 1;
    const cost = item.allocatedCost ?? item.unitCost;

    if (cost && cost > 0) {
      itemsWithCost++;
      totalCost += cost * qty;
    }

    if (item.expectedSellPrice && item.expectedSellPrice > 0) {
      itemsWithPrice++;
      totalExpectedRevenue += item.expectedSellPrice * qty;
    }

    if (item.grossProfit !== null) {
      totalGrossProfit += item.grossProfit * qty;
    }

    if (item.cogPercent !== null) {
      cogPercentSum += item.cogPercent;
      cogPercentCount++;
    }

    if (item.needsReview) {
      itemsNeedingReview++;
    }
  }

  const overallMarginPercent =
    totalExpectedRevenue > 0
      ? (totalGrossProfit / totalExpectedRevenue) * 100
      : 0;

  const overallRoiPercent =
    totalCost > 0 ? (totalGrossProfit / totalCost) * 100 : 0;

  const averageCogPercent =
    cogPercentCount > 0 ? cogPercentSum / cogPercentCount : 0;

  return {
    itemCount,
    itemsWithCost,
    itemsWithPrice,
    itemsNeedingReview,
    totalCost,
    totalExpectedRevenue,
    totalGrossProfit,
    overallMarginPercent,
    overallRoiPercent,
    averageCogPercent,
  };
}
