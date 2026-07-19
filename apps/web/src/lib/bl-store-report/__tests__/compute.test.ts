import { describe, it, expect } from 'vitest';
import { cappedUnits, fromScoredLot, fromBasketItem, buildSummary, buildDecisionReport, type BasketLensItem } from '../compute';
import { renderDecisionCli } from '../render-cli';
import { renderDecisionMd } from '../render-md';
import type { ScoredLot, StoreAssessment } from '../../bl-store-assessment/types';
import { DEFAULT_INPUTS } from '../../bl-store-assessment/types';
import { LIQUID_STR_GATE } from '../../bricklink/fees';

function scored(p: Partial<ScoredLot> & Pick<ScoredLot, 'invID' | 'itemNo'>): ScoredLot {
  return {
    itemType: 'P', colourId: 5, colourName: 'Red', itemName: `${p.itemNo} item`,
    condition: 'U', invQty: 1, ask: 0.5, lotAskValue: 0.5, damageNote: false,
    benchmarkAvg: 1, strLots: 1, strQty: 1, worldSupplyLots: 10, demandRank: null,
    priceSource: 'uk', askVsMarket: 0.5, position: 'UNDER',
    ourList: 1.9, netPerUnit: 1.22, marginPct: 0.64, lotProfit: 1.22,
    withinMargin: true, highStr: true, magnet: false,
    overlap: null, ourQty: null, ourSoldWindow: null,
    marketSoldQty6mo: 40, soldShareAtList: 0.5,
    ...p,
  };
}

describe('cappedUnits (demand cap)', () => {
  it('returns null with no benchmark (no cap opinion)', () => {
    expect(cappedUnits(100, null, 1.5)).toBeNull();
  });
  it('caps deep lots at market absorption × capture', () => {
    // STR 0.2 → capture 0.25; sold 40 → cap ceil(10) = 10, not the full 4796
    expect(cappedUnits(4796, 40, 0.2)).toBe(10);
  });
  it('never caps above the lot quantity', () => {
    expect(cappedUnits(3, 40, 1.5)).toBe(3);
  });
  it('caps dead lots (0 sold) to zero units', () => {
    expect(cappedUnits(50, 0, null)).toBe(0);
  });
});

describe('fromScoredLot', () => {
  it('carries the demand cap into cappedLotNet (the Beeble lesson)', () => {
    const r = fromScoredLot(scored({ invID: 1, itemNo: '3001', invQty: 4796, strQty: 0.2, marketSoldQty6mo: 40, netPerUnit: 0.1, lotProfit: 479.6 }));
    expect(r.lotNet).toBeCloseTo(479.6, 1);
    expect(r.cappedQty).toBe(10);
    expect(r.cappedLotNet).toBeCloseTo(1.0, 2);
  });
  it('computes months of market cover', () => {
    const r = fromScoredLot(scored({ invID: 2, itemNo: '3002', invQty: 20, marketSoldQty6mo: 40 }));
    expect(r.moCover).toBeCloseTo(3.0, 1); // 20 ÷ (40/6)
  });
});

describe('fromBasketItem', () => {
  const item: BasketLensItem = {
    itemType: 'P', itemNo: '3001', colourName: 'Red', itemName: 'Brick', condition: 'U',
    invQty: 10, unitPriceGBP: 0.5, ukSoldAvg: 1, ukSoldQty: 40, ukStockQty: 20,
    sellThru: 2, listPrice: 1.9, netPerUnit: 1.2, inboundPerUnit: 0.02, marginPct: 63, passed: true,
  };
  it('normalises to ex-postage per-lot net (strips the proportional share)', () => {
    const r = fromBasketItem(item);
    expect(r.netPerUnit).toBeCloseTo(1.22, 3);
    expect(r.marginPct).toBeCloseTo(0.63, 3);
    expect(r.benchProvenance).toBe('uk');
  });
});

describe('buildSummary', () => {
  const rows = [
    fromScoredLot(scored({ invID: 1, itemNo: 'fast', strQty: 1.5, invQty: 2, marketSoldQty6mo: 40, netPerUnit: 2, lotProfit: 4 })),
    fromScoredLot(scored({ invID: 2, itemNo: 'dup', strQty: 1.0, invQty: 1, marketSoldQty6mo: 40, netPerUnit: 3, lotProfit: 3, overlap: 'DUPLICATE' })),
    fromScoredLot(scored({ invID: 3, itemNo: 'slow', strQty: 0.1, invQty: 100, marketSoldQty6mo: 10, netPerUnit: 1, lotProfit: 100 })),
  ];
  const s = buildSummary(rows, rows, 3, 0);

  it('charges the inbound postage ONCE at each level (standalone order)', () => {
    // raw = 4 + 3 + 100 − 3 postage
    expect(s.rawNet).toBeCloseTo(104, 1);
  });
  it('demand-caps the deep slow lot', () => {
    // slow: cap ceil(10×0.25)=3 → £3; fast £4; dup £3 → capped 10 − 3 postage = 7
    expect(s.cappedNet).toBeCloseTo(7, 1);
  });
  it('LIQUID excludes DUPs and sub-gate STR, keeps the cap', () => {
    // liquid rows: fast only (dup excluded, slow at STR 0.1 < gate) → 4 − 3 = 1
    expect(s.liquidGate).toBe(LIQUID_STR_GATE);
    expect(s.liquidLots).toBe(1);
    expect(s.liquidNet).toBeCloseTo(1, 1);
  });
  it('leads STR stats with the median (house rule)', () => {
    expect(s.strMedian).toBeCloseTo(1.0, 2);
    expect(s.strMean).toBeCloseTo((1.5 + 1.0 + 0.1) / 3, 2);
  });
  it('gate ladder columns are standalone too', () => {
    const g1 = s.gates.find((g) => g.gate === 1)!;
    expect(g1.lots).toBe(2); // fast + dup
    expect(g1.rawNet).toBeCloseTo(4 + 3 - 3, 1);
    expect(g1.cappedNetNoDups).toBeCloseTo(4 - 3, 1);
  });
});

describe('renderers', () => {
  const assessment = {
    engineVersion: 7,
    store: { slug: 'TestStore', storeId: 1, storeName: 'Test Store', country: 'UK' },
    mode: 'light', scannedAt: '2026-07-19T02:00:00Z', scanTruncated: false,
    inputs: { ...DEFAULT_INPUTS },
    verdict: { grade: 50, label: 'REVIEW', headline: '', reasons: [], signals: { value: 0, efficiency: 0, magnet: 0, price: 0, coverage: 0 } },
    size: { totalLots: 1, totalPieces: 2, totalValue: 1, avgValuePerLot: 1, medianLotPrice: 0.5, byType: [], biggestLots: [] },
    pricing: { covered: 1, weightedMedianAskVsMarket: 0.5, label: 'cheap', positions: [] },
    feedback: null,
    partMix: { matrix: [], newValueShare: 0, usedValueShare: 1, damageNoteShare: 0, setCompleteness: { complete: 0, incomplete: 0, sealed: 0, unknown: 0 } },
    withinMargin: { lots: 1, outlay: 1, projectedNet: 2.44, blendedMarginPct: 60, roiPct: 200, top: [] },
    highStr: { lots: 1, value: 1, alsoWithinMargin: 1, top: [] },
    magnets: { lots: 0, value: 0, alsoWithinMargin: 0, top: [] },
    confidence: { ukValueShare: 1, worldValueShare: 0, noneValueShare: 0, ukLotShare: 1 },
    ageing: { buckets: [], overstockValueShare: 0, benchmarkedValueShare: 1, motivatedSeller: false },
    concentration: { top10ValueShare: 1, distinctItems: 1 },
    overlap: { available: false, snapshotAt: null, salesWindowDays: null, buyableTags: [], untaggedBuyableLots: 0, freshNetShare: null },
  } as unknown as StoreAssessment;
  const scoredLots = [scored({ invID: 1, itemNo: '3001', invQty: 2, lotProfit: 2.44 })];
  const rep = buildDecisionReport(assessment, {}, scoredLots);

  it('CLI render carries the honesty ladder and gate ladder', () => {
    const out = renderDecisionCli(rep);
    expect(out).toContain('LIQUID');
    expect(out).toContain('GATE LADDER');
    expect(out).toContain('3001');
  });
  it('md render carries every row + conventions', () => {
    const out = renderDecisionMd(rep);
    expect(out).toContain('## Decision table');
    expect(out).toContain('## Gate ladder');
    expect(out).toContain('Demand cap');
  });
  it('flags a data-gap caveat when the lens sets one', () => {
    rep.meta.dataGapNote = 'PARTIAL DATA — 5 of 10 tuples unpriced';
    expect(renderDecisionCli(rep)).toContain('PARTIAL DATA');
    expect(renderDecisionMd(rep)).toContain('PARTIAL DATA');
  });
});
