/**
 * CANONICAL Bricqer auto-pricing formula — single source of truth.
 *
 * Mirrors the live Bricqer formula (updated by Chris 2026-07-17):
 *
 *   max(0.0399, get_price('sold', 'avg_price', condition, 'UK') * multiplier)
 *
 *   sell_thru_rate = sold total_quantity / stock total_quantity   (UK, same condition)
 *
 *   New:  STR >= 0.5  -> 1.10   else 0.85
 *   Used: STR >= 1.5  -> 1.90   (super-velocity bracket)
 *         STR >= 1.0  -> 1.40
 *         STR >= 0.75 -> 1.25
 *         STR >= 0.5  -> 1.15
 *         STR >= 0.25 -> 0.93
 *         else        -> 0.90
 *
 * Bricqer disables auto-pricing for items WITH A COMMENT and for SETS
 * (lego_type 'S') — callers projecting revenue on sets are modelling, not
 * mirroring the engine.
 *
 * History: v1 (pre 2026-05-11): N 1.05/0.90; U 1.25/1.15/1.10/0.90/0.85.
 *          v2 (2026-05-11): N 1.10/0.85; U 1.40/1.25/1.15/0.93/0.90.
 *          v3 (2026-07-07): adds U STR>=1.5 -> 1.80 and the £0.0699 floor.
 *          v4 (2026-07-17): U STR>=1.5 -> 1.90; floor lowered to £0.0399.
 */

export type BricqerCondition = 'N' | 'U';

/** Bricqer's minimum auto-price (4p floor since 2026-07-17; was 7p from ~2026-06-12). */
export const BRICQER_PRICE_FLOOR = 0.0399;

export function bricqerMultiplier(condition: BricqerCondition, sellThru: number): number {
  if (condition === 'N') return sellThru >= 0.5 ? 1.10 : 0.85;
  if (sellThru >= 1.5) return 1.90;
  if (sellThru >= 1) return 1.40;
  if (sellThru >= 0.75) return 1.25;
  if (sellThru >= 0.5) return 1.15;
  if (sellThru >= 0.25) return 0.93;
  return 0.90;
}

/**
 * Projected Bricqer list price: UK 6-month sold avg × multiplier, floored at 4p.
 * Returns null when there is no benchmark (null/zero avg) — the floor applies
 * only to priced items, it does not conjure a price for no-data items.
 */
export function bricqerListPrice(
  ukSoldAvg: number | null | undefined,
  condition: BricqerCondition,
  sellThru: number,
): number | null {
  if (ukSoldAvg == null || ukSoldAvg <= 0) return null;
  return Math.max(BRICQER_PRICE_FLOOR, ukSoldAvg * bricqerMultiplier(condition, sellThru));
}
