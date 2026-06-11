import { describe, it, expect } from 'vitest';
import { shouldSendLowBalanceAlert } from '../monzo-balance.service';

const THRESHOLD = 100_000; // £1,000 in pence

describe('shouldSendLowBalanceAlert', () => {
  it('alerts when the balance crosses below the threshold', () => {
    expect(shouldSendLowBalanceAlert(95_000, 120_000, THRESHOLD)).toBe(true);
  });

  it('does not re-alert while the balance stays below', () => {
    expect(shouldSendLowBalanceAlert(95_000, 90_000, THRESHOLD)).toBe(false);
  });

  it('does not alert when the balance is at or above the threshold', () => {
    expect(shouldSendLowBalanceAlert(100_000, 90_000, THRESHOLD)).toBe(false);
    expect(shouldSendLowBalanceAlert(250_000, 250_000, THRESHOLD)).toBe(false);
  });

  it('alerts on the first ever snapshot if already below', () => {
    expect(shouldSendLowBalanceAlert(50_000, null, THRESHOLD)).toBe(true);
  });

  it('does not alert on the first ever snapshot if above', () => {
    expect(shouldSendLowBalanceAlert(133_028, null, THRESHOLD)).toBe(false);
  });

  it('re-alerts after a recovery and second dip', () => {
    // dip -> alert; recover -> no alert; dip again -> alert
    expect(shouldSendLowBalanceAlert(80_000, 110_000, THRESHOLD)).toBe(true);
    expect(shouldSendLowBalanceAlert(150_000, 80_000, THRESHOLD)).toBe(false);
    expect(shouldSendLowBalanceAlert(99_999, 150_000, THRESHOLD)).toBe(true);
  });
});
