import { describe, it, expect } from 'vitest';
import {
  computeTarget,
  calculateFloor,
  ceilToCharm,
  floorToCharm,
  type EngineInput,
  type AmazonMarketContext,
} from '../engine';
import type { MarkdownConfig } from '@/lib/markdown/types';

// Default config mirrors the seeded markdown_config (post markdown-v2 migration).
const CONFIG: MarkdownConfig = {
  mode: 'review',
  amazon_step1_days: 30,
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
  amazon_postage_cost: 2.8,
  ebay_postage_cost: 1.55,
  amazon_persistence_window_days: 14,
  amazon_persistence_min_pct: 75,
  amazon_reference_window_days: 180,
  amazon_decay_start_days: 90,
  amazon_decay_interval_days: 60,
  amazon_decay_step_pct: 5,
  amazon_decay_floor_pct: 60,
  amazon_exit_days: 365,
  amazon_min_drops_90d: 1,
  amazon_healthy_drops_90d: 10,
};

/** Competitor-holds-box context with a clean, persistent signal. */
function competitorMarket(overrides: Partial<AmazonMarketContext> = {}): AmazonMarketContext {
  return {
    stableBuyBox: 24,
    currentBuyBox: 24.5,
    keepaAvg180: 24.5,
    keepaAvg90: 24,
    persistenceBelowPct: 0.9,
    persistenceSampleSize: 14,
    buyBoxIsYours: false,
    totalOfferCount: 5,
    salesRank: 50000,
    salesRankDrops90: 12,
    anchorPrice: 30,
    lastAppliedMatch: null,
    ...overrides,
  };
}

/** We-hold-the-box context. */
function weHoldBoxMarket(overrides: Partial<AmazonMarketContext> = {}): AmazonMarketContext {
  return competitorMarket({ buyBoxIsYours: true, ...overrides });
}

function base(overrides: Partial<EngineInput>): EngineInput {
  return {
    platform: 'ebay',
    currentPrice: 20,
    cost: 5,
    condition: 'new',
    ageDays: 100,
    amazonMarket: null,
    views: 10,
    watchers: 0,
    config: CONFIG,
    ...overrides,
  };
}

function amazon(overrides: Partial<EngineInput>): EngineInput {
  return base({ platform: 'amazon', currentPrice: 30, cost: 10, ageDays: 100, ...overrides });
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

describe('floorToCharm', () => {
  it('rounds down to nearest charm ending', () => {
    expect(floorToCharm(24.5)).toBe(24.49);
    expect(floorToCharm(24.49)).toBe(24.49);
    expect(floorToCharm(24.99)).toBe(24.99);
    expect(floorToCharm(24.2)).toBe(23.99);
    expect(floorToCharm(24)).toBe(23.99);
  });
  it('never above the input (sits at/under the buy box)', () => {
    for (const p of [3.1, 7.77, 12.0, 24.5, 19.99]) {
      expect(floorToCharm(p)).toBeLessThanOrEqual(p);
    }
  });
});

describe('calculateFloor', () => {
  it('Amazon includes postage: (10 + 2.80) / (1 - 0.1836)', () => {
    // 12.80 / 0.8164 = 15.679 → ceil charm 15.99
    expect(calculateFloor('amazon', 10, CONFIG)).toBe(15.99);
  });
  it('eBay includes postage + £0.30 flat: (10 + 1.55 + 0.30) / (1 - 0.1566)', () => {
    // 11.85 / 0.8434 = 14.05 → ceil charm 14.49
    expect(calculateFloor('ebay', 10, CONFIG)).toBe(14.49);
  });
  it('zero cost → zero floor', () => {
    expect(calculateFloor('ebay', 0, CONFIG)).toBe(0);
  });
});

// ============================================================================
// Gating
// ============================================================================

describe('age gating', () => {
  it('holds eBay items below the step1 threshold', () => {
    const out = computeTarget(base({ ageDays: 30 }));
    expect(out.action).toBe('HOLD');
  });
  it('holds Amazon items below 30d', () => {
    const out = computeTarget(amazon({ ageDays: 20, amazonMarket: competitorMarket() }));
    expect(out.action).toBe('HOLD');
  });
});

// ============================================================================
// Amazon — position-first
// ============================================================================

describe('Amazon 365d exit', () => {
  it('recommends eBay auction exit at >= amazon_exit_days with no market data', () => {
    const out = computeTarget(amazon({ ageDays: 400, amazonMarket: null }));
    expect(out.action).toBe('AUCTION');
    expect(out.diagnosis).toBe('EXIT');
    expect(out.targetPrice).toBeNull();
  });

  it('exits when demand is thin even if a competitor market exists', () => {
    const out = computeTarget(
      amazon({ ageDays: 400, amazonMarket: competitorMarket({ salesRankDrops90: 3 }) })
    );
    expect(out.action).toBe('AUCTION');
    expect(out.diagnosis).toBe('EXIT');
  });

  it('defers exit: overpriced all along + healthy demand + market clears floor → reprice to market', () => {
    // current 30 vs stable 24 / current box 24.5 → target floorToCharm(24.5) = 24.49,
    // floor 15.99, drops 12 >= healthy 10 → the item never had a fair run at market.
    const out = computeTarget(amazon({ ageDays: 400, amazonMarket: competitorMarket() }));
    expect(out.action).toBe('REPRICE');
    expect(out.diagnosis).toBe('OVERPRICED');
    expect(out.targetPrice).toBe(24.49);
    expect(out.reason).toContain('exit deferred');
  });

  it('does NOT defer when already priced at/below the market — exit proceeds', () => {
    const out = computeTarget(
      amazon({ ageDays: 400, currentPrice: 23.99, amazonMarket: competitorMarket() })
    );
    expect(out.action).toBe('AUCTION');
    expect(out.diagnosis).toBe('EXIT');
  });

  it('does NOT defer when the stable market sits below our floor — exit proceeds', () => {
    // cost 25 → floor 34.49 > market target 24.49: cannot compete profitably.
    const out = computeTarget(
      amazon({ ageDays: 400, currentPrice: 40, cost: 25, amazonMarket: competitorMarket() })
    );
    expect(out.action).toBe('AUCTION');
    expect(out.diagnosis).toBe('EXIT');
  });

  it('defers exit to HOLD when we hold the box with healthy demand', () => {
    const out = computeTarget(amazon({ ageDays: 400, amazonMarket: weHoldBoxMarket() }));
    expect(out.action).toBe('HOLD');
    expect(out.reason).toContain('exit deferred');
  });

  it('exits when we hold the box but demand is thin', () => {
    const out = computeTarget(
      amazon({ ageDays: 400, amazonMarket: weHoldBoxMarket({ salesRankDrops90: 2 }) })
    );
    expect(out.action).toBe('AUCTION');
    expect(out.diagnosis).toBe('EXIT');
  });
});

describe('Amazon — we hold the buy box (velocity-gated decay)', () => {
  it('holds when no velocity data yet', () => {
    const out = computeTarget(amazon({ amazonMarket: weHoldBoxMarket({ salesRankDrops90: null }) }));
    expect(out.action).toBe('HOLD');
  });

  it('holds with zero drops — a cut is pure margin donation', () => {
    const out = computeTarget(amazon({ amazonMarket: weHoldBoxMarket({ salesRankDrops90: 0 }) }));
    expect(out.action).toBe('HOLD');
    expect(out.reason).toContain('cut pointless');
  });

  it('holds when demand is healthy', () => {
    const out = computeTarget(amazon({ amazonMarket: weHoldBoxMarket({ salesRankDrops90: 25 }) }));
    expect(out.action).toBe('HOLD');
    expect(out.reason).toContain('demand healthy');
  });

  it('sole offer is treated as we-are-the-market even without the box flag', () => {
    const out = computeTarget(
      amazon({
        amazonMarket: competitorMarket({ buyBoxIsYours: false, totalOfferCount: 1, salesRankDrops90: 0 }),
      })
    );
    expect(out.action).toBe('HOLD');
    expect(out.reason).toContain('cut pointless');
  });

  it('thin demand before decay start holds', () => {
    const out = computeTarget(
      amazon({ ageDays: 60, amazonMarket: weHoldBoxMarket({ salesRankDrops90: 3 }) })
    );
    expect(out.action).toBe('HOLD');
  });

  it('thin demand decays -5% per 60d from the anchor', () => {
    // anchor 40, age 100 → step 1 → 40*0.95=38 → nearest charm 37.99
    const out = computeTarget(
      amazon({
        currentPrice: 40,
        ageDays: 100,
        amazonMarket: weHoldBoxMarket({ salesRankDrops90: 3, anchorPrice: 40 }),
      })
    );
    expect(out.action).toBe('REPRICE');
    expect(out.targetPrice).toBe(37.99);
    expect(out.diagnosis).toBe('LOW_DEMAND');
  });

  it('decay is bounded by the decay floor pct of the anchor', () => {
    // aggressive decay config: 25%/step → age 150 = step 2 → 40*0.5=20,
    // but bound = 60% of 40 = 24 → raw 24 → nearest charm 23.99
    const cfg = { ...CONFIG, amazon_decay_step_pct: 25 };
    const out = computeTarget(
      amazon({
        currentPrice: 40,
        ageDays: 150,
        config: cfg,
        amazonMarket: weHoldBoxMarket({ salesRankDrops90: 3, anchorPrice: 40 }),
      })
    );
    expect(out.targetPrice).toBe(23.99);
  });

  it('decay never goes below the fee+postage floor', () => {
    // cost 20 → floor (20+2.8)/0.8164 = 27.93 → charm-ceil 27.99; decay raw would be far lower
    const cfg = { ...CONFIG, amazon_decay_step_pct: 25, amazon_decay_floor_pct: 30 };
    const out = computeTarget(
      amazon({
        currentPrice: 40,
        cost: 20,
        ageDays: 210,
        config: cfg,
        amazonMarket: weHoldBoxMarket({ salesRankDrops90: 3, anchorPrice: 40 }),
      })
    );
    expect(out.targetPrice).toBeGreaterThanOrEqual(calculateFloor('amazon', 20, cfg));
  });
});

describe('Amazon — competitor holds the buy box (stable match)', () => {
  it('matches: largest charm at/below the stable reference', () => {
    // reference = max(stable 24, current 24.5) = 24.5 → charm 24.49
    const out = computeTarget(amazon({ currentPrice: 30, amazonMarket: competitorMarket() }));
    expect(out.action).toBe('REPRICE');
    expect(out.targetPrice).toBe(24.49);
    expect(out.markdownStep).toBe(1);
    expect(out.diagnosis).toBe('OVERPRICED');
  });

  it('market rising: matches todays box when above the long-run median', () => {
    const out = computeTarget(
      amazon({ currentPrice: 30, amazonMarket: competitorMarket({ currentBuyBox: 28, keepaAvg180: 27 }) })
    );
    expect(out.targetPrice).toBe(27.99);
  });

  it('never proposes below stable just because the box dipped today', () => {
    // Today's box crashed to 15 but the median holds at 24 → target stays charm(24)
    const out = computeTarget(
      amazon({ currentPrice: 30, amazonMarket: competitorMarket({ currentBuyBox: 15 }) })
    );
    expect(out.targetPrice).toBe(23.99);
  });

  it('holds on a blip: box below us on <75% of recent snapshots', () => {
    const out = computeTarget(
      amazon({ currentPrice: 30, amazonMarket: competitorMarket({ persistenceBelowPct: 0.4 }) })
    );
    expect(out.action).toBe('HOLD');
    expect(out.reason).toContain('blip');
  });

  it('holds with too few snapshots to judge persistence', () => {
    const out = computeTarget(
      amazon({ currentPrice: 30, amazonMarket: competitorMarket({ persistenceSampleSize: 3 }) })
    );
    expect(out.action).toBe('HOLD');
  });

  it('flags manual review when snapshot median and Keepa disagree >25%', () => {
    const out = computeTarget(
      amazon({ currentPrice: 30, amazonMarket: competitorMarket({ keepaAvg180: 40, keepaAvg90: null }) })
    );
    expect(out.action).toBe('HOLD');
    expect(out.needsReview).toBe(true);
  });

  it('stable market below floor → hold + EXIT flag, never chases', () => {
    // cost 25 → floor (25+2.8)/0.8164 = 34.05 → 34.49 > stable 24
    const out = computeTarget(
      amazon({ currentPrice: 40, cost: 25, amazonMarket: competitorMarket({ keepaAvg180: 24 }) })
    );
    expect(out.action).toBe('HOLD');
    expect(out.diagnosis).toBe('EXIT');
    expect(out.needsReview).toBe(true);
  });

  it('holds when already at/below the reference (never increases)', () => {
    const out = computeTarget(amazon({ currentPrice: 23.99, amazonMarket: competitorMarket() }));
    expect(out.action).toBe('HOLD');
  });

  it('tier-2 escalation: applied match ran 20d+, box not won → undercut stable by 10%', () => {
    const appliedAt = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
    const out = computeTarget(
      amazon({
        currentPrice: 24.49,
        amazonMarket: competitorMarket({ lastAppliedMatch: { price: 24.49, appliedAt } }),
      })
    );
    // 24 * 0.9 = 21.6 → charm 21.49
    expect(out.action).toBe('REPRICE');
    expect(out.targetPrice).toBe(21.49);
    expect(out.markdownStep).toBe(2);
  });

  it('no escalation while the match is still recent', () => {
    const appliedAt = new Date(Date.now() - 5 * 86400 * 1000).toISOString();
    const out = computeTarget(
      amazon({
        currentPrice: 24.49,
        amazonMarket: competitorMarket({ lastAppliedMatch: { price: 24.49, appliedAt } }),
      })
    );
    expect(out.action).toBe('HOLD');
  });

  it('holds with no market context at all', () => {
    const out = computeTarget(amazon({ amazonMarket: null }));
    expect(out.action).toBe('HOLD');
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

  it('views-per-day judged over the analytics window, not full listing age', () => {
    // 300d old with 50 views in the (max 89d) analytics window:
    // 50/89 = 0.56/day → not COLD even with 0 watchers.
    const out = computeTarget(
      base({ currentPrice: 20, watchers: 0, views: 50, ageDays: 300, condition: 'new', cost: 2 })
    );
    // deep age still routes to auction at >=150d, but the tier must not be COLD
    expect(out.tier).not.toBe('COLD');
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

  it('applies the deeper of tier vs aging-step reduction (WARM past step2)', () => {
    // WARM (watchers>=2, viewsPerDay>=1) → tier 5%, but age>=step2 → step2 reduction 10%.
    // max(5,10)=10% → 20 * 0.90 = 18 → charm 17.99
    const out = computeTarget(
      base({ currentPrice: 20, watchers: 3, views: 150, ageDays: 100, condition: 'new', cost: 2 })
    );
    expect(out.tier).toBe('WARM');
    expect(out.targetPrice).toBe(17.99);
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
