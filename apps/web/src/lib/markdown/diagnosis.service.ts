/**
 * Markdown Diagnosis Service
 *
 * Classifies inventory items as OVERPRICED, LOW_DEMAND, or HOLDING
 * based on pricing data, sales rank, and aging.
 */

import type { DiagnosisResult, InventoryItemForMarkdown, MarkdownConfig, PricingData } from './types';

export function diagnoseItem(
  item: InventoryItemForMarkdown,
  pricingData: PricingData,
  config: MarkdownConfig,
  agingDays: number
): DiagnosisResult {
  // 1. Held items are always HOLDING
  if (item.markdown_hold) {
    return { diagnosis: 'HOLDING', reason: 'Item has markdown hold enabled' };
  }

  // 2. Determine minimum aging threshold based on platform
  const platform = item.listing_platform?.toLowerCase();
  const minDays = platform === 'amazon'
    ? config.amazon_step1_days
    : config.ebay_step1_days;

  if (agingDays < minDays) {
    return {
      diagnosis: 'HOLDING',
      reason: `Listed ${agingDays} days — below ${minDays}-day threshold for ${platform || 'unknown'} markdown`,
    };
  }

  // 3. If no pricing data available, can't diagnose
  if (!pricingData.marketPrice && !pricingData.buyBoxPrice) {
    return {
      diagnosis: 'HOLDING',
      reason: 'Insufficient market pricing data to diagnose',
    };
  }

  if (!item.listing_value || !item.cost) {
    return {
      diagnosis: 'HOLDING',
      reason: 'Item missing cost or listing value',
    };
  }

  // 4. Check if overpriced: listing price significantly above market
  const referencePrice = pricingData.marketPrice ?? pricingData.buyBoxPrice;
  if (referencePrice && referencePrice > 0) {
    const priceDiffPct = ((item.listing_value - referencePrice) / referencePrice) * 100;

    if (priceDiffPct > config.overpriced_threshold_pct) {
      return {
        diagnosis: 'OVERPRICED',
        reason: `Listed at £${item.listing_value.toFixed(2)} — ${priceDiffPct.toFixed(0)}% above market (£${referencePrice.toFixed(2)})`,
      };
    }
  }

  // 5. Check for low demand: price is competitive but sales rank is poor
  const salesRank = pricingData.salesRank ?? item.sales_rank;
  if (salesRank && salesRank > config.low_demand_sales_rank) {
    return {
      diagnosis: 'LOW_DEMAND',
      reason: `Price competitive but sales rank ${salesRank.toLocaleString()} exceeds ${config.low_demand_sales_rank.toLocaleString()} threshold — low buyer demand`,
    };
  }

  // 6. Item is priced near market but still hasn't sold — could be either
  // If aged beyond step 3 with competitive pricing, likely low demand
  const step3Days = platform === 'amazon' ? config.amazon_step3_days : config.ebay_step3_days;
  if (agingDays > step3Days && referencePrice) {
    const priceDiffPct = ((item.listing_value - referencePrice) / referencePrice) * 100;
    if (priceDiffPct <= config.overpriced_threshold_pct) {
      return {
        diagnosis: 'LOW_DEMAND',
        reason: `Listed ${agingDays} days at competitive price (${priceDiffPct.toFixed(0)}% vs market) — likely low demand rather than price issue`,
      };
    }
  }

  // 7. Default: if above threshold days and still listed, mark as OVERPRICED
  // (conservative — markdown will bring price closer to market)
  return {
    diagnosis: 'OVERPRICED',
    reason: `Listed ${agingDays} days without sale — markdown to improve competitiveness`,
  };
}

export function calculateAgingDays(item: InventoryItemForMarkdown): number {
  const baseDate = item.listing_date || item.purchase_date || item.created_at;
  return Math.floor((Date.now() - new Date(baseDate).getTime()) / (1000 * 60 * 60 * 24));
}
