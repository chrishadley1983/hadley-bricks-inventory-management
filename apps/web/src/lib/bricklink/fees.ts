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
 */
export const MAGNET = { maxSupplyLots: 3, minStr: 0.5 } as const;

/** Ask-vs-market price bands — shared by assessment + store-quality position bucketing. */
export const PRICE_BANDS = { under: 0.7, keen: 0.95, atMarket: 1.15, premium: 1.5 } as const;

/** Net proceeds per unit after variable fees, before postage allocation. */
export function netAfterFees(listPrice: number, unitCost: number): number {
  return listPrice * (1 - VAR_FEE_PCT) - unitCost;
}
