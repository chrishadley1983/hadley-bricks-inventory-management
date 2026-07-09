/**
 * "What if we listed everything at the UK lowest new price?"
 *
 * For every (part, colour) lot in the scraped inventory, read the UK Stock
 * min ask (`uk_stock_min`) from the unified price cache — cache-first via
 * readPriceGuide, fetching uncached tuples with ensurePriceGuide (4 BL calls,
 * all quadrants, captured automatically). Compute total inventory value at
 * min × qty and compare against Bricqer-list and seller ask.
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/reprice-at-uk-min.ts --store-slug=<SLUG>
 *   Optional: --api-delay-ms=250 --api-budget=2000 --undercut-pct=0
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { ensurePriceGuide } from '../src/lib/bricklink/price-guide/capture';
import { readPriceGuide, pgKey, type ItemRef, type SideView } from '../src/lib/bricklink/price-guide/read';
import { createScriptBlContext } from './_bl-client';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const argv: Record<string, string> = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)=(.*)$/);
  if (m) argv[m[1]] = m[2];
  else if (a.startsWith('--')) argv[a.slice(2)] = 'true';
}
const SLUG = argv['store-slug'];
if (!SLUG) { console.error('Missing --store-slug=<SLUG>'); process.exit(1); }
const API_DELAY_MS = parseInt(argv['api-delay-ms'] ?? '250', 10);
const API_BUDGET = parseInt(argv['api-budget'] ?? '2000', 10);
const UNDERCUT_PCT = parseFloat(argv['undercut-pct'] ?? '0'); // e.g. 0.01 = 1% under min
const CACHE_TTL_DAYS = 90; // unified price cache freshness

const ROOT = path.resolve(__dirname, '..', '..', '..');
const OUT_DIR = path.join(ROOT, 'tmp', 'stores', SLUG);
const INV_PATH = path.join(OUT_DIR, 'inventory.json');
if (!fs.existsSync(INV_PATH)) { console.error(`No inventory.json at ${INV_PATH}`); process.exit(1); }

const { bl, supabase } = createScriptBlContext('reprice-at-uk-min-script');

type StoreItemCode = 'P' | 'S' | 'M';
type ItemCondition = 'N' | 'U';

interface ScrapedItem {
  invID: number; itemType: StoreItemCode; itemNo: string; colourId: number; colourName: string | null;
  itemName: string; invNew: string; invQty: number; unitPriceGBP: number; description: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

async function main() {
  const items: ScrapedItem[] = JSON.parse(fs.readFileSync(INV_PATH, 'utf8'));
  console.log(`\n==== Reprice at UK Min New ====`);
  console.log(`Store: ${SLUG}`);
  console.log(`Inventory: ${items.length} lots, ${items.reduce((a, i) => a + i.invQty, 0)} pieces`);
  console.log(`Undercut: ${(UNDERCUT_PCT * 100).toFixed(1)}% below UK min (0 = match)`);

  // Reuse the previous analysis JSON for ask/list comparison context
  const prevAnalysis = path.join(OUT_DIR, `analysis-2026-05-08.json`);
  let bricqerListTotal: number | null = null;
  if (fs.existsSync(prevAnalysis)) {
    const prev = JSON.parse(fs.readFileSync(prevAnalysis, 'utf8'));
    bricqerListTotal = prev.listTotal;
  }

  // Group by (type, item, colour, condition) — minimise duplicate fetches across same-tuple lots
  type Tuple = { itemType: StoreItemCode; itemNo: string; colourId: number; condition: ItemCondition };
  const tuples = new Map<string, Tuple>();
  for (const it of items) {
    const cond: ItemCondition = it.invNew === 'New' ? 'N' : 'U';
    const k = `${it.itemType}:${it.itemNo}:${it.colourId}:${cond}`;
    if (!tuples.has(k)) tuples.set(k, { itemType: it.itemType, itemNo: it.itemNo, colourId: it.colourId, condition: cond });
  }
  // Dedupe to distinct (type, item, colour) items — one unified-cache row serves
  // both conditions (all four quadrants captured together).
  const itemTuples = new Map<string, { itemType: StoreItemCode; itemNo: string; colourId: number; conditions: ItemCondition[] }>();
  for (const t of tuples.values()) {
    const ik = `${t.itemType}:${t.itemNo}:${t.colourId}`;
    const existing = itemTuples.get(ik);
    if (existing) existing.conditions.push(t.condition);
    else itemTuples.set(ik, { itemType: t.itemType, itemNo: t.itemNo, colourId: t.colourId, conditions: [t.condition] });
  }
  console.log(`Unique tuples: ${tuples.size}`);
  console.log(`Estimated runtime: ~${Math.ceil(itemTuples.size * API_DELAY_MS / 60000)} min worst-case (cache-first; 4 BL calls per uncached item)`);

  // UK Stock data per condition-tuple: min ask (uk_stock_min), qty-weighted avg ask
  // (derived from the stock histogram) and seller lot count, from the unified price
  // cache. Colour ids come from the BL store scrape → BL scheme. Strict UK, no world
  // fallback — a non-UK view is a cache miss.
  const stockGuide = new Map<string, { minPrice: number | null; qtyAvgPrice: number | null; totalQty: number; sellers: number }>();
  const applyStockSide = (key: string, side: SideView) => {
    stockGuide.set(key, {
      minPrice: side.stockMin !== null && side.stockMin > 0 ? side.stockMin : null,
      qtyAvgPrice: side.stockAvg !== null && side.stockAvg > 0 ? side.stockAvg : null,
      totalQty: side.stockQty,
      sellers: side.stockLots,
    });
  };

  const refs: ItemRef[] = [...itemTuples.values()].map((t) => ({ itemType: t.itemType, itemNo: t.itemNo, colourId: t.colourId, scheme: 'bl' as const }));
  const views = await readPriceGuide(supabase, refs, { ttlDays: CACHE_TTL_DAYS, allowWorldFallback: false });
  let cacheHits = 0, missing = 0;
  const needFetch = new Map<string, { itemType: StoreItemCode; itemNo: string; colourId: number; conditions: ItemCondition[] }>();
  for (const [ik, t] of itemTuples) {
    const view = views.get(pgKey(t.itemType, t.itemNo, t.colourId));
    if (view && view.coverage === 'uk') {
      for (const cond of t.conditions) {
        const key = `${ik}:${cond}`;
        applyStockSide(key, cond === 'N' ? view.new : view.used);
        if (stockGuide.get(key)!.minPrice == null) missing++;
      }
      cacheHits++;
    } else {
      needFetch.set(ik, t);
    }
  }
  console.log(`Cache: ${cacheHits}/${itemTuples.size} items served from unified price cache; fetching ${needFetch.size} via BL API.`);

  // Uncached → ensurePriceGuide (4 calls per item, all quadrants, captured automatically).
  let calls = 0, fetched = 0;
  for (const [ik, t] of needFetch) {
    if (calls + 4 > API_BUDGET) { console.warn(`API budget reached`); break; }
    try {
      await sleep(API_DELAY_MS);
      const view = await ensurePriceGuide(bl, supabase, { itemType: t.itemType, itemNo: t.itemNo, colourId: t.colourId }, { ttlDays: CACHE_TTL_DAYS });
      calls += 4;
      fetched++;
      for (const cond of t.conditions) {
        const key = `${ik}:${cond}`;
        applyStockSide(key, cond === 'N' ? view.new : view.used);
        if (stockGuide.get(key)!.minPrice == null) missing++;
      }
      if (fetched % 100 === 0) console.log(`  fetched ${fetched}/${needFetch.size} (${missing} no UK stock)`);
    } catch (err) {
      console.warn(`  fetch error ${ik}: ${(err as Error).message}`);
    }
  }
  console.log(`Fetched ${fetched} tuples (${missing} condition-tuples had no UK stock at all).`);

  // Score each lot
  type Scored = ScrapedItem & {
    minPrice: number | null;
    qtyAvgPrice: number | null;
    sellers: number;
    askLot: number;
    minLot: number;        // qty × min (or undercut)
    qtyAvgLot: number;     // qty × qty-weighted avg of UK stock (more honest "match the market")
    bucket: 'no-uk-stock' | 'we-undercut' | 'we-match' | 'we-overprice';
  };
  const scored: Scored[] = items.map((it) => {
    const cond: ItemCondition = it.invNew === 'New' ? 'N' : 'U';
    const key = `${it.itemType}:${it.itemNo}:${it.colourId}:${cond}`;
    const g = stockGuide.get(key);
    const askLot = it.unitPriceGBP * it.invQty;
    if (!g || g.minPrice == null) {
      return { ...it, minPrice: null, qtyAvgPrice: g?.qtyAvgPrice ?? null, sellers: g?.sellers ?? 0, askLot, minLot: 0, qtyAvgLot: 0, bucket: 'no-uk-stock' };
    }
    const target = g.minPrice * (1 - UNDERCUT_PCT);
    const minLot = target * it.invQty;
    const qtyAvgLot = (g.qtyAvgPrice ?? g.minPrice) * it.invQty;
    let bucket: Scored['bucket'];
    if (it.unitPriceGBP < g.minPrice * 0.95) bucket = 'we-undercut';
    else if (it.unitPriceGBP <= g.minPrice * 1.05) bucket = 'we-match';
    else bucket = 'we-overprice';
    return { ...it, minPrice: g.minPrice, qtyAvgPrice: g.qtyAvgPrice, sellers: g.sellers, askLot, minLot, qtyAvgLot, bucket };
  });

  // Aggregate
  const askTotal = scored.reduce((a, s) => a + s.askLot, 0);
  const minTotal = scored.reduce((a, s) => a + s.minLot, 0);
  const qtyAvgTotal = scored.reduce((a, s) => a + s.qtyAvgLot, 0);
  const noStockLots = scored.filter((s) => s.bucket === 'no-uk-stock');
  const noStockListAtAsk = noStockLots.reduce((a, s) => a + s.askLot, 0);

  // Bucket distribution
  const buckets: Scored['bucket'][] = ['we-undercut', 'we-match', 'we-overprice', 'no-uk-stock'];
  const histo: Record<string, { lots: number; pieces: number; ask: number; min: number }> = {};
  for (const b of buckets) histo[b] = { lots: 0, pieces: 0, ask: 0, min: 0 };
  for (const s of scored) {
    const h = histo[s.bucket];
    h.lots++; h.pieces += s.invQty; h.ask += s.askLot; h.min += s.minLot;
  }

  // Per-lot ratios for distribution
  const ratios = scored.filter((s) => s.minPrice != null).map((s) => s.unitPriceGBP / s.minPrice!);
  const sellersDist = scored.filter((s) => s.sellers > 0).map((s) => s.sellers);

  // Top 20 by per-lot value at min
  const top20 = [...scored].filter((s) => s.minLot > 0).sort((a, b) => b.minLot - a.minLot).slice(0, 20);

  // Lots where seller is significantly under UK min — interesting!
  const undercut = scored.filter((s) => s.bucket === 'we-undercut').sort((a, b) => (a.unitPriceGBP / (a.minPrice ?? 1)) - (b.unitPriceGBP / (b.minPrice ?? 1)));

  // --- Report ---
  const m = (n: number) => `£${n.toFixed(2)}`;
  const pad = (s: string, w: number) => s.padEnd(w).slice(0, w);
  const padL = (s: string | number, w: number) => String(s).padStart(w);

  console.log(`\n========================================================================`);
  console.log(`  ${SLUG}  -  Reprice at UK lowest New  (${new Date().toISOString().slice(0, 10)})`);
  console.log(`========================================================================`);
  console.log(`  Lots: ${items.length}    Pieces: ${items.reduce((a, i) => a + i.invQty, 0)}`);
  console.log(`  Seller's current ask total:        ${m(askTotal)}`);
  if (bricqerListTotal != null) console.log(`  Bricqer list total (from analysis): ${m(bricqerListTotal)}`);
  console.log(`  Inventory @ UK min New price:       ${m(minTotal)}${UNDERCUT_PCT > 0 ? `   (after ${(UNDERCUT_PCT * 100).toFixed(1)}% undercut)` : ''}`);
  console.log(`  Inventory @ UK qty-weighted avg:    ${m(qtyAvgTotal)}   (more realistic — won't all clear at min)`);
  console.log(``);
  console.log(`  Coverage:`);
  console.log(`    Lots with UK New stock:   ${ratios.length}  (${(ratios.length / items.length * 100).toFixed(0)}%)`);
  console.log(`    Lots with no UK New stock: ${noStockLots.length}  (${m(noStockListAtAsk)} at ask — unbenchmarked)`);
  console.log(`    Median ratio (ask/min):    ${median(ratios).toFixed(2)}`);
  console.log(`    Mean ratio (ask/min):      ${mean(ratios).toFixed(2)}`);
  console.log(`    Median # of UK New sellers per lot: ${median(sellersDist).toFixed(0)}`);
  console.log(``);
  console.log(`  Where is seller currently positioned?`);
  console.log(`    ${pad('Bucket', 16)} ${padL('Lots', 5)} ${padL('Pieces', 8)} ${padL('Ask £', 10)} ${padL('Min £', 10)}`);
  for (const b of buckets) {
    const h = histo[b];
    if (h.lots === 0) continue;
    console.log(`    ${pad(b, 16)} ${padL(h.lots, 5)} ${padL(h.pieces, 8)} ${padL(m(h.ask), 10)} ${padL(m(h.min), 10)}`);
  }
  console.log(``);
  console.log(`  Top 20 lots by value @ UK min:`);
  console.log(`    #  T  Item            ${pad('Name', 28)} ${pad('Colour', 16)}  Qty   #Sellers  ${pad('UK min', 7)}  ${pad('@min lot', 9)}  ${pad('Cur ask', 7)}  ${pad('Ask lot', 9)}  Ratio`);
  top20.forEach((s, i) => {
    const ratio = s.unitPriceGBP / (s.minPrice ?? 1);
    console.log(`    ${padL(i + 1, 2)} ${s.itemType}  ${pad(s.itemNo, 14)}  ${pad(s.itemName, 28)} ${pad(s.colourName ?? '-', 16)}  ${padL(s.invQty, 4)}  ${padL(s.sellers, 8)}  ${padL(m(s.minPrice ?? 0), 7)}  ${padL(m(s.minLot), 9)}  ${padL(m(s.unitPriceGBP), 7)}  ${padL(m(s.askLot), 9)}  ${ratio.toFixed(2)}×`);
  });

  console.log(``);
  console.log(`  Top 15 lots where seller is FAR BELOW UK min (cheap-buys for us):`);
  console.log(`    #  T  Item            ${pad('Name', 28)} ${pad('Colour', 16)}  Qty   ${pad('UK min', 7)}  ${pad('Cur ask', 7)}  Ratio   ${pad('Ask lot', 9)}`);
  undercut.slice(0, 15).forEach((s, i) => {
    const ratio = s.unitPriceGBP / (s.minPrice ?? 1);
    console.log(`    ${padL(i + 1, 2)} ${s.itemType}  ${pad(s.itemNo, 14)}  ${pad(s.itemName, 28)} ${pad(s.colourName ?? '-', 16)}  ${padL(s.invQty, 4)}  ${padL(m(s.minPrice ?? 0), 7)}  ${padL(m(s.unitPriceGBP), 7)}  ${ratio.toFixed(2)}×  ${padL(m(s.askLot), 9)}`);
  });

  // Persist
  const outFile = path.join(OUT_DIR, `reprice-uk-min-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(outFile, JSON.stringify({
    slug: SLUG,
    items: items.length,
    pieces: items.reduce((a, i) => a + i.invQty, 0),
    askTotal, bricqerListTotal, minTotal, qtyAvgTotal,
    noStockLots: noStockLots.length, noStockListAtAsk,
    medianRatioAskMin: median(ratios), meanRatioAskMin: mean(ratios),
    histo,
    top20: top20.map((s) => ({ type: s.itemType, no: s.itemNo, colour: s.colourName, qty: s.invQty, sellers: s.sellers, minPrice: s.minPrice, minLot: s.minLot, askLot: s.askLot })),
  }, null, 2));
  console.log(`\nSaved to ${outFile}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
