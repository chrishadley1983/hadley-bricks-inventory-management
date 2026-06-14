/**
 * Demand-gap sourcing tool (cached-only).
 *
 * Turns our own BL+BO sales history into a prioritised "re-source this — we're
 * out of it / running low" list. Joins realized sales to current stock by the
 * name key (item_number, color_name, condition) — see framework §1.1 / §5.1.
 *
 * Ranks by realized demand value (what we actually earned on the part in the
 * window), so it needs no market cache and is immune to the BL↔Bricqer colour-id
 * mismatch. Writes a CSV reorder seed.
 *
 * Usage (from apps/web):
 *   npx tsx scripts/source-demand-gaps.ts
 *   npx tsx scripts/source-demand-gaps.ts --window=180 --min-units=2 --top=50 --csv=tmp/reorder.csv
 *
 * Flags:
 *   --window=<days>     sales window (default 180)
 *   --min-units=<n>     min units sold in window to count as demand (default 2)
 *   --reorder-weeks=<n> weeks of cover that defines "running low" (default 4)
 *   --segment=parts|minifigs|all   default all
 *   --top=<n>           rows per list (default 40)
 *   --csv=<path>        write the reorder seed CSV
 *   --user-id=<uuid>
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const argv = process.argv.slice(2).reduce<Record<string, string>>((acc, a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  acc[k] = v ?? 'true';
  return acc;
}, {});
const WINDOW = parseInt(argv['window'] ?? '180', 10);
const MIN_UNITS = parseInt(argv['min-units'] ?? '2', 10);
const REORDER_WEEKS = parseFloat(argv['reorder-weeks'] ?? '4');
const SEGMENT = (argv['segment'] ?? 'all') as 'parts' | 'minifigs' | 'all';
const TOP = parseInt(argv['top'] ?? '40', 10);
const CSV_OUT = argv['csv'] && argv['csv'] !== 'true' ? argv['csv'] : null;
const USER_ID = argv['user-id'] ?? '4b6e94b4-661c-4462-9d14-b21df7d51e5b';

const TYPES =
  SEGMENT === 'parts' ? ['PART'] : SEGMENT === 'minifigs' ? ['MINIFIG', 'MINIFIGURE'] : ['PART', 'MINIFIG', 'MINIFIGURE'];

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().trim();
const normCond = (c: string | null | undefined) => (c === 'New' || c === 'N' ? 'New' : 'Used');
const num = (v: any) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

async function fetchAll<T>(build: (from: number, to: number) => any): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

interface Gap {
  itemNumber: string;
  itemName: string;
  colorName: string | null;
  colorId: number | null;
  condition: string;
  units: number;
  orders: number;
  avgPrice: number;
  realizedValue: number;
  lastSoldDays: number;
  currentQty: number;
  suggestedQty: number;
}

async function main() {
  const cutoff = new Date(Date.now() - WINDOW * 86400000).toISOString();

  // 1. realized sales
  const orders = await fetchAll<any>((from, to) =>
    (supabase as any)
      .from('platform_orders')
      .select('id,order_date,order_items(item_number,item_name,color_name,color_id,condition,item_type,quantity,unit_price,total_price)')
      .eq('user_id', USER_ID)
      .in('platform', ['bricklink', 'brickowl'])
      .gte('order_date', cutoff)
      .order('id', { ascending: true })
      .range(from, to)
  );

  const agg = new Map<string, any>();
  for (const o of orders) {
    const soldMs = o.order_date ? Date.parse(o.order_date) : Date.now();
    for (const it of o.order_items ?? []) {
      const type = (it.item_type ?? '').toUpperCase();
      if (!TYPES.includes(type)) continue;
      const cond = normCond(it.condition);
      const key = `${it.item_number}|${norm(it.color_name)}|${cond}`;
      const q = num(it.quantity);
      const lineVal = num(it.total_price) || num(it.unit_price) * q;
      const cur = agg.get(key) ?? {
        itemNumber: it.item_number,
        itemName: it.item_name ?? it.item_number,
        colorName: it.color_name,
        colorId: it.color_id,
        condition: cond,
        units: 0,
        orders: new Set<string>(),
        revenue: 0,
        lastSold: 0,
      };
      cur.units += q;
      cur.orders.add(o.id);
      cur.revenue += lineVal;
      if (soldMs > cur.lastSold) cur.lastSold = soldMs;
      if (!cur.colorName && it.color_name) cur.colorName = it.color_name;
      agg.set(key, cur);
    }
  }

  // 2. current stock by name key
  const snap = await fetchAll<any>((from, to) =>
    (supabase as any)
      .from('bricqer_inventory_snapshot')
      .select('item_number,color_name,condition,quantity,item_type')
      .eq('user_id', USER_ID)
      .gt('quantity', 0)
      .order('bricqer_item_id', { ascending: true })
      .range(from, to)
  );
  const stock = new Map<string, number>();
  for (const s of snap) {
    const key = `${s.item_number}|${norm(s.color_name)}|${normCond(s.condition)}`;
    stock.set(key, (stock.get(key) ?? 0) + num(s.quantity));
  }

  // 3. classify gaps
  const now = Date.now();
  const out: Gap[] = [];
  const low: Gap[] = [];
  for (const [key, a] of agg) {
    if (a.units < MIN_UNITS) continue;
    const currentQty = stock.get(key) ?? 0;
    const ratePerWeek = a.units / (WINDOW / 7);
    const reorderPoint = ratePerWeek * REORDER_WEEKS;
    const g: Gap = {
      itemNumber: a.itemNumber,
      itemName: a.itemName,
      colorName: a.colorName,
      colorId: a.colorId,
      condition: a.condition,
      units: a.units,
      orders: a.orders.size,
      avgPrice: a.revenue / a.units,
      realizedValue: a.revenue,
      lastSoldDays: a.lastSold ? Math.floor((now - a.lastSold) / 86400000) : -1,
      currentQty,
      suggestedQty: Math.max(MIN_UNITS, Math.ceil(reorderPoint)),
    };
    if (currentQty === 0) out.push(g);
    else if (currentQty < reorderPoint) low.push(g);
  }
  out.sort((a, b) => b.realizedValue - a.realizedValue);
  low.sort((a, b) => b.realizedValue - a.realizedValue);

  // 4. report
  const money = (n: number) => `£${n.toFixed(2)}`;
  const pad = (s: any, w: number) => String(s).padEnd(w);
  const padL = (s: any, w: number) => String(s).padStart(w);
  const line = (g: Gap) =>
    `    ${pad(g.itemNumber + (g.colorName ? ' ' + g.colorName : ''), 28)} ${pad(g.condition, 4)} ` +
    `sold ${padL(g.units, 4)}u/${padL(g.orders, 3)}ord  avg ${padL(money(g.avgPrice), 8)}  ` +
    `realized ${padL(money(g.realizedValue), 8)}  last ${padL(g.lastSoldDays, 4)}d  → buy ${g.suggestedQty}`;

  console.log('═'.repeat(80));
  console.log(`  DEMAND-GAP SOURCING — ${SEGMENT}, last ${WINDOW}d, min ${MIN_UNITS} units`);
  console.log('═'.repeat(80));
  console.log(
    `  ${out.length} OUT-OF-STOCK demand gaps (realized ${money(out.reduce((s, g) => s + g.realizedValue, 0))}), ` +
      `${low.length} running LOW.`
  );
  console.log('  NOTE: "out of stock" is as of the Bricqer snapshot — refresh first for accuracy.\n');

  console.log(`  OUT OF STOCK — proven demand, now zero stock (top ${TOP}):`);
  if (out.length === 0) console.log('    none');
  for (const g of out.slice(0, TOP)) console.log(line(g));

  console.log(`\n  RUNNING LOW — below ${REORDER_WEEKS}-week cover (top ${TOP}):`);
  if (low.length === 0) console.log('    none');
  for (const g of low.slice(0, TOP)) console.log(line(g));

  // 5. CSV seed
  if (CSV_OUT) {
    const abs = path.isAbsolute(CSV_OUT) ? CSV_OUT : path.resolve(process.cwd(), CSV_OUT);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const rows = [['status', 'item_number', 'color_name', 'color_id', 'condition', 'units_sold', 'orders', 'avg_price', 'suggested_qty']];
    for (const g of out) rows.push(['OUT', g.itemNumber, g.colorName ?? '', String(g.colorId ?? ''), g.condition, String(g.units), String(g.orders), g.avgPrice.toFixed(4), String(g.suggestedQty)]);
    for (const g of low) rows.push(['LOW', g.itemNumber, g.colorName ?? '', String(g.colorId ?? ''), g.condition, String(g.units), String(g.orders), g.avgPrice.toFixed(4), String(g.suggestedQty)]);
    fs.writeFileSync(abs, rows.map((r) => r.map((c) => (c.includes(',') ? `"${c}"` : c)).join(',')).join('\n'));
    console.log(`\n  CSV reorder seed written to ${abs} (${out.length + low.length} rows).`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
