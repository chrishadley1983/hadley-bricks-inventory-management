/**
 * Hadley Bricks fee model + store-quality pricing helpers.
 *
 * The Bricqer multiplier itself lives in `../bricklink/bricqer-pricing` (the
 * single source of truth, v3 2026-07-07) and is re-exported here so existing
 * store-quality imports keep working.
 *
 * NOTE on STR scale: Bricqer's STR is the ratio `times_sold / stock_available`.
 * The `bricklink_part_price_cache.sell_through_rate_*` columns store that ratio
 * **×100** (i.e. a percentage that can exceed 100). The multiplier expects
 * the raw RATIO (0.5 = 50%), so callers must divide the cached value by 100.
 */

import { bricqerListPrice, type BricqerCondition } from '../bricklink/bricqer-pricing';

export { bricqerMultiplier, BRICQER_PRICE_FLOOR } from '../bricklink/bricqer-pricing';

export type ItemCondition = BricqerCondition;

/** Hadley Bricks variable-fee model (verified — see bl-basket.ts). */
export const BL_FEE = 0.03; // BrickLink platform fee
export const BRICQER_FEE = 0.035; // Bricqer fee
export const PAYPAL_PCT = 0.029; // PayPal fee
export const VAR_FEE_PCT = BL_FEE + BRICQER_FEE + PAYPAL_PCT; // 9.4%

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
 * Returns null when the average is missing/zero. Applies the 7p floor (v3).
 */
export function projectListPrice(
  sixMonthAvg: number | null,
  condition: string,
  strRatio: number | null
): number | null {
  return bricqerListPrice(sixMonthAvg, conditionCode(condition), strRatio ?? 0);
}

/** Net profit per unit after variable fees, given list price and unit cost. */
export function netPerUnit(listPrice: number, unitCost: number): number {
  return listPrice * (1 - VAR_FEE_PCT) - unitCost;
}
