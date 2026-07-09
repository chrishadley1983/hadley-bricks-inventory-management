/**
 * Coverage-warm queue (unified-price-cache F6): populate the rich UK price_guide_cache for our
 * own inventory (and any tuple list) via ensurePriceGuide — 4 quadrants captured per tuple, then
 * cached 90d. Paced within BL API headroom. This is the standard "capture rich, never waste a
 * call" write path in action.
 *
 *   cd apps/web && npx tsx scripts/pg/warm-price-guide.ts --limit=200 --ttl-days=45 --delay-ms=300
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { BrickLinkClient } from '../../src/lib/bricklink/client';
import { ensurePriceGuide } from '../../src/lib/bricklink/price-guide/capture';
import { readPriceGuide, type PgType } from '../../src/lib/bricklink/price-guide/read';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
const argv = process.argv.slice(2).reduce<Record<string, string>>((a, x) => { const [k, v] = x.replace(/^--/, '').split('='); a[k] = v ?? 'true'; return a; }, {});
const LIMIT = parseInt(argv['limit'] ?? '200', 10);
const TTL = parseInt(argv['ttl-days'] ?? '45', 10);
const DELAY = parseInt(argv['delay-ms'] ?? '300', 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main() {
  const bl = new BrickLinkClient({
    consumerKey: process.env.BRICKLINK_CONSUMER_KEY!, consumerSecret: process.env.BRICKLINK_CONSUMER_SECRET!,
    tokenValue: process.env.BRICKLINK_TOKEN_VALUE!, tokenSecret: process.env.BRICKLINK_TOKEN_SECRET!,
  } as any, { supabase, caller: 'warm-price-guide' } as any);

  // Our inventory tuples (parts + minifigs), Bricqer colour scheme, prioritised by value.
  type Row = { item_number: string; color_id: number; item_type: string; bricqer_price: number };
  const inv: Row[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase.from('bricqer_inventory_snapshot')
      .select('item_number,color_id,item_type,bricqer_price')
      .gt('quantity', 0).order('bricqer_price', { ascending: false }).range(from, from + 999);
    if (error) throw error;
    inv.push(...(data as Row[]));
    if (!data || data.length < 1000) break; from += 1000;
  }
  // de-dupe by tuple, keep highest price first (already ordered)
  const seen = new Set<string>();
  const tuples = inv
    .map((r) => ({ itemType: (r.item_type.toUpperCase().startsWith('M') ? 'M' : 'P') as PgType, itemNo: r.item_number, colourId: r.color_id }))
    .filter((t) => { const k = `${t.itemType}:${t.itemNo}:${t.colourId}`; if (seen.has(k)) return false; seen.add(k); return true; });

  // Skip tuples already fresh in the UK cache
  const views = await readPriceGuide(supabase, tuples.map((t) => ({ ...t, scheme: 'bricqer' as const })), { ttlDays: TTL, allowWorldFallback: false });
  const todo = tuples.filter((t, i) => {
    const v = [...views.values()][i];
    return !(v && v.coverage === 'uk');
  }).slice(0, LIMIT);

  console.log(`Inventory tuples: ${tuples.length} | stale/missing UK: fetching ${todo.length} (ttl ${TTL}d, ${DELAY}ms/tuple = ${todo.length * 4} calls)`);
  let ok = 0, err = 0;
  for (const t of todo) {
    try {
      const v = await ensurePriceGuide(bl, supabase, { itemType: t.itemType, itemNo: t.itemNo, colourId: t.colourId }, { ttlDays: TTL, scheme: 'bricqer' });
      if (v.coverage === 'uk') ok++;
      if ((ok + err) % 25 === 0) console.log(`  ${ok + err}/${todo.length} (ok ${ok})`);
    } catch (e) { err++; console.error(`  ${t.itemType} ${t.itemNo}/${t.colourId}: ${(e as Error).message}`); }
    await sleep(DELAY);
  }
  console.log(`Done: warmed ${ok}, errors ${err}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
