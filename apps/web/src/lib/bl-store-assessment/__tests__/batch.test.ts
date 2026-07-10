import { describe, it, expect } from 'vitest';
import { planSweep, classifyDelta, ALERT_RULES, CADENCE_DAYS, type WatchlistCandidate, type RunSnapshot } from '../batch';

const NOW = new Date('2026-07-10T02:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86400000).toISOString();

const cand = (slug: string, lastScannedAt: string | null, lastVerdict: string | null = null): WatchlistCandidate =>
  ({ storeSlug: slug, storeName: null, lastScannedAt, lastVerdict });

describe('planSweep (verdict-tiered cadence)', () => {
  it('never-assessed stores come first, in slug order, honouring the budget', () => {
    const plan = planSweep(
      [cand('never-b', null), cand('due-skip', daysAgo(90), 'SKIP'), cand('never-a', null)],
      { budget: 2, minAgeDays: 5, now: NOW },
    );
    expect(plan.map((p) => p.storeSlug)).toEqual(['never-a', 'never-b']);
  });

  it('re-checks each verdict on its own cadence', () => {
    const candidates = [
      cand('buy-due', daysAgo(CADENCE_DAYS.BUY + 1), 'BUY'),
      cand('buy-not-due', daysAgo(CADENCE_DAYS.BUY - 1), 'BUY'),
      cand('review-due', daysAgo(CADENCE_DAYS.REVIEW + 1), 'REVIEW'),
      cand('review-not-due', daysAgo(CADENCE_DAYS.REVIEW - 1), 'REVIEW'),
      cand('skip-due', daysAgo(CADENCE_DAYS.SKIP + 1), 'SKIP'),
      cand('skip-not-due', daysAgo(CADENCE_DAYS.SKIP - 5), 'SKIP'),
    ];
    const plan = planSweep(candidates, { budget: 10, minAgeDays: 5, now: NOW }).map((p) => p.storeSlug);
    expect(plan).toEqual(expect.arrayContaining(['buy-due', 'review-due', 'skip-due']));
    expect(plan).not.toContain('buy-not-due');
    expect(plan).not.toContain('review-not-due');
    expect(plan).not.toContain('skip-not-due');
  });

  it('orders assessed stores most-overdue first', () => {
    const plan = planSweep(
      [
        cand('skip-barely-due', daysAgo(CADENCE_DAYS.SKIP + 1), 'SKIP'),   // 1d overdue
        cand('buy-very-overdue', daysAgo(CADENCE_DAYS.BUY + 30), 'BUY'),   // 30d overdue
      ],
      { budget: 10, minAgeDays: 5, now: NOW },
    );
    expect(plan.map((p) => p.storeSlug)).toEqual(['buy-very-overdue', 'skip-barely-due']);
  });

  it('minAgeDays is a hard floor even for BUY stores', () => {
    // BUY cadence 7d, but minAgeDays 10 → a 8d-old BUY store is NOT due.
    const plan = planSweep([cand('buy-8d', daysAgo(8), 'BUY')], { budget: 10, minAgeDays: 10, now: NOW });
    expect(plan).toHaveLength(0);
  });

  it('unknown verdicts fall back to the default cadence', () => {
    const plan = planSweep(
      [cand('odd-due', daysAgo(31), null), cand('odd-not-due', daysAgo(29), null)],
      { budget: 10, minAgeDays: 5, now: NOW },
    );
    expect(plan.map((p) => p.storeSlug)).toEqual(['odd-due']);
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
