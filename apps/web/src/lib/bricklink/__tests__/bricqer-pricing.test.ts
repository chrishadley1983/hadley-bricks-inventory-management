import { describe, it, expect } from 'vitest';
import { bricqerMultiplier, bricqerListPrice, BRICQER_PRICE_FLOOR } from '../bricqer-pricing';

describe('bricqerMultiplier (v3, 2026-07-07)', () => {
  it('New: 1.10 at STR >= 0.5, else 0.85', () => {
    expect(bricqerMultiplier('N', 0.5)).toBe(1.1);
    expect(bricqerMultiplier('N', 5)).toBe(1.1);
    expect(bricqerMultiplier('N', 0.49)).toBe(0.85);
    expect(bricqerMultiplier('N', 0)).toBe(0.85);
  });

  it('Used: v3 super-velocity bracket 1.80 at STR >= 1.5', () => {
    expect(bricqerMultiplier('U', 1.5)).toBe(1.8);
    expect(bricqerMultiplier('U', 3.75)).toBe(1.8);
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
    expect(bricqerListPrice(1.0, 'U', 1.5)).toBeCloseTo(1.8, 6);
    expect(bricqerListPrice(0.5, 'N', 0.6)).toBeCloseTo(0.55, 6);
  });

  it('floors at £0.0699 (the 7p store floor)', () => {
    expect(bricqerListPrice(0.02, 'U', 0)).toBe(BRICQER_PRICE_FLOOR); // 0.018 → floored
    expect(bricqerListPrice(0.05, 'N', 0)).toBe(BRICQER_PRICE_FLOOR); // 0.0425 → floored
    expect(bricqerListPrice(0.08, 'U', 0.25)).toBeCloseTo(0.0744, 4); // above floor untouched
  });

  it('returns null (not the floor) when there is no benchmark', () => {
    expect(bricqerListPrice(null, 'U', 1)).toBeNull();
    expect(bricqerListPrice(0, 'U', 1)).toBeNull();
    expect(bricqerListPrice(undefined, 'N', 1)).toBeNull();
  });
});
