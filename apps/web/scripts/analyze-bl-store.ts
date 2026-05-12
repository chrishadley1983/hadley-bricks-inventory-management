/**
 * One-shot store analysis for offer-pricing.
 *
 * Reads tmp/stores/<slug>/inventory.json (must be pre-scraped via bl-basket.ts),
 * pulls UK 6-month sold + UK stock for every (item, colour, condition) tuple
 * (cache-first, BL API for misses), and reports STR + Bricqer list value
 * across the whole inventory. Ignores seller's current ask price.
 *
 * Use case: assessing what to offer for a bulk store purchase.
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/analyze-bl-store.ts --store-slug=<SLUG>
 *   Optional: --cache-ttl-days=90 --api-delay-ms=250 --api-budget=4500 --max-fetch=0
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import { BrickLinkClient } from '../src/lib/bricklink/client';
import type { BrickLinkPriceGuide, BrickLinkItemType } from '../src/lib/bricklink/types';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const argv: Record<string, string> = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)=(.*)$/);
  if (m) argv[m[1]] = m[2];
  else if (a.startsWith('--')) argv[a.slice(2)] = 'true';
}

const SLUG = argv['store-slug'];
if (!SLUG) { console.error('Missing --store-slug=<SLUG>'); process.exit(1); }

const CACHE_TTL_DAYS = parseInt(argv['cache-ttl-days'] ?? '90', 10);
const API_DELAY_MS = parseInt(argv['api-delay-ms'] ?? '250', 10);
const API_BUDGET = parseInt(argv['api-budget'] ?? '4500', 10);
const MAX_FETCH = parseInt(argv['max-fetch'] ?? '0', 10); // 0 = no limit (subject to API_BUDGET)

const ROOT = path.resolve(__dirname, '..', '..', '..');
const OUT_DIR = path.join(ROOT, 'tmp', 'stores', SLUG);
const INV_PATH = path.join(OUT_DIR, 'inventory.json');
if (!fs.existsSync(INV_PATH)) {
  console.error(`No inventory.json at ${INV_PATH}. Run bl-basket.ts first.`);
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) { console.error('Missing Supabase env'); process.exit(1); }
const supabase = createClient(supabaseUrl, supabaseKey);

const creds = {
  consumerKey: process.env.BRICKLINK_CONSUMER_KEY ?? '',
  consumerSecret: process.env.BRICKLINK_CONSUMER_SECRET ?? '',
  tokenValue: process.env.BRICKLINK_TOKEN_VALUE ?? '',
  tokenSecret: process.env.BRICKLINK_TOKEN_SECRET ?? '',
};
for (const [k, v] of Object.entries(creds)) {
  if (!v) { console.error(`Missing BRICKLINK_${k}`); process.exit(1); }
}
const bl = new BrickLinkClient(creds, { supabase, caller: 'analyze-bl-store-script' });

type StoreItemCode = 'P' | 'S' | 'M';
type ItemCondition = 'N' | 'U';
const STORE_TO_API: Record<StoreItemCode, BrickLinkItemType> = { P: 'PART', S: 'SET', M: 'MINIFIG' };

interface ScrapedItem {
  invID: number;
  itemType: StoreItemCode;
  itemNo: string;
  colourId: number;
  colourName: string | null;
  itemName: string;
  invNew: string;
  invQty: number;
  unitPriceGBP: number;
  description: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function bricqerMultiplier(condition: ItemCondition, sellThru: number): number {
  if (condition === 'N') return sellThru >= 0.5 ? 1.05 : 0.90;
  if (sellThru >= 1) return 1.25;
  if (sellThru >= 0.75) return 1.15;
  if (sellThru >= 0.5) return 1.10;
  if (sellThru >= 0.25) return 0.90;
  return 0.85;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}
function pctile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.floor(p * s.length)));
  return s[idx];
}

async function main() {
  const items: ScrapedItem[] = JSON.parse(fs.readFileSync(INV_PATH, 'utf8'));
  console.log(`\n==== BL Store Analyzer ====`);
  console.log(`Store: ${SLUG}`);
  console.log(`Inventory: ${items.length} lots, ${items.reduce((s, i) => s + i.invQty, 0)} pieces`);
  const askTotal = items.reduce((s, i) => s + i.unitPriceGBP * i.invQty, 0);
  console.log(`Current ask (informational): £${askTotal.toFixed(2)}`);

  type CacheRow = { part_number: string; part_type: string; colour_id: number; price_new: string | null; price_used: string | null; stock_available_new: number | null; stock_available_used: number | null; times_sold_new: number | null; times_sold_used: number | null; fetched_at: string };
  type Entry = { ukSoldAvg: number | null; ukSoldQty: number; ukStockQty: number; source: 'cache' | 'cache-none' | 'brickset' | 'api' | 'none' };
  const enriched = new Map<string, Entry>();
  const ttlMs = CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
  const now = Date.now();

  // --- Cache lookup (parts + minifigs) ---
  const pmItems = items.filter((i) => i.itemType === 'P' || i.itemType === 'M');
  const uniquePartNos = [...new Set(pmItems.map((i) => i.itemNo))];
  const CHUNK = 500;
  const PAGE = 1000;
  let totalRows = 0;
  for (let i = 0; i < uniquePartNos.length; i += CHUNK) {
    const chunk = uniquePartNos.slice(i, i + CHUNK);
    let pageStart = 0;
    while (true) {
      const { data, error } = await supabase
        .from('bricklink_part_price_cache')
        .select('part_number, part_type, colour_id, price_new, price_used, stock_available_new, stock_available_used, times_sold_new, times_sold_used, fetched_at')
        .in('part_number', chunk)
        .range(pageStart, pageStart + PAGE - 1);
      if (error) { console.warn(`  cache page error: ${error.message}`); break; }
      const rows = (data ?? []) as CacheRow[];
      totalRows += rows.length;
      for (const row of rows) {
        const fresh = now - new Date(row.fetched_at).getTime() < ttlMs;
        if (!fresh) continue;
        for (const cond of ['N', 'U'] as const) {
          const priceStr = cond === 'N' ? row.price_new : row.price_used;
          const stock = cond === 'N' ? row.stock_available_new : row.stock_available_used;
          const sold = cond === 'N' ? row.times_sold_new : row.times_sold_used;
          if (sold == null || stock == null) continue;
          const key = `${row.part_type === 'PART' ? 'P' : 'M'}:${row.part_number}:${row.colour_id}:${cond}`;
          if (priceStr != null) {
            const price = parseFloat(priceStr);
            if (price > 0) { enriched.set(key, { ukSoldAvg: price, ukSoldQty: sold, ukStockQty: stock, source: 'cache' }); continue; }
          }
          if (sold === 0) enriched.set(key, { ukSoldAvg: null, ukSoldQty: 0, ukStockQty: stock, source: 'cache-none' });
        }
      }
      if (rows.length < PAGE) break;
      pageStart += PAGE;
    }
  }
  console.log(`\nCache: ${enriched.size} tuples hit (${totalRows} rows scanned)`);

  // --- Sets via brickset_sets ---
  const setItems = items.filter((i) => i.itemType === 'S');
  if (setItems.length) {
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
        // brickset doesn't carry STR — assume sellThru=0.5 (used) / 0.5 (new) so
        // multiplier lands at the mid bracket. Marked as 'brickset' so we count
        // these separately in coverage.
        enriched.set(`S:${row.set_number}:0:${cond}`, { ukSoldAvg: price, ukSoldQty: 50, ukStockQty: 100, source: 'brickset' });
      }
    }
  }

  // --- API enrichment for cache misses (parts + minifigs) ---
  const needed = new Map<string, { itemType: StoreItemCode; itemNo: string; colourId: number; condition: ItemCondition }>();
  for (const it of items) {
    const cond: ItemCondition = it.invNew === 'New' ? 'N' : 'U';
    const key = `${it.itemType}:${it.itemNo}:${it.colourId}:${cond}`;
    if (enriched.has(key)) continue;
    if (it.itemType === 'S') continue;
    if (!needed.has(key)) needed.set(key, { itemType: it.itemType, itemNo: it.itemNo, colourId: it.colourId, condition: cond });
  }
  console.log(`Need to fetch: ${needed.size} tuples from BL API (delay ${API_DELAY_MS}ms × 2 calls each)`);
  const fetchCap = MAX_FETCH > 0 ? Math.min(MAX_FETCH, needed.size) : needed.size;
  console.log(`Fetch cap: ${fetchCap} tuples (${fetchCap * 2} calls, ~${Math.ceil(fetchCap * 2 * API_DELAY_MS / 60000)} min)`);

  let calls = 0;
  let fetched = 0;
  let nullCount = 0;
  const forUpsert: Array<{ partNumber: string; partType: string; colourId: number; condition: ItemCondition; price: number | null; stockQty: number; soldQty: number }> = [];
  for (const [key, t] of needed) {
    if (fetched >= fetchCap) break;
    if (calls + 2 > API_BUDGET) { console.warn(`API budget reached`); break; }
    try {
      await sleep(API_DELAY_MS);
      const sold: BrickLinkPriceGuide = await bl.getPartPriceGuide(STORE_TO_API[t.itemType], t.itemNo, t.colourId, { condition: t.condition, guideType: 'sold', currencyCode: 'GBP', countryCode: 'UK' });
      calls++;
      await sleep(API_DELAY_MS);
      const stock: BrickLinkPriceGuide = await bl.getPartPriceGuide(STORE_TO_API[t.itemType], t.itemNo, t.colourId, { condition: t.condition, guideType: 'stock', currencyCode: 'GBP', countryCode: 'UK' });
      calls++;
      fetched++;
      const avg = parseFloat(sold.avg_price);
      const soldQty = sold.total_quantity ?? 0;
      const stockQty = stock.total_quantity ?? 0;
      const partType = t.itemType === 'P' ? 'PART' : 'MINIFIG';
      if (avg > 0 && soldQty > 0) {
        enriched.set(key, { ukSoldAvg: avg, ukSoldQty: soldQty, ukStockQty: stockQty, source: 'api' });
        forUpsert.push({ partNumber: t.itemNo, partType, colourId: t.colourId, condition: t.condition, price: avg, stockQty, soldQty });
      } else {
        enriched.set(key, { ukSoldAvg: null, ukSoldQty: 0, ukStockQty: stockQty, source: 'api' });
        forUpsert.push({ partNumber: t.itemNo, partType, colourId: t.colourId, condition: t.condition, price: null, stockQty, soldQty: 0 });
        nullCount++;
      }
      if (fetched % 50 === 0) console.log(`  fetched ${fetched}/${fetchCap} (${nullCount} null)`);
    } catch (err) {
      console.warn(`  fetch error ${key}: ${(err as Error).message}`);
      // continue
    }
  }
  console.log(`Fetched ${fetched} tuples (${nullCount} returned no UK sales).`);

  // --- Cache upsert (so future runs benefit) ---
  if (forUpsert.length) {
    // Group into rows keyed by (part_number, colour_id) — one row holds both N and U values.
    type UpsertRow = { part_number: string; part_type: string; colour_id: number; price_new: number | null; price_used: number | null; stock_available_new: number | null; stock_available_used: number | null; times_sold_new: number | null; times_sold_used: number | null; fetched_at: string };
    const rowMap = new Map<string, UpsertRow>();
    for (const u of forUpsert) {
      const k = `${u.partType}:${u.partNumber}:${u.colourId}`;
      if (!rowMap.has(k)) rowMap.set(k, { part_number: u.partNumber, part_type: u.partType, colour_id: u.colourId, price_new: null, price_used: null, stock_available_new: null, stock_available_used: null, times_sold_new: null, times_sold_used: null, fetched_at: new Date().toISOString() });
      const row = rowMap.get(k)!;
      if (u.condition === 'N') { row.price_new = u.price; row.stock_available_new = u.stockQty; row.times_sold_new = u.soldQty; }
      else { row.price_used = u.price; row.stock_available_used = u.stockQty; row.times_sold_used = u.soldQty; }
    }
    const rows = [...rowMap.values()];
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await supabase.from('bricklink_part_price_cache').upsert(chunk, { onConflict: 'part_number,part_type,colour_id' });
      if (error) console.warn(`  upsert error: ${error.message}`);
    }
    console.log(`Cache upsert: ${rows.length} rows.`);
  }

  // --- Score every lot ---
  type Scored = ScrapedItem & { ukSoldAvg: number | null; sellThru: number; multiplier: number; listPerUnit: number; listLot: number; askLot: number; source: string; bucket: string };
  const scored: Scored[] = items.map((it) => {
    const cond: ItemCondition = it.invNew === 'New' ? 'N' : 'U';
    const key = `${it.itemType}:${it.itemNo}:${it.colourId}:${cond}`;
    const e = enriched.get(key);
    const ukSoldAvg = e?.ukSoldAvg ?? null;
    const sellThru = e && e.ukStockQty > 0 ? e.ukSoldQty / e.ukStockQty : 0;
    const multiplier = bricqerMultiplier(cond, sellThru);
    const listPerUnit = ukSoldAvg ? ukSoldAvg * multiplier : 0;
    const listLot = listPerUnit * it.invQty;
    const askLot = it.unitPriceGBP * it.invQty;
    let bucket: string;
    if (!e || ukSoldAvg == null) bucket = 'no-data';
    else if (sellThru >= 1) bucket = 'hot (>=1.0)';
    else if (sellThru >= 0.5) bucket = 'warm (0.5-1)';
    else if (sellThru >= 0.25) bucket = 'tepid (0.25-0.5)';
    else if (sellThru > 0) bucket = 'cold (<0.25)';
    else bucket = 'dead (0)';
    return { ...it, ukSoldAvg, sellThru, multiplier, listPerUnit, listLot, askLot, source: e?.source ?? 'none', bucket };
  });

  // --- Coverage ---
  const cov: Record<string, number> = {};
  for (const s of scored) cov[s.source] = (cov[s.source] ?? 0) + 1;

  // --- STR distribution (lots with valid data only) ---
  const strLots = scored.filter((s) => s.ukSoldAvg != null);
  const strs = strLots.map((s) => s.sellThru);
  const strMedian = median(strs);
  const strMean = mean(strs);
  // Outlay-weighted STR (using listLot as the weight — the £ at risk per lot)
  const wTotal = strLots.reduce((a, s) => a + s.listLot, 0);
  const strWeighted = wTotal > 0 ? strLots.reduce((a, s) => a + s.sellThru * s.listLot, 0) / wTotal : 0;

  // --- Bricqer list totals ---
  const listTotal = scored.reduce((a, s) => a + s.listLot, 0);
  const listLots = scored.filter((s) => s.listLot > 0);
  const listMedian = median(listLots.map((s) => s.listLot));
  const listMean = mean(listLots.map((s) => s.listLot));

  // --- Histogram by STR bucket ---
  const buckets = ['hot (>=1.0)', 'warm (0.5-1)', 'tepid (0.25-0.5)', 'cold (<0.25)', 'dead (0)', 'no-data'];
  const histo: Record<string, { lots: number; pieces: number; ask: number; list: number }> = {};
  for (const b of buckets) histo[b] = { lots: 0, pieces: 0, ask: 0, list: 0 };
  for (const s of scored) {
    const h = histo[s.bucket];
    h.lots++;
    h.pieces += s.invQty;
    h.ask += s.askLot;
    h.list += s.listLot;
  }

  // --- Top 20 lots by Bricqer list value ---
  const top20 = [...scored].sort((a, b) => b.listLot - a.listLot).slice(0, 20);

  // --- Print report ---
  const money = (n: number, w = 0) => `£${n.toFixed(2)}`.padStart(w);
  const pad = (s: string, w: number) => s.padEnd(w).slice(0, w);
  const padL = (s: string | number, w: number) => String(s).padStart(w);

  console.log(`\n========================================================================`);
  console.log(`  ${SLUG}  -  Bricqer-pricing analysis  (${new Date().toISOString().slice(0, 10)})`);
  console.log(`========================================================================`);
  console.log(`  Lots: ${items.length}    Pieces: ${items.reduce((s, i) => s + i.invQty, 0)}`);
  console.log(`  Current ask total:        £${askTotal.toFixed(2)}   (informational only)`);
  console.log(`  Bricqer list total:       £${listTotal.toFixed(2)}`);
  console.log(`  Ratio (list / ask):       ${(listTotal / Math.max(0.01, askTotal)).toFixed(2)}×`);
  console.log(``);
  console.log(`  Sell-through (UK 6-month sold ÷ UK stock):`);
  console.log(`    Median STR:             ${strMedian.toFixed(3)}`);
  console.log(`    Mean STR:               ${strMean.toFixed(3)}`);
  console.log(`    Outlay-weighted STR:    ${strWeighted.toFixed(3)}   (weighted by Bricqer list £/lot)`);
  console.log(`    P25 / P75:              ${pctile(strs, 0.25).toFixed(3)} / ${pctile(strs, 0.75).toFixed(3)}`);
  console.log(``);
  console.log(`  Bricqer list £/lot:`);
  console.log(`    Median:                 £${listMedian.toFixed(2)}`);
  console.log(`    Mean:                   £${listMean.toFixed(2)}`);
  console.log(``);
  console.log(`  Coverage:`);
  for (const [src, n] of Object.entries(cov).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${pad(src, 12)} ${padL(n, 4)}  (${(n / scored.length * 100).toFixed(0)}%)`);
  }
  console.log(``);
  console.log(`  Histogram by sell-through:`);
  console.log(`    ${pad('Bucket', 20)} ${padL('Lots', 5)} ${padL('Pieces', 7)} ${padL('Ask £', 10)} ${padL('List £', 10)} ${padL('% list', 6)}`);
  for (const b of buckets) {
    const h = histo[b];
    if (h.lots === 0) continue;
    const pctList = listTotal > 0 ? (h.list / listTotal * 100).toFixed(0) + '%' : '0%';
    console.log(`    ${pad(b, 20)} ${padL(h.lots, 5)} ${padL(h.pieces, 7)} ${money(h.ask, 10)} ${money(h.list, 10)} ${padL(pctList, 6)}`);
  }
  console.log(``);
  console.log(`  Top 20 lots by Bricqer list £:`);
  console.log(`    #  T  Item            ${pad('Name', 30)} ${pad('Colour', 16)}  Qty   Sold UK  Stock UK  STR   List/u   List £   Cur Ask £`);
  console.log(`    -- -  --------------  ${'-'.repeat(30)} ${'-'.repeat(16)}  ----  -------  --------  ----  -------  -------  ---------`);
  top20.forEach((s, i) => {
    const e = enriched.get(`${s.itemType}:${s.itemNo}:${s.colourId}:${s.invNew === 'New' ? 'N' : 'U'}`);
    console.log(`    ${padL(i + 1, 2)} ${s.itemType}  ${pad(s.itemNo, 14)}  ${pad(s.itemName, 30)} ${pad(s.colourName ?? '-', 16)}  ${padL(s.invQty, 4)}  ${padL(e?.ukSoldQty ?? 0, 7)}  ${padL(e?.ukStockQty ?? 0, 8)}  ${padL(s.sellThru.toFixed(2), 4)}  ${money(s.listPerUnit, 7)}  ${money(s.listLot, 7)}  ${money(s.askLot, 9)}`);
  });

  console.log(`\n  Negotiation hooks:`);
  const dead = histo['dead (0)'];
  const cold = histo['cold (<0.25)'];
  const noData = histo['no-data'];
  console.log(`    Dead inventory (0 UK sales 6mo):     ${dead.lots} lots / ${dead.pieces} pcs / £${dead.list.toFixed(2)} list`);
  console.log(`    Cold inventory (STR < 0.25):         ${cold.lots} lots / ${cold.pieces} pcs / £${cold.list.toFixed(2)} list`);
  console.log(`    No UK benchmark (excluded from list): ${noData.lots} lots / ${noData.pieces} pcs / £${noData.ask.toFixed(2)} at ask`);
  const slowPct = listTotal > 0 ? ((cold.list + dead.list) / listTotal * 100).toFixed(0) : '0';
  console.log(`    Cold+dead share of list:             ${slowPct}%   (this is the part that justifies a discount)`);

  // --- Persist ---
  const outFile = path.join(OUT_DIR, `analysis-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(outFile, JSON.stringify({
    slug: SLUG,
    scrapedAt: new Date().toISOString(),
    items: items.length,
    pieces: items.reduce((s, i) => s + i.invQty, 0),
    askTotal,
    listTotal,
    strMedian, strMean, strWeighted,
    listMedian, listMean,
    coverage: cov,
    histo,
    top20: top20.map((s) => ({ type: s.itemType, no: s.itemNo, colour: s.colourName, qty: s.invQty, str: s.sellThru, listPerUnit: s.listPerUnit, listLot: s.listLot, askLot: s.askLot })),
  }, null, 2));
  console.log(`\nSaved to ${outFile}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
