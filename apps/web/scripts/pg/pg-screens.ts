/**
 * PG Market Intelligence — sourcing screens runner (spec §3 F5, done-criteria F5).
 *
 * Queries the three screen views created by
 * supabase/migrations/20260708120000_pg_screens_views.sql:
 *   - pg_screen_high_str     (L1 parts, STR>=0.5 either condition, sold6m value>=£20)
 *   - pg_screen_fig_radar    (same gate, item_type='M', + new/used spread)
 *   - pg_screen_trend_movers (L2 snapshots, MoM delta between each tuple's latest two
 *                             snapshot_date rows)
 *
 * The views already enforce a hard floor (STR>=0.5, sold value>=£20, no_data=false).
 * --min-str / --min-value only let you tighten the screen further at report time; they
 * cannot loosen it below the view's floor (silently clamped up to the floor).
 *
 * Renders a single markdown report with three sections to
 * tmp/pg-reports/screens-<date>.md and prints the report path + a top-10 console
 * summary per section.
 *
 * Usage (from apps/web):
 *   npx tsx scripts/pg/pg-screens.ts
 *
 * Flags:
 *   --min-str=<ratio>    Additional STR floor on top of the view's 0.5 (default 0.5)
 *   --min-value=<gbp>    Additional sold6m-value floor on top of the view's £20 (default 20)
 *   --top=<n>            Rows rendered per report section (default 50)
 *   --out=<path>         Override report output path
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

// View floors — flags can only raise these, never lower them.
const VIEW_STR_FLOOR = 0.5;
const VIEW_VALUE_FLOOR = 20;

const MIN_STR = Math.max(VIEW_STR_FLOOR, parseFloat(argv['min-str'] ?? String(VIEW_STR_FLOOR)));
const MIN_VALUE = Math.max(VIEW_VALUE_FLOOR, parseFloat(argv['min-value'] ?? String(VIEW_VALUE_FLOOR)));
const TOP_N = Math.max(1, parseInt(argv['top'] ?? '50', 10));

// repo-root/tmp/pg-reports (this file is apps/web/scripts/pg/ -> 4 levels up to repo root).
const REPORT_DIR = path.resolve(__dirname, '../../../../tmp/pg-reports');
const REPORT_DATE = new Date().toISOString().slice(0, 10);
const REPORT_FILE = argv['out'] ?? path.join(REPORT_DIR, `screens-${REPORT_DATE}.md`);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('[pg-screens] Missing Supabase env (.env.local)');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

const PAGE = 1000;

// ---------------------------------------------------------------------------
// Row shapes (mirror the view column lists in the migration)
// ---------------------------------------------------------------------------

interface HighStrRow {
  item_type: string;
  item_no: string;
  colour_id: number;
  str_new: number | null;
  str_used: number | null;
  sold6m_new_qty: number;
  sold6m_new_avg: number | null;
  sold6m_used_qty: number;
  sold6m_used_avg: number | null;
  stock_qty: number;
  sold_value_gbp: number | null;
  months_of_stock: number | null;
  fetched_at: string;
}

interface FigRadarRow extends HighStrRow {
  new_used_spread: number | null;
}

interface TrendMoverRow {
  item_type: string;
  item_no: string;
  colour_id: number;
  latest_date: string;
  prior_date: string;
  latest_new_qty: number | null;
  prior_new_qty: number | null;
  new_qty_delta: number;
  latest_new_avg: number | null;
  prior_new_avg: number | null;
  new_avg_delta: number | null;
  latest_used_qty: number | null;
  prior_used_qty: number | null;
  used_qty_delta: number;
  latest_used_avg: number | null;
  prior_used_avg: number | null;
  used_avg_delta: number | null;
  latest_str_new: number | null;
  latest_str_used: number | null;
}

/** Page through a view (Supabase caps responses at 1,000 rows). */
async function fetchAll<T>(sb: SupabaseClient, view: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await sb
      .from(view)
      .select(columns)
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(`${view} read failed: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

function tupleLabel(r: { item_type: string; item_no: string; colour_id: number }): string {
  return r.item_type === 'P' ? `${r.item_type} ${r.item_no} c${r.colour_id}` : `${r.item_type} ${r.item_no}`;
}

function money(v: number | null | undefined, dp = 2): string {
  return v == null ? '—' : `£${v.toFixed(dp)}`;
}

function ratio(v: number | null | undefined, dp = 2): string {
  return v == null ? '—' : v.toFixed(dp);
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function buildHighStrSection(rows: HighStrRow[]): { markdown: string; top: HighStrRow[] } {
  const filtered = rows.filter(
    (r) =>
      r.sold_value_gbp != null &&
      r.sold_value_gbp >= MIN_VALUE &&
      Math.max(r.str_new ?? 0, r.str_used ?? 0) >= MIN_STR,
  );
  const sorted = [...filtered].sort((a, b) => (b.sold_value_gbp ?? 0) - (a.sold_value_gbp ?? 0));
  const top = sorted.slice(0, TOP_N);

  const lines = [
    `## High-STR buy targets`,
    ``,
    `${filtered.length} of ${rows.length} L1 part tuples pass STR>=${MIN_STR.toFixed(2)} & sold6m value>=${money(MIN_VALUE)} (view floor: STR>=${VIEW_STR_FLOOR}, value>=${money(VIEW_VALUE_FLOOR)}). Showing top ${top.length} by sold6m value.`,
    ``,
    `| Tuple | STR new | STR used | Sold qty (N/U) | Sold avg (N/U) | Stock qty | Sold value | Months of stock |`,
    `|---|---:|---:|---:|---:|---:|---:|---:|`,
    ...top.map(
      (r) =>
        `| ${tupleLabel(r)} | ${ratio(r.str_new)} | ${ratio(r.str_used)} | ${r.sold6m_new_qty}/${r.sold6m_used_qty} | ${money(r.sold6m_new_avg, 3)}/${money(r.sold6m_used_avg, 3)} | ${r.stock_qty} | ${money(r.sold_value_gbp)} | ${ratio(r.months_of_stock, 1)} |`,
    ),
  ];
  return { markdown: lines.join('\n'), top };
}

function buildFigRadarSection(rows: FigRadarRow[]): { markdown: string; top: FigRadarRow[] } {
  const filtered = rows.filter(
    (r) =>
      r.sold_value_gbp != null &&
      r.sold_value_gbp >= MIN_VALUE &&
      Math.max(r.str_new ?? 0, r.str_used ?? 0) >= MIN_STR,
  );
  const sorted = [...filtered].sort((a, b) => (b.sold_value_gbp ?? 0) - (a.sold_value_gbp ?? 0));
  const top = sorted.slice(0, TOP_N);

  // Spread flags: new_used_spread <= 0.10 means used sells within 10% of new (or above
  // new) — the used copy is nearly as valuable, so buying used commons is close to
  // buying new at a discount. Flag candidates regardless of the top-N cut.
  const spreadFlags = filtered
    .filter((r) => r.new_used_spread != null && r.new_used_spread <= 0.1)
    .sort((a, b) => (a.new_used_spread ?? 0) - (b.new_used_spread ?? 0))
    .slice(0, TOP_N);

  const lines = [
    `## Fig radar`,
    ``,
    `${filtered.length} of ${rows.length} L1 minifig tuples pass STR>=${MIN_STR.toFixed(2)} & sold6m value>=${money(MIN_VALUE)}. Showing top ${top.length} by sold6m value.`,
    ``,
    `| Tuple | STR new | STR used | Sold qty (N/U) | Sold avg (N/U) | Sold value | New/used spread |`,
    `|---|---:|---:|---:|---:|---:|---:|`,
    ...top.map(
      (r) =>
        `| ${tupleLabel(r)} | ${ratio(r.str_new)} | ${ratio(r.str_used)} | ${r.sold6m_new_qty}/${r.sold6m_used_qty} | ${money(r.sold6m_new_avg, 3)}/${money(r.sold6m_used_avg, 3)} | ${money(r.sold_value_gbp)} | ${r.new_used_spread != null ? `${(r.new_used_spread * 100).toFixed(0)}%` : '—'} |`,
    ),
    ``,
    `### Spread flags (used within 10% of new, or above new — n=${spreadFlags.length})`,
    ``,
    spreadFlags.length === 0
      ? '_None this run._'
      : [
          `| Tuple | Sold avg (N/U) | Spread |`,
          `|---|---:|---:|`,
          ...spreadFlags.map(
            (r) => `| ${tupleLabel(r)} | ${money(r.sold6m_new_avg, 3)}/${money(r.sold6m_used_avg, 3)} | ${r.new_used_spread != null ? `${(r.new_used_spread * 100).toFixed(0)}%` : '—'} |`,
          ),
        ].join('\n'),
  ];
  return { markdown: lines.join('\n'), top };
}

function buildTrendMoversSection(rows: TrendMoverRow[]): { markdown: string; risers: TrendMoverRow[]; fallers: TrendMoverRow[] } {
  const withDelta = rows.map((r) => ({
    ...r,
    totalQtyDelta: (r.new_qty_delta ?? 0) + (r.used_qty_delta ?? 0),
  }));
  const risers = [...withDelta].sort((a, b) => b.totalQtyDelta - a.totalQtyDelta).slice(0, TOP_N);
  const fallers = [...withDelta].sort((a, b) => a.totalQtyDelta - b.totalQtyDelta).slice(0, TOP_N);

  const renderTable = (list: typeof withDelta) => [
    `| Tuple | Snapshot dates | Qty delta (N+U) | New avg delta | Used avg delta | STR new/used |`,
    `|---|---|---:|---:|---:|---:|`,
    ...list.map(
      (r) =>
        `| ${tupleLabel(r)} | ${r.prior_date} → ${r.latest_date} | ${r.totalQtyDelta > 0 ? '+' : ''}${r.totalQtyDelta} | ${r.new_avg_delta != null ? money(r.new_avg_delta, 3) : '—'} | ${r.used_avg_delta != null ? money(r.used_avg_delta, 3) : '—'} | ${ratio(r.latest_str_new)}/${ratio(r.latest_str_used)} |`,
    ),
  ];

  const lines = [
    `## Trend movers`,
    ``,
    `${rows.length} tuples have >=2 L2 snapshots (MoM delta computable). Top ${risers.length} risers and top ${fallers.length} fallers by combined sold6m qty delta.`,
    ``,
    `### Risers`,
    ``,
    ...(risers.length === 0 ? ['_None this run — L2 snapshot history is too young (needs >=2 monthly passes per tuple)._'] : renderTable(risers)),
    ``,
    `### Fallers`,
    ``,
    ...(fallers.length === 0 ? ['_None this run._'] : renderTable(fallers)),
  ];
  return { markdown: lines.join('\n'), risers, fallers };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`[pg-screens] starting — min-str=${MIN_STR} min-value=${MIN_VALUE} top=${TOP_N}`);

  const [highStrRows, figRadarRows, trendRows] = await Promise.all([
    fetchAll<HighStrRow>(
      supabase,
      'pg_screen_high_str',
      'item_type,item_no,colour_id,str_new,str_used,sold6m_new_qty,sold6m_new_avg,sold6m_used_qty,sold6m_used_avg,stock_qty,sold_value_gbp,months_of_stock,fetched_at',
    ),
    fetchAll<FigRadarRow>(
      supabase,
      'pg_screen_fig_radar',
      'item_type,item_no,colour_id,str_new,str_used,sold6m_new_qty,sold6m_new_avg,sold6m_used_qty,sold6m_used_avg,stock_qty,sold_value_gbp,months_of_stock,new_used_spread,fetched_at',
    ),
    fetchAll<TrendMoverRow>(
      supabase,
      'pg_screen_trend_movers',
      'item_type,item_no,colour_id,latest_date,prior_date,latest_new_qty,prior_new_qty,new_qty_delta,latest_new_avg,prior_new_avg,new_avg_delta,latest_used_qty,prior_used_qty,used_qty_delta,latest_used_avg,prior_used_avg,used_avg_delta,latest_str_new,latest_str_used',
    ),
  ]);
  console.log(`[pg-screens] loaded ${highStrRows.length} high-STR row(s), ${figRadarRows.length} fig-radar row(s), ${trendRows.length} trend-mover row(s)`);

  const highStr = buildHighStrSection(highStrRows);
  const figRadar = buildFigRadarSection(figRadarRows);
  const trend = buildTrendMoversSection(trendRows);

  const report = [
    `# PG sourcing screens — ${REPORT_DATE}`,
    ``,
    `Thresholds: STR>=${MIN_STR.toFixed(2)}, sold6m value>=${money(MIN_VALUE)}, top ${TOP_N} rows/section.`,
    ``,
    highStr.markdown,
    ``,
    figRadar.markdown,
    ``,
    trend.markdown,
    ``,
  ].join('\n');

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_FILE, report);
  console.log(`[pg-screens] report written: ${REPORT_FILE}`);

  console.log(`\n[pg-screens] top 10 high-STR buy targets:`);
  for (const r of highStr.top.slice(0, 10)) {
    console.log(`  ${tupleLabel(r)}  STR ${ratio(r.str_new)}/${ratio(r.str_used)}  value ${money(r.sold_value_gbp)}  months-of-stock ${ratio(r.months_of_stock, 1)}`);
  }
  console.log(`\n[pg-screens] top 10 fig radar:`);
  for (const r of figRadar.top.slice(0, 10)) {
    console.log(`  ${tupleLabel(r)}  STR ${ratio(r.str_new)}/${ratio(r.str_used)}  value ${money(r.sold_value_gbp)}  spread ${r.new_used_spread != null ? `${(r.new_used_spread * 100).toFixed(0)}%` : '—'}`);
  }
  console.log(`\n[pg-screens] top 10 trend risers:`);
  for (const r of trend.risers.slice(0, 10)) {
    const totalDelta = (r.new_qty_delta ?? 0) + (r.used_qty_delta ?? 0);
    console.log(`  ${tupleLabel(r)}  ${r.prior_date} -> ${r.latest_date}  qty delta ${totalDelta > 0 ? '+' : ''}${totalDelta}`);
  }

  console.log('\n[pg-screens] done');
}

main().catch((e) => {
  console.error('[pg-screens] fatal:', e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});
