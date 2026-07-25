import { describe, expect, it } from 'vitest';
import {
  ACTIVE_CYCLE_DAYS,
  ERROR_PARK_ATTEMPTS,
  NEW_RELEASE_CYCLE_DAYS,
  NO_DATA_REQUEUE_DAYS,
  TAIL_CYCLE_DAYS,
  SOLD_UNAVAILABLE_MARKER,
  isRepeatSoldUnavailable,
  cycleDaysForTier,
  isThrottleShapedFailure,
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
