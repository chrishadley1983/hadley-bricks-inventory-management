/**
 * PG refresh-cycle policy — the ONLY place the 60/28/90-day cadence constants live
 * (Chris 2026-07-19; coverage audit 2026-07-20 found three writers still carrying the
 * pre-policy 28d value). Every queue writer that sets `next_due_at` after a successful
 * scrape imports from here: pg-refresh-cycle (nightly lane D), pg-residual-fill (lane C),
 * pg-page-sweep (ad-hoc bulk), bl-pg-store-scan (store-scan enrich write-back).
 *
 * Field semantics on `bl_pg_refresh_queue` (post 20260720150000_pg_coverage_truth):
 *   - last_refreshed_at: set ONLY by an actual scrape (page or API capture). Coverage
 *     truth lives in L3/L1 regardless — report via the pg_coverage_report view.
 *   - seeded_at: "offered by a seed/enqueue path, already covered — skip gap-fill".
 *   - A confirmed no-data scrape IS a successful scrape: zero L1 row (no_data=true),
 *     last_refreshed_at stamped, re-checked on the NO_DATA cycle. Never counted as a
 *     failure and never left looking uncovered.
 */

/** Active-tier UK refresh cycle (days). */
export const ACTIVE_CYCLE_DAYS = 60;
/** New-for-the-current-year items: fast cycle for fast price movement. */
export const NEW_RELEASE_CYCLE_DAYS = 28;
/** Tail-tier background UK cycle (days). */
export const TAIL_CYCLE_DAYS = 90;
/** Re-check cadence for tuples confirmed to have no sales/stock data anywhere. */
export const NO_DATA_REQUEUE_DAYS = 90;
/** Gap-fill parks a tuple for operator attention after this many failed attempts. */
export const ERROR_PARK_ATTEMPTS = 8;

/** Tier-based cycle length. The new-for-year 28d refinement needs catalogue knowledge —
 * callers that have it (pg-refresh-cycle) layer it on top; ad-hoc writers use this. */
export function cycleDaysForTier(tier: 'active' | 'tail'): number {
  return tier === 'tail' ? TAIL_CYCLE_DAYS : ACTIVE_CYCLE_DAYS;
}

/**
 * Lane C (anon curl) failure triage: is this failure shaped like throttling /
 * infrastructure (HTTP status, network error, HTTP-200 challenge page) rather than
 * something wrong with the tuple itself? Throttle-shaped failures must NOT increment
 * `attempts` — attempts is the "this tuple is broken" ladder that parks rows at
 * ERROR_PARK_ATTEMPTS, and a run of 403s (or soft-block challenge pages) used to park
 * perfectly healthy tuples (audit 2026-07-20 finding + follow-up).
 */
export function isThrottleShapedFailure(reason: string): boolean {
  return /^HTTP \d{3}$/.test(reason) || reason.startsWith('network:') || reason.startsWith('challenge-page');
}
