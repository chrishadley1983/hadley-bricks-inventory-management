/**
 * One-time cleanup: delete `bricklink_part_price_cache` rows that are most
 * likely EnrichmentService pollution from the colour-id-as-Bricqer-id bug.
 *
 * THE NAIVE HEURISTIC `colour_name IS NULL` IS UNSAFE — bl-basket.ts,
 * find-piece.ts, and others also omit colour_name. ~94% of the cache has
 * null colour_name and most of it is legitimate.
 *
 * Refined heuristic — a row is a likely-EnrichmentService bad row iff ALL of:
 *   1. colour_name IS NULL
 *   2. part_type = 'PART'
 *   3. price_new IS NULL AND price_used IS NULL (no recorded sold price)
 *   4. (stock_available_new IS NULL OR stock_available_new = 0)
 *      AND (stock_available_used IS NULL OR stock_available_used = 0)
 *   5. (times_sold_new IS NULL OR times_sold_new = 0)
 *      AND (times_sold_used IS NULL OR times_sold_used = 0)
 *
 * In plain English: a placeholder row with no price, no stock, no sold count.
 * That's the exact signature EnrichmentService produced when BL returned
 * empty data for a Bricqer-id-as-BL-id query (which was most of them).
 *
 * Risks of this heuristic:
 *   - Some legit "BL has no UK data for this tuple" cache misses match this
 *     pattern. Worst case: those get re-fetched on demand next time they're
 *     looked up, re-cache as same zeros. No data loss, just one extra BL
 *     call per affected tuple.
 *   - Some EnrichmentService rows where BL accidentally returned data for a
 *     different colour at the Bricqer id WILL NOT match (they have non-zero
 *     values). Those will need manual cleanup or natural drift. The wider
 *     cache continues to function — find-piece and bl-basket query by BL
 *     color_id directly, so mis-keyed rows are inert clutter, not active
 *     pollution.
 *
 * Default mode is --dry-run: prints counts + a sample. Pass --apply to delete.
 *
 * Usage:
 *   npx tsx scripts/cleanup-bad-cache-rows.ts            # dry-run
 *   npx tsx scripts/cleanup-bad-cache-rows.ts --apply    # actually delete
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';

const APPLY = process.argv.includes('--apply');

const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/** Refined predicate: zero-value placeholders with null colour_name + part_type=PART. */
function applyZeroPlaceholderFilter<T>(q: T): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder = q as any;
  return builder
    .is('colour_name', null)
    .eq('part_type', 'PART')
    .or('price_new.is.null,price_new.eq.0')
    .or('price_used.is.null,price_used.eq.0')
    .or('stock_available_new.is.null,stock_available_new.eq.0')
    .or('stock_available_used.is.null,stock_available_used.eq.0')
    .or('times_sold_new.is.null,times_sold_new.eq.0')
    .or('times_sold_used.is.null,times_sold_used.eq.0');
}

async function main() {
  console.log('\n=== bricklink_part_price_cache cleanup (zero-placeholder pollution) ===');
  console.log(`Mode: ${APPLY ? '🔴 APPLY (will delete)' : '🟢 dry-run (no changes)'}`);

  const { count: totalRows } = await supabase
    .from('bricklink_part_price_cache')
    .select('*', { count: 'exact', head: true });
  console.log(`\nTotal cache rows: ${totalRows ?? 0}`);

  // Naive (unsafe) count — for reference / informational only
  const { count: naiveBad } = await supabase
    .from('bricklink_part_price_cache')
    .select('*', { count: 'exact', head: true })
    .is('colour_name', null);
  console.log(`Rows with colour_name IS NULL (NOT used as cleanup target — many writers omit colour_name): ${naiveBad ?? 0}`);

  // Refined count — what we'd actually delete
  const { count: refinedBad } = await applyZeroPlaceholderFilter(
    supabase.from('bricklink_part_price_cache').select('*', { count: 'exact', head: true }),
  );
  console.log(`Rows matching zero-placeholder pollution signature: ${refinedBad ?? 0}`);

  if (!refinedBad || refinedBad === 0) {
    console.log('\n✅ Nothing matches the cleanup signature. Exiting.');
    return;
  }

  // Sample
  const { data: sample } = await applyZeroPlaceholderFilter(
    supabase
      .from('bricklink_part_price_cache')
      .select(
        'part_number, part_type, colour_id, price_new, price_used, stock_available_new, stock_available_used, times_sold_new, times_sold_used, fetched_at',
      ),
  )
    .order('fetched_at', { ascending: false })
    .limit(10);
  console.log(`\nSample (newest 10 of ${refinedBad}):`);
  console.log(
    `  ${'part_number'.padEnd(15)} ${'colour'.padEnd(6)} ${'p_new'.padStart(5)} ${'p_use'.padStart(5)} ${'sN'.padStart(3)} ${'sU'.padStart(3)} ${'tN'.padStart(3)} ${'tU'.padStart(3)}  fetched`,
  );
  for (const r of sample ?? []) {
    console.log(
      `  ${(r.part_number ?? '').padEnd(15)} ${String(r.colour_id).padStart(6)} ${String(r.price_new ?? '-').padStart(5)} ${String(r.price_used ?? '-').padStart(5)} ${String(r.stock_available_new ?? '-').padStart(3)} ${String(r.stock_available_used ?? '-').padStart(3)} ${String(r.times_sold_new ?? '-').padStart(3)} ${String(r.times_sold_used ?? '-').padStart(3)}  ${r.fetched_at?.slice(0, 16) ?? ''}`,
    );
  }

  if (!APPLY) {
    console.log(`\n🟢 dry-run — no rows deleted.`);
    console.log(`   Re-run with --apply to delete ${refinedBad} rows.`);
    console.log(`   Note: bl-basket / find-piece will recache any tuple they need next time it's queried.`);
    return;
  }

  console.log(`\n🔴 Deleting ${refinedBad} rows…`);
  const { error, count } = await applyZeroPlaceholderFilter(
    supabase.from('bricklink_part_price_cache').delete({ count: 'exact' }),
  );
  if (error) {
    console.error('Delete failed:', error);
    process.exit(1);
  }
  console.log(`✅ Deleted ${count ?? 0} rows.`);

  const { count: after } = await supabase
    .from('bricklink_part_price_cache')
    .select('*', { count: 'exact', head: true });
  console.log(`Cache size after cleanup: ${after ?? 0}`);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
