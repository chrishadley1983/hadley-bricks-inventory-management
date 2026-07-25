/**
 * Canonical BL-resale fee model + store-review decision constants.
 *
 * THE single source for the variable-fee stack and the standard decision
 * thresholds used by every BL store review surface (bl-basket, store-assessment,
 * bl-pg-store-scan, store-quality, bl-store-report). Declared once here after the
 * 2026-07-19 audit found the fee stack re-declared in four places (and hardcoded
 * as a bare 0.094 in one) and the STR gate ladder varying per report.
 *
 * The Bricqer multiplier stays in `./bricqer-pricing` (its own single source).
 */

/** BrickLink platform fee. */
export const BL_FEE = 0.03;
/** Bricqer fee. */
export const BRICQER_FEE = 0.035;
/** PayPal fee. */
export const PAYPAL_PCT = 0.029;
/** Total variable fees on a BL/Bricqer sale — 9.4%. */
export const VAR_FEE_PCT = BL_FEE + BRICQER_FEE + PAYPAL_PCT;

/** Split form used by the assessment engine's AssessmentInputs.feeModel. */
export const FEE_MODEL = { blFee: BL_FEE, bricqerFee: BRICQER_FEE, paypalPct: PAYPAL_PCT } as const;

/**
 * Inclusive STR gate ladder (qty basis) — the standard cutoffs every
 * gate-comparison table uses. One ladder everywhere; a report wanting a
 * different granularity still renders THESE gates so runs stay comparable.
 */
export const STR_GATES = [0, 0.25, 0.5, 0.75, 1.0] as const;

/**
 * The "liquid cut" gate (Chris 2026-07-19, Blanco_Brix): the STR floor for the
 * headline liquid-basket figure — withinMargin lots at STR ≥ this, DUPLICATEs
 * excluded, demand-capped, standalone postage.
 */
export const LIQUID_STR_GATE = 0.25;

/** Default inbound BL order postage estimate (validated against Grand Total post-buy). */
export const DEFAULT_INBOUND_POSTAGE_GBP = 3.0;

/**
 * Magnet definition (Chris): worldwide supply ≤ maxSupplyLots seller-lots AND
 * STR ≥ minStr (decent sell-through) AND eligible (min ask, no damage note).
 *
 * NOTE this WORLDWIDE gate is still what bl-store-assessment uses. The set-lookup
 * part-out moved to UK_MAGNET below — see the warning there.
 */
export const MAGNET = { maxSupplyLots: 3, minStr: 0.5 } as const;

/**
 * UK magnet definition — scarcity measured against UK seller lots, cut separately for
 * parts and minifigs (Chris, 2026-07-25: "we should have a different measure for minifigs
 * and parts, and yes put both to UK").
 *
 * WHY UK, not worldwide. We list to UK buyers and compete with UK sellers; every other
 * figure on the part-out screen (price, STR, the ladder) is already UK. Mixing worldwide
 * scarcity with UK sell-through was incoherent — a part with 29 lots worldwide but ONE in
 * the UK is scarce in the market we actually sell into, and the old test could not see it.
 *
 * It also sidesteps a live data defect: `bricklink_pg_summary_cache.stock_*` changed scope
 * mid-July 2026. Rows fetched before ~2026-07-12 hold UK-scoped stock; rows after hold
 * worldwide. 45% of the table is pre-cutover, so the "world lots" column silently means
 * two different things per row, and ~10.5k of the rows that pass a scarcity gate come from
 * the suspect half. UK lots come from `bricklink_price_guide_cache`, which is consistently
 * UK-scoped.
 *
 * Supply is measured in PIECES, not seller lots — the same basis as the STR it is paired
 * with, and the same number the parts table shows as "Stock qty". Lots would reintroduce
 * exactly the mixed-denominator problem that made njo0658 read "Stock 12 / Sold 6" against
 * an STR of 0.02.
 *
 * WHY DIFFERENT CUTS, and why the minifig bound is the TIGHTER one: minifigs sit thinner
 * on the shelf than parts, so the same count is a weaker claim for a figure. 9 pieces of a
 * part in the whole UK is genuinely thin; 9 of a minifig is mid-market.
 *
 * Bounds are EXCLUSIVE, as specified (Chris, 2026-07-25: "figs < 5 or parts < 10 and
 * STR > 1", "and on quantity not lots"). The STR leg carries most of the weight: above 1,
 * a lot must have sold MORE in six months than is sitting on the shelf right now, which is
 * a strong claim on its own and lets the supply bound be the looser half of the pair.
 */
export const UK_MAGNET = {
  part: { ukStockQtyUnder: 10, strAbove: 1 },
  minifig: { ukStockQtyUnder: 5, strAbove: 1 },
} as const;

/** Ask-vs-market price bands — shared by assessment + store-quality position bucketing. */
export const PRICE_BANDS = { under: 0.7, keen: 0.95, atMarket: 1.15, premium: 1.5 } as const;

/**
 * Default net-margin threshold for "within margin" / max-buy back-solving
 * (AssessmentInputs.minMargin default; bl-basket `--min-margin` default).
 */
export const DEFAULT_MIN_MARGIN = 0.2;

/**
 * Part-out gate (moved here from bl-store-assessment/engine.ts so the set-lookup
 * Partout tab and the store-assessment SETS section apply ONE gate).
 *
 * POV must clear this multiple of the ask before part-out beats flipping — parting
 * out is labour-heavy, so a thin multiple isn't worth the bench time — AND the
 * absolute POV-vs-ask gap must be worth the labour at all.
 */
export const POV_MULTIPLE_MIN = 2.0;
export const POV_MIN_GAP_GBP = 10;

/** Net proceeds per unit after variable fees, before postage allocation. */
export function netAfterFees(listPrice: number, unitCost: number): number {
  return listPrice * (1 - VAR_FEE_PCT) - unitCost;
}
