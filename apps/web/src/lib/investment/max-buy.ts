/**
 * Max-buy pricing for retiring / soon-retiring investment sets.
 *
 * House margin convention (shared with the vinted-sniper cards):
 *   margin % = profit / SALE price; green >= 25%, amber >= 15%; £4 ship
 *   => max_buy = sale*(1 - fees - margin) - ship  (0.58x sale for green @17% fees)
 *
 * Sale-price basis depends on prediction trust:
 *   HIGH tier    → P50 calibration (median holdout actual/predicted = 0.91, n=407)
 *   standard     → conservative basis (half the predicted appreciation)
 */

export const MAX_BUY_FEE = 0.17;
export const MAX_BUY_SHIP = 4.0;
export const MAX_BUY_GREEN_MARGIN = 0.25;
export const MAX_BUY_AMBER_MARGIN = 0.15;

/** Median holdout delivery of the v2 1yr head: p50 of actual/predicted = 0.91 (n=407). */
export const P50_CALIBRATION = 0.91;

/** 1yr predictions at these values were clamped at the model output bounds. */
const PRED_1YR_UPPER_BOUND = 399.5;
const PRED_1YR_LOWER_BOUND = -94.5;

/** Minimum model confidence for the HIGH tier (P50 pricing basis). */
const HIGH_CONFIDENCE_THRESHOLD = 0.49;

export interface MaxBuyInput {
  /** UK RRP in GBP; must be > 0 for a result. */
  rrp: number;
  /** Predicted 1yr appreciation in percent (e.g. 45.2). */
  predicted1yrAppreciationPct: number;
  /** Model confidence 0–1. */
  confidence: number;
  /** risk_factors strings from investment_predictions. */
  riskFactors: string[];
}

export interface MaxBuyResult {
  /** HIGH → P50 pricing basis applies; standard → conservative half-prediction basis. */
  tier: 'HIGH' | 'standard';
  /** Sale price the recommended max buy is anchored to. */
  expectedSale: number;
  /** Max buy for a green (25%-of-sale) margin on the tier's sale basis. */
  recommendedMaxBuy: number;
  /** Fallback max buy for an amber (15%-of-sale) margin on the same basis. */
  amberMaxBuy: number;
  /** recommendedMaxBuy as a percentage of RRP. */
  recommendedPctOfRrp: number;
  /** Full-prediction sale price, for reference. */
  fullPredictionSale: number;
}

/** Max buy so profit >= margin share of sale price (house convention). */
export function maxBuyForSale(sale: number, margin: number): number {
  return sale * (1 - MAX_BUY_FEE - margin) - MAX_BUY_SHIP;
}

/**
 * High confidence: top confidence tier, sane demand, and the 1yr prediction
 * itself not clamped at the model bounds. (The stored risk flag also fires
 * when the 3yr prediction clamps — irrelevant here, since max-buy pricing
 * uses only the 1yr horizon and the 3yr head failed validation.)
 */
export function isHighConfidence(
  confidence: number,
  riskFactors: string[],
  predicted1yrAppreciationPct: number
): boolean {
  const salesRankOk =
    !riskFactors.includes('low_demand_high_sales_rank') &&
    !riskFactors.includes('no_amazon_listing');
  const pred1yrAtBound =
    predicted1yrAppreciationPct >= PRED_1YR_UPPER_BOUND ||
    predicted1yrAppreciationPct <= PRED_1YR_LOWER_BOUND;
  return confidence >= HIGH_CONFIDENCE_THRESHOLD && salesRankOk && !pred1yrAtBound;
}

/** Returns null when RRP is missing/non-positive (no basis to price from). */
export function computeMaxBuy(input: MaxBuyInput): MaxBuyResult | null {
  const { rrp, predicted1yrAppreciationPct: predPct, confidence, riskFactors } = input;
  if (!rrp || rrp <= 0 || !Number.isFinite(predPct)) return null;

  const highConfidence = isHighConfidence(confidence, riskFactors, predPct);

  const pFull = rrp * (1 + predPct / 100);
  const pCons = rrp * (1 + predPct / 200);
  const pP50 = rrp * (1 + (P50_CALIBRATION * predPct) / 100);

  const expectedSale = highConfidence ? pP50 : pCons;
  const recommendedMaxBuy = maxBuyForSale(expectedSale, MAX_BUY_GREEN_MARGIN);
  const amberMaxBuy = maxBuyForSale(expectedSale, MAX_BUY_AMBER_MARGIN);

  return {
    tier: highConfidence ? 'HIGH' : 'standard',
    expectedSale,
    recommendedMaxBuy,
    amberMaxBuy,
    recommendedPctOfRrp: (recommendedMaxBuy / rrp) * 100,
    fullPredictionSale: pFull,
  };
}
