/**
 * Part out a LEGO set at Bricqer pricing (condition=N).
 *
 * Process:
 *   1. Fetch parts list via BL getSubset(SET, <num>) — 1 call.
 *   2. For each unique (partNumber, colourId), look up bricklink_part_price_cache (free).
 *   3. For uncached: fetch UK sold + stock guide pair (2 BL API calls each).
 *   4. Apply Bricqer multiplier:
 *        condition N, STR >= 0.5 → × 1.05
 *        condition N, STR  < 0.5 → × 0.90
 *      List price per part = UK sold avg × multiplier
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

function bricqerMultiplier(condition: 'N' | 'U', sellThru: number): number {
  if (condition === 'N') return sellThru >= 0.5 ? 1.05 : 0.90;
  if (sellThru >= 1) return 1.25;
  if (sellThru >= 0.75) return 1.15;
  if (sellThru >= 0.5) return 1.10;
  if (sellThru >= 0.25) return 0.90;
  return 0.85;
}

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

  // 2. Cache lookup for all parts.
  const uniquePartNos = [...new Set(parts.map((p) => p.itemNo))];
  const cacheMap = new Map<string, { ukSoldAvg: number | null; ukSoldQty: number; ukStockQty: number; source: 'cache' | 'cache-none' }>();
  const now = Date.now();
  const ttlMs = CACHE_TTL_DAYS * 86400_000;
  const CHUNK = 500;
  for (let i = 0; i < uniquePartNos.length; i += CHUNK) {
    const chunk = uniquePartNos.slice(i, i + CHUNK);
    const { data } = await supabase.from('bricklink_part_price_cache').select('part_number, colour_id, price_new, price_used, stock_available_new, stock_available_used, times_sold_new, times_sold_used, fetched_at').in('part_number', chunk);
    for (const row of (data ?? []) as Array<{ part_number: string; colour_id: number; price_new: string | null; price_used: string | null; stock_available_new: number | null; stock_available_used: number | null; times_sold_new: number | null; times_sold_used: number | null; fetched_at: string }>) {
      const fresh = now - new Date(row.fetched_at).getTime() < ttlMs;
      if (!fresh) continue;
      const priceStr = CONDITION === 'N' ? row.price_new : row.price_used;
      const stock = CONDITION === 'N' ? row.stock_available_new : row.stock_available_used;
      const sold = CONDITION === 'N' ? row.times_sold_new : row.times_sold_used;
      if (sold == null || stock == null) continue;
      const key = `${row.part_number}:${row.colour_id}`;
      if (priceStr != null) {
        const price = parseFloat(priceStr);
        if (price > 0) { cacheMap.set(key, { ukSoldAvg: price, ukSoldQty: sold, ukStockQty: stock, source: 'cache' }); continue; }
      }
      if (sold === 0) cacheMap.set(key, { ukSoldAvg: null, ukSoldQty: 0, ukStockQty: stock, source: 'cache-none' });
    }
  }
  const needFetch = parts.filter((p) => !cacheMap.has(`${p.itemNo}:${p.colourId}`));
  console.log(`Cache hits: ${cacheMap.size} / ${parts.length}.  Need to fetch: ${needFetch.length} via BL API.`);
  if (NO_API && needFetch.length > 0) console.log('--no-api set; uncached parts will be marked as no-data.');

  // 3. Fetch uncached parts.
  let calls = 0;
  if (!NO_API) {
    for (const p of needFetch) {
      try {
        await sleep(API_DELAY_MS);
        const sold = await bl.getPartPriceGuide(p.itemType, p.itemNo, p.colourId, { condition: CONDITION, guideType: 'sold', currencyCode: 'GBP', countryCode: 'UK' });
        calls++;
        await sleep(API_DELAY_MS);
        const stock = await bl.getPartPriceGuide(p.itemType, p.itemNo, p.colourId, { condition: CONDITION, guideType: 'stock', currencyCode: 'GBP', countryCode: 'UK' });
        calls++;
        const avg = parseFloat(sold.avg_price);
        const soldQty = sold.total_quantity ?? 0;
        const stockQty = stock.total_quantity ?? 0;
        const key = `${p.itemNo}:${p.colourId}`;
        if (avg > 0) cacheMap.set(key, { ukSoldAvg: avg, ukSoldQty: soldQty, ukStockQty: stockQty, source: 'cache' as const });
        else cacheMap.set(key, { ukSoldAvg: null, ukSoldQty: 0, ukStockQty: stockQty, source: 'cache-none' as const });
        if (calls % 20 === 0) console.log(`  fetched ${calls} calls (${Math.ceil(calls / 2)}/${needFetch.length} parts)`);
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
    const list = entry.ukSoldAvg !== null ? entry.ukSoldAvg * multiplier : null;
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
