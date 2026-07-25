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

/** Marker written to `bl_pg_refresh_queue.last_error` by a sold-unavailable hit. The
 *  presence of this marker on the NEXT attempt is what promotes a tuple to no-data. */
export const SOLD_UNAVAILABLE_MARKER = 'sold_unavailable';

/**
 * Sold-unavailable escalation ladder (Chris, 2026-07-25).
 *
 * BL rendering "(Unavailable)" in BOTH sold quadrants is ambiguous on a single page: it
 * is the signature of a site-side sold-data outage AND of an item that simply never sold
 * in either condition. The first hit is therefore treated as a possible outage and
 * requeued +1d. Because that requeue is a full day, a SECOND hit on the same tuple means
 * BL has withheld both quadrants across a day boundary — which an outage does not do, but
 * a permanently dead item does. At that point we accept the empty answer and move the
 * tuple to the 90d NO_DATA cycle instead of retrying it +1d for ever.
 *
 * Any successful scrape in between clears `last_error`, restarting the ladder — so this
 * only ever fires on genuinely consecutive failures.
 *
 * Rate context that motivated it: on 2026-07-25 the tail measured ~17% sold-unavailable
 * (33 of 197 in one session) against 0.17% on the active tier. That is a dead-item
 * population, not an outage, and without this ladder every one of them returns +1d daily
 * for ever.
 */
export function isRepeatSoldUnavailable(lastError: string | null | undefined): boolean {
  return (lastError ?? '').startsWith(SOLD_UNAVAILABLE_MARKER);
}

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
  return (
    /^HTTP \d{3}$/.test(reason) ||
    reason.startsWith('network:') ||
    reason.startsWith('challenge-page') ||
    // BL site-side sold-data outage ("(Unavailable)" quadrants, 2026-07-21): site
    // infrastructure state, never the tuple's fault.
    reason.startsWith('sold-unavailable')
  );
}
