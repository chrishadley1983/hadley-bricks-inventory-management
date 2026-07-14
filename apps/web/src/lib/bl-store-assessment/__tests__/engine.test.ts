import { describe, it, expect } from 'vitest';
import { assembleAssessment, WORLD_TO_UK_UPLIFT } from '../engine';
import { pgKey, type PriceGuideView, type SideView } from '../../bricklink/price-guide/read';
import { DEFAULT_INPUTS, type StoreLot, type AssessmentInputs } from '../types';
import { normalizeAssessment } from '../normalize';
import { classifyOverlap, type OwnStockIndex } from '../overlap';

const EMPTY: SideView = {
  soldAvg: null, soldMedian: null, soldQtyAvg: null, soldLots: 0, soldQty: 0, soldLast2moQty: 0,
  stockLots: 0, stockQty: 0, stockMin: null, stockMax: null, stockAvg: null, strLots: null, strQty: null, hist: undefined,
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

function lot(p: Partial<StoreLot> & Pick<StoreLot, 'invID' | 'itemType' | 'itemNo' | 'unitPriceGBP'>): StoreLot {
  return {
    colourId: 0, colourName: null, itemName: `${p.itemNo} item`, invNew: 'Used',
    invComplete: null, invQty: 1, description: null, ...p,
  };
}

const inputs: AssessmentInputs = { ...DEFAULT_INPUTS };
type SupplyMap = Map<string, { stockLotsNew: number | null; stockLotsUsed: number | null; demandRank: number | null }>;

function assemble(lots: StoreLot[], pgMap: Map<string, PriceGuideView>, supplyMap: SupplyMap = new Map(), extra: { scanTruncated?: boolean } = {}) {
  return assembleAssessment({
    slug: 'TestStore',
    storeMeta: { storeId: 42, storeName: 'Test Store', country: 'United Kingdom' },
    lots, profile: null, mode: 'light', inputs, pgMap, supplyMap, ...extra,
  });
}

describe('assembleAssessment', () => {
  const lots: StoreLot[] = [
    // A: cheap fast-mover, scarce → within margin + high STR + magnet
    lot({ invID: 1, itemType: 'P', itemNo: '3001', colourId: 5, colourName: 'Red', invNew: 'Used', invQty: 10, unitPriceGBP: 0.50 }),
    // B: overpriced new part → not within margin, OVER position
    lot({ invID: 2, itemType: 'P', itemNo: '3002', colourId: 1, colourName: 'Blue', invNew: 'New', unitPriceGBP: 5.00 }),
    // C: set with no price data → no benchmark
    lot({ invID: 3, itemType: 'S', itemNo: '8043', invNew: 'New', invComplete: 'Complete', unitPriceGBP: 100 }),
  ];

  const pgMap = new Map<string, PriceGuideView>([
    [pgKey('P', '3001', 5), view('P', '3001', 5, side({ soldAvg: 1.00, soldLots: 20, soldQty: 40, stockLots: 10, stockQty: 20 }), EMPTY)],
    [pgKey('P', '3002', 1), view('P', '3002', 1, EMPTY, side({ soldAvg: 2.00, soldLots: 5, soldQty: 5, stockLots: 5, stockQty: 5 }))],
    [pgKey('S', '8043', 0), view('S', '8043', 0, EMPTY, EMPTY, 'none')],
  ]);

  const supplyMap: SupplyMap = new Map([
    [pgKey('P', '3001', 5), { stockLotsNew: null, stockLotsUsed: 2, demandRank: 5 }],
    [pgKey('P', '3002', 1), { stockLotsNew: 30, stockLotsUsed: null, demandRank: 900 }],
  ]);

  const a = assemble(lots, pgMap, supplyMap);

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

  it('produces a verdict with a grade, label, and v2 signals', () => {
    expect(a.verdict.grade).toBeGreaterThanOrEqual(0);
    expect(a.verdict.grade).toBeLessThanOrEqual(100);
    expect(['BUY', 'REVIEW', 'SKIP']).toContain(a.verdict.label);
    expect(a.verdict.signals).toHaveProperty('value');
    expect(a.verdict.signals).toHaveProperty('efficiency');
  });

  it('counts set completeness from raw invComplete', () => {
    expect(a.partMix.setCompleteness.complete).toBe(1);
  });

  it('stamps the engine version and defaults scanTruncated false', () => {
    expect(a.engineVersion).toBe(4);
    expect(a.scanTruncated).toBe(false);
  });

  it('reports overlap as unavailable when no own-stock index is supplied', () => {
    expect(a.overlap.available).toBe(false);
    expect(a.withinMargin.top[0].overlap).toBeNull();
  });
});

describe('world-fallback benchmark calibration', () => {
  const lots = [lot({ invID: 1, itemType: 'P', itemNo: '3005', colourId: 4, invNew: 'Used', unitPriceGBP: 1.00 })];
  const pgMap = new Map([
    [pgKey('P', '3005', 4), view('P', '3005', 4, side({ soldAvg: 1.00, soldLots: 20, soldQty: 40, stockLots: 10, stockQty: 20 }), EMPTY, 'world_fallback')],
  ]);
  const a = assemble(lots, pgMap);
  const s = a.size.biggestLots[0];

  it('uplifts the worldwide avg to UK level', () => {
    expect(s.priceSource).toBe('world');
    expect(s.benchmarkAvg).toBeCloseTo(1.00 * WORLD_TO_UK_UPLIFT, 4);
    expect(s.askVsMarket).toBeCloseTo(1 / WORLD_TO_UK_UPLIFT, 3);
  });

  it('prices resale off the calibrated benchmark', () => {
    // used STR 2.0 -> ×1.8 on the uplifted £1.11
    expect(s.ourList).toBeCloseTo(1.11 * 1.8, 2);
  });
});

describe('ageing no-data handling', () => {
  // £90 of value with NO benchmark + £10 benchmarked-and-dead (sold 0 in 6mo).
  const lots = [
    lot({ invID: 1, itemType: 'P', itemNo: '9999', colourId: 1, unitPriceGBP: 90 }),
    lot({ invID: 2, itemType: 'P', itemNo: '3001', colourId: 5, unitPriceGBP: 10 }),
  ];
  const pgMap = new Map([
    [pgKey('P', '9999', 1), view('P', '9999', 1, EMPTY, EMPTY, 'none')],
    [pgKey('P', '3001', 5), view('P', '3001', 5, side({ soldAvg: 8.00, soldLots: 0, soldQty: 0, stockLots: 5, stockQty: 9 }), EMPTY)],
  ]);
  const a = assemble(lots, pgMap);

  it('separates no-benchmark lots from dead stock', () => {
    const noData = a.ageing.buckets.find((b) => b.key === 'no benchmark data');
    const dead = a.ageing.buckets.find((b) => b.key.startsWith('dead'));
    expect(noData?.lots).toBe(1);
    expect(noData?.value).toBeCloseTo(90, 2);
    expect(dead?.lots).toBe(1);
    expect(dead?.value).toBeCloseTo(10, 2);
  });

  it('does not flag motivated seller off a sliver of benchmarked value', () => {
    // 100% of BENCHMARKED value is dead, but only 10% of the store is benchmarked.
    expect(a.ageing.overstockValueShare).toBeCloseTo(1, 3);
    expect(a.ageing.benchmarkedValueShare).toBeCloseTo(0.1, 3);
    expect(a.ageing.motivatedSeller).toBe(false);
  });
});

describe('cherry-pick-first verdict', () => {
  // A PREMIUM-postured store hiding a strong buyable minifig sub-basket
  // (the Quaysretire shape): must not be graded SKIP.
  const lots: StoreLot[] = [
    // One big over-priced lot dominates the value-weighted pricing median.
    lot({ invID: 100, itemType: 'S', itemNo: '10179', invNew: 'New', unitPriceGBP: 500 }),
    // Ten cheap fast-moving used minifigs, all comfortably within margin.
    ...Array.from({ length: 10 }, (_, i) =>
      lot({ invID: i + 1, itemType: 'M', itemNo: `sw000${i}`, invNew: 'Used', unitPriceGBP: 2.00 })),
  ];
  const pgMap = new Map<string, PriceGuideView>([
    [pgKey('S', '10179', 0), view('S', '10179', 0, EMPTY, side({ soldAvg: 250, soldLots: 4, soldQty: 4, stockLots: 4, stockQty: 4 }))],
    ...Array.from({ length: 10 }, (_, i) => [
      pgKey('M', `sw000${i}`, 0),
      view('M', `sw000${i}`, 0, side({ soldAvg: 5.00, soldLots: 20, soldQty: 40, stockLots: 10, stockQty: 20 }), EMPTY),
    ] as const),
  ]);
  const a = assemble(lots, pgMap);

  it('is premium-postured but not SKIP', () => {
    expect(a.pricing.label).toBe('premium'); // weighted median dragged by the big lot
    expect(a.withinMargin.lots).toBe(10);
    expect(a.withinMargin.projectedNet).toBeGreaterThan(40);
    expect(a.verdict.label).not.toBe('SKIP');
  });

  it('hard-SKIPs a store with nothing meaningful to buy', () => {
    const bare = assemble(
      [lot({ invID: 1, itemType: 'P', itemNo: '3002', colourId: 1, invNew: 'New', unitPriceGBP: 5.00 })],
      new Map([[pgKey('P', '3002', 1), view('P', '3002', 1, EMPTY, side({ soldAvg: 2.00, soldLots: 5, soldQty: 5, stockLots: 5, stockQty: 5 }))]]),
    );
    expect(bare.withinMargin.lots).toBe(0);
    expect(bare.verdict.label).toBe('SKIP');
  });
});

describe('pricing label aligns with position bands', () => {
  const mk = (ask: number) => {
    const lots = [lot({ invID: 1, itemType: 'P', itemNo: '3001', colourId: 5, unitPriceGBP: ask })];
    const pgMap = new Map([
      [pgKey('P', '3001', 5), view('P', '3001', 5, side({ soldAvg: 1.00, soldLots: 5, soldQty: 5, stockLots: 10, stockQty: 10 }), EMPTY)],
    ]);
    return assemble(lots, pgMap).pricing;
  };

  it('0.93 is cheap (below the KEEN ceiling), 1.00 is at-market, 1.20 is premium', () => {
    expect(mk(0.93).label).toBe('cheap');
    expect(mk(1.00).label).toBe('at-market');
    expect(mk(1.20).label).toBe('premium');
  });
});

describe('scan truncation caveat', () => {
  const lots = [lot({ invID: 1, itemType: 'P', itemNo: '3001', colourId: 5, unitPriceGBP: 0.50 })];
  const pgMap = new Map([
    [pgKey('P', '3001', 5), view('P', '3001', 5, side({ soldAvg: 1.00, soldLots: 20, soldQty: 40, stockLots: 10, stockQty: 20 }), EMPTY)],
  ]);
  const a = assemble(lots, pgMap, new Map(), { scanTruncated: true });

  it('carries the flag and warns in the verdict', () => {
    expect(a.scanTruncated).toBe(true);
    expect(a.verdict.reasons.some((r) => r.toLowerCase().includes('truncated'))).toBe(true);
  });
});

describe('normalizeAssessment (v1 rows)', () => {
  const lots = [lot({ invID: 1, itemType: 'P', itemNo: '3001', colourId: 5, unitPriceGBP: 0.50 })];
  const pgMap = new Map([
    [pgKey('P', '3001', 5), view('P', '3001', 5, side({ soldAvg: 1.00, soldLots: 20, soldQty: 40, stockLots: 10, stockQty: 20 }), EMPTY)],
  ]);

  it('maps v1 field names onto the v2 shape', () => {
    // Build a v2 assessment, then dress it down to the persisted v1 shape.
    const v2 = assemble(lots, pgMap);
    type Loose = Record<string, unknown>;
    const raw = JSON.parse(JSON.stringify(v2)) as {
      engineVersion?: unknown; scanTruncated?: unknown;
      ageing: Loose; pricing: Loose;
      size: { biggestLots: Loose[] };
      withinMargin: { top: Loose[] };
      highStr: { top: Loose[] };
      magnets: { top: Loose[] };
      verdict: { signals: unknown };
    };
    delete raw.engineVersion;
    delete raw.scanTruncated;
    delete (raw as Record<string, unknown>).overlap;
    delete raw.ageing.benchmarkedValueShare;
    raw.pricing.weightedMedianAskVsUk = raw.pricing.weightedMedianAskVsMarket;
    delete raw.pricing.weightedMedianAskVsMarket;
    for (const rows of [raw.size.biggestLots, raw.withinMargin.top, raw.highStr.top, raw.magnets.top]) {
      for (const r of rows) {
        r.ukSoldAvg = r.benchmarkAvg; delete r.benchmarkAvg;
        r.askVsUk = r.askVsMarket; delete r.askVsMarket;
      }
    }
    raw.verdict.signals = { price: 0.4, margin: 0.3, coverage: 0.2, magnet: 0.1 };

    const up = normalizeAssessment(raw);
    expect(up.engineVersion).toBe(1);
    expect(up.scanTruncated).toBe(false);
    expect(up.pricing.weightedMedianAskVsMarket).toBe(v2.pricing.weightedMedianAskVsMarket);
    expect(up.size.biggestLots[0].benchmarkAvg).toBe(v2.size.biggestLots[0].benchmarkAvg);
    expect(up.ageing.benchmarkedValueShare).toBe(1);
    expect(up.verdict.signals.value).toBe(0.3);
    expect(up.overlap.available).toBe(false);
  });
});

describe('overlap tagging vs our own inventory', () => {
  const index: OwnStockIndex = {
    snapshotAt: '2026-07-09T06:00:00Z',
    salesWindowDays: 180,
    stockQty: new Map([
      ['P:3001:5:U', 100], // deep stock, no sales → DUPLICATE
      ['P:3003:2:U', 2],   // thin: 2 in stock vs 30 sold in 6mo (5/mo → need 10)
    ]),
    soldUnits: new Map([
      ['P:3003:green:U', 30],
      ['M:sw0001::U', 4],  // sold but not stocked → RESTOCK_OUT
    ]),
  };

  it('classifies each path', () => {
    const base = { colourName: null as string | null, condition: 'U' as const };
    expect(classifyOverlap({ itemType: 'P', itemNo: '3001', blColourId: 5, ...base }, index).tag).toBe('DUPLICATE');
    expect(classifyOverlap({ itemType: 'P', itemNo: '3003', blColourId: 2, colourName: 'Green', condition: 'U' }, index).tag).toBe('RESTOCK_THIN');
    expect(classifyOverlap({ itemType: 'M', itemNo: 'sw0001', blColourId: 0, ...base }, index).tag).toBe('RESTOCK_OUT');
    expect(classifyOverlap({ itemType: 'P', itemNo: '9999', blColourId: 1, ...base }, index).tag).toBe('NEW');
    expect(classifyOverlap({ itemType: 'S', itemNo: '8043-1', blColourId: 0, ...base }, index).tag).toBeNull();
    expect(classifyOverlap({ itemType: 'P', itemNo: '3001', blColourId: 5, ...base }, null).tag).toBeNull();
  });

  it('rolls up buyable tags and fresh net share, and reasons on it', () => {
    // Two buyable used minifigs: one NEW to us, one RESTOCK_OUT.
    const lots = [
      lot({ invID: 1, itemType: 'M', itemNo: 'sw0001', invNew: 'Used', unitPriceGBP: 2.00 }),
      lot({ invID: 2, itemType: 'M', itemNo: 'sw0002', invNew: 'Used', unitPriceGBP: 2.00 }),
    ];
    const pgMap = new Map<string, PriceGuideView>([
      [pgKey('M', 'sw0001', 0), view('M', 'sw0001', 0, side({ soldAvg: 5.00, soldLots: 20, soldQty: 40, stockLots: 10, stockQty: 20 }), EMPTY)],
      [pgKey('M', 'sw0002', 0), view('M', 'sw0002', 0, side({ soldAvg: 5.00, soldLots: 20, soldQty: 40, stockLots: 10, stockQty: 20 }), EMPTY)],
    ]);
    const a = assembleAssessment({
      slug: 'TestStore', storeMeta: { storeId: 42, storeName: 'Test Store', country: 'United Kingdom' },
      lots, profile: null, mode: 'light', inputs, pgMap, supplyMap: new Map(), ownStock: index,
    });
    expect(a.withinMargin.lots).toBe(2);
    const byTag = Object.fromEntries(a.overlap.buyableTags.map((t) => [t.tag, t]));
    expect(byTag.RESTOCK_OUT.lots).toBe(1); // sw0001 — in our sales, not stocked
    expect(byTag.NEW.lots).toBe(1);         // sw0002 — unknown to us
    expect(a.overlap.available).toBe(true);
    expect(a.overlap.freshNetShare).toBe(1); // all buyable net is fresh demand
    expect(a.verdict.reasons.some((r) => r.includes('fresh demand'))).toBe(true);
  });
});
