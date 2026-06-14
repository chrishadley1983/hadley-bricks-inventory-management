/**
 * Canonical Bricqer pricing multiplier + Hadley Bricks fee model.
 *
 * Single source of truth so the store-quality engine and the job-lot evaluator
 * agree with how the Bricqer parts store is actually auto-priced.
 *
 * Multiplier formula is the version effective 2026-05-11 (see the
 * `bricqer-pricing-formula` memory and scripts/bl-basket.ts).
 *
 * NOTE on STR scale: Bricqer's STR is the ratio `times_sold / stock_available`.
 * The `bricklink_part_price_cache.sell_through_rate_*` columns store that ratio
 * **×100** (i.e. a percentage that can exceed 100). The multiplier below expects
 * the raw RATIO (0.5 = 50%), so callers must divide the cached value by 100.
 */

export type ItemCondition = 'N' | 'U';

/** Hadley Bricks variable-fee model (verified — see bl-basket.ts). */
export const BL_FEE = 0.03; // BrickLink platform fee
export const BRICQER_FEE = 0.035; // Bricqer fee
export const PAYPAL_PCT = 0.029; // PayPal fee
export const VAR_FEE_PCT = BL_FEE + BRICQER_FEE + PAYPAL_PCT; // 9.4%

/**
 * Bricqer auto-pricing multiplier applied to the 6-month UK sold average.
 * @param condition 'N' (New) or 'U' (Used)
 * @param sellThru  raw STR ratio (NOT the ×100 cached percentage)
 */
export function bricqerMultiplier(condition: ItemCondition, sellThru: number): number {
  if (condition === 'N') return sellThru >= 0.5 ? 1.1 : 0.85;
  if (sellThru >= 1) return 1.4;
  if (sellThru >= 0.75) return 1.25;
  if (sellThru >= 0.5) return 1.15;
  if (sellThru >= 0.25) return 0.93;
  return 0.9;
}

/** Convert a 'New'/'Used' label to the 'N'/'U' code the multiplier expects. */
export function conditionCode(condition: string | null | undefined): ItemCondition {
  return condition === 'New' || condition === 'N' ? 'N' : 'U';
}

/** Convert a cached sell_through_rate_* (×100 percentage) to a raw ratio. */
export function strRatioFromCache(cachedPct: number | null | undefined): number | null {
  if (cachedPct === null || cachedPct === undefined) return null;
  return cachedPct / 100;
}

/**
 * Project the Bricqer list price for a lot from its 6-month average and STR.
 * Returns null when the average is missing/zero.
 */
export function projectListPrice(
  sixMonthAvg: number | null,
  condition: string,
  strRatio: number | null
): number | null {
  if (!sixMonthAvg || sixMonthAvg <= 0) return null;
  return sixMonthAvg * bricqerMultiplier(conditionCode(condition), strRatio ?? 0);
}

/** Net profit per unit after variable fees, given list price and unit cost. */
export function netPerUnit(listPrice: number, unitCost: number): number {
  return listPrice * (1 - VAR_FEE_PCT) - unitCost;
}
