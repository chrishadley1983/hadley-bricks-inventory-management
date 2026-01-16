/**
 * Purchase Profitability Service
 *
 * Calculates profitability metrics for a purchase by aggregating
 * financial data from linked inventory items.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';

/**
 * Platform fee rates for estimating fees on unsold items
 */
const PLATFORM_FEE_RATES: Record<string, number> = {
  ebay: 0.18, // 18% (final value + payment processing)
  amazon: 0.1836, // 18.36% (15% referral x 1.02 DST x 1.20 VAT)
  bricklink: 0.03, // 3%
  'brick owl': 0.03, // 3%
  brickowl: 0.03, // 3%
  default: 0.1, // 10% fallback
};

/**
 * Get the estimated fee rate for a platform
 */
function getFeeRate(platform: string | null): number {
  if (!platform) return PLATFORM_FEE_RATES.default;
  const normalised = platform.toLowerCase().trim();
  return PLATFORM_FEE_RATES[normalised] ?? PLATFORM_FEE_RATES.default;
}

/**
 * Profitability metrics for a purchase
 */
export interface PurchaseProfitability {
  // Item counts
  totalItems: number;
  soldItems: number;
  listedItems: number;
  unlistedItems: number;
  itemsWithNoCost: number;
  itemsWithNoListingValue: number;

  // Financial - Realised (sold items)
  realisedRevenue: number;
  realisedFees: number;
  realisedCost: number;
  realisedProfit: number;
  realisedMarginPercent: number | null;

  // Financial - Unrealised (listed but not sold)
  unrealisedValue: number;
  estimatedFees: number;
  unrealisedCost: number;
  unrealisedProfit: number;
  unrealisedMarginPercent: number | null;

  // Totals
  totalCost: number;
  totalProjectedRevenue: number;
  totalProjectedFees: number;
  totalProjectedProfit: number;
  blendedMarginPercent: number | null;

  // Velocity
  firstListingDate: string | null;
  daysSinceFirstListing: number | null;
  itemsSoldPerWeek: number | null;
  projectedWeeksToSellRemaining: number | null;

  // Item-level details for display
  items: PurchaseItemProfitability[];
}

/**
 * Profitability data for a single inventory item
 */
export interface PurchaseItemProfitability {
  id: string;
  setNumber: string;
  itemName: string | null;
  condition: string | null;
  status: string | null;
  cost: number | null;
  hasCost: boolean;

  // For sold items
  soldGrossAmount: number | null;
  soldFeesAmount: number | null;
  soldNetAmount: number | null;
  soldProfit: number | null;
  soldMarginPercent: number | null;

  // For listed items
  listingValue: number | null;
  listingPlatform: string | null;
  estimatedFees: number | null;
  projectedProfit: number | null;
  projectedMarginPercent: number | null;
}

export class PurchaseProfitabilityService {
  constructor(
    private supabase: SupabaseClient<Database>,
    private userId: string
  ) {}

  /**
   * Calculate profitability metrics for a purchase
   */
  async calculateProfitability(purchaseId: string): Promise<PurchaseProfitability> {
    // Fetch the purchase to get the total cost
    const { data: purchase, error: purchaseError } = await this.supabase
      .from('purchases')
      .select('cost')
      .eq('id', purchaseId)
      .eq('user_id', this.userId)
      .single();

    if (purchaseError) {
      throw new Error(`Failed to fetch purchase: ${purchaseError.message}`);
    }

    const purchaseCost = purchase?.cost ?? 0;

    // Fetch all inventory items linked to this purchase
    const { data: inventoryItems, error } = await this.supabase
      .from('inventory_items')
      .select('*')
      .eq('purchase_id', purchaseId)
      .eq('user_id', this.userId);

    if (error) {
      throw new Error(`Failed to fetch inventory items: ${error.message}`);
    }

    const items = inventoryItems ?? [];

    // Calculate proportional costs for items without assigned costs
    // First, calculate total listing value for items without costs
    const itemsWithoutCost = items.filter((i) => !i.cost || i.cost <= 0);
    const itemsWithCost = items.filter((i) => i.cost && i.cost > 0);

    // Sum of costs already assigned
    const totalAssignedCost = itemsWithCost.reduce((sum, i) => sum + (i.cost ?? 0), 0);

    // Remaining cost to distribute proportionally
    const remainingCostToDistribute = Math.max(0, purchaseCost - totalAssignedCost);

    // Calculate total listing/sale value for items without costs (for proportional allocation)
    const totalValueForProportionalItems = itemsWithoutCost.reduce((sum, i) => {
      // Use sale amount if sold, otherwise listing value
      const isSold = i.status?.toUpperCase() === 'SOLD';
      if (isSold && i.sold_gross_amount && i.sold_gross_amount > 0) {
        return sum + i.sold_gross_amount;
      }
      if (i.listing_value && i.listing_value > 0) {
        return sum + i.listing_value;
      }
      return sum;
    }, 0);

    // Create a map of proportional costs for items without assigned costs
    const proportionalCostMap = new Map<string, number>();
    if (remainingCostToDistribute > 0 && totalValueForProportionalItems > 0) {
      for (const item of itemsWithoutCost) {
        const isSold = item.status?.toUpperCase() === 'SOLD';
        let itemValue = 0;
        if (isSold && item.sold_gross_amount && item.sold_gross_amount > 0) {
          itemValue = item.sold_gross_amount;
        } else if (item.listing_value && item.listing_value > 0) {
          itemValue = item.listing_value;
        }

        if (itemValue > 0) {
          const proportion = itemValue / totalValueForProportionalItems;
          proportionalCostMap.set(item.id, remainingCostToDistribute * proportion);
        }
      }
    }

    // Initialise counters
    let soldItems = 0;
    let listedItems = 0;
    let unlistedItems = 0;
    let itemsWithNoCost = 0;
    let itemsWithNoListingValue = 0;

    // Financial accumulators - Realised
    let realisedRevenue = 0;
    let realisedFees = 0;
    let realisedCost = 0;

    // Financial accumulators - Unrealised
    let unrealisedValue = 0;
    let estimatedFees = 0;
    let unrealisedCost = 0;

    // Track listing dates for velocity calculation
    const listingDates: Date[] = [];

    // Item-level details
    const itemDetails: PurchaseItemProfitability[] = [];

    for (const item of items) {
      const hasAssignedCost = item.cost !== null && item.cost > 0;
      const proportionalCost = proportionalCostMap.get(item.id);
      const hasProportionalCost = proportionalCost !== undefined && proportionalCost > 0;
      const hasCost = hasAssignedCost || hasProportionalCost;
      if (!hasAssignedCost) itemsWithNoCost++;

      const isSold = item.status?.toUpperCase() === 'SOLD';
      const hasListingValue = item.listing_value !== null && item.listing_value > 0;

      // Effective cost: use assigned cost if available, otherwise proportional cost
      const effectiveCost = hasAssignedCost ? (item.cost ?? 0) : (proportionalCost ?? 0);

      // Track listing date
      if (item.listing_date) {
        listingDates.push(new Date(item.listing_date));
      }

      // Build item detail
      const itemDetail: PurchaseItemProfitability = {
        id: item.id,
        setNumber: item.set_number,
        itemName: item.item_name,
        condition: item.condition,
        status: item.status,
        cost: hasCost ? effectiveCost : null,
        hasCost,
        soldGrossAmount: null,
        soldFeesAmount: null,
        soldNetAmount: null,
        soldProfit: null,
        soldMarginPercent: null,
        listingValue: null,
        listingPlatform: null,
        estimatedFees: null,
        projectedProfit: null,
        projectedMarginPercent: null,
      };

      if (isSold) {
        soldItems++;

        // Check if we have actual sale data, otherwise fall back to listing price + estimated fees
        const hasSaleData = item.sold_gross_amount !== null && item.sold_gross_amount > 0;

        let gross: number;
        let fees: number;
        let net: number;

        if (hasSaleData) {
          // Use actual sale data
          gross = item.sold_gross_amount ?? 0;
          fees = item.sold_fees_amount ?? 0;
          net = item.sold_net_amount ?? gross - fees;
        } else if (hasListingValue) {
          // Fall back to listing price with estimated fees
          gross = item.listing_value ?? 0;
          const feeRate = getFeeRate(item.listing_platform);
          fees = gross * feeRate;
          net = gross - fees;
        } else {
          // No sale data and no listing value - use zeros
          gross = 0;
          fees = 0;
          net = 0;
        }

        const profit = net - effectiveCost;

        realisedRevenue += gross;
        realisedFees += fees;
        realisedCost += effectiveCost;

        itemDetail.soldGrossAmount = hasSaleData ? item.sold_gross_amount : (hasListingValue ? item.listing_value : null);
        itemDetail.soldFeesAmount = hasSaleData ? item.sold_fees_amount : (hasListingValue ? fees : null);
        itemDetail.soldNetAmount = hasSaleData ? item.sold_net_amount : (hasListingValue ? net : null);
        itemDetail.soldProfit = hasCost ? profit : null;
        itemDetail.soldMarginPercent = gross > 0 && hasCost ? (profit / gross) * 100 : null;
      } else if (hasListingValue) {
        listedItems++;
        const listingVal = item.listing_value ?? 0;
        const feeRate = getFeeRate(item.listing_platform);
        const estFees = listingVal * feeRate;
        const projProfit = listingVal - estFees - effectiveCost;

        unrealisedValue += listingVal;
        estimatedFees += estFees;
        unrealisedCost += effectiveCost;

        itemDetail.listingValue = item.listing_value;
        itemDetail.listingPlatform = item.listing_platform;
        itemDetail.estimatedFees = estFees;
        itemDetail.projectedProfit = hasCost ? projProfit : null;
        itemDetail.projectedMarginPercent = listingVal > 0 && hasCost ? (projProfit / listingVal) * 100 : null;
      } else {
        unlistedItems++;
        if (!isSold) itemsWithNoListingValue++;
      }

      itemDetails.push(itemDetail);
    }

    // Calculate margins
    const realisedProfit = realisedRevenue - realisedFees - realisedCost;
    const realisedMarginPercent =
      realisedRevenue > 0 ? (realisedProfit / realisedRevenue) * 100 : null;

    const unrealisedProfit = unrealisedValue - estimatedFees - unrealisedCost;
    const unrealisedMarginPercent =
      unrealisedValue > 0 ? (unrealisedProfit / unrealisedValue) * 100 : null;

    // Totals
    const totalCost = realisedCost + unrealisedCost;
    const totalProjectedRevenue = realisedRevenue + unrealisedValue;
    const totalProjectedFees = realisedFees + estimatedFees;
    const totalProjectedProfit = realisedProfit + unrealisedProfit;
    const blendedMarginPercent =
      totalProjectedRevenue > 0 ? (totalProjectedProfit / totalProjectedRevenue) * 100 : null;

    // Velocity calculation
    let firstListingDate: string | null = null;
    let daysSinceFirstListing: number | null = null;
    let itemsSoldPerWeek: number | null = null;
    let projectedWeeksToSellRemaining: number | null = null;

    if (listingDates.length > 0) {
      listingDates.sort((a, b) => a.getTime() - b.getTime());
      const firstDate = listingDates[0];
      firstListingDate = firstDate.toISOString().split('T')[0];

      const now = new Date();
      daysSinceFirstListing = Math.floor(
        (now.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      const weeksSinceFirstListing = daysSinceFirstListing / 7;

      if (weeksSinceFirstListing > 0 && soldItems > 0) {
        itemsSoldPerWeek = soldItems / weeksSinceFirstListing;

        const remainingItems = items.length - soldItems;
        if (itemsSoldPerWeek > 0 && remainingItems > 0) {
          projectedWeeksToSellRemaining = remainingItems / itemsSoldPerWeek;
        }
      }
    }

    return {
      // Counts
      totalItems: items.length,
      soldItems,
      listedItems,
      unlistedItems,
      itemsWithNoCost,
      itemsWithNoListingValue,

      // Realised
      realisedRevenue,
      realisedFees,
      realisedCost,
      realisedProfit,
      realisedMarginPercent,

      // Unrealised
      unrealisedValue,
      estimatedFees,
      unrealisedCost,
      unrealisedProfit,
      unrealisedMarginPercent,

      // Totals
      totalCost,
      totalProjectedRevenue,
      totalProjectedFees,
      totalProjectedProfit,
      blendedMarginPercent,

      // Velocity
      firstListingDate,
      daysSinceFirstListing,
      itemsSoldPerWeek,
      projectedWeeksToSellRemaining,

      // Items
      items: itemDetails,
    };
  }
}
