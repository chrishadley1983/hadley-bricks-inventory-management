/**
 * "What if we re-listed the cold New stock as Used?"
 *
 * Reads the analysis JSON (or recomputes from inventory.json + cache) to
 * identify lots scored as cold (STR < 0.25) in their current condition.
 * For each cold-N lot, fetches UK Used sold + Used stock and re-scores
 * with the Bricqer Used multiplier curve. Reports aggregate STR + list
 * delta so we can decide whether condition-flipping changes the picture.
 *
 * Cache-first (re-uses bricklink_part_price_cache rows, which carry both
 * N and U fields) — only hits the API for missing Used tuples.
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/reprice-cold-as-used.ts --store-slug=<SLUG>
 *   Optional: --threshold=0.25 --cache-ttl-days=90 --api-delay-ms=250 --api-budget=2000
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
const THRESHOLD = parseFloat(argv['threshold'] ?? '0.25');
const CACHE_TTL_DAYS = parseInt(argv['cache-ttl-days'] ?? '90', 10);
const API_DELAY_MS = parseInt(argv['api-delay-ms'] ?? '250', 10);
const API_BUDGET = parseInt(argv['api-budget'] ?? '2000', 10);

const ROOT = path.resolve(__dirname, '..', '..', '..');
const OUT_DIR = path.join(ROOT, 'tmp', 'stores', SLUG);
const INV_PATH = path.join(OUT_DIR, 'inventory.json');
if (!fs.existsSync(INV_PATH)) { console.error(`No inventory.json at ${INV_PATH}`); process.exit(1); }

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
const bl = new BrickLinkClient(creds, { supabase, caller: 'reprice-cold-as-used-script' });

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
const mean = (xs: number[]) => xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

interface Slot { ukSoldAvg: number | null; ukSoldQty: number; ukStockQty: number; source: 'cache' | 'api' | 'none' }

async function main() {
  const items: ScrapedItem[] = JSON.parse(fs.readFileSync(INV_PATH, 'utf8'));
  // Only lots whose CURRENT condition is N — if seller already has them as U we don't reprice them.
  const newLots = items.filter((it) => it.invNew === 'New' && (it.itemType === 'P' || it.itemType === 'M'));
  console.log(`\n==== Reprice cold New as Used ====`);
  console.log(`Store: ${SLUG}`);
  console.log(`New-condition P/M lots: ${newLots.length}`);

  // Build need-set (one (part, colour) tuple per unique combo for both N and U)
  type Tuple = { itemType: StoreItemCode; itemNo: string; colourId: number };
  const tuples = new Map<string, Tuple>();
  for (const it of newLots) {
    const k = `${it.itemType}:${it.itemNo}:${it.colourId}`;
    if (!tuples.has(k)) tuples.set(k, { itemType: it.itemType, itemNo: it.itemNo, colourId: it.colourId });
  }
  console.log(`Unique (item, colour) tuples: ${tuples.size}`);

  // --- Cache lookup (both N and U at once) ---
  type CacheRow = { part_number: string; part_type: string; colour_id: number; price_new: string | null; price_used: string | null; stock_available_new: number | null; stock_available_used: number | null; times_sold_new: number | null; times_sold_used: number | null; fetched_at: string };
  const newSlot = new Map<string, Slot>();
  const usedSlot = new Map<string, Slot>();
  const ttlMs = CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const partNos = [...new Set(newLots.map((i) => i.itemNo))];
  const CHUNK = 500;
  const PAGE = 1000;
  let totalRows = 0;
  for (let i = 0; i < partNos.length; i += CHUNK) {
    const chunk = partNos.slice(i, i + CHUNK);
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
        const code = row.part_type === 'PART' ? 'P' : 'M';
        const key = `${code}:${row.part_number}:${row.colour_id}`;
        const stN = row.stock_available_new, soN = row.times_sold_new;
        const stU = row.stock_available_used, soU = row.times_sold_used;
        if (stN != null && soN != null && row.price_new != null) {
          const p = parseFloat(row.price_new);
          if (p > 0) newSlot.set(key, { ukSoldAvg: p, ukSoldQty: soN, ukStockQty: stN, source: 'cache' });
        }
        if (stU != null && soU != null) {
          if (row.price_used != null) {
            const p = parseFloat(row.price_used);
            if (p > 0) usedSlot.set(key, { ukSoldAvg: p, ukSoldQty: soU, ukStockQty: stU, source: 'cache' });
            else if (soU === 0) usedSlot.set(key, { ukSoldAvg: null, ukSoldQty: 0, ukStockQty: stU, source: 'cache' });
          } else if (soU === 0) {
            usedSlot.set(key, { ukSoldAvg: null, ukSoldQty: 0, ukStockQty: stU, source: 'cache' });
          }
        }
      }
      if (rows.length < PAGE) break;
      pageStart += PAGE;
    }
  }
  console.log(`Cache: ${newSlot.size} N tuples, ${usedSlot.size} U tuples (${totalRows} rows scanned)`);

  // --- Identify cold New lots ---
  type ColdRow = { it: ScrapedItem; key: string; nSlot: Slot | null; nStr: number; nList: number; nLot: number };
  const coldRows: ColdRow[] = [];
  for (const it of newLots) {
    const key = `${it.itemType}:${it.itemNo}:${it.colourId}`;
    const ns = newSlot.get(key) ?? null;
    if (!ns || ns.ukSoldAvg == null) continue; // can't classify without N benchmark
    const str = ns.ukStockQty > 0 ? ns.ukSoldQty / ns.ukStockQty : 0;
    if (str >= THRESHOLD) continue;
    const mul = bricqerMultiplier('N', str);
    const listPerUnit = ns.ukSoldAvg * mul;
    coldRows.push({ it, key, nSlot: ns, nStr: str, nList: listPerUnit, nLot: listPerUnit * it.invQty });
  }
  const coldListTotal = coldRows.reduce((a, r) => a + r.nLot, 0);
  console.log(`Cold-N lots (STR < ${THRESHOLD}): ${coldRows.length} lots, £${coldListTotal.toFixed(2)} N-list`);

  // --- For each cold lot, identify whether we still need to fetch Used data ---
  const needFetch = new Map<string, Tuple>();
  for (const r of coldRows) {
    if (!usedSlot.has(r.key)) needFetch.set(r.key, { itemType: r.it.itemType, itemNo: r.it.itemNo, colourId: r.it.colourId });
  }
  console.log(`Need to fetch Used data for: ${needFetch.size} tuples (~${Math.ceil(needFetch.size * 2 * API_DELAY_MS / 60000)} min)`);

  let calls = 0, fetched = 0, nullCnt = 0;
  type Upsert = { part_number: string; part_type: string; colour_id: number; price_used: number | null; stock_available_used: number; times_sold_used: number; fetched_at: string };
  const upserts: Upsert[] = [];
  for (const [key, t] of needFetch) {
    if (calls + 2 > API_BUDGET) { console.warn(`API budget reached`); break; }
    try {
      await sleep(API_DELAY_MS);
      const sold: BrickLinkPriceGuide = await bl.getPartPriceGuide(STORE_TO_API[t.itemType], t.itemNo, t.colourId, { condition: 'U', guideType: 'sold', currencyCode: 'GBP', countryCode: 'UK' });
      calls++;
      await sleep(API_DELAY_MS);
      const stock: BrickLinkPriceGuide = await bl.getPartPriceGuide(STORE_TO_API[t.itemType], t.itemNo, t.colourId, { condition: 'U', guideType: 'stock', currencyCode: 'GBP', countryCode: 'UK' });
      calls++;
      fetched++;
      const avg = parseFloat(sold.avg_price);
      const soldQty = sold.total_quantity ?? 0;
      const stockQty = stock.total_quantity ?? 0;
      if (avg > 0 && soldQty > 0) usedSlot.set(key, { ukSoldAvg: avg, ukSoldQty: soldQty, ukStockQty: stockQty, source: 'api' });
      else { usedSlot.set(key, { ukSoldAvg: null, ukSoldQty: 0, ukStockQty: stockQty, source: 'api' }); nullCnt++; }
      upserts.push({ part_number: t.itemNo, part_type: t.itemType === 'P' ? 'PART' : 'MINIFIG', colour_id: t.colourId, price_used: avg > 0 && soldQty > 0 ? avg : null, stock_available_used: stockQty, times_sold_used: soldQty, fetched_at: new Date().toISOString() });
      if (fetched % 50 === 0) console.log(`  fetched ${fetched}/${needFetch.size} (${nullCnt} no-used-sales)`);
    } catch (err) {
      console.warn(`  fetch error ${key}: ${(err as Error).message}`);
    }
  }
  console.log(`Fetched ${fetched} Used tuples (${nullCnt} returned no UK Used sales).`);

  // Note: skipping cache upsert here — table has the upsert-constraint mismatch already
  // surfaced in the main analysis run; we don't want the same warnings to clutter the report.

  // --- Reprice each cold-N lot with Used data ---
  type Repriced = ColdRow & {
    uSlot: Slot | null;
    uStr: number;
    uList: number; // per unit
    uLot: number;
    deltaList: number; // uLot - nLot
    bucket: 'no-used-data' | 'cold-stays-cold' | 'becomes-tepid' | 'becomes-warm' | 'becomes-hot';
  };
  const repriced: Repriced[] = coldRows.map((r) => {
    const us = usedSlot.get(r.key) ?? null;
    if (!us || us.ukSoldAvg == null) {
      return { ...r, uSlot: us, uStr: 0, uList: 0, uLot: 0, deltaList: -r.nLot, bucket: 'no-used-data' as const };
    }
    const uStr = us.ukStockQty > 0 ? us.ukSoldQty / us.ukStockQty : 0;
    const uMul = bricqerMultiplier('U', uStr);
    const uList = us.ukSoldAvg * uMul;
    const uLot = uList * r.it.invQty;
    let bucket: Repriced['bucket'];
    if (uStr >= 1) bucket = 'becomes-hot';
    else if (uStr >= 0.5) bucket = 'becomes-warm';
    else if (uStr >= 0.25) bucket = 'becomes-tepid';
    else bucket = 'cold-stays-cold';
    return { ...r, uSlot: us, uStr, uList, uLot, deltaList: uLot - r.nLot, bucket };
  });

  // --- Aggregate metrics ---
  const repriceable = repriced.filter((r) => r.bucket !== 'no-used-data');
  const upgraded = repriced.filter((r) => r.bucket !== 'cold-stays-cold' && r.bucket !== 'no-used-data');
  const nStrs = repriced.map((r) => r.nStr);
  const uStrs = repriceable.map((r) => r.uStr);
  const newListSum = repriced.reduce((a, r) => a + r.nLot, 0);
  const usedListSum = repriced.reduce((a, r) => a + r.uLot, 0);
  const noUsedListLost = repriced.filter((r) => r.bucket === 'no-used-data').reduce((a, r) => a + r.nLot, 0);

  // Bucket counts
  const buckets: Repriced['bucket'][] = ['becomes-hot', 'becomes-warm', 'becomes-tepid', 'cold-stays-cold', 'no-used-data'];
  const histo: Record<string, { lots: number; pieces: number; nList: number; uList: number; delta: number }> = {};
  for (const b of buckets) histo[b] = { lots: 0, pieces: 0, nList: 0, uList: 0, delta: 0 };
  for (const r of repriced) {
    const h = histo[r.bucket];
    h.lots++;
    h.pieces += r.it.invQty;
    h.nList += r.nLot;
    h.uList += r.uLot;
    h.delta += r.deltaList;
  }

  // --- Report ---
  const money = (n: number) => `${n >= 0 ? '+' : ''}£${n.toFixed(2)}`;
  const moneyAbs = (n: number) => `£${n.toFixed(2)}`;
  const pad = (s: string, w: number) => s.padEnd(w).slice(0, w);
  const padL = (s: string | number, w: number) => String(s).padStart(w);

  console.log(`\n========================================================================`);
  console.log(`  ${SLUG}  -  Cold-New repriced as Used  (${new Date().toISOString().slice(0, 10)})`);
  console.log(`  Threshold: STR < ${THRESHOLD}`);
  console.log(`========================================================================`);
  console.log(`  Cold-N lots considered:           ${coldRows.length}`);
  console.log(`  ... with Used UK benchmark:       ${repriceable.length}  (${(repriceable.length / coldRows.length * 100).toFixed(0)}%)`);
  console.log(`  ... become tepid/warm/hot as U:   ${upgraded.length}  (${(upgraded.length / coldRows.length * 100).toFixed(0)}%)`);
  console.log(``);
  console.log(`  STR shift:`);
  console.log(`    Median STR (N):    ${median(nStrs).toFixed(3)}`);
  console.log(`    Median STR (U):    ${median(uStrs).toFixed(3)}`);
  console.log(`    Mean STR (N):      ${mean(nStrs).toFixed(3)}`);
  console.log(`    Mean STR (U):      ${mean(uStrs).toFixed(3)}`);
  console.log(``);
  console.log(`  Bricqer list value:`);
  console.log(`    As New (current):                  ${moneyAbs(newListSum)}`);
  console.log(`    As Used (with Used multiplier):    ${moneyAbs(usedListSum)}`);
  console.log(`    Delta:                             ${money(usedListSum - newListSum)}`);
  console.log(`    (incl. ${moneyAbs(noUsedListLost)} from ${histo['no-used-data'].lots} lots with no UK Used sales — counted as £0 if relisted)`);
  console.log(``);
  console.log(`  Histogram by Used-condition outcome:`);
  console.log(`    ${pad('Bucket', 18)} ${padL('Lots', 5)} ${padL('Pieces', 7)} ${padL('N-List', 10)} ${padL('U-List', 10)} ${padL('Delta', 10)}`);
  for (const b of buckets) {
    const h = histo[b];
    if (h.lots === 0) continue;
    console.log(`    ${pad(b, 18)} ${padL(h.lots, 5)} ${padL(h.pieces, 7)} ${padL(moneyAbs(h.nList), 10)} ${padL(moneyAbs(h.uList), 10)} ${padL(money(h.delta), 10)}`);
  }
  console.log(``);
  console.log(`  Top 20 biggest list-value GAINS from N → U:`);
  const topGains = [...repriced].sort((a, b) => b.deltaList - a.deltaList).slice(0, 20);
  console.log(`    #  T  Item            ${pad('Name', 28)} ${pad('Colour', 16)}  Qty  N-STR U-STR  ${pad('N-List', 8)}  ${pad('U-List', 8)}  Delta`);
  topGains.forEach((r, i) => {
    console.log(`    ${padL(i + 1, 2)} ${r.it.itemType}  ${pad(r.it.itemNo, 14)}  ${pad(r.it.itemName, 28)} ${pad(r.it.colourName ?? '-', 16)}  ${padL(r.it.invQty, 4)}  ${padL(r.nStr.toFixed(2), 4)}  ${padL(r.uStr.toFixed(2), 4)}  ${padL(moneyAbs(r.nLot), 8)}  ${padL(moneyAbs(r.uLot), 8)}  ${money(r.deltaList)}`);
  });
  console.log(``);
  console.log(`  Top 10 biggest list-value LOSSES from N → U:`);
  const topLosses = [...repriced].sort((a, b) => a.deltaList - b.deltaList).slice(0, 10);
  console.log(`    #  T  Item            ${pad('Name', 28)} ${pad('Colour', 16)}  Qty  N-STR U-STR  ${pad('N-List', 8)}  ${pad('U-List', 8)}  Delta`);
  topLosses.forEach((r, i) => {
    console.log(`    ${padL(i + 1, 2)} ${r.it.itemType}  ${pad(r.it.itemNo, 14)}  ${pad(r.it.itemName, 28)} ${pad(r.it.colourName ?? '-', 16)}  ${padL(r.it.invQty, 4)}  ${padL(r.nStr.toFixed(2), 4)}  ${padL(r.uStr.toFixed(2), 4)}  ${padL(moneyAbs(r.nLot), 8)}  ${padL(moneyAbs(r.uLot), 8)}  ${money(r.deltaList)}`);
  });

  const outFile = path.join(OUT_DIR, `reprice-cold-as-used-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(outFile, JSON.stringify({
    slug: SLUG,
    threshold: THRESHOLD,
    coldLots: coldRows.length,
    repriceable: repriceable.length,
    upgraded: upgraded.length,
    newListSum, usedListSum,
    delta: usedListSum - newListSum,
    medianStrN: median(nStrs), medianStrU: median(uStrs),
    meanStrN: mean(nStrs), meanStrU: mean(uStrs),
    histo,
    repriced: repriced.map((r) => ({ type: r.it.itemType, no: r.it.itemNo, colour: r.it.colourName, qty: r.it.invQty, nStr: r.nStr, uStr: r.uStr, nLot: r.nLot, uLot: r.uLot, delta: r.deltaList, bucket: r.bucket })),
  }, null, 2));
  console.log(`\nSaved to ${outFile}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
