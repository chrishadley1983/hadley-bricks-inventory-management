import { describe, expect, it } from 'vitest';
import {
  ACTIVE_CYCLE_DAYS,
  ERROR_PARK_ATTEMPTS,
  NEW_RELEASE_CYCLE_DAYS,
  NO_DATA_REQUEUE_DAYS,
  TAIL_CYCLE_DAYS,
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
