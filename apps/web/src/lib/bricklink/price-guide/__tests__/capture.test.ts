import { describe, it, expect } from 'vitest';
import { blGuideToQuadrant, fromBlApi } from '../capture';
import { recentMonthsQty } from '../../price-guide-page';
import type { BrickLinkPriceGuide, BrickLinkPriceDetail } from '../../types';

const det = (quantity: number, unit_price: string, date_ordered?: string): BrickLinkPriceDetail => ({
  quantity, unit_price, shipping_available: true, seller_country_code: 'UK', buyer_country_code: 'UK', date_ordered,
});

const soldUsed: BrickLinkPriceGuide = {
  item: { no: '3001', type: 'PART' }, new_or_used: 'U', currency_code: 'GBP',
  min_price: '0.0300', max_price: '1.7700', avg_price: '0.5200', qty_avg_price: '0.5100',
  unit_quantity: 4, total_quantity: 13,
  price_detail: [
    det(9, '0.4675', '2026-06-10T00:00:00Z'),
    det(2, '0.5070', '2026-05-30T00:00:00Z'),
    det(1, '0.5850', '2026-06-11T00:00:00Z'),
    det(1, '0.6790', '2026-07-01T00:00:00Z'),
  ],
};
const empty = (cond: 'N' | 'U'): BrickLinkPriceGuide => ({
  item: { no: '3001', type: 'PART' }, new_or_used: cond, currency_code: 'GBP',
  min_price: '0', max_price: '0', avg_price: '0', qty_avg_price: '0', unit_quantity: 0, total_quantity: 0, price_detail: [],
});

describe('blGuideToQuadrant', () => {
  const q = blGuideToQuadrant(soldUsed, true);

  it('carries lots/qty from unit_quantity/total_quantity', () => {
    expect(q.lots).toBe(4);
    expect(q.qty).toBe(13);
  });

  it('computes lot-median from price_detail', () => {
    // sorted [0.4675, 0.5070, 0.5850, 0.6790] -> (0.5070+0.5850)/2
    expect(q.median).toBeCloseTo(0.546, 4);
  });

  it('builds a qty-integral histogram', () => {
    expect(q.hist['0.4675']).toBe(9);
    expect(Object.values(q.hist).reduce((s, v) => s + v, 0)).toBe(13); // == qty
  });

  it('groups by month for sold; recentMonthsQty picks the 2 latest', () => {
    expect(q.byMonth['June 2026'].qty).toBe(10);
    expect(q.byMonth['May 2026'].qty).toBe(2);
    // 2 latest months = July(1) + June(10) = 11
    expect(recentMonthsQty(q, 2)).toBe(11);
  });

  it('stock quadrant carries no months', () => {
    const s = blGuideToQuadrant({ ...soldUsed, unit_quantity: 5, total_quantity: 20 }, false);
    expect(Object.keys(s.byMonth)).toHaveLength(0);
  });
});

describe('fromBlApi', () => {
  it('assembles a COMPLETE row: all 4 UK quadrants present', () => {
    const r = fromBlApi(
      { itemType: 'P', itemNo: '3001', blColourId: 11 },
      { soldNew: empty('N'), stockNew: empty('N'), soldUsed, stockUsed: empty('U') }
    );
    expect(r.item.colourId).toBe(11);
    expect(r.uk.soldUsed.qty).toBe(13);
    // every quadrant is present (complete row, no clobber possible)
    for (const k of ['soldNew', 'soldUsed', 'stockNew', 'stockUsed'] as const) {
      expect(r.uk[k]).toBeDefined();
    }
    expect(r.finalUrl).toBe('bl_api');
  });
});
