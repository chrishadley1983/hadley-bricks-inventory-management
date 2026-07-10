import { describe, it, expect } from 'vitest';
import {
  computeWindowMedianPrice,
  MIN_CORROBORATING_SNAPSHOTS,
  type PriceSnapshot,
} from '../historical-appreciation.service';

function snap(date: string, price: number | null): PriceSnapshot {
  return { set_num: 'test-1', date, price_gbp: price, sales_rank: null };
}

describe('computeWindowMedianPrice', () => {
  const RRP = 50;

  it('returns the median of valid snapshots in the window', () => {
    const snapshots = [
      snap('2024-01-01', 60),
      snap('2024-01-05', 80),
      snap('2024-01-10', 70),
    ];
    const result = computeWindowMedianPrice(snapshots, '2024-01-05', 30, RRP);
    expect(result.price).toBe(70);
    expect(result.snapshots).toBe(3);
  });

  it('averages the middle pair for even counts', () => {
    const snapshots = [
      snap('2024-01-01', 60),
      snap('2024-01-02', 70),
      snap('2024-01-03', 80),
      snap('2024-01-04', 90),
    ];
    const result = computeWindowMedianPrice(snapshots, '2024-01-02', 30, RRP);
    expect(result.price).toBe(75);
  });

  it('rejects junk prices far above RRP (the timestamp-as-price corruption)', () => {
    const snapshots = [
      snap('2024-01-01', 73350.96), // Keepa timestamp misparsed as price
      snap('2024-01-02', 65),
      snap('2024-01-03', 70),
      snap('2024-01-04', 75),
    ];
    const result = computeWindowMedianPrice(snapshots, '2024-01-02', 30, RRP);
    expect(result.price).toBe(70);
    expect(result.snapshots).toBe(3);
  });

  it('rejects prices below the RRP floor', () => {
    const snapshots = [
      snap('2024-01-01', 1.5), // < 5% of RRP — junk
      snap('2024-01-02', 65),
      snap('2024-01-03', 70),
      snap('2024-01-04', 75),
    ];
    const result = computeWindowMedianPrice(snapshots, '2024-01-02', 30, RRP);
    expect(result.snapshots).toBe(3);
  });

  it('returns null without enough corroborating snapshots', () => {
    const snapshots = [snap('2024-01-01', 60), snap('2024-01-02', 65)];
    const result = computeWindowMedianPrice(snapshots, '2024-01-01', 30, RRP);
    expect(result.price).toBeNull();
    expect(result.snapshots).toBe(2);
    expect(MIN_CORROBORATING_SNAPSHOTS).toBeGreaterThan(2);
  });

  it('ignores snapshots outside the window', () => {
    const snapshots = [
      snap('2023-06-01', 60),
      snap('2024-01-01', 65),
      snap('2024-01-02', 70),
      snap('2024-01-03', 75),
      snap('2024-08-01', 200),
    ];
    const result = computeWindowMedianPrice(snapshots, '2024-01-02', 30, RRP);
    expect(result.price).toBe(70);
    expect(result.snapshots).toBe(3);
  });

  it('ignores null prices', () => {
    const snapshots = [
      snap('2024-01-01', null),
      snap('2024-01-02', 65),
      snap('2024-01-03', 70),
      snap('2024-01-04', 75),
    ];
    const result = computeWindowMedianPrice(snapshots, '2024-01-02', 30, RRP);
    expect(result.snapshots).toBe(3);
  });
});
