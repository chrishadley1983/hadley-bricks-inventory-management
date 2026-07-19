/**
 * Hadley Bricks fee model + store-quality pricing helpers.
 *
 * The Bricqer multiplier itself lives in `../bricklink/bricqer-pricing` (the
 * single source of truth, v3 2026-07-07) and is re-exported here so existing
 * store-quality imports keep working.
 *
 * NOTE on STR scale: Bricqer's STR is the qty ratio `sold_qty / stock_qty`.
 * The unified price cache exposes this as `view.<side>.strQty` (raw ratio,
 * 0.5 = 50%, can exceed 1) via `readPriceGuide` — pass it to the multiplier
 * directly. `strRatioFromCache` remains only for legacy ×100 inputs.
 */

import { bricqerListPrice, type BricqerCondition } from '../bricklink/bricqer-pricing';

export { bricqerMultiplier, BRICQER_PRICE_FLOOR } from '../bricklink/bricqer-pricing';

export type ItemCondition = BricqerCondition;

/** Hadley Bricks variable-fee model — canonical home is `../bricklink/fees`. */
export { BL_FEE, BRICQER_FEE, PAYPAL_PCT, VAR_FEE_PCT } from '../bricklink/fees';
import { VAR_FEE_PCT } from '../bricklink/fees';

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
 * Returns null when the average is missing/zero. Applies the 4p floor (v4).
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
