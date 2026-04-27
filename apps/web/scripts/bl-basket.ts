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
 *   --inventory-ttl-days=<n>  Reuse tmp/stores/<slug>/inventory.json if <N days old. Default 7.
 *   --force-rescrape        Force a fresh scrape even when cached inventory is fresh.
 *   --skip-cart             Stop after report (no cart build).
 *   --skip-purchases-row    Skip inserting a linked `purchases` row after persist.
 *   --resume-from-wanted=<wantedMoreID>  Skip phases 1-6 and jump to buildCart with given wantedMoreID.
 *   --resume-from-cart      Skip cart build, jump to validate+persist (cart already built on BL).
 *   --yes                   Auto-approve report & proceed without user prompt.
 *   --user-id=<uuid>        Supabase user_id. Default Chris's ID.
 *
 * Legacy: --reuse-scrape (now no-op, kept for backward compatibility — reuse is default).
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
const INVENTORY_TTL_DAYS = parseFloat(argv['inventory-ttl-days'] ?? '7');
const FORCE_RESCRAPE = argv['force-rescrape'] === 'true';
const SKIP_CART = argv['skip-cart'] === 'true';
const SKIP_PURCHASES_ROW = argv['skip-purchases-row'] === 'true';
const RESUME_FROM_WANTED = argv['resume-from-wanted'] && argv['resume-from-wanted'] !== 'true' ? parseInt(argv['resume-from-wanted'], 10) : null;
const RESUME_FROM_CART = argv['resume-from-cart'] === 'true';
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
  source: 'cache' | 'cache-none' | 'brickset' | 'api' | 'none';
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
  // Reuse cached inventory by default if it's <INVENTORY_TTL_DAYS old. --force-rescrape to override.
  if (fs.existsSync(INVENTORY_FILE) && !FORCE_RESCRAPE) {
    const ageH = (Date.now() - fs.statSync(INVENTORY_FILE).mtimeMs) / 3600000;
    const ageDays = ageH / 24;
    if (ageDays < INVENTORY_TTL_DAYS) {
      const cached = readJson<ScrapedItem[]>(INVENTORY_FILE, []);
      if (cached.length > 0) {
        console.log(`\n[2/10] Reusing cached inventory (age ${ageH.toFixed(1)}h / ${ageDays.toFixed(1)}d, ${cached.length} items)`);
        return cached;
      }
    } else {
      console.log(`\n[2/10] Cached inventory is ${ageDays.toFixed(1)}d old (TTL ${INVENTORY_TTL_DAYS}d) — re-scraping...`);
    }
  } else if (FORCE_RESCRAPE && fs.existsSync(INVENTORY_FILE)) {
    console.log(`\n[2/10] --force-rescrape set — ignoring cached inventory.`);
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

async function enrichWithPrices(items: ScrapedItem[]): Promise<Map<string, { ukSoldAvg: number | null; ukSoldQty: number; ukStockQty: number; source: 'cache' | 'cache-none' | 'brickset' | 'api' | 'none' }>> {
  console.log(`\n[3/10] Enriching ${items.length} items with UK sold/stock data (cache TTL ${CACHE_TTL_DAYS}d)...`);
  const out = new Map<string, { ukSoldAvg: number | null; ukSoldQty: number; ukStockQty: number; source: 'cache' | 'cache-none' | 'brickset' | 'api' | 'none' }>();
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
        // Need at least sold + stock recorded — partial cache rows from older partout
        // runs that didn't always write velocity get treated as misses and re-fetched.
        if (sold == null || stock == null) continue;
        const key = `${row.part_type === 'PART' ? 'P' : 'M'}:${row.part_number}:${row.colour_id}:${cond}`;
        if (priceStr != null) {
          const price = parseFloat(priceStr);
          if (price > 0) {
            out.set(key, { ukSoldAvg: price, ukSoldQty: sold, ukStockQty: stock, source: 'cache' });
            continue;
          }
        }
        // priceStr null OR price=0 → "we asked, no UK sales found" — honour the cached null
        // result so we don't re-pay the API for it. (See feedback memory: 9% of items legitimately
        // have no UK 6mo sales for that exact colour×condition; current TTL gates how often
        // we re-check whether sales materialised.)
        if (sold === 0) {
          out.set(key, { ukSoldAvg: null, ukSoldQty: 0, ukStockQty: stock, source: 'cache-none' });
        }
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
  // Now also tracks null-result rows (price=null, sold=0, stock=actual) so they cache
  // and don't re-cost the API on subsequent runs (was C1 in the hardening plan).
  const forUpsert: Array<{ partNumber: string; partType: string; colourId: number; condition: ItemCondition; price: number | null; stockQty: number; soldQty: number }> = [];
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
      const partType = t.itemType === 'P' ? 'PART' : 'MINIFIG';
      if (avg > 0) {
        out.set(key, { ukSoldAvg: avg, ukSoldQty: soldQty, ukStockQty: stockQty, source: 'api' });
        forUpsert.push({ partNumber: t.itemNo, partType, colourId: t.colourId, condition: t.condition, price: avg, stockQty, soldQty });
      } else {
        // No UK sold data — record as null-result so the cache learns and skips next time.
        out.set(key, { ukSoldAvg: null, ukSoldQty: 0, ukStockQty: stockQty, source: 'none' });
        forUpsert.push({ partNumber: t.itemNo, partType, colourId: t.colourId, condition: t.condition, price: null, stockQty, soldQty: 0 });
      }
      if (calls % 20 === 0) console.log(`  fetched ${calls} calls (${Math.ceil(calls / 2)}/${needed.size} tuples)`);
    } catch (err) {
      if (err instanceof BrickLinkApiError && err.code === 429) { console.error('  rate limit, stopping'); break; }
      out.set(key, { ukSoldAvg: null, ukSoldQty: 0, ukStockQty: 0, source: 'none' });
      // Don't cache transient errors — leave the row uncached so we retry next run.
    }
  }

  // Upsert to cache
  if (forUpsert.length > 0) {
    // Aggregate by (partNumber, colourId) across conditions. Prices may be null for null-result rows.
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
    const nullCount = forUpsert.filter((u) => u.price === null).length;
    console.log(`  upserted ${rows.length} fresh rows to cache${nullCount > 0 ? ` (${nullCount} null-result tuples cached so we skip them next run)` : ''}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Phase 4: Score
// ---------------------------------------------------------------------------

function scoreAll(items: ScrapedItem[], priceMap: Map<string, { ukSoldAvg: number | null; ukSoldQty: number; ukStockQty: number; source: 'cache' | 'cache-none' | 'brickset' | 'api' | 'none' }>, inputs: RunInputs): EnrichedItem[] {
  // Apply hard filters first, compute list values, score, gate.
  const filtered = items.filter((it) => {
    if (it.unitPriceGBP < inputs.minAsk) return false;
    if (hasDamageNote(it.description).flag) return false;
    return true;
  });
  // Total list value for allocation of postage
  const preList: Array<{ it: ScrapedItem; listPrice: number; sellThru: number; entry: { ukSoldAvg: number | null; ukSoldQty: number; ukStockQty: number; source: 'cache' | 'cache-none' | 'brickset' | 'api' | 'none' } | undefined }> = [];
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

/** Aggregate basket totals + capacity-efficiency stats for a set of passed lots. */
function aggregate(passed: EnrichedItem[], inputs: RunInputs): {
  lots: number; pieces: number; outlay: number; list: number; net: number; margin: number; roi: number;
  meanSTR: number; medianSTR: number; outlayWeightedSTR: number;
  pPerLotMo: number; pPerPcMo: number; avgMonthsToClear: number;
} {
  const n = passed.length;
  if (n === 0) return { lots: 0, pieces: 0, outlay: 0, list: 0, net: 0, margin: 0, roi: 0, meanSTR: 0, medianSTR: 0, outlayWeightedSTR: 0, pPerLotMo: 0, pPerPcMo: 0, avgMonthsToClear: 0 };
  const outlay = passed.reduce((s, o) => s + o.unitPriceGBP * o.invQty, 0);
  const list = passed.reduce((s, o) => s + (o.listPrice ?? 0) * o.invQty, 0);
  const net = passed.reduce((s, o) => s + (o.lotProfit ?? 0), 0);
  const pieces = passed.reduce((s, o) => s + o.invQty, 0);
  const margin = list > 0 ? (net / list) * 100 : 0;
  const roi = outlay > 0 ? (net / outlay) * 100 : 0;
  const strs = passed.map((o) => o.sellThru || 0).sort((a, b) => a - b);
  const meanSTR = strs.reduce((a, b) => a + b, 0) / n;
  const medianSTR = n % 2 === 0 ? (strs[n / 2 - 1] + strs[n / 2]) / 2 : strs[Math.floor(n / 2)];
  const outlayWeightedSTR = outlay > 0 ? passed.reduce((s, o) => s + (o.sellThru || 0) * o.unitPriceGBP * o.invQty, 0) / outlay : 0;
  const lotMonths = passed.reduce((s, o) => s + (o.mos ?? 0), 0);
  const pieceMonths = passed.reduce((s, o) => s + (o.mos ?? 0) * o.invQty, 0);
  const pPerLotMo = lotMonths > 0 ? net / lotMonths : 0;
  const pPerPcMo = pieceMonths > 0 ? net / pieceMonths : 0;
  const avgMonthsToClear = n > 0 ? lotMonths / n : 0;
  // Suppress unused-warning in some flag combos.
  void inputs;
  return { lots: n, pieces, outlay, list, net, margin, roi, meanSTR, medianSTR, outlayWeightedSTR, pPerLotMo, pPerPcMo, avgMonthsToClear };
}

function renderReport(enriched: EnrichedItem[], meta: { storeName: string; country: string }, inputs: RunInputs): string {
  const passed = enriched.filter((e) => e.passed).sort((a, b) => (b.lotProfit ?? 0) - (a.lotProfit ?? 0));
  const agg = aggregate(passed, inputs);
  const totalVarFees = agg.list * VAR_FEE_PCT;
  const top3 = passed.slice(0, 3).reduce((s, o) => s + (o.lotProfit ?? 0), 0);
  const top3Share = agg.net > 0 ? (top3 / agg.net) * 100 : 0;
  const byMos = [...passed].sort((a, b) => (a.mos ?? 999) - (b.mos ?? 999));
  let cum = 0, mos50: number | null = null, mos80: number | null = null;
  for (const r of byMos) { cum += r.lotProfit ?? 0; if (!mos50 && cum >= 0.5 * agg.net) mos50 = r.mos; if (!mos80 && cum >= 0.8 * agg.net) mos80 = r.mos; }

  const padL = (s: string | number, n: number) => String(s).padStart(n);
  const pad = (s: string | number, n: number) => String(s).padEnd(n);
  const money = (n: number, w = 6) => padL('£' + n.toFixed(2), w);

  const L: string[] = [];
  L.push('');
  L.push(`  ${meta.storeName}  -  ${new Date().toISOString().slice(0, 10)}`);
  L.push(`  ${agg.lots} lots / ${agg.pieces} pieces`);
  L.push('  ' + '-'.repeat(56));
  L.push(`  Outlay    ${money(agg.outlay, 8)}     List       ${money(agg.list, 8)}`);
  L.push(`  Postage   ${money(inputs.shipping, 8)}     Fees (9.4%) ${money(totalVarFees, 7)}`);
  L.push('  ' + '-'.repeat(56));
  L.push(`  NET       ${money(agg.net, 8)}     Margin ${agg.margin.toFixed(0)}% / ROI ${agg.roi.toFixed(0)}%`);
  L.push(`  Top 3     ${money(top3, 8)}  (${top3Share.toFixed(0)}% of net profit)`);
  L.push(`  Unprof    ${padL(enriched.filter((e) => !e.passed).length.toString(), 8)}`);
  // D1: median first, then mean + outlay-weighted (right-tail outliers skew the mean — see feedback memory).
  L.push(`  STR       median ${agg.medianSTR.toFixed(2)} · mean ${agg.meanSTR.toFixed(2)} · outlay-w ${agg.outlayWeightedSTR.toFixed(2)}`);
  // D2: capacity efficiency — the metric that matters when shelf space is the bottleneck.
  L.push(`  Capacity  £${agg.pPerLotMo.toFixed(3)}/lot/mo · £${agg.pPerPcMo.toFixed(3)}/pc/mo · avg ${agg.avgMonthsToClear.toFixed(1)} mo to clear`);
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

  // D3: gate-comparison table — same data, common cutoffs, helps decide --min-str.
  L.push('');
  L.push('  Gate-comparison (filters applied AFTER current min-margin/min-ask, on top of basket):');
  L.push('  Gate     Lots   Outlay   Net    Mgn   ROI   medSTR  £/lot/mo');
  L.push('  -------  -----  -------  -----  ----  ----  ------  --------');
  for (const gate of [0, 0.25, 0.50, 0.75, 1.00]) {
    const subset = passed.filter((o) => (o.sellThru || 0) >= gate);
    if (subset.length === 0) continue;
    const a = aggregate(subset, inputs);
    L.push(`  STR≥${gate.toFixed(2)} ${padL(a.lots, 5)}  ${money(a.outlay, 7)}  ${money(a.net, 5)}  ${padL(a.margin.toFixed(0) + '%', 4)}  ${padL(a.roi.toFixed(0) + '%', 4)}  ${padL(a.medianSTR.toFixed(2), 6)}  ${padL('£' + a.pPerLotMo.toFixed(3), 8)}`);
  }
  L.push('');
  L.push(`  Buy: ${agg.net > 0 ? 'YES' : 'REVIEW'}  -  net ${money(agg.net, 0)} / ${agg.roi.toFixed(0)}% on ${money(agg.outlay, 0)}`);
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

/** Dump current page state to a tmp file and reference it in stderr — for phase 7/8 failure forensics. */
async function dumpPageStateOnFailure(cdp: CDPClient, phaseLabel: string, reason: string): Promise<string> {
  try {
    const dump = await cdp.evaluate<string>(`(function(){
      var url = location.href;
      var buttons = Array.from(document.querySelectorAll('button')).map(function(b){ return { text: (b.textContent||'').trim().slice(0,80), id: b.id||null, disabled: b.disabled }; }).filter(function(b){ return b.text.length>0 && b.text.length<80; }).slice(0,40);
      var errors = Array.from(document.querySelectorAll('.error, .alert, [class*="error" i], [class*="Error"]')).map(function(e){ return (e.textContent||'').trim().slice(0,200); }).filter(function(t){ return t.length>0; }).slice(0,8);
      var links = Array.from(document.querySelectorAll('a')).map(function(a){ return { text: (a.textContent||'').trim().slice(0,60), href: (a.href||'').slice(0,200) }; }).filter(function(a){ return a.text.length>0 && a.href.length>0; }).slice(0,30);
      var bodyTop = (document.body && document.body.innerText ? document.body.innerText.slice(0,800) : '');
      return JSON.stringify({ url: url, title: document.title, buttons: buttons, errors: errors, links: links, bodyTop: bodyTop });
    })()`).catch(() => null);
    const filename = path.join(OUT_DIR, `phase-failure-${phaseLabel}-${Date.now()}.json`);
    fs.writeFileSync(filename, JSON.stringify({ phase: phaseLabel, reason, capturedAt: new Date().toISOString(), pageState: dump ? JSON.parse(dump) : 'capture failed' }, null, 2));
    return filename;
  } catch (e) {
    return `(diagnostic capture failed: ${(e as Error).message})`;
  }
}

async function uploadWantedList(cdp: CDPClient, listName: string, xmlContent: string): Promise<number> {
  console.log('\n[7/10] Uploading wanted list via BL...');
  await cdp.navigate('https://www.bricklink.com/v2/wanted/upload.page', 3000);
  const onLogin = await cdp.evaluate<boolean>(`location.href.includes('identity.lego') || location.href.includes('/login')`);
  if (onLogin) { console.error('  not logged in to BL — log in in CDP browser then re-run'); process.exit(2); }

  // Step 1: click XML tab + set list dropdown to "new" (-1) — wait for newWantedMore input to render.
  await cdp.evaluate<string>(`(function(){
    function reactSet(el, value){ var proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; var setter = Object.getOwnPropertyDescriptor(proto, 'value').set; setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
    var tabs = document.querySelectorAll('.text-tab__item'); for (var i=0;i<tabs.length;i++) if (tabs[i].textContent.indexOf('XML')>=0) { tabs[i].click(); break; }
    var select = document.getElementById('wantedlist_select'); if (select) reactSet(select, '-1');
    return 'ok';
  })()`);
  await sleep(2000);

  // Step 2: fill name + XML.
  const xmlJs = JSON.stringify(xmlContent);
  const nameJs = JSON.stringify(listName);
  const fillResult = await cdp.evaluate<string>(`(function(){
    function reactSet(el, value){ var proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; var setter = Object.getOwnPropertyDescriptor(proto, 'value').set; setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
    var nameInput = document.getElementById('newWantedMore'); if (nameInput) reactSet(nameInput, ${nameJs});
    var ta = document.getElementById('xml-upload-text'); if (ta) reactSet(ta, ${xmlJs});
    return JSON.stringify({ nameLen: nameInput && nameInput.value ? nameInput.value.length : 0, xmlLen: ta && ta.value ? ta.value.length : 0 });
  })()`);
  const fr = JSON.parse(fillResult) as { nameLen?: number; xmlLen?: number };
  if (!fr.xmlLen) {
    const dump = await dumpPageStateOnFailure(cdp, 'phase7-fill', 'XML textarea fill returned empty');
    console.error(`  fill failed — diagnostics: ${dump}`);
    process.exit(3);
  }
  await sleep(1500);

  // Step 3: click "Proceed to verify items" (the button with id 'button-add-all'; BL renamed
  // its label from "Add All to Wanted List" → "Proceed to verify items" so we use the id, not the text).
  await cdp.evaluate(`(function(){ var b = document.getElementById('button-add-all'); if (b) { b.disabled = false; b.click(); } })()`);

  // Step 4 (was bug A1): poll up to 30s for the verify-page commit button "Add to Wanted List" to render.
  // BL takes 12-15s to render this on heavy uploads — old fixed 6s sleep silently no-op'd.
  let committed = false;
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const found = await cdp.evaluate<boolean>(`(function(){
      var btns = document.querySelectorAll('button');
      for (var i=0;i<btns.length;i++){
        var t = (btns[i].textContent||'').trim();
        if (/^add\\s*to\\s*wanted\\s*list$/i.test(t) || /^add\\s+\\d+\\s+items?\\s+to\\s+wanted\\s+list$/i.test(t)) {
          if (btns[i].disabled) btns[i].disabled = false;
          btns[i].click();
          return true;
        }
      }
      return false;
    })()`);
    if (found) { committed = true; console.log(`  commit clicked after ~${(i + 1) * 0.5}s`); break; }
  }
  if (!committed) {
    const dump = await dumpPageStateOnFailure(cdp, 'phase7-commit', 'verify-page commit button never appeared after 30s poll');
    console.error(`  commit click failed (verify-page button not found within 30s) — diagnostics: ${dump}`);
    process.exit(3);
  }
  await sleep(4000);

  // Step 5: navigate to wanted-list page and scrape the new list's wantedMoreID from its href.
  await cdp.navigate('https://www.bricklink.com/v2/wanted/list.page', 2500);
  const href = await cdp.evaluate<string | null>(`(function(){ var as = document.querySelectorAll('a'); for (var i=0;i<as.length;i++) if (as[i].textContent.indexOf(${nameJs})>=0) return as[i].href; return null; })()`);
  const m = String(href).match(/wantedMoreID=([0-9]+)/);
  if (!m) {
    const dump = await dumpPageStateOnFailure(cdp, 'phase7-discover', `list named "${listName}" not found on /wanted/list.page`);
    console.error(`  could not discover wantedMoreID — diagnostics: ${dump}`);
    process.exit(4);
  }
  const id = parseInt(m[1], 10);
  console.log(`  uploaded → wantedMoreID=${id}`);
  return id;
}

async function buildCart(cdp: CDPClient, wantedMoreID: number, storeId: number): Promise<void> {
  console.log('  selecting target store on buy page...');
  await cdp.navigate(`https://www.bricklink.com/v2/wanted/buy.page?wantedMoreID=${wantedMoreID}&storeID=${storeId}`, 6000);

  // Poll for the Select button to appear (some stores take a moment to load the row).
  let haveSelect = false;
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    const ok = await cdp.evaluate<boolean>(`Array.from(document.querySelectorAll('button')).some(function(b){ return b.textContent.trim()==='Select'; })`);
    if (ok) { haveSelect = true; break; }
  }
  if (!haveSelect) {
    const dump = await dumpPageStateOnFailure(cdp, 'phase7-select', 'no Select button on buy page within 15s');
    console.error(`  no Select button — diagnostics: ${dump}`);
    process.exit(5);
  }
  await cdp.evaluate(`(function(){ var b = Array.from(document.querySelectorAll('button')).find(function(b){ return b.textContent.trim()==='Select'; }); if (b) b.click(); })()`);
  await sleep(4000);

  await cdp.evaluate(`(function(){ var b = Array.from(document.querySelectorAll('button')).find(function(b){ return b.textContent.trim()==='Confirm Selection'; }); if (b) b.click(); })()`);
  await sleep(5000);

  // Poll for "Create carts" button — sometimes deferred.
  let createClicked = false;
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    const ok = await cdp.evaluate<boolean>(`(function(){ var b = Array.from(document.querySelectorAll('button')).find(function(b){ return /^create\\s*carts?$/i.test(b.textContent.trim()); }); if (b) { b.click(); return true; } return false; })()`);
    if (ok) { createClicked = true; break; }
  }
  if (!createClicked) {
    const dump = await dumpPageStateOnFailure(cdp, 'phase7-create', 'Create carts button not seen within 10s');
    console.error(`  Create carts click failed — diagnostics: ${dump}`);
    process.exit(5);
  }
  await sleep(6000);
  console.log('  cart created');
}

// ---------------------------------------------------------------------------
// Phase 8: Validate cart vs projection
// ---------------------------------------------------------------------------

/** Full BL cart breakdown — captured from the Order Summary panel. */
interface CartBreakdown {
  subtotal: number;
  shippingPackaging: number;
  insurance: number;
  paymentProcessingFee: number;
  additionalCharges: number;
  credit: number;
  grandTotal: number;
  /** What the script projected as Grand Total = outlay + estimated_shipping. */
  projectedOutlay: number;
  estimatedShipping: number;
  projectedTotal: number;
  /** (actual - projected) / projected. Negative = under, positive = over. */
  totalDiffPct: number;
  passed: boolean;
  /** Legacy field for back-compat with prior arbitrage_purchases rows. */
  actualCartSubtotal: number;
}

/**
 * Parse the BL cart Order Summary lines.
 * Format (per cnfearn69 sample):
 *   Total: GBP 44.64
 *   Shipping & Packaging: GBP 4.05
 *   Insurance: GBP 0.00
 *   Payment Processing Fee: GBP 0.00
 *   Additional Charges 2: GBP 0.00
 *   Credit: GBP 0.00
 *   Grand Total: GBP 48.69
 * Also accepts £ (older renderings) and the basket-line "Subtotal (N items): GBP X.XX".
 */
async function parseCartBreakdown(cdp: CDPClient, expectedOutlay: number, estimatedShipping: number): Promise<CartBreakdown> {
  // Anchored basket subtotal: "Subtotal (123 items): GBP 44.64". Falls back to a "Total: GBP X" line.
  const raw = await cdp.evaluate<string>(`(function(){
    var t = document.body.innerText || '';
    function pickLine(label) {
      var lines = t.split(/\\n/);
      for (var i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().indexOf(label.toLowerCase()) === 0 || lines[i].trim().toLowerCase().indexOf(label.toLowerCase()) === 0) {
          var m = lines[i].match(/(?:GBP\\s*|£\\s*|\\$\\s*)([0-9]+(?:\\.[0-9]+)?)/);
          if (m) return m[1];
        }
      }
      return null;
    }
    function pickAnchored(re) {
      var m = t.match(re);
      return m ? m[1] : null;
    }
    var subtotal = pickAnchored(/Subtotal\\s*\\(\\s*\\d+\\s*items?\\s*\\)\\s*:?\\s*(?:GBP\\s*|£\\s*)([0-9]+(?:\\.[0-9]+)?)/i);
    var total = pickAnchored(/(?:^|\\n)\\s*Total\\s*:\\s*(?:GBP\\s*|£\\s*)([0-9]+(?:\\.[0-9]+)?)/i);
    var shippingPackaging = pickAnchored(/Shipping\\s*(?:&|and)\\s*Packaging\\s*:?\\s*(?:GBP\\s*|£\\s*)([0-9]+(?:\\.[0-9]+)?)/i);
    var insurance = pickAnchored(/Insurance\\s*:?\\s*(?:GBP\\s*|£\\s*)([0-9]+(?:\\.[0-9]+)?)/i);
    var paymentFee = pickAnchored(/Payment\\s+Processing\\s+Fee\\s*:?\\s*(?:GBP\\s*|£\\s*)([0-9]+(?:\\.[0-9]+)?)/i);
    var additional = pickAnchored(/Additional\\s+Charges?\\s*\\d*\\s*:?\\s*(?:GBP\\s*|£\\s*)([0-9]+(?:\\.[0-9]+)?)/i);
    var credit = pickAnchored(/Credit\\s*:?\\s*(?:GBP\\s*|£\\s*)([0-9]+(?:\\.[0-9]+)?)/i);
    var grand = pickAnchored(/Grand\\s+Total\\s*:?\\s*(?:GBP\\s*|£\\s*)([0-9]+(?:\\.[0-9]+)?)/i);
    return JSON.stringify({ subtotal: subtotal, total: total, shippingPackaging: shippingPackaging, insurance: insurance, paymentFee: paymentFee, additional: additional, credit: credit, grand: grand });
  })()`);
  const parsed = JSON.parse(raw) as Record<string, string | null>;
  const num = (s: string | null | undefined) => (s == null ? 0 : parseFloat(s) || 0);

  const subtotal = num(parsed.subtotal) || num(parsed.total);
  const shippingPackaging = num(parsed.shippingPackaging);
  const insurance = num(parsed.insurance);
  const paymentProcessingFee = num(parsed.paymentFee);
  const additionalCharges = num(parsed.additional);
  const credit = num(parsed.credit);
  // Prefer BL's own grand total; fall back to summed components if missing.
  const grandTotal = num(parsed.grand) || (subtotal + shippingPackaging + insurance + paymentProcessingFee + additionalCharges - credit);

  const projectedTotal = expectedOutlay + estimatedShipping;
  const diff = grandTotal - projectedTotal;
  const totalDiffPct = projectedTotal > 0 ? diff / projectedTotal : 0;
  const passed = Math.abs(totalDiffPct) <= CART_VALIDATION_TOLERANCE;

  return {
    subtotal, shippingPackaging, insurance, paymentProcessingFee, additionalCharges, credit, grandTotal,
    projectedOutlay: expectedOutlay, estimatedShipping, projectedTotal,
    totalDiffPct: Number(totalDiffPct.toFixed(4)),
    passed,
    actualCartSubtotal: subtotal,
  };
}

/**
 * Re-allocate actual shipping across passed lots and return updated total/margin/ROI.
 * The projection used the £3 estimate; actual postage may differ. Used to render the
 * "after-actual-shipping" margin/ROI both in tolerance and over-tolerance cases.
 */
function reprojectWithActualShipping(passed: EnrichedItem[], actualShipping: number): { net: number; margin: number; roi: number; outlay: number; list: number } {
  const totalListVal = passed.reduce((s, o) => s + (o.listPrice ?? 0) * o.invQty, 0);
  let net = 0, outlay = 0, list = 0;
  for (const o of passed) {
    const listP = o.listPrice ?? 0;
    const lotList = listP * o.invQty;
    const postageShare = totalListVal > 0 ? (lotList / totalListVal) * actualShipping : 0;
    const netPerUnit = listP * (1 - VAR_FEE_PCT) - o.unitPriceGBP - (postageShare / o.invQty);
    net += netPerUnit * o.invQty;
    outlay += o.unitPriceGBP * o.invQty;
    list += lotList;
  }
  return {
    net, outlay, list,
    margin: list > 0 ? (net / list) * 100 : 0,
    roi: outlay > 0 ? (net / outlay) * 100 : 0,
  };
}

async function validateCart(cdp: CDPClient, expectedOutlay: number, estimatedShipping: number, passed: EnrichedItem[]): Promise<CartBreakdown & { reprojected: ReturnType<typeof reprojectWithActualShipping> }> {
  console.log('\n[8/10] Validating cart against BL Order Summary...');
  await cdp.navigate(`https://store.bricklink.com/${STORE_SLUG}#/cart`, 6000);

  const breakdown = await parseCartBreakdown(cdp, expectedOutlay, estimatedShipping);
  const reprojected = reprojectWithActualShipping(passed, breakdown.shippingPackaging || estimatedShipping);

  // Original projection (with estimated shipping) for delta line.
  const originalProj = reprojectWithActualShipping(passed, estimatedShipping);

  const fmt = (n: number) => '£' + n.toFixed(2);
  console.log(`  Subtotal:               ${fmt(breakdown.subtotal)}`);
  console.log(`  Shipping & Packaging:   ${fmt(breakdown.shippingPackaging)}  (estimate was ${fmt(estimatedShipping)}${breakdown.shippingPackaging !== estimatedShipping ? `, ${breakdown.shippingPackaging > estimatedShipping ? '+' : ''}${(breakdown.shippingPackaging - estimatedShipping).toFixed(2)}` : ''})`);
  if (breakdown.insurance > 0) console.log(`  Insurance:              ${fmt(breakdown.insurance)}  ⚠ not modelled`);
  if (breakdown.paymentProcessingFee > 0) console.log(`  Payment Processing Fee: ${fmt(breakdown.paymentProcessingFee)}  ⚠ not modelled`);
  if (breakdown.additionalCharges > 0) console.log(`  Additional Charges:     ${fmt(breakdown.additionalCharges)}  ⚠ not modelled`);
  if (breakdown.credit > 0) console.log(`  Credit:                 ${fmt(-breakdown.credit)}  (store credit applied)`);
  console.log(`  Grand Total:            ${fmt(breakdown.grandTotal)}`);
  console.log('');
  console.log(`  Projected total:        ${fmt(breakdown.projectedTotal)}  (outlay ${fmt(breakdown.projectedOutlay)} + est ship ${fmt(estimatedShipping)})`);
  console.log(`  Variance:               ${(breakdown.totalDiffPct * 100).toFixed(1)}%   ${breakdown.passed ? '✓ within ±' + (CART_VALIDATION_TOLERANCE * 100).toFixed(0) + '%' : '⚠ EXCEEDS ±' + (CART_VALIDATION_TOLERANCE * 100).toFixed(0) + '%'}`);
  console.log('');
  console.log(`  Re-projected at actual: net ${fmt(reprojected.net)}  margin ${reprojected.margin.toFixed(1)}%  ROI ${reprojected.roi.toFixed(1)}%`);
  console.log(`                          (was ${fmt(originalProj.net)} / ${originalProj.margin.toFixed(1)}% / ${originalProj.roi.toFixed(1)}% with £${estimatedShipping.toFixed(2)} estimate)`);

  return { ...breakdown, reprojected };
}

// ---------------------------------------------------------------------------
// Phase 10: Persist
// ---------------------------------------------------------------------------

type CartValidation = (CartBreakdown & { reprojected: ReturnType<typeof reprojectWithActualShipping> }) | null;

async function persist(meta: { storeId: number; storeName: string; country: string }, inputs: RunInputs, passed: EnrichedItem[], reportText: string, cartValidation: CartValidation, blOrderId: string | null): Promise<{ arbitrageId: string | null; purchasesId: string | null }> {
  console.log('\n[10/10] Persisting to arbitrage_purchases...');
  // Fall back to original projection (estimated shipping) if validation didn't run.
  const reproj = cartValidation?.reprojected ?? reprojectWithActualShipping(passed, inputs.shipping);
  const actualShippingPaid = cartValidation ? cartValidation.shippingPackaging || inputs.shipping : inputs.shipping;
  const totalOutlay = reproj.outlay;
  const totalList = reproj.list;
  const totalNet = reproj.net;

  const row = {
    user_id: USER_ID,
    store_slug: STORE_SLUG,
    store_id: meta.storeId,
    store_country: meta.country,
    bl_order_id: blOrderId,
    purchased_at: blOrderId ? new Date().toISOString() : null,
    total_outlay_gbp: totalOutlay.toFixed(2),
    // B2: store the ACTUAL shipping paid when we have validation; else the estimate.
    inbound_postage_gbp: actualShippingPaid.toFixed(2),
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
  if (error) { console.error('  insert error:', error.message); return { arbitrageId: null, purchasesId: null }; }
  const arbitrageId = data!.id as string;
  console.log(`  saved arbitrage_purchases.id = ${arbitrageId}`);

  // B3: also insert a row in `purchases` so this BL order shows up in the standard
  // /purchases UI alongside Vinted/eBay/Amazon entries. Only when we have an actual
  // BL order ID (otherwise it's not a real purchase yet).
  let purchasesId: string | null = null;
  if (blOrderId && !SKIP_PURCHASES_ROW) {
    const grandTotal = cartValidation?.grandTotal ?? (totalOutlay + actualShippingPaid);
    const subtotal = cartValidation?.subtotal ?? totalOutlay;
    const shipPack = cartValidation?.shippingPackaging ?? actualShippingPaid;
    const filterDescBits = [
      `margin>=${(inputs.minMargin * 100).toFixed(0)}%`,
      `STR>=${inputs.minStr.toFixed(2)}`,
      `ask>=£${inputs.minAsk.toFixed(2)}`,
    ].join(', ');
    const purchaseRow = {
      user_id: USER_ID,
      purchase_date: new Date().toISOString().slice(0, 10),
      short_description: `BrickLink ${STORE_SLUG} #${blOrderId} — ${passed.length} lots / ${passed.reduce((s, p) => s + p.invQty, 0)} pieces`,
      description:
        `BrickLink arbitrage purchase from ${meta.storeName} (${STORE_SLUG}, store ID ${meta.storeId}).\n\n` +
        `Filters: ${filterDescBits}\n` +
        `Subtotal: £${subtotal.toFixed(2)}\n` +
        `Shipping & Packaging: £${shipPack.toFixed(2)}\n` +
        `Grand Total: £${grandTotal.toFixed(2)}\n\n` +
        `Linked arbitrage_purchases.id: ${arbitrageId}`,
      cost: grandTotal,
      source: 'BrickLink',
      payment_method: 'PayPal',
      reference: blOrderId,
    };
    const { data: pData, error: pError } = await supabase.from('purchases').insert(purchaseRow).select('id').single();
    if (pError) {
      console.error(`  purchases insert error: ${pError.message}`);
    } else {
      purchasesId = pData!.id as string;
      console.log(`  saved purchases.id = ${purchasesId}`);
      // Backlink purchases.id into arbitrage_purchases.inputs so we can navigate either way.
      const newInputs = { ...inputs, purchases_id: purchasesId };
      await supabase.from('arbitrage_purchases').update({ inputs: newInputs }).eq('id', arbitrageId);
    }
  }
  return { arbitrageId, purchasesId };
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

async function main() {
  ensureDir(OUT_DIR);
  acquireLock();
  console.log(`\n==== BL Basket Builder ====\nStore: ${STORE_SLUG}`);
  if (RESUME_FROM_WANTED) console.log(`Mode: resume-from-wanted=${RESUME_FROM_WANTED} (skipping phases 1–6)`);
  else if (RESUME_FROM_CART) console.log(`Mode: resume-from-cart (skipping cart build, jumping to validate+persist)`);

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

  // Phases 2-5 (skipped on resume-from-cart since enriched.json must already exist).
  let enriched: EnrichedItem[];
  let reportText: string;
  if (RESUME_FROM_CART) {
    if (!fs.existsSync(ENRICHED_FILE)) {
      console.error(`--resume-from-cart requires ${ENRICHED_FILE} — it doesn't exist. Run a full pass first.`);
      cdp.close(); rl.close(); process.exit(1);
    }
    enriched = readJson<EnrichedItem[]>(ENRICHED_FILE, []);
    console.log(`\nResume: loaded ${enriched.length} enriched items from disk.`);
    reportText = fs.existsSync(REPORT_FILE) ? fs.readFileSync(REPORT_FILE, 'utf8') : renderReport(enriched, meta, inputs);
  } else {
    const scraped = await scrapeInventory(cdp, meta.storeId);
    const priceMap = await enrichWithPrices(scraped);
    enriched = scoreAll(scraped, priceMap, inputs);
    writeJson(ENRICHED_FILE, enriched);

    reportText = renderReport(enriched, meta, inputs);
    fs.writeFileSync(REPORT_FILE, reportText);
    console.log('\n[5/10] Report:');
    console.log(reportText);
    console.log(`Saved to ${REPORT_FILE}`);
  }

  const passed = enriched.filter((e) => e.passed);
  if (passed.length === 0) { console.log('\nNo items passed gates. Exiting.'); cdp.close(); rl.close(); return; }
  if (SKIP_CART) { console.log('\n--skip-cart set. Stopping after report.'); cdp.close(); rl.close(); return; }

  // Phase 6: approval (skipped on resume modes — user already implicitly approved by passing the flag).
  if (!RESUME_FROM_WANTED && !RESUME_FROM_CART && !AUTO_YES) {
    const ans = (await rl.question('\nApprove and build cart on BL? (y/N): ')).trim().toLowerCase();
    if (ans !== 'y' && ans !== 'yes') { console.log('Aborted by user.'); cdp.close(); rl.close(); return; }
  }

  // Phase 7: upload wanted list (skipped on resume modes).
  let wantedMoreID: number;
  if (RESUME_FROM_WANTED) {
    wantedMoreID = RESUME_FROM_WANTED;
  } else if (!RESUME_FROM_CART) {
    const listName = `${meta.storeName} basket ${new Date().toISOString().slice(0, 10)}`;
    const xml = generateWantedXml(passed);
    wantedMoreID = await uploadWantedList(cdp, listName, xml);
  } else {
    wantedMoreID = -1; // unused on resume-from-cart
  }

  // Phase 7b: cart build (skipped on resume-from-cart).
  if (!RESUME_FROM_CART) {
    await buildCart(cdp, wantedMoreID, meta.storeId);
  }

  // Phase 8: validate cart against BL Order Summary (Grand Total).
  const expectedOutlay = passed.reduce((s, o) => s + o.unitPriceGBP * o.invQty, 0);
  const cartValidation = await validateCart(cdp, expectedOutlay, shipping, passed);
  if (!cartValidation.passed) {
    if (AUTO_YES) {
      console.log(`  ⚠ over tolerance but --yes set — continuing.`);
    } else {
      const ans = (await rl.question(`\n⚠ Grand Total exceeds projection by ${(cartValidation.totalDiffPct * 100).toFixed(1)}% (>${(CART_VALIDATION_TOLERANCE * 100).toFixed(0)}% tolerance). Continue anyway? (y/N): `)).trim().toLowerCase();
      if (ans !== 'y' && ans !== 'yes') { console.log('Aborting before persist. Cart on BL is unchanged — you can still complete checkout and re-run with --resume-from-cart.'); cdp.close(); rl.close(); return; }
    }
  }

  // Phase 9-10: checkout prompt + persist.
  console.log('\n[9/10] Cart ready on BL. Complete checkout manually if you want to buy.');
  let blOrderId: string | null = null;
  if (!AUTO_YES) {
    const ans = (await rl.question('\nPaste BL order ID when done, or press Enter to save as "cart_built": ')).trim();
    if (ans) blOrderId = ans;
  }

  const { arbitrageId, purchasesId } = await persist(meta, inputs, passed, reportText, cartValidation, blOrderId);
  console.log(`\nDone. arbitrage_purchases=${arbitrageId ?? '(failed)'}${purchasesId ? `  purchases=${purchasesId}` : ''}`);

  cdp.close();
  rl.close();
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
