/**
 * PG Market Intelligence — lane D nightly refresh driver (spec §4.1/§4.2, done-criteria F3).
 *
 * Claims due active-tier tuples from `bl_pg_refresh_queue` (plus grace-listed new releases)
 * and drives them through the catalogPG page engine (`PgScraper`), paced into sessions with
 * breathers, exactly like the POC's bl-pg-store-scan.ts but queue-driven instead of
 * store-scoped and resumable across nights via `next_due_at` rather than a local cache file.
 *
 * HARD CONSTRAINT (done-criteria F3 / Chris, 2026-07-08): this is LOCAL-ONLY. It is invoked
 * by a Windows Scheduled Task via pg-refresh-cycle.ps1 (domham91 CDP Chrome, port 9222) and
 * must never become a Vercel cron or API route.
 *
 * Per-tuple write fan-out on every successful scrape:
 *   1. L3 (bricklink_price_guide_cache) via PriceGuideCacheService.upsert + write-through to
 *      bricklink_part_price_cache (parts/minifigs) — same as bl-pg-store-scan.ts.
 *   2. L1 (bricklink_pg_summary_cache) — the page carries WORLDWIDE quadrants too, so every
 *      lane D fetch also refreshes the worldwide summary row (source='catalogpg').
 *   3. L2 (bricklink_pg_snapshots) — one row per tuple per day, L1-shaped, for MoM deltas.
 * All three writes flush in batches of <=50 (spec §4.4: "no job may hold >15 min of
 * unflushed work"); the queue update batch is the batch-size driver since it's 1:1 with
 * requests processed.
 *
 * Usage (from apps/web, with the GBP-display domham91 CDP session up):
 *   npx tsx scripts/pg/pg-refresh-cycle.ts
 *
 * Flags (all optional):
 *   --cdp-port=<n>          Chrome CDP port (default 9222)
 *   --session-size=<n>      Requests per session before a normal breather (default 350)
 *   --breather-mins=<n>     Minutes to rest between normal sessions (default 20)
 *   --max-sessions=<n>      Hard cap on sessions this run (default 6)
 *   --window-hours=<n>      Run-window budget in hours, from job start (default 7.5 — matches
 *                           the .ps1's ExecutionTimeLimit of 7h30m)
 *   --nav-delay-ms=<n>      Base delay between PG navigations (default 4000, floor 4000)
 *   --limit-tuples=<n>      Cap total requests this run (0 = no cap; for testing)
 *   --claim-chunk=<n>       Tuples claimed per DB round-trip (default 50)
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as os from 'os';
import * as path from 'path';
import {
  PgScraper,
  PgBlockError,
  PgCaptchaError,
  PgLoginError,
  PgCurrencyError,
  PgNotFoundError,
  PgNoDataError,
  isPgCdpReachable,
  type PgItemRef,
  type PgItemType,
  type PgScrapeResult,
} from '../../src/lib/bricklink/price-guide-page';
import { PriceGuideCacheService } from '../../src/lib/bricklink/price-guide-cache.service';
import { planNight, nextAction, type PlannerState } from '../../src/lib/bricklink/pg-session-planner';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2).reduce<Record<string, string>>((acc, a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  acc[k] = v ?? 'true';
  return acc;
}, {});

const CDP_PORT = parseInt(argv['cdp-port'] ?? '9222', 10);
const SESSION_SIZE = parseInt(argv['session-size'] ?? '350', 10);
const BREATHER_MINS = parseFloat(argv['breather-mins'] ?? '20');
const MAX_SESSIONS = parseInt(argv['max-sessions'] ?? '6', 10);
const WINDOW_HOURS = parseFloat(argv['window-hours'] ?? '7.5');
const NAV_DELAY_MS = Math.max(4000, parseInt(argv['nav-delay-ms'] ?? '4000', 10));
const LIMIT_TUPLES = parseInt(argv['limit-tuples'] ?? '0', 10);
const CLAIM_CHUNK = Math.max(1, parseInt(argv['claim-chunk'] ?? '50', 10));

const BACKOFF_MS = 30 * 60 * 1000; // spec §4.4: 403 -> 30-min backoff
const STALE_LOCK_MS = 8 * 60 * 60 * 1000; // §-implied: locks older than 8h are reclaimable
const ACTIVE_CYCLE_DAYS = 28;
const NO_DATA_REQUEUE_DAYS = 90;
const FLUSH_AT = 50;

const RUN_ID = `pgrefresh-${os.hostname()}-${process.pid}-${Date.now()}`;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('[pg-refresh-cycle] Missing Supabase env (.env.local)');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
const cacheService = new PriceGuideCacheService(supabase);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

interface QueueRow {
  item_type: PgItemType;
  item_no: string;
  colour_id: number;
  tier: 'active' | 'tail';
  grace_until: string | null;
  next_due_at: string;
  attempts: number;
}

function tupleLabel(item: PgItemRef): string {
  return `${item.itemType} ${item.itemNo}${item.itemType === 'P' ? ` c${item.colourId}` : ''}`;
}

/** PostgREST or()/and() filter values must not carry raw commas/parens — BL item numbers
 *  never do in practice (alnum + hyphens), but quote defensively rather than assume. */
function pgFilterValue(v: string | number): string {
  const s = String(v);
  return /[,()."]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}

function tupleFilterGroup(t: { item_type: string; item_no: string; colour_id: number }): string {
  return `and(item_type.eq.${pgFilterValue(t.item_type)},item_no.eq.${pgFilterValue(t.item_no)},colour_id.eq.${t.colour_id})`;
}

function addDaysIso(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// Queue claim / lock lifecycle
// ---------------------------------------------------------------------------

async function reclaimStaleLocks(sb: SupabaseClient): Promise<number> {
  const staleThreshold = new Date(Date.now() - STALE_LOCK_MS).toISOString();
  const { data, error } = await sb
    .from('bl_pg_refresh_queue')
    .update({ locked_by: null, locked_at: null })
    .not('locked_by', 'is', null)
    .lt('locked_at', staleThreshold)
    .select('item_type,item_no,colour_id');
  if (error) throw new Error(`reclaimStaleLocks failed: ${error.message}`);
  return (data ?? []).length;
}

async function countDue(sb: SupabaseClient): Promise<number> {
  const nowIso = new Date().toISOString();
  const { count, error } = await sb
    .from('bl_pg_refresh_queue')
    .select('item_type', { count: 'exact', head: true })
    .is('locked_by', null)
    // Due-ness ALWAYS requires next_due_at to have passed. Grace only widens the
    // tier condition (a grace-listed tuple is claimable even if somehow demoted to
    // tail) — it must never bypass the 28-day cadence, or every new release gets
    // re-scraped nightly for 6 months (review finding #1).
    .lte('next_due_at', nowIso)
    .or(`tier.eq.active,grace_until.gt.${nowIso}`);
  if (error) throw new Error(`countDue failed: ${error.message}`);
  return count ?? 0;
}

async function claimBatch(sb: SupabaseClient, runId: string, limit: number): Promise<QueueRow[]> {
  const nowIso = new Date().toISOString();
  const { data, error } = await sb
    .from('bl_pg_refresh_queue')
    .select('item_type,item_no,colour_id,tier,grace_until,next_due_at,attempts')
    .is('locked_by', null)
    // Same due-ness semantics as countDue (see comment there).
    .lte('next_due_at', nowIso)
    .or(`tier.eq.active,grace_until.gt.${nowIso}`)
    .order('next_due_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`claimBatch select failed: ${error.message}`);
  const rows = (data ?? []) as QueueRow[];
  if (rows.length === 0) return [];

  const filter = rows.map(tupleFilterGroup).join(',');
  // .select() returns the rows the UPDATE actually locked — under a concurrent
  // manual run, some may have been claimed between our SELECT and UPDATE (TOCTOU,
  // review finding #6). Work only what we genuinely hold.
  const { data: locked, error: lockErr } = await sb
    .from('bl_pg_refresh_queue')
    .update({ locked_by: runId, locked_at: nowIso })
    .is('locked_by', null)
    .or(filter)
    .select('item_type,item_no,colour_id,tier,grace_until,next_due_at,attempts');
  if (lockErr) throw new Error(`claimBatch lock failed: ${lockErr.message}`);
  const lockedRows = (locked ?? []) as QueueRow[];
  if (lockedRows.length < rows.length) {
    console.warn(`[pg-refresh-cycle] claimed ${lockedRows.length}/${rows.length} (rest locked by a concurrent run)`);
  }
  return lockedRows;
}

async function releaseAllLocksForRun(sb: SupabaseClient, runId: string): Promise<number> {
  const { data, error } = await sb
    .from('bl_pg_refresh_queue')
    .update({ locked_by: null, locked_at: null })
    .eq('locked_by', runId)
    .select('item_type,item_no,colour_id');
  if (error) {
    console.error(`[pg-refresh-cycle] releaseAllLocksForRun failed: ${error.message}`);
    return 0;
  }
  return (data ?? []).length;
}

// ---------------------------------------------------------------------------
// Row builders
// ---------------------------------------------------------------------------

function toSummaryCacheRow(r: PgScrapeResult): Record<string, unknown> {
  const w = r.world;
  const nowIso = new Date().toISOString();
  return {
    item_type: r.item.itemType,
    item_no: r.item.itemNo,
    colour_id: r.item.itemType === 'P' ? r.item.colourId : 0,
    currency: 'GBP',
    sold6m_new_lots: w.soldNew.lots,
    sold6m_new_qty: w.soldNew.qty,
    sold6m_new_min: w.soldNew.min,
    sold6m_new_avg: w.soldNew.avg,
    sold6m_new_qavg: w.soldNew.qtyAvg,
    sold6m_new_max: w.soldNew.max,
    sold6m_used_lots: w.soldUsed.lots,
    sold6m_used_qty: w.soldUsed.qty,
    sold6m_used_min: w.soldUsed.min,
    sold6m_used_avg: w.soldUsed.avg,
    sold6m_used_qavg: w.soldUsed.qtyAvg,
    sold6m_used_max: w.soldUsed.max,
    stock_new_lots: w.stockNew.lots,
    stock_new_qty: w.stockNew.qty,
    stock_new_min: w.stockNew.min,
    stock_new_avg: w.stockNew.avg,
    stock_new_qavg: w.stockNew.qtyAvg,
    stock_new_max: w.stockNew.max,
    stock_used_lots: w.stockUsed.lots,
    stock_used_qty: w.stockUsed.qty,
    stock_used_min: w.stockUsed.min,
    stock_used_avg: w.stockUsed.avg,
    stock_used_qavg: w.stockUsed.qtyAvg,
    stock_used_max: w.stockUsed.max,
    source: 'catalogpg',
    // Canonical no_data definition (matches pg-summary.ts): zero lots across all
    // four quadrants. A successful scrape CAN legitimately return all-empty
    // (review finding #8) — distinct from the PgNoDataError path handled upstream.
    no_data: w.soldNew.lots + w.soldUsed.lots + w.stockNew.lots + w.stockUsed.lots === 0,
    fetch_identity: 'catalogpg_cdp',
    fx_rate: null,
    fetched_at: r.scrapedAt,
    updated_at: nowIso,
  };
}

function toSnapshotRow(r: PgScrapeResult, snapshotDate: string): Record<string, unknown> {
  const w = r.world;
  const strNew = w.stockNew.qty > 0 ? +(w.soldNew.qty / w.stockNew.qty).toFixed(4) : null;
  const strUsed = w.stockUsed.qty > 0 ? +(w.soldUsed.qty / w.stockUsed.qty).toFixed(4) : null;
  return {
    item_type: r.item.itemType,
    item_no: r.item.itemNo,
    colour_id: r.item.itemType === 'P' ? r.item.colourId : 0,
    snapshot_date: snapshotDate,
    currency: 'GBP',
    sold6m_new_lots: w.soldNew.lots,
    sold6m_new_qty: w.soldNew.qty,
    sold6m_new_avg: w.soldNew.avg,
    sold6m_new_qavg: w.soldNew.qtyAvg,
    sold6m_used_lots: w.soldUsed.lots,
    sold6m_used_qty: w.soldUsed.qty,
    sold6m_used_avg: w.soldUsed.avg,
    sold6m_used_qavg: w.soldUsed.qtyAvg,
    stock_new_lots: w.stockNew.lots,
    stock_new_qty: w.stockNew.qty,
    stock_new_avg: w.stockNew.avg,
    stock_used_lots: w.stockUsed.lots,
    stock_used_qty: w.stockUsed.qty,
    stock_used_avg: w.stockUsed.avg,
    str_new: strNew,
    str_used: strUsed,
    source: 'catalogpg',
    fetch_identity: 'catalogpg_cdp',
  };
}

function toOkQueueUpdate(t: QueueRow): Record<string, unknown> {
  const nowIso = new Date().toISOString();
  return {
    item_type: t.item_type,
    item_no: t.item_no,
    colour_id: t.colour_id,
    last_refreshed_at: nowIso,
    next_due_at: addDaysIso(ACTIVE_CYCLE_DAYS),
    attempts: 0,
    last_error: null,
    locked_by: null,
    locked_at: null,
    updated_at: nowIso,
  };
}

function toUnlockOnlyQueueUpdate(t: QueueRow): Record<string, unknown> {
  return {
    item_type: t.item_type,
    item_no: t.item_no,
    colour_id: t.colour_id,
    locked_by: null,
    locked_at: null,
    updated_at: new Date().toISOString(),
  };
}

function toNoDataQueueUpdate(t: QueueRow, err: Error): Record<string, unknown> {
  const nowIso = new Date().toISOString();
  return {
    item_type: t.item_type,
    item_no: t.item_no,
    colour_id: t.colour_id,
    last_error: err.message.slice(0, 500),
    next_due_at: addDaysIso(NO_DATA_REQUEUE_DAYS),
    attempts: (t.attempts ?? 0) + 1,
    locked_by: null,
    locked_at: null,
    updated_at: nowIso,
  };
}

function toErrorQueueUpdate(t: QueueRow, err: unknown): Record<string, unknown> {
  const nowIso = new Date().toISOString();
  const attempts = (t.attempts ?? 0) + 1;
  const message = err instanceof Error ? err.message : String(err);
  const update: Record<string, unknown> = {
    item_type: t.item_type,
    item_no: t.item_no,
    colour_id: t.colour_id,
    last_error: message.slice(0, 500),
    attempts,
    locked_by: null,
    locked_at: null,
    updated_at: nowIso,
  };
  // Repeated non-block errors on the same tuple (parse/CDP hiccups) get a short
  // cooldown so a bad tuple can't hot-loop through claim -> fail -> reclaim -> fail
  // within the same run; genuine blocks/no-data have their own handling above.
  if (attempts >= 3) update.next_due_at = addDaysIso(1);
  return update;
}

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

interface SessionCounts {
  requests: number;
  ok: number;
  failed: number;
}

async function insertTelemetry(
  sb: SupabaseClient,
  args: {
    sessionNo: number;
    counts: SessionCounts;
    firstBlockAtRequest: number | null;
    startedAt: string;
    endedAt: string;
    notes: string;
  },
): Promise<void> {
  const { error } = await sb.from('bl_pg_lane_telemetry').insert({
    run_date: new Date().toISOString().slice(0, 10),
    lane: 'catalogpg',
    session_no: args.sessionNo,
    requests: args.counts.requests,
    ok: args.counts.ok,
    failed: args.counts.failed,
    first_block_at_request: args.firstBlockAtRequest,
    started_at: args.startedAt,
    ended_at: args.endedAt,
    notes: args.notes,
  });
  if (error) console.error(`[pg-refresh-cycle] telemetry insert failed: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Batch flush
// ---------------------------------------------------------------------------

interface Batches {
  scrapeResults: PgScrapeResult[];
  summaryRows: Record<string, unknown>[];
  snapshotRows: Record<string, unknown>[];
  queueUpdates: Record<string, unknown>[];
}

function emptyBatches(): Batches {
  return { scrapeResults: [], summaryRows: [], snapshotRows: [], queueUpdates: [] };
}

async function flush(sb: SupabaseClient, batches: Batches): Promise<void> {
  if (batches.scrapeResults.length > 0) {
    await cacheService.upsert(batches.scrapeResults);
    await cacheService.writeThroughPartPriceCache(batches.scrapeResults);
  }
  if (batches.summaryRows.length > 0) {
    const { error } = await sb
      .from('bricklink_pg_summary_cache')
      .upsert(batches.summaryRows, { onConflict: 'item_type,item_no,colour_id' });
    if (error) throw new Error(`summary cache upsert failed: ${error.message}`);
  }
  if (batches.snapshotRows.length > 0) {
    const { error } = await sb
      .from('bricklink_pg_snapshots')
      .upsert(batches.snapshotRows, { onConflict: 'item_type,item_no,colour_id,snapshot_date' });
    if (error) throw new Error(`snapshots upsert failed: ${error.message}`);
  }
  if (batches.queueUpdates.length > 0) {
    const { error } = await sb
      .from('bl_pg_refresh_queue')
      .upsert(batches.queueUpdates, { onConflict: 'item_type,item_no,colour_id' });
    if (error) throw new Error(`queue upsert failed: ${error.message}`);
  }
  batches.scrapeResults = [];
  batches.summaryRows = [];
  batches.snapshotRows = [];
  batches.queueUpdates = [];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(
    `[pg-refresh-cycle] run=${RUN_ID} cdpPort=${CDP_PORT} sessionSize=${SESSION_SIZE} ` +
      `breatherMins=${BREATHER_MINS} maxSessions=${MAX_SESSIONS} windowHours=${WINDOW_HOURS} navDelayMs=${NAV_DELAY_MS}` +
      (LIMIT_TUPLES > 0 ? ` limitTuples=${LIMIT_TUPLES}` : ''),
  );

  const reachable = await isPgCdpReachable(CDP_PORT);
  if (!reachable) {
    console.error(
      `[pg-refresh-cycle] CDP not reachable on port ${CDP_PORT} — is the domham91 Chrome profile ` +
        `running with --remote-debugging-port=${CDP_PORT}? Exiting gracefully (this is expected if ` +
        `Chrome isn't up; the .ps1 wrapper also pre-checks this).`,
    );
    process.exit(0);
  }

  const reclaimed = await reclaimStaleLocks(supabase);
  if (reclaimed > 0) console.log(`[pg-refresh-cycle] reclaimed ${reclaimed} stale lock(s) (>8h old)`);

  const dueCount = await countDue(supabase);
  const designCadence = SESSION_SIZE * MAX_SESSIONS;
  const eta = dueCount > 0 ? Math.ceil(dueCount / designCadence) : 0;
  console.log(
    `[pg-refresh-cycle] ${dueCount} tuple(s) due; design cadence ${designCadence}/night -> ` +
      `~${eta} night(s) to clear the current backlog at this cadence`,
  );

  const plan = planNight({
    windowStartHour: 0,
    windowEndHour: WINDOW_HOURS,
    sessionSize: SESSION_SIZE,
    breatherMins: BREATHER_MINS,
    maxSessions: MAX_SESSIONS,
  });
  if (!plan.estFitsWindow) {
    console.warn(
      `[pg-refresh-cycle] WARNING: breather time alone (${BREATHER_MINS * (MAX_SESSIONS - 1)}min) ` +
        `does not fit the ${plan.windowMinutes}min window even before any fetch — sessions will be cut short.`,
    );
  }

  const scraper = new PgScraper({ cdpPort: CDP_PORT });
  await scraper.open();

  const state: PlannerState = {
    requestsThisSession: 0,
    consecutiveFails: 0,
    sessionsCompleted: 0,
    blockedSessions: 0,
    sessionSize: SESSION_SIZE,
    maxSessions: MAX_SESSIONS,
    elapsedMinutes: 0,
    windowMinutes: plan.windowMinutes,
  };
  const runStart = Date.now();
  let sessionStartedAt = new Date().toISOString();
  let sessionCounts: SessionCounts = { requests: 0, ok: 0, failed: 0 };
  let firstBlockAtRequest: number | null = null;
  let totalProcessed = 0;
  let queue: QueueRow[] = [];
  const batches = emptyBatches();
  let stopReason = 'unknown';
  let fatalError: unknown = null;

  try {
    outer: for (;;) {
      state.elapsedMinutes = (Date.now() - runStart) / 60000;
      const action = nextAction(state);

      if (action === 'stop') {
        stopReason =
          state.elapsedMinutes >= state.windowMinutes
            ? 'window elapsed'
            : state.blockedSessions >= 2
              ? 'two consecutive blocked sessions'
              : 'maxSessions reached';
        break;
      }

      if (action === 'breather' || action === 'backoff') {
        await flush(supabase, batches);
        const endedAt = new Date().toISOString();
        await insertTelemetry(supabase, {
          sessionNo: state.sessionsCompleted + 1,
          counts: sessionCounts,
          firstBlockAtRequest,
          startedAt: sessionStartedAt,
          endedAt,
          notes: JSON.stringify({ outcome: action, ...sessionCounts }),
        });
        const sleepMs = action === 'breather' ? BREATHER_MINS * 60000 : BACKOFF_MS;
        console.log(
          `[pg-refresh-cycle] session ${state.sessionsCompleted + 1} ended (${action}): ` +
            `${sessionCounts.ok} ok / ${sessionCounts.failed} failed of ${sessionCounts.requests} — ` +
            `sleeping ${(sleepMs / 60000).toFixed(0)}min`,
        );
        await sleep(sleepMs);
        state.sessionsCompleted += 1;
        state.blockedSessions = action === 'backoff' ? state.blockedSessions + 1 : 0;
        state.requestsThisSession = 0;
        state.consecutiveFails = 0;
        sessionCounts = { requests: 0, ok: 0, failed: 0 };
        firstBlockAtRequest = null;
        sessionStartedAt = new Date().toISOString();
        continue;
      }

      // action === 'fetch'
      if (LIMIT_TUPLES > 0 && totalProcessed >= LIMIT_TUPLES) {
        stopReason = `--limit-tuples=${LIMIT_TUPLES} reached`;
        break;
      }
      if (queue.length === 0) {
        queue = await claimBatch(supabase, RUN_ID, CLAIM_CHUNK);
        if (queue.length === 0) {
          stopReason = 'no due tuples remain in the queue';
          break;
        }
      }
      const tuple = queue.shift()!;
      const item: PgItemRef = { itemType: tuple.item_type, itemNo: tuple.item_no, colourId: tuple.colour_id };
      const jitter = Math.floor(Math.random() * 2000);
      await sleep(NAV_DELAY_MS + jitter);

      sessionCounts.requests += 1;
      state.requestsThisSession += 1;
      totalProcessed += 1;

      try {
        const result = await scraper.scrape(item);
        batches.scrapeResults.push(result);
        batches.summaryRows.push(toSummaryCacheRow(result));
        batches.snapshotRows.push(toSnapshotRow(result, new Date().toISOString().slice(0, 10)));
        batches.queueUpdates.push(toOkQueueUpdate(tuple));
        sessionCounts.ok += 1;
        state.consecutiveFails = 0;
      } catch (err) {
        if (err instanceof PgBlockError || err instanceof PgCaptchaError) {
          sessionCounts.failed += 1;
          state.consecutiveFails += 1;
          if (firstBlockAtRequest === null) firstBlockAtRequest = sessionCounts.requests;
          batches.queueUpdates.push(toUnlockOnlyQueueUpdate(tuple)); // not the tuple's fault — retry later
          console.warn(`[pg-refresh-cycle] BLOCK on ${tupleLabel(item)}: ${err.message}`);
        } else if (err instanceof PgNotFoundError || err instanceof PgNoDataError) {
          sessionCounts.failed += 1;
          batches.queueUpdates.push(toNoDataQueueUpdate(tuple, err));
        } else if (err instanceof PgLoginError || err instanceof PgCurrencyError) {
          console.error(
            `[pg-refresh-cycle] FATAL on ${tupleLabel(item)}: ${err.message} — the CDP session is unusable ` +
              `(login wall or wrong display currency). Stopping the run rather than burning the rest of the queue.`,
          );
          batches.queueUpdates.push(toUnlockOnlyQueueUpdate(tuple));
          fatalError = err;
          stopReason = err.name;
          break outer;
        } else {
          sessionCounts.failed += 1;
          batches.queueUpdates.push(toErrorQueueUpdate(tuple, err));
          console.warn(`[pg-refresh-cycle] error on ${tupleLabel(item)}: ${err instanceof Error ? err.message : err}`);
        }
      }

      if (batches.queueUpdates.length >= FLUSH_AT) await flush(supabase, batches);
    }
  } finally {
    try {
      await flush(supabase, batches);
    } catch (e) {
      console.error(`[pg-refresh-cycle] final flush failed: ${e instanceof Error ? e.message : e}`);
    }
    await scraper.close();
    const released = await releaseAllLocksForRun(supabase, RUN_ID);
    console.log(`[pg-refresh-cycle] released ${released} lock(s) held by ${RUN_ID} (safety net for unprocessed claims)`);
    console.log(
      `[pg-refresh-cycle] run ${RUN_ID} finished: ${totalProcessed} tuple(s) processed across ` +
        `${state.sessionsCompleted} session(s) (${state.blockedSessions} consecutive blocked) — stop reason: ${stopReason}`,
    );
  }

  if (fatalError) throw fatalError;
}

main().catch((e) => {
  console.error('[pg-refresh-cycle] fatal:', e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});
