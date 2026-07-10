/**
 * Nightly batch sweep — pure planning + delta logic (BL Arbitrage "assess" lens, phase 2).
 *
 * The batch CLI (scripts/store-assessment-batch.ts) reads the watchlist and the
 * assessment history, then uses these helpers to decide WHICH stores to scan tonight
 * and WHAT is alert-worthy afterwards. Pure functions — no IO — so the selection and
 * alert rules are unit-tested without a database.
 */

export interface WatchlistCandidate {
  storeSlug: string;
  storeName: string | null;
  /** Latest store_assessments.scanned_at for this slug, null = never assessed. */
  lastScannedAt: string | null;
  /** Verdict of that latest assessment — drives the re-check cadence. */
  lastVerdict: string | null;
}

/**
 * Re-check cadence by last verdict. BUY/REVIEW stores come round monthly (Chris,
 * 2026-07-10 — a week was too hot); SKIPs every two months still catch repricing
 * events. With ~1,400 England stores mostly SKIP, steady state is ~23 stores/night
 * — inside the default budget of 25, so the sweep never has to rush.
 */
export const CADENCE_DAYS: Record<string, number> = {
  BUY: 30,
  REVIEW: 30,
  SKIP: 60,
};
/** Assessed but verdict missing/unknown (old rows, errors). */
export const DEFAULT_CADENCE_DAYS = 30;

export interface SweepPlanInputs {
  /** Max stores to scan tonight. */
  budget: number;
  /** Hard floor — never re-scan a store within this many days, whatever its cadence. */
  minAgeDays: number;
  now: Date;
}

/**
 * Pick tonight's stores. Never-assessed first (discovery beats refresh, in slug
 * order for a stable rotation), then assessed stores whose verdict-based cadence
 * has lapsed, most-overdue first.
 */
export function planSweep(candidates: WatchlistCandidate[], inp: SweepPlanInputs): WatchlistCandidate[] {
  const nowMs = inp.now.getTime();
  const dueAtMs = (c: WatchlistCandidate): number => {
    const last = Date.parse(c.lastScannedAt!);
    const cadence = CADENCE_DAYS[c.lastVerdict ?? ''] ?? DEFAULT_CADENCE_DAYS;
    return last + Math.max(cadence, inp.minAgeDays) * 86400000;
  };
  const eligible = candidates.filter((c) => c.lastScannedAt == null || dueAtMs(c) <= nowMs);
  return eligible
    .sort((a, b) => {
      if (a.lastScannedAt == null && b.lastScannedAt == null) return a.storeSlug.localeCompare(b.storeSlug);
      if (a.lastScannedAt == null) return -1;
      if (b.lastScannedAt == null) return 1;
      return dueAtMs(a) - dueAtMs(b); // most overdue first
    })
    .slice(0, inp.budget);
}

// ---- delta / alert rules ---------------------------------------------------

/** The headline numbers we compare run-over-run. */
export interface RunSnapshot {
  grade: number | null;
  verdict: string | null;
  buyableLots: number | null;
  buyableNetGbp: number | null;
  buyableFreshLots: number | null;
  medianAskVsMarket: number | null;
  totalValue: number | null;
}

export interface DeltaAlert {
  kind: 'BUY_VERDICT' | 'NET_JUMP' | 'PRICE_DROP' | 'NEW_STORE';
  headline: string;
}

/** Alert thresholds — a card is only worth sending when it changes what you'd do. */
export const ALERT_RULES = {
  /** £ increase in buyable net vs the previous run that warrants a card. */
  netJumpGbp: 20,
  /** Drop in weighted-median ask-vs-market (e.g. 1.22 → 1.10 = 0.12) that reads as a repricing event. */
  priceDrop: 0.10,
  /** First-ever assessment with at least this much buyable net gets a card. */
  newStoreNetGbp: 30,
} as const;

const gbp = (n: number) => `£${n.toFixed(2)}`;

/**
 * Compare tonight's run against the previous one (null = first assessment).
 * Returns every rule that fired, most important first; empty = nothing card-worthy.
 */
export function classifyDelta(current: RunSnapshot, previous: RunSnapshot | null): DeltaAlert[] {
  const alerts: DeltaAlert[] = [];
  const net = current.buyableNetGbp ?? 0;

  if (current.verdict === 'BUY') {
    alerts.push({ kind: 'BUY_VERDICT', headline: `BUY verdict — grade ${current.grade ?? '?'}, ${gbp(net)} across ${current.buyableLots ?? 0} buyable lots` });
  }
  if (previous == null) {
    if (net >= ALERT_RULES.newStoreNetGbp) {
      alerts.push({ kind: 'NEW_STORE', headline: `First assessment — ${gbp(net)} buyable net (${current.buyableFreshLots ?? '?'} fresh lots)` });
    }
    return alerts;
  }
  const prevNet = previous.buyableNetGbp ?? 0;
  if (net - prevNet >= ALERT_RULES.netJumpGbp) {
    alerts.push({ kind: 'NET_JUMP', headline: `Buyable net ${gbp(prevNet)} → ${gbp(net)} (+${gbp(net - prevNet)})` });
  }
  if (
    current.medianAskVsMarket != null && previous.medianAskVsMarket != null &&
    previous.medianAskVsMarket - current.medianAskVsMarket >= ALERT_RULES.priceDrop
  ) {
    alerts.push({
      kind: 'PRICE_DROP',
      headline: `Prices ${Math.round(previous.medianAskVsMarket * 100)}% → ${Math.round(current.medianAskVsMarket * 100)}% of market — possible repricing/motivated seller`,
    });
  }
  return alerts;
}
