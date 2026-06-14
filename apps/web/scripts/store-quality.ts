/**
 * Store Quality Scorecard (cached-only).
 *
 * Measures the quality of the BrickLink/Bricqer parts + minifig store from
 * cached data only — ZERO external BrickLink/Brick Owl/Bricqer API calls.
 * Prints a terminal scorecard with a composite score, the six sub-scores,
 * velocity/price/picking/coverage profiles, and per-lot action lists. Persists
 * each run to store_quality_runs and prints run-over-run deltas.
 *
 * Usage (from apps/web):
 *   npx tsx scripts/store-quality.ts
 *   npx tsx scripts/store-quality.ts --segment=parts --top=30 --window=180
 *   npx tsx scripts/store-quality.ts --json=tmp/store-quality.json --no-persist
 *
 * Flags:
 *   --segment=parts|minifigs|all   default all
 *   --top=<n>                      rows per action list (default 25)
 *   --window=<days>                realized-sales window (default 180)
 *   --max-age-days=<n>             snapshot staleness gate (default 30)
 *   --json=<path>                  also write the full result as JSON
 *   --no-persist                   skip writing a store_quality_runs row
 *   --user-id=<uuid>               Supabase user_id (default Chris)
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { computeStoreQuality, renderScorecard } from '../src/lib/store-quality';
import type { StoreQualityResult } from '../src/lib/store-quality';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const argv = process.argv.slice(2).reduce<Record<string, string>>((acc, a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  acc[k] = v ?? 'true';
  return acc;
}, {});

const SEGMENT = (argv['segment'] ?? 'all') as 'parts' | 'minifigs' | 'all';
const TOP = parseInt(argv['top'] ?? '25', 10);
const WINDOW = parseInt(argv['window'] ?? '180', 10);
const MAX_AGE = parseInt(argv['max-age-days'] ?? '30', 10);
const JSON_OUT = argv['json'] && argv['json'] !== 'true' ? argv['json'] : null;
const PERSIST = argv['no-persist'] !== 'true' && argv['persist'] !== 'false';
const USER_ID = argv['user-id'] ?? '4b6e94b4-661c-4462-9d14-b21df7d51e5b';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function persistRun(result: StoreQualityResult): Promise<void> {
  const s = result.summary;
  const row = {
    user_id: USER_ID,
    segment: result.segment,
    window_days: result.windowDays,
    snapshot_date: result.snapshotDate,
    snapshot_age_days: result.snapshotAgeDays,
    composite_score: result.compositeScore,
    velocity_score: s.velocity_score,
    picking_score: s.picking_score,
    margin_score: s.margin_score,
    ageing_score: s.ageing_score,
    coverage_score: s.coverage_score,
    freshness_score: s.freshness_score,
    total_lots: result.totals.lots,
    total_pieces: result.totals.pieces,
    total_value: result.totals.value,
    avg_value_per_lot: result.picking.avgValuePerLot,
    sub_floor_lot_share: s.sub_floor_lot_share,
    price_coverage: s.price_coverage,
    velocity_coverage: s.velocity_coverage,
    dead_overstock_value: s.dead_overstock_value,
    blind_high_value_count: s.blind_high_value_count,
    stuck_high_count: s.stuck_high_count,
    under_priced_count: s.under_priced_count,
    summary: s,
  };
  const { error } = await (supabase as any).from('store_quality_runs').insert(row);
  if (error) console.error(`  ! could not persist run: ${error.message}`);
}

async function previousRun(): Promise<any | null> {
  const { data } = await (supabase as any)
    .from('store_quality_runs')
    .select('created_at,composite_score,velocity_score,picking_score,margin_score,total_value,sub_floor_lot_share,velocity_coverage')
    .eq('user_id', USER_ID)
    .eq('segment', SEGMENT)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

function fmtDelta(curr: number, prev: number | null | undefined, digits = 1): string {
  if (prev === null || prev === undefined) return '';
  const d = curr - Number(prev);
  const sign = d > 0 ? '+' : '';
  return `  (${sign}${d.toFixed(digits)} vs last run)`;
}

async function main() {
  const prev = PERSIST ? await previousRun() : null;
  const result = await computeStoreQuality(supabase, {
    userId: USER_ID,
    segment: SEGMENT,
    windowDays: WINDOW,
    maxStaleDays: MAX_AGE,
  });

  console.log(renderScorecard(result, { top: TOP }));

  if (prev) {
    console.log('  RUN-OVER-RUN');
    console.log(
      `    Composite score   ${result.compositeScore.toFixed(1)}${fmtDelta(result.compositeScore, prev.composite_score)}`
    );
    console.log(
      `    Total value       £${result.totals.value.toFixed(2)}${fmtDelta(result.totals.value, prev.total_value, 2)}`
    );
    console.log(
      `    Velocity coverage ${(result.coverage.velocityCoverage * 100).toFixed(0)}%${fmtDelta(
        result.coverage.velocityCoverage * 100,
        prev.velocity_coverage ? Number(prev.velocity_coverage) * 100 : null,
        0
      )}`
    );
    console.log('');
  }

  if (JSON_OUT) {
    const abs = path.isAbsolute(JSON_OUT) ? JSON_OUT : path.resolve(process.cwd(), JSON_OUT);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(result, null, 2));
    console.log(`  JSON written to ${abs}`);
  }

  if (PERSIST) {
    await persistRun(result);
    console.log('  Run persisted to store_quality_runs.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
