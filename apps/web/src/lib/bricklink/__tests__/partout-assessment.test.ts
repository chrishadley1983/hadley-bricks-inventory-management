import { describe, it, expect } from 'vitest';
import { assessPartout, assessPartoutBoth } from '../partout-assessment';
import {
  VAR_FEE_PCT,
  MAGNET,
  POV_MULTIPLE_MIN,
  POV_MIN_GAP_GBP,
  DEFAULT_MIN_MARGIN,
  STR_GATES,
} from '../fees';
import { captureFraction } from '../liquidity-pov';
import type { PartValue } from '@/types/partout';

/** Minimal PartValue factory — only the fields the assessment reads matter. */
function part(overrides: Partial<PartValue> = {}): PartValue {
  return {
    partNumber: '3001',
    partType: 'PART',
    name: 'Brick 2 x 4',
    colourId: 5,
    colourName: 'Red',
    imageUrl: 'https://img.bricklink.com/ItemImage/PN/5/3001.png',
    quantity: 1,
    priceNew: 1,
    priceUsed: 0.5,
    totalNew: 1,
    totalUsed: 0.5,
    sellThroughRateNew: null,
    sellThroughRateUsed: null,
    strQtyNew: 0.5,
    strQtyUsed: 0.5,
    worldSupplyLotsNew: null,
    worldSupplyLotsUsed: null,
    overlapNew: null,
    overlapUsed: null,
    ourQtyNew: null,
    ourQtyUsed: null,
    stockAvailableNew: null,
    stockAvailableUsed: null,
    timesSoldNew: null,
    timesSoldUsed: null,
    fromCache: true,
    ...overrides,
  };
}

describe('assessPartout — honesty ladder', () => {
  it('discounts gross by the capture curve, then by the fee stack', () => {
    // One lot: 10 × £2 at STR 1.0 → capture 0.85 per CAPTURE_CURVE.
    const parts = [part({ quantity: 10, priceNew: 2, strQtyNew: 1.0 })];
    const a = assessPartout(parts, 5, 'new');

    expect(a.grossPov).toBe(20);
    expect(a.realisablePov).toBeCloseTo(20 * captureFraction(1.0), 2);
    expect(a.netPov).toBeCloseTo(a.realisablePov * (1 - VAR_FEE_PCT), 2);
    expect(a.captureRate).toBeCloseTo(captureFraction(1.0), 4);
  });

  it('is monotonic — net never exceeds realisable, which never exceeds gross', () => {
    const parts = [
      part({ quantity: 4, priceNew: 3, strQtyNew: 0.3 }),
      part({ partNumber: '3002', quantity: 2, priceNew: 10, strQtyNew: 1.6 }),
    ];
    const a = assessPartout(parts, 12, 'new');
    expect(a.netPov).toBeLessThanOrEqual(a.realisablePov);
    expect(a.realisablePov).toBeLessThanOrEqual(a.grossPov);
  });

  it('gives unknown STR the heaviest haircut rather than an optimistic default', () => {
    const known = assessPartout([part({ quantity: 10, priceNew: 1, strQtyNew: 1.5 })], 1, 'new');
    const unknown = assessPartout([part({ quantity: 10, priceNew: 1, strQtyNew: null })], 1, 'new');
    expect(unknown.realisablePov).toBeLessThan(known.realisablePov);
  });
});

describe('assessPartout — the canonical part-out gate', () => {
  it('returns PART-OUT when POV clears both the multiple and the absolute gap', () => {
    // gross 100 vs set price 20 → 5.0×, gap £80.
    const parts = [part({ quantity: 100, priceNew: 1 })];
    const a = assessPartout(parts, 20, 'new');

    expect(a.povMultiple).toBe(5);
    expect(a.gapGbp).toBe(80);
    expect(a.verdict).toBe('PART-OUT');
  });

  it('returns SELL-COMPLETE when the multiple is below the gate', () => {
    // gross 100 vs 60 → 1.67×, under POV_MULTIPLE_MIN despite a £40 gap.
    const a = assessPartout([part({ quantity: 100, priceNew: 1 })], 60, 'new');
    expect(a.povMultiple).toBeLessThan(POV_MULTIPLE_MIN);
    expect(a.verdict).toBe('SELL-COMPLETE');
    expect(a.verdictReason).toContain(`${POV_MULTIPLE_MIN}×`);
  });

  it('returns SELL-COMPLETE when the multiple clears but the cash gap does not', () => {
    // gross £9 vs £3 → 3.0× (clears) but a £6 gap, under the £10 labour floor.
    const a = assessPartout([part({ quantity: 9, priceNew: 1 })], 3, 'new');
    expect(a.povMultiple).toBeGreaterThanOrEqual(POV_MULTIPLE_MIN);
    expect(a.gapGbp).toBeLessThan(POV_MIN_GAP_GBP);
    expect(a.verdict).toBe('SELL-COMPLETE');
    expect(a.verdictReason).toContain('labour floor');
  });

  it('SKIPs rather than guessing when there is no set price', () => {
    const a = assessPartout([part({ quantity: 100, priceNew: 1 })], null, 'new');
    expect(a.verdict).toBe('SKIP');
    expect(a.povMultiple).toBeNull();
  });

  it('SKIPs when no lot carries a price', () => {
    const a = assessPartout([part({ priceNew: null })], 20, 'new');
    expect(a.verdict).toBe('SKIP');
    expect(a.grossPov).toBe(0);
  });

  it('echoes the gate it actually applied', () => {
    const a = assessPartout([part()], 1, 'new');
    expect(a.gate).toEqual({ povMultipleMin: POV_MULTIPLE_MIN, minGapGbp: POV_MIN_GAP_GBP });
  });
});

describe('assessPartout — max buy', () => {
  it('back-solves from realisable POV net of fees and target margin', () => {
    const parts = [part({ quantity: 100, priceNew: 1, strQtyNew: 1.0 })];
    const a = assessPartout(parts, 20, 'new');
    const expected = a.realisablePov * (1 - VAR_FEE_PCT - DEFAULT_MIN_MARGIN);
    expect(a.maxBuy.price).toBeCloseTo(expected, 2);
    expect(a.maxBuy.targetMargin).toBe(DEFAULT_MIN_MARGIN);
  });

  it('prices off realisable, not gross — so it cannot exceed the gross-based figure', () => {
    const parts = [part({ quantity: 100, priceNew: 1, strQtyNew: 0.1 })];
    const a = assessPartout(parts, 20, 'new');
    const grossBased = a.grossPov * (1 - VAR_FEE_PCT - DEFAULT_MIN_MARGIN);
    expect(a.maxBuy.price!).toBeLessThan(grossBased);
  });

  it('honours an explicit target margin', () => {
    const parts = [part({ quantity: 100, priceNew: 1, strQtyNew: 1.0 })];
    const a = assessPartout(parts, 20, 'new', { targetMargin: 0.5 });
    expect(a.maxBuy.targetMargin).toBe(0.5);
    expect(a.maxBuy.price).toBeCloseTo(a.realisablePov * (1 - VAR_FEE_PCT - 0.5), 2);
  });

  it('never goes negative when fees plus margin exceed the whole revenue', () => {
    const a = assessPartout([part({ quantity: 1, priceNew: 1 })], 1, 'new', {
      targetMargin: 0.99,
    });
    expect(a.maxBuy.price).toBe(0);
  });

  it('is null when there is nothing realisable', () => {
    const a = assessPartout([part({ priceNew: null })], 20, 'new');
    expect(a.maxBuy.price).toBeNull();
  });
});

describe('assessPartout — STR bands', () => {
  it('emits one inclusive band per canonical gate', () => {
    const a = assessPartout([part()], 1, 'new');
    expect(a.strBands.map((b) => b.gate)).toEqual([...STR_GATES]);
  });

  it('is cumulative — each higher gate is a subset of the one below', () => {
    const parts = [
      part({ partNumber: 'a', strQtyNew: 0.1 }),
      part({ partNumber: 'b', strQtyNew: 0.3 }),
      part({ partNumber: 'c', strQtyNew: 0.6 }),
      part({ partNumber: 'd', strQtyNew: 1.2 }),
    ];
    const bands = assessPartout(parts, 1, 'new').strBands;
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i].lots).toBeLessThanOrEqual(bands[i - 1].lots);
      expect(bands[i].grossValue).toBeLessThanOrEqual(bands[i - 1].grossValue);
    }
    expect(bands[0].lots).toBe(4); // gate 0 holds everything priced
  });

  it('never lets a null-STR lot clear a positive gate', () => {
    const bands = assessPartout([part({ strQtyNew: null })], 1, 'new').strBands;
    expect(bands[0].lots).toBe(1);
    for (const band of bands.slice(1)) expect(band.lots).toBe(0);
  });

  it('excludes unpriced lots so shares reconcile against POV', () => {
    const parts = [
      part({ partNumber: 'a', priceNew: 2 }),
      part({ partNumber: 'b', priceNew: null }),
    ];
    const a = assessPartout(parts, 1, 'new');
    expect(a.strBands[0].lots).toBe(1);
    expect(a.strBands[0].shareOfPov).toBe(1);
    expect(a.unpricedLots).toBe(1);
    expect(a.pricedLots).toBe(1);
  });
});

describe('assessPartout — magnets', () => {
  const magnetPart = (o: Partial<PartValue> = {}) =>
    part({ strQtyNew: MAGNET.minStr, worldSupplyLotsNew: MAGNET.maxSupplyLots, ...o });

  it('flags a lot that is both scarce and selling', () => {
    const a = assessPartout([magnetPart()], 1, 'new');
    expect(a.magnets).toHaveLength(1);
  });

  it('rejects a scarce lot that does not sell', () => {
    const a = assessPartout([magnetPart({ strQtyNew: MAGNET.minStr - 0.01 })], 1, 'new');
    expect(a.magnets).toHaveLength(0);
  });

  it('rejects a fast-selling lot that is widely stocked', () => {
    const a = assessPartout(
      [magnetPart({ worldSupplyLotsNew: MAGNET.maxSupplyLots + 1 })],
      1,
      'new'
    );
    expect(a.magnets).toHaveLength(0);
  });

  it('treats zero world supply as no data, not infinite scarcity', () => {
    const a = assessPartout([magnetPart({ worldSupplyLotsNew: 0 })], 1, 'new');
    expect(a.magnets).toHaveLength(0);
  });

  it('fires independently of the verdict — a failing set can still hold magnets', () => {
    // Set price makes the gate fail outright, but the lot is still a magnet.
    const a = assessPartout([magnetPart({ quantity: 1, priceNew: 1 })], 1000, 'new');
    expect(a.verdict).toBe('SELL-COMPLETE');
    expect(a.magnets).toHaveLength(1);
  });

  // The supply read is non-fatal: a failure yields an empty map and every lot silently
  // fails the scarcity leg. Without a denominator, "no magnets" would be a positive claim
  // built on absent evidence — magnetCoverage is what lets the UI tell the two apart.
  it('reports zero supply coverage when no lot has world-supply data', () => {
    const a = assessPartout(
      [part({ worldSupplyLotsNew: null }), part({ worldSupplyLotsNew: null })],
      1,
      'new'
    );
    expect(a.magnets).toHaveLength(0);
    expect(a.magnetCoverage).toEqual({ withSupplyData: 0, total: 2 });
  });

  it('counts partial supply coverage so a thin cache is distinguishable from absence', () => {
    const a = assessPartout(
      [magnetPart(), part({ worldSupplyLotsNew: null }), part({ worldSupplyLotsNew: 50 })],
      1,
      'new'
    );
    expect(a.magnets).toHaveLength(1);
    expect(a.magnetCoverage).toEqual({ withSupplyData: 2, total: 3 });
  });

  it('counts a zero supply count as data present but failing the scarcity leg', () => {
    // 0 is "no data" for the MAGNET test, but the field IS populated — coverage should
    // not claim the read failed.
    const a = assessPartout([magnetPart({ worldSupplyLotsNew: 0 })], 1, 'new');
    expect(a.magnets).toHaveLength(0);
    expect(a.magnetCoverage).toEqual({ withSupplyData: 1, total: 1 });
  });

  it('orders scarcest first, then by sell-through', () => {
    const a = assessPartout(
      [
        magnetPart({ partNumber: 'a', worldSupplyLotsNew: 3, strQtyNew: 0.9 }),
        magnetPart({ partNumber: 'b', worldSupplyLotsNew: 1, strQtyNew: 0.6 }),
        magnetPart({ partNumber: 'c', worldSupplyLotsNew: 3, strQtyNew: 2.0 }),
      ],
      1,
      'new'
    );
    expect(a.magnets.map((m) => m.partNumber)).toEqual(['b', 'c', 'a']);
  });
});

describe('assessPartout — value concentration', () => {
  it('reports the top-10 share and how few lots carry half the value', () => {
    // One £100 lot against ten £1 lots.
    const parts = [
      part({ partNumber: 'big', quantity: 1, priceNew: 100 }),
      ...Array.from({ length: 10 }, (_, i) =>
        part({ partNumber: `small${i}`, quantity: 1, priceNew: 1 })
      ),
    ];
    const a = assessPartout(parts, 20, 'new');
    expect(a.grossPov).toBe(110);
    expect(a.concentration.lotsToHalfPov).toBe(1);
    expect(a.concentration.topLots[0].partNumber).toBe('big');
    expect(a.concentration.topLots[0].shareOfPov).toBeCloseTo(100 / 110, 3);
  });

  it('splits value by catalogue item type', () => {
    const parts = [
      part({ partNumber: 'p', partType: 'PART', quantity: 1, priceNew: 10 }),
      part({ partNumber: 'm', partType: 'MINIFIG', quantity: 1, priceNew: 30 }),
    ];
    const a = assessPartout(parts, 5, 'new');
    expect(a.concentration.byType).toEqual({ minifig: 30, part: 10, other: 0 });
  });
});

describe('assessPartout — store overlap', () => {
  it('is null when no overlap index was loaded, rather than claiming we hold nothing', () => {
    const a = assessPartout([part()], 1, 'new');
    expect(a.overlap).toBeNull();
  });

  it('counts tags and splits additional from already-deep value', () => {
    const parts = [
      part({ partNumber: 'a', quantity: 1, priceNew: 10, overlapNew: 'NEW' }),
      part({ partNumber: 'b', quantity: 1, priceNew: 20, overlapNew: 'RESTOCK_OUT' }),
      part({ partNumber: 'c', quantity: 1, priceNew: 40, overlapNew: 'DUPLICATE' }),
      part({ partNumber: 'd', quantity: 1, priceNew: 5, overlapNew: 'RESTOCK_THIN' }),
    ];
    const a = assessPartout(parts, 10, 'new', {
      overlapMeta: { snapshotAt: '2026-07-25T00:00:00Z', salesWindowDays: 180 },
    });

    expect(a.overlap).not.toBeNull();
    expect(a.overlap!.counts).toEqual({
      NEW: 1,
      RESTOCK_OUT: 1,
      RESTOCK_THIN: 1,
      DUPLICATE: 1,
    });
    // NEW + RESTOCK_OUT are what the set would add to the store.
    expect(a.overlap!.additionalValue).toBe(30);
    expect(a.overlap!.duplicateValue).toBe(40);
    // RESTOCK_THIN is depth on something we list — neither additional nor duplicate.
    expect(a.overlap!.additionalValue + a.overlap!.duplicateValue).toBeLessThan(a.grossPov);
  });

  it('surfaces snapshot staleness rather than hiding it', () => {
    const a = assessPartout([part()], 1, 'new', {
      overlapMeta: { snapshotAt: null, salesWindowDays: 90 },
    });
    expect(a.overlap!.snapshotAt).toBeNull();
    expect(a.overlap!.salesWindowDays).toBe(90);
  });
});

describe('assessPartoutBoth', () => {
  it('assesses each condition against its own price and STR', () => {
    const parts = [
      part({ quantity: 10, priceNew: 5, priceUsed: 1, strQtyNew: 1.0, strQtyUsed: 0.1 }),
    ];
    const both = assessPartoutBoth(parts, { new: 10, used: 40 });

    expect(both.new.condition).toBe('new');
    expect(both.used.condition).toBe('used');
    expect(both.new.grossPov).toBe(50);
    expect(both.used.grossPov).toBe(10);
    // New clears 2× on a £40 gap; Used is worth less than the complete set.
    expect(both.new.verdict).toBe('PART-OUT');
    expect(both.used.verdict).toBe('SELL-COMPLETE');
  });
});
