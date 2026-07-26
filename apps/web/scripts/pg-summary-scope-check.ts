/**
 * PG summary-cache scope check.
 *
 * `bricklink_pg_summary_cache.stock_*` changed scope mid-July 2026: rows fetched before
 * ~2026-07-12 hold UK-scoped stock, later rows hold worldwide. That made the "world lots"
 * column mean two different things depending on when each row was last scraped — it is
 * what made njo0674 look like it had 2 sellers worldwide when 2 was the UK count.
 *
 * No migration was written for it because the rows drain on the normal 60-day refresh
 * cycle (ACTIVE_CYCLE_DAYS) at roughly 7k/day. This script is the check that they did.
 *
 * Nothing gates on the affected column any more — both the Set Lookup part-out and the
 * store assessment moved their magnet test to UK stock quantity from
 * bricklink_price_guide_cache — so a non-zero count here is a data-quality issue for
 * DISPLAY, not a wrong decision.
 *
 * Usage (from apps/web):
 *   npx tsx scripts/pg-summary-scope-check.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

/** Rows fetched before this hold UK-scoped stock in a column labelled worldwide. */
const CUTOVER = '2026-07-12';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const { count: total, error: totalErr } = await supabase
    .from('bricklink_pg_summary_cache')
    .select('*', { count: 'exact', head: true });
  if (totalErr) throw new Error(totalErr.message);

  const { count: stale, error: staleErr } = await supabase
    .from('bricklink_pg_summary_cache')
    .select('*', { count: 'exact', head: true })
    .lt('fetched_at', CUTOVER);
  if (staleErr) throw new Error(staleErr.message);

  const pct = total ? ((100 * (stale ?? 0)) / total).toFixed(1) : '0';
  console.log(`bricklink_pg_summary_cache: ${total} rows`);
  console.log(`  fetched before ${CUTOVER}: ${stale} (${pct}%)`);

  if ((stale ?? 0) === 0) {
    console.log('\nDRAINED. Every row now carries worldwide-scoped stock. Nothing to do —');
    console.log('this check can be retired along with the note in the open-items doc.');
    return;
  }

  // Are they actually moving, or has the refresh cycle stalled?
  const since = new Date(Date.now() - 3 * 86400000).toISOString();
  const { count: recent } = await supabase
    .from('bricklink_pg_summary_cache')
    .select('*', { count: 'exact', head: true })
    .gte('fetched_at', since);
  const perDay = Math.round((recent ?? 0) / 3);
  console.log(`  refreshed in the last 3 days: ${recent} (~${perDay}/day)`);

  if (perDay === 0) {
    console.log('\nSTALLED — nothing refreshed in 3 days. Check HadleyBricks-PG-Refresh-Cycle.');
  } else {
    const days = Math.ceil((stale ?? 0) / perDay);
    console.log(`\nStill draining: ~${days} more day(s) at the current rate.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
