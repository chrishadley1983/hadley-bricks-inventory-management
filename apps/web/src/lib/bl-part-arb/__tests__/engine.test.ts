import { describe, expect, it } from 'vitest';
import { DEFAULT_INBOUND_POSTAGE_GBP, DEFAULT_MIN_MARGIN, VAR_FEE_PCT } from '../../bricklink/fees';
import type { PriceGuideView, SideView } from '../../bricklink/price-guide/read';
import { pgKey } from '../../bricklink/price-guide/read';
import type { StoreLot } from '../../bl-store-assessment/types';
import {
  DEFAULT_PART_ARB_INPUTS, anchorFromSide, anchorsFromCacheRow, maxViableAsk,
  nominateStores, scoreStoreLots, unitsWithin, wantedLotsFromScored,
} from '../engine';
import type { AnchorTuple, FlatStoreLot, PartArbInputs } from '../types';

const INPUTS: PartArbInputs = { ...DEFAULT_PART_ARB_INPUTS };

function mkSide(overrides: Partial<SideView>): SideView {
  return {
    soldAvg: null, soldMedian: null, soldQtyAvg: null, soldLots: 0, soldQty: 0, soldLast2moQty: 0,
    stockLots: 0, stockQty: 0, stockMin: null, stockMax: null, stockAvg: null,
    strLots: null, strQty: null, hist: undefined, stockHist: undefined, byMonth: undefined,
    ...overrides,
  };
}

const ITEM = { itemType: 'P' as const, itemNo: '3001', colourId: 5, itemName: 'Brick 2 x 4' };

/** A side that clearly passes every anchor gate: STRlots 2, sold 20/6mo, used x1.90. */
function passingSide(): SideView {
  return mkSide({
    soldAvg: 1.0, soldQty: 20, soldLots: 10, stockLots: 5, stockQty: 10,
    strLots: 2, strQty: 2,
    stockMin: 0.4, stockHist: { '0.4000': 3, '0.9000': 2, '5.0000': 1 },
  });
}

describe('maxViableAsk', () => {
  it('is list x (1 - fees - margin)', () => {
    expect(maxViableAsk(1, 0.2)).toBeCloseTo(1 - VAR_FEE_PCT - 0.2, 10);
    expect(maxViableAsk(2.5, 0.25)).toBeCloseTo(2.5 * (1 - VAR_FEE_PCT - 0.25), 10);
  });
});

describe('DEFAULT_PART_ARB_INPUTS', () => {
  it('shipping default stays in sync with the canonical inbound postage', () => {
    expect(DEFAULT_PART_ARB_INPUTS.shipping).toBe(DEFAULT_INBOUND_POSTAGE_GBP);
  });
  it('margin floor is the global 30% constant (Chris 2026-08-08: "30% global")', () => {
    expect(DEFAULT_PART_ARB_INPUTS.minMargin).toBe(DEFAULT_MIN_MARGIN);
    expect(DEFAULT_MIN_MARGIN).toBe(0.3);
  });
});

describe('unitsWithin', () => {
  it('counts qty inside [minAsk, maxAsk] and ignores the "other" bucket', () => {
    const hist = { '0.5000': 4, '0.8000': 2, '1.2000': 5, other: 9 };
    expect(unitsWithin(hist, 0.1, 0.8)).toBe(6);
    expect(unitsWithin(hist, 0.1, 2)).toBe(11);
  });
  it('excludes buckets below minAsk (penny junk)', () => {
    expect(unitsWithin({ '0.0500': 3, '0.5000': 1 }, 0.1, 1)).toBe(1);
  });
  it('is 0 with no histogram', () => {
    expect(unitsWithin(undefined, 0.1, 1)).toBe(0);
  });
});

describe('anchorFromSide', () => {
  it('builds an anchor when every gate passes (used, STR>=1.5 -> x1.90)', () => {
    const a = anchorFromSide(ITEM, 'U', passingSide(), INPUTS);
    expect(a).not.toBeNull();
    expect(a!.listPrice).toBeCloseTo(1.9, 10); // 1.00 x 1.90
    expect(a!.maxViableAsk).toBeCloseTo(1.9 * (1 - VAR_FEE_PCT - INPUTS.minMargin), 10);
    // ceiling ~1.34: buckets 0.40 (3) + 0.90 (2) count, 5.00 does not
    expect(a!.unitsBuyable).toBe(5);
    expect(a!.strLots).toBe(2);
    expect(a!.condition).toBe('U');
  });
  it('rejects below the house-STR (lots) gate', () => {
    expect(anchorFromSide(ITEM, 'U', mkSide({ ...passingSide(), strLots: 0.9 }), INPUTS)).toBeNull();
  });
  it('rejects below the demand-frequency gate — but has NO sold-value floor', () => {
    expect(anchorFromSide(ITEM, 'U', mkSide({ ...passingSide(), soldQty: 9 }), INPUTS)).toBeNull();
    // 50p part sold 10 times still qualifies (value never gates)
    const cheap = mkSide({ ...passingSide(), soldAvg: 0.5, soldQty: 10, stockHist: { '0.2000': 2 } });
    expect(anchorFromSide(ITEM, 'U', cheap, INPUTS)).not.toBeNull();
  });
  it('rejects when no benchmark (soldAvg null)', () => {
    expect(anchorFromSide(ITEM, 'U', mkSide({ ...passingSide(), soldAvg: null }), INPUTS)).toBeNull();
  });
  it('rejects when no stock units sit below the viable ceiling', () => {
    const side = mkSide({ ...passingSide(), stockHist: { '5.0000': 10 } });
    expect(anchorFromSide(ITEM, 'U', side, INPUTS)).toBeNull();
  });
});

describe('anchorsFromCacheRow', () => {
  it('parses a raw cache row through the canonical parser and screens both conditions', () => {
    const row: Record<string, unknown> = {
      item_type: 'P', item_no: '3001', colour_id: 5, item_name: 'Brick 2 x 4',
      uk_sold_avg_used: 1.0, uk_sold_qty_avg_used: 1.0, uk_sold_median_used: 1.0,
      uk_sold_lots_used: 10, uk_sold_qty_used: 20, uk_sold_last2mo_qty_used: 5,
      uk_stock_lots_used: 5, uk_stock_qty_used: 10, uk_stock_min_used: 0.4,
      uk_sold_avg_new: null, uk_sold_lots_new: 0, uk_sold_qty_new: 0,
      uk_stock_lots_new: 0, uk_stock_qty_new: 0,
      uk_detail: { stockUsed: { hist: { '0.4000': 3 } } },
    };
    const anchors = anchorsFromCacheRow(row, INPUTS);
    expect(anchors).toHaveLength(1);
    expect(anchors[0].condition).toBe('U');
    expect(anchors[0].unitsBuyable).toBe(3);
  });
  it('ignores sets', () => {
    expect(anchorsFromCacheRow({ item_type: 'S', item_no: '75192-1', colour_id: 0 }, INPUTS)).toHaveLength(0);
  });
});

describe('nominateStores', () => {
  const anchor: AnchorTuple = {
    ...ITEM, condition: 'U', soldAvg: 1, soldQty: 20, soldLots: 10, stockLots: 5, stockQty: 10,
    strLots: 2, strQty: 2, listPrice: 1.9, maxViableAsk: 1.34, unitsBuyable: 5, stockMin: 0.4,
  };
  const lot = (over: Partial<FlatStoreLot>): FlatStoreLot => ({
    store_slug: 'StoreA', inv_id: 1, item_type: 'P', item_no: '3001', colour_id: 5,
    condition: 'U', inv_qty: 2, unit_price_gbp: 0.5, scanned_at: '2026-08-01T00:00:00Z', ...over,
  });

  it('hits on tuple+condition match with ask inside [minAsk, ceiling]', () => {
    const noms = nominateStores([anchor], [lot({})], INPUTS);
    expect(noms).toHaveLength(1);
    expect(noms[0].storeSlug).toBe('StoreA');
    expect(noms[0].hits[0].netPerUnit).toBeCloseTo(1.9 * (1 - VAR_FEE_PCT) - 0.5, 10);
  });
  it('rejects wrong condition, over-ceiling and penny asks', () => {
    expect(nominateStores([anchor], [lot({ condition: 'N' })], INPUTS)).toHaveLength(0);
    expect(nominateStores([anchor], [lot({ unit_price_gbp: 1.5 })], INPUTS)).toHaveLength(0);
    expect(nominateStores([anchor], [lot({ unit_price_gbp: 0.05 })], INPUTS)).toHaveLength(0);
  });
  it('groups by store, ranks by anchor net and tracks the oldest scan', () => {
    const noms = nominateStores([anchor], [
      lot({ store_slug: 'Small', inv_id: 1, inv_qty: 1 }),
      lot({ store_slug: 'Big', inv_id: 2, inv_qty: 10, scanned_at: '2026-07-01T00:00:00Z' }),
      lot({ store_slug: 'Big', inv_id: 3, inv_qty: 5, scanned_at: '2026-08-05T00:00:00Z' }),
    ], INPUTS);
    expect(noms.map((n) => n.storeSlug)).toEqual(['Big', 'Small']);
    expect(noms[0].hits).toHaveLength(2);
    expect(noms[0].oldestScanAt).toBe('2026-07-01T00:00:00Z');
  });
});

describe('scoreStoreLots', () => {
  const mkLot = (over: Partial<StoreLot>): StoreLot => ({
    invID: 1, itemType: 'P', itemNo: '3001', colourId: 5, colourName: 'Red',
    itemName: 'Brick 2 x 4', invNew: 'Used', invComplete: null, invQty: 2,
    unitPriceGBP: 0.5, description: null, ...over,
  });
  const mkView = (used: SideView, coverage: 'uk' | 'none' = 'uk'): PriceGuideView => ({
    item: { itemType: 'P', itemNo: '3001', blColourId: 5 }, itemName: 'Brick 2 x 4',
    used, new: mkSide({}), freshnessDays: 1, coverage,
    qtyShareAtOrAbove: () => null,
  });
  const views = new Map<string, PriceGuideView>([[pgKey('P', '3001', 5), mkView(passingSide())]]);

  it('scores a passing lot with ex-postage net at the canonical fee stack', () => {
    const [item] = scoreStoreLots([mkLot({})], views, INPUTS);
    // list = 1.00 x 1.90 (used, STR 2); net = list x (1-0.094) - 0.50
    expect(item.listPrice).toBeCloseTo(1.9, 10);
    expect(item.netPerUnit).toBeCloseTo(1.9 * (1 - VAR_FEE_PCT) - 0.5, 10);
    expect(item.marginPct).toBeCloseTo(((1.9 * (1 - VAR_FEE_PCT) - 0.5) / 1.9) * 100, 8);
    expect(item.passed).toBe(true);
    expect(item.inboundPerUnit).toBe(0);
    expect(item.colourId).toBe(5);
  });
  it('rejects damage-note lots (negation-aware filter shared with the assessment engine)', () => {
    const [item] = scoreStoreLots([mkLot({ description: 'leg cracked' })], views, INPUTS);
    expect(item.passed).toBe(false);
    expect(item.damage).toBe(true);
    const [ok] = scoreStoreLots([mkLot({ description: 'no cracks at all' })], views, INPUTS);
    expect(ok.passed).toBe(true);
  });
  it('rejects below min-ask, margin and STR gates', () => {
    expect(scoreStoreLots([mkLot({ unitPriceGBP: 0.05 })], views, INPUTS)[0].passed).toBe(false);
    expect(scoreStoreLots([mkLot({ unitPriceGBP: 1.6 })], views, INPUTS)[0].passed).toBe(false); // margin ~9.5% < 20%
    const strInputs = { ...INPUTS, minStr: 3 };
    expect(scoreStoreLots([mkLot({})], views, strInputs)[0].passed).toBe(false);
  });
  it('treats non-UK coverage as no benchmark', () => {
    const worldViews = new Map([[pgKey('P', '3001', 5), mkView(passingSide(), 'none')]]);
    const [item] = scoreStoreLots([mkLot({})], worldViews, INPUTS);
    expect(item.ukSoldAvg).toBeNull();
    expect(item.passed).toBe(false);
  });
  it('excludes set lots entirely', () => {
    expect(scoreStoreLots([mkLot({ itemType: 'S', itemNo: '75192-1' })], views, INPUTS)).toHaveLength(0);
  });
});

describe('wantedLotsFromScored', () => {
  it('keeps passed lots at/above the STR floor and carries identity + percentage margin', () => {
    const items = scoreStoreLots(
      [
        { invID: 1, itemType: 'P', itemNo: '3001', colourId: 5, colourName: 'Red', itemName: 'Brick', invNew: 'Used', invComplete: null, invQty: 2, unitPriceGBP: 0.5, description: null },
      ],
      new Map([[pgKey('P', '3001', 5), {
        item: { itemType: 'P' as const, itemNo: '3001', blColourId: 5 }, itemName: 'Brick',
        used: passingSide(), new: mkSide({}), freshnessDays: 1, coverage: 'uk' as const,
        qtyShareAtOrAbove: () => null,
      }]]),
      INPUTS
    );
    const wanted = wantedLotsFromScored(items, 0.25);
    expect(wanted).toHaveLength(1);
    expect(wanted[0].colourId).toBe(5);
    expect(wanted[0].marginPct).toBeGreaterThan(1); // percentage convention, not fraction
    expect(wantedLotsFromScored(items, 5)).toHaveLength(0); // STR floor filters
  });
});
