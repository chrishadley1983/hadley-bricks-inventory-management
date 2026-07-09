/**
 * Set part-out intelligence CLI (spec: docs/features/pg-market-intelligence/spec.md
 * §3 F4, §5.2). Promotion of the 2026-07-07 POC (`_str-check-set-pg.ts`) to the
 * "L1-first with L3 upgrade of top-value lots only" design the spec calls for,
 * instead of the POC's "scrape every miss" approach.
 *
 * Flow per set:
 *   1. One BL API `/subsets` call (createScriptBlContext) -> dedupe (item,colour) lots.
 *   2. Join ALL lots against L1 (`bricklink_pg_summary_cache`, paginated .in() chunks) —
 *      fx-converts non-GBP rows using the row's stamped `fx_rate`; rows with no_data=true
 *      or non-GBP with no fx_rate are treated as "no benchmark" and flagged, never guessed.
 *   3. Rank lots by L1 qty x value, descending.
 *   4. For the TOP `--top-l3` lots only, upgrade via L3 (`bricklink_price_guide_cache`,
 *      45-day window per spec §2.1) — misses get a live catalogPG scrape (PgScraper) unless
 *      `--no-cdp` or CDP is unreachable, in which case the run degrades gracefully to L1 for
 *      those lots and says so explicitly. This bounds scrape cost to a handful of pages per
 *      set instead of the POC's "scrape every cache miss in the whole set".
 *   5. Score, report, and (optionally) render a buy/skip verdict against --price.
 *
 * Usage (from apps/web):
 *   npx tsx scripts/pg/pg-set-check.ts --set=75981
 *   npx tsx scripts/pg/pg-set-check.ts --set=75981 --set=42140 --cond=U --top-l3=30
 *   npx tsx scripts/pg/pg-set-check.ts --set=75981 --no-cdp          # pure L1/cache mode
 *   npx tsx scripts/pg/pg-set-check.ts --set=75981 --price=45.00     # buy/skip verdict
 *
 * Flags:
 *   --set=<no>           Repeatable. Bare or "-N" suffixed BL set number.
 *   --cond=N|U            Condition to score (default N).
 *   --top-l3=<n>           How many top-value lots get an L3 upgrade attempt (default 20).
 *   --cdp-port=<n>          CDP port for the L3 scrape lane (default 9222).
 *   --no-cdp                Pure L1 mode: never attempt a scrape, even if CDP is reachable.
 *   --price=<gbp>            Optional: render a buy/skip verdict at this price.
 *   --report-file=<path>      Optional: also write the report as markdown to this path.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

import { createScriptBlContext } from '../_bl-client';
import {
  PgScraper,
  PgBlockError,
  PgCaptchaError,
  PgLoginError,
  PgCurrencyError,
  PgNoDataError,
  PgNotFoundError,
  isPgCdpReachable,
  type PgItemRef,
  type PgItemType,
} from '../../src/lib/bricklink/price-guide-page';
import { PriceGuideCacheService, pgCacheKey, toPgCacheRow, type PgCacheRow } from '../../src/lib/bricklink/price-guide-cache.service';
import { liquidityAdjustedPov, type PovLot } from '../../src/lib/bricklink/liquidity-pov';
import { VAR_FEE_PCT } from '../../src/lib/store-quality/pricing';

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

interface Argv {
  sets: string[];
  single: Record<string, string>;
}

function parseArgv(argv: string[]): Argv {
  const sets: string[] = [];
  const single: Record<string, string> = {};
  for (const a of argv) {
    const stripped = a.replace(/^--/, '');
    const eq = stripped.indexOf('=');
    const key = eq === -1 ? stripped : stripped.slice(0, eq);
    const value = eq === -1 ? 'true' : stripped.slice(eq + 1);
    if (key === 'set') sets.push(value);
    else single[key] = value;
  }
  return { sets, single };
}

const { sets: SET_ARGS, single: ARGS } = parseArgv(process.argv.slice(2));
if (SET_ARGS.length === 0) {
  console.error('Required: --set=<setNumber> (repeatable)');
  process.exit(1);
}
const COND = (ARGS['cond'] ?? 'N').toUpperCase() as 'N' | 'U';
if (COND !== 'N' && COND !== 'U') {
  console.error(`--cond="${ARGS['cond']}" invalid — expected N or U`);
  process.exit(1);
}
const TOP_L3 = Math.max(0, parseInt(ARGS['top-l3'] ?? '20', 10));
const CDP_PORT = parseInt(ARGS['cdp-port'] ?? '9222', 10);
const NO_CDP = ARGS['no-cdp'] === 'true';
const PRICE = ARGS['price'] != null ? parseFloat(ARGS['price']) : null;
const REPORT_FILE = ARGS['report-file'] ? path.resolve(process.cwd(), ARGS['report-file']) : null;
const L3_TTL_DAYS = 45; // spec §2.1: type beats freshness — 45d window, not a short TTL

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const gbp = (n: number | null | undefined, dp = 3): string => (n == null ? '—' : `£${n.toFixed(dp)}`);
const pad = (s: string | number, w: number) => String(s).padEnd(w);
const padR = (s: string | number, w: number) => String(s).padStart(w);
/** Printed-part / licensed-print heuristic: BL part numbers for printed variants carry
 * "pb" (print/badge) in the item number, e.g. "973pb1234c01", "3626cpb0001". Best-effort —
 * not authoritative (see UK-vs-world flag limitations note in the report). */
const isPrintedPartNo = (itemNo: string): boolean => /pb\d/i.test(itemNo);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Lot {
  ref: PgItemRef;
  name: string;
  qty: number;
}

interface L1Row {
  no_data: boolean;
  currency: string;
  fx_rate: number | null;
  sold6m_new_lots: number;
  sold6m_new_qty: number;
  sold6m_new_avg: number | null;
  sold6m_new_qavg: number | null;
  sold6m_used_lots: number;
  sold6m_used_qty: number;
  sold6m_used_avg: number | null;
  sold6m_used_qavg: number | null;
  stock_new_lots: number;
  stock_new_qty: number;
  stock_used_lots: number;
  stock_used_qty: number;
}

interface Scored {
  lot: Lot;
  price: number | null; // GBP, condition-selected
  soldQty: number;
  soldLots: number;
  stockQty: number;
  stockLots: number;
  str: number | null;
  value: number | null; // lot.qty * price
  source: 'uk' | 'world' | 'none';
  noBenchmark: boolean; // no_data or unconverted-non-GBP
  isFig: boolean;
  isPrinted: boolean;
}

// ---------------------------------------------------------------------------
// Step 1: subsets -> unique lots (mirrors the POC's dedupe logic)
// ---------------------------------------------------------------------------

interface SubsetEntry {
  item: { no: string; name: string; type: string };
  color_id: number;
  quantity: number;
  extra_quantity: number;
}

function buildLots(subsets: Array<{ entries: SubsetEntry[] }>): { lots: Lot[]; skippedTypes: number } {
  const byKey = new Map<string, Lot>();
  let skippedTypes = 0;
  for (const group of subsets) {
    const e = group.entries?.[0];
    if (!e) continue;
    const t: PgItemType | null = e.item.type === 'PART' ? 'P' : e.item.type === 'MINIFIG' ? 'M' : null;
    if (!t) {
      skippedTypes++;
      continue;
    }
    const ref: PgItemRef = { itemType: t, itemNo: e.item.no, colourId: t === 'P' ? e.color_id : 0 };
    const key = pgCacheKey(ref);
    const existing = byKey.get(key);
    const qty = e.quantity + e.extra_quantity;
    if (existing) existing.qty += qty;
    else byKey.set(key, { ref, name: e.item.name, qty });
  }
  return { lots: [...byKey.values()], skippedTypes };
}

// ---------------------------------------------------------------------------
// Step 2: L1 join (paginated .in() chunks, fx-convert, skip no_data)
// ---------------------------------------------------------------------------

async function fetchL1(supabase: import('@supabase/supabase-js').SupabaseClient, lots: Lot[]): Promise<Map<string, L1Row>> {
  const out = new Map<string, L1Row>();
  const itemNos = [...new Set(lots.map((l) => l.ref.itemNo))];
  const wanted = new Set(lots.map((l) => pgCacheKey(l.ref)));
  const CHUNK = 300;
  const PAGE = 1000;
  for (let i = 0; i < itemNos.length; i += CHUNK) {
    const chunk = itemNos.slice(i, i + CHUNK);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('bricklink_pg_summary_cache')
        .select(
          'item_type,item_no,colour_id,no_data,currency,fx_rate,sold6m_new_lots,sold6m_new_qty,sold6m_new_avg,sold6m_new_qavg,sold6m_used_lots,sold6m_used_qty,sold6m_used_avg,sold6m_used_qavg,stock_new_lots,stock_new_qty,stock_used_lots,stock_used_qty',
        )
        .in('item_no', chunk)
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`L1 read failed: ${error.message}`);
      const rows = data ?? [];
      for (const r of rows) {
        const key = pgCacheKey({ itemType: r.item_type as PgItemType, itemNo: r.item_no, colourId: r.colour_id });
        if (wanted.has(key)) out.set(key, r as L1Row);
      }
      if (rows.length < PAGE) break;
    }
  }
  return out;
}

/** GBP-converted price for one L1 row's chosen condition, or null if no usable benchmark. */
function l1PriceAndFlags(row: L1Row | undefined, cond: 'N' | 'U'): { price: number | null; soldQty: number; soldLots: number; stockQty: number; stockLots: number; noBenchmark: boolean } {
  if (!row || row.no_data) return { price: null, soldQty: 0, soldLots: 0, stockQty: 0, stockLots: 0, noBenchmark: true };
  const rawPrice = cond === 'N' ? row.sold6m_new_qavg ?? row.sold6m_new_avg : row.sold6m_used_qavg ?? row.sold6m_used_avg;
  const soldQty = cond === 'N' ? row.sold6m_new_qty : row.sold6m_used_qty;
  const soldLots = cond === 'N' ? row.sold6m_new_lots : row.sold6m_used_lots;
  const stockQty = cond === 'N' ? row.stock_new_qty : row.stock_used_qty;
  const stockLots = cond === 'N' ? row.stock_new_lots : row.stock_used_lots;
  if (row.currency !== 'GBP') {
    if (row.fx_rate == null || row.fx_rate <= 0) {
      // Non-GBP with no stamped rate — cannot safely price this lot (the USD-blobs
      // defence, spec §2.2/§7.5). Treat as no benchmark rather than guess a rate.
      return { price: null, soldQty, soldLots, stockQty, stockLots, noBenchmark: true };
    }
    const converted = rawPrice == null ? null : +(rawPrice * row.fx_rate).toFixed(4);
    return { price: converted, soldQty, soldLots, stockQty, stockLots, noBenchmark: false };
  }
  return { price: rawPrice ?? null, soldQty, soldLots, stockQty, stockLots, noBenchmark: false };
}

function computeStr(soldQty: number, stockQty: number): number | null {
  if (stockQty > 0) return soldQty / stockQty;
  return soldQty > 0 ? Infinity : null;
}

// ---------------------------------------------------------------------------
// Step 3/4: L3 upgrade of the top --top-l3 lots by L1 value
// ---------------------------------------------------------------------------

interface L3UpgradeResult {
  upgraded: Map<string, PgCacheRow>;
  cacheHits: number;
  scraped: number;
  noData: number;
  notFound: number;
  degraded: string | null; // reason CDP scraping was skipped, if any
  aborted: string | null;
}

async function upgradeTopLots(
  cacheService: PriceGuideCacheService,
  topLots: Lot[],
): Promise<L3UpgradeResult> {
  const result: L3UpgradeResult = {
    upgraded: new Map(),
    cacheHits: 0,
    scraped: 0,
    noData: 0,
    notFound: 0,
    degraded: null,
    aborted: null,
  };
  if (topLots.length === 0) return result;

  const tuples = topLots.map((l) => l.ref);
  const fresh = await cacheService.getFresh(tuples, L3_TTL_DAYS);
  result.cacheHits = fresh.size;
  for (const [k, v] of fresh) result.upgraded.set(k, v);

  const needed = tuples.filter((t) => !fresh.has(pgCacheKey(t)));
  if (needed.length === 0) return result;

  if (NO_CDP) {
    result.degraded = `--no-cdp: ${needed.length} top-value lot(s) left at L1 (no L3 upgrade attempted).`;
    return result;
  }
  const reachable = await isPgCdpReachable(CDP_PORT);
  if (!reachable) {
    result.degraded = `CDP not reachable on :${CDP_PORT} — ${needed.length} top-value lot(s) left at L1 (degraded gracefully, no scrape attempted).`;
    return result;
  }

  const scraper = new PgScraper({ cdpPort: CDP_PORT });
  await scraper.open();
  let blockRetried = false;
  try {
    for (let i = 0; i < needed.length; i++) {
      const ref = needed[i];
      if (i > 0) await sleep(4000 + Math.random() * 2000);
      try {
        const scraped = await scraper.scrape(ref);
        const row = toPgCacheRow(scraped);
        result.upgraded.set(pgCacheKey(ref), row);
        await cacheService.upsert([scraped]);
        result.scraped++;
        blockRetried = false;
      } catch (err) {
        if (err instanceof PgNoDataError) {
          result.noData++;
          continue;
        }
        if (err instanceof PgNotFoundError) {
          result.notFound++;
          continue;
        }
        if (err instanceof PgBlockError) {
          if (!blockRetried) {
            console.warn('  ⚠ block signal — 60s breather, one retry…');
            blockRetried = true;
            await sleep(60000);
            i--;
            continue;
          }
          result.aborted = `Repeated block at lot ${i + 1}/${needed.length} — stopped L3 upgrade early; remaining lots stay at L1.`;
          break;
        }
        if (err instanceof PgCaptchaError || err instanceof PgLoginError || err instanceof PgCurrencyError) {
          result.aborted = `${(err as Error).name}: ${(err as Error).message} — stopped L3 upgrade immediately.`;
          break;
        }
        console.warn(`  ⚠ ${ref.itemType} ${ref.itemNo} c${ref.colourId}: ${(err as Error).message.slice(0, 120)}`);
      }
    }
  } finally {
    await scraper.close();
  }
  return result;
}

// ---------------------------------------------------------------------------
// Step 5: score a set's lots, combining L1 baseline + L3 upgrades
// ---------------------------------------------------------------------------

function scoreLots(lots: Lot[], l1: Map<string, L1Row>, l3: Map<string, PgCacheRow>): Scored[] {
  return lots.map((lot) => {
    const key = pgCacheKey(lot.ref);
    const l3row = l3.get(key);
    const isFig = lot.ref.itemType === 'M';
    const isPrinted = isPrintedPartNo(lot.ref.itemNo);

    if (l3row) {
      const price = COND === 'N' ? l3row.uk_sold_qty_avg_new ?? l3row.uk_sold_avg_new : l3row.uk_sold_qty_avg_used ?? l3row.uk_sold_avg_used;
      const soldQty = COND === 'N' ? l3row.uk_sold_qty_new : l3row.uk_sold_qty_used;
      const soldLots = COND === 'N' ? l3row.uk_sold_lots_new : l3row.uk_sold_lots_used;
      const stockQty = COND === 'N' ? l3row.uk_stock_qty_new : l3row.uk_stock_qty_used;
      const stockLots = COND === 'N' ? l3row.uk_stock_lots_new : l3row.uk_stock_lots_used;
      const hasUkData = soldLots > 0 || stockLots > 0;
      if (hasUkData) {
        const str = computeStr(soldQty, stockQty);
        return {
          lot,
          price: price ?? null,
          soldQty,
          soldLots,
          stockQty,
          stockLots,
          str,
          value: price != null ? price * lot.qty : null,
          source: 'uk' as const,
          noBenchmark: price == null,
          isFig,
          isPrinted,
        };
      }
      // L3 row exists but genuinely no UK sales/stock (e.g. no_data scrape) — fall through
      // to L1 for a worldwide screening figure rather than reporting a false zero.
    }

    const l1row = l1.get(key);
    const { price, soldQty, soldLots, stockQty, stockLots, noBenchmark } = l1PriceAndFlags(l1row, COND);
    const str = computeStr(soldQty, stockQty);
    return {
      lot,
      price,
      soldQty,
      soldLots,
      stockQty,
      stockLots,
      str,
      value: price != null ? price * lot.qty : null,
      source: price != null ? ('world' as const) : ('none' as const),
      noBenchmark,
      isFig,
      isPrinted,
    };
  });
}

// ---------------------------------------------------------------------------
// Step 6: report rendering
// ---------------------------------------------------------------------------

interface SetReport {
  setNo: string;
  totalLots: number;
  totalPieces: number;
  skippedTypes: number;
  l3: L3UpgradeResult;
  scored: Scored[];
  grossPov: number;
  realisablePov: number;
  captureRate: number;
  medianStr: number;
  meanStr: number;
  valueWeightedStr: number;
  top10Value: number;
  top10SharePct: number;
  top10FigPrintCount: number;
  yearReleased: number | null;
  recentSet: boolean; // best-effort: released this year or last calendar year
  ukWorldFlags: Array<{ ref: PgItemRef; name: string; source: Scored['source'] }>;
  verdict: string | null;
}

function buildReport(
  setNo: string,
  lots: Lot[],
  skippedTypes: number,
  l1: Map<string, L1Row>,
  l3: L3UpgradeResult,
  yearReleased: number | null,
): SetReport {
  const scored = scoreLots(lots, l1, l3.upgraded);
  scored.sort((a, b) => (b.value ?? -1) - (a.value ?? -1));

  const withStr = scored.filter((s) => s.str != null && s.str !== Infinity);
  const strs = withStr.map((s) => s.str as number);
  const grossLots: PovLot[] = scored.map((s) => ({ qty: s.lot.qty, price: s.price, str: s.str === Infinity ? 999 : s.str }));
  const { gross: grossPov, realisable: realisablePov, captureRate } = liquidityAdjustedPov(grossLots);

  const valueWeightedStr =
    withStr.reduce((acc, s) => acc + (s.str as number) * (s.value ?? 0), 0) / Math.max(1e-9, withStr.reduce((acc, s) => acc + (s.value ?? 0), 0));

  const top10 = scored.slice(0, 10);
  const top10Value = top10.reduce((acc, s) => acc + (s.value ?? 0), 0);
  const totalValue = scored.reduce((acc, s) => acc + (s.value ?? 0), 0);
  const top10FigPrintCount = top10.filter((s) => s.isFig || s.isPrinted).length;

  const currentYear = new Date().getFullYear();
  const recentSet = yearReleased != null && currentYear - yearReleased <= 1;
  const ukWorldFlags = scored
    .filter((s) => (s.isPrinted || s.isFig) && recentSet)
    .slice(0, 20)
    .map((s) => ({ ref: s.lot.ref, name: s.lot.name, source: s.source }));

  let verdict: string | null = null;
  if (PRICE != null && Number.isFinite(PRICE) && PRICE > 0) {
    const netRealisable = realisablePov * (1 - VAR_FEE_PCT);
    const marginGbp = netRealisable - PRICE;
    const marginPct = (marginGbp / PRICE) * 100;
    const call = marginPct >= 20 ? 'BUY' : marginPct >= 0 ? 'MARGINAL' : 'SKIP';
    verdict =
      `${call} at ${gbp(PRICE, 2)} — realisable POV ${gbp(realisablePov, 2)}, net of ${(VAR_FEE_PCT * 100).toFixed(1)}% fees ` +
      `${gbp(netRealisable, 2)}, margin ${gbp(marginGbp, 2)} (${marginPct >= 0 ? '+' : ''}${marginPct.toFixed(0)}%). ` +
      `Threshold: BUY >=20% margin, MARGINAL 0-20%, SKIP <0%.`;
  }

  return {
    setNo,
    totalLots: lots.length,
    totalPieces: lots.reduce((s, l) => s + l.qty, 0),
    skippedTypes,
    l3,
    scored,
    grossPov,
    realisablePov,
    captureRate,
    medianStr: median(strs),
    meanStr: strs.reduce((a, b) => a + b, 0) / Math.max(1, strs.length),
    valueWeightedStr: Number.isFinite(valueWeightedStr) ? valueWeightedStr : 0,
    top10Value,
    top10SharePct: totalValue > 0 ? (top10Value / totalValue) * 100 : 0,
    top10FigPrintCount,
    yearReleased,
    recentSet,
    ukWorldFlags,
    verdict,
  };
}

function printReport(r: SetReport): void {
  console.log(`\n=== Set intelligence: ${r.setNo} (cond ${COND}) ===`);
  console.log(
    `  ${r.totalLots} unique lots, ${r.totalPieces} pieces${r.skippedTypes ? ` (${r.skippedTypes} non-part/minifig entries skipped)` : ''}` +
      `${r.yearReleased ? `  ·  released ${r.yearReleased}${r.recentSet ? ' (recent — <=1yr, best effort)' : ''}` : '  ·  release year unknown'}`,
  );
  console.log(
    `  L3 upgrade: ${r.l3.cacheHits} cache hit(s), ${r.l3.scraped} scraped, ${r.l3.noData} no-data, ${r.l3.notFound} not-found` +
      `${r.l3.degraded ? `\n  ⚠ ${r.l3.degraded}` : ''}${r.l3.aborted ? `\n  ⚠ ${r.l3.aborted}` : ''}`,
  );

  console.log(
    `\n${pad('Item', 16)}${pad('Name', 30)}${padR('Col', 5)}${padR('Qty', 5)}${padR('Sold£', 8)}${padR('Value£', 9)}${padR('STR', 7)}${padR('Src', 6)}`,
  );
  console.log('-'.repeat(96));
  for (const s of r.scored.slice(0, 30)) {
    const strTxt = s.str == null ? '—' : s.str === Infinity ? '∞' : s.str.toFixed(2);
    console.log(
      `${pad(s.lot.ref.itemNo, 16)}${pad(s.lot.name.slice(0, 28), 30)}${padR(s.lot.ref.colourId, 5)}${padR(s.lot.qty, 5)}${padR(gbp(s.price), 8)}${padR(s.value != null ? s.value.toFixed(2) : '—', 9)}${padR(strTxt, 7)}${padR(s.source, 6)}`,
    );
  }
  if (r.scored.length > 30) console.log(`  … (${r.scored.length - 30} more lots not shown)`);

  console.log(`\n--- Summary ---`);
  console.log(`  Lot STR: median ${r.medianStr.toFixed(2)}  mean ${r.meanStr.toFixed(2)}  value-weighted ${r.valueWeightedStr.toFixed(2)}`);
  console.log(`  Quick-win concentration: top-10 lots carry ${gbp(r.top10Value, 2)} (${r.top10SharePct.toFixed(0)}% of value); ${r.top10FigPrintCount}/10 are figs/printed parts`);
  console.log(`  Gross POV: ${gbp(r.grossPov, 2)}   Realisable POV (liquidity-adjusted): ${gbp(r.realisablePov, 2)}  (capture rate ${(r.captureRate * 100).toFixed(0)}%)`);
  if (r.ukWorldFlags.length > 0) {
    console.log(
      `  UK-vs-world gap flag (printed/licensed parts on a set <=1yr old, best effort — release-YEAR granularity only, not month; verify with a live check before buying):`,
    );
    for (const f of r.ukWorldFlags.slice(0, 10)) console.log(`    ${f.ref.itemType} ${f.ref.itemNo} c${f.ref.colourId}  ${f.name.slice(0, 40)}  (priced from: ${f.source})`);
  } else {
    console.log(`  UK-vs-world gap flag: none (no printed/licensed parts on a recent set detected, or release year unknown)`);
  }
  if (r.verdict) console.log(`\n  VERDICT: ${r.verdict}`);
}

function reportMarkdown(reports: SetReport[]): string {
  const lines: string[] = [`# PG set-check report — ${new Date().toISOString().slice(0, 10)}`, ``];
  for (const r of reports) {
    lines.push(`## ${r.setNo} (cond ${COND})`, ``);
    lines.push(`- Lots: ${r.totalLots}, pieces: ${r.totalPieces}${r.yearReleased ? `, released ${r.yearReleased}` : ''}`);
    lines.push(`- L3 upgrade: ${r.l3.cacheHits} cache hit(s), ${r.l3.scraped} scraped, ${r.l3.noData} no-data, ${r.l3.notFound} not-found${r.l3.degraded ? ` — DEGRADED: ${r.l3.degraded}` : ''}`);
    lines.push(`- Lot STR: median ${r.medianStr.toFixed(2)}, mean ${r.meanStr.toFixed(2)}, value-weighted ${r.valueWeightedStr.toFixed(2)}`);
    lines.push(`- Top-10 concentration: ${gbp(r.top10Value, 2)} (${r.top10SharePct.toFixed(0)}%), ${r.top10FigPrintCount}/10 figs/printed`);
    lines.push(`- Gross POV: ${gbp(r.grossPov, 2)}; Realisable POV: ${gbp(r.realisablePov, 2)} (capture ${(r.captureRate * 100).toFixed(0)}%)`);
    if (r.verdict) lines.push(`- Verdict: ${r.verdict}`);
    lines.push(``);
    lines.push(`| Item | Name | Colour | Qty | Sold avg | Value | STR | Source |`);
    lines.push(`|---|---|---:|---:|---:|---:|---:|---|`);
    for (const s of r.scored.slice(0, 30)) {
      const strTxt = s.str == null ? '—' : s.str === Infinity ? '∞' : s.str.toFixed(2);
      lines.push(`| ${s.lot.ref.itemNo} | ${s.lot.name.slice(0, 40)} | ${s.lot.ref.colourId} | ${s.lot.qty} | ${gbp(s.price)} | ${s.value != null ? s.value.toFixed(2) : '—'} | ${strTxt} | ${s.source} |`);
    }
    lines.push(``);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  const { bl, supabase } = createScriptBlContext('pg-set-check');
  const cacheService = new PriceGuideCacheService(supabase);
  const reports: SetReport[] = [];

  for (const rawSet of SET_ARGS) {
    const setNo = /-\d+$/.test(rawSet) ? rawSet : `${rawSet}-1`;
    console.log(`\n[pg-set-check] ${setNo}: fetching subsets (1 BL API call)…`);
    const subsets = await bl.getSubsets('SET', setNo);
    const { lots, skippedTypes } = buildLots(subsets as Array<{ entries: SubsetEntry[] }>);
    console.log(`  ${lots.length} unique lots`);

    console.log(`  joining L1 (bricklink_pg_summary_cache)…`);
    const l1 = await fetchL1(supabase, lots);

    // Rank by L1 value to pick the top-l3 candidates for upgrade.
    const l1Ranked = lots
      .map((lot) => {
        const { price } = l1PriceAndFlags(l1.get(pgCacheKey(lot.ref)), COND);
        return { lot, value: price != null ? price * lot.qty : -1 };
      })
      .sort((a, b) => b.value - a.value);
    const topLots = l1Ranked.slice(0, TOP_L3).map((x) => x.lot);

    console.log(`  L3 upgrade of top ${topLots.length} lots by L1 value (--top-l3=${TOP_L3})…`);
    const l3 = await upgradeTopLots(cacheService, topLots);

    let yearReleased: number | null = null;
    try {
      const item = await bl.getCatalogItem('SET', setNo);
      yearReleased = item.year_released ?? null;
    } catch (e) {
      console.warn(`  ⚠ getCatalogItem failed for ${setNo}: ${(e as Error).message.slice(0, 120)}`);
    }

    const report = buildReport(setNo, lots, skippedTypes, l1, l3, yearReleased);
    reports.push(report);
    printReport(report);
  }

  if (REPORT_FILE) {
    fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
    fs.writeFileSync(REPORT_FILE, reportMarkdown(reports));
    console.log(`\n[pg-set-check] report written: ${REPORT_FILE}`);
  }
})().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
