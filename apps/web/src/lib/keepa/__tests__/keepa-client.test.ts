import { describe, it, expect } from 'vitest';
import {
  parseKeepaCSV,
  parseKeepaBuyBoxCSV,
  keepaTimestampToDate,
  KeepaClient,
  KEEPA_CSV_INDEX,
  type KeepaProduct,
} from '../keepa-client';

const KEEPA_EPOCH_MINUTES = 21564000;

/** Convert a JS Date to Keepa minutes. */
function toKeepaMinutes(date: Date): number {
  return Math.floor(date.getTime() / 60000) - KEEPA_EPOCH_MINUTES;
}

const T1 = toKeepaMinutes(new Date('2024-01-01T00:00:00Z'));
const T2 = toKeepaMinutes(new Date('2024-02-01T00:00:00Z'));

describe('parseKeepaCSV (pair format)', () => {
  it('parses [timestamp, value] pairs', () => {
    const points = parseKeepaCSV([T1, 4599, T2, 4799]);
    expect(points).toEqual([
      { date: '2024-01-01', value: 4599 },
      { date: '2024-02-01', value: 4799 },
    ]);
  });

  it('skips negative (out of stock) values', () => {
    const points = parseKeepaCSV([T1, -1, T2, 4799]);
    expect(points).toEqual([{ date: '2024-02-01', value: 4799 }]);
  });
});

describe('parseKeepaBuyBoxCSV (triple format)', () => {
  it('parses [timestamp, price, shipping] triples with landed price', () => {
    const points = parseKeepaBuyBoxCSV([T1, 4999, 399, T2, 5499, 0]);
    expect(points).toEqual([
      { date: '2024-01-01', value: 5398 },
      { date: '2024-02-01', value: 5499 },
    ]);
  });

  it('treats shipping -1 as zero', () => {
    const points = parseKeepaBuyBoxCSV([T1, 4999, -1]);
    expect(points).toEqual([{ date: '2024-01-01', value: 4999 }]);
  });

  it('skips out-of-stock price points', () => {
    const points = parseKeepaBuyBoxCSV([T1, -1, -1, T2, 5499, 399]);
    expect(points).toEqual([{ date: '2024-02-01', value: 5898 }]);
  });

  it('never emits timestamp-magnitude prices (the pre-v2 corruption)', () => {
    // The corrupt pair-parse of this triple array produced values like T2
    // (millions of "pence") and dates around 2011 (shipping as timestamp).
    const points = parseKeepaBuyBoxCSV([T1, 4999, 399, T2, 5499, 399]);
    for (const p of points) {
      expect(p.value).toBeLessThan(100000);
      expect(p.date >= '2024-01-01').toBe(true);
    }
  });
});

describe('extractSnapshots', () => {
  function makeProduct(csv: (number[] | null)[]): KeepaProduct {
    return { asin: 'B000TEST00', csv };
  }

  it('uses the triple parser for BUY_BOX and pair parser for AMAZON', () => {
    const csv: (number[] | null)[] = [];
    csv[KEEPA_CSV_INDEX.AMAZON] = [T1, 4599];
    csv[KEEPA_CSV_INDEX.BUY_BOX] = [T1, 4999, 399, T2, 5499, 0];

    const client = new KeepaClient('test-key');
    const snapshots = client.extractSnapshots(makeProduct(csv));

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]).toMatchObject({
      date: '2024-01-01',
      buy_box_price: 53.98,
      amazon_price: 45.99,
    });
    expect(snapshots[1]).toMatchObject({ date: '2024-02-01', buy_box_price: 54.99 });
  });

  it('keeps recent rank-only dates but drops old ones', () => {
    const recent = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const recentDate = recent.toISOString().split('T')[0];

    const csv: (number[] | null)[] = [];
    csv[KEEPA_CSV_INDEX.BUY_BOX] = [T1, 4999, 0];
    csv[KEEPA_CSV_INDEX.SALES_RANK] = [T2, 1500, toKeepaMinutes(recent), 1600];

    const client = new KeepaClient('test-key');
    const snapshots = client.extractSnapshots(makeProduct(csv));

    const dates = snapshots.map((s) => s.date);
    expect(dates).toContain('2024-01-01'); // buy box row
    expect(dates).toContain(recentDate); // recent rank-only row
    expect(dates).not.toContain('2024-02-01'); // old rank-only date dropped

    const rankOnly = snapshots.find((s) => s.date === recentDate)!;
    expect(rankOnly.sales_rank).toBe(1600);
    expect(rankOnly.buy_box_price).toBeNull();
  });
});

describe('keepaTimestampToDate', () => {
  it('round-trips a known date', () => {
    expect(keepaTimestampToDate(T1)).toBe('2024-01-01');
  });
});
