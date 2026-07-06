/**
 * Unified Pricing Engine
 *
 * Single source of truth for markdown/repricing decisions across eBay and Amazon.
 * Used by BOTH cadences:
 *   - 30-day suggestion sweep (recommend, both platforms) — /api/cron/markdown
 *   - 90-day eBay relist (auto) — /api/cron/ebay-listing-refresh
 *
 * Amazon is POSITION-FIRST (markdown v2, 2026-07): the action depends on who
 * holds the buy box and whether the ASIN actually sells, not just listing age.
 * All market comparisons use a STABLE reference (median of daily buy-box
 * snapshots over the trailing reference window, default 180d) with a recent
 * persistence gate, so one-day competitor blips never trigger a cut. The sweep
 * is a stale-stock detector, not a repricer.
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
export type EngineDiagnosis = 'OVERPRICED' | 'LOW_DEMAND' | 'HOLDING' | 'EXIT';

/**
 * Amazon competitive/market context, built by the caller from the daily
 * amazon_arbitrage_pricing snapshots (see buildAmazonMarketContext in the
 * markdown cron). All price fields in GBP.
 */
export interface AmazonMarketContext {
  /** Median daily buy-box price over the trailing reference window (stable reference). */
  stableBuyBox: number | null;
  /** Most recent snapshot's buy-box price. */
  currentBuyBox: number | null;
  /** Keepa 180d avg buy box — independent cross-check of stableBuyBox. */
  keepaAvg180: number | null;
  /** Keepa 90d avg buy box — fallback cross-check. */
  keepaAvg90: number | null;
  /** Fraction (0–1) of snapshots in the persistence window where box < our price. */
  persistenceBelowPct: number | null;
  /** Number of snapshots in the persistence window (confidence). */
  persistenceSampleSize: number;
  /** Do we hold the buy box (latest snapshot)? */
  buyBoxIsYours: boolean | null;
  /** Total offers on the ASIN (latest snapshot). */
  totalOfferCount: number | null;
  salesRank: number | null;
  /** Keepa salesRankDrops90 — ASIN-level 90d sales-velocity proxy. */
  salesRankDrops90: number | null;
  /** Highest historical your_price — anchor for the low-demand decay bound. */
  anchorPrice: number | null;
  /** Most recent APPLIED match proposal (tier-2 escalation input). */
  lastAppliedMatch: { price: number; appliedAt: string } | null;
}

export interface EngineInput {
  platform: 'amazon' | 'ebay';
  currentPrice: number;
  cost: number;
  condition: string | null;
  ageDays: number;
  /** Amazon market context. Null for eBay. */
  amazonMarket: AmazonMarketContext | null;
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
  /** true when the reason needs a human look (e.g. reference sources disagree) */
  needsReview: boolean;
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

/**
 * eBay Analytics API views cover at most this many days; views-per-day must be
 * computed over this window, not full listing age, or old listings look COLD.
 */
export const EBAY_VIEWS_WINDOW_DAYS = 89;

/** Stable reference vs Keepa cross-check: divergence beyond this → manual review. */
const REFERENCE_DIVERGENCE_PCT = 25;

/** Minimum snapshots in the persistence window before we trust it. */
const MIN_PERSISTENCE_SAMPLES = 7;

/** Days an applied match must have had to win the box before tier-2 escalates. */
const MATCH_ESCALATION_MIN_DAYS = 20;

/** Tier-2 escalation undercut vs the stable reference. */
const ESCALATION_UNDERCUT_PCT = 10;

// ============================================================================
// Floor
// ============================================================================

/**
 * Breakeven floor after platform fees AND outbound postage, rounded UP to the
 * next charm ending so the floor never sits below true breakeven.
 *  - Amazon: (cost + postage) / (1 - amazon_fee_rate)
 *  - eBay:   (cost + postage + £0.30) / (1 - ebay_fee_rate)
 */
export function calculateFloor(
  platform: 'amazon' | 'ebay',
  cost: number,
  config: MarkdownConfig
): number {
  if (cost <= 0) return 0;
  const feeRate = platform === 'amazon' ? config.amazon_fee_rate : config.ebay_fee_rate;
  const postage =
    platform === 'amazon' ? (config.amazon_postage_cost ?? 0) : (config.ebay_postage_cost ?? 0);
  const fixed = platform === 'ebay' ? EBAY_FIXED_ORDER_FEE : 0;
  const breakeven = (cost + postage + fixed) / (1 - feeRate);
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

/** Largest charm-ending price (.49 / .99) that is <= price. Used to sit at/under the buy box. */
export function floorToCharm(price: number): number {
  if (price < 0.49) return 0.49;
  const whole = Math.floor(price);
  const frac = Math.round((price - whole) * 100) / 100;
  if (frac >= 0.99) return whole + 0.99;
  if (frac >= 0.49) return whole + 0.49;
  return whole - 1 + 0.99;
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

// ---- Amazon: position-first (who holds the box + does the ASIN sell) ----

function computeAmazon(input: EngineInput, floor: number): EngineOutput {
  const { currentPrice, ageDays, config, amazonMarket: mkt } = input;

  // 365d exit: stop cutting, get it off Amazon.
  if (ageDays >= config.amazon_exit_days) {
    return {
      action: 'AUCTION',
      targetPrice: null,
      diagnosis: 'EXIT',
      reason: `Listed ${ageDays}d (>= ${config.amazon_exit_days}d) — recommend eBay auction exit`,
      floor,
      tier: null,
      markdownStep: 4,
      reductionPct: 0,
      needsReview: false,
    };
  }

  if (!mkt) {
    return hold(floor, 'No market snapshot data available');
  }

  const weAreTheMarket =
    mkt.buyBoxIsYours === true || (mkt.totalOfferCount !== null && mkt.totalOfferCount <= 1);

  return weAreTheMarket
    ? computeAmazonWeHoldBox(currentPrice, ageDays, config, mkt, floor)
    : computeAmazonCompetitorHoldsBox(currentPrice, ageDays, config, mkt, floor);
}

/**
 * We hold the buy box (or are the sole offer): cutting price can't win us
 * anything — the constraint is demand. Velocity-gated slow decay, bounded by
 * both the true floor and a % of the anchor (highest historical price).
 * Note: for sole-offer ASINs the buy-box history is our own price history, so
 * market references are self-referential and deliberately not used here.
 */
function computeAmazonWeHoldBox(
  currentPrice: number,
  ageDays: number,
  config: MarkdownConfig,
  mkt: AmazonMarketContext,
  floor: number
): EngineOutput {
  const drops = mkt.salesRankDrops90;

  if (drops === null) {
    return hold(floor, 'We hold the buy box; no velocity data yet — holding until Keepa drops arrive');
  }

  // Nobody buys this ASIN at any price — a cut is pure margin donation.
  if (drops < config.amazon_min_drops_90d) {
    return hold(
      floor,
      `We hold the buy box; ${drops} sales (rank drops) in 90d — cut pointless, exit at ${config.amazon_exit_days}d`
    );
  }

  // ASIN sells fine and we own the box — it will sell; hold full margin.
  if (drops >= config.amazon_healthy_drops_90d) {
    return hold(
      floor,
      `We hold the buy box; demand healthy (${drops} rank drops/90d) — holding`
    );
  }

  // Thin-but-real demand: slow demand-test decay from the anchor.
  if (ageDays < config.amazon_decay_start_days) {
    return hold(
      floor,
      `We hold the buy box; thin demand (${drops} drops/90d), ${ageDays}d < ${config.amazon_decay_start_days}d decay start`
    );
  }

  const anchor = mkt.anchorPrice ?? currentPrice;
  const stepsElapsed =
    Math.floor((ageDays - config.amazon_decay_start_days) / config.amazon_decay_interval_days) + 1;
  const decayRaw = anchor * (1 - (config.amazon_decay_step_pct / 100) * stepsElapsed);
  const decayFloor = Math.max(floor, anchor * (config.amazon_decay_floor_pct / 100));
  const raw = Math.max(decayRaw, decayFloor);

  return finalize(
    raw,
    currentPrice,
    floor,
    'LOW_DEMAND',
    `We hold the buy box; thin demand (${drops} drops/90d) — demand-test step ${stepsElapsed} (−${config.amazon_decay_step_pct}% each, bounded at ${config.amazon_decay_floor_pct}% of £${anchor.toFixed(2)})`,
    null,
    2
  );
}

/**
 * A competitor holds the buy box: match it — but only against a STABLE
 * reference (median of daily snapshots) and only when the box has sat below
 * our price persistently. Escalate to a 10% undercut only after an applied
 * match demonstrably failed to win the box.
 */
function computeAmazonCompetitorHoldsBox(
  currentPrice: number,
  ageDays: number,
  config: MarkdownConfig,
  mkt: AmazonMarketContext,
  floor: number
): EngineOutput {
  const stable = mkt.stableBuyBox;

  if (!stable || stable <= 0) {
    return hold(floor, 'Competitor holds the buy box but no stable market reference yet');
  }

  // Cross-check our snapshot median against Keepa's independent average.
  const keepaRef = mkt.keepaAvg180 ?? mkt.keepaAvg90;
  if (keepaRef && keepaRef > 0) {
    const divergence = (Math.abs(stable - keepaRef) / keepaRef) * 100;
    if (divergence > REFERENCE_DIVERGENCE_PCT) {
      return {
        ...hold(
          floor,
          `Reference sources disagree (snapshot median £${stable.toFixed(2)} vs Keepa £${keepaRef.toFixed(2)}) — manual review`
        ),
        needsReview: true,
      };
    }
  }

  // Market has moved below our breakeven — don't chase; flag for exit thinking.
  if (stable < floor) {
    return {
      ...hold(
        floor,
        `Stable market £${stable.toFixed(2)} is below our floor £${floor.toFixed(2)} — cannot compete profitably; consider exit`
      ),
      diagnosis: 'EXIT',
      needsReview: true,
    };
  }

  // Persistence gate: the box must have sat below us for most of the recent window.
  // Sample requirement never exceeds the configured window (a 5-day window can
  // legitimately only ever produce 5 snapshots).
  const minSamples = Math.min(MIN_PERSISTENCE_SAMPLES, config.amazon_persistence_window_days);
  if (mkt.persistenceSampleSize < minSamples || mkt.persistenceBelowPct === null) {
    return hold(floor, `Only ${mkt.persistenceSampleSize} recent snapshots — not enough to judge persistence`);
  }
  const persistencePct = mkt.persistenceBelowPct * 100;
  if (persistencePct < config.amazon_persistence_min_pct) {
    return hold(
      floor,
      `Buy box below us on only ${persistencePct.toFixed(0)}% of last ${mkt.persistenceSampleSize} snapshots — likely a blip, holding`
    );
  }

  // Tier 2: we already matched, waited, and still don't hold the box → undercut stable by 10%.
  const escalate = shouldEscalate(currentPrice, mkt);

  // Tier 1 target: largest charm price at/below the reference. When today's box
  // is above the long-run median (market rising), match today's box instead —
  // never price below the stable level just because the box briefly recovered.
  const reference = escalate
    ? stable * (1 - ESCALATION_UNDERCUT_PCT / 100)
    : Math.max(stable, mkt.currentBuyBox ?? 0);
  const raw = floorToCharm(reference);

  const reason = escalate
    ? `Matched £${mkt.lastAppliedMatch!.price.toFixed(2)} but box not won after ${MATCH_ESCALATION_MIN_DAYS}d+ — undercut stable market £${stable.toFixed(2)} by ${ESCALATION_UNDERCUT_PCT}%`
    : `£${currentPrice.toFixed(2)} vs stable market £${stable.toFixed(2)} (box below us ${persistencePct.toFixed(0)}% of last ${mkt.persistenceSampleSize} snapshots, ${ageDays}d listed)`;

  return finalize(raw, currentPrice, floor, 'OVERPRICED', reason, null, escalate ? 2 : 1);
}

/** Escalation: an applied match ran ≥20d, our price still sits at/below it, and we still don't own the box. */
function shouldEscalate(currentPrice: number, mkt: AmazonMarketContext): boolean {
  if (!mkt.lastAppliedMatch || mkt.buyBoxIsYours !== false) return false;
  const daysSinceApplied =
    (Date.now() - new Date(mkt.lastAppliedMatch.appliedAt).getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceApplied >= MATCH_ESCALATION_MIN_DAYS && currentPrice <= mkt.lastAppliedMatch.price + 0.01;
}

// ---- eBay: engagement tier + aging accelerant ----

function computeEbay(input: EngineInput, floor: number): EngineOutput {
  const { currentPrice, ageDays, config, views, watchers, condition } = input;
  // Analytics views cover at most 89 days — judge views/day over that window,
  // not the full listing age, or every old listing looks COLD.
  const tier = getEngagementTier(views || 0, watchers || 0, Math.min(ageDays, EBAY_VIEWS_WINDOW_DAYS));

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
      needsReview: false,
    };
  }

  // eBay reduction combines two signals (design §4.4 — "as currently done"):
  //  - engagement tier (HOT/WARM/COOL/COLD), and
  //  - aging-step reduction (ebay_step{1,2}_reduction_pct) by listing age.
  // We take the deeper of the two so aged listings still cut even when warm,
  // while HOT (strong demand) is never discounted.
  const step = ageDays >= config.ebay_step3_days ? 3 : ageDays >= config.ebay_step2_days ? 2 : 1;
  let reductionPct: number;
  if (tier === 'HOT') {
    reductionPct = 0; // don't discount proven demand
  } else {
    const tierReduction = EBAY_TIER_REDUCTION[tier];
    const agingReduction =
      ageDays >= config.ebay_step2_days
        ? config.ebay_step2_reduction_pct
        : config.ebay_step1_reduction_pct;
    reductionPct = Math.max(tierReduction, agingReduction);
    if (isUsed(condition)) reductionPct += USED_EXTRA_PCT;
  }

  let raw = currentPrice * (1 - reductionPct / 100);

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
    needsReview: false,
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
      needsReview: false,
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
      needsReview: false,
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
    needsReview: false,
  };
}
