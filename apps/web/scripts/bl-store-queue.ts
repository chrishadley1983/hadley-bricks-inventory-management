/**
 * BL store discovery queue — JSON-backed file at tmp/bl-store-queue.json.
 *
 * Tracks UK BL stores we've discovered (manually, via buy-page candidates during cart builds, or
 * from a seller-list scrape) and the screening history. The proactive daily runner picks the next
 * store to evaluate based on staleness and verdict.
 *
 * Why JSON file rather than a Supabase table:
 *   - keeps proactive workflow self-contained on the workstation
 *   - simple to inspect / hand-edit
 *   - no migration needed to ship
 *   - the queue is NOT critical state — losing it costs only re-discovery, not money
 *
 * If we later want it queryable from the dashboard, copy to a Supabase table — schema is flat.
 */
import * as fs from 'fs';
import * as path from 'path';

export type ScreenVerdict = 'promising' | 'low_priority' | 'priced_above_market' | 'insufficient_data' | 'errored';
export type DiscoverySource = 'manual' | 'buy-page' | 'seller-list';

export interface QueueEntry {
  slug: string;
  /** May be null until first screen run. */
  storeName?: string | null;
  storeId?: number | null;
  country?: string | null;
  addedAt: string;
  addedFrom: DiscoverySource;
  /** ISO timestamp of last screen run. */
  lastScreenedAt: string | null;
  /** Latest verdict — drives next-pick priority. */
  lastVerdict: ScreenVerdict | null;
  /** Most recent screen summary (median, p25/p75, bombs). Lightweight. */
  lastScreenSummary?: {
    cacheCovered: number;
    medianRatio: number | null;
    bargainBombs: number;
    inventoryCount: number;
  } | null;
  /** Optional skip-until ISO timestamp (e.g. for priced_above_market — recheck in 60d). */
  skipUntil?: string | null;
  /** Number of times screened. */
  screenCount: number;
  /** BL profile metadata captured during seed/enrich for staleness prior in pickNext. */
  blMetadata?: {
    lotsCount?: number;
    feedbackCount?: number;
    /** ISO timestamp of seller's last visible activity (last login, last listing change). null = unknown. */
    lastActivityAt?: string | null;
    /** True if seller has UK domestic shipping configured. */
    hasUkDomesticShipping?: boolean | null;
    /** ISO timestamp when this metadata was captured. */
    capturedAt?: string;
  };
}

export interface Queue {
  version: 1;
  stores: QueueEntry[];
}

const DEFAULT_QUEUE_PATH = path.resolve(__dirname, '../../../tmp/bl-store-queue.json');

export function loadQueue(filePath: string = DEFAULT_QUEUE_PATH): Queue {
  if (!fs.existsSync(filePath)) return { version: 1, stores: [] };
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Queue; }
  catch { return { version: 1, stores: [] }; }
}

export function saveQueue(queue: Queue, filePath: string = DEFAULT_QUEUE_PATH): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(queue, null, 2));
}

/** Idempotently add a candidate store. Returns true if newly added, false if already in queue. */
export function addCandidate(queue: Queue, slug: string, source: DiscoverySource, opts: { storeId?: number; storeName?: string; country?: string } = {}): boolean {
  if (!slug || !slug.trim()) return false;
  const existing = queue.stores.find((s) => s.slug.toLowerCase() === slug.toLowerCase());
  if (existing) {
    // If we have richer info now (storeId, country), backfill silently.
    if (opts.storeId && !existing.storeId) existing.storeId = opts.storeId;
    if (opts.storeName && !existing.storeName) existing.storeName = opts.storeName;
    if (opts.country && !existing.country) existing.country = opts.country;
    return false;
  }
  queue.stores.push({
    slug,
    storeName: opts.storeName ?? null,
    storeId: opts.storeId ?? null,
    country: opts.country ?? null,
    addedAt: new Date().toISOString(),
    addedFrom: source,
    lastScreenedAt: null,
    lastVerdict: null,
    lastScreenSummary: null,
    skipUntil: null,
    screenCount: 0,
  });
  return true;
}

export function markScreened(queue: Queue, slug: string, verdict: ScreenVerdict, summary: QueueEntry['lastScreenSummary'], opts: { storeName?: string; storeId?: number; country?: string } = {}): void {
  const entry = queue.stores.find((s) => s.slug.toLowerCase() === slug.toLowerCase());
  if (!entry) return;
  entry.lastScreenedAt = new Date().toISOString();
  entry.lastVerdict = verdict;
  entry.lastScreenSummary = summary;
  entry.screenCount = (entry.screenCount || 0) + 1;
  if (opts.storeName && !entry.storeName) entry.storeName = opts.storeName;
  if (opts.storeId && !entry.storeId) entry.storeId = opts.storeId;
  if (opts.country && !entry.country) entry.country = opts.country;
  // Set skipUntil based on verdict so the picker doesn't immediately re-pick.
  // Insufficient_data window is now adaptive to cache coverage: stores with very low overlap
  // (rare inventory we don't see often) are unlikely to flip soon, so defer them longer.
  const now = Date.now();
  const days = (n: number) => new Date(now + n * 86400_000).toISOString();
  switch (verdict) {
    case 'priced_above_market': entry.skipUntil = days(60); break;
    case 'low_priority':        entry.skipUntil = days(30); break;
    case 'promising':           entry.skipUntil = days(7);  break;
    case 'insufficient_data': {
      const cc = summary?.cacheCovered ?? 0;
      if (cc < 10)      entry.skipUntil = days(90);   // rare-inventory store, won't flip soon
      else if (cc < 20) entry.skipUntil = days(45);   // borderline — give cache time to grow
      else              entry.skipUntil = days(14);   // close to threshold — re-check sooner
      break;
    }
    case 'errored':             entry.skipUntil = days(3);  break;
  }
}

/**
 * Composite "pick prior" for queue ordering.
 *
 * Higher score = pick sooner. Tuned 2026-04-28 after a 41-store empirical run:
 * dormant stores returned 0/26 promising (mostly insufficient_data due to thin
 * cache overlap, or dormant-PREMIUM with prices above market). The two known
 * promising stores were ACTIVE, not dormant. So dormancy got dropped as a
 * positive signal, and a cache-density prior was added to favour stores whose
 * previous screen had real overlap (= they stock the popular parts our cache
 * knows about).
 *
 * Components (sum):
 *   Inventory depth (more lots = more chances of pricing drift in the tail):
 *     +1.0  lotsCount >= 1000
 *     +0.5  lotsCount 500-999
 *
 *   Established seller (low risk, has track record):
 *     +0.5  feedbackCount >= 100
 *
 *   UK shipping config (avoid international-only stores — friction at checkout):
 *     +0.5  hasUkDomesticShipping === true
 *     -2.0  hasUkDomesticShipping === false
 *
 *   Cache-density prior (re-screen tier — only applies post-first-screen):
 *     +2.0  previous cacheCovered >= 100   (high overlap → reliable verdict)
 *     +1.0  previous cacheCovered 30-99    (decent overlap)
 *     -1.0  previous cacheCovered < 10     (rare-inventory store — defer)
 *
 *   Light activity penalty (drop dormancy boost; mildly prefer active stores):
 *     -0.5  lastActivityAt > 365 days ago
 *
 *   No metadata at all → score 0 (still picked, just last in tier).
 */
export function stalenessScore(entry: QueueEntry, now: Date = new Date()): number {
  const m = entry.blMetadata;
  if (!m) return 0;
  let score = 0;
  if (m.lotsCount && m.lotsCount >= 1000) score += 1.0;
  else if (m.lotsCount && m.lotsCount >= 500) score += 0.5;
  if (m.feedbackCount && m.feedbackCount >= 100) score += 0.5;
  if (m.hasUkDomesticShipping === false) score -= 2.0;
  else if (m.hasUkDomesticShipping === true) score += 0.5;

  // Cache-density prior — only meaningful after a previous screen.
  const cc = entry.lastScreenSummary?.cacheCovered;
  if (cc !== undefined && cc !== null) {
    if (cc >= 100) score += 2.0;
    else if (cc >= 30) score += 1.0;
    else if (cc < 10) score -= 1.0;
  }

  // Mild dormancy penalty (active stores were the empirically promising ones).
  if (m.lastActivityAt) {
    const ageDays = (now.getTime() - new Date(m.lastActivityAt).getTime()) / 86400_000;
    if (ageDays > 365) score -= 0.5;
  }

  return score;
}

/**
 * Pick the next store to screen.
 *
 * Tier 1 (never-screened): rank by stalenessScore desc; tiebreak by oldest addedAt.
 * Tier 2 (past skipUntil):  rank by stalenessScore desc (cache-density prior matters here);
 *                           tiebreak by oldest lastScreenedAt first.
 * Returns null if nothing eligible.
 */
export function pickNext(queue: Queue, opts: { now?: Date } = {}): QueueEntry | null {
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const eligible = queue.stores.filter((s) => {
    if (s.lastScreenedAt === null) return true;
    return !s.skipUntil || s.skipUntil <= nowIso;
  });
  if (eligible.length === 0) return null;

  // Tier 1: never-screened.
  const fresh = eligible.filter((s) => s.lastScreenedAt === null);
  if (fresh.length > 0) {
    fresh.sort((a, b) => {
      const sa = stalenessScore(a, now), sb = stalenessScore(b, now);
      if (sa !== sb) return sb - sa;
      return a.addedAt.localeCompare(b.addedAt);
    });
    return fresh[0];
  }

  // Tier 2: past-skipUntil. Use stalenessScore (which now includes cache-density prior)
  // as primary sort so high-overlap stores cycle faster.
  const screened = eligible.slice().sort((a, b) => {
    const sa = stalenessScore(a, now), sb = stalenessScore(b, now);
    if (sa !== sb) return sb - sa;
    return (a.lastScreenedAt ?? '').localeCompare(b.lastScreenedAt ?? '');
  });
  return screened[0];
}

/** CLI: print queue summary when run directly. */
if (require.main === module) {
  const q = loadQueue();
  console.log(`Queue: ${q.stores.length} stores`);
  const byVerdict = q.stores.reduce<Record<string, number>>((acc, s) => { const k = s.lastVerdict ?? 'pending'; acc[k] = (acc[k] || 0) + 1; return acc; }, {});
  for (const [k, v] of Object.entries(byVerdict)) console.log(`  ${k}: ${v}`);
  const next = pickNext(q);
  if (next) console.log(`\nNext to screen: ${next.slug} (added ${next.addedAt.slice(0, 10)}, ${next.lastScreenedAt ? 'last screened ' + next.lastScreenedAt.slice(0, 10) : 'never screened'})`);
  else console.log('\nNo eligible stores — queue empty or all in skipUntil window.');
}
