import { describe, it, expect } from 'vitest';
import { assembleAssessment } from '../engine';
import { pgKey, type PriceGuideView, type SideView } from '../../bricklink/price-guide/read';
import { DEFAULT_INPUTS, type StoreLot, type AssessmentInputs } from '../types';

const EMPTY: SideView = {
  soldAvg: null, soldMedian: null, soldQtyAvg: null, soldLots: 0, soldQty: 0, soldLast2moQty: 0,
  stockLots: 0, stockQty: 0, stockMin: null, strLots: null, strQty: null, hist: undefined,
};

function side(p: Partial<SideView>): SideView {
  const s = { ...EMPTY, ...p };
  s.strLots = s.stockLots > 0 ? s.soldLots / s.stockLots : null;
  s.strQty = s.stockQty > 0 ? s.soldQty / s.stockQty : null;
  return s;
}

function view(itemType: 'P' | 'S' | 'M', itemNo: string, blColour: number, used: SideView, neu: SideView, coverage: PriceGuideView['coverage'] = 'uk'): PriceGuideView {
  return {
    item: { itemType, itemNo, blColourId: blColour }, itemName: `${itemNo} name`,
    used, new: neu, freshnessDays: 1, coverage,
    qtyShareAtOrAbove: () => null,
  };
}

const inputs: AssessmentInputs = { ...DEFAULT_INPUTS };

const lots: StoreLot[] = [
  // A: cheap fast-mover, scarce → within margin + high STR + magnet
  { invID: 1, itemType: 'P', itemNo: '3001', colourId: 5, colourName: 'Red', itemName: 'Brick 2x4', invNew: 'Used', invComplete: null, invQty: 10, unitPriceGBP: 0.50, description: null },
  // B: overpriced new part → not within margin, OVER position
  { invID: 2, itemType: 'P', itemNo: '3002', colourId: 1, colourName: 'Blue', itemName: 'Brick 2x3', invNew: 'New', invComplete: null, invQty: 1, unitPriceGBP: 5.00, description: null },
  // C: set with no price data → no benchmark
  { invID: 3, itemType: 'S', itemNo: '8043', colourId: 0, colourName: null, itemName: 'Excavator', invNew: 'New', invComplete: 'Complete', invQty: 1, unitPriceGBP: 100, description: null },
];

const pgMap = new Map<string, PriceGuideView>([
  [pgKey('P', '3001', 5), view('P', '3001', 5, side({ soldAvg: 1.00, soldLots: 20, soldQty: 40, stockLots: 10, stockQty: 20 }), EMPTY)],
  [pgKey('P', '3002', 1), view('P', '3002', 1, EMPTY, side({ soldAvg: 2.00, soldLots: 5, soldQty: 5, stockLots: 5, stockQty: 5 }))],
  [pgKey('S', '8043', 0), view('S', '8043', 0, EMPTY, EMPTY, 'none')],
]);

const supplyMap = new Map<string, { stockLotsNew: number | null; stockLotsUsed: number | null; demandRank: number | null }>([
  [pgKey('P', '3001', 5), { stockLotsNew: null, stockLotsUsed: 2, demandRank: 5 }],
  [pgKey('P', '3002', 1), { stockLotsNew: 30, stockLotsUsed: null, demandRank: 900 }],
]);

describe('assembleAssessment', () => {
  const a = assembleAssessment({
    slug: 'TestStore',
    storeMeta: { storeId: 42, storeName: 'Test Store', country: 'United Kingdom' },
    lots, profile: null, mode: 'light', inputs, pgMap, supplyMap,
  });

  it('totals size & value from the raw scrape', () => {
    expect(a.size.totalLots).toBe(3);
    expect(a.size.totalPieces).toBe(12);
    expect(a.size.totalValue).toBeCloseTo(0.5 * 10 + 5 + 100, 2); // 110
  });

  it('flags the cheap fast-mover as within margin', () => {
    expect(a.withinMargin.lots).toBe(1);
    const top = a.withinMargin.top[0];
    expect(top.itemNo).toBe('3001');
    // Bricqer: used STR 2.0 -> ×1.8 on £1.00 = £1.80 list; net = 1.80*0.906 - 0.50 > 0
    expect(top.ourList).toBeCloseTo(1.80, 2);
    expect(top.netPerUnit!).toBeGreaterThan(1.0);
    expect(top.withinMargin).toBe(true);
  });

  it('does not buy the overpriced new part', () => {
    const b = [...a.withinMargin.top, ...a.highStr.top].find((s) => s.itemNo === '3002');
    expect(b?.withinMargin ?? false).toBe(false);
  });

  it('classifies pricing position (UNDER vs OVER)', () => {
    // A ask 0.5 vs 6MA 1.0 = 0.5 -> UNDER; B ask 5 vs 2 = 2.5 -> OVER
    const under = a.pricing.positions.find((p) => p.key === 'UNDER');
    const over = a.pricing.positions.find((p) => p.key === 'OVER');
    expect(under?.lots).toBe(1);
    expect(over?.lots).toBe(1);
  });

  it('identifies high-STR and magnet lots', () => {
    expect(a.highStr.lots).toBeGreaterThanOrEqual(1);
    expect(a.highStr.top.some((s) => s.itemNo === '3001')).toBe(true);
    // magnet = scarce (supply 2 <= 3) + decent STR
    expect(a.magnets.lots).toBe(1);
    expect(a.magnets.top[0].itemNo).toBe('3001');
    expect(a.magnets.top[0].worldSupplyLots).toBe(2);
  });

  it('reports honest price coverage (set has none)', () => {
    // 100/110 of value has no benchmark (the set)
    expect(a.confidence.noneValueShare).toBeGreaterThan(0.5);
    expect(a.confidence.ukValueShare).toBeLessThan(0.5);
  });

  it('produces a verdict with a grade and label', () => {
    expect(a.verdict.grade).toBeGreaterThanOrEqual(0);
    expect(a.verdict.grade).toBeLessThanOrEqual(100);
    expect(['BUY', 'REVIEW', 'SKIP']).toContain(a.verdict.label);
  });

  it('counts set completeness from raw invComplete', () => {
    expect(a.partMix.setCompleteness.complete).toBe(1);
  });
});
