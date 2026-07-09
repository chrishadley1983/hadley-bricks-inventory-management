/**
 * Ninjago arbitrage scanner (Phase 1 proof-of-concept).
 *
 * Pulls every Ninjago set from brickset_sets, enumerates the unique
 * (part, colour) universe via the BrickLink subsets API, then scans
 * the top N most-frequent parts for UK sold + stock price guides via
 * ensurePriceGuide (unified price cache — 4 API calls per item, both
 * conditions captured). Scores each lot for arbitrage (UK min ask vs
 * UK 6-month sold average) and emits an HTML report ranked by margin.
 *
 * Usage (from apps/web):
 *   npx tsx scripts/scan-ninjago-arbitrage.ts
 *   npx tsx scripts/scan-ninjago-arbitrage.ts --max-parts=200 --theme=ninjago
 *
 * Resumable: intermediate state cached under <repo>/tmp/ninjago-arbitrage/.
 * Re-running reuses the set list, part universe, and any parts already scanned.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { BrickLinkClient, BrickLinkApiError, RateLimitError } from '../src/lib/bricklink/client';
import type { BrickLinkSubsetEntry } from '../src/lib/bricklink/types';
import { ensurePriceGuide } from '../src/lib/bricklink/price-guide/capture';
import type { PriceGuideView } from '../src/lib/bricklink/price-guide/read';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2).reduce<Record<string, string>>((acc, a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  acc[k] = v ?? 'true';
  return acc;
}, {});

const THEME_PATTERN = argv.theme ?? 'ninjago';
/** Minifigs to scan (highest-value-per-unit items — always scan some). */
const MAX_FIGS = parseInt(argv['max-figs'] ?? '200', 10);
/** Parts to scan (less glamorous but numerous — ignored if only figs wanted). */
const MAX_PARTS = parseInt(argv['max-parts'] ?? '300', 10);
const API_DELAY_MS = parseInt(argv['api-delay-ms'] ?? '250', 10);
const DAILY_BUDGET = parseInt(argv['daily-budget'] ?? '4500', 10);
const MIN_TIMES_SOLD = parseInt(argv['min-times-sold'] ?? '10', 10);
/** Parts that appear in more than this many Ninjago sets are commodities (2x2 plates etc.) */
const COMMODITY_FREQ_CAP = parseInt(argv['commodity-freq-cap'] ?? '15', 10);
/** Minimum frequency for parts — skip freq=1 one-offs when hunting repeatable signal. */
const PARTS_MIN_FREQ = parseInt(argv['parts-min-freq'] ?? '1', 10);
/** Optional regex to filter parts by name — e.g. 'ninjago|katana|dragon' to hit theme-specific elements. */
const PARTS_KEYWORD = argv['parts-keyword'] ?? '';
const MAX_DISCOUNT = parseFloat(argv['max-discount'] ?? '0.80'); // best ask must be < this × weighted avg sold
/** Minimum per-unit profit (£) — avoids surfacing penny-margin items where handling labour > reward. */
const MIN_UNIT_PROFIT = parseFloat(argv['min-unit-profit'] ?? '0.20');
/** UK-only is the default — at our scale intl shipping kills the margin. */
const UK_ONLY = (argv['uk-only'] ?? 'true') !== 'false';
/** Unified price-cache freshness — items with a fresh UK row cost 0 API calls. */
const CACHE_TTL_DAYS = 90;

const TMP_DIR = path.resolve(__dirname, '../../../tmp/ninjago-arbitrage');
const REPORT_PATH = path.join(TMP_DIR, 'report.html');

// Fee + cost assumptions. On BL you buy a basket from one seller; shipping is
// per-order not per-item, so we model it as a % uplift on the ask price rather
// than a flat £ per unit. These numbers assume an average basket of 5-10 items.
const BL_SELLER_FEE_RATE = 0.07; // on the sell side: 3% BL fee + ~4% payment processing
const LANDED_COST_UPLIFT_UK = 1.15; // ~15% over ask: £2-3 UK shipping share over ~£15 basket
const LANDED_COST_UPLIFT_INTL = 1.40; // ~40% over ask: £8-15 intl shipping over ~£20 basket — brutal

// ---------------------------------------------------------------------------
// Env / clients
// ---------------------------------------------------------------------------

const creds = {
  consumerKey: process.env.BRICKLINK_CONSUMER_KEY ?? '',
  consumerSecret: process.env.BRICKLINK_CONSUMER_SECRET ?? '',
  tokenValue: process.env.BRICKLINK_TOKEN_VALUE ?? '',
  tokenSecret: process.env.BRICKLINK_TOKEN_SECRET ?? '',
};

for (const [k, v] of Object.entries(creds)) {
  if (!v) {
    console.error(`Missing BRICKLINK_${k.replace(/([A-Z])/g, '_$1').toUpperCase()} in env`);
    process.exit(1);
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase env vars');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const bl = new BrickLinkClient(creds, { supabase, caller: 'scan-ninjago-arbitrage-script' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PartUniverseEntry {
  partNumber: string;
  colourId: number;
  colourName: string;
  partName: string;
  partType: 'PART' | 'MINIFIG';
  frequency: number; // # of distinct Ninjago sets this (part, colour) appears in
  totalQuantity: number; // cumulative qty across all occurrences
}

interface ScanResult {
  partNumber: string;
  colourId: number;
  colourName: string;
  partName: string;
  partType: string;
  frequency: number;

  // Sold (last 6 months)
  soldAvgPrice: number | null;
  soldQtyAvgPrice: number | null; // qty-weighted average
  soldMinPrice: number | null;
  soldMaxPrice: number | null;
  timesSold: number | null;
  totalQtySold: number | null;

  // Current stock (global view, filtered to "ships to us")
  stockMinPrice: number | null;
  stockAvgPrice: number | null;
  stockQtyAvgPrice: number | null;
  stockTotalLots: number | null;
  stockTotalQty: number | null;

  // Best single lot among sellers that ship to us (shipping_available=true)
  minAskPrice: number | null;
  minAskQty: number | null;

  // Best UK-seller lot (from country_code=UK query)
  ukAskMinPrice: number | null;
  ukAskQtyAtMin: number | null;
  ukTotalLots: number | null;

  scannedAt: string;
}

interface ScoredOpportunity extends ScanResult {
  benchmark: number;
  bestAsk: number;
  bestAskIsUK: boolean;
  lotQty: number;
  landedCostPerUnit: number;
  profitPerUnit: number;
  lotProfit: number;
  discountPct: number;
  marginPct: number;
  liquidityScore: number;
  opportunityScore: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function readJson<T>(p: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(p: string, data: unknown) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Step 1: set list
// ---------------------------------------------------------------------------

async function getSetList(): Promise<string[]> {
  const cacheFile = path.join(TMP_DIR, 'sets.json');
  const cached = readJson<string[] | null>(cacheFile, null);
  if (cached && cached.length) {
    console.log(`[sets] Reusing cached list: ${cached.length} sets`);
    return cached;
  }

  console.log(`[sets] Querying brickset_sets WHERE theme ILIKE '%${THEME_PATTERN}%' ...`);
  const all: string[] = [];
  let page = 0;
  const PAGE_SIZE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('brickset_sets')
      .select('set_number, year_from, theme')
      .ilike('theme', `%${THEME_PATTERN}%`)
      .order('year_from', { ascending: false, nullsFirst: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) throw new Error(`sets query failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      if (row.set_number) all.push(row.set_number);
    }
    if (data.length < PAGE_SIZE) break;
    page++;
  }

  const unique = Array.from(new Set(all));
  writeJson(cacheFile, unique);
  console.log(`[sets] Cached ${unique.length} sets (theme LIKE %${THEME_PATTERN}%)`);
  return unique;
}

// ---------------------------------------------------------------------------
// Step 2: part universe
// ---------------------------------------------------------------------------

async function getPartUniverse(sets: string[]): Promise<PartUniverseEntry[]> {
  const cacheFile = path.join(TMP_DIR, 'parts.json');
  const cached = readJson<PartUniverseEntry[] | null>(cacheFile, null);
  if (cached && cached.length) {
    console.log(`[parts] Reusing cached universe: ${cached.length} parts`);
    return cached;
  }

  const rawFile = path.join(TMP_DIR, 'subsets-raw.json');
  const progressFile = path.join(TMP_DIR, 'subsets-progress.json');
  const rawData = readJson<Record<string, BrickLinkSubsetEntry[]>>(rawFile, {});
  const progress = readJson<{ done: string[] }>(progressFile, { done: [] });
  const doneSet = new Set(progress.done);

  console.log(
    `[parts] Fetching subsets for ${sets.length} sets (${doneSet.size} cached from prior run)...`,
  );

  let calls = 0;
  for (const setNo of sets) {
    if (doneSet.has(setNo)) continue;
    try {
      await sleep(API_DELAY_MS);
      const entries = await bl.getSubsets('SET', setNo);
      rawData[setNo] = entries;
      progress.done.push(setNo);
      calls++;

      if (calls % 25 === 0) {
        writeJson(rawFile, rawData);
        writeJson(progressFile, progress);
        console.log(`[parts] Progress: ${progress.done.length}/${sets.length}`);
      }
    } catch (err) {
      if (err instanceof BrickLinkApiError && err.code === 404) {
        console.log(`[parts] Set ${setNo} not in BL catalog — skipping`);
        progress.done.push(setNo);
        continue;
      }
      if (err instanceof BrickLinkApiError && err.code === 429) {
        console.error('[parts] Rate limit hit — saving progress and aborting.');
        writeJson(rawFile, rawData);
        writeJson(progressFile, progress);
        throw err;
      }
      console.error(`[parts] Failed ${setNo}:`, (err as Error).message);
      progress.done.push(setNo);
    }
  }
  writeJson(rawFile, rawData);
  writeJson(progressFile, progress);

  // Dedupe + count
  const key = (p: string, c: number) => `${p}::${c}`;
  const map = new Map<string, PartUniverseEntry>();
  for (const [, entries] of Object.entries(rawData)) {
    const seenInSet = new Set<string>();
    for (const entry of entries) {
      for (const item of entry.entries) {
        if (item.is_alternate || item.is_counterpart) continue;
        if (item.item.type !== 'PART' && item.item.type !== 'MINIFIG') continue;
        const k = key(item.item.no, item.color_id);
        const existing = map.get(k);
        if (!existing) {
          map.set(k, {
            partNumber: item.item.no,
            colourId: item.color_id,
            colourName: item.color_name ?? '',
            partName: item.item.name,
            partType: item.item.type as 'PART' | 'MINIFIG',
            frequency: 1,
            totalQuantity: item.quantity,
          });
          seenInSet.add(k);
        } else {
          if (!seenInSet.has(k)) {
            existing.frequency += 1;
            seenInSet.add(k);
          }
          existing.totalQuantity += item.quantity;
        }
      }
    }
  }

  const universe = [...map.values()].sort((a, b) => b.frequency - a.frequency);
  writeJson(cacheFile, universe);

  const parts = universe.filter((p) => p.partType === 'PART').length;
  const figs = universe.filter((p) => p.partType === 'MINIFIG').length;
  console.log(`[parts] Universe: ${universe.length} total (${parts} parts, ${figs} minifigs)`);
  console.log(`[parts] Top 5 most frequent: ${universe.slice(0, 5).map((p) => `${p.partNumber}(${p.frequency})`).join(', ')}`);
  return universe;
}

// ---------------------------------------------------------------------------
// Step 3: scan
// ---------------------------------------------------------------------------

async function scanOpportunities(universe: PartUniverseEntry[]): Promise<ScanResult[]> {
  const resultsFile = path.join(TMP_DIR, 'scan-results.json');
  const progressFile = path.join(TMP_DIR, 'scan-progress.json');
  const results = readJson<ScanResult[]>(resultsFile, []);
  const progress = readJson<{ done: string[]; callsUsed: number }>(progressFile, {
    done: [],
    callsUsed: 0,
  });
  const doneSet = new Set(progress.done);

  // Reserve an explicit budget for minifigs AND parts so one category doesn't
  // crowd the other out. Commodity-cap + min-freq + optional keyword filter
  // narrow parts to theme-specific decorated/accessory elements.
  const keywordRe = PARTS_KEYWORD ? new RegExp(PARTS_KEYWORD, 'i') : null;
  const figs = universe.filter((p) => p.partType === 'MINIFIG').slice(0, MAX_FIGS);
  const parts = universe
    .filter((p) => p.partType === 'PART')
    .filter((p) => p.frequency >= PARTS_MIN_FREQ && p.frequency <= COMMODITY_FREQ_CAP)
    .filter((p) => !keywordRe || keywordRe.test(p.partName))
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, MAX_PARTS);
  const targets = [...figs, ...parts];

  console.log(
    `[scan] Target: ${targets.length} items (${figs.length} minifigs, ${parts.length} parts); ${doneSet.size} already scanned; budget used: ${progress.callsUsed}/${DAILY_BUDGET}`,
  );
  console.log(
    `[scan] Filters: parts-freq=${PARTS_MIN_FREQ}-${COMMODITY_FREQ_CAP}${PARTS_KEYWORD ? ` keyword=/${PARTS_KEYWORD}/i` : ''}, min-times-sold=${MIN_TIMES_SOLD}, max-discount=${MAX_DISCOUNT}, uk-only=${UK_ONLY}`,
  );

  const saveProgress = () => {
    writeJson(resultsFile, results);
    writeJson(progressFile, progress);
  };

  let scannedThisRun = 0;
  for (const p of targets) {
    const k = `${p.partNumber}::${p.colourId}`;
    if (doneSet.has(k)) continue;

    if (progress.callsUsed + 4 > DAILY_BUDGET) {
      console.warn(
        `[scan] Daily budget reached (${progress.callsUsed}/${DAILY_BUDGET}). Resume later to continue.`,
      );
      break;
    }

    try {
      await sleep(API_DELAY_MS);
      // One ensurePriceGuide call = all four UK quadrants (sold/stock × N/U),
      // 4 API calls, captured into the unified price cache automatically.
      const view = await ensurePriceGuide(
        bl,
        supabase,
        { itemType: p.partType === 'MINIFIG' ? 'M' : 'P', itemNo: p.partNumber, colourId: p.colourId },
        { ttlDays: CACHE_TTL_DAYS },
      );
      progress.callsUsed += 4;

      results.push(summarise(p, view));
      progress.done.push(k);
      scannedThisRun++;
    } catch (err) {
      if (err instanceof RateLimitError || (err instanceof BrickLinkApiError && err.code === 429)) {
        console.error('[scan] Rate limit hit — saving progress and aborting.');
        saveProgress();
        break;
      }
      console.error(
        `[scan] Failed ${p.partNumber} c${p.colourId}:`,
        err instanceof Error ? err.message : err,
      );
      progress.done.push(k); // don't infinite-retry broken items
    }

    if (scannedThisRun > 0 && scannedThisRun % 20 === 0) {
      saveProgress();
      console.log(
        `[scan] ${progress.done.length}/${targets.length} (${progress.callsUsed} calls used)`,
      );
    }
  }

  saveProgress();
  console.log(`[scan] Done. ${results.length} parts in result set.`);
  return results;
}

function summarise(p: PartUniverseEntry, view: PriceGuideView): ScanResult {
  // Used-condition UK view from the unified price cache. Scope note: every figure
  // below is UK-only (UK 6-month sold, UK current stock). The legacy scan mixed a
  // worldwide sold benchmark + worldwide stock detail with a UK stock query; UK-only
  // is our operating rule, so the whole row is now UK-scoped.
  const u = view.used;
  return {
    partNumber: p.partNumber,
    colourId: p.colourId,
    colourName: p.colourName,
    partName: p.partName,
    partType: p.partType,
    frequency: p.frequency,

    soldAvgPrice: u.soldAvg,
    soldQtyAvgPrice: u.soldQtyAvg,
    soldMinPrice: null, // sold min/max not exposed by the unified view
    soldMaxPrice: null,
    timesSold: u.soldLots, // sold lots — matches legacy unit_quantity
    totalQtySold: u.soldQty,

    stockMinPrice: u.stockMin, // UK (legacy was worldwide ships-to-us)
    stockAvgPrice: null, // plain lot-average asking price not exposed
    stockQtyAvgPrice: u.stockAvg, // qty-weighted asking average
    stockTotalLots: u.stockLots,
    stockTotalQty: u.stockQty,

    minAskPrice: u.stockMin, // UK min ask (legacy: global ships-to-us min)
    minAskQty: null, // per-lot detail not exposed by the unified view

    ukAskMinPrice: u.stockMin,
    ukAskQtyAtMin: null, // per-lot detail not exposed → scoring lotQty defaults to 1
    ukTotalLots: u.stockLots,

    scannedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Step 4: score + report
// ---------------------------------------------------------------------------

function scoreAll(results: ScanResult[]): ScoredOpportunity[] {
  const scored: ScoredOpportunity[] = [];

  for (const r of results) {
    if (r.soldQtyAvgPrice == null || r.soldQtyAvgPrice <= 0) continue;
    if (r.minAskPrice == null) continue;
    if ((r.timesSold ?? 0) < MIN_TIMES_SOLD) continue;

    // Use qty-weighted sold average — less skewed by tiny / inflated lots.
    const benchmark = r.soldQtyAvgPrice;

    // UK-only is the default — intl shipping kills margin at our scale.
    // Override with --uk-only=false to see intl opportunities too (flagged 40% uplift).
    const globalAsk = r.minAskPrice;
    const ukAsk = r.ukAskMinPrice;
    if (UK_ONLY && ukAsk === null) continue;

    const useUK = ukAsk !== null && (UK_ONLY || ukAsk <= globalAsk * 1.15);

    const bestAsk = useUK ? ukAsk! : globalAsk;
    const lotQty = useUK ? (r.ukAskQtyAtMin ?? 1) : (r.minAskQty ?? 1);
    const uplift = useUK ? LANDED_COST_UPLIFT_UK : LANDED_COST_UPLIFT_INTL;

    // Gate: best ask must be a meaningful discount to the sold benchmark.
    if (bestAsk >= benchmark * MAX_DISCOUNT) continue;

    const landedCostPerUnit = bestAsk * uplift;
    const revenuePerUnit = benchmark * (1 - BL_SELLER_FEE_RATE);
    const profitPerUnit = revenuePerUnit - landedCostPerUnit;
    if (profitPerUnit < MIN_UNIT_PROFIT) continue;

    const lotProfit = profitPerUnit * lotQty;
    const discountPct = ((benchmark - bestAsk) / benchmark) * 100;
    const marginPct = (profitPerUnit / landedCostPerUnit) * 100;

    // Liquidity weight: log-scale times sold (saturates — a part sold 200× isn't
    // 10× better than one sold 20×, it just means the signal is reliable).
    const liquidityScore = Math.log10(Math.max(1, r.timesSold ?? 1)) / 2;
    // Rank by % gain (margin on capital), weighted by liquidity confidence.
    // The min-unit-profit gate already excludes penny-margin items where high %
    // is misleading, so margin-% sorting surfaces the strongest sellers first.
    const opportunityScore = marginPct * liquidityScore * (useUK ? 1.1 : 1);

    scored.push({
      ...r,
      benchmark,
      bestAsk,
      bestAskIsUK: useUK,
      lotQty,
      landedCostPerUnit,
      profitPerUnit,
      lotProfit,
      discountPct,
      marginPct,
      liquidityScore,
      opportunityScore,
    });
  }

  scored.sort((a, b) => b.opportunityScore - a.opportunityScore);
  return scored;
}

function renderHtml(scored: ScoredOpportunity[], totals: { scanned: number }): string {
  const rows = scored
    .map((o, i) => {
      const blUrl = `https://www.bricklink.com/v2/catalog/catalogitem.page?P=${encodeURIComponent(o.partNumber)}&idColor=${o.colourId}#T=S&C=${o.colourId}`;
      const flag = o.bestAskIsUK ? '🇬🇧 UK' : '🌍 Intl';
      const typeBadge = o.partType === 'MINIFIG' ? '<span class="badge-fig">FIG</span>' : '';
      const colourSpan = o.colourName ? `<span class="colour">${escapeHtml(o.colourName)}</span>` : '';
      return `
        <tr>
          <td class="rank">${i + 1}</td>
          <td>
            <div class="part">${typeBadge}<a href="${blUrl}" target="_blank">${o.partNumber}</a>${colourSpan}</div>
            <div class="name">${escapeHtml(o.partName)}</div>
          </td>
          <td class="num">£${o.benchmark.toFixed(2)}</td>
          <td class="num emphasis">£${o.bestAsk.toFixed(2)}</td>
          <td class="num">${o.discountPct.toFixed(0)}%</td>
          <td class="num">£${o.profitPerUnit.toFixed(2)}</td>
          <td class="num">${o.marginPct.toFixed(0)}%</td>
          <td class="num">${o.lotQty}</td>
          <td class="num bold">£${o.lotProfit.toFixed(2)}</td>
          <td class="num">${o.timesSold ?? 0}</td>
          <td>${flag}</td>
          <td class="num">${o.frequency}</td>
        </tr>`;
    })
    .join('\n');

  const totalLotProfit = scored.reduce((s, o) => s + o.lotProfit, 0);
  const topTenProfit = scored.slice(0, 10).reduce((s, o) => s + o.lotProfit, 0);
  const ukCount = scored.filter((o) => o.bestAskIsUK).length;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<title>Ninjago Arbitrage — ${new Date().toLocaleString('en-GB')}</title>
<style>
 :root { color-scheme: dark; }
 body { font-family: -apple-system, "Segoe UI", system-ui, sans-serif; margin: 24px; background:#0f1115; color:#e7e9ee; }
 h1 { margin: 0 0 4px; font-size: 24px; }
 .sub { color:#9aa3b2; margin-bottom: 20px; font-size: 13px; }
 table { width: 100%; border-collapse: collapse; font-size: 13px; }
 th { text-align: left; background:#1a1f2b; color:#9aa3b2; padding:10px 8px; position: sticky; top:0; font-weight: 500; }
 td { padding:10px 8px; border-bottom:1px solid #1a1f2b; vertical-align: top; }
 tr:hover td { background: #141823; }
 .rank { color:#556; width: 32px; }
 .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
 .emphasis { color:#4ade80; font-weight: 600; }
 .bold { font-weight: 600; color:#fbbf24; }
 .part { font-weight: 600; }
 .part a { color:#60a5fa; text-decoration: none; }
 .part a:hover { text-decoration: underline; }
 .colour { color:#9aa3b2; font-weight: 400; margin-left: 6px; }
 .name { color: #7a8394; font-size: 12px; max-width: 420px; }
 .badge-fig { display: inline-block; background: #6d28d9; color: #fff; font-size: 10px; font-weight: 600; padding: 1px 5px; border-radius: 3px; margin-right: 6px; vertical-align: middle; }
 .summary { display:flex; gap:12px; margin-bottom: 20px; flex-wrap: wrap; }
 .stat { background:#1a1f2b; padding:12px 16px; border-radius:8px; min-width: 140px; }
 .stat .val { font-size: 22px; font-weight: 600; color: #4ade80; }
 .stat .lbl { color: #9aa3b2; font-size: 12px; }
 .legend { color:#6b7280; font-size:11px; margin-top: 24px; line-height: 1.6; }
</style>
</head><body>
<h1>Ninjago arbitrage — Phase 1 scan</h1>
<div class="sub">Used condition • ${totals.scanned} parts scanned • ranked by lot profit × liquidity</div>

<div class="summary">
  <div class="stat"><div class="val">${scored.length}</div><div class="lbl">opportunities</div></div>
  <div class="stat"><div class="val">£${totalLotProfit.toFixed(0)}</div><div class="lbl">total lot profit</div></div>
  <div class="stat"><div class="val">£${topTenProfit.toFixed(0)}</div><div class="lbl">top-10 profit</div></div>
  <div class="stat"><div class="val">${ukCount}</div><div class="lbl">UK sellers</div></div>
</div>

<table>
<thead><tr>
  <th>#</th><th>Part</th>
  <th class="num">Avg sold</th>
  <th class="num">Best ask</th>
  <th class="num">Disc.</th>
  <th class="num">£/unit</th>
  <th class="num">Margin</th>
  <th class="num">Qty</th>
  <th class="num">Lot £</th>
  <th class="num">Sold 6mo</th>
  <th>Seller</th>
  <th class="num">Set freq</th>
</tr></thead>
<tbody>
${rows}
</tbody>
</table>

<div class="legend">
  <b>Methodology.</b> "Avg sold" = qty-weighted UK 6-month sold average (used, GBP, unified price cache). "Best ask" = lowest
  current UK-seller price${UK_ONLY ? ' (UK-only mode)' : ''}. Landed cost = ask ×
  ${(LANDED_COST_UPLIFT_UK).toFixed(2)} (UK) or ${(LANDED_COST_UPLIFT_INTL).toFixed(2)} (intl) —
  assumes basket-shared shipping. Revenue per unit = avg_sold ×
  (1 − ${(BL_SELLER_FEE_RATE * 100).toFixed(0)}% BL/payment fee).
  Gates: times sold ≥ ${MIN_TIMES_SOLD}, ask &lt; ${(MAX_DISCOUNT * 100).toFixed(0)}% of avg sold,
  per-unit profit ≥ £${MIN_UNIT_PROFIT.toFixed(2)}${UK_ONLY ? ', UK seller required' : ''}.
  Opportunity score = lot profit × log₁₀(times sold) / 2, with a 1.1× bonus for UK-seller lots.
</div>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  ensureDir(TMP_DIR);
  console.log(`[main] Ninjago arbitrage scanner — tmp: ${TMP_DIR}`);
  console.log(`[main] Config: theme=${THEME_PATTERN} max-parts=${MAX_PARTS} delay=${API_DELAY_MS}ms budget=${DAILY_BUDGET}`);

  const sets = await getSetList();
  const universe = await getPartUniverse(sets);
  const scanResults = await scanOpportunities(universe);
  const scored = scoreAll(scanResults);

  fs.writeFileSync(REPORT_PATH, renderHtml(scored, { scanned: scanResults.length }));

  console.log('');
  console.log(`[done] ${scored.length} opportunities passed gates`);
  console.log(`[done] Top 5:`);
  for (const [i, o] of scored.slice(0, 5).entries()) {
    console.log(
      `  ${i + 1}. ${o.partNumber} ${o.colourName}: ask £${o.bestAsk.toFixed(2)} vs sold £${o.benchmark.toFixed(2)} — lot £${o.lotProfit.toFixed(2)} (${o.lotQty} @ £${o.profitPerUnit.toFixed(2)})`,
    );
  }
  console.log(`[done] Report: ${REPORT_PATH}`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
