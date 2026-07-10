import { describe, it, expect } from 'vitest';
import { captureFraction, liquidityAdjustedPov, CAPTURE_CURVE } from '../liquidity-pov';

describe('captureFraction', () => {
  it('applies the top bracket at and above STR 1.5', () => {
    expect(captureFraction(1.5)).toBe(0.95);
    expect(captureFraction(3)).toBe(0.95);
  });

  it('steps down at each documented boundary (inclusive lower bound)', () => {
    expect(captureFraction(1.0)).toBe(0.85);
    expect(captureFraction(1.49)).toBe(0.85);
    expect(captureFraction(0.5)).toBe(0.65);
    expect(captureFraction(0.99)).toBe(0.65);
    expect(captureFraction(0.25)).toBe(0.45);
    expect(captureFraction(0.49)).toBe(0.45);
    expect(captureFraction(0.1)).toBe(0.25);
    expect(captureFraction(0.24)).toBe(0.25);
  });

  it('falls to the 0.10 floor below STR 0.1', () => {
    expect(captureFraction(0.09)).toBe(0.1);
    expect(captureFraction(0)).toBe(0.1);
  });

  it('treats null STR as the worst bracket, not an optimistic default', () => {
    expect(captureFraction(null)).toBe(0.1);
  });

  it('treats non-finite STR (NaN/±Infinity) as unknown data — the 0.10 floor, not an optimistic default', () => {
    expect(captureFraction(NaN)).toBe(0.1);
    expect(captureFraction(Infinity)).toBe(0.1);
    expect(captureFraction(-Infinity)).toBe(0.1);
  });

  it('CAPTURE_CURVE constants match the documented brackets exactly', () => {
    expect(CAPTURE_CURVE).toEqual([
      { minStr: 1.5, fraction: 0.95 },
      { minStr: 1.0, fraction: 0.85 },
      { minStr: 0.5, fraction: 0.65 },
      { minStr: 0.25, fraction: 0.45 },
      { minStr: 0.1, fraction: 0.25 },
      { minStr: null, fraction: 0.1 },
    ]);
  });
});

describe('liquidityAdjustedPov', () => {
  it('returns zeros for an empty lot list', () => {
    const result = liquidityAdjustedPov([]);
    expect(result).toEqual({ gross: 0, realisable: 0, captureRate: 0 });
  });

  it('computes gross and realisable for a single high-STR lot', () => {
    const result = liquidityAdjustedPov([{ qty: 10, price: 2, str: 1.5 }]);
    expect(result.gross).toBe(20);
    expect(result.realisable).toBeCloseTo(20 * 0.95, 6);
    expect(result.captureRate).toBeCloseTo(0.95, 6);
  });

  it('aggregates across lots with mixed STR brackets', () => {
    const result = liquidityAdjustedPov([
      { qty: 10, price: 1, str: 1.5 }, // gross 10, capture 0.95 -> 9.5
      { qty: 5, price: 2, str: 0.05 }, // gross 10, capture 0.10 -> 1.0
    ]);
    expect(result.gross).toBe(20);
    expect(result.realisable).toBeCloseTo(10.5, 6);
    expect(result.captureRate).toBeCloseTo(10.5 / 20, 6);
  });

  it('skips lots with a null price (no benchmark) without throwing', () => {
    const result = liquidityAdjustedPov([
      { qty: 3, price: null, str: 1.5 },
      { qty: 2, price: 5, str: 1.5 },
    ]);
    expect(result.gross).toBe(10);
    expect(result.realisable).toBeCloseTo(9.5, 6);
  });

  it('skips lots with zero or negative qty', () => {
    const result = liquidityAdjustedPov([
      { qty: 0, price: 5, str: 1.5 },
      { qty: -1, price: 5, str: 1.5 },
      { qty: 1, price: 5, str: 1.5 },
    ]);
    expect(result.gross).toBe(5);
  });

  it('treats a null-STR lot with the 0.10 floor, still contributing to gross', () => {
    const result = liquidityAdjustedPov([{ qty: 4, price: 10, str: null }]);
    expect(result.gross).toBe(40);
    expect(result.realisable).toBeCloseTo(4, 6);
    expect(result.captureRate).toBeCloseTo(0.1, 6);
  });
});
