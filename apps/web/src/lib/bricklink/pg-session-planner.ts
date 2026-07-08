/**
 * Session/breather planner for the lane D (catalogPG) nightly refresh driver.
 *
 * Pure and deterministic: no clocks, no I/O, no randomness. The driver
 * (`scripts/pg/pg-refresh-cycle.ts`) is the only caller that touches real time —
 * it samples `Date.now()` and feeds elapsed/window minutes in as plain numbers so
 * this module stays trivially unit-testable (see `__tests__/pg-session-planner.test.ts`).
 *
 * Design basis: spec.md §4.2 (throughput plan) and §4.4 (failure & rate discipline).
 *   - A session runs until it hits `sessionSize` requests, then takes a normal
 *     `breatherMins` breather (§4.2: 350 pages/session, 20-min breathers, ~6/night).
 *   - A BL block/captcha signal ends the session early and forces a 30-minute
 *     backoff instead of the normal breather (§4.4: "403 → 30-min backoff, resume
 *     from cache").
 *   - The whole run stops after `maxSessions`, after two *consecutive* blocked
 *     sessions (a normal session resets the consecutive-block counter), or once
 *     the night's window has elapsed — whichever comes first.
 */

/** One planned session slot within the night's window (for logging/ETA only — the
 *  driver does not use `estStartMinute` to gate anything; `nextAction` is what
 *  actually governs pacing at runtime). */
export interface PlannedSession {
  /** 1-based session number. */
  index: number;
  /** Minutes from the start of the window this session is planned to begin,
   *  assuming every prior session used exactly `breatherMins` of downtime and no
   *  fetch time (a lower bound — actual fetch time pushes real starts later). */
  estStartMinute: number;
}

export interface NightPlanOptions {
  /** Hour (0-23, may be fractional) the acquisition window opens. Default 0. */
  windowStartHour?: number;
  /** Hour the acquisition window closes. Default 7. If <= windowStartHour it is
   *  treated as wrapping past midnight (e.g. start 23, end 7 -> an 8h window). */
  windowEndHour?: number;
  /** Requests per session before a normal breather (spec default: 350). */
  sessionSize: number;
  /** Minutes to rest between normal (non-blocked) sessions (spec default: 20). */
  breatherMins: number;
  /** Hard cap on sessions per run (spec default: 6). */
  maxSessions: number;
}

export interface NightPlan {
  windowStartMinute: number;
  /** Total minutes available in the window, always > 0. Wraps past midnight are
   *  folded in (e.g. start 23, end 7 -> 480). */
  windowMinutes: number;
  sessionSize: number;
  breatherMins: number;
  maxSessions: number;
  sessions: PlannedSession[];
  /** sessionSize * maxSessions — the design-cadence ceiling for one run. */
  estTotalPages: number;
  /** True when the *breather* time alone (ignoring fetch time entirely) fits
   *  inside the window. False means maxSessions/breatherMins are mutually
   *  inconsistent with the window even before any page is fetched — a
   *  configuration smell worth logging loudly. */
  estFitsWindow: boolean;
}

/** Build the night's session skeleton. Pure — hours are a *duration budget*
 *  (0..windowEndHour), not real wall-clock hours; the driver measures elapsed
 *  time from its own start, not from midnight, so this never has to reason
 *  about what day it is. */
export function planNight(opts: NightPlanOptions): NightPlan {
  const windowStartHour = opts.windowStartHour ?? 0;
  const windowEndHour = opts.windowEndHour ?? 7;
  const windowStartMinute = windowStartHour * 60;
  let windowEndMinute = windowEndHour * 60;
  if (windowEndMinute <= windowStartMinute) windowEndMinute += 24 * 60;
  const windowMinutes = windowEndMinute - windowStartMinute;

  const sessions: PlannedSession[] = [];
  let cursor = 0;
  for (let i = 1; i <= opts.maxSessions; i++) {
    sessions.push({ index: i, estStartMinute: cursor });
    cursor += opts.breatherMins;
  }

  const totalBreatherMinutes = opts.breatherMins * Math.max(0, opts.maxSessions - 1);

  return {
    windowStartMinute,
    windowMinutes,
    sessionSize: opts.sessionSize,
    breatherMins: opts.breatherMins,
    maxSessions: opts.maxSessions,
    sessions,
    estTotalPages: opts.sessionSize * opts.maxSessions,
    estFitsWindow: totalBreatherMinutes <= windowMinutes,
  };
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

export type PlannerAction = 'fetch' | 'breather' | 'backoff' | 'stop';

/**
 * Everything `nextAction` needs to decide what happens next. The four fields the
 * spec calls out explicitly — `requestsThisSession`, `consecutiveFails`,
 * `sessionsCompleted`, `blockedSessions` — are the driver's live counters;
 * `sessionSize`/`maxSessions` are the run's config (from `NightPlan`); and
 * `elapsedMinutes`/`windowMinutes` are the time budget, passed in as plain
 * numbers so the function never touches a clock itself.
 */
export interface PlannerState {
  /** Requests completed (success or failure) since the last breather/backoff. */
  requestsThisSession: number;
  /** Consecutive PgBlockError/PgCaptchaError hits since the last successful
   *  fetch (or the last backoff). Any value > 0 IS the "block signal" — the
   *  driver should reset this to 0 on every non-block outcome (success,
   *  PgNotFoundError, PgNoDataError, or any other error that isn't a block). */
  consecutiveFails: number;
  /** Sessions fully ended (via breather or backoff) so far this run. */
  sessionsCompleted: number;
  /** Consecutive sessions that ended via backoff (block). A normal
   *  breather-ended session resets this to 0. */
  blockedSessions: number;
  /** Requests per session before a normal breather. */
  sessionSize: number;
  /** Hard cap on sessions per run. */
  maxSessions: number;
  /** Minutes elapsed since the run started. */
  elapsedMinutes: number;
  /** Total minutes available in the run's window. */
  windowMinutes: number;
}

/**
 * Pure state-transition function for the lane D driver's main loop.
 *
 * Precedence (stop conditions first, so a run never "fetches" its way past a
 * hard boundary even if multiple conditions are simultaneously true):
 *   1. window elapsed -> stop
 *   2. two consecutive blocked sessions -> stop
 *   3. maxSessions reached -> stop
 *   4. a block signal is live -> backoff
 *   5. session quota reached -> breather
 *   6. otherwise -> fetch
 */
export function nextAction(state: PlannerState): PlannerAction {
  if (state.elapsedMinutes >= state.windowMinutes) return 'stop';
  if (state.blockedSessions >= 2) return 'stop';
  if (state.sessionsCompleted >= state.maxSessions) return 'stop';
  if (state.consecutiveFails > 0) return 'backoff';
  if (state.requestsThisSession >= state.sessionSize) return 'breather';
  return 'fetch';
}
