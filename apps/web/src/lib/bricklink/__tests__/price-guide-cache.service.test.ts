import { describe, it, expect } from 'vitest';
import { toPgCacheRow, pgCacheKey, PG_PARSE_VERSION } from '../price-guide-cache.service';
import { computeSideStats, type PgScrapeResult } from '../price-guide-page';

function makeResult(): PgScrapeResult {
  const quads = {
    soldNew: [['July 2026', 2, 0.1, false], ['June 2026', 3, 0.3, true]] as [string | null, number, number, boolean][],
    soldUsed: [['July 2026', 5, 0.5, false], ['May 2026', 1, 0.4, false]] as [string | null, number, number, boolean][],
    stockNew: [[null, 10, 0.2, false]] as [string | null, number, number, boolean][],
    stockUsed: [[null, 7, 0.15, false], [null, 3, 0.9, true]] as [string | null, number, number, boolean][],
  };
  return {
    item: { itemType: 'P', itemNo: '3001', colourId: 11 },
    itemName: 'Brick 2 x 4',
    uk: computeSideStats(quads, true),
    world: computeSideStats(quads, false),
    finalUrl: 'https://www.bricklink.com/catalogPG.asp?P=3001&colorID=11',
    scrapedAt: '2026-07-07T15:00:00.000Z',
  };
}

describe('pgCacheKey', () => {
  it('keys by type:no:colour', () => {
    expect(pgCacheKey({ itemType: 'P', itemNo: '3001', colourId: 11 })).toBe('P:3001:11');
    expect(pgCacheKey({ itemType: 'M', itemNo: 'sw1479', colourId: 0 })).toBe('M:sw1479:0');
  });
});

describe('toPgCacheRow', () => {
  const row = toPgCacheRow(makeResult());

  it('maps identity and flattened UK sold columns (lots = transactions, qty = pieces)', () => {
    expect(row.item_type).toBe('P');
    expect(row.item_no).toBe('3001');
    expect(row.colour_id).toBe(11);
    expect(row.uk_sold_lots_new).toBe(1); // converted June row excluded from UK
    expect(row.uk_sold_qty_new).toBe(2);
    expect(row.uk_sold_lots_used).toBe(2);
    expect(row.uk_sold_qty_used).toBe(6);
    expect(row.uk_sold_avg_used).toBeCloseTo(0.45, 4);
    expect(row.uk_sold_median_used).toBeCloseTo(0.45, 4); // true median of [0.4, 0.5]
  });

  it('computes last-2-months recency from month buckets', () => {
    // Used: July (5) + May (1) — but last 2 months by date are July and May here,
    // since those are the only two months present.
    expect(row.uk_sold_last2mo_qty_used).toBe(6);
    expect(row.uk_sold_last2mo_qty_new).toBe(2);
  });

  it('maps UK stock columns from non-converted rows only', () => {
    expect(row.uk_stock_qty_used).toBe(7); // converted 0.9 listing excluded
    expect(row.uk_stock_lots_used).toBe(1);
    expect(row.uk_stock_min_used).toBeCloseTo(0.15, 4);
  });

  it('stores worldwide aggregates alongside for context', () => {
    const world = row.world_detail as { soldNew: { lots: number; qty: number } };
    expect(world.soldNew.lots).toBe(2); // converted row included in world
    expect(world.soldNew.qty).toBe(5);
  });

  it('zeroes colour for non-part items and stamps parse version', () => {
    const m = toPgCacheRow({ ...makeResult(), item: { itemType: 'M', itemNo: 'sw1479', colourId: 99 } });
    expect(m.colour_id).toBe(0);
    expect(m.parse_version).toBe(PG_PARSE_VERSION);
  });
});
