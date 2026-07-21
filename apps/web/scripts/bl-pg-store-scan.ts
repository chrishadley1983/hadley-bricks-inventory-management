/**
 * BrickLink store scanner powered by catalogPG PAGE scrapes (no BL API calls).
 *
 * Scans a UK seller's full inventory, enriches every unique (item, colour) against
 * BL's price-guide pages via CDP navigation (UK-only figures from native-GBP rows —
 * validated to exactly reproduce the API's country_code=UK guides), scores each lot
 * with the Bricqer pricing formula, and writes a detailed, actionable markdown report.
 *
 * Data paths:
 *   - rich cache:  bricklink_price_guide_cache   (median, monthly velocity, worldwide)
 *     — the unified price cache; all consumers (bl-basket etc.) read it via readPriceGuide
 *
 * The cache IS the resume mechanism: every scraped page is upserted in batches, so an
 * interrupted run re-uses everything on the next invocation.
 *
 * Usage (from apps/web, with the GBP-display BL session on the CDP port):
 *   npx tsx scripts/bl-pg-store-scan.ts --store-slug=Gibbo0o
 *
 * Flags:
 *   --store-slug=<name>      REQUIRED — BL store URL slug
 *   --cdp-port=<n>           Chrome CDP port (default 9225)
 *   --shipping=<gbp>         Inbound postage estimate for allocation (default 3.00)
 *   --min-ask=<gbp>          Economy dial, NOT a visibility filter (default 0). List price is
 *                            bricqerListPrice(soldAvg, cond, str) — the store floor already
 *                            backstops it, and a cheap ask can be profitable when its UK 6MA
 *                            supports a higher list. Raise this only to skip scrape/cache/score
 *                            work on sub-threshold asks, never to hide otherwise-profitable lots.
 *   --enrich-min-ask=<gbp>   BROWSER-SCRAPE gate (default 0.10): a tuple only gets a live PgScraper
 *                            navigation if ≥1 of its lots asks at/above this. Cache reads (getFresh)
 *                            are unaffected — cache hits stay free for every tuple regardless of ask.
 *   --min-margin=<pct>       Buy-list gate on net/list margin (default 0.20)
 *   --min-str=<ratio>        Buy-list gate on UK sell-through (default 0)
 *   --cache-ttl-days=<n>     UK-detail (L3) read window (default 45 — Chris 2026-07-08:
 *                            "use the best type available"; stale-but-UK beats fresh-worldwide
 *                            for pricing, and the 60-day refresh cycle keeps active tuples
 *                            well inside this window. Buy candidates get a live UK check
 *                            before purchase regardless, so the window is triage-safe.
 *                            Revisit if the cycle's freshness ratio slips — see the digest)
 *   --inventory-ttl-hours=<n> Reuse cached store scrape if younger (default 24)
 *   --force-rescrape         Ignore cached store inventory
 *   --max-pages=<n>          AJAX pages per item type (default 500 — no truncation; set low only to probe)
 *   --page-delay-ms=<n>      Between AJAX pages (default 3000, floor 3000)
 *   --nav-delay-ms=<n>       Base delay between PG navigations (default 4000; +0-2s jitter)
 *   --limit-tuples=<n>       Cap PG pages this run (0 = all; partial runs resume via cache)
 *   --report-file=<path>     Override report output path
 *
 * Safety rails (same discipline as bl-basket / POV): 3s AJAX floor, jittered PG
 * navigations, stop on captcha/login immediately, one 60s breather then abort on
 * repeated blocks, single tab, no retry loops.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import WebSocket from 'ws';
import {
  PgScraper,
  PgBlockError,
  PgCaptchaError,
  PgLoginError,
  PgCurrencyError,
  PgNotFoundError,
  PgNoDataError,
  isPgCdpReachable,
  type PgItemRef,
  type PgItemType,
  type PgScrapeResult,
  computeSideStats,
} from '../src/lib/bricklink/price-guide-page';
import {
  PriceGuideCacheService,
  pgCacheKey,
  type PgCacheRow,
  toPgCacheRow,
} from '../src/lib/bricklink/price-guide-cache.service';
import { bricqerMultiplier, bricqerListPrice, BRICQER_PRICE_FLOOR } from '../src/lib/bricklink/bricqer-pricing';
import { cycleDaysForTier } from '../src/lib/bricklink/pg-cycle-policy';
import { isIncompleteSetListing } from '../src/lib/bricklink/listing-completeness';
import { PartOutValueCacheService } from '../src/lib/bricklink/part-out-value-cache.service';
import { parseSetNumber, resolvePovOptions } from '../src/lib/bricklink/part-out-value';
import { captureFraction } from '../src/lib/bricklink/liquidity-pov';
import { buildBasketDecisionReport, renderDecisionMd } from '../src/lib/bl-store-report';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2).reduce<Record<string, string>>((acc, a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  acc[k] = v ?? 'true';
  return acc;
}, {});

const STORE_SLUG = argv['store-slug'];
if (!STORE_SLUG) {
  console.error('Required: --store-slug=<name>');
  process.exit(1);
}
const CDP_PORT = parseInt(argv['cdp-port'] ?? '9225', 10);
const SHIPPING = parseFloat(argv['shipping'] ?? '3.00');
const MIN_ASK = parseFloat(argv['min-ask'] ?? '0');
const ENRICH_MIN_ASK = parseFloat(argv['enrich-min-ask'] ?? '0.10');
const MIN_MARGIN = parseFloat(argv['min-margin'] ?? '0.20');
const MIN_STR = parseFloat(argv['min-str'] ?? '0');
const CACHE_TTL_DAYS = parseFloat(argv['cache-ttl-days'] ?? '45');
const INVENTORY_TTL_HOURS = parseFloat(argv['inventory-ttl-hours'] ?? '24');
const FORCE_RESCRAPE = argv['force-rescrape'] === 'true';
// No-truncation default (Chris 2026-07-21): the old 50-page (5,000-part) default silently
// truncated large stores, producing a partial pg-scan-inventory.json that reads as complete
// and poisons downstream coverage/gap math. Match store-assessment's 500-page ceiling so a
// realistic store is never capped. Lower it explicitly with --max-pages only for a quick probe.
const MAX_PAGES = Math.min(500, parseInt(argv['max-pages'] ?? '500', 10));
const PAGE_DELAY_MS = Math.max(3000, parseInt(argv['page-delay-ms'] ?? '3000', 10));
const NAV_DELAY_MS = Math.max(2500, parseInt(argv['nav-delay-ms'] ?? '4000', 10));
const LIMIT_TUPLES = parseInt(argv['limit-tuples'] ?? '0', 10);

// Fee model — canonical home is src/lib/bricklink/fees.ts (BL 3% + Bricqer 3.5% + PayPal 2.9%).
import { VAR_FEE_PCT } from '../src/lib/bricklink/fees';
// Personal velocity baseline (see bl-basket): 10% lot turnover per month.
const PERSONAL_MONTHLY_LOT_RATE = 0.10;

const OUT_DIR = path.resolve(__dirname, `../../../tmp/stores/${STORE_SLUG}`);
const INVENTORY_FILE = path.join(OUT_DIR, 'pg-scan-inventory.json');
const REPORT_FILE = argv['report-file'] ?? path.join(OUT_DIR, `pg-scan-report-${new Date().toISOString().slice(0, 10)}.md`);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase env (.env.local)');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);
const cacheService = new PriceGuideCacheService(supabase);
const povCacheService = new PartOutValueCacheService(supabase);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Damage-note + boilerplate filters (same logic as bl-basket)
// ---------------------------------------------------------------------------

const DAMAGE_KEYWORDS = new Set([
  'dent', 'dents', 'scratch', 'scratches', 'scratched', 'crack', 'cracks', 'cracked',
  'chip', 'chipped', 'chips', 'damage', 'damaged', 'damages', 'fade', 'faded',
  'yellow', 'yellowed', 'yellowing', 'marked', 'marks', 'broken', 'bent',
  'tear', 'torn', 'sticky', 'cloudy', 'scuffed', 'scuff', 'worn',
  'discolour', 'discoloured', 'discolor', 'discolored', 'bitten', 'warped', 'flaw', 'flawed',
]);
const NEGATION_PREFIXES: string[][] = [['no'], ['without'], ['not'], ['free', 'of'], ['free', 'from'], ['zero']];
const BOILERPLATE_PCT = 0.03;
const BOILERPLATE_DESCRIPTIONS = new Set<string>();

function computeBoilerplate(items: { description: string | null }[]): { boilerplateCount: number; itemsCovered: number } {
  BOILERPLATE_DESCRIPTIONS.clear();
  const counts = new Map<string, number>();
  for (const it of items) {
    const d = (it.description ?? '').trim();
    if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const minOccur = Math.max(2, Math.ceil(items.length * BOILERPLATE_PCT));
  let covered = 0;
  for (const [desc, n] of counts) {
    if (n >= minOccur) {
      BOILERPLATE_DESCRIPTIONS.add(desc);
      covered += n;
    }
  }
  return { boilerplateCount: BOILERPLATE_DESCRIPTIONS.size, itemsCovered: covered };
}

function hasDamageNote(desc: string | null | undefined): boolean {
  if (!desc) return false;
  if (BOILERPLATE_DESCRIPTIONS.has(desc.trim())) return false;
  const cleaned = desc.toLowerCase().replace(/[-–—,;:()/]/g, ' ').replace(/[.!?"']/g, '').replace(/\s+/g, ' ').trim();
  const words = cleaned.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    if (!DAMAGE_KEYWORDS.has(words[i])) continue;
    let negated = false;
    for (const neg of NEGATION_PREFIXES) {
      const start = i - neg.length;
      if (start < 0) continue;
      let match = true;
      for (let k = 0; k < neg.length; k++) if (words[start + k] !== neg[k]) { match = false; break; }
      if (match) { negated = true; break; }
    }
    if (!negated && i + 1 < words.length && words[i + 1] === 'free') negated = true;
    if (!negated) return true;
  }
  return false;
}

// Bricqer auto-pricing — canonical implementation imported from
// src/lib/bricklink/bricqer-pricing.ts (v4, 2026-07-17: U STR>=1.5 → 1.90 + £0.0399 floor).

// ---------------------------------------------------------------------------
// Store inventory scrape (paced AJAX via CDP, mirrors bl-basket phase 2)
// ---------------------------------------------------------------------------

interface StoreLot {
  invID: number;
  itemType: PgItemType;
  /** For type='S', already folded to the recovered "<base>-<seq>" catalog identity when
   * itemSeq>1 (variant-ID recovery, Chris 2026-07-08) — see scrapeInventory. Bare for the
   * base set (seq=1, matches normaliseSetNo's default) and for P/M (seq is 0, irrelevant —
   * their itemNo from BL's AJAX is already fully specific, e.g. "col139"). */
  itemNo: string;
  /** Raw BL AJAX itemSeq. 0 for P/M. For S: 1 = base/main set, >1 = the catalog "-<seq>"
   * variant BL actually assigned this lot (advent-day build, gift-with-purchase, etc.) —
   * already folded into itemNo above; kept here for diagnostics/report counts. */
  itemSeq: number;
  colourId: number;
  colourName: string | null;
  itemName: string;
  cond: 'N' | 'U';
  qty: number;
  ask: number;
  description: string | null;
  invComplete: string | null;
}

class StoreCdp {
  private ws!: WebSocket;
  private msgId = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private sessionId!: string;
  private targetId!: string;

  async open(): Promise<void> {
    const ver = (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then((r) => r.json())) as { webSocketDebuggerUrl: string };
    this.ws = new WebSocket(ver.webSocketDebuggerUrl);
    await new Promise<void>((res, rej) => { this.ws.once('open', () => res()); this.ws.once('error', rej); });
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as { id?: number; result?: unknown; error?: { message: string } };
      if (m.id && this.pending.has(m.id)) {
        const h = this.pending.get(m.id)!;
        this.pending.delete(m.id);
        if (m.error) h.reject(new Error(m.error.message));
        else h.resolve(m.result);
      }
    });
    const tgt = (await this.send('Target.createTarget', { url: 'about:blank' })) as { targetId: string };
    this.targetId = tgt.targetId;
    const att = (await this.send('Target.attachToTarget', { targetId: this.targetId, flatten: true })) as { sessionId: string };
    this.sessionId = att.sessionId;
    await this.send('Page.enable', {}, this.sessionId);
    await this.send('Runtime.enable', {}, this.sessionId);
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      const t = setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`CDP timeout: ${method}`)); }, 45000);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(t); resolve(v); },
        reject: (e) => { clearTimeout(t); reject(e); },
      });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  async evaluate<T>(expression: string, awaitPromise = false): Promise<T> {
    const res = (await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }, this.sessionId)) as {
      result?: { value?: T };
      exceptionDetails?: { text: string };
    };
    if (res.exceptionDetails) throw new Error(`CDP eval failed: ${res.exceptionDetails.text}`);
    return res.result?.value as T;
  }

  async navigate(url: string, settleMs = 3000): Promise<void> {
    await this.send('Page.navigate', { url }, this.sessionId);
    for (let i = 0; i < 50; i++) {
      await sleep(400);
      const st = await this.evaluate<string>('document.readyState').catch(() => 'loading');
      if (st === 'complete') break;
    }
    await sleep(settleMs);
  }

  async close(): Promise<void> {
    try { await this.send('Target.closeTarget', { targetId: this.targetId }); } catch { /* */ }
    this.ws.close();
  }
}

async function preflight(cdp: StoreCdp): Promise<{ storeId: number; storeName: string }> {
  console.log(`\n[1/5] Preflight: ${STORE_SLUG}`);
  await cdp.navigate(`https://store.bricklink.com/${STORE_SLUG}#/shop`);
  const raw = await cdp.evaluate<string>(`(function(){
    var sf = window.StoreFront;
    var isUK = /United Kingdom/i.test((document.body.innerText||'').slice(0, 2000));
    return JSON.stringify({ id: sf && sf.store ? sf.store.id : null, name: sf && sf.store ? sf.store.name : null, isUK: isUK });
  })()`);
  const meta = JSON.parse(raw) as { id: number | null; name: string | null; isUK: boolean };
  if (!meta.id || !meta.name) { console.error('  StoreFront not found — is the store slug right?'); process.exit(1); }
  if (!meta.isUK) { console.error(`  Store is not UK — aborting (UK-only arbitrage).`); process.exit(1); }
  console.log(`  ${meta.name} (ID ${meta.id}) UK ✓`);
  return { storeId: meta.id, storeName: meta.name };
}

async function scrapeInventory(cdp: StoreCdp, storeId: number): Promise<StoreLot[]> {
  if (fs.existsSync(INVENTORY_FILE) && !FORCE_RESCRAPE) {
    const ageH = (Date.now() - fs.statSync(INVENTORY_FILE).mtimeMs) / 3600000;
    if (ageH < INVENTORY_TTL_HOURS) {
      const cached = JSON.parse(fs.readFileSync(INVENTORY_FILE, 'utf8')) as StoreLot[];
      if (cached.length > 0) {
        console.log(`\n[2/5] Reusing cached inventory (${ageH.toFixed(1)}h old, ${cached.length} lots)`);
        return cached;
      }
    }
  }
  console.log(`\n[2/5] Scraping inventory (AJAX, ${PAGE_DELAY_MS / 1000}s/page, max ${MAX_PAGES} pages/type)...`);
  const all: StoreLot[] = [];
  const seen = new Set<number>();
  for (const type of ['P', 'S', 'M'] as PgItemType[]) {
    for (let pg = 1; pg <= MAX_PAGES; pg++) {
      const url = `https://store.bricklink.com/ajax/clone/store/searchitems.ajax?sort=1&itemType=${type}&showHomeItems=0&pgSize=100&rpp=100&pg=${pg}&sid=${storeId}`;
      const raw = await cdp.evaluate<string>(`(async () => {
        try {
          const res = await fetch(${JSON.stringify(url)}, { headers: { 'X-Requested-With':'XMLHttpRequest', 'Accept':'application/json' }, credentials:'include' });
          if (!res.ok) return JSON.stringify({ err: 'HTTP ' + res.status });
          const text = await res.text();
          if (text.trim().startsWith('<')) return JSON.stringify({ err: 'HTML response (login/captcha?)' });
          return text;
        } catch (e) { return JSON.stringify({ err: e.message }); }
      })()`, true);
      let parsed: { result?: { groups?: Array<{ items?: Array<Record<string, unknown>> }> }; err?: string };
      try { parsed = JSON.parse(raw); } catch { console.error(`  [${type}] pg${pg}: non-JSON, stopping type`); break; }
      if (parsed.err) { console.error(`  [${type}] pg${pg}: ${parsed.err}`); break; }
      const items = parsed.result?.groups?.[0]?.items ?? [];
      if (items.length === 0) break;
      let added = 0;
      for (const it of items) {
        const invID = Number((it as { invID: unknown }).invID);
        if (seen.has(invID)) continue;
        seen.add(invID);
        const nativePrice = Number((it as { nativePrice: unknown }).nativePrice);
        const rawConv = Number((it as { rawConvertedPrice: unknown }).rawConvertedPrice);
        const baseItemNo = String((it as { itemNo: unknown }).itemNo);
        const itemSeq = Number((it as { itemSeq?: unknown }).itemSeq ?? 0);
        // Variant-ID recovery (Tier 2, Chris 2026-07-08 follow-up to Gate 1): BL's own
        // AJAX payload carries itemSeq — verified live against Jabbz (2026-07-08): it's
        // the catalog "-<seq>" suffix for type='S' (1 = base set, matching
        // normaliseSetNo's own "-1" default; >1 = the real variant, e.g. advent-day
        // builds "75366-13" or gift-with-purchase sub-items — confirmed the day-number
        // in an advent set's itemName is always itemSeq-1, e.g. "(Day 10)" -> seq 11).
        // itemSeq is always 0 for P/M — their itemNo is already fully specific there
        // (e.g. "col139"), so this only ever folds for sets. Folding it into itemNo here
        // means every downstream lookup (cache key, POV base-strip, benchmark, Gate 1)
        // resolves against the TRUE catalog item instead of silently inheriting the base
        // set's full sold history. bricklink_pg_summary_cache (L1) was seeded with bare
        // base numbers only, so a recovered variant with no dedicated L1/L3 row correctly
        // falls through to priceSource='none' and the gap-fill queue — not a bug, that's
        // the honest state until pg-residual-fill.ts backfills the variant's own page.
        const recoveredItemNo = type === 'S' && itemSeq > 1 ? `${baseItemNo}-${itemSeq}` : baseItemNo;
        all.push({
          invID,
          itemType: type,
          itemNo: recoveredItemNo,
          itemSeq,
          colourId: Number((it as { colorID?: unknown }).colorID ?? 0),
          colourName: ((it as { colorName?: string }).colorName) ?? null,
          itemName: String((it as { itemName: unknown }).itemName),
          cond: String((it as { invNew: unknown }).invNew) === 'New' ? 'N' : 'U',
          qty: Number((it as { invQty: unknown }).invQty),
          ask: nativePrice > 0 ? nativePrice : (Number.isFinite(rawConv) ? rawConv : 0),
          description: (it as { invDescription?: string }).invDescription ?? null,
          invComplete: (it as { invComplete?: string }).invComplete ?? null,
        });
        added++;
      }
      process.stdout.write(`  [${type}] pg${pg}: +${added} (total ${all.length})   \r`);
      if (added === 0) break;
      if (pg < MAX_PAGES) await sleep(PAGE_DELAY_MS);
    }
    console.log('');
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(INVENTORY_FILE, JSON.stringify(all, null, 1));
  console.log(`  scraped ${all.length} lots → ${path.basename(INVENTORY_FILE)}`);
  return all;
}

// ---------------------------------------------------------------------------
// Enrichment: cache-first, then paced PG page scrapes
// ---------------------------------------------------------------------------

interface EnrichOutcome {
  rows: Map<string, PgCacheRow>;
  tuples: PgItemRef[];
  pagesScraped: number;
  cacheHits: number;
  noData: number;
  notFound: number;
  aborted: string | null;
}

async function enrich(lots: StoreLot[]): Promise<EnrichOutcome> {
  // The scrape unit is one PG page per (type, itemNo[, colour]) — covers both conditions.
  // MIN_ASK here is only the economy dial (§header doc): it decides which tuples we
  // want price data for at all. It does NOT gate the live browser scrape — that's
  // ENRICH_MIN_ASK below, applied only to the cache-miss subset.
  const tupleMap = new Map<string, PgItemRef>();
  const tupleMaxAsk = new Map<string, number>();
  for (const l of lots) {
    if (l.ask < MIN_ASK) continue;
    if (hasDamageNote(l.description)) continue;
    if (l.itemType === 'S' && isIncompleteSetListing(l.invComplete, l.description)) continue;
    const ref: PgItemRef = { itemType: l.itemType, itemNo: l.itemNo, colourId: l.itemType === 'P' ? l.colourId : 0 };
    const key = pgCacheKey(ref);
    tupleMap.set(key, ref);
    tupleMaxAsk.set(key, Math.max(tupleMaxAsk.get(key) ?? 0, l.ask));
  }
  const tuples = [...tupleMap.values()];
  console.log(`\n[3/5] Enriching ${tuples.length} unique (item, colour) tuples (PG cache TTL ${CACHE_TTL_DAYS}d)...`);

  const rows = await cacheService.getFresh(tuples, CACHE_TTL_DAYS);
  const cacheHits = rows.size;
  let needed = tuples.filter((t) => !rows.has(pgCacheKey(t)));
  const belowEnrichAsk = needed.filter((t) => (tupleMaxAsk.get(pgCacheKey(t)) ?? 0) < ENRICH_MIN_ASK).length;
  needed = needed.filter((t) => (tupleMaxAsk.get(pgCacheKey(t)) ?? 0) >= ENRICH_MIN_ASK);
  console.log(
    `  cache hits: ${cacheHits}   to scrape: ${needed.length}` +
      (belowEnrichAsk > 0 ? `   (${belowEnrichAsk} skipped — below --enrich-min-ask=${money(ENRICH_MIN_ASK)})` : ''),
  );
  if (LIMIT_TUPLES > 0 && needed.length > LIMIT_TUPLES) {
    console.log(`  --limit-tuples=${LIMIT_TUPLES}: scraping first ${LIMIT_TUPLES} this run (cache resumes the rest)`);
    needed = needed.slice(0, LIMIT_TUPLES);
  }

  let pagesScraped = 0;
  let noData = 0;
  let notFound = 0;
  let aborted: string | null = null;

  if (needed.length > 0) {
    const estMin = (needed.length * (NAV_DELAY_MS + 1000 + 2500)) / 60000;
    console.log(`  estimated scrape time: ~${estMin.toFixed(0)} min at ${(NAV_DELAY_MS / 1000).toFixed(1)}s+jitter per page`);
    const scraper = new PgScraper({ cdpPort: CDP_PORT });
    await scraper.open();
    const pendingUpserts: PgScrapeResult[] = [];
    let blockRetried = false;

    const flush = async () => {
      if (pendingUpserts.length === 0) return;
      const flushed = pendingUpserts.splice(0);
      await cacheService.upsert(flushed);
      // Queue write-back (2026-07-20 audit): these tuples were just page-scraped in full,
      // so stamp last_refreshed_at and push next_due_at out at the tier-correct cycle —
      // otherwise tonight's lane D redoes today's work. Best-effort: tuples not in the
      // queue simply match nothing (they'll be adopted by the orphan backfill/universe).
      try {
        const refs = flushed.map((r) => r.item);
        const filter = refs
          .map((r) => `and(item_type.eq.${r.itemType},item_no.eq."${r.itemNo}",colour_id.eq.${r.itemType === 'P' ? r.colourId : 0})`)
          .join(',');
        const { data } = await supabase
          .from('bl_pg_refresh_queue')
          .select('item_type,item_no,colour_id,tier')
          .or(filter);
        const nowIso = new Date().toISOString();
        for (const row of (data ?? []) as { item_type: string; item_no: string; colour_id: number; tier: 'active' | 'tail' }[]) {
          const due = new Date(Date.now() + cycleDaysForTier(row.tier) * 24 * 3600 * 1000).toISOString();
          await supabase
            .from('bl_pg_refresh_queue')
            .update({ last_refreshed_at: nowIso, next_due_at: due })
            .eq('item_type', row.item_type).eq('item_no', row.item_no).eq('colour_id', row.colour_id);
        }
      } catch (e) {
        console.warn(`  ⚠ queue write-back failed (non-fatal): ${(e as Error).message}`);
      }
    };

    try {
      for (let i = 0; i < needed.length; i++) {
        const ref = needed[i];
        if (i > 0 || pagesScraped > 0) await sleep(NAV_DELAY_MS + Math.random() * 2000);
        try {
          const result = await scraper.scrape(ref);
          rows.set(pgCacheKey(ref), toPgCacheRow(result));
          pendingUpserts.push(result);
          pagesScraped++;
          blockRetried = false;
          if (pendingUpserts.length >= 20) await flush();
          if (pagesScraped % 25 === 0) {
            console.log(`  ${pagesScraped}/${needed.length} pages scraped (${((pagesScraped / needed.length) * 100).toFixed(0)}%)`);
          }
        } catch (err) {
          if (err instanceof PgNoDataError) {
            // Cache the empty result so future runs skip it.
            const empty: PgScrapeResult = {
              item: ref, itemName: null,
              uk: computeSideStats({ soldNew: [], soldUsed: [], stockNew: [], stockUsed: [] }, true),
              world: computeSideStats({ soldNew: [], soldUsed: [], stockNew: [], stockUsed: [] }, false),
              finalUrl: '', scrapedAt: new Date().toISOString(),
            };
            rows.set(pgCacheKey(ref), toPgCacheRow(empty));
            pendingUpserts.push(empty);
            noData++;
            continue;
          }
          if (err instanceof PgNotFoundError) { notFound++; continue; }
          if (err instanceof PgBlockError) {
            if (!blockRetried) {
              console.warn(`  ⚠ block signal (${(err as Error).message.slice(0, 100)}) — 60s breather, one retry...`);
              blockRetried = true;
              await sleep(60000);
              i--; // retry same tuple
              continue;
            }
            aborted = `Repeated block after breather at tuple ${i + 1}/${needed.length} — stopped to protect the session. Re-run later; the cache resumes progress.`;
            break;
          }
          if (err instanceof PgCaptchaError || err instanceof PgLoginError || err instanceof PgCurrencyError) {
            aborted = `${(err as Error).name}: ${(err as Error).message} — stopped immediately.`;
            break;
          }
          // Unexpected error: log and skip this tuple.
          console.warn(`  ⚠ ${ref.itemType} ${ref.itemNo}: ${(err as Error).message.slice(0, 120)}`);
        }
      }
    } finally {
      await flush().catch((e) => console.error('  final cache flush failed:', (e as Error).message));
      await scraper.close();
    }
  }
  console.log(`  enrichment done: ${pagesScraped} pages scraped, ${cacheHits} cache hits, ${noData} no-data, ${notFound} not-found${aborted ? ' — ABORTED EARLY' : ''}`);
  return { rows, tuples, pagesScraped, cacheHits, noData, notFound, aborted };
}

// ---------------------------------------------------------------------------
// POV join (L4, cache-only — no live scraping during a scan; see PartOutValueCacheService.getCached)
// ---------------------------------------------------------------------------

interface PovSummary {
  soldAvgGbp: number | null;
  multiple: number | null;
}

/** Keys by the bare BL set number (no "-1" suffix) — matches parseSetNumber's itemNo. */
async function fetchPovMap(lots: StoreLot[]): Promise<Map<string, PovSummary>> {
  const map = new Map<string, PovSummary>();
  const setNos = new Set<string>();
  for (const l of lots) if (l.itemType === 'S') setNos.add(parseSetNumber(l.itemNo).itemNo);
  for (const setNo of setNos) {
    const opts = resolvePovOptions({ setNumber: setNo, itemSeq: 1 });
    try {
      const cached = await povCacheService.getCached(opts);
      if (cached) {
        map.set(setNo, {
          soldAvgGbp: cached.row.sold_6mo_avg_gbp != null ? Number(cached.row.sold_6mo_avg_gbp) : null,
          multiple: cached.row.partout_multiple != null ? Number(cached.row.partout_multiple) : null,
        });
      }
    } catch (err) {
      console.warn(`  ⚠ POV cache lookup failed for ${setNo}:`, (err as Error).message);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// L1 fallback (worldwide summary cache — screening basis when L3 UK detail is
// missing or shows no sales for a lot's condition; spec §2.1 "L1 screens, L3
// prices"). Same chunk/page shape as pg-own-store-audit.ts's fetchL1.
// ---------------------------------------------------------------------------

interface L1SummaryRow {
  item_type: PgItemType;
  item_no: string;
  colour_id: number;
  currency: string | null;
  fx_rate: number | null;
  sold6m_new_avg: number | null;
  sold6m_new_qavg: number | null;
  sold6m_new_qty: number | null;
  sold6m_new_lots: number | null;
  sold6m_used_avg: number | null;
  sold6m_used_qavg: number | null;
  sold6m_used_qty: number | null;
  sold6m_used_lots: number | null;
  str_new: number | null;
  str_used: number | null;
  no_data: boolean;
}

interface L1Benchmark {
  soldAvgNew: number | null;
  soldAvgUsed: number | null;
  soldQtyNew: number;
  soldQtyUsed: number;
  soldLotsNew: number;
  soldLotsUsed: number;
  strNew: number | null;
  strUsed: number | null;
}

/** Reads bricklink_pg_summary_cache for the given tuples, GBP-converting via fx_rate
 * only when currency !== 'GBP' (GBP-native rows are already correct regardless of any
 * stamped rate). no_data rows and non-GBP rows missing a stamped rate are skipped —
 * never guessed. Chunked .in() of 300 item_nos + .range() pagination (1,000-row cap). */
async function fetchL1Map(tuples: PgItemRef[]): Promise<Map<string, L1Benchmark>> {
  const out = new Map<string, L1Benchmark>();
  if (tuples.length === 0) return out;
  const itemNos = [...new Set(tuples.map((t) => t.itemNo))];
  const CHUNK = 300;
  const PAGE = 1000;
  for (let i = 0; i < itemNos.length; i += CHUNK) {
    const chunk = itemNos.slice(i, i + CHUNK);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('bricklink_pg_summary_cache')
        .select(
          'item_type,item_no,colour_id,currency,fx_rate,sold6m_new_avg,sold6m_new_qavg,sold6m_new_qty,sold6m_new_lots,sold6m_used_avg,sold6m_used_qavg,sold6m_used_qty,sold6m_used_lots,str_new,str_used,no_data',
        )
        .in('item_no', chunk)
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`L1 read failed: ${error.message}`);
      const rows = (data ?? []) as L1SummaryRow[];
      for (const r of rows) {
        if (r.no_data) continue;
        const fx = r.currency && r.currency !== 'GBP' ? r.fx_rate : 1;
        if (fx == null) continue; // non-GBP row with no stamped rate — don't guess
        const newAvgRaw = r.sold6m_new_qavg ?? r.sold6m_new_avg;
        const usedAvgRaw = r.sold6m_used_qavg ?? r.sold6m_used_avg;
        out.set(pgCacheKey({ itemType: r.item_type, itemNo: r.item_no, colourId: r.colour_id }), {
          soldAvgNew: newAvgRaw != null ? newAvgRaw * fx : null,
          soldAvgUsed: usedAvgRaw != null ? usedAvgRaw * fx : null,
          soldQtyNew: r.sold6m_new_qty ?? 0,
          soldQtyUsed: r.sold6m_used_qty ?? 0,
          soldLotsNew: r.sold6m_new_lots ?? 0,
          soldLotsUsed: r.sold6m_used_lots ?? 0,
          strNew: r.str_new,
          strUsed: r.str_used,
        });
      }
      if (rows.length < PAGE) break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

type Confidence = 'solid' | 'thin' | 'single-sale' | 'none';
/** 'uk' = L3 page-scrape detail (bricklink_price_guide_cache); 'world' = L1 worldwide
 * summary fallback (bricklink_pg_summary_cache); 'none' = no benchmark on either layer;
 * 'ambiguous' = Gate 1 identity-ambiguity guard fired — see findIdentityAmbiguousSetNos. */
type PriceSource = 'uk' | 'world' | 'none' | 'ambiguous';

interface ScoredLot extends StoreLot {
  ukSoldAvg: number | null;
  ukSoldMedian: number | null;
  ukSoldLots: number;
  ukSoldQty: number;
  ukLast2moQty: number;
  ukStockQty: number;
  str: number;
  multiplier: number;
  listPrice: number | null;
  inboundPerUnit: number;
  netPerUnit: number | null;
  lotProfit: number | null;
  marginPct: number | null;
  monthsOfStock: number | null;
  askVsUk: number | null;
  confidence: Confidence;
  skewFlag: boolean;
  rejectReason: string | null;
  passed: boolean;
  watch: boolean;
  /** L4 join (sets only): BL's official part-out value, cache-only. Null for parts/figs or no cache hit. */
  povSoldAvgGbp: number | null;
  povMultiple: number | null;
  /** ask < 0.5 × POV sold avg — a part-out arbitrage signal, distinct from the STR-based buy gates. */
  povArbitrageFlag: boolean;
  /** Which layer this lot's benchmark came from — see PriceSource. */
  priceSource: PriceSource;
  /** Gate 2: list price is floor-clamped AND the UK 6mo max sold price is below the
   * floor — realisable net is 0 regardless of the raw margin gates. Excluded from buy/watch. */
  floorUnviable: boolean;
  /** Gate 2 discount applied to realisableNet when floor-clamped but not floor-unviable
   * (1 = no discount). See scoreLots for the heuristic. */
  floorCapture: number;
  /** Gate 3: lotProfit × captureFraction(str) × floorCapture — the "honest" net after
   * liquidity + floor-viability discounting. Null when lotProfit itself is null. */
  realisableNet: number | null;
}

interface Benchmark {
  source: PriceSource;
  soldAvg: number | null;
  soldMedian: number | null;
  soldLots: number;
  soldQty: number;
  last2mo: number;
  str: number;
}

/** L3 wins when it has sales for the lot's condition; otherwise falls back to the L1
 * worldwide summary (spec §2.1 "L1 screens, L3 prices" — screening may run on any
 * layer, but every report labels its source). Absent from both = 'none'. */
function resolveBenchmark(lot: StoreLot, row: PgCacheRow | undefined, l1: L1Benchmark | undefined): Benchmark {
  const isNew = lot.cond === 'N';
  const l3SoldAvg = row ? (isNew ? row.uk_sold_avg_new : row.uk_sold_avg_used) : null;
  const l3SoldQty = row ? (isNew ? row.uk_sold_qty_new : row.uk_sold_qty_used) : 0;
  if (row && l3SoldAvg != null && l3SoldQty > 0) {
    const stockQty = isNew ? row.uk_stock_qty_new : row.uk_stock_qty_used;
    return {
      source: 'uk',
      soldAvg: l3SoldAvg,
      soldMedian: isNew ? row.uk_sold_median_new : row.uk_sold_median_used,
      soldLots: isNew ? row.uk_sold_lots_new : row.uk_sold_lots_used,
      soldQty: l3SoldQty,
      last2mo: isNew ? row.uk_sold_last2mo_qty_new : row.uk_sold_last2mo_qty_used,
      str: stockQty > 0 ? l3SoldQty / stockQty : 0,
    };
  }
  const l1SoldAvg = l1 ? (isNew ? l1.soldAvgNew : l1.soldAvgUsed) : null;
  const l1SoldQty = l1 ? (isNew ? l1.soldQtyNew : l1.soldQtyUsed) : 0;
  if (l1 && l1SoldAvg != null && l1SoldQty > 0) {
    return {
      source: 'world',
      soldAvg: l1SoldAvg,
      soldMedian: null, // L1 has no median — skew detection just won't fire for world-sourced lots
      soldLots: isNew ? l1.soldLotsNew : l1.soldLotsUsed,
      soldQty: l1SoldQty,
      last2mo: 0, // L1 has no monthly buckets
      str: (isNew ? l1.strNew : l1.strUsed) ?? 0,
    };
  }
  return { source: 'none', soldAvg: null, soldMedian: null, soldLots: 0, soldQty: 0, last2mo: 0, str: 0 };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Reads the UK max sold price for a lot's condition out of the L3 row's uk_detail JSONB
 * (shape: { soldNew: {min,max,byMonth}, soldUsed: {min,max,byMonth}, ... } — see
 * toPgCacheRow in price-guide-cache.service.ts). Null when there's no row or no side data. */
function getUkMaxSold(row: PgCacheRow | undefined, cond: 'N' | 'U'): number | null {
  if (!row || !row.uk_detail || typeof row.uk_detail !== 'object') return null;
  const detail = row.uk_detail as { soldNew?: { max?: number | null }; soldUsed?: { max?: number | null } };
  const side = cond === 'N' ? detail.soldNew : detail.soldUsed;
  return side?.max ?? null;
}

/**
 * Gate 1 — identity-ambiguity guard (Chris 2026-07-08, Jabbz retrospective).
 *
 * BL's store search-items AJAX groups advent-day builds, gift-with-purchase variants,
 * etc. under the BASE set's itemNo, and — without the itemSeq recovery now applied in
 * scrapeInventory (Tier 2, same date) — would silently inherit the base set's FULL
 * benchmark (e.g. an advent-calendar day-24 minifig build scraping as 75184 and
 * inheriting 91 lots / £2.3k of Star Wars Advent Calendar sold history it never earned).
 *
 * Tier 2 now folds itemSeq into itemNo at scrape time (e.g. "75366-13"), so this gate
 * should rarely fire anymore — its remaining job is the safety net for lots where
 * itemSeq is 0/missing/1-but-still-aliased (stale cached inventory predating the fix,
 * an unexpected BL data-quality gap, or a genuine same-seq collision). The signal is
 * unchanged: 2+ store lots sharing one S tuple but carrying DIFFERENT item names means
 * BL's search is aliasing more than one real catalog item onto that itemNo, and we
 * can't tell which name (if any) is the "real" one, so every lot in the group is
 * flagged rather than guessed at.
 */
function findIdentityAmbiguousSetNos(lots: StoreLot[]): Set<string> {
  const namesByItemNo = new Map<string, Set<string>>();
  for (const lot of lots) {
    if (lot.itemType !== 'S') continue;
    const norm = lot.itemName.trim().toLowerCase();
    if (!norm) continue;
    let names = namesByItemNo.get(lot.itemNo);
    if (!names) { names = new Set(); namesByItemNo.set(lot.itemNo, names); }
    names.add(norm);
  }
  const ambiguous = new Set<string>();
  for (const [itemNo, names] of namesByItemNo) if (names.size >= 2) ambiguous.add(itemNo);
  return ambiguous;
}

function scoreLots(
  lots: StoreLot[],
  rows: Map<string, PgCacheRow>,
  l1Map: Map<string, L1Benchmark>,
  povMap: Map<string, PovSummary>,
): ScoredLot[] {
  const ambiguousSetNos = findIdentityAmbiguousSetNos(lots);
  const pre: Array<{ lot: StoreLot; row: PgCacheRow | undefined; l1: L1Benchmark | undefined; bench: Benchmark; list: number; ambiguous: boolean }> = [];
  let damageFiltered = 0;
  for (const lot of lots) {
    if (lot.ask < MIN_ASK) continue;
    if (hasDamageNote(lot.description)) { damageFiltered++; continue; }
    if (lot.itemType === 'S' && isIncompleteSetListing(lot.invComplete, lot.description)) continue;
    const ambiguous = lot.itemType === 'S' && ambiguousSetNos.has(lot.itemNo);
    const ref: PgItemRef = { itemType: lot.itemType, itemNo: lot.itemNo, colourId: lot.itemType === 'P' ? lot.colourId : 0 };
    const key = pgCacheKey(ref);
    // Ambiguous lots never resolve a benchmark — the base set's row (even if cached and
    // fresh) is not trustworthy for a subset it doesn't actually describe.
    const row = ambiguous ? undefined : rows.get(key);
    const l1 = ambiguous ? undefined : l1Map.get(key);
    const bench: Benchmark = ambiguous
      ? { source: 'ambiguous', soldAvg: null, soldMedian: null, soldLots: 0, soldQty: 0, last2mo: 0, str: 0 }
      : resolveBenchmark(lot, row, l1);
    const list = ambiguous ? 0 : (bricqerListPrice(bench.soldAvg, lot.cond, bench.str) ?? 0);
    pre.push({ lot, row, l1, bench, list, ambiguous });
  }
  void damageFiltered;
  const totalListForAlloc = pre.reduce((s, p) => s + p.list * p.lot.qty, 0);
  const withList = pre.filter((p) => p.list > 0);
  const avgStr = withList.length > 0 ? withList.reduce((s, p) => s + p.bench.str, 0) / withList.length : 0;

  return pre.map(({ lot, row, l1, bench, list, ambiguous }) => {
    const { soldAvg, soldMedian, soldLots, soldQty, last2mo, str, source: priceSource } = bench;
    const stockQty = row ? (lot.cond === 'N' ? row.uk_stock_qty_new : row.uk_stock_qty_used) : 0;
    const confidence: Confidence = soldLots >= 5 ? 'solid' : soldLots >= 2 ? 'thin' : soldLots === 1 ? 'single-sale' : 'none';
    const skewFlag = soldAvg != null && soldMedian != null && soldMedian > 0 && soldAvg > soldMedian * 1.3;
    const pov = lot.itemType === 'S' ? (povMap.get(parseSetNumber(lot.itemNo).itemNo) ?? null) : null;
    const povArbitrageFlag = pov?.soldAvgGbp != null && lot.ask < 0.5 * pov.soldAvgGbp;

    const base: ScoredLot = {
      ...lot,
      ukSoldAvg: soldAvg, ukSoldMedian: soldMedian, ukSoldLots: soldLots, ukSoldQty: soldQty,
      ukLast2moQty: last2mo, ukStockQty: stockQty, str,
      multiplier: bricqerMultiplier(lot.cond, str),
      listPrice: list > 0 ? +list.toFixed(4) : null,
      inboundPerUnit: 0, netPerUnit: null, lotProfit: null, marginPct: null, monthsOfStock: null,
      askVsUk: soldAvg != null && soldAvg > 0 ? +(lot.ask / soldAvg).toFixed(3) : null,
      confidence, skewFlag, rejectReason: null, passed: false, watch: false,
      povSoldAvgGbp: pov?.soldAvgGbp ?? null, povMultiple: pov?.multiple ?? null, povArbitrageFlag,
      priceSource,
      floorUnviable: false, floorCapture: 1, realisableNet: null,
    };

    if (ambiguous) {
      base.rejectReason = 'identity-ambiguous (variant subset) — base set number shared by 2+ distinct item names; needs item-level lookup, not fixed here';
      return base;
    }
    if (!soldAvg || list <= 0) {
      base.rejectReason = row || l1 ? 'no UK/world sales in 6mo' : 'not enriched (partial run)';
      return base;
    }
    const lotList = list * lot.qty;
    const inboundPerUnit = totalListForAlloc > 0 ? (SHIPPING * (lotList / totalListForAlloc)) / lot.qty : 0;
    const netPerUnit = list * (1 - VAR_FEE_PCT) - lot.ask - inboundPerUnit;
    const lotProfit = netPerUnit * lot.qty;
    const marginPct = (netPerUnit / list) * 100;
    const velocityRatio = avgStr > 0 ? str / avgStr : 1;
    const monthlyRate = Math.min(1, Math.max(0.005, PERSONAL_MONTHLY_LOT_RATE * velocityRatio));

    // Gate 2 — floor-viability (Chris 2026-07-08): when the store floor, not the
    // market, sets our list price, check whether the market has ever actually supported
    // it. src='uk' lots get an authoritative answer from the L3 max-sold figure; other
    // lots (world-priced at floor) fall back to a soldAvg-vs-floor depth ratio.
    const AT_FLOOR_EPS = 0.0005;
    let floorUnviable = false;
    let floorCapture = 1;
    if (list <= BRICQER_PRICE_FLOOR + AT_FLOOR_EPS) {
      const maxSold = priceSource === 'uk' ? getUkMaxSold(row, lot.cond) : null;
      if (maxSold != null && maxSold < BRICQER_PRICE_FLOOR) {
        floorUnviable = true;
        floorCapture = 0;
      } else {
        const floorDepth = BRICQER_PRICE_FLOOR / soldAvg;
        // Heuristic discount, not yet calibrated — awaiting the sold-under-10p own-store
        // analysis (apps/web/scripts/_analyze-sold-under-10p-v2.ts) to fit real capture
        // rates for floor-priced lots. 1/depth² until then; floorDepth<=1 means the
        // floor sits at/under the market average, so no discount is warranted.
        floorCapture = floorDepth > 1 ? clamp(1 / (floorDepth * floorDepth), 0.05, 1) : 1;
      }
    }
    // Gate 3 — capture-curve realisable net. Reuses captureFraction from liquidity-pov.ts
    // (do not re-derive the STR curve here) stacked with the floor-viability discount.
    const realisableNet = +(lotProfit * captureFraction(str) * floorCapture).toFixed(2);

    Object.assign(base, {
      inboundPerUnit: +inboundPerUnit.toFixed(4),
      netPerUnit: +netPerUnit.toFixed(4),
      lotProfit: +lotProfit.toFixed(2),
      marginPct: +marginPct.toFixed(1),
      monthsOfStock: +(1 / monthlyRate).toFixed(1),
      floorUnviable,
      floorCapture: +floorCapture.toFixed(3),
      realisableNet,
    });
    if (str < MIN_STR) { base.rejectReason = `STR ${str.toFixed(2)} < ${MIN_STR}`; return base; }
    if (lotProfit <= 0) { base.rejectReason = 'no profit after fees'; return base; }
    if (marginPct / 100 < MIN_MARGIN) {
      base.rejectReason = `margin ${marginPct.toFixed(0)}% < ${(MIN_MARGIN * 100).toFixed(0)}%`;
      base.watch = marginPct >= 10 && !floorUnviable; // near-misses worth a look
      return base;
    }
    if (floorUnviable) {
      base.rejectReason = `floor-unviable — UK 6mo max sold price is below the £${BRICQER_PRICE_FLOOR} floor; nobody has ever paid our price`;
      base.watch = false;
      return base;
    }
    base.passed = true;
    return base;
  });
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

interface ScanMeta {
  storeName: string;
  storeId: number;
  totalLots: number;
  byType: Record<string, number>;
  boiler: { boilerplateCount: number; itemsCovered: number };
  enrich: EnrichOutcome;
  /** Uncovered (priceSource 'none') tuples queued to bl_pg_refresh_queue this run. */
  gapFillCount: number;
  /** Set lots whose itemNo was folded to a recovered "<base>-<seq>" variant identity
   * (itemSeq>1) — see scrapeInventory's Tier 2 recovery. */
  variantRecoveredCount: number;
}


function money(n: number | null | undefined, dp = 2): string {
  return n == null ? '—' : `£${n.toFixed(dp)}`;
}

/** Summary fields mirrored into bl_pg_scan_reports (BrickRadar dashboard, §5.1) —
 * kept alongside the markdown so the persisted row's numbers can never drift from
 * what the report itself says (single computation, two outputs). */
interface ScanReportSummary {
  verdict: 'BUY' | 'REVIEW' | 'SKIP';
  lotsTotal: number;
  lotsPassing: number;
  outlayGbp: number;
  rawNetGbp: number;
  realisableNetGbp: number;
  priceSourceUk: number;
  priceSourceWorld: number;
  priceSourceUncovered: number;
  identityAmbiguous: number;
  floorUnviable: number;
  variantRecovered: number;
}

function buildReport(meta: ScanMeta, scored: ScoredLot[]): { md: string; summary: ScanReportSummary } {
  // ONE report (Chris 2026-07-21): bl-pg-store-scan warms the UK price-guide cache; the
  // DECISION report renders through the common bl-store-report module — the private
  // buy-table here WAS the divergent renderer named in the Jul-19 audit. Same demand cap,
  // advisory overlap, all-band ladder and standalone-postage rules every surface shares.
  // World-sourced benchmarks label as uk in this compact lens; the sanctioned grounded
  // path is store-assessment / store-report, which this scan has just warmed the cache for.
  const passed = scored.filter((s) => s.passed).sort((a, b) => (b.realisableNet ?? 0) - (a.realisableNet ?? 0));
  const identityAmbiguous = scored.filter((s) => s.priceSource === 'ambiguous');
  const floorUnviableLots = scored.filter((s) => s.floorUnviable);
  const srcCounts = { uk: 0, world: 0, none: 0, ambiguous: 0 } as Record<PriceSource, number>;
  for (const s of scored) srcCounts[s.priceSource]++;
  const outlay = passed.reduce((s, o) => s + o.ask * o.qty, 0);
  const net = passed.reduce((s, o) => s + (o.lotProfit ?? 0), 0);
  const realisableNetSum = passed.reduce((s, o) => s + (o.realisableNet ?? 0), 0);
  const solidRealisableNet = passed.filter((p) => p.confidence === 'solid').reduce((s, o) => s + (o.realisableNet ?? 0), 0);
  const top3 = passed.slice(0, 3).reduce((s, o) => s + (o.realisableNet ?? 0), 0);
  const top3Share = realisableNetSum > 0 ? (top3 / realisableNetSum) * 100 : 0;
  const verdict: 'BUY' | 'REVIEW' | 'SKIP' =
    passed.length === 0 ? 'SKIP'
      : realisableNetSum >= 25 && solidRealisableNet >= 15 && top3Share < 80 ? 'BUY'
        : realisableNetSum >= 10 ? 'REVIEW'
          : 'SKIP';

  const decision = buildBasketDecisionReport(
    scored.filter((s) => s.itemType !== 'S').map((s) => ({
      itemType: s.itemType, itemNo: s.itemNo, colourName: s.colourName, itemName: s.itemName,
      condition: s.cond, invQty: s.qty, unitPriceGBP: s.ask,
      ukSoldAvg: s.ukSoldAvg, ukSoldQty: s.ukSoldQty, ukStockQty: s.ukStockQty,
      sellThru: s.str, listPrice: s.listPrice, netPerUnit: s.netPerUnit,
      inboundPerUnit: s.inboundPerUnit, marginPct: s.marginPct, passed: s.passed,
    })),
    { slug: STORE_SLUG, storeName: meta.storeName, country: 'United Kingdom',
      inputs: { minMargin: MIN_MARGIN, minStr: MIN_STR, shipping: SHIPPING } },
  );
  const scanNote = [
    '',
    '## Scan telemetry',
    '',
    `- Lots scanned ${scored.length} · passing ${passed.length} · verdict ${verdict}`,
    `- Price source: UK ${srcCounts.uk} · world ${srcCounts.world} · uncovered ${srcCounts.none} · ambiguous ${srcCounts.ambiguous}`,
    `- Enrichment: ${meta.enrich.cacheHits} cache hits · ${meta.enrich.pagesScraped} pages scraped · gap-fill queued ${meta.gapFillCount} · variant-recovered ${meta.variantRecoveredCount}${meta.enrich.aborted ? ' · ⚠ ABORTED: ' + meta.enrich.aborted : ''}`,
    `- Cache-warming scan. Decision report: \`npx tsx scripts/store-assessment.ts --store-slug=${STORE_SLUG}\` (or store-report.ts to re-render offline).`,
    '',
  ].join('\n');

  return {
    md: `${renderDecisionMd(decision)}\n${scanNote}`,
    summary: {
      verdict,
      lotsTotal: scored.length,
      lotsPassing: passed.length,
      outlayGbp: +outlay.toFixed(2),
      rawNetGbp: +net.toFixed(2),
      realisableNetGbp: +realisableNetSum.toFixed(2),
      priceSourceUk: srcCounts.uk,
      priceSourceWorld: srcCounts.world,
      priceSourceUncovered: srcCounts.none,
      identityAmbiguous: identityAmbiguous.length,
      floorUnviable: floorUnviableLots.length,
      variantRecovered: meta.variantRecoveredCount,
    },
  };
}

// ---------------------------------------------------------------------------
// Persist hook (BrickRadar dashboard §5.1): best-effort insert into
// bl_pg_scan_reports so /brickradar's "Recent store scans" section can list +
// render past reports. Non-fatal — a write failure must never fail the scan
// itself, the markdown file on disk remains the source of truth either way.
// Cast to `any`: the table was added in a migration not yet pushed/type-generated
// at the time this hook was written (see supabase/migrations/20260708200000_pg_scan_reports.sql).
// ---------------------------------------------------------------------------

async function persistScanReport(storeSlug: string, summary: ScanReportSummary, md: string): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from('bl_pg_scan_reports').insert({
      store_slug: storeSlug,
      verdict: summary.verdict,
      lots_total: summary.lotsTotal,
      lots_passing: summary.lotsPassing,
      outlay_gbp: summary.outlayGbp,
      raw_net_gbp: summary.rawNetGbp,
      realisable_net_gbp: summary.realisableNetGbp,
      price_source_uk: summary.priceSourceUk,
      price_source_world: summary.priceSourceWorld,
      price_source_uncovered: summary.priceSourceUncovered,
      identity_ambiguous: summary.identityAmbiguous,
      floor_unviable: summary.floorUnviable,
      variant_recovered: summary.variantRecovered,
      report_md: md,
    });
    if (error) console.warn(`  ⚠ bl_pg_scan_reports insert failed: ${error.message}`);
  } catch (err) {
    console.warn(`  ⚠ bl_pg_scan_reports insert failed: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Gap-fill enqueue: uncovered (priceSource 'none') tuples -> bl_pg_refresh_queue,
// tier='tail', due immediately — pg-residual-fill.ts's default gap-fill mode picks
// up any queue row with last_refreshed_at IS NULL, which a fresh insert satisfies.
// Mirrors pg-residual-fill.ts's own enqueueFromInventoryFile shape.
// ---------------------------------------------------------------------------

async function enqueueGapFill(scored: ScoredLot[]): Promise<number> {
  const seen = new Set<string>();
  const rows: Array<{ item_type: PgItemType; item_no: string; colour_id: number; tier: 'tail'; next_due_at: string }> = [];
  const nowIso = new Date().toISOString();
  for (const s of scored) {
    if (s.priceSource !== 'none') continue;
    const ref: PgItemRef = { itemType: s.itemType, itemNo: s.itemNo, colourId: s.itemType === 'P' ? s.colourId : 0 };
    const key = pgCacheKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ item_type: ref.itemType, item_no: ref.itemNo, colour_id: ref.colourId, tier: 'tail', next_due_at: nowIso });
  }
  if (rows.length === 0) return 0;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase
      .from('bl_pg_refresh_queue')
      .upsert(rows.slice(i, i + CHUNK), { onConflict: 'item_type,item_no,colour_id', ignoreDuplicates: true });
    if (error) console.error(`  ⚠ gap-fill enqueue failed: ${error.message}`);
  }
  return rows.length;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!(await isPgCdpReachable(CDP_PORT))) {
    console.error(`Chrome CDP not reachable on :${CDP_PORT}. Start the CDP Chrome (logged in to BL with GBP display), then re-run.`);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const cdp = new StoreCdp();
  await cdp.open();
  let lots: StoreLot[];
  let storeMeta: { storeId: number; storeName: string };
  try {
    storeMeta = await preflight(cdp);
    lots = await scrapeInventory(cdp, storeMeta.storeId);
  } finally {
    await cdp.close();
  }

  const boiler = computeBoilerplate(lots);
  if (boiler.boilerplateCount > 0) {
    console.log(`  boilerplate: ${boiler.boilerplateCount} repeated description(s) covering ${boiler.itemsCovered}/${lots.length} lots — exempt from damage filter`);
  }

  const enrichOutcome = await enrich(lots);

  console.log('\n[4/5] Scoring...');
  const povMap = await fetchPovMap(lots);
  const l1Map = await fetchL1Map(enrichOutcome.tuples);
  const scored = scoreLots(lots, enrichOutcome.rows, l1Map, povMap);
  const passed = scored.filter((s) => s.passed);
  console.log(`  ${scored.length} lots scored, ${passed.length} pass gates (${l1Map.size} L1 tuples available as fallback)`);

  const gapFillCount = await enqueueGapFill(scored);
  if (gapFillCount > 0) {
    console.log(`  gap-fill: ${gapFillCount} uncovered tuple(s) queued to bl_pg_refresh_queue (tier=tail) — run: npx tsx scripts/pg/pg-residual-fill.ts`);
  }

  console.log('\n[5/5] Writing report...');
  const byType: Record<string, number> = {};
  for (const l of lots) byType[l.itemType] = (byType[l.itemType] ?? 0) + 1;
  const variantRecoveredCount = lots.filter((l) => l.itemType === 'S' && l.itemSeq > 1).length;
  const { md: report, summary } = buildReport(
    {
      storeName: storeMeta.storeName,
      storeId: storeMeta.storeId,
      totalLots: lots.length,
      byType,
      boiler,
      enrich: enrichOutcome,
      gapFillCount,
      variantRecoveredCount,
    },
    scored,
  );
  fs.writeFileSync(REPORT_FILE, report);
  console.log(`  saved → ${REPORT_FILE}\n`);
  console.log(report);
  await persistScanReport(STORE_SLUG, summary, report);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
