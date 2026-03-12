/**
 * Markdown Engine Service
 *
 * Calculates markdown prices for Amazon and eBay based on aging brackets,
 * market data, and configurable thresholds. Respects price floors.
 */

import { roundToNearestCharm } from '@/lib/minifig-sync/pricing-engine';
import type {
  MarkdownConfig,
  MarkdownProposal,
  InventoryItemForMarkdown,
  PricingData,
  Platform,
  ProposedAction,
  ProposalStatus,
} from './types';
import { diagnoseItem, calculateAgingDays } from './diagnosis.service';

/**
 * Calculate the price floor (breakeven after platform fees).
 * Floor = cost / (1 - feeRate)
 */
export function calculatePriceFloor(cost: number, feeRate: number): number {
  if (cost <= 0) return 0;
  return Math.round((cost / (1 - feeRate)) * 100) / 100;
}

/**
 * Clamp a price to the charm-rounded floor.
 * If the calculated markdown price is below floor, return the charm-rounded floor.
 */
function clampToFloor(price: number, floor: number): number {
  if (price < floor) {
    return roundToNearestCharm(floor + 0.01); // round up to next charm above floor
  }
  return price;
}

/**
 * Calculate Amazon markdown price based on aging step.
 * Step 1: Match market (Keepa 90d avg)
 * Step 2: Undercut market by X%
 * Step 3: Undercut market by Y%
 * Step 4: Floor price (breakeven)
 */
function calculateAmazonMarkdownPrice(
  currentPrice: number,
  marketPrice: number,
  config: MarkdownConfig,
  agingDays: number,
  floor: number
): { price: number; step: number } {
  let step: number;
  let rawPrice: number;

  if (agingDays >= config.amazon_step4_days) {
    step = 4;
    rawPrice = floor;
  } else if (agingDays >= config.amazon_step3_days) {
    step = 3;
    rawPrice = marketPrice * (1 - config.amazon_step3_undercut_pct / 100);
  } else if (agingDays >= config.amazon_step2_days) {
    step = 2;
    rawPrice = marketPrice * (1 - config.amazon_step2_undercut_pct / 100);
  } else {
    step = 1;
    rawPrice = marketPrice;
  }

  const charmPrice = roundToNearestCharm(rawPrice);
  const finalPrice = clampToFloor(charmPrice, floor);

  // Don't propose a price higher than current
  if (finalPrice >= currentPrice) {
    return { price: currentPrice, step };
  }

  return { price: finalPrice, step };
}

/**
 * Calculate eBay markdown price based on aging step.
 * Step 1: Reduce by X% from current price
 * Step 2: Reduce by Y% from current price
 * Step 3: Floor price (breakeven)
 * Step 4: Recommend auction
 */
function calculateEbayMarkdownPrice(
  currentPrice: number,
  config: MarkdownConfig,
  agingDays: number,
  floor: number
): { price: number | null; step: number; action: ProposedAction } {
  if (agingDays >= config.ebay_step4_days) {
    return { price: null, step: 4, action: 'AUCTION' };
  }

  let step: number;
  let rawPrice: number;

  if (agingDays >= config.ebay_step3_days) {
    step = 3;
    rawPrice = floor;
  } else if (agingDays >= config.ebay_step2_days) {
    step = 2;
    rawPrice = currentPrice * (1 - config.ebay_step2_reduction_pct / 100);
  } else {
    step = 1;
    rawPrice = currentPrice * (1 - config.ebay_step1_reduction_pct / 100);
  }

  const charmPrice = roundToNearestCharm(rawPrice);
  const finalPrice = clampToFloor(charmPrice, floor);

  if (finalPrice >= currentPrice) {
    return { price: currentPrice, step, action: 'MARKDOWN' };
  }

  return { price: finalPrice, step, action: 'MARKDOWN' };
}

/**
 * Generate a markdown proposal for a single inventory item.
 * Returns null if no action is needed.
 */
export function generateProposal(
  item: InventoryItemForMarkdown,
  pricingData: PricingData,
  config: MarkdownConfig,
  mode: 'review' | 'auto'
): MarkdownProposal | null {
  const agingDays = calculateAgingDays(item);

  // Run diagnosis
  const { diagnosis, reason } = diagnoseItem(item, pricingData, config, agingDays);

  // HOLDING items get no proposal
  if (diagnosis === 'HOLDING') {
    return null;
  }

  const platform = (item.listing_platform?.toLowerCase() || 'amazon') as Platform;
  const currentPrice = item.listing_value!;
  const cost = item.cost!;

  const feeRate = platform === 'amazon' ? config.amazon_fee_rate : config.ebay_fee_rate;
  const priceFloor = calculatePriceFloor(cost, feeRate);
  const marketPrice = pricingData.marketPrice ?? pricingData.buyBoxPrice;

  let proposedPrice: number | null = null;
  let proposedAction: ProposedAction = 'MARKDOWN';
  let markdownStep: number | null = null;
  let auctionDurationDays: number | null = null;

  if (diagnosis === 'LOW_DEMAND') {
    // Low demand items go to auction (on eBay) or deep markdown (on Amazon)
    if (platform === 'ebay' && config.auction_enabled) {
      proposedAction = 'AUCTION';
      auctionDurationDays = config.auction_default_duration_days;
      proposedPrice = null; // auction starting price = current price (handled at execution)
    } else {
      // Amazon low demand — aggressive markdown to floor
      proposedAction = 'MARKDOWN';
      proposedPrice = clampToFloor(roundToNearestCharm(priceFloor + 0.01), priceFloor);
      markdownStep = 4;
      if (proposedPrice >= currentPrice) return null; // already at or below floor
    }
  } else {
    // OVERPRICED — apply platform-specific step-based markdown
    if (platform === 'amazon' && marketPrice) {
      const result = calculateAmazonMarkdownPrice(currentPrice, marketPrice, config, agingDays, priceFloor);
      proposedPrice = result.price;
      markdownStep = result.step;

      // If already at proposed price or we can't lower, recommend auction on eBay or skip
      if (proposedPrice >= currentPrice && agingDays >= config.amazon_step4_days) {
        // At floor and still not selling — nothing more to do on Amazon
        return null;
      }
      if (proposedPrice >= currentPrice) return null;
    } else if (platform === 'ebay') {
      const result = calculateEbayMarkdownPrice(currentPrice, config, agingDays, priceFloor);
      proposedPrice = result.price;
      markdownStep = result.step;
      proposedAction = result.action;

      if (proposedAction === 'MARKDOWN' && proposedPrice !== null && proposedPrice >= currentPrice) {
        return null; // no meaningful reduction possible
      }

      if (proposedAction === 'AUCTION') {
        auctionDurationDays = config.auction_default_duration_days;
      }
    } else {
      // Unsupported platform or missing market price
      return null;
    }
  }

  // Determine initial status based on mode
  let status: ProposalStatus = 'PENDING';
  if (mode === 'auto' && diagnosis === 'OVERPRICED' && proposedAction === 'MARKDOWN') {
    status = 'AUTO_APPLIED';
  }

  return {
    user_id: item.user_id,
    inventory_item_id: item.id,
    platform,
    diagnosis,
    diagnosis_reason: reason,
    current_price: currentPrice,
    proposed_price: proposedPrice,
    price_floor: priceFloor,
    market_price: marketPrice ?? null,
    proposed_action: proposedAction,
    markdown_step: markdownStep,
    aging_days: agingDays,
    auction_end_date: null, // filled by auction scheduler
    auction_duration_days: auctionDurationDays,
    status,
    set_number: item.set_number ?? null,
    item_name: item.item_name ?? null,
    sales_rank: pricingData.salesRank ?? item.sales_rank ?? null,
  };
}
