import { describe, it, expect } from 'vitest';
import {
  roundUpToNearest99,
  getEngagementTier,
  getReductionPct,
  calculateFloorPrice,
  calculateRefreshPrice,
} from '../refresh-pricing';

// ============================================================================
// roundUpToNearest99
// ============================================================================

describe('roundUpToNearest99', () => {
  it('rounds 14.20 to 14.99', () => {
    expect(roundUpToNearest99(14.2)).toBe(14.99);
  });

  it('rounds 15.10 to 15.99', () => {
    expect(roundUpToNearest99(15.1)).toBe(15.99);
  });

  it('keeps 15.99 as 15.99', () => {
    expect(roundUpToNearest99(15.99)).toBe(15.99);
  });

  it('rounds 16.00 to 16.99', () => {
    expect(roundUpToNearest99(16.0)).toBe(16.99);
  });

  it('rounds 0.50 to 0.99', () => {
    expect(roundUpToNearest99(0.5)).toBe(0.99);
  });

  it('handles zero by returning 0.99', () => {
    expect(roundUpToNearest99(0)).toBe(0.99);
  });

  it('handles negative by returning 0.99', () => {
    expect(roundUpToNearest99(-5)).toBe(0.99);
  });

  it('rounds 99.01 to 99.99', () => {
    expect(roundUpToNearest99(99.01)).toBe(99.99);
  });
});

// ============================================================================
// getEngagementTier
// ============================================================================

describe('getEngagementTier', () => {
  describe('HOT tier', () => {
    it('returns HOT when watchers >= 5', () => {
      expect(getEngagementTier(0, 5, 90)).toBe('HOT');
    });

    it('returns HOT when watchers = 10 regardless of views', () => {
      expect(getEngagementTier(0, 10, 90)).toBe('HOT');
    });
  });

  describe('COLD tier', () => {
    it('returns COLD when viewsPerDay < 0.5 and watchers == 0', () => {
      // 30 views / 90 days = 0.33 views/day
      expect(getEngagementTier(30, 0, 90)).toBe('COLD');
    });

    it('returns COLD when zero views and zero watchers', () => {
      expect(getEngagementTier(0, 0, 90)).toBe('COLD');
    });
  });

  describe('WARM tier', () => {
    it('returns WARM when viewsPerDay >= 1.0 and watchers >= 2', () => {
      // 100 views / 90 days = 1.11 views/day, 3 watchers
      expect(getEngagementTier(100, 3, 90)).toBe('WARM');
    });

    it('returns WARM at exact boundary (viewsPerDay = 1.0, watchers = 2)', () => {
      // 90 views / 90 days = 1.0
      expect(getEngagementTier(90, 2, 90)).toBe('WARM');
    });
  });

  describe('COOL tier', () => {
    it('returns COOL when viewsPerDay < 1.0 but has some watchers', () => {
      // 50 views / 90 days = 0.55, 1 watcher
      expect(getEngagementTier(50, 1, 90)).toBe('COOL');
    });

    it('returns COOL when viewsPerDay >= 1.0 but watchers < 2', () => {
      // 100 views / 90 days = 1.11, 1 watcher
      expect(getEngagementTier(100, 1, 90)).toBe('COOL');
    });

    it('returns COOL when viewsPerDay >= 0.5 but watchers == 0', () => {
      // 50 views / 90 days = 0.55, 0 watchers — not COLD (vpd >= 0.5)
      expect(getEngagementTier(50, 0, 90)).toBe('COOL');
    });
  });

  describe('edge cases', () => {
    it('handles zero ageDays gracefully', () => {
      // viewsPerDay = 0, watchers = 0 → COLD
      expect(getEngagementTier(100, 0, 0)).toBe('COLD');
    });

    it('HOT takes priority over WARM', () => {
      // High views and 5 watchers — HOT wins
      expect(getEngagementTier(500, 5, 90)).toBe('HOT');
    });
  });
});

// ============================================================================
// getReductionPct
// ============================================================================

describe('getReductionPct', () => {
  it('returns 0% for HOT + New', () => {
    expect(getReductionPct('HOT', 'New')).toBe(0);
  });

  it('returns 5% for HOT + Used', () => {
    expect(getReductionPct('HOT', 'Used')).toBe(5);
  });

  it('returns 5% for WARM + New', () => {
    expect(getReductionPct('WARM', 'New')).toBe(5);
  });

  it('returns 10% for WARM + Used', () => {
    expect(getReductionPct('WARM', 'Used')).toBe(10);
  });

  it('returns 10% for COOL + New', () => {
    expect(getReductionPct('COOL', 'New')).toBe(10);
  });

  it('returns 15% for COOL + Used', () => {
    expect(getReductionPct('COOL', 'Used')).toBe(15);
  });

  it('returns 15% for COLD + New', () => {
    expect(getReductionPct('COLD', 'New')).toBe(15);
  });

  it('returns 20% for COLD + Used', () => {
    expect(getReductionPct('COLD', 'Used')).toBe(20);
  });

  it('treats null condition as New (no extra reduction)', () => {
    expect(getReductionPct('COLD', null)).toBe(15);
  });

  it('is case-insensitive for "used"', () => {
    expect(getReductionPct('COLD', 'used')).toBe(20);
  });
});

// ============================================================================
// calculateFloorPrice
// ============================================================================

describe('calculateFloorPrice', () => {
  it('calculates floor as cost / (1 - feeRate)', () => {
    // cost=10, feeRate=0.1323 → 10 / 0.8677 ≈ 11.52
    const floor = calculateFloorPrice(10, 0.1323);
    expect(floor).toBeCloseTo(11.524, 2);
  });

  it('returns 0 for zero cost', () => {
    expect(calculateFloorPrice(0)).toBe(0);
  });

  it('returns 0 for negative cost', () => {
    expect(calculateFloorPrice(-5)).toBe(0);
  });
});

// ============================================================================
// calculateRefreshPrice
// ============================================================================

describe('calculateRefreshPrice', () => {
  const FEE_RATE = 0.1323;

  it('HOT + New: no reduction, price unchanged', () => {
    const result = calculateRefreshPrice(29.99, 10, 'HOT', 'New', FEE_RATE);
    expect(result.newPrice).toBe(29.99);
    expect(result.reductionPct).toBe(0);
    expect(result.wasUnchanged).toBe(true);
  });

  it('WARM + New: 5% reduction rounded to .99', () => {
    // 29.99 * 0.95 = 28.4905 → floor(28.4905) + 0.99 = 28.99
    const result = calculateRefreshPrice(29.99, 10, 'WARM', 'New', FEE_RATE);
    expect(result.newPrice).toBe(28.99);
    expect(result.reductionPct).toBe(5);
    expect(result.wasUnchanged).toBe(false);
  });

  it('COOL + New: 10% reduction rounded to .99', () => {
    // 29.99 * 0.90 = 26.991 → floor(26.991) + 0.99 = 26.99
    const result = calculateRefreshPrice(29.99, 10, 'COOL', 'New', FEE_RATE);
    expect(result.newPrice).toBe(26.99);
    expect(result.reductionPct).toBe(10);
  });

  it('COLD + New: 15% reduction rounded to .99', () => {
    // 29.99 * 0.85 = 25.4915 → floor(25.4915) + 0.99 = 25.99
    const result = calculateRefreshPrice(29.99, 10, 'COLD', 'New', FEE_RATE);
    expect(result.newPrice).toBe(25.99);
    expect(result.reductionPct).toBe(15);
  });

  it('COLD + Used: 20% reduction rounded to .99', () => {
    // 29.99 * 0.80 = 23.992 → floor(23.992) + 0.99 = 23.99
    const result = calculateRefreshPrice(29.99, 10, 'COLD', 'Used', FEE_RATE);
    expect(result.newPrice).toBe(23.99);
    expect(result.reductionPct).toBe(20);
  });

  it('clamps to floor when reduction would go below breakeven', () => {
    // cost=25, floor = 25/0.8677 ≈ 28.80 → roundUp = 28.99
    // 29.99 * 0.85 = 25.49 → roundUp = 25.99
    // 25.99 < 28.99 floor → use floor 28.99
    const result = calculateRefreshPrice(29.99, 25, 'COLD', 'New', FEE_RATE);
    expect(result.newPrice).toBe(28.99);
    expect(result.wasFloored).toBe(true);
  });

  it('never increases price even when floor is higher', () => {
    // cost=28, floor = 28/0.8677 ≈ 32.27 → roundUp = 32.99
    // currentPrice = 29.99
    // HOT = 0% reduction → 29.99 → floor 32.99 > 29.99
    // But never increase: keep 29.99
    const result = calculateRefreshPrice(29.99, 28, 'HOT', 'New', FEE_RATE);
    expect(result.newPrice).toBe(29.99);
    expect(result.wasUnchanged).toBe(true);
  });

  it('handles zero cost (no floor constraint)', () => {
    const result = calculateRefreshPrice(19.99, 0, 'COLD', 'New', FEE_RATE);
    // 19.99 * 0.85 = 16.9915 → floor(16.9915) + 0.99 = 16.99
    expect(result.newPrice).toBe(16.99);
    expect(result.floorPrice).toBe(0);
  });
});
