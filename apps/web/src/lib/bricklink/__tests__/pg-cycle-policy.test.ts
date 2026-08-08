import { describe, expect, it } from 'vitest';
import {
  ACTIVE_CYCLE_DAYS,
  ERROR_PARK_ATTEMPTS,
  NEW_RELEASE_CYCLE_DAYS,
  NO_DATA_REQUEUE_DAYS,
  TAIL_CYCLE_DAYS,
  COOL_OFF_DAYS,
  SOLD_UNAVAILABLE_MARKER,
  WORK_AHEAD_BACKLOG_MAX_DAYS,
  WORK_AHEAD_HORIZON_DAYS,
  WORK_AHEAD_MIN_LEAD_DAYS,
  isRepeatSoldUnavailable,
  cycleDaysForTier,
  effectiveMinCycleDays,
  isThrottleShapedFailure,
  pgClaimStages,
} from '../pg-cycle-policy';

describe('pg-cycle-policy', () => {
  it('carries the 2026-07-19 cadence policy', () => {
    expect(ACTIVE_CYCLE_DAYS).toBe(60);
    expect(NEW_RELEASE_CYCLE_DAYS).toBe(28);
    expect(TAIL_CYCLE_DAYS).toBe(90);
    expect(NO_DATA_REQUEUE_DAYS).toBe(90);
    expect(ERROR_PARK_ATTEMPTS).toBe(8);
  });

  it('maps tier to cycle days', () => {
    expect(cycleDaysForTier('active')).toBe(ACTIVE_CYCLE_DAYS);
    expect(cycleDaysForTier('tail')).toBe(TAIL_CYCLE_DAYS);
  });

  // Work-ahead (Chris 2026-08-07). The point of these is that the horizon stays BOUNDED:
  // capacity (~5,700/day) far exceeds steady-state demand (~2,450/day), so an unbounded
  // pull-forward would compress the cycle until demand met capacity.
  describe('work-ahead', () => {
    it('carries a bounded horizon and a park-sentinel guard', () => {
      expect(WORK_AHEAD_HORIZON_DAYS).toBe(3);
      expect(WORK_AHEAD_MIN_LEAD_DAYS).toBe(1);
      expect(WORK_AHEAD_BACKLOG_MAX_DAYS).toBe(365);
      // the backlog guard must sit far below the +100y park sentinel it exists to exclude
      expect(WORK_AHEAD_BACKLOG_MAX_DAYS).toBeLessThan(365 * 100);
      // ...and the cadence-compressing horizon must stay a small fraction of the cycle
      expect(WORK_AHEAD_HORIZON_DAYS).toBeLessThan(ACTIVE_CYCLE_DAYS / 10);
    });

    // The coupling that makes the sold-unavailable fix work. If someone lengthens the
    // cool-off to +2d without raising the lead floor, work-ahead re-claims the cooling row
    // in the SAME run and isRepeatSoldUnavailable fires with no day boundary passed —
    // all-zero L1 row, active -> tail demotion, on what may be a live BL outage. Verified
    // during PR #667 validation: at +2d the row is backlog-claimable and the fix is dead.
    it('keeps the cool-off inside the work-ahead lead floor', () => {
      expect(COOL_OFF_DAYS).toBeLessThanOrEqual(WORK_AHEAD_MIN_LEAD_DAYS);
    });

    it('orders the claim ladder due -> backlog -> ahead, schedule first', () => {
      expect(pgClaimStages({ workAhead: true })).toEqual(['due', 'backlog', 'ahead']);
    });

    it('collapses to due-only when work-ahead is off (--no-work-ahead)', () => {
      expect(pgClaimStages({ workAhead: false })).toEqual(['due']);
    });

    it('states the real cadence floor the horizon implies', () => {
      expect(effectiveMinCycleDays('active')).toBe(57);
      expect(effectiveMinCycleDays('tail')).toBe(87);
      expect(effectiveMinCycleDays('active', 0)).toBe(ACTIVE_CYCLE_DAYS);
      // a horizon can never invert the cycle, however it is configured
      expect(effectiveMinCycleDays('active', 9999)).toBeGreaterThan(0);
      expect(effectiveMinCycleDays('active', -5)).toBe(ACTIVE_CYCLE_DAYS);
    });
  });

  describe('isThrottleShapedFailure', () => {
    it('treats HTTP status, network and HTTP-200 challenge-page failures as throttle-shaped (no attempts climb)', () => {
      expect(isThrottleShapedFailure('HTTP 403')).toBe(true);
      expect(isThrottleShapedFailure('HTTP 429')).toBe(true);
      expect(isThrottleShapedFailure('HTTP 503')).toBe(true);
      expect(isThrottleShapedFailure('network: fetch failed')).toBe(true);
      expect(isThrottleShapedFailure('challenge-page (len=331)')).toBe(true);
    });

    it('treats tuple-shaped failures as real failures (attempts climb)', () => {
      expect(isThrottleShapedFailure('unparseable response (len=331)')).toBe(false);
      expect(isThrottleShapedFailure('currency validation: non-GBP basis')).toBe(false);
      expect(isThrottleShapedFailure('challenge')).toBe(false);
      expect(isThrottleShapedFailure('lane-a: upsert failed')).toBe(false);
      // Not the bare "HTTP <status>" shape lane C emits — must not be swallowed.
      expect(isThrottleShapedFailure('HTTP 403 something else')).toBe(false);
    });
  });
});

// Sold-unavailable escalation ladder (Chris 2026-07-25). BOTH sold quadrants reading
// "(Unavailable)" is ambiguous on one page — outage vs an item that never sold in either
// condition. The 1st hit requeues +1d; a 2nd hit therefore spans a day boundary, which an
// outage does not survive, so we accept the empty answer onto the 90d NO_DATA cycle.
describe('isRepeatSoldUnavailable', () => {
  it('a tuple with no prior error is a FIRST hit (requeue +1d, do not accept as no-data)', () => {
    expect(isRepeatSoldUnavailable(null)).toBe(false);
    expect(isRepeatSoldUnavailable(undefined)).toBe(false);
    expect(isRepeatSoldUnavailable('')).toBe(false);
  });

  it('a tuple already marked sold-unavailable is a REPEAT (accept as no-data)', () => {
    expect(isRepeatSoldUnavailable(`${SOLD_UNAVAILABLE_MARKER} (both sold quadrants unavailable)`)).toBe(true);
    // legacy marker text written before 2026-07-25 must still escalate
    expect(isRepeatSoldUnavailable('sold_unavailable (BL site outage)')).toBe(true);
  });

  it('an unrelated prior failure does NOT escalate — only sold-unavailable repeats do', () => {
    expect(isRepeatSoldUnavailable('HTTP 403')).toBe(false);
    expect(isRepeatSoldUnavailable('Not in BL catalog')).toBe(false);
    expect(isRepeatSoldUnavailable('network: ECONNRESET')).toBe(false);
    expect(isRepeatSoldUnavailable('challenge-page')).toBe(false);
  });

  it('the marker it matches is the one the queue writer actually stamps', () => {
    // guards against the driver's last_error text and this predicate drifting apart
    const stamped = `${SOLD_UNAVAILABLE_MARKER} (both sold quadrants unavailable)`;
    expect(isRepeatSoldUnavailable(stamped)).toBe(true);
  });

  it('sold-unavailable is still throttle-shaped, so it never increments the park ladder', () => {
    expect(isThrottleShapedFailure('sold-unavailable')).toBe(true);
  });
});
