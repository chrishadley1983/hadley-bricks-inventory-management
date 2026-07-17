import { describe, it, expect } from 'vitest';
import { bricqerMultiplier, bricqerListPrice, BRICQER_PRICE_FLOOR } from '../bricqer-pricing';

describe('bricqerMultiplier (v4, 2026-07-17)', () => {
  it('New: 1.10 at STR >= 0.5, else 0.85', () => {
    expect(bricqerMultiplier('N', 0.5)).toBe(1.1);
    expect(bricqerMultiplier('N', 5)).toBe(1.1);
    expect(bricqerMultiplier('N', 0.49)).toBe(0.85);
    expect(bricqerMultiplier('N', 0)).toBe(0.85);
  });

  it('Used: v4 super-velocity bracket 1.90 at STR >= 1.5', () => {
    expect(bricqerMultiplier('U', 1.5)).toBe(1.9);
    expect(bricqerMultiplier('U', 3.75)).toBe(1.9);
  });

  it('Used: remaining brackets unchanged from v2', () => {
    expect(bricqerMultiplier('U', 1.49)).toBe(1.4);
    expect(bricqerMultiplier('U', 1)).toBe(1.4);
    expect(bricqerMultiplier('U', 0.75)).toBe(1.25);
    expect(bricqerMultiplier('U', 0.5)).toBe(1.15);
    expect(bricqerMultiplier('U', 0.25)).toBe(0.93);
    expect(bricqerMultiplier('U', 0.24)).toBe(0.9);
    expect(bricqerMultiplier('U', 0)).toBe(0.9);
  });
});

describe('bricqerListPrice', () => {
  it('applies avg × multiplier above the floor', () => {
    expect(bricqerListPrice(1.0, 'U', 1.5)).toBeCloseTo(1.9, 6);
    expect(bricqerListPrice(0.5, 'N', 0.6)).toBeCloseTo(0.55, 6);
  });

  it('floors at £0.0399 (the v4 store floor)', () => {
    expect(bricqerListPrice(0.02, 'U', 0)).toBe(BRICQER_PRICE_FLOOR); // 0.018 → floored
    expect(bricqerListPrice(0.04, 'N', 0)).toBe(BRICQER_PRICE_FLOOR); // 0.034 → floored
    expect(bricqerListPrice(0.05, 'U', 0.25)).toBeCloseTo(0.0465, 4); // above floor untouched
  });

  it('returns null (not the floor) when there is no benchmark', () => {
    expect(bricqerListPrice(null, 'U', 1)).toBeNull();
    expect(bricqerListPrice(0, 'U', 1)).toBeNull();
    expect(bricqerListPrice(undefined, 'N', 1)).toBeNull();
  });
});
