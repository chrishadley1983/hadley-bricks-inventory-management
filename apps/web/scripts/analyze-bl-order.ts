// Analyse a BL incoming order — sale price vs UK 6MA + STR per lot.
//
// Usage:   npx tsx scripts/analyze-bl-order.ts <orderId>
// Example: npx tsx scripts/analyze-bl-order.ts 31466910
//
// Output:
//   - Per-item condition notes (description / remarks / completeness)
//   - Lot table: sale price, UK 6MA, Δ%, sold count (6mo), open stock, STR
//   - Summary: Δ vs 6MA (median + mean per-lot, total order),
//              STR (median, mean, revenue-weighted), total at 6MA pricing.
//
// Notes:
//   - "Used" lots may show large negative Δ vs 6MA — always check the
//     `description` field for disclosed condition issues (nicks, cracks, etc.)
//     before treating as under-pricing.
//   - `remarks` typically holds storage location codes (e.g. "U-307-2"),
//     not condition info.
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { createScriptBlContext } from './_bl-client';
import { ensurePriceGuide } from '../src/lib/bricklink/price-guide/capture';

const arg = process.argv[2];
if (!arg) { console.error('Usage: npx tsx scripts/analyze-bl-order.ts <orderId>'); process.exit(1); }
const ORDER_ID = parseInt(arg, 10);
if (!Number.isFinite(ORDER_ID)) { console.error(`Invalid order ID: ${arg}`); process.exit(1); }

const { bl, supabase } = createScriptBlContext('analyze-bl-order-script');

// Unified price cache: cache-first UK reads via ensurePriceGuide (misses fetch all 4
// quadrants + capture automatically). Legacy behaviour was 2-3 live API calls per lot.
const PG_TTL_DAYS = 90;
const API_TYPE_TO_PG: Record<string, 'P' | 'M' | 'S'> = { PART: 'P', MINIFIG: 'M', SET: 'S' };

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const median = (xs: number[]) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const pad = (s: string | number, w: number) => String(s).padEnd(w);
const padR = (s: string | number, w: number) => String(s).padStart(w);

(async () => {
  console.log(`Fetching BL order ${ORDER_ID}…`);
  const { order, items } = await bl.getOrderWithItems(ORDER_ID);

  console.log(`\nOrder ${order.order_id}  ${order.date_ordered}`);
  console.log(`Buyer:   ${order.buyer_name}`);
  console.log(`Status:  ${order.status}`);
  console.log(`Total:   ${order.cost.currency_code} ${order.cost.grand_total}  (sub ${order.cost.subtotal}  ship ${order.cost.shipping ?? '0'})`);
  console.log(`Items:   ${order.total_count} pcs across ${order.unique_count} lots`);

  type Row = {
    type: string;
    no: string;
    name: string;
    color: string;
    condition: 'N' | 'U';
    completeness?: string;
    remarks?: string;
    description?: string;
    qty: number;
    soldUnit: number;
    sixMA: number | null;
    sixMAScope: 'UK' | 'GLOBAL' | null;
    sixMASoldQty: number | null;
    pctVs6MA: number | null;
    str: number | null; // 6mo sold / current stock
    stockQty: number | null;
  };
  const rows: Row[] = [];

  for (const it of items) {
    const unit = parseFloat(it.unit_price_final ?? it.unit_price);
    const condition: 'N' | 'U' = it.new_or_used === 'U' ? 'U' : 'N';
    const colourId = it.color_id ?? 0;

    // Try UK first; fall back to GLOBAL only when UK has 0 sold qty in 6mo
    // (rare/low-volume items often have no UK history but do have global).
    let soldQty: number | null = null;
    let stockQty: number | null = null;
    let sixMA: number | null = null;
    let sixMAScope: 'UK' | 'GLOBAL' | null = null;
    try {
      // UK leg: unified price cache. Order-item colour ids come from the BL order API,
      // so they're BL-scheme (ensurePriceGuide's default).
      const pgType = API_TYPE_TO_PG[it.item.type];
      let ukSoldQty = 0;
      let ukSoldQtyAvg: number | null = null;
      if (pgType) {
        const view = await ensurePriceGuide(bl, supabase, { itemType: pgType, itemNo: it.item.no, colourId }, { ttlDays: PG_TTL_DAYS });
        await sleep(150);
        const side = condition === 'U' ? view.used : view.new;
        ukSoldQty = side.soldQty;
        ukSoldQtyAvg = side.soldQtyAvg;
        soldQty = side.soldQty;
        stockQty = side.stockQty;
      } else {
        // Non-P/M/S catalogue types (GEAR, BOOK, …) can't live in the unified cache —
        // keep the legacy direct UK API pair for those rare lots (no capture).
        const sold = await bl.getPartPriceGuide(it.item.type, it.item.no, colourId, {
          condition, guideType: 'sold', currencyCode: 'GBP', countryCode: 'UK',
        });
        await sleep(150);
        const stock = await bl.getPartPriceGuide(it.item.type, it.item.no, colourId, {
          condition, guideType: 'stock', currencyCode: 'GBP', countryCode: 'UK',
        });
        await sleep(150);
        ukSoldQty = sold?.total_quantity ?? 0;
        ukSoldQtyAvg = sold ? parseFloat(sold.qty_avg_price) : null;
        soldQty = sold?.total_quantity ?? null;
        stockQty = stock?.total_quantity ?? null;
      }

      if (ukSoldQty > 0) {
        sixMAScope = 'UK';
        sixMA = ukSoldQtyAvg && ukSoldQtyAvg > 0 ? ukSoldQtyAvg : null;
      } else {
        // GLOBAL fallback stays a live BL API call: the unified cache is UK-scoped,
        // so global sold data is fetched fresh and deliberately NOT captured.
        const global = await bl.getPartPriceGuide(it.item.type, it.item.no, colourId, {
          condition, guideType: 'sold', currencyCode: 'GBP', // no countryCode = global
        });
        await sleep(150);
        if ((global?.total_quantity ?? 0) > 0) {
          sixMAScope = 'GLOBAL';
          soldQty = global.total_quantity ?? null;
          const g = parseFloat(global.qty_avg_price);
          sixMA = g > 0 ? g : null;
        }
      }
    } catch (e) {
      console.error(`  ${it.item.no}/${colourId}: price guide error — ${(e as Error).message}`);
    }

    const pctVs6MA = sixMA && unit > 0 ? ((unit - sixMA) / sixMA) * 100 : null;
    const str = soldQty != null && stockQty && stockQty > 0 ? soldQty / stockQty : null;

    rows.push({
      type: it.item.type,
      no: it.item.no,
      name: it.item.name.substring(0, 36),
      color: it.color_name ?? `c${colourId}`,
      condition,
      completeness: it.completeness,
      remarks: it.remarks,
      description: it.description,
      qty: it.quantity,
      soldUnit: unit,
      sixMA,
      sixMAScope,
      sixMASoldQty: soldQty,
      pctVs6MA,
      str,
      stockQty,
    });
  }

  // ── Per-item condition notes (sellers' damage/condition flags) ──
  console.log('\n┌─ Condition notes ─────────────────────────────────────────────────────────────────┐');
  for (const r of rows) {
    const notes: string[] = [];
    if (r.completeness) notes.push(`completeness=${r.completeness}`);
    if (r.remarks) notes.push(`remarks="${r.remarks}"`);
    if (r.description) notes.push(`desc="${r.description}"`);
    console.log(`  ${r.no.padEnd(10)} ${notes.length ? notes.join(' | ') : '(no notes)'}`);
  }

  // ── Per-item table ──
  console.log('\n┌─ Lots ────────────────────────────────────────────────────────────────────────────────────┐');
  console.log(`${pad('T', 6)}${pad('Item', 12)}${pad('Name', 38)}${pad('Cond', 5)}${padR('Qty', 4)} ${padR('Sold/u', 8)}${padR('6MA', 9)}${padR('Sc', 4)}${padR('Δ%', 8)}${padR('Sold(6m)', 10)}${padR('Stock', 7)}${padR('STR', 8)}`);
  console.log('─'.repeat(118));
  for (const r of rows) {
    const pct = r.pctVs6MA == null ? 'n/a' : `${r.pctVs6MA >= 0 ? '+' : ''}${r.pctVs6MA.toFixed(1)}%`;
    const sma = r.sixMA == null ? 'n/a' : `£${r.sixMA.toFixed(3)}`;
    const scope = r.sixMAScope === 'UK' ? 'UK' : r.sixMAScope === 'GLOBAL' ? 'G' : '-';
    const str = r.str == null ? 'n/a' : r.str.toFixed(2);
    console.log(
      `${pad(r.type, 6)}${pad(r.no, 12)}${pad(r.name, 38)}${pad(r.condition, 5)}${padR(r.qty, 4)} ${padR('£' + r.soldUnit.toFixed(3), 8)}${padR(sma, 9)}${padR(scope, 4)}${padR(pct, 8)}${padR(r.sixMASoldQty ?? '-', 10)}${padR(r.stockQty ?? '-', 7)}${padR(str, 8)}`
    );
  }

  // ── Aggregates ──
  const pctList = rows.map(r => r.pctVs6MA).filter((x): x is number => x != null);
  const strList = rows.map(r => r.str).filter((x): x is number => x != null);
  const orderRevenue = rows.reduce((s, r) => s + r.soldUnit * r.qty, 0);
  // Only sum lots where 6MA data exists — null 6MA shouldn't be treated as £0.
  const rowsWith6MA = rows.filter(r => r.sixMA != null);
  const rowsNo6MA = rows.filter(r => r.sixMA == null);
  const revenueWith6MA = rowsWith6MA.reduce((s, r) => s + r.soldUnit * r.qty, 0);
  const order6MA = rowsWith6MA.reduce((s, r) => s + (r.sixMA ?? 0) * r.qty, 0);
  const revenueNo6MA = rowsNo6MA.reduce((s, r) => s + r.soldUnit * r.qty, 0);

  // Revenue-weighted STR — only over lots where STR is defined
  const strRows = rows.filter(r => r.str != null);
  const strRevenue = strRows.reduce((s, r) => s + r.soldUnit * r.qty, 0);
  const revWeightedSTR = strRevenue > 0
    ? strRows.reduce((s, r) => s + (r.str ?? 0) * r.soldUnit * r.qty, 0) / strRevenue
    : 0;
  // Order-level Δ vs 6MA — comparable lots only (those where BL has sold history)
  const pctVs6MAOrder = order6MA > 0 ? ((revenueWith6MA - order6MA) / order6MA) * 100 : 0;

  console.log('\n┌─ Summary ─────────────────────────────────────────────────────────────────────────┐');
  console.log(`  Lots priced vs 6MA:    ${pctList.length}/${rows.length}`);
  console.log(`  Δ vs UK 6MA per-lot:   median ${median(pctList).toFixed(1)}%   mean ${mean(pctList).toFixed(1)}%`);
  console.log(`  STR (sold-6m / stock): median ${median(strList).toFixed(2)}    mean ${mean(strList).toFixed(2)}    rev-weighted ${revWeightedSTR.toFixed(2)}`);
  console.log(`  Revenue (total):       £${orderRevenue.toFixed(2)}`);
  console.log(`    of which comparable: £${revenueWith6MA.toFixed(2)}   (lots with 6MA data)`);
  if (rowsNo6MA.length > 0) {
    console.log(`    no 6MA history:      £${revenueNo6MA.toFixed(2)}   (${rowsNo6MA.length} lot${rowsNo6MA.length === 1 ? '' : 's'} — 0 sold in 6mo, can't compare)`);
  }
  console.log(`  At UK 6MA (comparable): £${order6MA.toFixed(2)}    (Δ £${(revenueWith6MA - order6MA).toFixed(2)} / ${pctVs6MAOrder >= 0 ? '+' : ''}${pctVs6MAOrder.toFixed(2)}%)`);
})().catch(e => { console.error(e); process.exit(1); });
