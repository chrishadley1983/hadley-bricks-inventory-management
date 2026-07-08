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
 * whole run — attempt lane-A rotation for the challenged tuples (resolve them via
 * the authenticated BL REST client instead, budget-gated + capped per run; falls
 * back to marking `last_error='challenge'` when rotation is disabled, credentials
 * are missing, the run's rotation cap is hit, or BL's own daily budget trips),
 * release locks, end the session early (counts as "blocked"), take the breather,
 * and resume next session. Two consecutive blocked sessions stop the run cleanly
 * (resumable next invocation — the queue *is* the resume mechanism).
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
 *   --api-rotate-max=<n>      Cap on lane-A (BL REST) rotations per run (default 50)
 *   --no-api-rotate           Disable lane-A rotation — restores plain mark-challenge behaviour
 */

import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

import { createClient } from '@supabase/supabase-js';
import {
  buildPgSummaryUrl,
  parsePgSummarySnippet,
  resolvePgItemId,
  toSummaryCacheRow,
  validateCurrencyBasis,
  type PgSummaryCacheRow,
  type PgSummaryQuad,
  type PgSummaryQuads,
} from '../../src/lib/bricklink/pg-summary';
import type { PgItemType } from '../../src/lib/bricklink/price-guide-page';
import { createScriptBlContext, type ScriptBlContext } from '../_bl-client';
import { RateLimitError } from '../../src/lib/bricklink/client';
import type { BrickLinkItemType, BrickLinkPriceGuide } from '../../src/lib/bricklink/types';

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
// Cap raised 40 → 400 (2026-07-08): the old clamp was a relic of the disproven
// "challenged at ~43 requests" theory (that was a parser gap, PR #521 — lane C has
// never actually been blocked). 400 mirrors lane D's observed per-session order of
// magnitude. RAMP PROCEDURE: raise --session-max stepwise (40 → 80 → 160 → 320)
// across successive nights, watching bl_pg_lane_telemetry.first_block_at_request
// for lane='anon_curl' — any block signal, halve and hold. Default stays 40.
const SESSION_MAX = Math.max(1, Math.min(400, parseInt(argv['session-max'] ?? '40', 10)));
const BREATHER_MINS = Math.max(1, parseFloat(argv['breather-mins'] ?? '15'));
// Default 8: a Jabbz-class residual set (~250 tuples) fits one default run
// (8 x 40 = 320) — 6 x 40 = 240 fell 4 short of the 244 acceptance case.
const MAX_SESSIONS = Math.max(1, parseInt(argv['max-sessions'] ?? '8', 10));
const POOL_SIZE = Math.max(SESSION_MAX, parseInt(argv['pool-size'] ?? '5000', 10));
const API_ROTATE = argv['no-api-rotate'] !== 'true';
const API_ROTATE_MAX = Math.max(0, parseInt(argv['api-rotate-max'] ?? '50', 10));
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
  const tuples: Array<{ item_type: PgItemType; item_no: string; colour_id: number }> = [];
  for (const l of lots) {
    const colour = l.itemType === 'P' ? l.colourId : 0;
    const key = `${l.itemType}:${l.itemNo}:${colour}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tuples.push({ item_type: l.itemType, item_no: l.itemNo, colour_id: colour });
  }
  // Already-covered tuples get last_refreshed_at stamped at enqueue time (same
  // contract as pg-universe --seed-from-cache) — otherwise thousands of covered
  // rows sit NULL in the gap window, starving genuinely-uncovered tuples past
  // --pool-size and looking instantly "due" to --due mode (E2E validation finding).
  const covered = await fetchCoveredSet([...new Set(tuples.map((t) => t.item_no))]);
  const nowIso = new Date().toISOString();
  const spreadDue = () => new Date(Date.now() + Math.random() * 90 * 86400000).toISOString();
  const rows = tuples.map((t) => {
    const isCovered = covered.has(tupleKey(t));
    return {
      ...t,
      tier: 'tail',
      last_refreshed_at: isCovered ? nowIso : null,
      next_due_at: isCovered ? spreadDue() : nowIso,
    };
  });
  const uncoveredCount = rows.filter((r) => r.last_refreshed_at === null).length;
  console.log(
    `[enqueue] ${rows.length} unique tuples from ${path.basename(INVENTORY_FILE)} (${uncoveredCount} uncovered, ${rows.length - uncoveredCount} covered/stamped)`,
  );
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
      // Backstop against permanent-retry starvation: tuples that failed 8+ times
      // across runs (incl. lane-A attempts) are parked until an operator
      // investigates — visible via last_error, not silently retried forever.
      .lt('attempts', 8)
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

/**
 * Claim tuples by locking them to this run. Returns only the rows the update
 * actually touched (locked_by IS NULL at update time) — callers must NOT assume
 * the full `tuples` argument was claimed, since a concurrent run may have
 * grabbed some of them first. Use the returned rows as the working set so we
 * never fetch/mark-success/mark-failure/release a tuple we don't hold the lock
 * on (that would silently steal or clear another run's lock).
 */
async function claimTuples(tuples: QueueRow[]): Promise<QueueRow[]> {
  if (tuples.length === 0) return [];
  const { data, error } = await supabase
    .from('bl_pg_refresh_queue')
    .update({ locked_by: RUN_ID, locked_at: new Date().toISOString() })
    .is('locked_by', null)
    .or(orFilterForTuples(tuples))
    .select('item_type,item_no,colour_id,tier,attempts');
  if (error) throw new Error(`claim failed: ${error.message}`);
  return (data ?? []) as QueueRow[];
}

async function releaseTuples(tuples: QueueRow[]): Promise<void> {
  if (tuples.length === 0) return;
  const { error } = await supabase
    .from('bl_pg_refresh_queue')
    .update({ locked_by: null, locked_at: null })
    // Scoped to our own lock: past the 8h stale window another run may have
    // legitimately reclaimed these rows — never clobber its lock (validation finding).
    .eq('locked_by', RUN_ID)
    .or(orFilterForTuples(tuples));
  if (error) throw new Error(`release failed: ${error.message}`);
}

async function markFailure(t: QueueRow, reason: string): Promise<void> {
  const { error } = await supabase
    .from('bl_pg_refresh_queue')
    .update({ locked_by: null, locked_at: null, attempts: t.attempts + 1, last_error: reason, updated_at: new Date().toISOString() })
    .eq('locked_by', RUN_ID)
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
    .eq('locked_by', RUN_ID)
    .eq('item_type', t.item_type)
    .eq('item_no', t.item_no)
    .eq('colour_id', t.colour_id);
  if (error) console.error(`  ⚠ markSuccess update failed for ${tupleKey(t)}: ${error.message}`);
}

/** Mark a challenged tuple unreachable this run (releases its lock). This is the
 * pre-lane-A fallback behaviour, and stays the terminal outcome for any tuple
 * lane-A can't/won't resolve (rotation disabled, no creds, cap hit, budget gate). */
async function markChallenge(t: QueueRow): Promise<void> {
  const { error } = await supabase
    .from('bl_pg_refresh_queue')
    .update({ locked_by: null, locked_at: null, last_error: 'challenge', updated_at: new Date().toISOString() })
    .eq('locked_by', RUN_ID)
    .eq('item_type', t.item_type)
    .eq('item_no', t.item_no)
    .eq('colour_id', t.colour_id);
  if (error) console.error(`  ⚠ challenge mark failed for ${tupleKey(t)}: ${error.message}`);
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
// Step 5b: lane-A rotation on challenge (Finding 4 / done-criteria F2)
//
// When a session hits 3 consecutive anon-curl failures, resolve the challenged
// tuples via the authenticated BL REST client (`createScriptBlContext`) instead
// of just marking them unreachable. Budget-gated (BrickLinkClient's own daily
// counter) and capped per run (`--api-rotate-max`, default 50). Falls back to
// the plain mark-challenge behaviour when: rotation is disabled
// (`--no-api-rotate`), BL credentials are missing, the run's rotation cap is
// hit, or BL's daily budget gate trips (RateLimitError — stop immediately,
// since it will keep failing until UTC midnight).
// ---------------------------------------------------------------------------

const PG_TO_BL_TYPE: Record<PgItemType, BrickLinkItemType> = { P: 'PART', M: 'MINIFIG', S: 'SET' };

/** Lazily created ONCE per run (undefined = not yet attempted, null = creation failed). */
let blContext: ScriptBlContext | null | undefined;
let blContextWarned = false;

function getLaneABlContext(): ScriptBlContext | null {
  if (blContext !== undefined) return blContext;
  try {
    blContext = createScriptBlContext('pg-residual-fill');
  } catch (e) {
    if (!blContextWarned) {
      console.warn(`  [lane-A] BrickLink credentials unavailable — rotation disabled this run: ${(e as Error).message}`);
      blContextWarned = true;
    }
    blContext = null;
  }
  return blContext;
}

let laneARotations = 0;
const laneATelemetry: { requests: number; ok: number; failed: number; attempted: boolean; startedAt: string | null } = {
  requests: 0,
  ok: 0,
  failed: 0,
  attempted: false,
  startedAt: null,
};

function guardedNum(v: string): number | null {
  const n = parseFloat(v);
  return Number.isNaN(n) ? null : n;
}

function guideToQuad(g: BrickLinkPriceGuide): PgSummaryQuad {
  return {
    lots: g.unit_quantity ?? 0,
    qty: g.total_quantity ?? 0,
    min: guardedNum(g.min_price),
    avg: guardedNum(g.avg_price),
    qavg: guardedNum(g.qty_avg_price),
    max: guardedNum(g.max_price),
  };
}

/** 4 calls per tuple (sold N/U, stock N/U), 1.1s spacing between every call. */
async function fetchLaneAQuads(ctx: ScriptBlContext, t: QueueRow): Promise<PgSummaryQuads> {
  const blType = PG_TO_BL_TYPE[t.item_type];
  const itemNo = resolvePgItemId(t.item_type, t.item_no);
  const fetchQuad = async (condition: 'N' | 'U', guideType: 'sold' | 'stock'): Promise<PgSummaryQuad> => {
    await sleep(1100);
    laneATelemetry.requests++;
    const g = await ctx.bl.getPartPriceGuide(blType, itemNo, t.colour_id, { currencyCode: 'GBP', guideType, condition });
    return guideToQuad(g);
  };
  const soldN = await fetchQuad('N', 'sold');
  const soldU = await fetchQuad('U', 'sold');
  const stockN = await fetchQuad('N', 'stock');
  const stockU = await fetchQuad('U', 'stock');
  return { soldN, soldU, stockN, stockU };
}

async function rotateToLaneA(tuples: QueueRow[]): Promise<void> {
  if (tuples.length === 0) return;
  if (!API_ROTATE) {
    for (const t of tuples) await markChallenge(t);
    return;
  }
  const ctx = getLaneABlContext();
  if (!ctx) {
    for (const t of tuples) await markChallenge(t);
    return;
  }

  for (let i = 0; i < tuples.length; i++) {
    const t = tuples[i];
    if (laneARotations >= API_ROTATE_MAX) {
      console.warn(`  [lane-A] rotation cap (${API_ROTATE_MAX}) reached this run — marking remaining challenged tuples instead.`);
      for (const rest of tuples.slice(i)) await markChallenge(rest);
      return;
    }
    if (!laneATelemetry.attempted) {
      laneATelemetry.attempted = true;
      laneATelemetry.startedAt = new Date().toISOString();
    }
    try {
      const quads = await fetchLaneAQuads(ctx, t);
      const row = toSummaryCacheRow({ itemType: t.item_type, itemNo: t.item_no, colourId: t.colour_id }, quads, 'store_api', 'store_api');
      const validation = validateCurrencyBasis(row);
      if (!validation.ok) throw new Error(`currency validation: ${validation.reason}`);
      const { error } = await supabase
        .from('bricklink_pg_summary_cache')
        .upsert(row, { onConflict: 'item_type,item_no,colour_id' });
      if (error) throw new Error(`upsert failed: ${error.message}`);
      await markSuccess(t);
      laneARotations++;
      laneATelemetry.ok++;
      console.log(`  [lane-A] rotated ${tupleKey(t)} (${laneARotations}/${API_ROTATE_MAX} this run)`);
    } catch (e) {
      if (e instanceof RateLimitError) {
        console.warn(`  [lane-A] BL daily budget gate tripped — stopping rotation, marking remaining as challenge: ${e.message}`);
        laneATelemetry.failed++;
        for (const rest of tuples.slice(i)) await markChallenge(rest);
        return;
      }
      laneATelemetry.failed++;
      await markFailure(t, `lane-a: ${(e as Error).message}`.slice(0, 200));
    }
  }
}

/** Writes the single run-level lane-A telemetry row, if any rotation was attempted. */
async function writeLaneATelemetryIfAny(): Promise<void> {
  if (!laneATelemetry.attempted) return;
  const { error } = await supabase.from('bl_pg_lane_telemetry').insert({
    lane: 'store_api',
    session_no: 0,
    requests: laneATelemetry.requests,
    ok: laneATelemetry.ok,
    failed: laneATelemetry.failed,
    first_block_at_request: null,
    started_at: laneATelemetry.startedAt ?? new Date().toISOString(),
    ended_at: new Date().toISOString(),
    notes: 'residual-fill lane-A rotation',
  });
  if (error) console.error(`  ⚠ lane-A telemetry insert failed: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Step 6: run one session
// ---------------------------------------------------------------------------

async function runSession(sessionNo: number, requestedBatch: QueueRow[]): Promise<{ blocked: boolean; processedCount: number }> {
  console.log(`\n=== Session ${sessionNo}/${MAX_SESSIONS}: ${requestedBatch.length} tuples ===`);
  // claimTuples only actually locks rows still unlocked at update time — use the
  // rows it returns as the working batch, not the requested batch, so we never
  // fetch/mark a tuple another concurrent run already holds the lock on.
  const batch = await claimTuples(requestedBatch);
  if (batch.length < requestedBatch.length) {
    console.warn(`  ⚠ claimed ${batch.length}/${requestedBatch.length} tuples — rest locked by another run, working the claimed subset only.`);
  }

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
        console.warn(`  ⚠ 3 consecutive failures at request ${stats.requests} — treating as a challenge; attempting lane-A rotation before ending session early.`);
        await rotateToLaneA(recentFails.slice(-3));
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
  await writeLaneATelemetryIfAny();
  console.log('\nRun complete.');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
