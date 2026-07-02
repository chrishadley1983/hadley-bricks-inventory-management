import { describe, it, expect } from 'vitest';
import { fitRidge, predictRidge } from '../ridge';
import { meanAbsoluteError, rSquared, spearman, ranks } from '../metrics';

describe('fitRidge', () => {
  it('recovers a known linear relationship', () => {
    // y = 3 + 2*x1 - x2, exact
    const X: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < 50; i++) {
      const x1 = (i % 10) - 5;
      const x2 = Math.floor(i / 10) - 2;
      X.push([x1, x2]);
      y.push(3 + 2 * x1 - x2);
    }

    const model = fitRidge(X, y, 0.001);
    expect(model.weights[0]).toBeCloseTo(3, 1); // bias
    expect(model.weights[1]).toBeCloseTo(2, 1);
    expect(model.weights[2]).toBeCloseTo(-1, 1);

    expect(predictRidge(model, [1, 1])).toBeCloseTo(4, 1);
  });

  it('handles a constant (singular) feature without crashing', () => {
    const X = [
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
    ];
    const y = [2, 4, 6, 8];
    const model = fitRidge(X, y, 0.001);
    expect(Number.isFinite(model.weights[1])).toBe(true);
    expect(predictRidge(model, [5, 0])).toBeCloseTo(10, 0);
  });

  it('regularization shrinks weights', () => {
    const X = [
      [1, 2],
      [2, 1],
      [3, 4],
      [4, 3],
      [5, 5],
    ];
    const y = [5, 4, 11, 10, 15];
    const loose = fitRidge(X, y, 0.001);
    const tight = fitRidge(X, y, 100);
    const norm = (w: number[]) => w.slice(1).reduce((s, x) => s + x * x, 0);
    expect(norm(tight.weights)).toBeLessThan(norm(loose.weights));
  });

  it('throws on empty input', () => {
    expect(() => fitRidge([], [], 1)).toThrow();
  });
});

describe('metrics', () => {
  it('meanAbsoluteError', () => {
    expect(meanAbsoluteError([10, 20, 30], [12, 18, 30])).toBe(1.33);
    expect(Number.isNaN(meanAbsoluteError([], []))).toBe(true);
  });

  it('rSquared is 1 for perfect predictions and ~0 for the mean', () => {
    expect(rSquared([1, 2, 3, 4], [1, 2, 3, 4])).toBe(1);
    expect(rSquared([1, 2, 3, 4], [2.5, 2.5, 2.5, 2.5])).toBe(0);
  });

  it('spearman is 1 for any monotonic relationship', () => {
    expect(spearman([1, 2, 3, 4], [10, 100, 1000, 10000])).toBe(1);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBe(-1);
  });

  it('spearman handles ties via average ranks', () => {
    const r = spearman([1, 2, 2, 3], [1, 2, 2, 3]);
    expect(r).toBe(1);
  });

  it('ranks assigns average ranks to ties', () => {
    expect(ranks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
  });
});
