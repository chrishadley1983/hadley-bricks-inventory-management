/**
 * Part out a LEGO set at Bricqer pricing (condition=N).
 *
 * Process:
 *   1. Fetch parts list via BL getSubset(SET, <num>) — 1 call.
 *   2. For each unique (partNumber, colourId), read the unified price cache (free).
 *   3. For uncached: ensurePriceGuide (4 BL API calls each — all four quadrants,
 *      captured automatically into the unified cache).
 *   4. Apply the CANONICAL Bricqer formula (src/lib/bricklink/bricqer-pricing.ts,
 *      v3 multipliers + £0.0699 floor):
 *      List price per part = max(0.0699, UK sold avg × multiplier)
 *   5. Sum (list price × qty) across the set.
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/partout-bricqer-pricing.ts --set=8008
 *   cd apps/web && npx tsx scripts/partout-bricqer-pricing.ts --set=8008 --condition=N --no-api  (cache only)
 */
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
import { BrickLinkApiError } from '../src/lib/bricklink/client';
import { ensurePriceGuide } from '../src/lib/bricklink/price-guide/capture';
import { readPriceGuide, pgKey, type ItemRef } from '../src/lib/bricklink/price-guide/read';
import { bricqerMultiplier, bricqerListPrice } from '../src/lib/bricklink/bricqer-pricing';
import { createScriptBlContext } from './_bl-client';

const argv = process.argv.slice(2).reduce<Record<string, string>>((acc, a) => { const [k, v] = a.replace(/^--/, '').split('='); acc[k] = v ?? 'true'; return acc; }, {});
const SET_NUMBER = argv['set'] ?? argv['set-number'];
if (!SET_NUMBER) { console.error('Required: --set=<number>  (e.g. --set=8008)'); process.exit(1); }
const CONDITION: 'N' | 'U' = (argv['condition'] === 'U' ? 'U' : 'N');
const NO_API = argv['no-api'] === 'true';
const API_DELAY_MS = parseInt(argv['api-delay-ms'] ?? '250', 10);
const CACHE_TTL_DAYS = parseInt(argv['cache-ttl-days'] ?? '90', 10);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const { bl, supabase } = createScriptBlContext('partout-bricqer-pricing-script');

// Canonical Bricqer formula (v3 + 7p floor) imported from bricqer-pricing.ts — never re-inline.

interface PartLine {
  itemNo: string;
  itemType: 'PART' | 'MINIFIG';
  colourId: number;
  colourName: string | null;
  itemName: string | null;
  qty: number;
  ukSoldAvg: number | null;
  ukSoldQty: number;
  ukStockQty: number;
  sellThru: number;
  multiplier: number;
  listPricePerUnit: number | null;
  lineTotal: number | null;
  source: 'cache' | 'api' | 'cache-none' | 'none';
}

(async () => {
  console.log(`Parting out set ${SET_NUMBER} at Bricqer ${CONDITION} pricing\n`);

  // 1. Fetch subset.
  const subset = await bl.request<Array<{ match_no: number; entries: Array<{ item: { no: string; type: string; name?: string }; color_id: number; quantity: number; extra_quantity?: number; is_alternate?: boolean; is_counterpart?: boolean }> }>>('GET', `/items/SET/${encodeURIComponent(SET_NUMBER)}/subsets`, { breakSubsets: 'false' });
  if (!subset || !Array.isArray(subset) || subset.length === 0) { console.error(`No subset data for set ${SET_NUMBER}`); process.exit(1); }
  // Flatten entries; ignore alternates/counterparts (those are just options, would double-count).
  const parts: Array<{ itemNo: string; itemType: 'PART' | 'MINIFIG'; colourId: number; itemName: string | null; qty: number }> = [];
  for (const group of subset) {
    for (const e of group.entries) {
      if (e.is_alternate || e.is_counterpart) continue;
      const t = e.item.type === 'PART' || e.item.type === 'MINIFIG' ? e.item.type : null;
      if (!t) continue;
      parts.push({ itemNo: e.item.no, itemType: t as 'PART' | 'MINIFIG', colourId: e.color_id, itemName: e.item.name ?? null, qty: e.quantity + (e.extra_quantity ?? 0) });
    }
  }
  console.log(`Subset: ${parts.length} unique part-colour entries, ${parts.reduce((s, p) => s + p.qty, 0)} pieces total`);

  // 2. Cache lookup for all parts (unified price cache via readPriceGuide).
  //    getSubset colour ids are BL-scheme. Strict UK — no world fallback; a
  //    non-UK view is a cache miss.
  const uniqueRefs = new Map<string, ItemRef>();
  for (const p of parts) {
    const k = `${p.itemNo}:${p.colourId}`;
    if (!uniqueRefs.has(k)) uniqueRefs.set(k, { itemType: p.itemType === 'MINIFIG' ? 'M' : 'P', itemNo: p.itemNo, colourId: p.colourId, scheme: 'bl' });
  }
  const cacheMap = new Map<string, { ukSoldAvg: number | null; ukSoldQty: number; ukStockQty: number; source: 'cache' | 'cache-none' }>();
  const views = await readPriceGuide(supabase, [...uniqueRefs.values()], { ttlDays: CACHE_TTL_DAYS, allowWorldFallback: false });
  for (const [k, ref] of uniqueRefs) {
    const view = views.get(pgKey(ref.itemType, ref.itemNo, ref.colourId));
    if (!view || view.coverage !== 'uk') continue; // cache miss → fetch below
    const side = CONDITION === 'N' ? view.new : view.used;
    if (side.soldAvg !== null && side.soldAvg > 0) cacheMap.set(k, { ukSoldAvg: side.soldAvg, ukSoldQty: side.soldQty, ukStockQty: side.stockQty, source: 'cache' });
    else if (side.soldQty === 0) cacheMap.set(k, { ukSoldAvg: null, ukSoldQty: 0, ukStockQty: side.stockQty, source: 'cache-none' });
  }
  const needFetch = parts.filter((p) => !cacheMap.has(`${p.itemNo}:${p.colourId}`));
  console.log(`Cache hits: ${cacheMap.size} / ${parts.length}.  Need to fetch: ${needFetch.length} via BL API.`);
  if (NO_API && needFetch.length > 0) console.log('--no-api set; uncached parts will be marked as no-data.');

  // 3. Fetch uncached parts (ensurePriceGuide: 4 BL calls per part — all four
  //    quadrants — captured automatically into the unified cache; no write-back).
  let calls = 0;
  if (!NO_API) {
    for (const p of needFetch) {
      const key = `${p.itemNo}:${p.colourId}`;
      if (cacheMap.has(key)) continue; // duplicate subset entry already fetched this run
      try {
        await sleep(API_DELAY_MS);
        const view = await ensurePriceGuide(bl, supabase, { itemType: p.itemType === 'MINIFIG' ? 'M' : 'P', itemNo: p.itemNo, colourId: p.colourId }, { ttlDays: CACHE_TTL_DAYS });
        calls += 4;
        const side = CONDITION === 'N' ? view.new : view.used;
        if (side.soldAvg !== null && side.soldAvg > 0) cacheMap.set(key, { ukSoldAvg: side.soldAvg, ukSoldQty: side.soldQty, ukStockQty: side.stockQty, source: 'cache' as const });
        else cacheMap.set(key, { ukSoldAvg: null, ukSoldQty: 0, ukStockQty: side.stockQty, source: 'cache-none' as const });
        if (calls % 20 === 0) console.log(`  fetched ${calls} calls (${Math.ceil(calls / 4)}/${needFetch.length} parts)`);
      } catch (err) {
        if (err instanceof BrickLinkApiError && err.code === 429) { console.error('  rate limit, stopping'); break; }
        // Soft-fail: leave key absent.
      }
    }
  }

  // 4. Apply Bricqer formula + 5. tabulate.
  const lines: PartLine[] = parts.map((p) => {
    const key = `${p.itemNo}:${p.colourId}`;
    const entry = cacheMap.get(key);
    if (!entry) return { itemNo: p.itemNo, itemType: p.itemType, colourId: p.colourId, colourName: null, itemName: p.itemName, qty: p.qty, ukSoldAvg: null, ukSoldQty: 0, ukStockQty: 0, sellThru: 0, multiplier: 0, listPricePerUnit: null, lineTotal: null, source: 'none' as const };
    const sellThru = entry.ukStockQty > 0 ? entry.ukSoldQty / entry.ukStockQty : 0;
    const multiplier = bricqerMultiplier(CONDITION, sellThru);
    const list = bricqerListPrice(entry.ukSoldAvg, CONDITION, sellThru);
    return { itemNo: p.itemNo, itemType: p.itemType, colourId: p.colourId, colourName: null, itemName: p.itemName, qty: p.qty, ukSoldAvg: entry.ukSoldAvg, ukSoldQty: entry.ukSoldQty, ukStockQty: entry.ukStockQty, sellThru, multiplier, listPricePerUnit: list, lineTotal: list !== null ? list * p.qty : null, source: entry.source };
  });

  // Render report.
  lines.sort((a, b) => (b.lineTotal ?? 0) - (a.lineTotal ?? 0));
  let totalList = 0, pricedLines = 0, unpricedLines = 0, totalPieces = 0;
  for (const l of lines) {
    totalPieces += l.qty;
    if (l.lineTotal !== null) { totalList += l.lineTotal; pricedLines++; }
    else unpricedLines++;
  }
  console.log();
  console.log(`Set ${SET_NUMBER} part-out @ Bricqer ${CONDITION} pricing`);
  console.log('='.repeat(110));
  console.log(`#   ItemNo          col  qty  ${CONDITION}-avg    STR    mult  list/u    lineTotal`);
  console.log('-'.repeat(110));
  lines.forEach((l, i) => {
    const t = l.itemType[0];
    const avg = l.ukSoldAvg !== null ? '£' + l.ukSoldAvg.toFixed(3) : '   -   ';
    const str = l.ukStockQty > 0 ? l.sellThru.toFixed(2) : '  - ';
    const mult = l.multiplier ? l.multiplier.toFixed(2) : ' -  ';
    const list = l.listPricePerUnit !== null ? '£' + l.listPricePerUnit.toFixed(3) : '   -   ';
    const tot = l.lineTotal !== null ? '£' + l.lineTotal.toFixed(2) : '  -  ';
    console.log(`${String(i + 1).padStart(3)} ${t} ${l.itemNo.padEnd(13)}  ${String(l.colourId).padStart(3)}  ${String(l.qty).padStart(3)}  ${avg.padStart(8)}  ${str.padStart(4)}  ${mult.padStart(4)}  ${list.padStart(8)}  ${tot.padStart(8)}  ${l.source}`);
  });
  console.log('='.repeat(110));
  console.log(`Total pieces:                ${totalPieces}`);
  console.log(`Priced lines:                ${pricedLines}/${lines.length}`);
  console.log(`Unpriced (no UK sold data):  ${unpricedLines}`);
  console.log(`API calls used this run:     ${calls}`);
  console.log(`──────────────────────────────────`);
  console.log(`  TOTAL Bricqer ${CONDITION} list value:  £${totalList.toFixed(2)}`);
  console.log(`──────────────────────────────────`);
  if (unpricedLines > 0) console.log(`(${unpricedLines} unpriced lines not included in total — typically rare colours or no UK sales in last 6mo)`);
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
