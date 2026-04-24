/**
 * BrickLink seller basket builder.
 *
 * End-to-end: scrape a UK BL seller's inventory → cross-reference against BL 6-month
 * sold averages (cached + API) → apply Bricqer pricing formula → compute net profit
 * after BL/Bricqer/PayPal fees and proportional inbound postage → report → build
 * wanted list → upload to BL → select target store → create cart → validate cart
 * vs projection → prompt for BL order ID → persist to arbitrage_purchases.
 *
 * Supersedes the earlier research scripts: scan-bl-store.ts, apply-bricqer-pricing.ts,
 * gen-report-*.mjs, and upload-wanted.mjs.
 *
 * Usage (from apps/web):
 *   npx tsx scripts/bl-basket.ts --store-slug=Bruffty
 *   npx tsx scripts/bl-basket.ts --store-slug=Bruffty --shipping=2.20 --min-margin=0.20 --yes
 *
 * Flags:
 *   --store-slug=<name>     REQUIRED — BL store URL slug (e.g. Bruffty)
 *   --shipping=<gbp>        Inbound postage estimate. If omitted, prompt (default £3.00).
 *   --min-ask=<gbp>         Skip items where seller's ask is below this. Default £0.10.
 *   --min-str=<ratio>       Skip items where UK sell-through is below this. Default 0.
 *   --min-margin=<pct>      Skip items where net/list margin is below this. Default 0.20.
 *   --cache-ttl-days=<n>    Price cache freshness. Default 90.
 *   --max-pages=<n>         Max AJAX pages per item-type. Default 50.
 *   --page-delay-ms=<n>     Delay between AJAX pages. Default 3000 (floor).
 *   --api-delay-ms=<n>      Delay between BL API price-guide calls. Default 250.
 *   --reuse-scrape          Reuse tmp/stores/<slug>/inventory.json if <24h old.
 *   --skip-cart             Stop after report (no cart build).
 *   --yes                   Auto-approve report & proceed without user prompt.
 *   --user-id=<uuid>        Supabase user_id. Default Chris's ID.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import WebSocket from 'ws';
import { BrickLinkClient, BrickLinkApiError } from '../src/lib/bricklink/client';
import type { BrickLinkItemType, BrickLinkPriceGuide } from '../src/lib/bricklink/types';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

// ---------------------------------------------------------------------------
// CLI args + defaults
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

const SHIPPING_CLI = argv['shipping'] ? parseFloat(argv['shipping']) : null;
const MIN_ASK = parseFloat(argv['min-ask'] ?? '0.10');
const MIN_STR = parseFloat(argv['min-str'] ?? '0');
const MIN_MARGIN = parseFloat(argv['min-margin'] ?? '0.20');
const CACHE_TTL_DAYS = parseInt(argv['cache-ttl-days'] ?? '90', 10);
const MAX_PAGES = Math.min(50, parseInt(argv['max-pages'] ?? '50', 10));
const PAGE_DELAY_MS = Math.max(3000, parseInt(argv['page-delay-ms'] ?? '3000', 10));
const API_DELAY_MS = parseInt(argv['api-delay-ms'] ?? '250', 10);
const API_BUDGET = parseInt(argv['api-budget'] ?? '4500', 10);
const REUSE_SCRAPE = argv['reuse-scrape'] === 'true';
const SKIP_CART = argv['skip-cart'] === 'true';
const AUTO_YES = argv['yes'] === 'true';
const CDP_PORT = parseInt(argv['cdp-port'] ?? '9222', 10);
const USER_ID = argv['user-id'] ?? '4b6e94b4-661c-4462-9d14-b21df7d51e5b';

// Fee + velocity constants (Hadley Bricks verified — see memory)
const BL_FEE = 0.03;
const BRICQER_FEE = 0.035;
const PAYPAL_PCT = 0.029;
const VAR_FEE_PCT = BL_FEE + BRICQER_FEE + PAYPAL_PCT; // 9.4%
const PERSONAL_MONTHLY_LOT_RATE = 0.10; // midpoint of Oct 2025 peak (19.5%) and current ramp (1.2%)
const CART_VALIDATION_TOLERANCE = 0.05; // 5% of outlay

const OUT_DIR = path.resolve(__dirname, `../../../tmp/stores/${STORE_SLUG}`);
const LOCK_FILE = path.join(OUT_DIR, 'scan.lock');
const INVENTORY_FILE = path.join(OUT_DIR, 'inventory.json');
const ENRICHED_FILE = path.join(OUT_DIR, 'enriched.json');
const REPORT_FILE = path.join(OUT_DIR, `report-${new Date().toISOString().slice(0, 10)}.txt`);

const rl = readline.createInterface({ input, output });

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
  if (!v) { console.error(`Missing BRICKLINK_${k}`); process.exit(1); }
}
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) { console.error('Missing Supabase env'); process.exit(1); }
const supabase = createClient(supabaseUrl, supabaseKey);
const bl = new BrickLinkClient(creds);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StoreItemCode = 'P' | 'S' | 'M';
const STORE_TO_API: Record<StoreItemCode, BrickLinkItemType> = { P: 'PART', S: 'SET', M: 'MINIFIG' };
type ItemCondition = 'N' | 'U';

interface ScrapedItem {
  invID: number;
  itemType: StoreItemCode;
  itemNo: string;
  colourId: number;
  colourName: string | null;
  itemName: string;
  invNew: string;
  invComplete: string | null;
  invQty: number;
  unitPriceGBP: number;
  description: string | null;
}

interface EnrichedItem extends ScrapedItem {
  condition: ItemCondition;
  ukSoldAvg: number | null;
  ukSoldQty: number;
  ukStockQty: number;
  sellThru: number;
  bricqerMultiplier: number;
  listPrice: number | null;
  inboundPerUnit: number;
  netPerUnit: number | null;
  lotProfit: number | null;
  marginPct: number | null;
  mos: number | null;
  source: 'cache' | 'brickset' | 'api' | 'none';
  passed: boolean;
  rejectReason?: string;
}

interface RunInputs {
  shipping: number;
  minAsk: number;
  minStr: number;
  minMargin: number;
  cacheTtlDays: number;
  feeModel: { blFee: number; bricqerFee: number; paypalPct: number };
  velocityBaseline: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function ensureDir(p: string) { fs.mkdirSync(p, { recursive: true }); }
function readJson<T>(p: string, fallback: T): T { try { return JSON.parse(fs.readFileSync(p, 'utf8')) as T; } catch { return fallback; } }
function writeJson(p: string, data: unknown) { fs.writeFileSync(p, JSON.stringify(data, null, 2)); }

function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    console.error(`[lock] Existing scan in progress. Delete ${LOCK_FILE} if stale.`);
    process.exit(1);
  }
  fs.writeFileSync(LOCK_FILE, String(process.pid));
  const release = () => { try { fs.unlinkSync(LOCK_FILE); } catch { /* ignore */ } };
  process.on('exit', release);
  process.on('SIGINT', () => { release(); process.exit(130); });
  process.on('SIGTERM', () => { release(); process.exit(143); });
}

/** Damage-note filter. Negation-aware ("no scratches" is OK). See feedback_bl_condition_filter memory. */
const DAMAGE_KEYWORDS = new Set([
  'dent', 'dents', 'scratch', 'scratches', 'scratched', 'crack', 'cracks', 'cracked',
  'chip', 'chipped', 'chips', 'damage', 'damaged', 'damages', 'fade', 'faded',
  'yellow', 'yellowed', 'yellowing', 'marked', 'marks', 'broken', 'bent',
  'tear', 'torn', 'sticky', 'cloudy', 'scuffed', 'scuff', 'worn',
  'discolour', 'discoloured', 'discolor', 'discolored', 'bitten', 'warped', 'flaw', 'flawed',
]);
const NEGATION_PREFIXES: string[][] = [['no'], ['without'], ['not'], ['free', 'of'], ['free', 'from'], ['zero']];

function hasDamageNote(desc: string | null | undefined): { flag: boolean; keyword?: string } {
  if (!desc) return { flag: false };
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
    if (!negated) return { flag: true, keyword: words[i] };
  }
  return { flag: false };
}

function bricqerMultiplier(condition: ItemCondition, sellThru: number): number {
  if (condition === 'N') return sellThru >= 0.5 ? 1.05 : 0.90;
  if (sellThru >= 1) return 1.25;
  if (sellThru >= 0.75) return 1.15;
  if (sellThru >= 0.5) return 1.10;
  if (sellThru >= 0.25) return 0.90;
  return 0.85;
}

// ---------------------------------------------------------------------------
// CDP client
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
      const msg = JSON.parse(data.toString()) as { id?: number; result?: unknown; error?: { message: string } };
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
    const res = await this.send<{ result?: { value?: T }; exceptionDetails?: { text: string } }>('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (res.exceptionDetails) throw new Error(`CDP eval failed: ${res.exceptionDetails.text}`);
    return res.result?.value as T;
  }
  async navigate(url: string, waitMs = 4000) {
    await this.send('Page.navigate', { url });
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      const state = await this.evaluate<string>('document.readyState');
      if (state === 'complete') break;
    }
    await sleep(waitMs);
  }
  close() { this.ws?.close(); }
}

async function connectCdp(): Promise<CDPClient> {
  const version = (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then((r) => r.json()).catch(() => null)) as { Browser?: string } | null;
  if (!version?.Browser) {
    console.error(`[cdp] Chrome CDP not reachable on :${CDP_PORT}. Start C:\\chrome-cdp\\launch-cdp-chrome.bat, log in to BrickLink, then re-run.`);
    process.exit(1);
  }
  const tabs = (await fetch(`http://127.0.0.1:${CDP_PORT}/json`).then((r) => r.json())) as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
  const existing = tabs.find((t) => t.type === 'page' && t.url.includes(STORE_SLUG));
  const blank = tabs.find((t) => t.type === 'page');
  const wsUrl = (existing ?? blank)?.webSocketDebuggerUrl;
  if (!wsUrl) { console.error('[cdp] No page tab available'); process.exit(1); }
  const cdp = new CDPClient();
  await cdp.connect(wsUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  return cdp;
}

// ---------------------------------------------------------------------------
// Phase 1: Preflight
// ---------------------------------------------------------------------------

async function preflight(cdp: CDPClient): Promise<{ storeId: number; storeName: string; country: string; isUK: boolean }> {
  console.log('\n[1/10] Preflight...');
  await cdp.navigate(`https://store.bricklink.com/${STORE_SLUG}#/shop`);
  const meta = await cdp.evaluate<string>(`(() => {
    const sf = window.StoreFront;
    const bodyText = (document.body.innerText || '').slice(0, 2000);
    const isUK = /United Kingdom/i.test(bodyText);
    const countryMatch = bodyText.match(/\\bBy\\s+\\S+[^\\n]*?in\\s+([^\\n]+?)\\s{2,}/);
    const country = isUK ? 'United Kingdom' : (countryMatch ? countryMatch[1] : 'unknown');
    return JSON.stringify({ storeId: sf?.store?.id, storeName: sf?.store?.name, country });
  })()`);
  const parsed = JSON.parse(meta) as { storeId: number; storeName: string; country: string };
  const isUK = parsed.country === 'United Kingdom';
  if (!isUK) { console.error(`[preflight] Store country is "${parsed.country}", not UK — aborting`); process.exit(1); }
  console.log(`  store: ${parsed.storeName} (${parsed.country}, ID ${parsed.storeId})`);
  return { storeId: parsed.storeId, storeName: parsed.storeName, country: parsed.country, isUK };
}

// ---------------------------------------------------------------------------
// Phase 2: Scrape
// ---------------------------------------------------------------------------

async function scrapeInventory(cdp: CDPClient, storeId: number): Promise<ScrapedItem[]> {
  // Reuse if fresh
  if (fs.existsSync(INVENTORY_FILE)) {
    const ageH = (Date.now() - fs.statSync(INVENTORY_FILE).mtimeMs) / 3600000;
    if (REUSE_SCRAPE || ageH < 24) {
      const cached = readJson<ScrapedItem[]>(INVENTORY_FILE, []);
      if (cached.length > 0) {
        console.log(`\n[2/10] Reusing cached inventory (age ${ageH.toFixed(1)}h, ${cached.length} items)`);
        return cached;
      }
    }
  }

  console.log('\n[2/10] Scraping inventory (AJAX, 3s/page, max 50 pages per type)...');
  const all: ScrapedItem[] = [];
  const seen = new Set<number>();

  for (const type of ['P', 'S', 'M'] as StoreItemCode[]) {
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
      try { parsed = JSON.parse(raw); } catch { console.error(`[scrape] ${type} pg=${pg}: non-JSON, stopping`); break; }
      if ((parsed as { err?: string }).err) { console.error(`[scrape] ${type} pg=${pg}: ${(parsed as { err?: string }).err}`); break; }
      const items = parsed.result?.groups?.[0]?.items ?? [];
      if (items.length === 0) break;
      let added = 0;
      for (const it of items) {
        const invID = Number((it as { invID: unknown }).invID);
        if (seen.has(invID)) continue;
        seen.add(invID);
        const nativePrice = Number((it as { nativePrice: unknown }).nativePrice);
        const rawConv = Number((it as { rawConvertedPrice: unknown }).rawConvertedPrice);
        // UK store: nativePrice is GBP. Fall back to rawConvertedPrice only if missing.
        const unitPriceGBP = nativePrice > 0 ? nativePrice : (Number.isFinite(rawConv) ? rawConv : 0);
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
          description: (it as { invDescription?: string }).invDescription ?? null,
        });
        added++;
      }
      console.log(`  [${type}] pg=${pg} +${added} (total ${all.length})`);
      if (added === 0) break;
      if (pg < MAX_PAGES) await sleep(PAGE_DELAY_MS);
    }
  }
  writeJson(INVENTORY_FILE, all);
  console.log(`  scraped ${all.length} items → inventory.json`);
  return all;
}

// ---------------------------------------------------------------------------
// Phase 3: Enrich (cache-first, 2 BL calls per uncached item)
// ---------------------------------------------------------------------------

async function enrichWithPrices(items: ScrapedItem[]): Promise<Map<string, { ukSoldAvg: number | null; ukSoldQty: number; ukStockQty: number; source: 'cache' | 'brickset' | 'api' | 'none' }>> {
  console.log(`\n[3/10] Enriching ${items.length} items with UK sold/stock data (cache TTL ${CACHE_TTL_DAYS}d)...`);
  const out = new Map<string, { ukSoldAvg: number | null; ukSoldQty: number; ukStockQty: number; source: 'cache' | 'brickset' | 'api' | 'none' }>();
  const now = Date.now();
  const ttlMs = CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;

  // Parts + minifigs → bricklink_part_price_cache
  const pmItems = items.filter((i) => i.itemType === 'P' || i.itemType === 'M');
  const uniquePartNos = [...new Set(pmItems.map((i) => i.itemNo))];
  const CHUNK = 500;
  for (let i = 0; i < uniquePartNos.length; i += CHUNK) {
    const chunk = uniquePartNos.slice(i, i + CHUNK);
    const { data } = await supabase
      .from('bricklink_part_price_cache')
      .select('part_number, part_type, colour_id, price_new, price_used, stock_available_new, stock_available_used, times_sold_new, times_sold_used, fetched_at')
      .in('part_number', chunk);
    for (const row of (data ?? []) as Array<{ part_number: string; part_type: string; colour_id: number; price_new: string | null; price_used: string | null; stock_available_new: number | null; stock_available_used: number | null; times_sold_new: number | null; times_sold_used: number | null; fetched_at: string }>) {
      const fresh = now - new Date(row.fetched_at).getTime() < ttlMs;
      if (!fresh) continue;
      for (const cond of ['N', 'U'] as const) {
        const priceStr = cond === 'N' ? row.price_new : row.price_used;
        const stock = cond === 'N' ? row.stock_available_new : row.stock_available_used;
        const sold = cond === 'N' ? row.times_sold_new : row.times_sold_used;
        // Require ALL THREE fields (price + stock + sold) — partial cache rows
        // (from older partout runs that didn't always write velocity) get treated as misses
        // and re-fetched so we get fresh UK velocity data for the Bricqer formula.
        if (priceStr == null || stock == null || sold == null || stock === 0) continue;
        const price = parseFloat(priceStr);
        if (!(price > 0)) continue;
        const key = `${row.part_type === 'PART' ? 'P' : 'M'}:${row.part_number}:${row.colour_id}:${cond}`;
        out.set(key, { ukSoldAvg: price, ukSoldQty: sold, ukStockQty: stock, source: 'cache' });
      }
    }
  }
  console.log(`  cache hit: ${out.size} tuples`);

  // Sets → brickset_sets
  const setItems = items.filter((i) => i.itemType === 'S');
  if (setItems.length > 0) {
    const setNos = [...new Set(setItems.map((i) => i.itemNo))];
    const { data } = await supabase
      .from('brickset_sets')
      .select('set_number, bricklink_sold_price_new, bricklink_sold_price_used')
      .in('set_number', setNos);
    for (const row of (data ?? []) as Array<{ set_number: string; bricklink_sold_price_new: string | null; bricklink_sold_price_used: string | null }>) {
      for (const cond of ['N', 'U'] as const) {
        const priceStr = cond === 'N' ? row.bricklink_sold_price_new : row.bricklink_sold_price_used;
        if (!priceStr) continue;
        const price = parseFloat(priceStr);
        if (!(price > 0)) continue;
        out.set(`S:${row.set_number}:0:${cond}`, { ukSoldAvg: price, ukSoldQty: 50, ukStockQty: 50, source: 'brickset' });
      }
    }
  }

  // Missing → fetch from BL API (UK sold + UK stock)
  const needed = new Map<string, { itemType: StoreItemCode; itemNo: string; colourId: number; condition: ItemCondition; itemName: string }>();
  for (const it of items) {
    const cond: ItemCondition = it.invNew === 'New' ? 'N' : 'U';
    const key = `${it.itemType}:${it.itemNo}:${it.colourId}:${cond}`;
    if (out.has(key)) continue;
    if (it.itemType === 'S') continue; // sets skipped if no brickset data — can't cost-effectively fetch
    if (!needed.has(key)) needed.set(key, { itemType: it.itemType, itemNo: it.itemNo, colourId: it.colourId, condition: cond, itemName: it.itemName });
  }

  console.log(`  need to fetch: ${needed.size} tuples from BL API`);
  let calls = 0;
  const forUpsert: Array<{ partNumber: string; partType: string; colourId: number; condition: ItemCondition; price: number; stockQty: number; soldQty: number }> = [];
  for (const [key, t] of needed) {
    if (calls + 2 > API_BUDGET) { console.warn(`  API budget reached (${calls}/${API_BUDGET})`); break; }
    try {
      await sleep(API_DELAY_MS);
      const sold: BrickLinkPriceGuide = await bl.getPartPriceGuide(STORE_TO_API[t.itemType], t.itemNo, t.colourId, { condition: t.condition, guideType: 'sold', currencyCode: 'GBP', countryCode: 'UK' });
      calls++;
      await sleep(API_DELAY_MS);
      const stock: BrickLinkPriceGuide = await bl.getPartPriceGuide(STORE_TO_API[t.itemType], t.itemNo, t.colourId, { condition: t.condition, guideType: 'stock', currencyCode: 'GBP', countryCode: 'UK' });
      calls++;
      const avg = parseFloat(sold.avg_price);
      const soldQty = sold.total_quantity ?? 0;
      const stockQty = stock.total_quantity ?? 0;
      if (avg > 0) {
        out.set(key, { ukSoldAvg: avg, ukSoldQty: soldQty, ukStockQty: stockQty, source: 'api' });
        forUpsert.push({ partNumber: t.itemNo, partType: t.itemType === 'P' ? 'PART' : 'MINIFIG', colourId: t.colourId, condition: t.condition, price: avg, stockQty, soldQty });
      } else {
        out.set(key, { ukSoldAvg: null, ukSoldQty: 0, ukStockQty: 0, source: 'none' });
      }
      if (calls % 20 === 0) console.log(`  fetched ${calls} calls (${Math.ceil(calls / 2)}/${needed.size} tuples)`);
    } catch (err) {
      if (err instanceof BrickLinkApiError && err.code === 429) { console.error('  rate limit, stopping'); break; }
      out.set(key, { ukSoldAvg: null, ukSoldQty: 0, ukStockQty: 0, source: 'none' });
    }
  }

  // Upsert to cache
  if (forUpsert.length > 0) {
    // Aggregate by (partNumber, colourId) across conditions
    const byPartColour = new Map<string, { partNumber: string; partType: string; colourId: number; price_new: number | null; price_used: number | null; stock_new: number | null; stock_used: number | null; sold_new: number | null; sold_used: number | null }>();
    for (const u of forUpsert) {
      const k = `${u.partNumber}:${u.colourId}`;
      const existing = byPartColour.get(k) ?? { partNumber: u.partNumber, partType: u.partType, colourId: u.colourId, price_new: null, price_used: null, stock_new: null, stock_used: null, sold_new: null, sold_used: null };
      if (u.condition === 'N') { existing.price_new = u.price; existing.stock_new = u.stockQty; existing.sold_new = u.soldQty; }
      else { existing.price_used = u.price; existing.stock_used = u.stockQty; existing.sold_used = u.soldQty; }
      byPartColour.set(k, existing);
    }
    const rows = [...byPartColour.values()].map((r) => ({
      part_number: r.partNumber, part_type: r.partType, colour_id: r.colourId,
      price_new: r.price_new, price_used: r.price_used,
      stock_available_new: r.stock_new, stock_available_used: r.stock_used,
      times_sold_new: r.sold_new, times_sold_used: r.sold_used,
      fetched_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }));
    const CHUNK2 = 100;
    for (let i = 0; i < rows.length; i += CHUNK2) {
      const batch = rows.slice(i, i + CHUNK2);
      const { error } = await supabase.from('bricklink_part_price_cache').upsert(batch, { onConflict: 'part_number,colour_id', ignoreDuplicates: false });
      if (error) console.error('  upsert error:', error.message);
    }
    console.log(`  upserted ${rows.length} fresh rows to cache`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Phase 4: Score
// ---------------------------------------------------------------------------

function scoreAll(items: ScrapedItem[], priceMap: Map<string, { ukSoldAvg: number | null; ukSoldQty: number; ukStockQty: number; source: 'cache' | 'brickset' | 'api' | 'none' }>, inputs: RunInputs): EnrichedItem[] {
  // Apply hard filters first, compute list values, score, gate.
  const filtered = items.filter((it) => {
    if (it.unitPriceGBP < inputs.minAsk) return false;
    if (hasDamageNote(it.description).flag) return false;
    return true;
  });
  // Total list value for allocation of postage
  const preList: Array<{ it: ScrapedItem; listPrice: number; sellThru: number; entry: { ukSoldAvg: number | null; ukSoldQty: number; ukStockQty: number; source: 'cache' | 'brickset' | 'api' | 'none' } | undefined }> = [];
  for (const it of filtered) {
    const cond: ItemCondition = it.invNew === 'New' ? 'N' : 'U';
    const key = `${it.itemType}:${it.itemNo}:${it.colourId}:${cond}`;
    const entry = priceMap.get(key);
    if (!entry?.ukSoldAvg) { preList.push({ it, listPrice: 0, sellThru: 0, entry }); continue; }
    const sellThru = entry.ukStockQty > 0 ? entry.ukSoldQty / entry.ukStockQty : 0;
    const multiplier = bricqerMultiplier(cond, sellThru);
    const listPrice = entry.ukSoldAvg * multiplier;
    preList.push({ it, listPrice, sellThru, entry });
  }
  const totalListForAlloc = preList.reduce((s, p) => s + p.listPrice * p.it.invQty, 0);
  const avgSellThru = preList.filter((p) => p.listPrice > 0).reduce((s, p) => s + p.sellThru, 0) / Math.max(1, preList.filter((p) => p.listPrice > 0).length);

  const out: EnrichedItem[] = preList.map(({ it, listPrice, sellThru, entry }) => {
    const cond: ItemCondition = it.invNew === 'New' ? 'N' : 'U';
    const multiplier = bricqerMultiplier(cond, sellThru);
    const base: EnrichedItem = {
      ...it, condition: cond, ukSoldAvg: entry?.ukSoldAvg ?? null, ukSoldQty: entry?.ukSoldQty ?? 0, ukStockQty: entry?.ukStockQty ?? 0, sellThru, bricqerMultiplier: multiplier, listPrice: listPrice > 0 ? listPrice : null,
      inboundPerUnit: 0, netPerUnit: null, lotProfit: null, marginPct: null, mos: null,
      source: entry?.source ?? 'none', passed: false,
    };
    if (!entry?.ukSoldAvg || listPrice <= 0) { base.rejectReason = 'no benchmark'; return base; }
    const itemList = listPrice * it.invQty;
    const inboundPerUnit = totalListForAlloc > 0 ? (inputs.shipping * (itemList / totalListForAlloc)) / it.invQty : 0;
    const varFees = listPrice * VAR_FEE_PCT;
    const netPerUnit = listPrice - varFees - it.unitPriceGBP - inboundPerUnit;
    const lotProfit = netPerUnit * it.invQty;
    const marginPct = (netPerUnit / listPrice) * 100;
    const velocityRatio = avgSellThru > 0 ? sellThru / avgSellThru : 1;
    const monthlyRate = Math.min(1, Math.max(0.005, PERSONAL_MONTHLY_LOT_RATE * velocityRatio));
    const mos = 1 / monthlyRate;

    Object.assign(base, { inboundPerUnit, netPerUnit, lotProfit, marginPct, mos });
    if (sellThru < inputs.minStr) { base.rejectReason = `str ${sellThru.toFixed(2)} < ${inputs.minStr}`; return base; }
    if (marginPct / 100 < inputs.minMargin) { base.rejectReason = `margin ${marginPct.toFixed(0)}% < ${(inputs.minMargin * 100).toFixed(0)}%`; return base; }
    if (lotProfit <= 0) { base.rejectReason = 'no profit after fees'; return base; }
    base.passed = true;
    return base;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Phase 5: Render report
// ---------------------------------------------------------------------------

function renderReport(enriched: EnrichedItem[], meta: { storeName: string; country: string }, inputs: RunInputs): string {
  const passed = enriched.filter((e) => e.passed).sort((a, b) => (b.lotProfit ?? 0) - (a.lotProfit ?? 0));
  const totalOutlay = passed.reduce((s, o) => s + o.unitPriceGBP * o.invQty, 0);
  const totalList = passed.reduce((s, o) => s + (o.listPrice ?? 0) * o.invQty, 0);
  const totalNet = passed.reduce((s, o) => s + (o.lotProfit ?? 0), 0);
  const totalPieces = passed.reduce((s, o) => s + o.invQty, 0);
  const totalVarFees = totalList * VAR_FEE_PCT;
  const marginList = totalList > 0 ? (totalNet / totalList) * 100 : 0;
  const roiOutlay = totalOutlay > 0 ? (totalNet / totalOutlay) * 100 : 0;
  const top3 = passed.slice(0, 3).reduce((s, o) => s + (o.lotProfit ?? 0), 0);
  const top3Share = totalNet > 0 ? (top3 / totalNet) * 100 : 0;
  const avgStr = passed.length > 0 ? passed.reduce((s, o) => s + o.sellThru, 0) / passed.length : 0;
  const byMos = [...passed].sort((a, b) => (a.mos ?? 999) - (b.mos ?? 999));
  let cum = 0, mos50: number | null = null, mos80: number | null = null;
  for (const r of byMos) { cum += r.lotProfit ?? 0; if (!mos50 && cum >= 0.5 * totalNet) mos50 = r.mos; if (!mos80 && cum >= 0.8 * totalNet) mos80 = r.mos; }

  const padL = (s: string | number, n: number) => String(s).padStart(n);
  const pad = (s: string | number, n: number) => String(s).padEnd(n);
  const money = (n: number, w = 6) => padL('£' + n.toFixed(2), w);

  const L: string[] = [];
  L.push('');
  L.push(`  ${meta.storeName}  -  ${new Date().toISOString().slice(0, 10)}`);
  L.push(`  ${passed.length} lots / ${totalPieces} pieces`);
  L.push('  ' + '-'.repeat(56));
  L.push(`  Outlay    ${money(totalOutlay, 8)}     List       ${money(totalList, 8)}`);
  L.push(`  Postage   ${money(inputs.shipping, 8)}     Fees (9.4%) ${money(totalVarFees, 7)}`);
  L.push('  ' + '-'.repeat(56));
  L.push(`  NET       ${money(totalNet, 8)}     Margin ${marginList.toFixed(0)}% / ROI ${roiOutlay.toFixed(0)}%`);
  L.push(`  Top 3     ${money(top3, 8)}  (${top3Share.toFixed(0)}% of net profit)`);
  L.push(`  Unprof    ${padL(enriched.filter((e) => !e.passed).length.toString(), 8)}     basket STR ${padL(avgStr.toFixed(2), 5)}`);
  L.push(`  50% net   ~${padL((mos50 ?? 0).toFixed(0) + 'mo', 7)}  80% net ~${(mos80 ?? 0).toFixed(0)}mo  (@10%/mo lot rate)`);
  L.push('');
  L.push(`  Gates: ask≥£${inputs.minAsk.toFixed(2)}, str≥${inputs.minStr}, margin≥${(inputs.minMargin * 100).toFixed(0)}%, ship=£${inputs.shipping.toFixed(2)}`);
  L.push('');
  L.push('  #  T  Item           Name                                 List    Ask    Net/u   Mgn  Qty  Lot     STR   Mo');
  L.push('  -- -  -------------  -----------------------------------  ------  -----  ------  ---  ---  ------  ----  ----');
  passed.forEach((o, i) => {
    const nameFull = o.colourName && o.itemType === 'P' ? `${o.colourName} ${o.itemName}` : o.itemName;
    L.push(`  ${padL(i + 1, 2)} ${o.itemType}  ${pad(o.itemNo, 13)}  ${pad((nameFull || '').slice(0, 35), 35)}  ${money(o.listPrice ?? 0, 6)}  ${money(o.unitPriceGBP, 5)}  ${money(o.netPerUnit ?? 0, 6)}  ${padL(((o.marginPct ?? 0)).toFixed(0) + '%', 3)}  ${padL(o.invQty, 3)}  ${money(o.lotProfit ?? 0, 6)}  ${padL(o.sellThru.toFixed(2), 4)}  ${padL((o.mos ?? 0).toFixed(0), 4)}`);
  });
  L.push('');
  L.push(`  Buy: ${totalNet > 0 ? 'YES' : 'REVIEW'}  -  net ${money(totalNet, 0)} / ${roiOutlay.toFixed(0)}% on ${money(totalOutlay, 0)}`);
  L.push('');
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// Phase 7: Cart build (XML upload → select store → confirm → create)
// ---------------------------------------------------------------------------

function ceilP(n: number) { return Math.ceil(n * 100) / 100; }
function floorP(n: number) { return Math.floor(n * 100) / 100; }
function escXml(s: string) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function generateWantedXml(passed: EnrichedItem[]): string {
  const xml = ['<INVENTORY>'];
  for (const l of passed) {
    const listPrice = l.listPrice ?? l.unitPriceGBP;
    const breakEven = floorP(listPrice * (1 - VAR_FEE_PCT));
    const maxPrice = Math.max(Math.min(ceilP(l.unitPriceGBP * 1.05), breakEven), ceilP(l.unitPriceGBP));
    xml.push('  <ITEM>');
    xml.push(`    <ITEMTYPE>${l.itemType}</ITEMTYPE>`);
    xml.push(`    <ITEMID>${escXml(l.itemNo)}</ITEMID>`);
    if (l.itemType === 'P') xml.push(`    <COLOR>${l.colourId}</COLOR>`);
    xml.push(`    <MAXPRICE>${maxPrice.toFixed(2)}</MAXPRICE>`);
    xml.push(`    <MINQTY>${l.invQty}</MINQTY>`);
    xml.push(`    <CONDITION>${l.condition}</CONDITION>`);
    xml.push('    <NOTIFY>N</NOTIFY>');
    xml.push(`    <REMARKS>ask ${l.unitPriceGBP.toFixed(2)} list ${listPrice.toFixed(2)} lot ${(l.lotProfit ?? 0).toFixed(2)}</REMARKS>`);
    xml.push('  </ITEM>');
  }
  xml.push('</INVENTORY>');
  return xml.join('\n');
}

async function uploadWantedList(cdp: CDPClient, listName: string, xmlContent: string): Promise<number> {
  console.log('\n[7/10] Uploading wanted list via BL...');
  await cdp.navigate('https://www.bricklink.com/v2/wanted/upload.page', 3000);
  const onLogin = await cdp.evaluate<boolean>(`location.href.includes('identity.lego') || location.href.includes('/login')`);
  if (onLogin) { console.error('  not logged in to BL — log in in CDP browser then re-run'); process.exit(2); }

  const xmlJs = JSON.stringify(xmlContent);
  const nameJs = JSON.stringify(listName);
  const fillResult = await cdp.evaluate<string>(`(function(){
    function reactSet(el, value){ var proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; var setter = Object.getOwnPropertyDescriptor(proto, 'value').set; setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
    var tabs = document.querySelectorAll('.text-tab__item'); for (var i=0;i<tabs.length;i++) if (tabs[i].textContent.indexOf('XML')>=0) { tabs[i].click(); break; }
    var select = document.getElementById('wantedlist_select'); if (select) reactSet(select, '-1');
    var nameInput = document.getElementById('newWantedMore'); if (nameInput) reactSet(nameInput, ${nameJs});
    var ta = document.getElementById('xml-upload-text'); if (ta) reactSet(ta, ${xmlJs});
    return JSON.stringify({ xmlLen: ta && ta.value && ta.value.length });
  })()`);
  const fr = JSON.parse(fillResult) as { xmlLen?: number };
  if (!fr.xmlLen) { console.error('  fill failed'); process.exit(3); }
  await sleep(1500);
  await cdp.evaluate(`(function(){ var b = document.getElementById('button-add-all'); if (b) { b.disabled = false; b.click(); } })()`);
  await sleep(6000);
  await cdp.evaluate(`(function(){ var btns = document.querySelectorAll('button'); for (var i=0;i<btns.length;i++){ var t = btns[i].textContent.trim(); if (t==='Add to Wanted List' || t==='Add to wanted list') { btns[i].click(); return; } } })()`);
  await sleep(4000);

  // Discover the newly-created list's wantedMoreID
  await cdp.navigate('https://www.bricklink.com/v2/wanted/list.page', 2500);
  const href = await cdp.evaluate<string | null>(`(function(){ var as = document.querySelectorAll('a'); for (var i=0;i<as.length;i++) if (as[i].textContent.indexOf(${nameJs})>=0) return as[i].href; return null; })()`);
  const m = String(href).match(/wantedMoreID=([0-9]+)/);
  if (!m) { console.error('  could not discover wantedMoreID'); process.exit(4); }
  const id = parseInt(m[1], 10);
  console.log(`  uploaded → wantedMoreID=${id}`);
  return id;
}

async function buildCart(cdp: CDPClient, wantedMoreID: number, storeId: number): Promise<void> {
  console.log('  selecting target store on buy page...');
  await cdp.navigate(`https://www.bricklink.com/v2/wanted/buy.page?wantedMoreID=${wantedMoreID}&storeID=${storeId}`, 6000);
  await cdp.evaluate(`(function(){ var tn = document.evaluate('//text()[contains(., "' + window.__target + '")]', document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null); })()`);
  // Click Select on the first row matching our store — we've already filtered by storeID, so there should be 1
  const selResult = await cdp.evaluate<string>(`(function(){
    var btns = Array.from(document.querySelectorAll('button'));
    var selectBtns = btns.filter(function(b){ return b.textContent.trim() === 'Select'; });
    if (selectBtns.length === 0) return JSON.stringify({ err: 'no Select btn' });
    selectBtns[0].click();
    return JSON.stringify({ clicked: true });
  })()`);
  console.log('  select:', selResult);
  await sleep(4000);
  await cdp.evaluate(`(function(){ var b = Array.from(document.querySelectorAll('button')).find(function(b){ return b.textContent.trim()==='Confirm Selection'; }); if (b) b.click(); })()`);
  await sleep(5000);
  await cdp.evaluate(`(function(){ var b = Array.from(document.querySelectorAll('button')).find(function(b){ return b.textContent.trim()==='Create carts'; }); if (b) b.click(); })()`);
  await sleep(6000);
  console.log('  cart created');
}

// ---------------------------------------------------------------------------
// Phase 8: Validate cart vs projection
// ---------------------------------------------------------------------------

async function validateCart(cdp: CDPClient, expectedOutlay: number): Promise<{ actualCartSubtotal: number; passed: boolean }> {
  console.log('\n[8/10] Validating cart vs projection...');
  await cdp.navigate(`https://store.bricklink.com/${STORE_SLUG}#/cart`, 5000);
  const sub = await cdp.evaluate<number>(`(function(){ var m = document.body.innerText.match(/Subtotal[^£]*£([0-9.]+)/); return m ? parseFloat(m[1]) : 0; })()`);
  const diff = Math.abs(sub - expectedOutlay);
  const pct = expectedOutlay > 0 ? diff / expectedOutlay : 0;
  const passed = pct <= CART_VALIDATION_TOLERANCE;
  console.log(`  expected £${expectedOutlay.toFixed(2)}, cart £${sub.toFixed(2)} (diff ${(pct * 100).toFixed(1)}% ${passed ? 'OK' : 'OUT OF TOLERANCE'})`);
  return { actualCartSubtotal: sub, passed };
}

// ---------------------------------------------------------------------------
// Phase 10: Persist
// ---------------------------------------------------------------------------

async function persist(meta: { storeId: number; storeName: string; country: string }, inputs: RunInputs, passed: EnrichedItem[], reportText: string, cartValidation: { actualCartSubtotal: number; passed: boolean } | null, blOrderId: string | null) {
  console.log('\n[10/10] Persisting to arbitrage_purchases...');
  const totalOutlay = passed.reduce((s, o) => s + o.unitPriceGBP * o.invQty, 0);
  const totalList = passed.reduce((s, o) => s + (o.listPrice ?? 0) * o.invQty, 0);
  const totalNet = passed.reduce((s, o) => s + (o.lotProfit ?? 0), 0);

  const row = {
    user_id: USER_ID,
    store_slug: STORE_SLUG,
    store_id: meta.storeId,
    store_country: meta.country,
    bl_order_id: blOrderId,
    purchased_at: blOrderId ? new Date().toISOString() : null,
    total_outlay_gbp: totalOutlay.toFixed(2),
    inbound_postage_gbp: inputs.shipping.toFixed(2),
    total_list_gbp: totalList.toFixed(2),
    projected_net_profit_gbp: totalNet.toFixed(2),
    projected_margin_pct: totalList > 0 ? ((totalNet / totalList) * 100).toFixed(2) : null,
    projected_roi_pct: totalOutlay > 0 ? ((totalNet / totalOutlay) * 100).toFixed(2) : null,
    inputs,
    items: passed.map((p) => ({
      invID: p.invID, itemType: p.itemType, itemNo: p.itemNo, colourId: p.colourId, colourName: p.colourName,
      itemName: p.itemName, condition: p.condition, invQty: p.invQty,
      realAsk: p.unitPriceGBP, listPrice: p.listPrice, sellThru: p.sellThru, netPerUnit: p.netPerUnit,
      lotProfit: p.lotProfit, marginPct: p.marginPct, mos: p.mos,
    })),
    cart_validation: cartValidation,
    report_snapshot: reportText,
    status: blOrderId ? 'purchased' : cartValidation ? 'cart_built' : 'planned',
  };
  const { data, error } = await supabase.from('arbitrage_purchases').insert(row).select('id').single();
  if (error) { console.error('  insert error:', error.message); return null; }
  console.log(`  saved arbitrage_purchases.id = ${data!.id}`);
  return data!.id;
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

async function main() {
  ensureDir(OUT_DIR);
  acquireLock();
  console.log(`\n==== BL Basket Builder ====\nStore: ${STORE_SLUG}`);

  // Phase 1: CDP + preflight
  const cdp = await connectCdp();
  const meta = await preflight(cdp);

  // Prompt for shipping unless CLI-supplied
  let shipping = SHIPPING_CLI;
  if (shipping === null) {
    const ans = await rl.question(`\nInbound shipping from ${meta.storeName}? (£3.00): `);
    shipping = ans.trim() ? parseFloat(ans.trim()) : 3.00;
  }

  const inputs: RunInputs = {
    shipping, minAsk: MIN_ASK, minStr: MIN_STR, minMargin: MIN_MARGIN, cacheTtlDays: CACHE_TTL_DAYS,
    feeModel: { blFee: BL_FEE, bricqerFee: BRICQER_FEE, paypalPct: PAYPAL_PCT },
    velocityBaseline: PERSONAL_MONTHLY_LOT_RATE,
  };

  // Phase 2-4
  const scraped = await scrapeInventory(cdp, meta.storeId);
  const priceMap = await enrichWithPrices(scraped);
  const enriched = scoreAll(scraped, priceMap, inputs);
  writeJson(ENRICHED_FILE, enriched);

  // Phase 5
  const reportText = renderReport(enriched, meta, inputs);
  fs.writeFileSync(REPORT_FILE, reportText);
  console.log('\n[5/10] Report:');
  console.log(reportText);
  console.log(`Saved to ${REPORT_FILE}`);

  const passed = enriched.filter((e) => e.passed);
  if (passed.length === 0) { console.log('\nNo items passed gates. Exiting.'); cdp.close(); rl.close(); return; }
  if (SKIP_CART) { console.log('\n--skip-cart set. Stopping after report.'); cdp.close(); rl.close(); return; }

  // Phase 6: approval
  if (!AUTO_YES) {
    const ans = (await rl.question('\nApprove and build cart on BL? (y/N): ')).trim().toLowerCase();
    if (ans !== 'y' && ans !== 'yes') { console.log('Aborted by user.'); cdp.close(); rl.close(); return; }
  }

  // Phase 7-8: cart
  const listName = `${meta.storeName} basket ${new Date().toISOString().slice(0, 10)}`;
  const xml = generateWantedXml(passed);
  const wantedMoreID = await uploadWantedList(cdp, listName, xml);
  await buildCart(cdp, wantedMoreID, meta.storeId);
  const expectedOutlay = passed.reduce((s, o) => s + o.unitPriceGBP * o.invQty, 0);
  const cartValidation = await validateCart(cdp, expectedOutlay);
  if (!cartValidation.passed && !AUTO_YES) {
    const ans = (await rl.question('\nCart validation out of tolerance. Continue anyway? (y/N): ')).trim().toLowerCase();
    if (ans !== 'y') { console.log('Aborting before persist.'); cdp.close(); rl.close(); return; }
  }

  // Phase 9-10: checkout prompt + persist
  console.log('\n[9/10] Cart ready on BL. Complete checkout manually if you want to buy.');
  let blOrderId: string | null = null;
  if (!AUTO_YES) {
    const ans = (await rl.question('\nPaste BL order ID when done, or press Enter to save as "cart_built": ')).trim();
    if (ans) blOrderId = ans;
  }

  await persist(meta, inputs, passed, reportText, cartValidation, blOrderId);

  cdp.close();
  rl.close();
  console.log('\nDone.');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
