/**
 * BrickLink Store reverse-scan — find basket-buy opportunities in a single BL store.
 *
 * Scrapes a store's inventory via Chrome CDP AJAX (following rate-limit rules copied
 * from the bricklink-arbitrage skill), cross-references each item's asking price
 * against the BL UK 6-month sold average (unified price cache via readPriceGuide,
 * fetched fresh via ensurePriceGuide if missing), and ranks by % margin with a
 * zero-shipping assumption (items will be bought as a single-seller basket).
 *
 * Usage (from apps/web):
 *   npx tsx scripts/scan-bl-store.ts --store-slug=Bruffty --store-id=3787686
 *   npx tsx scripts/scan-bl-store.ts --store-slug=Bruffty --store-id=3787686 \
 *     --item-types=P,S,M --max-pages=20 --min-discount=0.20
 *
 * Safety rules (from bricklink-arbitrage skill — DO NOT RELAX):
 *   - 3-second minimum delay between AJAX pages
 *   - 20 pages max per item-type (2000 items)
 *   - Stop immediately on empty page / error / CAPTCHA — no retry loops
 *   - Single instance only (guarded by lock file)
 *   - Abort if store.country != GB (UK-only at our scale)
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import WebSocket from 'ws';
import { BrickLinkClient, BrickLinkApiError, RateLimitError } from '../src/lib/bricklink/client';
import { ensurePriceGuide } from '../src/lib/bricklink/price-guide/capture';
import { readPriceGuide, pgKey, type ItemRef } from '../src/lib/bricklink/price-guide/read';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2).reduce<Record<string, string>>((acc, a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  acc[k] = v ?? 'true';
  return acc;
}, {});

const STORE_SLUG = argv['store-slug'];
const STORE_ID = argv['store-id'];
if (!STORE_SLUG || !STORE_ID) {
  console.error('Required: --store-slug=<name> --store-id=<numeric>');
  process.exit(1);
}

/**
 * Short codes used by BrickLink's store-search AJAX endpoint (P/S/M). These are
 * the same codes the unified price cache uses (PgType), so no mapping needed.
 */
type StoreItemCode = 'P' | 'S' | 'M';
const ITEM_TYPES = (argv['item-types'] ?? 'P,S,M').split(',') as StoreItemCode[];
const MAX_PAGES = Math.min(20, parseInt(argv['max-pages'] ?? '20', 10)); // hard cap 20
const PAGE_DELAY_MS = Math.max(3000, parseInt(argv['page-delay-ms'] ?? '3000', 10)); // hard floor 3000ms
const API_DELAY_MS = parseInt(argv['api-delay-ms'] ?? '250', 10);
const MIN_DISCOUNT = parseFloat(argv['min-discount'] ?? '0.20'); // ask ≤ (1 - this) × sold avg
const MIN_TIMES_SOLD = parseInt(argv['min-times-sold'] ?? '10', 10);
const API_BUDGET = parseInt(argv['api-budget'] ?? '4500', 10);
const CDP_PORT = parseInt(argv['cdp-port'] ?? '9222', 10);
const REQUIRE_UK = (argv['require-uk'] ?? 'true') !== 'false';

const BL_SELLER_FEE_RATE = 0.07;
const CACHE_TTL_DAYS = 180; // unified price-guide cache freshness window for this script

const OUT_DIR = path.resolve(__dirname, `../../../tmp/stores/${STORE_SLUG}`);
const LOCK_FILE = path.join(OUT_DIR, 'scan.lock');
const INVENTORY_FILE = path.join(OUT_DIR, 'inventory.json');
const ENRICHED_FILE = path.join(OUT_DIR, 'enriched.json');
const REPORT_FILE = path.join(OUT_DIR, 'report.html');
const CACHE_PROGRESS_FILE = path.join(OUT_DIR, 'cache-progress.json');

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const creds = {
  consumerKey: process.env.BRICKLINK_CONSUMER_KEY ?? '',
  consumerSecret: process.env.BRICKLINK_CONSUMER_SECRET ?? '',
  tokenValue: process.env.BRICKLINK_TOKEN_VALUE ?? '',
  tokenSecret: process.env.BRICKLINK_TOKEN_SECRET ?? '',
};
for (const [k, v] of Object.entries(creds)) {
  if (!v) {
    console.error(`Missing BRICKLINK_${k.replace(/([A-Z])/g, '_$1').toUpperCase()}`);
    process.exit(1);
  }
}
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase env');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);
const bl = new BrickLinkClient(creds, { supabase, caller: 'scan-bl-store-script' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ItemCondition = 'N' | 'U';

interface ScrapedItem {
  invID: number;
  itemType: StoreItemCode;
  itemNo: string;
  colourId: number;
  colourName: string | null;
  itemName: string;
  invNew: string; // "New" | "Used"
  invComplete: string | null;
  invQty: number;
  unitPriceGBP: number; // nativePrice if GBP seller, else converted
  salePercent: number | null;
  description: string | null;
  pageIndex: number;
}

interface EnrichedItem extends ScrapedItem {
  condition: ItemCondition;
  benchmark: number | null; // sold avg (£)
  timesSold: number | null;
  source: 'cache' | 'api' | 'brickset' | 'none';
  fresh: boolean;
  profit: number | null;
  discount: number | null;
  margin: number | null;
  liquidity: number | null;
  score: number | null;
  passed: boolean;
  rejectReason?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Detect damage notes in a seller's lot description. Returns true if the
 * description mentions physical defects (dents, scratches, cracks, etc.) that
 * are NOT negated by phrases like "no scratches", "scratch free", "without damage".
 *
 * This matters because a damaged lot sells slower + at a lower price than the
 * condition-wide sold average, so any margin projection based on the mean is
 * optimistic. Chris hit this with a Snape torso marked "a few dents and
 * scratches" in an otherwise good arbitrage basket.
 */
const DAMAGE_KEYWORDS = new Set([
  'dent','dents','scratch','scratches','scratched','crack','cracks','cracked',
  'chip','chipped','chips','damage','damaged','damages','fade','faded',
  'yellow','yellowed','yellowing','marked','marks','broken','bent',
  'tear','torn','sticky','cloudy','scuffed','scuff','worn',
  'discolour','discoloured','discolor','discolored','bitten','warped','flaw','flawed',
]);
const NEGATION_PREFIXES: string[][] = [['no'], ['without'], ['not'], ['free','of'], ['free','from'], ['zero']];

function hasDamageNote(desc: string | null | undefined): { flag: boolean; keyword?: string } {
  if (!desc) return { flag: false };
  const cleaned = desc
    .toLowerCase()
    .replace(/[-–—,;:()/]/g, ' ')
    .replace(/[.!?"']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const words = cleaned.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    if (!DAMAGE_KEYWORDS.has(words[i])) continue;
    let negated = false;
    for (const neg of NEGATION_PREFIXES) {
      const start = i - neg.length;
      if (start < 0) continue;
      let match = true;
      for (let k = 0; k < neg.length; k++) {
        if (words[start + k] !== neg[k]) { match = false; break; }
      }
      if (match) { negated = true; break; }
    }
    // Handle "<keyword> free" pattern (scratch free, damage free, etc.)
    if (!negated && i + 1 < words.length && words[i + 1] === 'free') negated = true;
    if (!negated) return { flag: true, keyword: words[i] };
  }
  return { flag: false };
}

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function writeJson(p: string, data: unknown) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function readJson<T>(p: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    const pid = fs.readFileSync(LOCK_FILE, 'utf8').trim();
    console.error(`[lock] Existing scan in progress (pid=${pid}). Delete ${LOCK_FILE} if stale.`);
    process.exit(1);
  }
  fs.writeFileSync(LOCK_FILE, String(process.pid));
  const release = () => {
    try {
      fs.unlinkSync(LOCK_FILE);
    } catch { /* ignore */ }
  };
  process.on('exit', release);
  process.on('SIGINT', () => { release(); process.exit(130); });
  process.on('SIGTERM', () => { release(); process.exit(143); });
}

// ---------------------------------------------------------------------------
// Chrome CDP client (minimal, raw WebSocket)
// ---------------------------------------------------------------------------

class CDPClient {
  private ws: WebSocket | null = null;
  private msgId = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  async connect(wsUrl: string): Promise<void> {
    this.ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      this.ws!.once('open', () => resolve());
      this.ws!.once('error', (err) => reject(err));
    });
    this.ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as {
        id?: number;
        result?: unknown;
        error?: { message: string };
      };
      if (msg.id && this.pending.has(msg.id)) {
        const handler = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) handler.reject(new Error(msg.error.message));
        else handler.resolve(msg.result);
      }
    });
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.ws!.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate<T>(expression: string, awaitPromise = false): Promise<T> {
    const res = await this.send<{ result?: { value?: T }; exceptionDetails?: { text: string } }>(
      'Runtime.evaluate',
      { expression, awaitPromise, returnByValue: true },
    );
    if (res.exceptionDetails) throw new Error(`CDP eval failed: ${res.exceptionDetails.text}`);
    return res.result?.value as T;
  }

  close() {
    this.ws?.close();
  }
}

async function findOrCreateBLTab(): Promise<string> {
  const storeUrl = `https://store.bricklink.com/${STORE_SLUG}#/shop`;
  const tabs = (await fetch(`http://127.0.0.1:${CDP_PORT}/json`).then((r) => r.json())) as Array<{
    type: string;
    url: string;
    webSocketDebuggerUrl: string;
    id: string;
  }>;

  const existing = tabs.find((t) => t.type === 'page' && t.url.includes(STORE_SLUG));
  if (existing) return existing.webSocketDebuggerUrl;

  const blank = tabs.find((t) => t.type === 'page' && (t.url.startsWith('chrome://newtab') || t.url === 'about:blank'));
  if (!blank) {
    const opened = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(storeUrl)}`).then((r) => r.json()) as { webSocketDebuggerUrl: string };
    await sleep(5000);
    return opened.webSocketDebuggerUrl;
  }
  return blank.webSocketDebuggerUrl;
}

// ---------------------------------------------------------------------------
// Step 1: Preflight
// ---------------------------------------------------------------------------

async function preflight(cdp: CDPClient): Promise<{ country: string; storeName: string; usdToGbp: number }> {
  console.log('[preflight] Checking store identity and UK status...');
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const url = `https://store.bricklink.com/${STORE_SLUG}#/shop`;
  await cdp.send('Page.navigate', { url });
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    const state = await cdp.evaluate<string>('document.readyState');
    if (state === 'complete') break;
  }
  await sleep(3000); // SPA hydrate

  const meta = await cdp.evaluate<string>(`(() => {
    const sf = window.StoreFront;
    // StoreFront.store.country is unreliable (undefined for many stores).
    // Fall back to substring match on the visible header ("in <City>, <Country>").
    const bodyText = (document.body.innerText || '').slice(0, 2000);
    const headerMatch = bodyText.match(/\\bBy\\s+\\S+[^\\n]*?in\\s+([^\\n]+?)\\s{2,}/);
    const headerCountry = headerMatch ? headerMatch[1] : null;
    const isUK = /United Kingdom/i.test(bodyText);
    const country = isUK ? 'United Kingdom' : headerCountry;
    return JSON.stringify({
      storeId: sf?.store?.id,
      name: sf?.store?.name,
      country,
      countryFromSF: sf?.store?.country,
    });
  })()`);
  const parsed = JSON.parse(meta) as { storeId: number; name: string; country: string | null; countryFromSF: string | null };

  if (String(parsed.storeId) !== STORE_ID) {
    throw new Error(`Store ID mismatch: page says ${parsed.storeId}, arg says ${STORE_ID}`);
  }

  const countryText = parsed.country ?? parsed.countryFromSF;
  const isUK = countryText === 'United Kingdom' || countryText === 'GB' || countryText === 'UK';
  if (REQUIRE_UK && !isUK) {
    throw new Error(`Store country is "${countryText ?? 'unknown'}", not UK — aborting (override with --require-uk=false)`);
  }

  // Derive USD→GBP rate by sampling one item's native vs raw converted price
  const sample = await cdp.evaluate<string>(`(async () => {
    try {
      const res = await fetch('/ajax/clone/store/searchitems.ajax?sort=1&itemType=P&showHomeItems=0&pgSize=1&rpp=1&pg=1&sid=${STORE_ID}', {
        headers: { 'X-Requested-With':'XMLHttpRequest', 'Accept':'application/json' },
        credentials:'include',
      });
      const j = await res.json();
      const it = j.result?.groups?.[0]?.items?.[0];
      return JSON.stringify({ nativePrice: it?.nativePrice, rawConvertedPrice: it?.rawConvertedPrice, nativeCurrency: it?.nativeCurrency });
    } catch(e) { return JSON.stringify({ err: e.message }); }
  })()`, true);
  const s = JSON.parse(sample) as { nativePrice?: number; rawConvertedPrice?: number; nativeCurrency?: string; err?: string };

  let usdToGbp = 0.78; // fallback
  if (s.nativeCurrency === 'GBP' && s.nativePrice && s.rawConvertedPrice && s.rawConvertedPrice > 0) {
    usdToGbp = s.nativePrice / s.rawConvertedPrice;
  }
  console.log(`[preflight] store=${parsed.name}, country=${countryText ?? '(unknown)'}, USD→GBP=${usdToGbp.toFixed(4)} (native=${s.nativeCurrency})`);

  return { country: countryText ?? 'unknown', storeName: parsed.name, usdToGbp };
}

// ---------------------------------------------------------------------------
// Step 2: Scrape inventory (per item type)
// ---------------------------------------------------------------------------

async function scrapeInventory(cdp: CDPClient, usdToGbp: number, isUkStore: boolean): Promise<ScrapedItem[]> {
  const all: ScrapedItem[] = [];
  const seenInv = new Set<number>();

  for (const type of ITEM_TYPES) {
    console.log(`\n[scrape] itemType=${type}`);
    let pagesFetched = 0;
    for (let pg = 1; pg <= MAX_PAGES; pg++) {
      const url = `https://store.bricklink.com/ajax/clone/store/searchitems.ajax?sort=1&itemType=${type}&showHomeItems=0&pgSize=100&rpp=100&pg=${pg}&sid=${STORE_ID}`;

      const raw = await cdp.evaluate<string>(`(async () => {
        try {
          const res = await fetch(${JSON.stringify(url)}, {
            headers: { 'X-Requested-With':'XMLHttpRequest', 'Accept':'application/json' },
            credentials: 'include',
          });
          if (!res.ok) return JSON.stringify({ err: 'HTTP ' + res.status });
          const text = await res.text();
          if (text.trim().startsWith('<')) return JSON.stringify({ err: 'HTML response (login redirect / captcha)', snippet: text.slice(0,120) });
          return text;
        } catch (e) { return JSON.stringify({ err: e.message }); }
      })()`, true);

      let parsed: { result?: { groups?: Array<{ items?: Array<Record<string, unknown>> }> }; err?: string; snippet?: string };
      try {
        parsed = JSON.parse(raw);
      } catch {
        console.error(`[scrape] ${type} pg=${pg}: non-JSON response — aborting this type`);
        break;
      }

      if ((parsed as { err?: string }).err) {
        console.error(`[scrape] ${type} pg=${pg}: ${(parsed as { err?: string }).err}`);
        break;
      }

      const items = parsed.result?.groups?.[0]?.items ?? [];
      if (items.length === 0) {
        console.log(`[scrape] ${type} pg=${pg}: empty — stopping`);
        break;
      }

      let added = 0;
      for (const it of items) {
        const invID = Number((it as { invID: unknown }).invID);
        if (seenInv.has(invID)) continue;
        seenInv.add(invID);
        const rawConv = Number((it as { rawConvertedPrice: unknown }).rawConvertedPrice);
        const nativePrice = Number((it as { nativePrice: unknown }).nativePrice);
        // BL's AJAX rarely returns `nativeCurrency`, but for UK sellers we know nativePrice
        // is in GBP. Using rawConvertedPrice × USD→GBP is a trap when BL already displays
        // GBP to a UK buyer — the "raw" field is effectively native currency.
        const unitPriceGBP = isUkStore && nativePrice > 0
          ? nativePrice
          : Number.isFinite(rawConv) ? rawConv * usdToGbp : 0;
        all.push({
          invID,
          itemType: type,
          itemNo: String((it as { itemNo: unknown }).itemNo),
          colourId: Number((it as { colorID: unknown }).colorID ?? 0),
          colourName: ((it as { colorName?: string }).colorName) ?? null,
          itemName: String((it as { itemName: unknown }).itemName),
          invNew: String((it as { invNew: unknown }).invNew),
          invComplete: (it as { invComplete?: string }).invComplete ?? null,
          invQty: Number((it as { invQty: unknown }).invQty),
          unitPriceGBP,
          salePercent: (it as { salePercent?: number }).salePercent ?? null,
          description: (it as { invDescription?: string }).invDescription ?? null,
          pageIndex: pg,
        });
        added++;
      }

      pagesFetched++;
      console.log(`[scrape] ${type} pg=${pg}: +${added} items (total ${all.length})`);

      if (added === 0) {
        console.log(`[scrape] ${type} pg=${pg}: no new items — stopping`);
        break;
      }

      if (pg < MAX_PAGES) await sleep(PAGE_DELAY_MS);
    }
    console.log(`[scrape] itemType=${type} done (${pagesFetched} pages fetched)`);
  }

  writeJson(INVENTORY_FILE, all);
  console.log(`\n[scrape] Total unique items scraped: ${all.length} (saved to inventory.json)`);
  return all;
}

// ---------------------------------------------------------------------------
// Step 3 + 4: Cache lookup + BL API fetch
// ---------------------------------------------------------------------------

async function lookupCache(items: ScrapedItem[]): Promise<Map<string, { benchmark: number | null; timesSold: number; fresh: boolean; source: 'cache' | 'brickset' }>> {
  const result = new Map<string, { benchmark: number | null; timesSold: number; fresh: boolean; source: 'cache' | 'brickset' }>();

  // Parts + minifigs → unified price cache via readPriceGuide (strict UK, no
  // world fallback). Rows are complete (all 4 quadrants), so one row serves
  // both conditions; rows older than CACHE_TTL_DAYS read back as misses.
  const partItems = items.filter((i) => i.itemType === 'P' || i.itemType === 'M');
  if (partItems.length > 0) {
    const refs: ItemRef[] = [...new Map(partItems.map((i) => [
      `${i.itemType}:${i.itemNo}:${i.colourId}`,
      { itemType: i.itemType as 'P' | 'M', itemNo: i.itemNo, colourId: i.colourId, scheme: 'bl' as const },
    ])).values()];
    const views = await readPriceGuide(supabase, refs, { ttlDays: CACHE_TTL_DAYS, allowWorldFallback: false });
    for (const ref of refs) {
      const view = views.get(pgKey(ref.itemType, ref.itemNo, ref.colourId));
      if (!view || view.coverage !== 'uk') continue; // cache miss → API step
      for (const cond of ['N', 'U'] as const) {
        const side = cond === 'N' ? view.new : view.used;
        const key = `${ref.itemType}:${ref.itemNo}:${ref.colourId}:${cond}`;
        if (side.soldAvg !== null && side.soldAvg > 0) {
          result.set(key, { benchmark: side.soldAvg, timesSold: side.soldQty, fresh: true, source: 'cache' });
        } else if (side.soldQty === 0) {
          // fresh row, genuinely no UK sales in 6mo — record the null so the API
          // step doesn't re-pay for it; scores as 'no benchmark'
          result.set(key, { benchmark: null, timesSold: 0, fresh: true, source: 'cache' });
        }
      }
    }
    console.log(`[cache] Found ${result.size} fresh cache entries for parts/minifigs`);
  }

  // Sets → brickset_sets.bricklink_sold_price_*
  const setItems = items.filter((i) => i.itemType === 'S');
  if (setItems.length > 0) {
    const setNos = [...new Set(setItems.map((i) => i.itemNo))];
    const { data, error } = await supabase
      .from('brickset_sets')
      .select('set_number, bricklink_sold_price_new, bricklink_sold_price_used')
      .in('set_number', setNos);
    if (error) console.error('[cache] Set query failed:', error.message);
    for (const row of (data ?? []) as Array<{ set_number: string; bricklink_sold_price_new: string | null; bricklink_sold_price_used: string | null }>) {
      for (const cond of ['N', 'U'] as const) {
        const priceStr = cond === 'N' ? row.bricklink_sold_price_new : row.bricklink_sold_price_used;
        if (!priceStr) continue;
        const price = parseFloat(priceStr);
        if (!(price > 0)) continue;
        // Set cache lacks times_sold — we use a nominal value (100) to let sets pass the liquidity gate
        // (sets with active Brickset snapshots are generally liquid at retail level).
        result.set(`S:${row.set_number}:0:${cond}`, { benchmark: price, timesSold: 100, fresh: true, source: 'brickset' });
      }
    }
  }

  return result;
}

async function fetchMissingPrices(
  items: ScrapedItem[],
  cached: Map<string, { benchmark: number | null; timesSold: number; fresh: boolean; source: 'cache' | 'brickset' }>,
): Promise<Map<string, { benchmark: number; timesSold: number; fresh: boolean; source: 'api' }>> {
  const fresh = new Map<string, { benchmark: number; timesSold: number; fresh: boolean; source: 'api' }>();
  const progress = readJson<{ done: string[]; callsUsed: number }>(CACHE_PROGRESS_FILE, { done: [], callsUsed: 0 });
  const doneSet = new Set(progress.done);

  const uncached = items.filter((it) => {
    const cond: ItemCondition = it.invNew === 'New' ? 'N' : 'U';
    const key = `${it.itemType}:${it.itemNo}:${it.colourId}:${cond}`;
    return !cached.has(key);
  });

  // Dedupe uncached by (type, itemNo, colourId): one ensurePriceGuide call fetches
  // ALL FOUR quadrants (4 API calls), covers BOTH conditions, and captures a
  // complete row in the unified cache automatically.
  const uniqueTuples = new Map<string, { itemType: StoreItemCode; itemNo: string; colourId: number; conditions: ItemCondition[] }>();
  for (const it of uncached) {
    const cond: ItemCondition = it.invNew === 'New' ? 'N' : 'U';
    const key = `${it.itemType}:${it.itemNo}:${it.colourId}`;
    const existing = uniqueTuples.get(key);
    if (existing) {
      if (!existing.conditions.includes(cond)) existing.conditions.push(cond);
    } else {
      uniqueTuples.set(key, { itemType: it.itemType, itemNo: it.itemNo, colourId: it.colourId, conditions: [cond] });
    }
  }

  console.log(`[api] ${uniqueTuples.size} unique (type,item,colour) tuples need fetching (4 calls each)`);

  for (const [key, t] of uniqueTuples) {
    if (doneSet.has(key)) continue;

    if (progress.callsUsed + 4 > API_BUDGET) {
      console.warn(`[api] Budget reached (${progress.callsUsed}/${API_BUDGET}). Remaining items will score as 'none'.`);
      break;
    }

    try {
      await sleep(API_DELAY_MS);
      const view = await ensurePriceGuide(bl, supabase, { itemType: t.itemType, itemNo: t.itemNo, colourId: t.colourId }, { ttlDays: CACHE_TTL_DAYS });
      progress.callsUsed += 4;
      for (const cond of t.conditions) {
        const side = cond === 'N' ? view.new : view.used;
        if (side.soldAvg !== null && side.soldAvg > 0) {
          fresh.set(`${key}:${cond}`, { benchmark: side.soldAvg, timesSold: side.soldQty, fresh: true, source: 'api' });
        }
      }
      progress.done.push(key);
    } catch (err) {
      if (err instanceof RateLimitError || (err instanceof BrickLinkApiError && err.code === 429)) {
        console.error('[api] Rate limit hit — aborting');
        break;
      }
      console.error(`[api] Failed ${key}:`, err instanceof Error ? err.message : err);
      progress.done.push(key); // don't retry broken items
    }

    if (progress.done.length % 25 === 0) {
      writeJson(CACHE_PROGRESS_FILE, progress);
      console.log(`[api] ${progress.done.length}/${uniqueTuples.size} fetched (${progress.callsUsed} calls used)`);
    }
  }
  writeJson(CACHE_PROGRESS_FILE, progress);

  // Capture happens inside ensurePriceGuide — no manual upsert-back to a legacy cache.
  return fresh;
}

// ---------------------------------------------------------------------------
// Step 5: Score
// ---------------------------------------------------------------------------

function scoreAll(
  items: ScrapedItem[],
  cached: Map<string, { benchmark: number | null; timesSold: number; fresh: boolean; source: 'cache' | 'brickset' }>,
  fresh: Map<string, { benchmark: number; timesSold: number; fresh: boolean; source: 'api' }>,
): EnrichedItem[] {
  const out: EnrichedItem[] = [];

  for (const it of items) {
    const cond: ItemCondition = it.invNew === 'New' ? 'N' : 'U';
    const key = `${it.itemType}:${it.itemNo}:${it.colourId}:${cond}`;
    const entry = cached.get(key) ?? fresh.get(key);

    const base: EnrichedItem = {
      ...it,
      condition: cond,
      benchmark: entry?.benchmark ?? null,
      timesSold: entry?.timesSold ?? null,
      source: entry?.source ?? 'none',
      fresh: entry?.fresh ?? false,
      profit: null,
      discount: null,
      margin: null,
      liquidity: null,
      score: null,
      passed: false,
    };

    if (!entry || entry.benchmark == null) {
      base.rejectReason = 'no benchmark';
      out.push(base);
      continue;
    }
    if ((entry.timesSold ?? 0) < MIN_TIMES_SOLD) {
      base.rejectReason = `times_sold < ${MIN_TIMES_SOLD}`;
      out.push(base);
      continue;
    }
    if (it.unitPriceGBP > entry.benchmark * (1 - MIN_DISCOUNT)) {
      base.rejectReason = `ask >= ${((1 - MIN_DISCOUNT) * 100).toFixed(0)}% of sold avg`;
      out.push(base);
      continue;
    }
    const damage = hasDamageNote(it.description);
    if (damage.flag) {
      base.rejectReason = `damage note: "${damage.keyword}"`;
      out.push(base);
      continue;
    }

    const revenue = entry.benchmark * (1 - BL_SELLER_FEE_RATE);
    const cost = it.unitPriceGBP; // zero shipping — basket assumption
    const profit = revenue - cost;
    if (profit <= 0) {
      base.rejectReason = 'no profit after BL fee';
      out.push(base);
      continue;
    }

    const discount = ((entry.benchmark - it.unitPriceGBP) / entry.benchmark) * 100;
    const margin = (profit / cost) * 100;
    const liquidity = Math.log10(Math.max(1, entry.timesSold)) / 2;
    const score = margin * liquidity;

    out.push({
      ...base,
      profit,
      discount,
      margin,
      liquidity,
      score,
      passed: true,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Step 6: HTML report
// ---------------------------------------------------------------------------

function escapeHtml(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderReport(enriched: EnrichedItem[], meta: { storeName: string; country: string; usdToGbp: number }): string {
  const passed = enriched.filter((e) => e.passed).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const totalOutlay = passed.reduce((s, e) => s + e.unitPriceGBP * e.invQty, 0);
  const totalGrossProfit = passed.reduce((s, e) => s + (e.profit ?? 0) * e.invQty, 0);
  const byType = {
    P: passed.filter((e) => e.itemType === 'P'),
    S: passed.filter((e) => e.itemType === 'S'),
    M: passed.filter((e) => e.itemType === 'M'),
  };

  const row = (e: EnrichedItem, i: number) => {
    const typeTag = e.itemType === 'M' ? 'FIG' : e.itemType === 'S' ? 'SET' : 'PART';
    const blUrl = e.itemType === 'S'
      ? `https://www.bricklink.com/v2/catalog/catalogitem.page?S=${encodeURIComponent(e.itemNo)}`
      : e.itemType === 'M'
      ? `https://www.bricklink.com/v2/catalog/catalogitem.page?M=${encodeURIComponent(e.itemNo)}`
      : `https://www.bricklink.com/v2/catalog/catalogitem.page?P=${encodeURIComponent(e.itemNo)}&idColor=${e.colourId}`;
    const srcBadge = e.source === 'cache' ? '<span class="src cache">cache</span>'
      : e.source === 'brickset' ? '<span class="src brickset">brickset</span>'
      : '<span class="src api">api</span>';
    const colour = e.colourName && e.itemType === 'P' ? ` <span class="colour">${escapeHtml(e.colourName)}</span>` : '';
    return `<tr>
      <td class="rank">${i + 1}</td>
      <td><span class="badge type-${typeTag.toLowerCase()}">${typeTag}</span></td>
      <td><div class="ident"><a href="${blUrl}" target="_blank">${e.itemNo}</a>${colour}</div><div class="name">${escapeHtml(e.itemName)}</div></td>
      <td class="num">£${e.benchmark?.toFixed(2) ?? '?'}</td>
      <td class="num">${e.timesSold ?? '?'}</td>
      <td class="num ask">£${e.unitPriceGBP.toFixed(2)}</td>
      <td class="num">${e.discount?.toFixed(0)}%</td>
      <td class="num">${e.margin?.toFixed(0)}%</td>
      <td class="num">${e.invQty}</td>
      <td class="num bold">£${((e.profit ?? 0) * e.invQty).toFixed(2)}</td>
      <td>${srcBadge}</td>
    </tr>`;
  };

  const tableFor = (label: string, rows: EnrichedItem[]) => rows.length === 0 ? '' : `
    <h2>${label} <span class="h2-count">(${rows.length})</span></h2>
    <table>
      <thead><tr>
        <th>#</th><th>Type</th><th>Item</th>
        <th class="num">Sold avg</th><th class="num">6mo sold</th>
        <th class="num">Ask (£)</th><th class="num">Disc.</th><th class="num">Margin</th>
        <th class="num">Qty</th><th class="num">Lot £</th><th>Source</th>
      </tr></thead>
      <tbody>${rows.map(row).join('\n')}</tbody>
    </table>`;

  return `<!doctype html>
<html><head><meta charset="utf-8">
<title>BL Store scan — ${escapeHtml(STORE_SLUG)}</title>
<style>
 :root { color-scheme: dark; }
 body { font-family: -apple-system, "Segoe UI", system-ui, sans-serif; margin: 24px; background:#0f1115; color:#e7e9ee; }
 h1 { margin: 0 0 4px; font-size: 24px; }
 h2 { margin: 32px 0 8px; font-size: 18px; color:#cbd5e1; }
 .h2-count { color:#6b7280; font-size: 14px; font-weight: 400; }
 .sub { color:#9aa3b2; margin-bottom: 20px; font-size: 13px; }
 table { width: 100%; border-collapse: collapse; font-size: 13px; }
 th { text-align: left; background:#1a1f2b; color:#9aa3b2; padding:10px 8px; font-weight: 500; }
 td { padding:10px 8px; border-bottom:1px solid #1a1f2b; vertical-align: top; }
 tr:hover td { background: #141823; }
 .rank { color:#556; width: 32px; }
 .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
 .ask { color:#4ade80; font-weight:600; }
 .bold { font-weight: 600; color:#fbbf24; }
 .ident { font-weight: 600; }
 .ident a { color:#60a5fa; text-decoration: none; }
 .ident a:hover { text-decoration: underline; }
 .colour { color:#9aa3b2; font-weight: 400; margin-left: 4px; }
 .name { color: #7a8394; font-size: 12px; max-width: 420px; }
 .badge { display:inline-block; padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: 700; color:#fff; }
 .type-part { background:#2563eb; } .type-set  { background:#dc2626; } .type-fig  { background:#6d28d9; }
 .src { font-size: 10px; padding: 2px 5px; border-radius: 3px; color:#9aa3b2; background:#1a1f2b; }
 .src.api { color:#fbbf24; }
 .src.cache { color:#4ade80; }
 .src.brickset { color:#60a5fa; }
 .summary { display:flex; gap:12px; margin-bottom: 20px; flex-wrap: wrap; }
 .stat { background:#1a1f2b; padding:12px 16px; border-radius:8px; min-width: 140px; }
 .stat .val { font-size: 22px; font-weight: 600; color: #4ade80; }
 .stat .lbl { color: #9aa3b2; font-size: 12px; }
 .legend { color:#6b7280; font-size:11px; margin-top: 32px; line-height: 1.6; }
</style>
</head><body>

<h1>BrickLink store scan — ${escapeHtml(meta.storeName)} <span style="color:#9aa3b2; font-size:18px; font-weight:400;">(${escapeHtml(STORE_SLUG)}, ${escapeHtml(meta.country)})</span></h1>
<div class="sub">${enriched.length} items scraped • ${passed.length} passing gates • ranked by margin % × log₁₀(times sold)/2</div>

<div class="summary">
  <div class="stat"><div class="val">${passed.length}</div><div class="lbl">opportunities</div></div>
  <div class="stat"><div class="val">£${totalOutlay.toFixed(2)}</div><div class="lbl">basket outlay</div></div>
  <div class="stat"><div class="val">£${totalGrossProfit.toFixed(2)}</div><div class="lbl">gross profit (if all sell at sold avg)</div></div>
  <div class="stat"><div class="val">${totalOutlay > 0 ? ((totalGrossProfit / totalOutlay) * 100).toFixed(0) : 0}%</div><div class="lbl">basket margin</div></div>
</div>

${tableFor('Sets', byType.S)}
${tableFor('Minifigs', byType.M)}
${tableFor('Parts', byType.P)}

<div class="legend">
  <b>Methodology.</b> Items scraped from ${escapeHtml(meta.storeName)} via BL's public AJAX endpoint (rate-limited, 3s between pages). Each item's asking price in GBP compared against the BL UK 6-month sold average at matching condition, sourced from (priority) <b>cache</b> (unified price cache bricklink_price_guide_cache, ${CACHE_TTL_DAYS}-day TTL, green); <b>brickset</b> (brickset_sets.bricklink_sold_price_*, blue); or <b>api</b> fresh fetch (amber, captured back to the unified cache). Profit = sold × (1 − ${(BL_SELLER_FEE_RATE * 100).toFixed(0)}% BL/payment fee) − ask. <b>Zero shipping assumed</b> — items will be bought together as a single-seller basket.
  Gates: times_sold ≥ ${MIN_TIMES_SOLD}, ask ≤ ${((1 - MIN_DISCOUNT) * 100).toFixed(0)}% of sold avg, positive profit.
</div>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  ensureDir(OUT_DIR);
  acquireLock();
  console.log(`[main] Scanning ${STORE_SLUG} (sID ${STORE_ID}), types=${ITEM_TYPES.join(',')}, max-pages=${MAX_PAGES}`);
  console.log(`[main] Output: ${OUT_DIR}`);

  // Connect to CDP
  const tabs = (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then((r) => r.json()).catch(() => null)) as { Browser?: string } | null;
  if (!tabs?.Browser) {
    console.error(`[main] Chrome CDP not reachable on port ${CDP_PORT}. Start it first.`);
    process.exit(1);
  }
  const wsUrl = await findOrCreateBLTab();
  const cdp = new CDPClient();
  await cdp.connect(wsUrl);

  try {
    const meta = await preflight(cdp);
    const isUkStore = meta.country === 'United Kingdom' || meta.country === 'GB' || meta.country === 'UK';
    const scraped = await scrapeInventory(cdp, meta.usdToGbp, isUkStore);
    cdp.close();

    console.log('\n[enrich] Looking up cached prices...');
    const cached = await lookupCache(scraped);
    console.log('\n[enrich] Fetching missing prices from BL API...');
    const fresh = await fetchMissingPrices(scraped, cached);

    console.log('\n[score] Scoring...');
    const enriched = scoreAll(scraped, cached, fresh);
    writeJson(ENRICHED_FILE, enriched);

    const html = renderReport(enriched, meta);
    fs.writeFileSync(REPORT_FILE, html);

    const passed = enriched.filter((e) => e.passed).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    console.log(`\n[done] ${enriched.length} items scraped, ${passed.length} passed gates`);
    console.log(`[done] Basket: £${passed.reduce((s, e) => s + e.unitPriceGBP * e.invQty, 0).toFixed(2)} outlay → £${passed.reduce((s, e) => s + (e.profit ?? 0) * e.invQty, 0).toFixed(2)} gross profit`);
    console.log(`[done] Report: ${REPORT_FILE}`);
    console.log('\nTop 10:');
    for (const [i, e] of passed.slice(0, 10).entries()) {
      console.log(`  ${i + 1}. [${e.itemType}] ${e.itemNo.padEnd(10)} sold £${e.benchmark?.toFixed(2)} × ${e.timesSold} | ask £${e.unitPriceGBP.toFixed(2)} × ${e.invQty} | ${e.discount?.toFixed(0)}%d ${e.margin?.toFixed(0)}%m | lot £${((e.profit ?? 0) * e.invQty).toFixed(2)}`);
    }
  } finally {
    cdp.close();
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
