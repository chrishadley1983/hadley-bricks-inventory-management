/**
 * Build the post-2021 set sweep target list for the BL->Amazon international set-arb.
 *
 * Universe = every SET in bl_pg_refresh_queue whose Brickset release year (year_from) is
 * >= 2022 — recent retirements + current production, where Amazon UK demand and international
 * price gaps actually sit (Chris 2026-07-15). Excludes sets already scraped in the last N
 * hours (the 1k run's overlap), so we don't redo work. Ordered OLDEST-first (2022 -> 2026):
 * recently-retired sets (2022-24) are the prime BL->Amazon arb candidates (Amazon price has
 * risen on scarcity while international stock is still cheap), whereas brand-new sets are
 * current-retail (thin gaps) and have high no-data rates — so value + hit-rate front-load.
 *
 * Writes tmp/post2021-sets.json (bare tuple array for pg-page-sweep --from-report).
 *
 *   npx tsx scripts/pg/build-post2021-target.ts [--min-year=2022] [--exclude-fresh-hours=5]
 */
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
import { createClient } from '@supabase/supabase-js';

const argv = process.argv.slice(2).reduce<Record<string, string>>((a, s) => {
  const [k, v] = s.replace(/^--/, '').split('='); a[k] = v ?? 'true'; return a;
}, {});
const MIN_YEAR = parseInt(argv['min-year'] ?? '2022', 10);
const EXCLUDE_FRESH_HOURS = parseFloat(argv['exclude-fresh-hours'] ?? '5');

const base = (n: string) => n.split('-')[0];

async function pageAll<T>(q: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await q(from, from + PAGE - 1);
    if (error) throw new Error(String((error as { message?: string }).message ?? error));
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error('Missing Supabase env (.env.local)'); process.exit(1); }
  const sb = createClient(url, key);

  // 1) Brickset base_no -> newest year_from (>= MIN_YEAR)
  const bs = await pageAll<{ set_number: string; year_from: number }>((f, t) =>
    sb.from('brickset_sets').select('set_number,year_from').gte('year_from', MIN_YEAR).range(f, t));
  const yearByBase = new Map<string, number>();
  for (const r of bs) {
    const b = base(r.set_number);
    yearByBase.set(b, Math.max(yearByBase.get(b) ?? 0, r.year_from));
  }

  // 2) Queue sets
  const queue = await pageAll<{ item_no: string; colour_id: number }>((f, t) =>
    sb.from('bl_pg_refresh_queue').select('item_no,colour_id').eq('item_type', 'S').range(f, t));

  // 3) Sets scraped in the last EXCLUDE_FRESH_HOURS (avoid redoing the 1k overlap)
  const cutoff = new Date(Date.now() - EXCLUDE_FRESH_HOURS * 3600 * 1000).toISOString();
  const fresh = await pageAll<{ item_no: string }>((f, t) =>
    sb.from('bricklink_price_guide_cache').select('item_no').eq('item_type', 'S').gt('updated_at', cutoff).range(f, t));
  const freshSet = new Set(fresh.map((r) => r.item_no));

  // Join + order newest-first
  const seen = new Set<string>();
  const rows = queue
    .map((q) => ({ itemNo: q.item_no, year: yearByBase.get(base(q.item_no)) ?? 0 }))
    .filter((r) => r.year >= MIN_YEAR && !freshSet.has(r.itemNo))
    .filter((r) => { if (seen.has(r.itemNo)) return false; seen.add(r.itemNo); return true; })
    .sort((a, b) => a.year - b.year || a.itemNo.localeCompare(b.itemNo));

  const tuples = rows.map((r) => ({ itemType: 'S', itemNo: r.itemNo, colourId: 0 }));
  const outPath = path.resolve(__dirname, '../../../../tmp/post2021-sets.json');
  fs.writeFileSync(outPath, JSON.stringify(tuples));

  const byYear: Record<string, number> = {};
  for (const r of rows) byYear[r.year] = (byYear[r.year] ?? 0) + 1;
  console.log(`[build-post2021] ${tuples.length} sets (>=${MIN_YEAR}, excluded ${freshSet.size} fresh in last ${EXCLUDE_FRESH_HOURS}h)`);
  console.log(`  by year: ${JSON.stringify(byYear)}`);
  console.log(`  wrote ${outPath}`);
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
