/**
 * The two-channel sell-complete basis, and the warnings that annotate a verdict.
 *
 * Reference case throughout: 40756 Lucky Knots as it stood on 2026-07-26 — a confident
 * PART-OUT at 2.96× with a £34.32 max buy, resting on 29 lots whose median sell-through
 * is 0.083 and of which exactly one clears the liquid gate. The screen said nothing.
 */

import { describe, it, expect } from 'vitest';
import {
  assessPartout,
  assessPartoutBoth,
  buildSetPriceBasis,
  type AmazonSetOffer,
} from '../partout-assessment';
import { VAR_FEE_PCT, AMAZON_FEE_PCT, LIQUID_STR_GATE, PARTOUT_WARN } from '../fees';
import type { PartValue } from '@/types/partout';

function part(overrides: Partial<PartValue> = {}): PartValue {
  return {
    partNumber: '3001',
    partType: 'PART',
    name: 'Brick 2 x 4',
    colourId: 5,
    colourName: 'Red',
    imageUrl: '',
    quantity: 1,
    priceNew: 1,
    priceUsed: 0.5,
    totalNew: 1,
    totalUsed: 0.5,
    sellThroughRateNew: null,
    sellThroughRateUsed: null,
    strQtyNew: 0.5,
    strQtyUsed: 0.5,
    stockAvailableNew: null,
    stockAvailableUsed: null,
    timesSoldNew: null,
    timesSoldUsed: null,
    worldSupplyLotsNew: null,
    worldSupplyLotsUsed: null,
    overlapNew: null,
    overlapUsed: null,
    ourQtyNew: null,
    ourQtyUsed: null,
    fromCache: true,
    ...overrides,
  };
}

/** n lots at £`price` each with sell-through `str`. */
function lots(n: number, price: number, str: number | null): PartValue[] {
  return Array.from({ length: n }, (_, i) =>
    part({
      partNumber: `p${i}`,
      quantity: 1,
      priceNew: price,
      totalNew: price,
      strQtyNew: str,
    })
  );
}

const amazon = (buyBox: number, salesRank: number | null = null): AmazonSetOffer => ({
  buyBox,
  asin: 'B0DTV6K5HC',
  snapshotDate: '2026-07-26',
  salesRank,
});

describe('buildSetPriceBasis', () => {
  it('converts Amazon to the BrickLink ask that leaves the same money in hand', () => {
    const basis = buildSetPriceBasis(null, amazon(19.75));
    const expected = (19.75 * (1 - AMAZON_FEE_PCT)) / (1 - VAR_FEE_PCT);

    expect(basis.amazon!.buyBox).toBe(19.75);
    expect(basis.amazon!.blEquivalent).toBeCloseTo(expected, 2);
    expect(basis.price).toBeCloseTo(expected, 2);
    expect(basis.channel).toBe('amazon');
  });

  it('does not hand Amazon a win it only has on gross', () => {
    // 40756: Amazon £19.75 looks 10.6% better than BrickLink's £17.86, but after each
    // channel's fees it is worth 1.3% more — enough to win, nowhere near enough to swing
    // a verdict, and the raw comparison would have overstated it by 8 points.
    const basis = buildSetPriceBasis(17.86, amazon(19.75));

    expect(basis.channel).toBe('amazon');
    expect(basis.price!).toBeGreaterThan(17.86);
    expect(basis.price!).toBeLessThan(19.75);
    expect(basis.price! / 17.86).toBeLessThan(1.05);
  });

  it('keeps BrickLink when its ask is better after fees', () => {
    const basis = buildSetPriceBasis(30, amazon(31));
    expect(basis.channel).toBe('bricklink');
    expect(basis.price).toBe(30);
    // The losing channel is still reported — it is what makes the winner a choice.
    expect(basis.amazon!.buyBox).toBe(31);
  });

  it('reports no channel at all when neither has a price', () => {
    expect(buildSetPriceBasis(null, null)).toEqual({
      price: null,
      channel: null,
      bricklink: null,
      amazon: null,
    });
  });
});

describe('assessPartoutBoth — Amazon is new-only', () => {
  const parts = lots(20, 5, 0.5);

  it('lets Amazon price the new comparison but never the used one', () => {
    const both = assessPartoutBoth(parts, { new: 10, used: 10 }, { amazon: amazon(40) });

    expect(both.new.setPriceBasis.channel).toBe('amazon');
    expect(both.used.setPriceBasis.channel).toBe('bricklink');
    expect(both.used.setPriceBasis.amazon).toBeNull();
    // The used verdict is decided against £10, not against a new-condition Buy Box.
    expect(both.used.setPrice).toBe(10);
  });
});

describe('THIN-LIQUIDITY warning', () => {
  it('fires on a PART-OUT verdict whose value sits in lots that do not sell', () => {
    // The 40756 shape: one liquid lot, the rest inert, and a multiple that sails through.
    const parts = [...lots(28, 1.7, 0.02), ...lots(1, 3.95, 0.5)];
    const a = assessPartout(parts, buildSetPriceBasis(17.86, null), 'new');

    expect(a.verdict).toBe('PART-OUT');
    const warning = a.warnings.find((w) => w.code === 'THIN-LIQUIDITY');
    expect(warning).toBeDefined();
    expect(warning!.detail).toContain(`STR ${LIQUID_STR_GATE}`);
    // It must quantify, not just assert.
    expect(warning!.detail).toMatch(/\d+% of the part-out value/);
  });

  it('stays quiet when the value sits in lots that actually move', () => {
    const a = assessPartout(lots(20, 5, 0.9), buildSetPriceBasis(20, null), 'new');

    expect(a.verdict).toBe('PART-OUT');
    expect(a.warnings).toHaveLength(0);
  });

  it('fires on median sell-through alone, even when the liquid share is fine', () => {
    // Value concentrated in one fast lot, but a typical lot in the set is dead.
    const parts = [...lots(1, 60, 1.2), ...lots(20, 0.2, 0.01)];
    const a = assessPartout(parts, buildSetPriceBasis(20, null), 'new');

    const warning = a.warnings.find((w) => w.code === 'THIN-LIQUIDITY');
    expect(warning).toBeDefined();
    expect(a.strSummary.median!).toBeLessThan(PARTOUT_WARN.minMedianStr);
  });

  it('never changes the verdict it annotates', () => {
    const parts = [...lots(28, 1.7, 0.02), ...lots(1, 3.95, 0.5)];
    const warned = assessPartout(parts, buildSetPriceBasis(17.86, null), 'new');
    const liquid = assessPartout(lots(29, 1.78, 0.9), buildSetPriceBasis(17.86, null), 'new');

    expect(warned.verdict).toBe(liquid.verdict);
    expect(warned.maxBuy.price).toBeGreaterThan(0);
  });
});

describe('SLOW-COMPLETE-SALE warning', () => {
  // POV well under 2x the ask, so the gate lands on SELL-COMPLETE.
  const parts = lots(10, 1, 0.5);

  it('fires when Amazon BSR says the complete set is a slow mover', () => {
    const a = assessPartout(parts, buildSetPriceBasis(50, null), 'new', {
      amazon: amazon(50, PARTOUT_WARN.slowBsr + 1),
    });

    expect(a.verdict).toBe('SELL-COMPLETE');
    const w = a.warnings.find((x) => x.code === 'SLOW-COMPLETE-SALE');
    expect(w).toBeDefined();
    expect(w!.detail).toContain('BSR');
  });

  it('falls back to the complete set’s own sell-through when BSR is missing', () => {
    // sales_rank is null on roughly a third of rows — including 40756's ASIN — so BSR
    // cannot be the only test or the warning is silent exactly where it is needed.
    const a = assessPartout(parts, buildSetPriceBasis(50, null), 'new', {
      amazon: amazon(50, null),
      setStr: 0.05,
    });

    const w = a.warnings.find((x) => x.code === 'SLOW-COMPLETE-SALE');
    expect(w).toBeDefined();
    expect(w!.detail).toContain('no BSR on record');
  });

  it('stays quiet when the set turns over well', () => {
    const a = assessPartout(parts, buildSetPriceBasis(50, null), 'new', {
      amazon: amazon(50, 1_000),
      setStr: 0.9,
    });

    expect(a.verdict).toBe('SELL-COMPLETE');
    expect(a.warnings).toHaveLength(0);
  });

  it('does not fire on a PART-OUT verdict, however slow the set is', () => {
    const a = assessPartout(lots(20, 5, 0.9), buildSetPriceBasis(20, null), 'new', {
      amazon: amazon(20, 900_000),
      setStr: 0.01,
    });

    expect(a.verdict).toBe('PART-OUT');
    expect(a.warnings.find((w) => w.code === 'SLOW-COMPLETE-SALE')).toBeUndefined();
  });
});
