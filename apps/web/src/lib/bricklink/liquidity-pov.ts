/**
 * Liquidity-adjusted Part-Out Value (spec §3 F4, done-criteria F5).
 *
 * Gross POV (Σ qty × price) assumes every lot sells at its listed/guide price. In
 * practice low-STR lots sit for months or never clear — the real "money we'd actually
 * realise if we parted this out and sold it" is gross POV discounted by a capture
 * fraction f(STR) per lot.
 *
 *   realisable_pov = Σ qty × price × f(STR)
 *
 * CAPTURE_CURVE (piecewise, spec-specified starting point):
 *   STR >= 1.5  -> 0.95   (near-total capture — very high velocity)
 *   STR >= 1.0  -> 0.85
 *   STR >= 0.5  -> 0.65
 *   STR >= 0.25 -> 0.45
 *   STR >= 0.1  -> 0.25
 *   else / null -> 0.10   (illiquid or unknown STR — heavy haircut)
 *
 * TODO(calibration): these constants are the spec's starting bracket, not yet fitted to
 * our own sales history. Calibration route once there's enough data: join
 * `arbitrage_purchases` (has buy price + eventual sell-through) against the STR the lot
 * carried at buy time, bucket by the same STR brackets above, and compare actual
 * sell-through rate per bucket to the current capture fraction — nudge brackets toward
 * the observed rate. Revisit after a few months of `arbitrage_purchases` volume once the
 * POC's Jabbz/Gibbo0o-class baskets have had time to sell down.
 */

export interface CaptureBracket {
  /** Inclusive lower STR bound for this bracket (null = the "else"/unknown fallback). */
  minStr: number | null;
  fraction: number;
}

/** Ordered highest-STR-first; captureFraction walks this list top to bottom. */
export const CAPTURE_CURVE: CaptureBracket[] = [
  { minStr: 1.5, fraction: 0.95 },
  { minStr: 1.0, fraction: 0.85 },
  { minStr: 0.5, fraction: 0.65 },
  { minStr: 0.25, fraction: 0.45 },
  { minStr: 0.1, fraction: 0.25 },
  { minStr: null, fraction: 0.1 }, // fallback: STR < 0.1, or null/unknown STR
];

/**
 * Capture fraction f(STR) — what portion of gross POV we expect to actually realise.
 * `null` STR (no data) is treated the same as the worst bracket: unknown liquidity gets
 * the heaviest haircut, not an optimistic default.
 */
export function captureFraction(str: number | null): number {
  if (str == null || !Number.isFinite(str)) return CAPTURE_CURVE[CAPTURE_CURVE.length - 1].fraction;
  for (const bracket of CAPTURE_CURVE) {
    if (bracket.minStr != null && str >= bracket.minStr) return bracket.fraction;
  }
  return CAPTURE_CURVE[CAPTURE_CURVE.length - 1].fraction;
}

export interface PovLot {
  qty: number;
  price: number | null;
  str: number | null;
}

export interface LiquidityAdjustedPovResult {
  /** Σ qty × price — assumes every unit sells at the guide/listing price. */
  gross: number;
  /** Σ qty × price × f(STR) — the liquidity-discounted, "actually realisable" figure. */
  realisable: number;
  /** realisable / gross (0 when gross is 0, to avoid a NaN/Infinity leak to callers). */
  captureRate: number;
}

/**
 * Aggregate a set's (or a store scan's) lots into gross vs. liquidity-adjusted POV.
 * Lots with a null price contribute 0 to both gross and realisable (no benchmark to
 * value them at) but are not dropped — they still count toward the caller's own lot
 * accounting if it inspects the input array separately.
 */
export function liquidityAdjustedPov(lots: PovLot[]): LiquidityAdjustedPovResult {
  let gross = 0;
  let realisable = 0;
  for (const lot of lots) {
    if (lot.price == null || !Number.isFinite(lot.price) || lot.qty <= 0) continue;
    const lineGross = lot.qty * lot.price;
    gross += lineGross;
    realisable += lineGross * captureFraction(lot.str);
  }
  const captureRate = gross > 0 ? realisable / gross : 0;
  return { gross, realisable, captureRate };
}
