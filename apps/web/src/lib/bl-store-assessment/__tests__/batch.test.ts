import { describe, it, expect } from 'vitest';
import { planSweep, classifyDelta, ALERT_RULES, type WatchlistCandidate, type RunSnapshot } from '../batch';

const NOW = new Date('2026-07-10T02:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86400000).toISOString();

const cand = (slug: string, lastScannedAt: string | null): WatchlistCandidate =>
  ({ storeSlug: slug, storeName: null, lastScannedAt });

describe('planSweep', () => {
  const candidates = [
    cand('fresh-store', daysAgo(1)),      // scanned yesterday — skipped
    cand('stale-store', daysAgo(20)),
    cand('staler-store', daysAgo(40)),
    cand('never-b', null),
    cand('never-a', null),
    cand('borderline', daysAgo(5.1)),
  ];

  it('skips recently-scanned stores entirely', () => {
    const plan = planSweep(candidates, { budget: 10, minAgeDays: 5, now: NOW });
    expect(plan.map((p) => p.storeSlug)).not.toContain('fresh-store');
    expect(plan).toHaveLength(5);
  });

  it('orders never-assessed first, then stalest-first, and honours the budget', () => {
    const plan = planSweep(candidates, { budget: 3, minAgeDays: 5, now: NOW });
    expect(plan.map((p) => p.storeSlug)).toEqual(['never-a', 'never-b', 'staler-store']);
  });
});

const snap = (p: Partial<RunSnapshot>): RunSnapshot => ({
  grade: 50, verdict: 'REVIEW', buyableLots: 20, buyableNetGbp: 50,
  buyableFreshLots: 10, medianAskVsMarket: 1.0, totalValue: 500, ...p,
});

describe('classifyDelta', () => {
  it('always cards a BUY verdict', () => {
    const alerts = classifyDelta(snap({ verdict: 'BUY', grade: 70 }), snap({}));
    expect(alerts.map((a) => a.kind)).toContain('BUY_VERDICT');
  });

  it('cards a promising first assessment, stays quiet on a weak one', () => {
    expect(classifyDelta(snap({ buyableNetGbp: ALERT_RULES.newStoreNetGbp }), null).map((a) => a.kind)).toContain('NEW_STORE');
    expect(classifyDelta(snap({ buyableNetGbp: ALERT_RULES.newStoreNetGbp - 1 }), null)).toHaveLength(0);
  });

  it('cards a net jump over the threshold, not under it', () => {
    const prev = snap({ buyableNetGbp: 40 });
    expect(classifyDelta(snap({ buyableNetGbp: 40 + ALERT_RULES.netJumpGbp }), prev).map((a) => a.kind)).toContain('NET_JUMP');
    expect(classifyDelta(snap({ buyableNetGbp: 40 + ALERT_RULES.netJumpGbp - 1 }), prev)).toHaveLength(0);
  });

  it('cards a price drop — the motivated-seller moment', () => {
    const prev = snap({ medianAskVsMarket: 1.25 });
    const alerts = classifyDelta(snap({ medianAskVsMarket: 1.25 - ALERT_RULES.priceDrop }), prev);
    expect(alerts.map((a) => a.kind)).toContain('PRICE_DROP');
  });

  it('is quiet when nothing changed', () => {
    expect(classifyDelta(snap({}), snap({}))).toHaveLength(0);
  });
});
