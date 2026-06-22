/**
 * pov-refresh — daily BrickLink Part-Out-Value freshness top-up.
 *
 * The backfill built the dataset once; this keeps it from going stale without a 180-day "cliff".
 * It reads the `bricklink_pov_refresh_status` view (the single source of truth for staleness +
 * priority — age-tier cadence, deterministic jitter, not_partable override, empty-count backoff),
 * takes the most-overdue stale rows up to the daily budget, re-scrapes each via the SAME PovScraper
 * + self-healing breather loop as the backfill, and writes the refreshed figures back plus three
 * tracking fields:
 *   - no_data_reason          : 'not_partable' (structural, slow 365d recheck) | 'no_sales_yet' | NULL
 *   - consecutive_empty_count : ++ on empty, reset to 0 on a data hit (drives backoff)
 *   - last_changed_at         : bumped only when the sold/for-sale figure actually moves
 *
 * One audit row per run lands in `pov_refresh_runs` (throughput, recoveries, backlog trend,
 * breathers) — the Discord report cron reads it for trend lines + job-missed detection.
 *
 * MUST run locally: scraping needs the dedicated throwaway BL account (domham91, USD display)
 * logged into the CDP Chrome (:9222) behind a VPN. Runs daily via Windows Task Scheduler.
 *
 * Usage (from apps/web):
 *   npx tsx scripts/pov-refresh.ts                 # drain up to config budget (500/day)
 *   npx tsx scripts/pov-refresh.ts --budget=50     # smaller cap
 *   npx tsx scripts/pov-refresh.ts --dry-run       # show what WOULD be refreshed, no scrape/write
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import {
  resolvePovOptions,
  parseSetNumber,
  PovScraper,
  isCdpReachable,
  LoginRequiredError,
  CaptchaError,
  NotFoundError,
  EmptyResponseError,
  type PovCondition,
} from '../src/lib/bricklink/part-out-value';
import { PartOutValueCacheService, buildPovCacheRow } from '../src/lib/bricklink/part-out-value-cache.service';
import type { BrickLinkPartOutValueInsert, PovRefreshRunInsert } from '@hadley-bricks/database';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const argv = process.argv.slice(2).reduce<Record<string, string>>((acc, a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  acc[k] = v ?? 'true';
  return acc;
}, {});

const DRY_RUN = argv['dry-run'] === 'true' || argv['dry-run'] === '';
const CDP_PORT = parseInt(argv['cdp-port'] ?? '9222', 10);
const BUDGET_OVERRIDE = argv['budget'] ? Math.max(1, parseInt(argv['budget'], 10)) : null;
const USD_RATE_OVERRIDE = argv['usd-rate'] ? parseFloat(argv['usd-rate']) : null;
// Self-healing throttle recovery — same shape as the backfill.
const BREATHER_MS = argv['breather-ms'] ? parseInt(argv['breather-ms'], 10) : 780000; // ~13 min
const MAX_BREATHERS = argv['max-breathers'] ? parseInt(argv['max-breathers'], 10) : 10;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);
const service = new PartOutValueCacheService(supabase);

const OUT_DIR = path.resolve(__dirname, '../../../tmp/pov-backfill');
const LOCK_FILE = path.join(OUT_DIR, 'backfill.lock'); // shared with the backfill — never run both at once
const SUMMARY_FILE = path.join(OUT_DIR, 'refresh-summary.json');
fs.mkdirSync(OUT_DIR, { recursive: true });

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const jitter = (base: number) => Math.round(base * (0.75 + Math.random() * 0.75)); // 0.75x-1.5x

function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    const pid = fs.readFileSync(LOCK_FILE, 'utf8').trim();
    console.error(`[lock] a POV scrape (backfill/refresh) is already running (pid=${pid}). Delete ${LOCK_FILE} if stale.`);
    process.exit(1);
  }
  fs.writeFileSync(LOCK_FILE, String(process.pid));
  const release = () => {
    try {
      fs.unlinkSync(LOCK_FILE);
    } catch {
      /* ignore */
    }
  };
  process.on('exit', release);
  process.on('SIGINT', () => {
    release();
    process.exit(130);
  });
}

/** A stale candidate row as projected by the bricklink_pov_refresh_status view. */
interface Candidate {
  id: string;
  set_number: string;
  item_seq: number;
  condition: PovCondition;
  set_name: string | null;
  sold_6mo_avg_gbp: number | string | null;
  for_sale_avg_gbp: number | string | null;
  no_data_reason: string | null;
  consecutive_empty_count: number | null;
  age_tier: number;
  effective_cadence_days: number;
  overdue_ratio: number | string | null;
}

/** Total currently-stale rows (head count — dodges the 1000-row cap). */
async function countStale(): Promise<number> {
  const { count, error } = await supabase
    .from('bricklink_pov_refresh_status')
    .select('id', { count: 'exact', head: true })
    .eq('is_stale', true);
  if (error) {
    console.error('[refresh] backlog count failed:', error.message);
    return -1;
  }
  return count ?? 0;
}

async function main() {
  acquireLock();
  const config = await service.getConfig();
  const budget = BUDGET_OVERRIDE ?? config?.refresh_daily_budget ?? 500;
  const usdRate = USD_RATE_OVERRIDE ?? (config?.usd_to_gbp_rate ? Number(config.usd_to_gbp_rate) : null);
  const baseDelayMs = argv['delay-ms'] ? parseInt(argv['delay-ms'], 10) : config?.backfill_delay_ms ?? 20000;

  const startedAt = new Date();
  const backlogBefore = await countStale();
  console.log(
    `[refresh] budget=${budget} · backlog(stale)=${backlogBefore} · delay~${baseDelayMs}ms(±jitter) · ` +
      `usdRate=${usdRate ?? 'n/a'}${DRY_RUN ? ' · DRY-RUN' : ''}`,
  );

  // Most-overdue stale rows first, capped at the daily budget. The budget cap is what makes a
  // due-date spike physically impossible — we never scrape more than this in a day regardless of backlog.
  const { data: candData, error: candErr } = await supabase
    .from('bricklink_pov_refresh_status')
    .select(
      'id,set_number,item_seq,condition,set_name,sold_6mo_avg_gbp,for_sale_avg_gbp,no_data_reason,consecutive_empty_count,age_tier,effective_cadence_days,overdue_ratio',
    )
    .eq('is_stale', true)
    .order('overdue_ratio', { ascending: false })
    .limit(budget);
  if (candErr) {
    console.error('[refresh] candidate select failed:', candErr.message);
    process.exit(1);
  }
  const candidates = (candData ?? []) as Candidate[];
  console.log(`[refresh] ${candidates.length} candidate(s) selected (most-overdue first).`);

  const stats = {
    candidates: backlogBefore,
    attempted: 0,
    refreshed: 0,
    noData: 0,
    recoveries: 0,
    newlyEmpty: 0,
    errors: 0,
    breathers: 0,
    stoppedEarly: false,
    stopReason: '' as string,
  };

  if (candidates.length === 0) {
    // Quiet-by-design: nothing due. Still record the heartbeat so the report can prove the job ran
    // (a dry-run records nothing — it must never mutate state).
    if (!DRY_RUN) await recordRun(startedAt, budget, stats, backlogBefore, await countStale());
    console.log(`[refresh] nothing stale${DRY_RUN ? ' (dry-run)' : ' — heartbeat recorded'}. Done.`);
    process.exit(0);
  }

  if (DRY_RUN) {
    const byTier = [1, 2, 3].map((t) => candidates.filter((c) => c.age_tier === t).length);
    console.log(`[refresh] (dry) would refresh ${candidates.length}: tier1=${byTier[0]} tier2=${byTier[1]} tier3=${byTier[2]}`);
    for (const c of candidates.slice(0, 15)) {
      console.log(
        `  • ${c.set_number}-${c.item_seq} [${c.condition}] tier${c.age_tier} overdue×${Number(c.overdue_ratio ?? 0).toFixed(2)}` +
          `${c.no_data_reason ? ` (${c.no_data_reason}, empties=${c.consecutive_empty_count})` : ''}`,
      );
    }
    if (candidates.length > 15) console.log(`  … and ${candidates.length - 15} more`);
    process.exit(0);
  }

  // Scraping needs the CDP Chrome up. If it's down, record a stopped-early run so the report flags it.
  if (!(await isCdpReachable(CDP_PORT))) {
    stats.stoppedEarly = true;
    stats.stopReason = 'CDP Chrome unreachable at start';
    await recordRun(startedAt, budget, stats, backlogBefore, backlogBefore);
    console.error('[refresh] STOP — CDP Chrome (:9222) unreachable. Is the dedicated Chrome up + logged in?');
    process.exit(1);
  }

  let scraper = new PovScraper({ cdpPort: CDP_PORT, loggedOut: false });
  await scraper.open();

  let consecutiveErrors = 0;
  let consecutiveThrottles = 0;
  try {
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const { itemNo, itemSeq } = parseSetNumber(`${c.set_number}-${c.item_seq}`);
      const opts = resolvePovOptions({ setNumber: itemNo, itemSeq, condition: c.condition });
      const prevSold = c.sold_6mo_avg_gbp != null ? Number(c.sold_6mo_avg_gbp) : null;
      const prevForSale = c.for_sale_avg_gbp != null ? Number(c.for_sale_avg_gbp) : null;
      const prevWasNoData = prevSold == null && prevForSale == null;
      const prevEmpties = c.consecutive_empty_count ?? 0;

      try {
        const res = await scraper.scrape(opts);
        stats.attempted++;
        // Used rows carry no RRP/multiple by design; New rows keep RRP so partout_multiple stays computed.
        const retail = c.condition === 'N' ? await service.getUkRetailGbp(itemNo, itemSeq) : null;
        const row: BrickLinkPartOutValueInsert = {
          ...buildPovCacheRow(res, {
            usdToGbpRate: usdRate,
            ukRetailGbp: retail?.value ?? null,
            retailSource: retail?.source ?? null,
          }),
          // Data hit → clear any prior no-data sentinel + backoff.
          no_data_reason: null,
          consecutive_empty_count: 0,
        };
        const newSold = row.sold_6mo_avg_gbp != null ? Number(row.sold_6mo_avg_gbp) : null;
        const changed = prevSold !== newSold || prevWasNoData; // figure moved, or recovered from empty
        if (changed) row.last_changed_at = new Date().toISOString();
        // else: omit last_changed_at → upsert leaves the existing value untouched.

        await service.upsert(row);
        stats.refreshed++;
        if (prevWasNoData) stats.recoveries++;
        consecutiveErrors = 0;
        consecutiveThrottles = 0;
        console.log(
          `[refresh] ${i + 1}/${candidates.length} ${c.set_number}-${c.item_seq} [${c.condition}] ` +
            `sold ${newSold != null ? '£' + newSold.toFixed(2) : '—'}${prevWasNoData ? ' (RECOVERED)' : changed ? ' (changed)' : ''}`,
        );
      } catch (e) {
        if (e instanceof NotFoundError) {
          // Genuine no-data. 'not_partable' → structural (yearly recheck); 'no_data' → empty shell.
          stats.attempted++;
          stats.noData++;
          consecutiveThrottles = 0;
          consecutiveErrors = 0; // BL responded (page loaded) — symmetric with the data-hit reset
          if (!prevWasNoData) stats.newlyEmpty++;
          const nowIso = new Date().toISOString();
          const sentinel: BrickLinkPartOutValueInsert = {
            set_number: itemNo,
            item_seq: itemSeq,
            condition: c.condition,
            break_type: opts.breakType,
            inc_instructions: opts.incInstructions,
            inc_box: opts.incBox,
            inc_extra: opts.incExtra,
            inc_break: opts.incBreak,
            set_name: c.set_name,
            native_currency: null,
            sold_6mo_native: null,
            for_sale_native: null,
            sold_6mo_avg_gbp: null,
            for_sale_avg_gbp: null,
            no_data_reason: e.reason === 'not_partable' ? 'not_partable' : 'no_sales_yet',
            consecutive_empty_count: prevEmpties + 1,
            fetched_at: nowIso,
            updated_at: nowIso,
          };
          if (!prevWasNoData) sentinel.last_changed_at = nowIso; // data → empty transition
          await service.upsert(sentinel);
          console.log(
            `[refresh] ${i + 1}/${candidates.length} ${c.set_number}-${c.item_seq} — no data (${sentinel.no_data_reason}, empties=${prevEmpties + 1})`,
          );
        } else if (e instanceof EmptyResponseError || e instanceof CaptchaError || e instanceof LoginRequiredError) {
          consecutiveThrottles++;
          if (consecutiveThrottles >= 3 || stats.breathers >= MAX_BREATHERS) {
            stats.stoppedEarly = true;
            stats.stopReason = `throttle persists after ${stats.breathers} breathers: ${(e as Error).message}`;
            console.error(`[refresh] STOP — ${stats.stopReason}`);
            break;
          }
          stats.breathers++;
          const wait = BREATHER_MS + Math.round(Math.random() * 180000);
          console.error(
            `[refresh] throttled at ${c.set_number}-${c.item_seq} (403). Breather #${stats.breathers}/${MAX_BREATHERS}: ~${Math.round(wait / 60000)}m…`,
          );
          try {
            await scraper.close();
          } catch {
            /* ignore */
          }
          await sleep(wait);
          try {
            scraper = new PovScraper({ cdpPort: CDP_PORT, loggedOut: false });
            await scraper.open();
          } catch (reopenErr) {
            stats.stoppedEarly = true;
            stats.stopReason = `CDP unreachable after breather: ${(reopenErr as Error).message}`;
            console.error(`[refresh] STOP — ${stats.stopReason}`);
            break;
          }
          i--; // retry the same set
          continue;
        } else {
          stats.attempted++;
          stats.errors++;
          consecutiveErrors++;
          console.error(`[refresh] ${c.set_number}-${c.item_seq} error: ${(e as Error).message}`);
          if (consecutiveErrors >= 5) {
            stats.stoppedEarly = true;
            stats.stopReason = '5 consecutive errors';
            console.error('[refresh] STOP — 5 consecutive errors');
            break;
          }
        }
      }

      if (i < candidates.length - 1) await sleep(jitter(baseDelayMs));
    }
  } finally {
    await scraper.close();
  }

  const backlogAfter = await countStale();
  await recordRun(startedAt, budget, stats, backlogBefore, backlogAfter);

  console.log('\n=== POV REFRESH SUMMARY ===');
  console.log(
    `refreshed=${stats.refreshed} noData=${stats.noData} recoveries=${stats.recoveries} ` +
      `newlyEmpty=${stats.newlyEmpty} errors=${stats.errors} breathers=${stats.breathers}`,
  );
  console.log(`backlog ${backlogBefore} → ${backlogAfter}`);
  if (stats.stoppedEarly) console.log(`STOPPED EARLY: ${stats.stopReason}`);
}

type RunStats = {
  candidates: number;
  attempted: number;
  refreshed: number;
  noData: number;
  recoveries: number;
  newlyEmpty: number;
  errors: number;
  breathers: number;
  stoppedEarly: boolean;
  stopReason: string;
};

async function recordRun(
  startedAt: Date,
  budget: number,
  s: RunStats,
  backlogBefore: number,
  backlogAfter: number,
): Promise<void> {
  const finishedAt = new Date();
  const run: PovRefreshRunInsert = {
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    budget,
    candidates: Math.max(0, s.candidates),
    attempted: s.attempted,
    refreshed: s.refreshed,
    no_data: s.noData,
    recoveries: s.recoveries,
    newly_empty: s.newlyEmpty,
    errors: s.errors,
    breathers: s.breathers,
    stopped_early: s.stoppedEarly,
    stop_reason: s.stopReason || null,
    backlog_before: backlogBefore >= 0 ? backlogBefore : null,
    backlog_after: backlogAfter >= 0 ? backlogAfter : null,
    duration_ms: finishedAt.getTime() - startedAt.getTime(),
  };
  const { error } = await supabase.from('pov_refresh_runs').insert(run);
  if (error) console.error('[refresh] failed to write run record:', error.message);
  try {
    fs.writeFileSync(SUMMARY_FILE, JSON.stringify({ ...run, ...s }, null, 2));
  } catch {
    /* best-effort */
  }
}

main().catch((e) => {
  console.error('[refresh] fatal:', e);
  process.exit(1);
});
