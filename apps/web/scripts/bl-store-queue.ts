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
  // Set skipUntil based on verdict so the picker doesn't immediately re-pick the same store.
  const now = Date.now();
  const days = (n: number) => new Date(now + n * 86400_000).toISOString();
  switch (verdict) {
    case 'priced_above_market': entry.skipUntil = days(60); break;
    case 'low_priority':        entry.skipUntil = days(30); break;
    case 'promising':           entry.skipUntil = days(7);  break;  // re-screen weekly to refresh STR/avg
    case 'insufficient_data':   entry.skipUntil = days(14); break;
    case 'errored':             entry.skipUntil = days(3);  break;
  }
}

/**
 * Composite "staleness prior" for a never-screened store.
 *
 * Higher score = pick sooner. Designed so a stale-but-established UK store with old activity
 * outranks a brand-new tiny one, but the picker still gets to brand-new stores eventually.
 *
 * Components (sum):
 *   +1 to +5  per year since lastActivityAt (capped at 5 — no lastActivityAt = +0)
 *   +1.0      if lotsCount >= 1000
 *   +0.5      if lotsCount >= 500
 *   +0.5      if feedbackCount >= 100
 *   +0.5      if hasUkDomesticShipping !== false
 *   −2.0      if hasUkDomesticShipping === false (BL classifies as international)
 *   ±0.0      no metadata at all → score 0, ranked equally with others
 */
export function stalenessScore(entry: QueueEntry, now: Date = new Date()): number {
  const m = entry.blMetadata;
  if (!m) return 0;
  let score = 0;
  if (m.lastActivityAt) {
    const ageMs = now.getTime() - new Date(m.lastActivityAt).getTime();
    const years = Math.max(0, ageMs / (365 * 86400_000));
    score += Math.min(5, years);
  }
  if (m.lotsCount && m.lotsCount >= 1000) score += 1.0;
  else if (m.lotsCount && m.lotsCount >= 500) score += 0.5;
  if (m.feedbackCount && m.feedbackCount >= 100) score += 0.5;
  if (m.hasUkDomesticShipping === false) score -= 2.0;
  else if (m.hasUkDomesticShipping === true) score += 0.5;
  return score;
}

/**
 * Pick the next store to screen.
 *
 * Tier 1 (never-screened): rank by stalenessScore(entry) descending; tiebreak by oldest addedAt.
 * Tier 2 (past skipUntil):  oldest lastScreenedAt first.
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

  // Tier 1: never-screened. Sort by staleness score desc, then by addedAt asc.
  const fresh = eligible.filter((s) => s.lastScreenedAt === null);
  if (fresh.length > 0) {
    fresh.sort((a, b) => {
      const sa = stalenessScore(a, now), sb = stalenessScore(b, now);
      if (sa !== sb) return sb - sa;
      return a.addedAt.localeCompare(b.addedAt);
    });
    return fresh[0];
  }

  // Tier 2: oldest screened first.
  const screened = eligible.slice().sort((a, b) => (a.lastScreenedAt ?? '').localeCompare(b.lastScreenedAt ?? ''));
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
