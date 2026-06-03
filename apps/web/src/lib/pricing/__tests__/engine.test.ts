import { describe, it, expect } from 'vitest';
import { computeTarget, calculateFloor, ceilToCharm, type EngineInput } from '../engine';
import type { MarkdownConfig } from '@/lib/markdown/types';

// Default config mirrors the seeded markdown_config (post unified-markdown migration).
const CONFIG: MarkdownConfig = {
  mode: 'review',
  amazon_step1_days: 60,
  amazon_step2_days: 90,
  amazon_step3_days: 120,
  amazon_step4_days: 150,
  amazon_step2_undercut_pct: 5,
  amazon_step3_undercut_pct: 10,
  ebay_step1_days: 60,
  ebay_step2_days: 90,
  ebay_step3_days: 120,
  ebay_step4_days: 150,
  ebay_step1_reduction_pct: 5,
  ebay_step2_reduction_pct: 10,
  amazon_fee_rate: 0.1836,
  ebay_fee_rate: 0.1566,
  overpriced_threshold_pct: 10,
  low_demand_sales_rank: 100000,
  auction_default_duration_days: 7,
  auction_max_per_day: 2,
  auction_enabled: true,
  suggest_interval_days: 30,
  relist_age_days: 90,
  min_change_pct: 3,
  report_email: 'chris@hadleybricks.co.uk',
};

function base(overrides: Partial<EngineInput>): EngineInput {
  return {
    platform: 'ebay',
    currentPrice: 20,
    cost: 5,
    condition: 'new',
    ageDays: 100,
    marketPrice: null,
    salesRank: null,
    views: 10,
    watchers: 0,
    config: CONFIG,
    ...overrides,
  };
}

// ============================================================================
// Floor / charm
// ============================================================================

describe('ceilToCharm', () => {
  it('rounds up to next charm ending', () => {
    expect(ceilToCharm(14.2)).toBe(14.49);
    expect(ceilToCharm(14.5)).toBe(14.99);
    expect(ceilToCharm(15.0)).toBe(15.49);
    expect(ceilToCharm(15.99)).toBe(15.99);
    expect(ceilToCharm(16.0)).toBe(16.49);
  });
  it('never below the input (true floor)', () => {
    for (const p of [3.1, 7.77, 12.0, 0.2]) {
      expect(ceilToCharm(p)).toBeGreaterThanOrEqual(p);
    }
  });
});

describe('calculateFloor', () => {
  it('Amazon uses 18.36% effective fee', () => {
    // 10 / (1 - 0.1836) = 12.249 → ceil charm 12.49
    expect(calculateFloor('amazon', 10, CONFIG)).toBe(12.49);
  });
  it('eBay uses 15.66% + £0.30 flat', () => {
    // (10 + 0.30) / (1 - 0.1566) = 12.21 → ceil charm 12.49
    expect(calculateFloor('ebay', 10, CONFIG)).toBe(12.49);
  });
  it('zero cost → zero floor', () => {
    expect(calculateFloor('ebay', 0, CONFIG)).toBe(0);
  });
});

// ============================================================================
// Gating
// ============================================================================

describe('age gating', () => {
  it('holds items below the step1 threshold', () => {
    const out = computeTarget(base({ ageDays: 30 }));
    expect(out.action).toBe('HOLD');
  });
});

// ============================================================================
// Amazon
// ============================================================================

describe('Amazon market-step curve', () => {
  it('step1 matches market and never increases', () => {
    // market below current → lower to market
    const out = computeTarget(
      base({ platform: 'amazon', currentPrice: 30, marketPrice: 24, ageDays: 70, cost: 5 })
    );
    expect(out.action).toBe('REPRICE');
    expect(out.targetPrice).toBe(23.99); // 24 charm-rounded down
    expect(out.markdownStep).toBe(1);
  });

  it('holds when market is above current (never increase)', () => {
    const out = computeTarget(
      base({ platform: 'amazon', currentPrice: 20, marketPrice: 25, ageDays: 70, cost: 5 })
    );
    expect(out.action).toBe('HOLD');
  });

  it('step2 undercuts market by configured pct', () => {
    const out = computeTarget(
      base({ platform: 'amazon', currentPrice: 40, marketPrice: 30, ageDays: 95, cost: 5 })
    );
    // 30 * 0.95 = 28.5 → charm 28.49
    expect(out.targetPrice).toBe(28.49);
    expect(out.markdownStep).toBe(2);
  });

  it('step4 drops to floor', () => {
    const out = computeTarget(
      base({ platform: 'amazon', currentPrice: 40, marketPrice: 30, ageDays: 160, cost: 10 })
    );
    expect(out.markdownStep).toBe(4);
    expect(out.targetPrice).toBe(calculateFloor('amazon', 10, CONFIG));
  });

  it('holds with no market price', () => {
    const out = computeTarget(base({ platform: 'amazon', marketPrice: null, ageDays: 100 }));
    expect(out.action).toBe('HOLD');
  });

  it('diagnoses overpriced when far above market', () => {
    const out = computeTarget(
      base({ platform: 'amazon', currentPrice: 50, marketPrice: 30, ageDays: 70, cost: 5 })
    );
    expect(out.diagnosis).toBe('OVERPRICED');
  });
});

// ============================================================================
// eBay engagement
// ============================================================================

describe('eBay engagement pricing', () => {
  it('HOT (watchers>=5) holds price — no markdown', () => {
    const out = computeTarget(
      base({ currentPrice: 39.99, watchers: 7, views: 115, ageDays: 100, condition: 'new' })
    );
    expect(out.tier).toBe('HOT');
    expect(out.action).toBe('HOLD');
  });

  it('KEY DECISION: HOT + Used does NOT get the Used cut', () => {
    // The old engine cut 6251 £39.99 -> £37.99. Unified engine must hold.
    const out = computeTarget(
      base({ currentPrice: 39.99, watchers: 7, views: 115, ageDays: 100, condition: 'used' })
    );
    expect(out.tier).toBe('HOT');
    expect(out.action).toBe('HOLD');
    expect(out.targetPrice).toBe(39.99);
  });

  it('COOL item gets a markdown', () => {
    // low views/day, 1 watcher → COOL → 10%
    const out = computeTarget(
      base({ currentPrice: 20, watchers: 1, views: 5, ageDays: 100, condition: 'new', cost: 2 })
    );
    expect(out.tier).toBe('COOL');
    expect(out.action).toBe('REPRICE');
    // 20 * 0.90 = 18 → charm 17.99
    expect(out.targetPrice).toBe(17.99);
  });

  it('Used adds 5% for non-HOT tiers', () => {
    const newOut = computeTarget(
      base({ currentPrice: 20, watchers: 1, views: 5, ageDays: 100, condition: 'new', cost: 2 })
    );
    const usedOut = computeTarget(
      base({ currentPrice: 20, watchers: 1, views: 5, ageDays: 100, condition: 'used', cost: 2 })
    );
    // used should be cheaper than new for the same COOL item
    expect(usedOut.targetPrice!).toBeLessThan(newOut.targetPrice!);
  });

  it('never increases price', () => {
    const out = computeTarget(
      base({ currentPrice: 5, watchers: 0, views: 0, ageDays: 100, cost: 10 })
    );
    expect(out.targetPrice === null || out.targetPrice <= 5).toBe(true);
  });

  it('deep-age non-HOT item recommends auction at step4', () => {
    const out = computeTarget(
      base({ currentPrice: 20, watchers: 0, views: 0, ageDays: 200, cost: 2 })
    );
    expect(out.action).toBe('AUCTION');
    expect(out.targetPrice).toBeNull();
    expect(out.diagnosis).toBe('LOW_DEMAND');
  });

  it('deep-age HOT item is NOT auctioned', () => {
    const out = computeTarget(
      base({ currentPrice: 20, watchers: 9, views: 400, ageDays: 200, condition: 'new' })
    );
    expect(out.tier).toBe('HOT');
    expect(out.action).not.toBe('AUCTION');
  });

  it('deep-age (step3) non-HOT pushed at least to floor', () => {
    const out = computeTarget(
      base({ currentPrice: 30, watchers: 1, views: 40, ageDays: 130, condition: 'new', cost: 10 })
    );
    const floor = calculateFloor('ebay', 10, CONFIG);
    expect(out.targetPrice!).toBeLessThanOrEqual(floor + 0.0001);
  });
});
