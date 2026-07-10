import { describe, it, expect } from 'vitest';
import {
  computeMaxBuy,
  maxBuyForSale,
  isHighConfidence,
  MAX_BUY_GREEN_MARGIN,
  MAX_BUY_AMBER_MARGIN,
} from '../max-buy';

describe('maxBuyForSale', () => {
  it('applies the house convention: sale*(1 - 17% fees - margin) - £4 ship', () => {
    // green: 100*(1 - 0.17 - 0.25) - 4 = 54
    expect(maxBuyForSale(100, MAX_BUY_GREEN_MARGIN)).toBeCloseTo(54, 2);
    // amber: 100*(1 - 0.17 - 0.15) - 4 = 64
    expect(maxBuyForSale(100, MAX_BUY_AMBER_MARGIN)).toBeCloseTo(64, 2);
  });
});

describe('isHighConfidence', () => {
  it('requires confidence >= 0.49', () => {
    expect(isHighConfidence(0.49, [], 50)).toBe(true);
    expect(isHighConfidence(0.48, [], 50)).toBe(false);
  });

  it('fails on demand-related risk factors', () => {
    expect(isHighConfidence(0.6, ['low_demand_high_sales_rank'], 50)).toBe(false);
    expect(isHighConfidence(0.6, ['no_amazon_listing'], 50)).toBe(false);
    expect(isHighConfidence(0.6, ['unknown_retirement_date'], 50)).toBe(true);
  });

  it('fails when the 1yr prediction is clamped at the model bounds', () => {
    expect(isHighConfidence(0.6, [], 399.5)).toBe(false);
    expect(isHighConfidence(0.6, [], -94.5)).toBe(false);
    expect(isHighConfidence(0.6, [], 399.4)).toBe(true);
  });
});

describe('computeMaxBuy', () => {
  const base = {
    rrp: 100,
    predicted1yrAppreciationPct: 60,
    confidence: 0.6,
    riskFactors: [] as string[],
  };

  it('uses P50-calibrated sale for HIGH tier', () => {
    const result = computeMaxBuy(base)!;
    expect(result.tier).toBe('HIGH');
    // sale = 100 * (1 + 0.91*60/100) = 154.6
    expect(result.expectedSale).toBeCloseTo(154.6, 2);
    // green max buy = 154.6 * 0.58 - 4 = 85.668
    expect(result.recommendedMaxBuy).toBeCloseTo(85.668, 2);
    expect(result.recommendedPctOfRrp).toBeCloseTo(85.668, 1);
  });

  it('uses half-prediction conservative sale for standard tier', () => {
    const result = computeMaxBuy({ ...base, confidence: 0.3 })!;
    expect(result.tier).toBe('standard');
    // sale = 100 * (1 + 60/200) = 130
    expect(result.expectedSale).toBeCloseTo(130, 2);
    // green max buy = 130 * 0.58 - 4 = 71.4
    expect(result.recommendedMaxBuy).toBeCloseTo(71.4, 2);
  });

  it('amber max buy is higher than green (looser margin)', () => {
    const result = computeMaxBuy(base)!;
    expect(result.amberMaxBuy).toBeGreaterThan(result.recommendedMaxBuy);
  });

  it('returns null without a usable RRP or prediction', () => {
    expect(computeMaxBuy({ ...base, rrp: 0 })).toBeNull();
    expect(computeMaxBuy({ ...base, rrp: -5 })).toBeNull();
    expect(computeMaxBuy({ ...base, predicted1yrAppreciationPct: NaN })).toBeNull();
  });

  it('handles predicted depreciation (negative max buy is possible)', () => {
    const result = computeMaxBuy({
      ...base,
      confidence: 0.3,
      predicted1yrAppreciationPct: -50,
    })!;
    expect(result.tier).toBe('standard');
    // sale = 100 * (1 - 50/200) = 75; green = 75*0.58 - 4 = 39.5
    expect(result.recommendedMaxBuy).toBeCloseTo(39.5, 2);
  });
});
