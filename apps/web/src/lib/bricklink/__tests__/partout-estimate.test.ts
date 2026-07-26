/**
 * The cost estimate behind the Set Lookup "Run part-out" button.
 *
 * The number on that button is the only thing standing between a casual lookup and a
 * four-figure BrickLink bill, so what it counts as cached has to match what the real run
 * treats as cached — coverage 'uk'. A world-only or missing row is a lot the run WILL go
 * and fetch, and the estimate has to say so.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pgKey, type PriceGuideView, type SideView } from '../price-guide/read';

const readPriceGuide = vi.fn();
const loadColourMap = vi.fn();

vi.mock('../price-guide/read', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../price-guide/read')>();
  return { ...actual, readPriceGuide: (...a: unknown[]) => readPriceGuide(...a) };
});
vi.mock('../colour-map', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../colour-map')>();
  return { ...actual, loadColourMap: (...a: unknown[]) => loadColourMap(...a) };
});

const { PartoutService } = await import('../partout.service');

const EMPTY: SideView = {
  soldAvg: null, soldMedian: null, soldQtyAvg: null, soldLots: 0, soldQty: 0, soldLast2moQty: 0,
  stockLots: 0, stockQty: 0, stockMin: null, stockMax: null, stockAvg: null,
  strLots: null, strQty: null, hist: undefined,
};

function view(coverage: PriceGuideView['coverage']): PriceGuideView {
  return {
    item: { itemType: 'P', itemNo: 'x', blColourId: 0 },
    itemName: 'x', used: EMPTY, new: EMPTY, freshnessDays: 1, coverage,
    qtyShareAtOrAbove: () => null,
  };
}

function subsetEntry(itemNo: string, colourId: number) {
  return {
    entries: [
      {
        item: { no: itemNo, name: itemNo, type: 'PART', category_id: 1 },
        color_id: colourId,
        quantity: 1,
        extra_quantity: 0,
        is_alternate: false,
        is_counterpart: false,
      },
    ],
  };
}

function makeService(subsets: unknown[], coverageByKey: Map<string, PriceGuideView>) {
  readPriceGuide.mockResolvedValue(coverageByKey);
  loadColourMap.mockResolvedValue({
    toBl: (colourId: number) => colourId,
    toBricqer: () => null,
    name: (id: number) => `Colour ${id}`,
    normalise: ({ colourId }: { colourId?: number }) => ({ blColourId: colourId ?? 0, blColourName: null }),
  });
  const client = { getSubsets: vi.fn().mockResolvedValue(subsets) };
  return {
    service: new PartoutService(client as never, {} as never),
    client,
  };
}

describe('estimatePartoutCost', () => {
  beforeEach(() => {
    readPriceGuide.mockReset();
    loadColourMap.mockReset();
  });

  it('charges four calls per uncached lot and none for cached ones', async () => {
    const views = new Map<string, PriceGuideView>([
      [pgKey('P', '3001', 5), view('uk')],
      [pgKey('P', '3002', 5), view('uk')],
      // World-fallback: the run re-fetches it, so the estimate must bill for it.
      [pgKey('P', '3003', 5), view('world_fallback')],
      // 3004 absent entirely — also a fetch.
    ]);
    const { service, client } = makeService(
      [subsetEntry('3001', 5), subsetEntry('3002', 5), subsetEntry('3003', 5), subsetEntry('3004', 5)],
      views
    );

    const est = await service.estimatePartoutCost('71741');

    expect(est.setNumber).toBe('71741-1');
    expect(est.totalLots).toBe(4);
    expect(est.cachedLots).toBe(2);
    expect(est.uncachedLots).toBe(2);
    // 2 lots x 4 quadrants, plus the run's own getSubsets and set-price lookups.
    expect(est.estimatedApiCalls).toBe(2 * 4 + 5);
    // The estimate itself costs exactly one BrickLink call.
    expect(client.getSubsets).toHaveBeenCalledTimes(1);
  });

  it('reports a fully-cached set as free, so the UI can skip the gate', async () => {
    const views = new Map<string, PriceGuideView>([
      [pgKey('P', '3001', 5), view('uk')],
      [pgKey('P', '3002', 5), view('uk')],
    ]);
    const { service } = makeService([subsetEntry('3001', 5), subsetEntry('3002', 5)], views);

    const est = await service.estimatePartoutCost('10294-1');

    expect(est.uncachedLots).toBe(0);
    expect(est.estimatedApiCalls).toBe(1);
  });

  it('does not read the price cache at all for a set with no parts', async () => {
    const { service } = makeService([], new Map());

    const est = await service.estimatePartoutCost('99999');

    expect(est).toMatchObject({ totalLots: 0, cachedLots: 0, uncachedLots: 0, estimatedApiCalls: 0 });
    expect(readPriceGuide).not.toHaveBeenCalled();
  });
});
