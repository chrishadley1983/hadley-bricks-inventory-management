/**
 * Apply Chris's Bricqer pricing formula to a scanned store's passing items.
 *
 * For each lot we'd buy, compute OUR list price using:
 *   list = avg_sold_UK × multiplier(condition, sell_thru_rate)
 * where sell_thru_rate = UK sold total_quantity (6mo, per condition)
 *                     / UK stock total_quantity (current, per condition)
 *
 * Multiplier:
 *   New:  sell_thru ≥ 0.5 → 1.05  | else 0.90
 *   Used: sell_thru ≥ 1 → 1.25 | ≥ 0.75 → 1.15 | ≥ 0.5 → 1.10
 *                              | ≥ 0.25 → 0.90 | else 0.85
 *
 * Then profit per unit = list × (1 − 7% BL/payment fee) − ask.
 *
 * Reads:  tmp/stores/<slug>/enriched.json
 * Writes: tmp/stores/<slug>/bricqer-pricing.json
 * Writes: tmp/stores/<slug>/bricqer-report.html
 *
 * Usage (from apps/web):
 *   npx tsx scripts/apply-bricqer-pricing.ts --store-slug=Bruffty
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { BrickLinkApiError } from '../src/lib/bricklink/client';
import { bricqerMultiplier } from '../src/lib/bricklink/bricqer-pricing';
import type { BrickLinkItemType } from '../src/lib/bricklink/types';
import { createScriptBlContext } from './_bl-client';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

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

const API_DELAY_MS = parseInt(argv['api-delay-ms'] ?? '250', 10);
const API_BUDGET = parseInt(argv['api-budget'] ?? '4500', 10);
const BL_SELLER_FEE_RATE = 0.07;

const STORE_DIR = path.resolve(__dirname, `../../../tmp/stores/${STORE_SLUG}`);
const ENRICHED_FILE = path.join(STORE_DIR, 'enriched.json');
const OUT_FILE = path.join(STORE_DIR, 'bricqer-pricing.json');
const PROGRESS_FILE = path.join(STORE_DIR, 'bricqer-progress.json');
const REPORT_FILE = path.join(STORE_DIR, 'bricqer-report.html');

// ---------------------------------------------------------------------------

type StoreItemCode = 'P' | 'S' | 'M';
const STORE_TO_API: Record<StoreItemCode, BrickLinkItemType> = { P: 'PART', S: 'SET', M: 'MINIFIG' };

interface EnrichedItem {
  invID: number;
  itemType: StoreItemCode;
  itemNo: string;
  colourId: number;
  colourName: string | null;
  itemName: string;
  invNew: string;
  invQty: number;
  unitPriceGBP: number;
  benchmark: number | null;
  timesSold: number | null;
  passed: boolean;
}

interface BricqerLot {
  itemType: StoreItemCode;
  itemNo: string;
  colourId: number;
  colourName: string | null;
  itemName: string;
  condition: 'N' | 'U';
  invQty: number;
  askGBP: number;
  // Fresh UK data
  ukSoldAvgPrice: number | null;
  ukSoldTotalQty: number;
  ukStockTotalQty: number;
  sellThru: number;
  multiplier: number;
  listPrice: number | null;
  profitPerUnit: number | null;
  lotProfit: number | null;
  marginPct: number | null;
  rejectReason?: string;
}

const { bl } = createScriptBlContext('apply-bricqer-pricing-script');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function readJson<T>(p: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) as T; } catch { return fallback; }
}
function writeJson(p: string, data: unknown) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

// bricqerMultiplier now imported from src/lib/bricklink/bricqer-pricing (canonical v3).

function escapeHtml(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------

async function fetchUkData(
  itemType: StoreItemCode,
  itemNo: string,
  colourId: number,
  condition: 'N' | 'U',
): Promise<{ soldAvg: number | null; soldQty: number; stockQty: number }> {
  // Skip sets — Bricqer disables automatic pricing for sets, and SET endpoint also
  // rejects color_id=0 with PARAMETER_MISSING_OR_INVALID.
  if (itemType === 'S') {
    return { soldAvg: null, soldQty: 0, stockQty: 0 };
  }

  await sleep(API_DELAY_MS);
  const sold = await bl.getPartPriceGuide(STORE_TO_API[itemType], itemNo, colourId, {
    condition, guideType: 'sold', currencyCode: 'GBP', countryCode: 'UK',
  });

  await sleep(API_DELAY_MS);
  const stock = await bl.getPartPriceGuide(STORE_TO_API[itemType], itemNo, colourId, {
    condition, guideType: 'stock', currencyCode: 'GBP', countryCode: 'UK',
  });

  const soldAvg = parseFloat(sold.avg_price);
  return {
    soldAvg: Number.isFinite(soldAvg) && soldAvg > 0 ? soldAvg : null,
    soldQty: sold.total_quantity ?? 0,
    stockQty: stock.total_quantity ?? 0,
  };
}

// ---------------------------------------------------------------------------

async function main() {
  const enriched = readJson<EnrichedItem[]>(ENRICHED_FILE, []);
  if (enriched.length === 0) {
    console.error(`No enriched data at ${ENRICHED_FILE}`);
    process.exit(1);
  }

  // Items eligible for Bricqer pricing: passed gates, not sets, PART or MINIFIG.
  const eligible = enriched.filter((e) => e.passed && e.itemType !== 'S');
  console.log(`[main] ${eligible.length} eligible items (parts + minifigs that passed store-scan gates)`);

  const progress = readJson<{ done: string[]; callsUsed: number; results: BricqerLot[] }>(PROGRESS_FILE, {
    done: [], callsUsed: 0, results: [],
  });
  const doneSet = new Set(progress.done);

  for (const item of eligible) {
    const cond: 'N' | 'U' = item.invNew === 'New' ? 'N' : 'U';
    const key = `${item.invID}:${item.itemType}:${item.itemNo}:${item.colourId}:${cond}`;
    if (doneSet.has(key)) continue;

    if (progress.callsUsed + 2 > API_BUDGET) {
      console.warn(`[main] Budget reached (${progress.callsUsed}/${API_BUDGET}); stopping.`);
      break;
    }

    const lot: BricqerLot = {
      itemType: item.itemType,
      itemNo: item.itemNo,
      colourId: item.colourId,
      colourName: item.colourName,
      itemName: item.itemName,
      condition: cond,
      invQty: item.invQty,
      askGBP: item.unitPriceGBP,
      ukSoldAvgPrice: null,
      ukSoldTotalQty: 0,
      ukStockTotalQty: 0,
      sellThru: 0,
      multiplier: cond === 'N' ? 0.90 : 0.85,
      listPrice: null,
      profitPerUnit: null,
      lotProfit: null,
      marginPct: null,
    };

    try {
      const uk = await fetchUkData(item.itemType, item.itemNo, item.colourId, cond);
      progress.callsUsed += 2;

      lot.ukSoldAvgPrice = uk.soldAvg;
      lot.ukSoldTotalQty = uk.soldQty;
      lot.ukStockTotalQty = uk.stockQty;
      lot.sellThru = uk.stockQty > 0 ? uk.soldQty / uk.stockQty : 0;
      lot.multiplier = bricqerMultiplier(cond, lot.sellThru);

      if (uk.soldAvg != null) {
        lot.listPrice = uk.soldAvg * lot.multiplier;
        lot.profitPerUnit = lot.listPrice * (1 - BL_SELLER_FEE_RATE) - item.unitPriceGBP;
        lot.lotProfit = lot.profitPerUnit * item.invQty;
        lot.marginPct = (lot.profitPerUnit / item.unitPriceGBP) * 100;
      } else {
        lot.rejectReason = 'no UK sold data';
      }
    } catch (err) {
      if (err instanceof BrickLinkApiError && err.code === 429) {
        console.error('[main] Rate limit — aborting');
        break;
      }
      lot.rejectReason = `fetch failed: ${err instanceof Error ? err.message : String(err)}`;
    }

    progress.results.push(lot);
    progress.done.push(key);

    if (progress.results.length % 10 === 0) {
      writeJson(PROGRESS_FILE, progress);
      console.log(`[main] ${progress.results.length}/${eligible.length} (${progress.callsUsed} API calls)`);
    }
  }

  writeJson(PROGRESS_FILE, progress);
  writeJson(OUT_FILE, progress.results);

  // ----------- analysis -----------
  const priced = progress.results.filter((l) => l.listPrice != null && l.profitPerUnit != null);
  const profitable = priced.filter((l) => (l.profitPerUnit ?? 0) > 0);
  const totalOutlay = profitable.reduce((s, l) => s + l.askGBP * l.invQty, 0);
  const totalListValue = profitable.reduce((s, l) => s + (l.listPrice ?? 0) * l.invQty, 0);
  const totalGrossProfit = profitable.reduce((s, l) => s + (l.lotProfit ?? 0), 0);

  console.log('\n=== BRICQER-PRICED RESULTS ===');
  console.log(`Items analysed: ${priced.length} (of ${eligible.length} eligible)`);
  console.log(`Profitable under Bricqer pricing: ${profitable.length}`);
  console.log(`Unprofitable (ask exceeds our Bricqer list × 0.93): ${priced.length - profitable.length}`);
  console.log(`Basket outlay: £${totalOutlay.toFixed(2)}`);
  console.log(`Basket list value: £${totalListValue.toFixed(2)}`);
  console.log(`Gross profit at Bricqer prices: £${totalGrossProfit.toFixed(2)} (${totalOutlay > 0 ? ((totalGrossProfit / totalOutlay) * 100).toFixed(0) : 0}% margin)`);

  profitable.sort((a, b) => (b.lotProfit ?? 0) - (a.lotProfit ?? 0));
  console.log('\nTop 15 by lot profit £:');
  profitable.slice(0, 15).forEach((l, i) => {
    const col = l.colourName ? ` [${l.colourName.slice(0, 16)}]` : '';
    console.log(`${(i + 1).toString().padStart(2)}. [${l.itemType}] ${l.itemNo.padEnd(12)} ${(l.itemName.slice(0, 32) + col).padEnd(48)} | UK sold £${(l.ukSoldAvgPrice ?? 0).toFixed(2)} (${l.ukSoldTotalQty} sold / ${l.ukStockTotalQty} stock = ${l.sellThru.toFixed(2)}) | ×${l.multiplier.toFixed(2)} → list £${(l.listPrice ?? 0).toFixed(2)} | ask £${l.askGBP.toFixed(2)} q${l.invQty} | lot £${(l.lotProfit ?? 0).toFixed(2)}`);
  });

  // Render HTML report
  fs.writeFileSync(REPORT_FILE, renderReport(priced, profitable, { totalOutlay, totalListValue, totalGrossProfit }));
  console.log(`\nReport: ${REPORT_FILE}`);
}

// ---------------------------------------------------------------------------

function renderReport(
  all: BricqerLot[],
  profitable: BricqerLot[],
  totals: { totalOutlay: number; totalListValue: number; totalGrossProfit: number },
): string {
  profitable.sort((a, b) => (b.lotProfit ?? 0) - (a.lotProfit ?? 0));
  const margin = totals.totalOutlay > 0 ? (totals.totalGrossProfit / totals.totalOutlay) * 100 : 0;

  const row = (l: BricqerLot, i: number) => {
    const tag = l.itemType === 'M' ? 'FIG' : 'PART';
    const tagClass = l.itemType === 'M' ? 'type-fig' : 'type-part';
    const col = l.colourName ? ` <span class="colour">${escapeHtml(l.colourName)}</span>` : '';
    const blUrl = l.itemType === 'M'
      ? `https://www.bricklink.com/v2/catalog/catalogitem.page?M=${encodeURIComponent(l.itemNo)}`
      : `https://www.bricklink.com/v2/catalog/catalogitem.page?P=${encodeURIComponent(l.itemNo)}&idColor=${l.colourId}`;
    return `<tr>
      <td class="rank">${i + 1}</td>
      <td><span class="badge ${tagClass}">${tag}</span> <span class="cond">${l.condition}</span></td>
      <td><div class="ident"><a href="${blUrl}" target="_blank">${l.itemNo}</a>${col}</div><div class="name">${escapeHtml(l.itemName)}</div></td>
      <td class="num">£${(l.ukSoldAvgPrice ?? 0).toFixed(2)}</td>
      <td class="num">${l.ukSoldTotalQty}/${l.ukStockTotalQty}</td>
      <td class="num">${l.sellThru.toFixed(2)}</td>
      <td class="num mult">×${l.multiplier.toFixed(2)}</td>
      <td class="num list">£${(l.listPrice ?? 0).toFixed(2)}</td>
      <td class="num ask">£${l.askGBP.toFixed(2)}</td>
      <td class="num">${l.invQty}</td>
      <td class="num">£${(l.profitPerUnit ?? 0).toFixed(2)}</td>
      <td class="num bold">£${(l.lotProfit ?? 0).toFixed(2)}</td>
    </tr>`;
  };

  return `<!doctype html>
<html><head><meta charset="utf-8">
<title>Bricqer-priced scan — ${escapeHtml(STORE_SLUG)}</title>
<style>
 :root { color-scheme: dark; }
 body { font-family: -apple-system, "Segoe UI", system-ui, sans-serif; margin: 24px; background:#0f1115; color:#e7e9ee; }
 h1 { margin: 0 0 4px; font-size: 24px; }
 .sub { color:#9aa3b2; margin-bottom: 20px; font-size: 13px; }
 table { width: 100%; border-collapse: collapse; font-size: 13px; }
 th { text-align: left; background:#1a1f2b; color:#9aa3b2; padding:10px 8px; font-weight: 500; }
 td { padding:10px 8px; border-bottom:1px solid #1a1f2b; vertical-align: top; }
 tr:hover td { background: #141823; }
 .rank { color:#556; width: 32px; }
 .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
 .list { color:#4ade80; font-weight:600; }
 .ask { color:#fbbf24; font-weight:600; }
 .mult { color:#60a5fa; }
 .bold { font-weight: 600; color:#4ade80; }
 .ident { font-weight: 600; }
 .ident a { color:#60a5fa; text-decoration: none; }
 .ident a:hover { text-decoration: underline; }
 .colour { color:#9aa3b2; font-weight: 400; margin-left: 4px; }
 .cond { color:#9aa3b2; font-size: 11px; margin-left: 4px; }
 .name { color: #7a8394; font-size: 12px; max-width: 400px; }
 .badge { display:inline-block; padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: 700; color:#fff; }
 .type-part { background:#2563eb; } .type-fig { background:#6d28d9; }
 .summary { display:flex; gap:12px; margin-bottom: 20px; flex-wrap: wrap; }
 .stat { background:#1a1f2b; padding:12px 16px; border-radius:8px; min-width: 140px; }
 .stat .val { font-size: 22px; font-weight: 600; color: #4ade80; }
 .stat .lbl { color: #9aa3b2; font-size: 12px; }
 .legend { color:#6b7280; font-size:11px; margin-top: 32px; line-height: 1.6; }
</style>
</head><body>
<h1>Bricqer-priced scan — ${escapeHtml(STORE_SLUG)}</h1>
<div class="sub">Your real list price applied via Bricqer formula • ${profitable.length} profitable of ${all.length} analysed</div>

<div class="summary">
  <div class="stat"><div class="val">£${totals.totalOutlay.toFixed(2)}</div><div class="lbl">basket outlay</div></div>
  <div class="stat"><div class="val">£${totals.totalListValue.toFixed(2)}</div><div class="lbl">basket at Bricqer list</div></div>
  <div class="stat"><div class="val">£${totals.totalGrossProfit.toFixed(2)}</div><div class="lbl">gross profit after 7% BL fee</div></div>
  <div class="stat"><div class="val">${margin.toFixed(0)}%</div><div class="lbl">basket margin on ask</div></div>
</div>

<table>
<thead><tr>
  <th>#</th><th>Type</th><th>Item</th>
  <th class="num">UK avg sold</th>
  <th class="num">Sold/Stock</th>
  <th class="num">Sell-thru</th>
  <th class="num">Mult.</th>
  <th class="num">List £</th>
  <th class="num">Ask £</th>
  <th class="num">Qty</th>
  <th class="num">£/unit</th>
  <th class="num">Lot £</th>
</tr></thead>
<tbody>
${profitable.map(row).join('\n')}
</tbody>
</table>

<div class="legend">
  <b>Methodology.</b> For each lot we'd buy from ${escapeHtml(STORE_SLUG)}: fetched UK-filtered BL sold guide (avg_price, total_quantity 6mo) and UK stock guide (total_quantity current) at matching condition. Computed sell_thru = sold_qty/stock_qty. Applied Bricqer multiplier: New {≥0.5 → 1.05, else 0.90}; Used {≥1 → 1.25, ≥0.75 → 1.15, ≥0.5 → 1.10, ≥0.25 → 0.90, else 0.85}. List price = UK avg sold × multiplier. Profit/unit = list × (1 − 7% BL fee) − ask. Sets excluded (Bricqer disables auto-pricing for them). Items with no UK sold data excluded.
</div>
</body></html>`;
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
