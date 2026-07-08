/**
 * PG Market Intelligence — monthly ranking-cut recompute (spec §4.1, done-criteria F3).
 *
 * Recomputes `bl_pg_refresh_queue.rank_score` for every tuple from the worldwide L1
 * summary (`bricklink_pg_summary_cache`), then assigns `tier`:
 *   - 'active' for the top `--active-size` tuples by rank_score, PLUS any tuple whose
 *     floor overrides rank (grace_until > now — new-release rule; or an existing
 *     rank_floor value such as 'watchlist'/'own_inventory' set by other tooling).
 *   - 'tail' for everything else.
 *
 * rank_score formula (spec §4.1, GBP):
 *   (sold6m_new_qty * COALESCE(sold6m_new_qavg, sold6m_new_avg, 0))
 *   + (sold6m_used_qty * COALESCE(sold6m_used_qavg, sold6m_used_avg, 0))
 *   ... multiplied by fx_rate when currency != 'GBP'.
 *
 * On a tier flip:
 *   - tail -> active: next_due_at is spread randomly across the next 28 days (avoids a
 *     thundering herd of newly-active tuples all becoming due on the same night).
 *   - active -> tail: next_due_at is left untouched ("newly-tail: keep").
 *
 * DEVIATION FROM SPEC: §4.1 suggests "one UPDATE ... FROM over a ranked CTE ... via a
 * single RPC-less update statement executed through supabase". There is no exec_sql/RPC
 * function available to this script without a migration (out of this build's file scope —
 * see done-criteria F1, owned by the schema task), so this computes rank_score in Node and
 * writes it back via paginated, batched upserts instead. Functionally equivalent; the
 * pagination discipline this file scope already requires (1,000-row Supabase cap) does the
 * same job a batched SQL statement would.
 *
 * Usage (from apps/web):
 *   npx tsx scripts/pg/pg-rank.ts
 *
 * Flags:
 *   --active-size=<n>   Top-N by rank_score kept 'active' (default 60000)
 *   --dry-run           Compute and log, but do not write any updates
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

const argv = process.argv.slice(2).reduce<Record<string, string>>((acc, a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  acc[k] = v ?? 'true';
  return acc;
}, {});

const ACTIVE_SIZE = parseInt(argv['active-size'] ?? '60000', 10);
const DRY_RUN = argv['dry-run'] === 'true';
const PAGE = 1000;
const WRITE_CHUNK = 500;
const NEW_RELEASE_SPREAD_MS = 28 * 24 * 60 * 60 * 1000;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('[pg-rank] Missing Supabase env (.env.local)');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

// ---------------------------------------------------------------------------

interface QueueRow {
  item_type: string;
  item_no: string;
  colour_id: number;
  tier: 'active' | 'tail';
  grace_until: string | null;
  rank_floor: string | null;
  next_due_at: string;
}

function tupleKey(t: { item_type: string; item_no: string; colour_id: number }): string {
  return `${t.item_type}:${t.item_no}:${t.colour_id}`;
}

/** Page through L1 and compute rank_score per tuple. Returns key -> score. */
async function loadL1Scores(sb: SupabaseClient): Promise<{ scores: Map<string, number>; unconverted: number }> {
  const scores = new Map<string, number>();
  let unconverted = 0;
  for (let page = 0; ; page++) {
    const { data, error } = await sb
      .from('bricklink_pg_summary_cache')
      .select(
        'item_type,item_no,colour_id,currency,fx_rate,sold6m_new_qty,sold6m_new_qavg,sold6m_new_avg,sold6m_used_qty,sold6m_used_qavg,sold6m_used_avg',
      )
      // Stable ordering: unordered OFFSET pagination over a concurrently-written
      // table can skip/duplicate rows (lane D writes here nightly; review finding #2).
      .order('id', { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(`L1 read failed: ${error.message}`);
    const rows = data ?? [];
    for (const r of rows) {
      const newPrice = r.sold6m_new_qavg ?? r.sold6m_new_avg ?? 0;
      const usedPrice = r.sold6m_used_qavg ?? r.sold6m_used_avg ?? 0;
      let raw = (r.sold6m_new_qty ?? 0) * newPrice + (r.sold6m_used_qty ?? 0) * usedPrice;
      if (r.currency && r.currency !== 'GBP') {
        if (r.fx_rate != null) {
          raw *= r.fx_rate;
        } else {
          unconverted += 1; // data-quality gap: non-GBP row with no fx_rate stamped at ingest
        }
      }
      scores.set(tupleKey(r), raw);
    }
    if (rows.length < PAGE) break;
  }
  return { scores, unconverted };
}

async function flushQueueUpdates(sb: SupabaseClient, batch: Record<string, unknown>[]): Promise<void> {
  if (batch.length === 0) return;
  for (let i = 0; i < batch.length; i += WRITE_CHUNK) {
    const { error } = await sb
      .from('bl_pg_refresh_queue')
      .upsert(batch.slice(i, i + WRITE_CHUNK), { onConflict: 'item_type,item_no,colour_id' });
    if (error) throw new Error(`queue upsert failed: ${error.message}`);
  }
}

interface Mover {
  key: string;
  score: number;
}

async function main(): Promise<void> {
  console.log(`[pg-rank] starting — active-size=${ACTIVE_SIZE}${DRY_RUN ? ' (dry-run)' : ''}`);

  const { scores, unconverted } = await loadL1Scores(supabase);
  console.log(`[pg-rank] loaded ${scores.size} L1 row(s)` + (unconverted > 0 ? ` (${unconverted} non-GBP row(s) missing fx_rate — treated as unconverted/0-weighted risk, not scored with a guessed rate)` : ''));

  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const topSet = new Set(sorted.slice(0, ACTIVE_SIZE).map(([k]) => k));
  const cutoffScore = sorted.length > 0 ? (sorted[Math.min(ACTIVE_SIZE, sorted.length) - 1]?.[1] ?? 0) : 0;
  console.log(`[pg-rank] rank cutoff at position ${ACTIVE_SIZE}: score=${cutoffScore.toFixed(2)} GBP`);

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const counts = { activeBefore: 0, tailBefore: 0, activeAfter: 0, tailAfter: 0, changed: 0 };
  const newlyActive: Mover[] = [];
  const newlyTail: Mover[] = [];
  let writeBatch: Record<string, unknown>[] = [];

  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from('bl_pg_refresh_queue')
      .select('item_type,item_no,colour_id,tier,grace_until,rank_floor,next_due_at')
      // Stable ordering by composite PK — same rationale as the L1 read above.
      .order('item_type', { ascending: true })
      .order('item_no', { ascending: true })
      .order('colour_id', { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(`queue read failed: ${error.message}`);
    const rows = (data ?? []) as QueueRow[];
    if (rows.length === 0) break;

    for (const row of rows) {
      const key = tupleKey(row);
      const score = scores.get(key) ?? 0;
      const graceActive = !!row.grace_until && new Date(row.grace_until).getTime() > nowMs;
      const floorActive = graceActive || !!row.rank_floor;
      const rankActive = topSet.has(key);
      const newTier: 'active' | 'tail' = floorActive || rankActive ? 'active' : 'tail';
      const oldTier = row.tier;

      if (oldTier === 'active') counts.activeBefore += 1;
      else counts.tailBefore += 1;
      if (newTier === 'active') counts.activeAfter += 1;
      else counts.tailAfter += 1;

      const update: Record<string, unknown> = {
        item_type: row.item_type,
        item_no: row.item_no,
        colour_id: row.colour_id,
        rank_score: score,
        updated_at: nowIso,
      };
      if (newTier !== oldTier) {
        counts.changed += 1;
        update.tier = newTier;
        if (newTier === 'active') {
          update.next_due_at = new Date(nowMs + Math.floor(Math.random() * NEW_RELEASE_SPREAD_MS)).toISOString();
          newlyActive.push({ key, score });
        } else {
          // newly-tail: keep next_due_at as-is (omit from the update payload)
          newlyTail.push({ key, score });
        }
      }
      writeBatch.push(update);
      if (writeBatch.length >= WRITE_CHUNK) {
        if (!DRY_RUN) await flushQueueUpdates(supabase, writeBatch);
        writeBatch = [];
      }
    }
    if (rows.length < PAGE) break;
  }
  if (writeBatch.length > 0 && !DRY_RUN) await flushQueueUpdates(supabase, writeBatch);

  console.log(`[pg-rank] tiers before: active=${counts.activeBefore} tail=${counts.tailBefore}`);
  console.log(`[pg-rank] tiers after:  active=${counts.activeAfter} tail=${counts.tailAfter} (${counts.changed} tuple(s) flipped tier)`);

  const topNewlyActive = newlyActive.sort((a, b) => b.score - a.score).slice(0, 10);
  const topNewlyTail = newlyTail.sort((a, b) => b.score - a.score).slice(0, 10);
  console.log(`[pg-rank] top ${topNewlyActive.length} newly-active mover(s):`);
  for (const m of topNewlyActive) console.log(`  + ${m.key}  score=${m.score.toFixed(2)}`);
  console.log(`[pg-rank] top ${topNewlyTail.length} newly-tail mover(s) (highest score among those dropped):`);
  for (const m of topNewlyTail) console.log(`  - ${m.key}  score=${m.score.toFixed(2)}`);

  if (DRY_RUN) console.log('[pg-rank] dry-run — no writes performed');
  console.log('[pg-rank] done');
}

main().catch((e) => {
  console.error('[pg-rank] fatal:', e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});
