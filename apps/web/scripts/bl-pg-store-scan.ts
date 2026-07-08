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
 *   - write-through: bricklink_part_price_cache  (so bl-basket etc. benefit unchanged)
 *
 * The cache IS the resume mechanism: every scraped page is upserted in batches, so an
 * interrupted run re-uses everything on the next invocation.
 *
 * Usage (from apps/web, with the GBP-display BL session on the CDP port):
 *   npx tsx scripts/bl-pg-store-scan.ts --store-slug=Gibbo0o
 *
 * Flags:
 *   --store-slug=<name>      REQUIRED — BL store URL slug
 *   --cdp-port=<n>           Chrome CDP port (default 9222)
 *   --shipping=<gbp>         Inbound postage estimate for allocation (default 3.00)
 *   --min-ask=<gbp>          Economy dial, NOT a visibility filter (default 0). List price is
 *                            bricqerListPrice(soldAvg, cond, str) — the £0.0699 floor already
 *                            backstops it, and a cheap ask can be profitable when its UK 6MA
 *                            supports a higher list. Raise this only to skip scrape/cache/score
 *                            work on sub-threshold asks, never to hide otherwise-profitable lots.
 *   --enrich-min-ask=<gbp>   BROWSER-SCRAPE gate (default 0.10): a tuple only gets a live PgScraper
 *                            navigation if ≥1 of its lots asks at/above this. Cache reads (getFresh)
 *                            are unaffected — cache hits stay free for every tuple regardless of ask.
 *   --min-margin=<pct>       Buy-list gate on net/list margin (default 0.20)
 *   --min-str=<ratio>        Buy-list gate on UK sell-through (default 0)
 *   --cache-ttl-days=<n>     PG cache freshness (default 7)
 *   --inventory-ttl-hours=<n> Reuse cached store scrape if younger (default 24)
 *   --force-rescrape         Ignore cached store inventory
 *   --max-pages=<n>          AJAX pages per item type (default 50)
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
import { bricqerMultiplier, bricqerListPrice } from '../src/lib/bricklink/bricqer-pricing';
import { isIncompleteSetListing } from '../src/lib/bricklink/listing-completeness';
import { PartOutValueCacheService } from '../src/lib/bricklink/part-out-value-cache.service';
import { parseSetNumber, resolvePovOptions } from '../src/lib/bricklink/part-out-value';

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
const CDP_PORT = parseInt(argv['cdp-port'] ?? '9222', 10);
const SHIPPING = parseFloat(argv['shipping'] ?? '3.00');
const MIN_ASK = parseFloat(argv['min-ask'] ?? '0');
const ENRICH_MIN_ASK = parseFloat(argv['enrich-min-ask'] ?? '0.10');
const MIN_MARGIN = parseFloat(argv['min-margin'] ?? '0.20');
const MIN_STR = parseFloat(argv['min-str'] ?? '0');
const CACHE_TTL_DAYS = parseFloat(argv['cache-ttl-days'] ?? '7');
const INVENTORY_TTL_HOURS = parseFloat(argv['inventory-ttl-hours'] ?? '24');
const FORCE_RESCRAPE = argv['force-rescrape'] === 'true';
const MAX_PAGES = Math.min(200, parseInt(argv['max-pages'] ?? '50', 10));
const PAGE_DELAY_MS = Math.max(3000, parseInt(argv['page-delay-ms'] ?? '3000', 10));
const NAV_DELAY_MS = Math.max(2500, parseInt(argv['nav-delay-ms'] ?? '4000', 10));
const LIMIT_TUPLES = parseInt(argv['limit-tuples'] ?? '0', 10);

// Fee model — identical to bl-basket (BL 3% + Bricqer 3.5% + PayPal 2.9%).
const VAR_FEE_PCT = 0.094;
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
// src/lib/bricklink/bricqer-pricing.ts (v3, 2026-07-07: U STR>=1.5 → 1.80 + £0.0699 floor).

// ---------------------------------------------------------------------------
// Store inventory scrape (paced AJAX via CDP, mirrors bl-basket phase 2)
// ---------------------------------------------------------------------------

interface StoreLot {
  invID: number;
  itemType: PgItemType;
  itemNo: string;
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
        all.push({
          invID,
          itemType: type,
          itemNo: String((it as { itemNo: unknown }).itemNo),
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
      await cacheService.upsert(pendingUpserts);
      await cacheService.writeThroughPartPriceCache(pendingUpserts);
      pendingUpserts.length = 0;
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
 * summary fallback (bricklink_pg_summary_cache); 'none' = no benchmark on either layer. */
type PriceSource = 'uk' | 'world' | 'none';

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

function scoreLots(
  lots: StoreLot[],
  rows: Map<string, PgCacheRow>,
  l1Map: Map<string, L1Benchmark>,
  povMap: Map<string, PovSummary>,
): ScoredLot[] {
  const pre: Array<{ lot: StoreLot; row: PgCacheRow | undefined; l1: L1Benchmark | undefined; bench: Benchmark; list: number }> = [];
  let damageFiltered = 0;
  for (const lot of lots) {
    if (lot.ask < MIN_ASK) continue;
    if (hasDamageNote(lot.description)) { damageFiltered++; continue; }
    if (lot.itemType === 'S' && isIncompleteSetListing(lot.invComplete, lot.description)) continue;
    const ref: PgItemRef = { itemType: lot.itemType, itemNo: lot.itemNo, colourId: lot.itemType === 'P' ? lot.colourId : 0 };
    const key = pgCacheKey(ref);
    const row = rows.get(key);
    const l1 = l1Map.get(key);
    const bench = resolveBenchmark(lot, row, l1);
    const list = bricqerListPrice(bench.soldAvg, lot.cond, bench.str) ?? 0;
    pre.push({ lot, row, l1, bench, list });
  }
  void damageFiltered;
  const totalListForAlloc = pre.reduce((s, p) => s + p.list * p.lot.qty, 0);
  const withList = pre.filter((p) => p.list > 0);
  const avgStr = withList.length > 0 ? withList.reduce((s, p) => s + p.bench.str, 0) / withList.length : 0;

  return pre.map(({ lot, row, l1, bench, list }) => {
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
    };
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
    Object.assign(base, {
      inboundPerUnit: +inboundPerUnit.toFixed(4),
      netPerUnit: +netPerUnit.toFixed(4),
      lotProfit: +lotProfit.toFixed(2),
      marginPct: +marginPct.toFixed(1),
      monthsOfStock: +(1 / monthlyRate).toFixed(1),
    });
    if (str < MIN_STR) { base.rejectReason = `STR ${str.toFixed(2)} < ${MIN_STR}`; return base; }
    if (lotProfit <= 0) { base.rejectReason = 'no profit after fees'; return base; }
    if (marginPct / 100 < MIN_MARGIN) {
      base.rejectReason = `margin ${marginPct.toFixed(0)}% < ${(MIN_MARGIN * 100).toFixed(0)}%`;
      base.watch = marginPct >= 10; // near-misses worth a look
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
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

function money(n: number | null | undefined, dp = 2): string {
  return n == null ? '—' : `£${n.toFixed(dp)}`;
}

function buildReport(meta: ScanMeta, scored: ScoredLot[]): string {
  const passed = scored.filter((s) => s.passed).sort((a, b) => (b.lotProfit ?? 0) - (a.lotProfit ?? 0));
  const watch = scored.filter((s) => !s.passed && s.watch).sort((a, b) => (b.marginPct ?? 0) - (a.marginPct ?? 0));
  const benchmarked = scored.filter((s) => s.askVsUk != null);
  const noSales = scored.filter((s) => s.rejectReason === 'no UK/world sales in 6mo');
  const unenriched = scored.filter((s) => s.rejectReason === 'not enriched (partial run)');
  const srcCounts = { uk: 0, world: 0, none: 0 } as Record<PriceSource, number>;
  for (const s of scored) srcCounts[s.priceSource]++;
  const worldBuys = passed.filter((p) => p.priceSource === 'world');

  const outlay = passed.reduce((s, o) => s + o.ask * o.qty, 0);
  const listTotal = passed.reduce((s, o) => s + (o.listPrice ?? 0) * o.qty, 0);
  const net = passed.reduce((s, o) => s + (o.lotProfit ?? 0), 0);
  const margin = listTotal > 0 ? (net / listTotal) * 100 : 0;
  const roi = outlay > 0 ? (net / outlay) * 100 : 0;
  const top3 = passed.slice(0, 3).reduce((s, o) => s + (o.lotProfit ?? 0), 0);
  const top3Share = net > 0 ? (top3 / net) * 100 : 0;
  const solidPassed = passed.filter((p) => p.confidence === 'solid');
  const solidNet = solidPassed.reduce((s, o) => s + (o.lotProfit ?? 0), 0);

  const ratios = benchmarked.map((s) => s.askVsUk!) as number[];
  const medianRatio = median(ratios);
  const below80 = ratios.filter((r) => r < 0.8).length;
  const above100 = ratios.filter((r) => r >= 1.0).length;

  const strs = passed.map((p) => p.str);
  const medStr = median(strs);

  const verdict =
    passed.length === 0 ? 'SKIP'
    : net >= 25 && solidNet >= 15 && top3Share < 80 ? 'BUY'
    : net >= 10 ? 'REVIEW'
    : 'SKIP';

  const verdictReason =
    verdict === 'BUY'
      ? `£${net.toFixed(2)} projected net across ${passed.length} lots (${roi.toFixed(0)}% ROI on £${outlay.toFixed(2)}), with £${solidNet.toFixed(2)} of it on solid-confidence benchmarks and no excessive concentration (top-3 = ${top3Share.toFixed(0)}%).`
      : verdict === 'REVIEW'
        ? `Only £${net.toFixed(2)} projected net (${roi.toFixed(0)}% ROI on £${outlay.toFixed(2)}) — worth a manual look at the buy list, but marginal after handling time${top3Share >= 80 ? `, and top-3 lots carry ${top3Share.toFixed(0)}% of the profit` : ''}.`
        : `No meaningful profit at the current gates (margin ≥ ${(MIN_MARGIN * 100).toFixed(0)}%): ${passed.length} lots pass for £${net.toFixed(2)} net. Store prices sit ${medianRatio != null ? `at ${(medianRatio * 100).toFixed(0)}% of UK 6MA (median)` : 'without enough benchmark coverage'} — not a stale-priced seller.`;

  const L: string[] = [];
  L.push(`# BL store scan — ${meta.storeName} (${STORE_SLUG})`);
  L.push('');
  L.push(`*${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · data: catalogPG page scrape (UK-only, native-GBP rows) · no BL API calls*`);
  L.push('');
  L.push(`## Verdict: ${verdict}`);
  L.push('');
  L.push(verdictReason);
  if (meta.enrich.aborted) {
    L.push('');
    L.push(`> ⚠ **Partial data**: ${meta.enrich.aborted}`);
  }
  L.push('');
  L.push('## Basket economics (all passing lots)');
  L.push('');
  L.push('| | |');
  L.push('|---|---|');
  L.push(`| Lots passing gates | ${passed.length} (${passed.reduce((s, o) => s + o.qty, 0)} pieces) |`);
  L.push(`| Outlay | ${money(outlay)} |`);
  L.push(`| Projected list (Bricqer formula) | ${money(listTotal)} |`);
  L.push(`| Projected net (after 9.4% fees + £${SHIPPING.toFixed(2)} postage) | **${money(net)}** |`);
  L.push(`| Margin on list / ROI on outlay | ${margin.toFixed(0)}% / ${roi.toFixed(0)}% |`);
  L.push(`| Net on solid-confidence lots only | ${money(solidNet)} (${solidPassed.length} lots) |`);
  L.push(`| Top-3 lot concentration | ${top3Share.toFixed(0)}% of net |`);
  L.push(`| Median STR of passing lots | ${medStr != null ? medStr.toFixed(2) : '—'} |`);
  L.push('');
  if (passed.length > 0) {
    L.push(`Shipping sensitivity: net = ${money(net + SHIPPING - 2)} at £2.00 · ${money(net)} at £${SHIPPING.toFixed(2)} · ${money(net + SHIPPING - 5)} at £5.00.`);
    L.push('');
  }

  L.push('## Store pricing profile');
  L.push('');
  L.push(`- Benchmarked lots: **${benchmarked.length}** of ${scored.length} scanned (${noSales.length} with no UK/world sales in 6 months${unenriched.length > 0 ? `; ${unenriched.length} not yet enriched — partial run` : ''}).`);
  L.push(`- Price source: **${srcCounts.uk} UK** (L3 page-scrape) · **${srcCounts.world} worldwide** (L1 fallback) · **${srcCounts.none} uncovered** (no benchmark on either layer) — of ${scored.length} scanned lots.`);
  if (medianRatio != null) {
    L.push(`- Median ask ÷ UK 6MA: **${medianRatio.toFixed(2)}** — ${medianRatio >= 1 ? 'priced at/above market (active repricer; bargains are exceptions, not policy)' : medianRatio >= 0.85 ? 'slightly under market' : 'meaningfully under market (stale-priced seller — worth mining)'}.`);
    L.push(`- ${below80} lots ask <80% of UK 6MA · ${above100} lots ask ≥100%.`);
  }
  if (worldBuys.length > 0) {
    L.push(`- ⚠ **${worldBuys.length} of ${passed.length} buy candidates are worldwide-priced (L1)** — live-check on BL before purchase (UK/world gap ~11% median, worse on new licensed printed parts).`);
  }
  L.push('');

  const povCell = (o: ScoredLot) => {
    if (o.itemType !== 'S') return '';
    if (o.povSoldAvgGbp == null) return '—';
    return `${money(o.povSoldAvgGbp, 2)}${o.povMultiple != null ? ` (${o.povMultiple.toFixed(1)}x)` : ''}${o.povArbitrageFlag ? ' ⚠pov' : ''}`;
  };
  const lotLine = (o: ScoredLot) => {
    const name = (o.itemType === 'P' && o.colourName ? `${o.colourName} ${o.itemName}` : o.itemName).slice(0, 44);
    const src = o.priceSource === 'uk' ? 'uk' : o.priceSource === 'world' ? 'world' : '—';
    return `| ${o.itemType} | ${o.itemNo} | ${name} | ${o.cond} | ${money(o.ask)} | ${o.qty} | ${money(o.ukSoldAvg, 3)} | ${money(o.ukSoldMedian, 2)} | ${o.ukSoldLots} | ${o.str.toFixed(2)} | ${o.ukLast2moQty} | ${money(o.listPrice, 3)} | ${money(o.netPerUnit, 3)} | **${money(o.lotProfit)}** | ${o.marginPct?.toFixed(0) ?? '—'}% | ${o.confidence}${o.skewFlag ? ' ⚠skew' : ''} | ${src} | ${povCell(o)} |`;
  };
  const header = '| T | Item | Name | C | Ask | Qty | UK 6MA | Med | Sales | STR | L2mo | List | Net/u | Lot £ | Mgn | Confidence | Src | POV |';
  const sep = '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|';

  L.push(`## Buy list — ${passed.length} lots`);
  L.push('');
  if (passed.length === 0) {
    L.push('*None at the current gates.*');
  } else {
    L.push(header);
    L.push(sep);
    for (const o of passed) L.push(lotLine(o));
    L.push('');
    L.push('*Sales = UK-or-world transactions in 6mo, whichever priced the lot (confidence: ≥5 solid, 2–4 thin, 1 single-sale). L2mo = UK pieces sold in the 2 most recent months (0 for world-priced lots — L1 has no monthly buckets). ⚠skew = 6MA sits >30% above median — benchmark propped up by outlier sales; trust the median (world-priced lots never skew-flag — L1 has no median). Src = uk (L3 page-scrape, live-checked basis) or world (L1 worldwide fallback — live-check before buying, UK/world gap ~11% median). POV = BL part-out value (cache-only join, sets only); ⚠pov = ask < 50% of POV sold avg — a part-out arbitrage signal, independent of the STR-based buy gates above.*');
  }
  L.push('');

  if (watch.length > 0) {
    L.push(`## Watch list — ${watch.length} near-misses (10–${(MIN_MARGIN * 100).toFixed(0)}% margin)`);
    L.push('');
    L.push(header);
    L.push(sep);
    for (const o of watch.slice(0, 15)) L.push(lotLine(o));
    if (watch.length > 15) L.push(`*…and ${watch.length - 15} more.*`);
    L.push('');
  }

  // STR gate comparison over the passing set.
  if (passed.length > 0) {
    L.push('## Gate comparison (STR cutoffs on top of the buy list)');
    L.push('');
    L.push('| Gate | Lots | Outlay | Net | Margin | ROI |');
    L.push('|---|---|---|---|---|---|');
    for (const gate of [0, 0.25, 0.5, 0.75, 1.0]) {
      const subset = passed.filter((o) => o.str >= gate);
      if (subset.length === 0) continue;
      const so = subset.reduce((s, o) => s + o.ask * o.qty, 0);
      const sl = subset.reduce((s, o) => s + (o.listPrice ?? 0) * o.qty, 0);
      const sn = subset.reduce((s, o) => s + (o.lotProfit ?? 0), 0);
      L.push(`| STR≥${gate.toFixed(2)} | ${subset.length} | ${money(so)} | ${money(sn)} | ${sl > 0 ? ((sn / sl) * 100).toFixed(0) : '—'}% | ${so > 0 ? ((sn / so) * 100).toFixed(0) : '—'}% |`);
    }
    L.push('');
  }

  L.push('## Coverage & data quality');
  L.push('');
  L.push(`- Inventory: ${meta.totalLots} lots (P=${meta.byType['P'] ?? 0}, S=${meta.byType['S'] ?? 0}, M=${meta.byType['M'] ?? 0}).`);
  L.push(`- Enrichment: ${meta.enrich.cacheHits} cache hits + ${meta.enrich.pagesScraped} pages scraped; ${meta.enrich.noData} no-data items; ${meta.enrich.notFound} not in catalog.`);
  if (meta.boiler.boilerplateCount > 0) {
    L.push(`- Boilerplate: ${meta.boiler.boilerplateCount} repeated description(s) covering ${meta.boiler.itemsCovered} lots exempted from the damage filter.`);
  }
  L.push(`- Gates: ask ≥ ${money(MIN_ASK)} (economy dial), browser-scrape ask ≥ ${money(ENRICH_MIN_ASK)}, margin ≥ ${(MIN_MARGIN * 100).toFixed(0)}%, STR ≥ ${MIN_STR}, shipping £${SHIPPING.toFixed(2)} allocated by list value.`);
  L.push(`- Fee model: 9.4% variable (BL 3% + Bricqer 3.5% + PayPal 2.9%).`);
  if (meta.gapFillCount > 0) {
    L.push(`- Gap-fill: ${meta.gapFillCount} uncovered tuple(s) queued to \`bl_pg_refresh_queue\` (tier=tail) — run \`npx tsx scripts/pg/pg-residual-fill.ts\` to clear them.`);
  }
  L.push('');

  L.push('## Next steps');
  L.push('');
  if (verdict === 'BUY') {
    L.push(`1. Build the cart: \`npx tsx scripts/bl-basket.ts --store-slug=${STORE_SLUG} --shipping=${SHIPPING.toFixed(2)}\` — the PG scrape has already warmed its price cache, so it will re-derive this basket without extra API spend.`);
    L.push('2. Sense-check the ⚠skew rows against their medians before approving the cart.');
    if (top3Share >= 60) L.push(`3. Top-3 lots carry ${top3Share.toFixed(0)}% of profit — verify those three manually on BL before committing.`);
  } else if (verdict === 'REVIEW') {
    L.push('1. Review the buy list above manually — the total is small enough that handling time may not justify a cart.');
    L.push(`2. If buying, run: \`npx tsx scripts/bl-basket.ts --store-slug=${STORE_SLUG}\` (price cache already warm).`);
  } else {
    L.push('1. No action — deprioritise this store.');
    if (medianRatio != null && medianRatio >= 1) L.push('2. The store reprices actively; re-scanning it later is unlikely to help. Spend the next scan on a different seller.');
  }
  L.push('');
  return L.join('\n');
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
  const report = buildReport(
    { storeName: storeMeta.storeName, storeId: storeMeta.storeId, totalLots: lots.length, byType, boiler, enrich: enrichOutcome, gapFillCount },
    scored,
  );
  fs.writeFileSync(REPORT_FILE, report);
  console.log(`  saved → ${REPORT_FILE}\n`);
  console.log(report);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
