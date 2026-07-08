/**
 * Lane C residual-fill SERVICE — queue-driven replacement for the 2026-07-07 POC
 * (`_tmp-curl-fill-uncovered.ts`, one-shot Jabbz-only script).
 *
 * Works `bl_pg_refresh_queue` rows via the anon-curl `priceGuideSummary.asp` lane:
 *   - default (gap-fill) mode: tuples in the queue with NO row yet in
 *     `bricklink_pg_summary_cache`.
 *   - `--due` mode: tail-tier tuples whose `next_due_at` has passed.
 *
 * `--inventory-file=<path to pg-scan-inventory.json>` enqueues the scan's tuples
 * into the queue first (replaces the old hardcoded Jabbz path), then the run
 * proceeds queue-driven as normal.
 *
 * Session discipline (spec §4.2/§4.4): sessions of up to 40 requests, 4-6s jitter,
 * then a breather. On 3 consecutive failures within a session, don't abort the
 * whole run — mark those tuples `last_error='challenge'`, release their locks, end
 * the session early (counts as "blocked"), take the breather, and resume next
 * session. Two consecutive blocked sessions stop the run cleanly (resumable next
 * invocation — the queue *is* the resume mechanism).
 *
 * Usage (from apps/web):
 *   npx tsx scripts/pg/pg-residual-fill.ts
 *   npx tsx scripts/pg/pg-residual-fill.ts --inventory-file="../../tmp/stores/Jabbz/pg-scan-inventory.json"
 *   npx tsx scripts/pg/pg-residual-fill.ts --due --max-sessions=3
 *
 * Flags:
 *   --inventory-file=<path>   Enqueue uncovered tuples from a store scan first (optional)
 *   --due                     Work due tail-tier refresh rows instead of gap-fill
 *   --session-max=<n>         Requests per session (default 40)
 *   --breather-mins=<n>       Minutes between sessions (default 15)
 *   --max-sessions=<n>        Sessions per run (default 6)
 *   --pool-size=<n>           Max queue rows considered as fill candidates (default 5000)
 */

import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

import { createClient } from '@supabase/supabase-js';
import {
  buildPgSummaryUrl,
  parsePgSummarySnippet,
  toSummaryCacheRow,
  validateCurrencyBasis,
  type PgSummaryCacheRow,
} from '../../src/lib/bricklink/pg-summary';
import type { PgItemType } from '../../src/lib/bricklink/price-guide-page';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2).reduce<Record<string, string>>((acc, a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  acc[k] = v ?? 'true';
  return acc;
}, {});

const INVENTORY_FILE = argv['inventory-file'] ? path.resolve(process.cwd(), argv['inventory-file']) : null;
const DUE_MODE = argv['due'] === 'true';
const SESSION_MAX = Math.max(1, Math.min(40, parseInt(argv['session-max'] ?? '40', 10)));
const BREATHER_MINS = Math.max(1, parseFloat(argv['breather-mins'] ?? '15'));
const MAX_SESSIONS = Math.max(1, parseInt(argv['max-sessions'] ?? '6', 10));
const POOL_SIZE = Math.max(SESSION_MAX, parseInt(argv['pool-size'] ?? '5000', 10));
const RUN_ID = `pg-residual-fill-${Date.now()}`;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (.env.local)');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

// ---------------------------------------------------------------------------
// Queue row shape (subset we read/write)
// ---------------------------------------------------------------------------

interface QueueRow {
  item_type: PgItemType;
  item_no: string;
  colour_id: number;
  tier: 'active' | 'tail';
  attempts: number;
}

function tupleKey(t: { item_type: string; item_no: string; colour_id: number }): string {
  return `${t.item_type}:${t.item_no}:${t.colour_id}`;
}

// ---------------------------------------------------------------------------
// Step 1: optional inventory-file enqueue
// ---------------------------------------------------------------------------

interface StoreLot {
  itemType: PgItemType;
  itemNo: string;
  colourId: number;
}

async function enqueueFromInventoryFile(): Promise<void> {
  if (!INVENTORY_FILE) return;
  if (!fs.existsSync(INVENTORY_FILE)) {
    console.error(`--inventory-file not found: ${INVENTORY_FILE}`);
    process.exit(1);
  }
  const lots = JSON.parse(fs.readFileSync(INVENTORY_FILE, 'utf8')) as StoreLot[];
  const seen = new Set<string>();
  const rows: Array<{ item_type: PgItemType; item_no: string; colour_id: number; tier: string; next_due_at: string }> = [];
  for (const l of lots) {
    const colour = l.itemType === 'P' ? l.colourId : 0;
    const key = `${l.itemType}:${l.itemNo}:${colour}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ item_type: l.itemType, item_no: l.itemNo, colour_id: colour, tier: 'tail', next_due_at: new Date().toISOString() });
  }
  console.log(`[enqueue] ${rows.length} unique tuples from ${path.basename(INVENTORY_FILE)}`);
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase
      .from('bl_pg_refresh_queue')
      .upsert(rows.slice(i, i + CHUNK), { onConflict: 'item_type,item_no,colour_id', ignoreDuplicates: true });
    if (error) throw new Error(`enqueue upsert failed: ${error.message}`);
  }
  console.log(`[enqueue] done (existing rows left untouched; ignoreDuplicates)`);
}

// ---------------------------------------------------------------------------
// Step 2: build the candidate pool (gap-fill or due mode)
// ---------------------------------------------------------------------------

async function fetchCoveredSet(itemNos: string[]): Promise<Set<string>> {
  const covered = new Set<string>();
  const CHUNK = 300;
  const PAGE = 1000;
  for (let i = 0; i < itemNos.length; i += CHUNK) {
    const chunk = itemNos.slice(i, i + CHUNK);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('bricklink_pg_summary_cache')
        .select('item_type,item_no,colour_id')
        .in('item_no', chunk)
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`covered-set read failed: ${error.message}`);
      for (const r of data ?? []) covered.add(tupleKey(r));
      if ((data ?? []).length < PAGE) break;
    }
  }
  return covered;
}

async function buildCandidatePool(): Promise<QueueRow[]> {
  const PAGE = 1000;
  const pool: QueueRow[] = [];
  if (DUE_MODE) {
    const nowIso = new Date().toISOString();
    for (let from = 0; pool.length < POOL_SIZE; from += PAGE) {
      const { data, error } = await supabase
        .from('bl_pg_refresh_queue')
        .select('item_type,item_no,colour_id,tier,attempts')
        .is('locked_by', null)
        .eq('tier', 'tail')
        .lt('next_due_at', nowIso)
        .order('next_due_at', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`due-pool read failed: ${error.message}`);
      const rows = (data ?? []) as QueueRow[];
      pool.push(...rows);
      if (rows.length < PAGE) break;
    }
    console.log(`[pool] due mode: ${pool.length} tail tuples past next_due_at`);
    return pool.slice(0, POOL_SIZE);
  }

  // Gap-fill mode: unlocked, never-refreshed queue rows (last_refreshed_at IS NULL —
  // seeded-from-cache rows are stamped at seed time, so this selects genuine gaps:
  // store-scan enqueues and catalog new releases). The coverage check below stays as
  // a second guard against tuples enqueued by paths that don't stamp.
  const candidates: QueueRow[] = [];
  for (let from = 0; candidates.length < POOL_SIZE; from += PAGE) {
    const { data, error } = await supabase
      .from('bl_pg_refresh_queue')
      .select('item_type,item_no,colour_id,tier,attempts')
      .is('locked_by', null)
      .is('last_refreshed_at', null)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`gap-pool read failed: ${error.message}`);
    const rows = (data ?? []) as QueueRow[];
    candidates.push(...rows);
    if (rows.length < PAGE) break;
  }
  console.log(`[pool] gap-fill mode: ${candidates.length} unlocked queue rows to check for coverage`);
  const itemNos = [...new Set(candidates.map((c) => c.item_no))];
  const covered = await fetchCoveredSet(itemNos);
  for (const c of candidates) {
    if (!covered.has(tupleKey(c))) pool.push(c);
    if (pool.length >= POOL_SIZE) break;
  }
  console.log(`[pool] ${pool.length} uncovered tuples to fill (of ${candidates.length} candidates)`);
  return pool;
}

// ---------------------------------------------------------------------------
// Step 3: claim / release helpers
// ---------------------------------------------------------------------------

/** PostgREST or()/filter values containing commas/parens need double-quoting — BL item
 * numbers are alnum+hyphen in practice, but quote defensively rather than assume. */
function quoteFilterValue(v: string): string {
  return `"${v.replace(/"/g, '\\"')}"`;
}

function orFilterForTuples(tuples: QueueRow[]): string {
  return tuples
    .map((t) => `and(item_type.eq.${t.item_type},item_no.eq.${quoteFilterValue(t.item_no)},colour_id.eq.${t.colour_id})`)
    .join(',');
}

async function claimTuples(tuples: QueueRow[]): Promise<void> {
  if (tuples.length === 0) return;
  const { error } = await supabase
    .from('bl_pg_refresh_queue')
    .update({ locked_by: RUN_ID, locked_at: new Date().toISOString() })
    .is('locked_by', null)
    .or(orFilterForTuples(tuples));
  if (error) throw new Error(`claim failed: ${error.message}`);
}

async function releaseTuples(tuples: QueueRow[]): Promise<void> {
  if (tuples.length === 0) return;
  const { error } = await supabase
    .from('bl_pg_refresh_queue')
    .update({ locked_by: null, locked_at: null })
    .or(orFilterForTuples(tuples));
  if (error) throw new Error(`release failed: ${error.message}`);
}

async function markFailure(t: QueueRow, reason: string): Promise<void> {
  const { error } = await supabase
    .from('bl_pg_refresh_queue')
    .update({ locked_by: null, locked_at: null, attempts: t.attempts + 1, last_error: reason, updated_at: new Date().toISOString() })
    .eq('item_type', t.item_type)
    .eq('item_no', t.item_no)
    .eq('colour_id', t.colour_id);
  if (error) console.error(`  ⚠ markFailure update failed for ${tupleKey(t)}: ${error.message}`);
}

async function markSuccess(t: QueueRow): Promise<void> {
  const now = new Date();
  const dueDays = t.tier === 'active' ? 28 : 90;
  const nextDue = new Date(now.getTime() + dueDays * 86400000).toISOString();
  const { error } = await supabase
    .from('bl_pg_refresh_queue')
    .update({
      locked_by: null,
      locked_at: null,
      last_refreshed_at: now.toISOString(),
      next_due_at: nextDue,
      attempts: 0,
      last_error: null,
      updated_at: now.toISOString(),
    })
    .eq('item_type', t.item_type)
    .eq('item_no', t.item_no)
    .eq('colour_id', t.colour_id);
  if (error) console.error(`  ⚠ markSuccess update failed for ${tupleKey(t)}: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Step 4: telemetry
// ---------------------------------------------------------------------------

interface SessionStats {
  sessionNo: number;
  requests: number;
  ok: number;
  failed: number;
  firstBlockAtRequest: number | null;
  startedAt: string;
  notes?: string;
}

async function writeTelemetry(s: SessionStats): Promise<void> {
  const { error } = await supabase.from('bl_pg_lane_telemetry').insert({
    lane: 'anon_curl',
    session_no: s.sessionNo,
    requests: s.requests,
    ok: s.ok,
    failed: s.failed,
    first_block_at_request: s.firstBlockAtRequest,
    started_at: s.startedAt,
    ended_at: new Date().toISOString(),
    notes: s.notes ?? null,
  });
  if (error) console.error(`  ⚠ telemetry insert failed: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Step 5: fetch + parse one tuple
// ---------------------------------------------------------------------------

type FetchOutcome = { kind: 'ok'; row: PgSummaryCacheRow } | { kind: 'empty' } | { kind: 'fail'; reason: string };

async function fetchOne(t: QueueRow): Promise<FetchOutcome> {
  const url = buildPgSummaryUrl(t.item_type, t.item_no, t.colour_id, Date.now());
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA } });
  } catch (e) {
    return { kind: 'fail', reason: `network: ${(e as Error).message}`.slice(0, 200) };
  }
  const html = await res.text();
  if (res.status !== 200) {
    return { kind: 'fail', reason: `HTTP ${res.status}` };
  }
  const quads = parsePgSummarySnippet(html);
  if (!quads) {
    if (html.length < 200) return { kind: 'empty' }; // genuine no-data shell, not a block
    return { kind: 'fail', reason: `unparseable response (len=${html.length})` };
  }
  const row = toSummaryCacheRow({ itemType: t.item_type, itemNo: t.item_no, colourId: t.colour_id }, quads, 'pg_summary', 'anon_curl');
  const validation = validateCurrencyBasis(row);
  if (!validation.ok) return { kind: 'fail', reason: `currency validation: ${validation.reason}` };
  return { kind: 'ok', row };
}

// ---------------------------------------------------------------------------
// Step 6: run one session
// ---------------------------------------------------------------------------

async function runSession(sessionNo: number, batch: QueueRow[]): Promise<{ blocked: boolean; processedCount: number }> {
  console.log(`\n=== Session ${sessionNo}/${MAX_SESSIONS}: ${batch.length} tuples ===`);
  await claimTuples(batch);

  const stats: SessionStats = { sessionNo, requests: 0, ok: 0, failed: 0, firstBlockAtRequest: null, startedAt: new Date().toISOString() };
  const pendingUpserts: PgSummaryCacheRow[] = [];
  const flush = async () => {
    if (pendingUpserts.length === 0) return;
    const { error } = await supabase
      .from('bricklink_pg_summary_cache')
      .upsert(pendingUpserts, { onConflict: 'item_type,item_no,colour_id' });
    if (error) console.error(`  ⚠ upsert failed: ${error.message}`);
    pendingUpserts.length = 0;
  };

  let consec = 0;
  const recentFails: QueueRow[] = [];
  let blocked = false;
  let processedCount = 0;

  for (let i = 0; i < batch.length; i++) {
    const t = batch[i];
    if (i > 0) await sleep(4000 + Math.random() * 2000);
    stats.requests++;
    const outcome = await fetchOne(t);
    processedCount++;

    if (outcome.kind === 'ok') {
      consec = 0;
      recentFails.length = 0;
      stats.ok++;
      pendingUpserts.push(outcome.row);
      await markSuccess(t);
      if (pendingUpserts.length >= 25) await flush();
    } else if (outcome.kind === 'empty') {
      consec = 0;
      recentFails.length = 0;
      stats.ok++;
      const emptyRow = toSummaryCacheRow(
        { itemType: t.item_type, itemNo: t.item_no, colourId: t.colour_id },
        { soldN: { lots: 0, qty: 0, min: null, avg: null, qavg: null, max: null }, soldU: { lots: 0, qty: 0, min: null, avg: null, qavg: null, max: null }, stockN: { lots: 0, qty: 0, min: null, avg: null, qavg: null, max: null }, stockU: { lots: 0, qty: 0, min: null, avg: null, qavg: null, max: null } },
        'pg_summary',
        'anon_curl',
      );
      pendingUpserts.push(emptyRow);
      await markSuccess(t);
      if (pendingUpserts.length >= 25) await flush();
    } else {
      consec++;
      stats.failed++;
      recentFails.push(t);
      await markFailure(t, outcome.reason);
      if (stats.firstBlockAtRequest == null && consec === 1) {
        // Track the request number of the *first* failure this session — the
        // sessions-to-first-403 signal §4.4 wants, even when it doesn't escalate
        // to a full 3-in-a-row challenge.
        stats.firstBlockAtRequest = stats.requests;
      }
      if (consec >= 3) {
        console.warn(`  ⚠ 3 consecutive failures at request ${stats.requests} — treating as a challenge, ending session early.`);
        for (const f of recentFails.slice(-3)) {
          const { error } = await supabase
            .from('bl_pg_refresh_queue')
            .update({ locked_by: null, locked_at: null, last_error: 'challenge', updated_at: new Date().toISOString() })
            .eq('item_type', f.item_type)
            .eq('item_no', f.item_no)
            .eq('colour_id', f.colour_id);
          if (error) console.error(`  ⚠ challenge mark failed for ${tupleKey(f)}: ${error.message}`);
        }
        blocked = true;
        // Release any remaining claimed-but-unattempted tuples in this batch so
        // they're free for the next session/run.
        const remaining = batch.slice(i + 1);
        await releaseTuples(remaining);
        break;
      }
    }

    if (stats.requests % 25 === 0) {
      console.log(`  ${stats.requests}/${batch.length} (ok=${stats.ok} failed=${stats.failed})`);
    }
  }

  await flush();
  stats.notes = blocked ? 'ended early: 3 consecutive failures (challenge)' : 'completed';
  await writeTelemetry(stats);
  console.log(`  session ${sessionNo} done: ok=${stats.ok} failed=${stats.failed} requests=${stats.requests}${blocked ? ' — BLOCKED' : ''}`);
  return { blocked, processedCount };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await enqueueFromInventoryFile();

  const pool = await buildCandidatePool();
  if (pool.length === 0) {
    console.log('\nNothing to do — queue is clear for this mode.');
    return;
  }

  let cursor = 0;
  let consecutiveBlockedSessions = 0;
  for (let sessionNo = 1; sessionNo <= MAX_SESSIONS; sessionNo++) {
    if (cursor >= pool.length) {
      console.log('\nPool exhausted — nothing left to fill this run.');
      break;
    }
    const batch = pool.slice(cursor, cursor + SESSION_MAX);
    const { blocked, processedCount } = await runSession(sessionNo, batch);
    cursor += processedCount;
    // Any tuples in this batch beyond processedCount were released, not consumed —
    // re-offer them by NOT advancing the cursor past them. Since batch is a
    // contiguous slice and we only break early (releasing the tail), processedCount
    // already reflects exactly how many were attempted; the rest stay unlocked in
    // the queue for the next run/session to pick up naturally (gap-fill/due mode
    // will re-select them since they were never marked refreshed).
    cursor = Math.min(cursor, pool.length);

    consecutiveBlockedSessions = blocked ? consecutiveBlockedSessions + 1 : 0;
    if (consecutiveBlockedSessions >= 2) {
      console.warn('\nTwo consecutive sessions ended blocked — stopping the run cleanly. Resume later; the queue holds state.');
      break;
    }
    if (sessionNo < MAX_SESSIONS && cursor < pool.length) {
      console.log(`\nBreather: ${BREATHER_MINS} min...`);
      await sleep(BREATHER_MINS * 60000);
    }
  }
  console.log('\nRun complete.');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
