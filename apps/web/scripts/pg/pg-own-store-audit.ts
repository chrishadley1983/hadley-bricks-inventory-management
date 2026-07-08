/**
 * PG Market Intelligence — own-store audit (spec §3 F6, done-criteria F5).
 *
 * Joins the tenant's own live inventory against L1 (bricklink_pg_summary_cache) + L3
 * (bricklink_price_guide_cache) and produces four screens:
 *   - Overpriced-vs-velocity: our price > uk_sold_avg × 1.5 AND months_of_stock > 12
 *     (needs price + qty)
 *   - Underpriced-vs-UK: our price < uk_sold_avg × 0.6 — money left on the table
 *     (needs price)
 *   - Dead stock: tuples we hold qty of with zero sold6m activity on either lane
 *     (needs qty)
 *   - Missing-restock candidates: high-STR tuples (STR>=0.5, sold6m value>=£20) we hold
 *     zero qty of (needs qty data present in the file at all — see field-detection note)
 *
 * Input, in priority order:
 *   --inventory-file=<path>   Any JSON array of lot objects (Bricqer export or otherwise)
 *   --store-slug=<slug>       Reads tmp/stores/<slug>/pg-scan-inventory.json (the shape
 *                             written by bl-pg-store-scan.ts: itemType/itemNo/colourId/
 *                             cond/qty/ask/...)
 *
 * Field detection: the exact export shape is not guaranteed (spec: "inspect what fields
 * the file actually carries at runtime and degrade gracefully"). This script scans the
 * first N rows for known candidate key names per logical field (item type/no/colour,
 * price, qty, condition) and logs exactly which logical fields it found vs. is missing.
 * Sections whose required field(s) are absent are skipped (not silently zeroed) and
 * called out at the top of the report and in the console summary.
 *
 * Usage (from apps/web):
 *   npx tsx scripts/pg/pg-own-store-audit.ts --store-slug=Gibbo0o
 *   npx tsx scripts/pg/pg-own-store-audit.ts --inventory-file=../../tmp/stores/Gibbo0o/pg-scan-inventory.json
 *
 * Flags:
 *   --inventory-file=<path>       See above
 *   --store-slug=<slug>           See above
 *   --overpriced-multiple=<n>     Default 1.5
 *   --overpriced-months=<n>       Default 12
 *   --underpriced-multiple=<n>    Default 0.6
 *   --top=<n>                     Rows rendered per report section (default 50)
 *   --out=<path>                  Override report output path
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

const argv = process.argv.slice(2).reduce<Record<string, string>>((acc, a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  acc[k] = v ?? 'true';
  return acc;
}, {});

// This file lives at apps/web/scripts/pg/ -> 4 levels up to repo root.
const REPO_ROOT = path.resolve(__dirname, '../../../../');
const REPORT_DIR = path.join(REPO_ROOT, 'tmp/pg-reports');
const REPORT_DATE = new Date().toISOString().slice(0, 10);
const REPORT_FILE = argv['out'] ?? path.join(REPORT_DIR, `own-store-audit-${REPORT_DATE}.md`);

const STORE_SLUG = argv['store-slug'];
const INVENTORY_FILE =
  argv['inventory-file'] ?? (STORE_SLUG ? path.join(REPO_ROOT, 'tmp/stores', STORE_SLUG, 'pg-scan-inventory.json') : undefined);

if (!INVENTORY_FILE) {
  console.error('[pg-own-store-audit] Required: --inventory-file=<path> or --store-slug=<slug>');
  process.exit(1);
}

const OVERPRICED_MULTIPLE = parseFloat(argv['overpriced-multiple'] ?? '1.5');
const OVERPRICED_MONTHS = parseFloat(argv['overpriced-months'] ?? '12');
const UNDERPRICED_MULTIPLE = parseFloat(argv['underpriced-multiple'] ?? '0.6');
const TOP_N = Math.max(1, parseInt(argv['top'] ?? '50', 10));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('[pg-own-store-audit] Missing Supabase env (.env.local)');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

const PAGE = 1000;
const IN_CHUNK = 300;

// ---------------------------------------------------------------------------
// Field detection — degrade gracefully to whatever the export actually carries.
// ---------------------------------------------------------------------------

type RawLot = Record<string, unknown>;

type LogicalField = 'itemType' | 'itemNo' | 'colourId' | 'price' | 'qty' | 'condition';

const FIELD_CANDIDATES: Record<LogicalField, string[]> = {
  itemType: ['itemType', 'item_type', 'type', 'lego_type'],
  itemNo: ['itemNo', 'item_no', 'itemNumber', 'no', 'lego_no', 'part_no'],
  colourId: ['colourId', 'colour_id', 'colorID', 'colorId', 'color_id'],
  price: ['ask', 'price', 'our_price', 'ourPrice', 'list_price', 'listPrice', 'sale_price', 'salePrice'],
  qty: ['qty', 'quantity', 'invQty', 'stock', 'stock_qty', 'stockQty'],
  condition: ['cond', 'condition', 'new_used', 'newUsed'],
};

function detectFields(sample: RawLot[]): Partial<Record<LogicalField, string>> {
  const keys = new Set<string>();
  for (const row of sample.slice(0, 50)) {
    if (row && typeof row === 'object') for (const k of Object.keys(row)) keys.add(k);
  }
  const map: Partial<Record<LogicalField, string>> = {};
  for (const logical of Object.keys(FIELD_CANDIDATES) as LogicalField[]) {
    const found = FIELD_CANDIDATES[logical].find((c) => keys.has(c));
    if (found) map[logical] = found;
  }
  return map;
}

interface OwnLot {
  itemType: string;
  itemNo: string;
  colourId: number;
  price: number | null;
  qty: number | null;
  condition: 'N' | 'U' | null;
}

function normaliseCondition(raw: unknown): 'N' | 'U' | null {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (s === 'n' || s === 'new') return 'N';
  if (s === 'u' || s === 'used') return 'U';
  return null;
}

function loadOwnInventory(fields: Partial<Record<LogicalField, string>>, raw: RawLot[]): OwnLot[] {
  const out: OwnLot[] = [];
  for (const row of raw) {
    const itemType = fields.itemType ? String(row[fields.itemType] ?? '') : '';
    const itemNo = fields.itemNo ? String(row[fields.itemNo] ?? '') : '';
    if (!itemType || !itemNo) continue; // identity is mandatory — can't audit an unidentifiable row
    const colourIdRaw = fields.colourId ? row[fields.colourId] : undefined;
    const colourId = itemType === 'P' ? Number(colourIdRaw ?? 0) || 0 : 0;
    const priceRaw = fields.price ? row[fields.price] : undefined;
    const price = priceRaw != null && priceRaw !== '' ? Number(priceRaw) : null;
    const qtyRaw = fields.qty ? row[fields.qty] : undefined;
    const qty = qtyRaw != null && qtyRaw !== '' ? Number(qtyRaw) : null;
    const condition = fields.condition ? normaliseCondition(row[fields.condition]) : null;
    out.push({
      itemType,
      itemNo,
      colourId,
      price: price != null && Number.isFinite(price) ? price : null,
      qty: qty != null && Number.isFinite(qty) ? qty : null,
      condition,
    });
  }
  return out;
}

/** Aggregate multiple lots of the same tuple: qty summed, price = qty-weighted avg (falls
 *  back to simple avg when qty is unavailable). Condition = majority vote, else null. */
interface AggregatedTuple {
  itemType: string;
  itemNo: string;
  colourId: number;
  totalQty: number | null;
  avgPrice: number | null;
  lotCount: number;
  condition: 'N' | 'U' | null;
}

function aggregateByTuple(lots: OwnLot[]): Map<string, AggregatedTuple> {
  const groups = new Map<string, OwnLot[]>();
  for (const l of lots) {
    const key = `${l.itemType}:${l.itemNo}:${l.colourId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(l);
  }
  const out = new Map<string, AggregatedTuple>();
  for (const [key, group] of groups) {
    const qtys = group.map((g) => g.qty).filter((q): q is number => q != null);
    const totalQty = qtys.length > 0 ? qtys.reduce((a, b) => a + b, 0) : null;
    const priced = group.filter((g) => g.price != null) as Array<OwnLot & { price: number }>;
    let avgPrice: number | null = null;
    if (priced.length > 0) {
      const weighted = priced.some((p) => p.qty != null);
      if (weighted) {
        const num = priced.reduce((a, p) => a + p.price * (p.qty ?? 1), 0);
        const den = priced.reduce((a, p) => a + (p.qty ?? 1), 0);
        avgPrice = den > 0 ? num / den : null;
      } else {
        avgPrice = priced.reduce((a, p) => a + p.price, 0) / priced.length;
      }
    }
    const conditions = group.map((g) => g.condition).filter((c): c is 'N' | 'U' => c != null);
    const nCount = conditions.filter((c) => c === 'N').length;
    const uCount = conditions.length - nCount;
    const condition: 'N' | 'U' | null = conditions.length === 0 ? null : nCount >= uCount ? 'N' : 'U';
    out.set(key, {
      itemType: group[0].itemType,
      itemNo: group[0].itemNo,
      colourId: group[0].colourId,
      totalQty,
      avgPrice,
      lotCount: group.length,
      condition,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Market data join (L1 + L3), chunked .in() reads of 300 item_nos.
// ---------------------------------------------------------------------------

interface MarketTuple {
  ukSoldAvgNew: number | null;
  ukSoldAvgUsed: number | null;
  ukSoldQtyNew: number;
  ukSoldQtyUsed: number;
  source: 'L3' | 'L1' | 'none';
}

function tupleKey(t: { item_type: string; item_no: string; colour_id: number }): string {
  return `${t.item_type}:${t.item_no}:${t.colour_id}`;
}

async function fetchL3(sb: SupabaseClient, itemNos: string[]): Promise<Map<string, MarketTuple>> {
  const out = new Map<string, MarketTuple>();
  for (let i = 0; i < itemNos.length; i += IN_CHUNK) {
    const chunk = itemNos.slice(i, i + IN_CHUNK);
    let pageStart = 0;
    for (;;) {
      const { data, error } = await sb
        .from('bricklink_price_guide_cache')
        .select('item_type,item_no,colour_id,uk_sold_avg_new,uk_sold_avg_used,uk_sold_qty_new,uk_sold_qty_used')
        .in('item_no', chunk)
        .range(pageStart, pageStart + PAGE - 1);
      if (error) throw new Error(`L3 read failed: ${error.message}`);
      const rows = data ?? [];
      for (const r of rows) {
        out.set(tupleKey(r), {
          ukSoldAvgNew: r.uk_sold_avg_new,
          ukSoldAvgUsed: r.uk_sold_avg_used,
          ukSoldQtyNew: r.uk_sold_qty_new ?? 0,
          ukSoldQtyUsed: r.uk_sold_qty_used ?? 0,
          source: 'L3',
        });
      }
      if (rows.length < PAGE) break;
      pageStart += PAGE;
    }
  }
  return out;
}

interface L1Row {
  item_type: string;
  item_no: string;
  colour_id: number;
  currency: string | null;
  fx_rate: number | null;
  sold6m_new_avg: number | null;
  sold6m_new_qavg: number | null;
  sold6m_new_qty: number | null;
  sold6m_used_avg: number | null;
  sold6m_used_qavg: number | null;
  sold6m_used_qty: number | null;
  no_data: boolean;
}

async function fetchL1(sb: SupabaseClient, itemNos: string[]): Promise<Map<string, MarketTuple>> {
  const out = new Map<string, MarketTuple>();
  for (let i = 0; i < itemNos.length; i += IN_CHUNK) {
    const chunk = itemNos.slice(i, i + IN_CHUNK);
    let pageStart = 0;
    for (;;) {
      const { data, error } = await sb
        .from('bricklink_pg_summary_cache')
        .select(
          'item_type,item_no,colour_id,currency,fx_rate,sold6m_new_avg,sold6m_new_qavg,sold6m_new_qty,sold6m_used_avg,sold6m_used_qavg,sold6m_used_qty,no_data',
        )
        .in('item_no', chunk)
        .range(pageStart, pageStart + PAGE - 1);
      if (error) throw new Error(`L1 read failed: ${error.message}`);
      const rows = (data ?? []) as L1Row[];
      for (const r of rows) {
        if (r.no_data) continue;
        const fx = r.currency && r.currency !== 'GBP' ? r.fx_rate : 1;
        if (fx == null) continue; // non-GBP row with no stamped rate — don't guess
        const newAvg = r.sold6m_new_qavg ?? r.sold6m_new_avg;
        const usedAvg = r.sold6m_used_qavg ?? r.sold6m_used_avg;
        out.set(tupleKey(r), {
          ukSoldAvgNew: newAvg != null ? newAvg * fx : null,
          ukSoldAvgUsed: usedAvg != null ? usedAvg * fx : null,
          ukSoldQtyNew: r.sold6m_new_qty ?? 0,
          ukSoldQtyUsed: r.sold6m_used_qty ?? 0,
          source: 'L1',
        });
      }
      if (rows.length < PAGE) break;
      pageStart += PAGE;
    }
  }
  return out;
}

/** L3 (UK page-scrape detail) wins when present; L1 (worldwide summary, GBP-normalised)
 *  fills the rest. Absent from both = 'none' (dead-stock candidate if we hold qty). */
function mergeMarket(l3: Map<string, MarketTuple>, l1: Map<string, MarketTuple>, keys: string[]): Map<string, MarketTuple> {
  const out = new Map<string, MarketTuple>();
  for (const key of keys) {
    const fromL3 = l3.get(key);
    const fromL1 = l1.get(key);
    if (fromL3) out.set(key, fromL3);
    else if (fromL1) out.set(key, fromL1);
    else out.set(key, { ukSoldAvgNew: null, ukSoldAvgUsed: null, ukSoldQtyNew: 0, ukSoldQtyUsed: 0, source: 'none' });
  }
  return out;
}

/** High-STR restock candidates: same gate as pg_screen_high_str (STR>=0.5, value>=£20). */
interface HighStrCandidate {
  item_type: string;
  item_no: string;
  colour_id: number;
  str_new: number | null;
  str_used: number | null;
}

async function fetchHighStrCandidates(sb: SupabaseClient): Promise<HighStrCandidate[]> {
  const out: HighStrCandidate[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await sb
      .from('pg_screen_high_str')
      .select('item_type,item_no,colour_id,str_new,str_used')
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(`pg_screen_high_str read failed: ${error.message}`);
    const rows = (data ?? []) as HighStrCandidate[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function money(v: number | null | undefined, dp = 2): string {
  return v == null ? '—' : `£${v.toFixed(dp)}`;
}

function tupleLabel(t: { itemType: string; itemNo: string; colourId: number }): string {
  return t.itemType === 'P' ? `${t.itemType} ${t.itemNo} c${t.colourId}` : `${t.itemType} ${t.itemNo}`;
}

/** Condition-matched market avg + 6m sold qty (falls back to the other condition, then
 *  combined, when the matched one is unavailable — a lot's own condition is the best
 *  signal but shouldn't blank the row when only one side of the guide has data). */
function marketForCondition(m: MarketTuple, condition: 'N' | 'U' | null): { avg: number | null; qty6m: number } {
  if (condition === 'N') return { avg: m.ukSoldAvgNew ?? m.ukSoldAvgUsed, qty6m: m.ukSoldQtyNew || m.ukSoldQtyUsed };
  if (condition === 'U') return { avg: m.ukSoldAvgUsed ?? m.ukSoldAvgNew, qty6m: m.ukSoldQtyUsed || m.ukSoldQtyNew };
  // Unknown condition: combine both sides.
  const avg = m.ukSoldAvgNew != null && m.ukSoldAvgUsed != null ? (m.ukSoldAvgNew + m.ukSoldAvgUsed) / 2 : (m.ukSoldAvgNew ?? m.ukSoldAvgUsed);
  return { avg, qty6m: m.ukSoldQtyNew + m.ukSoldQtyUsed };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`[pg-own-store-audit] reading ${INVENTORY_FILE}`);
  if (!fs.existsSync(INVENTORY_FILE!)) {
    console.error(`[pg-own-store-audit] Inventory file not found: ${INVENTORY_FILE}`);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(INVENTORY_FILE!, 'utf8')) as RawLot[];
  if (!Array.isArray(raw)) {
    console.error(`[pg-own-store-audit] Expected a JSON array of lot objects, got ${typeof raw}`);
    process.exit(1);
  }
  console.log(`[pg-own-store-audit] ${raw.length} raw row(s)`);

  const fields = detectFields(raw);
  const missing = (Object.keys(FIELD_CANDIDATES) as LogicalField[]).filter((f) => !fields[f]);
  console.log(`[pg-own-store-audit] fields detected: ${JSON.stringify(fields)}`);
  if (missing.length > 0) {
    console.log(`[pg-own-store-audit] fields MISSING (sections needing them will be skipped): ${missing.join(', ')}`);
  }
  if (!fields.itemType || !fields.itemNo) {
    console.error('[pg-own-store-audit] Cannot identify tuples without item type + item number fields — aborting.');
    process.exit(1);
  }

  const hasPrice = !!fields.price;
  const hasQty = !!fields.qty;

  const lots = loadOwnInventory(fields, raw);
  console.log(`[pg-own-store-audit] ${lots.length} identifiable lot(s) after field mapping`);

  const aggregated = aggregateByTuple(lots);
  const itemNos = [...new Set([...aggregated.values()].map((t) => t.itemNo))];
  console.log(`[pg-own-store-audit] ${aggregated.size} unique tuple(s) across ${itemNos.length} item number(s)`);

  const [l3, l1] = await Promise.all([fetchL3(supabase, itemNos), fetchL1(supabase, itemNos)]);
  const market = mergeMarket(l3, l1, [...aggregated.keys()]);
  console.log(`[pg-own-store-audit] market join: ${[...market.values()].filter((m) => m.source === 'L3').length} from L3, ${[...market.values()].filter((m) => m.source === 'L1').length} from L1, ${[...market.values()].filter((m) => m.source === 'none').length} unmatched`);

  interface Row {
    key: string;
    t: AggregatedTuple;
    m: MarketTuple;
    matchedAvg: number | null;
    matchedQty6m: number;
    monthsOfStock: number | null;
  }

  const rows: Row[] = [...aggregated.entries()].map(([key, t]) => {
    const m = market.get(key)!;
    const { avg, qty6m } = marketForCondition(m, t.condition);
    const monthsOfStock = t.totalQty != null && qty6m > 0 ? t.totalQty / (qty6m / 6) : null;
    return { key, t, m, matchedAvg: avg, matchedQty6m: qty6m, monthsOfStock };
  });

  // --- Overpriced-vs-velocity (needs price + qty) ---
  const overpriced = hasPrice && hasQty
    ? rows
        .filter((r) => r.t.avgPrice != null && r.matchedAvg != null && r.monthsOfStock != null)
        .filter((r) => r.t.avgPrice! > r.matchedAvg! * OVERPRICED_MULTIPLE && r.monthsOfStock! > OVERPRICED_MONTHS)
        .sort((a, b) => (b.t.avgPrice! - b.matchedAvg! * OVERPRICED_MULTIPLE) - (a.t.avgPrice! - a.matchedAvg! * OVERPRICED_MULTIPLE))
    : [];

  // --- Underpriced-vs-UK (needs price only) ---
  const underpriced = hasPrice
    ? rows
        .filter((r) => r.t.avgPrice != null && r.matchedAvg != null && r.matchedAvg > 0)
        .filter((r) => r.t.avgPrice! < r.matchedAvg! * UNDERPRICED_MULTIPLE)
        .sort((a, b) => (b.matchedAvg! - b.t.avgPrice! ) * (b.t.totalQty ?? 1) - (a.matchedAvg! - a.t.avgPrice!) * (a.t.totalQty ?? 1))
    : [];

  // --- Dead stock (needs qty only) ---
  const deadStock = hasQty
    ? rows
        .filter((r) => (r.t.totalQty ?? 0) > 0 && r.m.ukSoldQtyNew === 0 && r.m.ukSoldQtyUsed === 0)
        .sort((a, b) => (b.t.totalQty ?? 0) - (a.t.totalQty ?? 0))
    : [];

  // --- Missing-restock candidates (needs qty data present in the file at all) ---
  let missingRestock: HighStrCandidate[] = [];
  if (hasQty) {
    const ourKeys = new Set([...aggregated.entries()].filter(([, t]) => (t.totalQty ?? 0) > 0).map(([k]) => k));
    const candidates = await fetchHighStrCandidates(supabase);
    missingRestock = candidates.filter((c) => !ourKeys.has(tupleKey(c)));
    missingRestock.sort((a, b) => Math.max(b.str_new ?? 0, b.str_used ?? 0) - Math.max(a.str_new ?? 0, a.str_used ?? 0));
  }

  // ---------------------------------------------------------------------------
  // Report
  // ---------------------------------------------------------------------------

  const sections: string[] = [];

  sections.push(`# Own-store audit — ${REPORT_DATE}`, '');
  sections.push(`Source: \`${path.relative(REPO_ROOT, INVENTORY_FILE!)}\` (${raw.length} raw row(s), ${aggregated.size} unique tuple(s)).`);
  sections.push(`Fields detected: ${(Object.keys(FIELD_CANDIDATES) as LogicalField[]).map((f) => `${f}${fields[f] ? ` (\`${fields[f]}\`)` : ' — MISSING'}`).join(', ')}.`);
  if (missing.length > 0) {
    sections.push('', `**Degraded run**: ${missing.join(', ')} not found in the export — sections requiring ${missing.includes('price') ? 'price ' : ''}${missing.includes('qty') ? 'qty ' : ''}data are skipped below rather than silently zeroed.`);
  }
  sections.push('');

  sections.push(`## Overpriced vs velocity (our price > UK sold avg × ${OVERPRICED_MULTIPLE} AND months-of-stock > ${OVERPRICED_MONTHS})`, '');
  if (!hasPrice || !hasQty) {
    sections.push(`_Skipped — needs both price and qty fields (missing: ${[!hasPrice ? 'price' : null, !hasQty ? 'qty' : null].filter(Boolean).join(', ')})._`);
  } else if (overpriced.length === 0) {
    sections.push('_None this run._');
  } else {
    sections.push(
      '| Tuple | Our price | UK sold avg | Our qty | Months of stock | Gap |',
      '|---|---:|---:|---:|---:|---:|',
      ...overpriced.slice(0, TOP_N).map((r) => `| ${tupleLabel(r.t)} | ${money(r.t.avgPrice)} | ${money(r.matchedAvg)} | ${r.t.totalQty} | ${r.monthsOfStock?.toFixed(1)} | ${money((r.t.avgPrice ?? 0) - (r.matchedAvg ?? 0) * OVERPRICED_MULTIPLE)} |`),
    );
  }
  sections.push('');

  sections.push(`## Underpriced vs UK (our price < UK sold avg × ${UNDERPRICED_MULTIPLE} — money left on the table)`, '');
  if (!hasPrice) {
    sections.push('_Skipped — needs a price field._');
  } else if (underpriced.length === 0) {
    sections.push('_None this run._');
  } else {
    sections.push(
      '| Tuple | Our price | UK sold avg | Our qty | Uplift/unit | Uplift total |',
      '|---|---:|---:|---:|---:|---:|',
      ...underpriced.slice(0, TOP_N).map((r) => {
        const uplift = (r.matchedAvg ?? 0) - (r.t.avgPrice ?? 0);
        const total = uplift * (r.t.totalQty ?? 1);
        return `| ${tupleLabel(r.t)} | ${money(r.t.avgPrice)} | ${money(r.matchedAvg)} | ${r.t.totalQty ?? '—'} | ${money(uplift)} | ${money(total)} |`;
      }),
    );
  }
  sections.push('');

  sections.push(`## Dead stock (qty held, zero UK sold6m activity on either lane)`, '');
  if (!hasQty) {
    sections.push('_Skipped — needs a qty field.');
  } else if (deadStock.length === 0) {
    sections.push('_None this run._');
  } else {
    sections.push(
      '| Tuple | Our qty | Market source |',
      '|---|---:|---|',
      ...deadStock.slice(0, TOP_N).map((r) => `| ${tupleLabel(r.t)} | ${r.t.totalQty} | ${r.m.source} |`),
    );
  }
  sections.push('');

  sections.push(`## Missing-restock candidates (high-STR tuples we hold zero qty of)`, '');
  if (!hasQty) {
    sections.push('_Skipped — needs a qty field to know what "zero qty" means for this store._');
  } else if (missingRestock.length === 0) {
    sections.push('_None this run._');
  } else {
    sections.push(
      '| Tuple | STR new | STR used |',
      '|---|---:|---:|',
      ...missingRestock.slice(0, TOP_N).map((c) => `| ${tupleLabel({ itemType: c.item_type, itemNo: c.item_no, colourId: c.colour_id })} | ${c.str_new?.toFixed(2) ?? '—'} | ${c.str_used?.toFixed(2) ?? '—'} |`),
    );
  }
  sections.push('');

  const report = sections.join('\n');
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_FILE, report);
  console.log(`[pg-own-store-audit] report written: ${REPORT_FILE}`);

  console.log(`\n[pg-own-store-audit] summary: overpriced=${overpriced.length} underpriced=${underpriced.length} dead-stock=${deadStock.length} missing-restock=${missingRestock.length}`);

  await persistReport(STORE_SLUG ?? path.basename(INVENTORY_FILE!, '.json'), {
    overpricedCount: overpriced.length,
    underpricedCount: underpriced.length,
    deadStockCount: deadStock.length,
    missingRestockCount: missingRestock.length,
    lotsAudited: raw.length,
  }, report);

  console.log('[pg-own-store-audit] done');
}

// ---------------------------------------------------------------------------
// BrickRadar UI persistence (spec §5.1): mirror bl-pg-store-scan.ts's
// persistScanReport — non-fatal, so a Supabase hiccup never fails the run.
// ---------------------------------------------------------------------------

interface OwnStoreAuditSummary {
  overpricedCount: number;
  underpricedCount: number;
  deadStockCount: number;
  missingRestockCount: number;
  lotsAudited: number;
}

async function persistReport(subject: string, summary: OwnStoreAuditSummary, md: string): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from('bl_pg_reports').insert({
      kind: 'own_store_audit',
      subject,
      summary,
      report_md: md,
    });
    if (error) console.warn(`  ⚠ bl_pg_reports insert failed: ${error.message}`);
  } catch (err) {
    console.warn(`  ⚠ bl_pg_reports insert failed: ${(err as Error).message}`);
  }
}

main().catch((e) => {
  console.error('[pg-own-store-audit] fatal:', e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});
