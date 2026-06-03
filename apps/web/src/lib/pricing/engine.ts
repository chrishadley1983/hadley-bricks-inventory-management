/**
 * Unified Pricing Engine
 *
 * Single source of truth for markdown/repricing decisions across eBay and Amazon.
 * Used by BOTH cadences:
 *   - 30-day suggestion sweep (recommend, both platforms) — /api/cron/markdown
 *   - 90-day eBay relist (auto) — /api/cron/ebay-listing-refresh
 *
 * The engine is pure pricing: it returns an action (HOLD/REPRICE/AUCTION),
 * a target price, a diagnosis and a reason. The *relist* (end+recreate) is a
 * cadence concern handled by the 90-day cron, which simply uses targetPrice.
 *
 * See docs/features/unified-markdown/design.md §4.
 */

import { roundToNearestCharm } from '@/lib/minifig-sync/pricing-engine';
import { getEngagementTier, type EngagementTier } from '@/lib/ebay/refresh-pricing';
import type { MarkdownConfig } from '@/lib/markdown/types';

// ============================================================================
// Types
// ============================================================================

export type EngineAction = 'HOLD' | 'REPRICE' | 'AUCTION';
export type EngineDiagnosis = 'OVERPRICED' | 'LOW_DEMAND' | 'HOLDING';

export interface EngineInput {
  platform: 'amazon' | 'ebay';
  currentPrice: number;
  cost: number;
  condition: string | null;
  ageDays: number;
  /** Amazon market reference (Keepa 90d / buy box). Null for eBay. */
  marketPrice: number | null;
  salesRank: number | null;
  /** eBay engagement. Null for Amazon. */
  views: number | null;
  watchers: number | null;
  config: MarkdownConfig;
}

export interface EngineOutput {
  action: EngineAction;
  /** null for AUCTION */
  targetPrice: number | null;
  diagnosis: EngineDiagnosis;
  reason: string;
  floor: number;
  tier: EngagementTier | null;
  markdownStep: number | null;
  /** effective reduction vs currentPrice, 0–100 */
  reductionPct: number;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * eBay engagement-tier base reductions (as currently done — lib/ebay/refresh-pricing.ts).
 * HOT = strong demand, don't discount.
 */
const EBAY_TIER_REDUCTION: Record<EngagementTier, number> = {
  HOT: 0,
  WARM: 5,
  COOL: 10,
  COLD: 15,
};

/** Used-condition surcharge (suppressed for HOT — decision 2026-06-03). */
const USED_EXTRA_PCT = 5;

/** eBay flat per-order fee (£0.30) — lib/purchase-evaluator/calculations.ts. */
export const EBAY_FIXED_ORDER_FEE = 0.3;

// ============================================================================
// Floor
// ============================================================================

/**
 * Breakeven floor after platform fees, rounded UP to the next charm ending so
 * the floor never sits below true breakeven.
 *  - Amazon: cost / (1 - amazon_fee_rate)         (0.1836 effective)
 *  - eBay:   (cost + £0.30) / (1 - ebay_fee_rate)  (0.1566 effective + flat fee)
 */
export function calculateFloor(
  platform: 'amazon' | 'ebay',
  cost: number,
  config: MarkdownConfig
): number {
  if (cost <= 0) return 0;
  const feeRate = platform === 'amazon' ? config.amazon_fee_rate : config.ebay_fee_rate;
  const fixed = platform === 'ebay' ? EBAY_FIXED_ORDER_FEE : 0;
  const breakeven = (cost + fixed) / (1 - feeRate);
  return ceilToCharm(breakeven);
}

/** Smallest charm-ending price (.49 / .99) that is >= price. */
export function ceilToCharm(price: number): number {
  if (price <= 0.49) return 0.49;
  const whole = Math.floor(price);
  const frac = Math.round((price - whole) * 100) / 100;
  if (frac <= 0.49) return whole + 0.49;
  if (frac <= 0.99) return whole + 0.99;
  return whole + 1 + 0.49;
}

function isUsed(condition: string | null): boolean {
  return condition?.toLowerCase() === 'used';
}

// ============================================================================
// Engine
// ============================================================================

export function computeTarget(input: EngineInput): EngineOutput {
  const { platform, currentPrice, cost, ageDays, config } = input;
  const floor = calculateFloor(platform, cost, config);

  const minDays = platform === 'amazon' ? config.amazon_step1_days : config.ebay_step1_days;

  // Too fresh / no cost / no price → hold.
  if (ageDays < minDays || currentPrice <= 0) {
    return hold(floor, `Listed ${ageDays}d — below ${minDays}d threshold`);
  }
  if (cost <= 0) {
    return hold(floor, 'Missing cost — cannot compute floor');
  }

  return platform === 'amazon' ? computeAmazon(input, floor) : computeEbay(input, floor);
}

// ---- Amazon: market-driven step curve ----

function computeAmazon(input: EngineInput, floor: number): EngineOutput {
  const { currentPrice, ageDays, config, marketPrice, salesRank } = input;

  if (!marketPrice || marketPrice <= 0) {
    return hold(floor, 'No Keepa market price available');
  }

  // Diagnosis
  const overPct = ((currentPrice - marketPrice) / marketPrice) * 100;
  let diagnosis: EngineDiagnosis;
  let reason: string;
  if (overPct > config.overpriced_threshold_pct) {
    diagnosis = 'OVERPRICED';
    reason = `£${currentPrice.toFixed(2)} is ${overPct.toFixed(0)}% above market (£${marketPrice.toFixed(2)})`;
  } else if (salesRank && salesRank > config.low_demand_sales_rank) {
    diagnosis = 'LOW_DEMAND';
    reason = `Competitive price but sales rank ${salesRank.toLocaleString()} > ${config.low_demand_sales_rank.toLocaleString()}`;
  } else {
    diagnosis = 'OVERPRICED';
    reason = `Listed ${ageDays}d — markdown toward market`;
  }

  // Step curve by age
  let step: number;
  let raw: number;
  if (ageDays >= config.amazon_step4_days) {
    step = 4;
    raw = floor;
  } else if (ageDays >= config.amazon_step3_days) {
    step = 3;
    raw = marketPrice * (1 - config.amazon_step3_undercut_pct / 100);
  } else if (ageDays >= config.amazon_step2_days) {
    step = 2;
    raw = marketPrice * (1 - config.amazon_step2_undercut_pct / 100);
  } else {
    step = 1;
    raw = marketPrice; // match market
  }

  return finalize(raw, currentPrice, floor, diagnosis, reason, null, step);
}

// ---- eBay: engagement tier + aging accelerant ----

function computeEbay(input: EngineInput, floor: number): EngineOutput {
  const { currentPrice, ageDays, config, views, watchers, condition } = input;
  const tier = getEngagementTier(views || 0, watchers || 0, ageDays);

  // Deep age + low engagement → recommend auction (never for HOT).
  if (ageDays >= config.ebay_step4_days && config.auction_enabled && tier !== 'HOT') {
    return {
      action: 'AUCTION',
      targetPrice: null,
      diagnosis: 'LOW_DEMAND',
      reason: `Listed ${ageDays}d, ${tier} engagement — recommend auction exit`,
      floor,
      tier,
      markdownStep: 4,
      reductionPct: 0,
    };
  }

  // Engagement-tier reduction (+ Used surcharge, suppressed for HOT).
  let reductionPct = EBAY_TIER_REDUCTION[tier];
  if (isUsed(condition) && tier !== 'HOT') {
    reductionPct += USED_EXTRA_PCT;
  }

  let raw = currentPrice * (1 - reductionPct / 100);
  let step = ageDays >= config.ebay_step3_days ? 3 : ageDays >= config.ebay_step2_days ? 2 : 1;

  // Deep-age accelerant: non-HOT items at step 3+ pushed at least to floor.
  if (ageDays >= config.ebay_step3_days && tier !== 'HOT' && floor > 0) {
    raw = Math.min(raw, floor);
  }

  const diagnosis: EngineDiagnosis =
    tier === 'COLD' || tier === 'COOL' ? 'LOW_DEMAND' : 'OVERPRICED';
  const reason = `${tier} engagement (${views ?? 0} views, ${watchers ?? 0} watchers), ${ageDays}d`;

  return finalize(raw, currentPrice, floor, diagnosis, reason, tier, step);
}

// ============================================================================
// Helpers
// ============================================================================

function hold(floor: number, reason: string): EngineOutput {
  return {
    action: 'HOLD',
    targetPrice: null,
    diagnosis: 'HOLDING',
    reason,
    floor,
    tier: null,
    markdownStep: null,
    reductionPct: 0,
  };
}

/**
 * Turn an intended raw (pre-rounding) reduced price into a final decision.
 * Guards against charm-rounding spuriously creating a markdown when no
 * reduction was intended (e.g. HOT at 0% where raw == currentPrice).
 */
function finalize(
  raw: number,
  currentPrice: number,
  floor: number,
  diagnosis: EngineDiagnosis,
  reason: string,
  tier: EngagementTier | null,
  step: number | null
): EngineOutput {
  // No reduction intended (raw at/above current, or floor exceeds current) → HOLD.
  if (raw >= currentPrice - 0.005) {
    return {
      action: 'HOLD',
      targetPrice: currentPrice,
      diagnosis: 'HOLDING',
      reason: tier ? `${tier} engagement — hold at £${currentPrice.toFixed(2)}` : 'No reduction needed',
      floor,
      tier,
      markdownStep: step,
      reductionPct: 0,
    };
  }

  // Round the intended reduction, clamp up to floor, never increase.
  let target = roundToNearestCharm(raw);
  if (floor > 0 && target < floor) target = floor;
  target = Math.round(target * 100) / 100;

  if (target >= currentPrice) {
    return {
      action: 'HOLD',
      targetPrice: currentPrice,
      diagnosis: 'HOLDING',
      reason: 'Floor at/above current price — cannot reduce profitably',
      floor,
      tier,
      markdownStep: step,
      reductionPct: 0,
    };
  }

  const reductionPct = ((currentPrice - target) / currentPrice) * 100;
  return {
    action: 'REPRICE',
    targetPrice: target,
    diagnosis,
    reason,
    floor,
    tier,
    markdownStep: step,
    reductionPct: Math.round(reductionPct * 10) / 10,
  };
}
