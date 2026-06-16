/**
 * pov-backfill — slow, consistent BrickLink Part Out Value dataset builder.
 *
 * Walks the NEWEST sets first (from the brickset_sets cache), skips fresh cache rows, and
 * scrapes POV for the rest with a conservative inter-request delay. Designed to be re-run /
 * resumed (skip-fresh) and to STOP immediately on login/captcha/empty (anti-bot) responses.
 *
 * Run modes:
 *   - Logged-in (default): uses the trusted account session → GBP, reliable.
 *   - --logged-out: fresh incognito context → USD (converted via --usd-rate). PROD ONLY behind a
 *     VPN — a residential IP gets soft-blocked logged-out after a handful of hits.
 *
 * Usage (from apps/web):
 *   npx tsx scripts/pov-backfill.ts --limit=100 --delay-ms=8000
 *   npx tsx scripts/pov-backfill.ts --limit=200 --logged-out --usd-rate=0.74   # behind VPN
 *   npx tsx scripts/pov-backfill.ts --limit=50 --dry-run
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import {
  resolvePovOptions,
  parseSetNumber,
  PovScraper,
  DEFAULT_POV_OPTIONS,
  LoginRequiredError,
  CaptchaError,
  NotFoundError,
  EmptyResponseError,
  type PovCondition,
} from '../src/lib/bricklink/part-out-value';
import { PartOutValueCacheService, buildPovCacheRow } from '../src/lib/bricklink/part-out-value-cache.service';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const argv = process.argv.slice(2).reduce<Record<string, string>>((acc, a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  acc[k] = v ?? 'true';
  return acc;
}, {});

// --limit = how many NEW (not-yet-cached) sets to scrape this session.
const LIMIT = Math.max(1, parseInt(argv['limit'] ?? '100', 10));
const LOGGED_OUT = argv['logged-out'] === 'true' || argv['logged-out'] === '';
const DRY_RUN = argv['dry-run'] === 'true' || argv['dry-run'] === '';
const CONDITION = (argv['condition'] as PovCondition) ?? 'N';
const CDP_PORT = parseInt(argv['cdp-port'] ?? '9222', 10);
const USD_RATE = argv['usd-rate'] ? parseFloat(argv['usd-rate']) : null;
// --skip-rrp: don't look up / store UK RRP (Used runs — RRP is irrelevant for the whole-vs-parted call).
const SKIP_RRP = argv['skip-rrp'] === 'true' || argv['skip-rrp'] === '';
// Set-number digit floor: 4 (mainstream) by default; pass --min-digits=3 to include vintage (e.g. 375-1).
const MIN_DIGITS = Math.max(3, Math.min(5, parseInt(argv['min-digits'] ?? '4', 10)));
const NOW_YEAR = new Date().getFullYear();
const YEAR_MIN = parseInt(argv['year-min'] ?? '0', 10);
const YEAR_MAX = parseInt(argv['year-max'] ?? String(NOW_YEAR), 10);
// Brickset themes that aren't part-out-able SETS (electronics, spare parts, bulk, non-LEGO merch).
// The require-rrp filter already excludes most of these for New runs; matters for Used (no-RRP).
const DEFAULT_EXCLUDE_THEMES = ['Gear', 'Service Packs', 'Power Functions', 'Powered Up', 'Bulk Bricks'];
const EXCLUDE_THEMES = new Set(
  (argv['exclude-themes'] ? argv['exclude-themes'].split(',') : DEFAULT_EXCLUDE_THEMES).map((s) => s.trim()),
);
// Require a Brickset RRP so the part-out multiple is computable. Off automatically when --skip-rrp.
const REQUIRE_RRP = SKIP_RRP ? false : (argv['require-rrp'] ?? 'true') !== 'false';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);
const service = new PartOutValueCacheService(supabase);

const OUT_DIR = path.resolve(__dirname, '../../../tmp/pov-backfill');
const LOCK_FILE = path.join(OUT_DIR, 'backfill.lock');
const SUMMARY_FILE = path.join(OUT_DIR, 'summary.json');
fs.mkdirSync(OUT_DIR, { recursive: true });

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    const pid = fs.readFileSync(LOCK_FILE, 'utf8').trim();
    console.error(`[lock] backfill already running (pid=${pid}). Delete ${LOCK_FILE} if stale.`);
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

interface TargetSet {
  set_number: string;
  set_name: string | null;
  year_from: number | null;
  uk_retail_price: number | string | null;
  theme: string | null;
}

async function main() {
  acquireLock();
  const config = await service.getConfig();
  // Conservative by default; a residential IP soft-blocks logged-out scraping quickly, and a fixed
  // interval is bot-shaped — so pace slowly, jitter every gap, and cool down periodically.
  const baseDelayMs = argv['delay-ms'] ? parseInt(argv['delay-ms'], 10) : config?.backfill_delay_ms ?? 20000;
  const jitter = (base: number) => Math.round(base * (0.75 + Math.random() * 0.75)); // 0.75×–1.5×
  const cooldownEvery = Math.max(1, config?.backfill_batch_size ?? 25);
  const cooldownMs = Math.max(60000, baseDelayMs * 4);
  const usdRate = USD_RATE ?? (config?.usd_to_gbp_rate ? Number(config.usd_to_gbp_rate) : null);

  console.log(
    `[backfill] want=${LIMIT} new sets · condition=${CONDITION} · years ${YEAR_MIN}–${YEAR_MAX} · digits≥${MIN_DIGITS} · ` +
      `delay~${baseDelayMs}ms(±jitter) · ${SKIP_RRP ? 'no-RRP' : REQUIRE_RRP ? 'rrp-required' : 'rrp-optional'} · ` +
      `${LOGGED_OUT ? 'LOGGED-OUT/USD' : 'logged-in'}${DRY_RUN ? ' · DRY-RUN' : ''}`,
  );
  // Logged-out scrapes return USD. Without a rate we'd write null-GBP rows marked "fresh" and never
  // re-scrape them — refuse rather than waste BL hits.
  if (LOGGED_OUT && !usdRate) {
    console.error('[backfill] logged-out mode needs a USD→GBP rate — pass --usd-rate=<n> or set bricklink_pov_config.usd_to_gbp_rate. Aborting.');
    process.exit(1);
  }

  const PAGE = 1000;

  // 1) Coverage: every set already cached for THIS option-variant (so we never re-scrape it).
  //    Paginated past Supabase's 1000-row cap. Keyed by "<itemNo>:<seq>".
  const covered = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('bricklink_part_out_value_cache')
      .select('set_number, item_seq')
      .eq('condition', CONDITION)
      .eq('break_type', DEFAULT_POV_OPTIONS.breakType)
      .eq('inc_instructions', DEFAULT_POV_OPTIONS.incInstructions)
      .eq('inc_box', DEFAULT_POV_OPTIONS.incBox)
      .eq('inc_extra', DEFAULT_POV_OPTIONS.incExtra)
      .eq('inc_break', DEFAULT_POV_OPTIONS.incBreak)
      .range(from, from + PAGE - 1);
    if (error) {
      console.error('[backfill] failed to load cache coverage:', error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    for (const r of data as Array<{ set_number: string; item_seq: number }>) covered.add(`${r.set_number}:${r.item_seq}`);
    if (data.length < PAGE) break;
  }

  // 2) Walk brickset_sets newest-first, page by page, collecting the next LIMIT eligible sets that
  //    aren't covered yet. Numeric set numbers only (excludes ISBN books / gear / promo placeholders).
  //    This resumes automatically across sessions — no manual --offset, no 1000-row ceiling.
  const NUMERIC_SET = new RegExp(`^\\d{${MIN_DIGITS},5}-\\d+$`);
  const targets: TargetSet[] = [];
  let scanned = 0;
  for (let from = 0; targets.length < LIMIT; from += PAGE) {
    let q = supabase
      .from('brickset_sets')
      .select('set_number, set_name, year_from, uk_retail_price, theme')
      .not('year_from', 'is', null)
      .gte('year_from', YEAR_MIN)
      .lte('year_from', YEAR_MAX)
      .order('year_from', { ascending: false })
      .order('set_number', { ascending: false })
      .range(from, from + PAGE - 1);
    if (REQUIRE_RRP) q = q.not('uk_retail_price', 'is', null);
    const { data, error } = await q;
    if (error) {
      console.error('[backfill] failed to load target sets:', error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    scanned += data.length;
    for (const row of data as TargetSet[]) {
      if (!NUMERIC_SET.test(row.set_number)) continue;
      if (row.theme && EXCLUDE_THEMES.has(row.theme)) continue;
      const { itemNo, itemSeq } = parseSetNumber(row.set_number);
      if (covered.has(`${itemNo}:${itemSeq}`)) continue;
      targets.push(row);
      if (targets.length >= LIMIT) break;
    }
    if (data.length < PAGE) break;
  }
  console.log(
    `[backfill] ${targets.length} new sets to scrape (already covered=${covered.size}, scanned=${scanned}` +
      `${targets.length ? `, year ${targets[0]?.year_from}…${targets[targets.length - 1]?.year_from}` : ''})`,
  );

  const stats = {
    startedAt: new Date().toISOString(),
    candidates: targets.length,
    seeded: 0,
    skippedFresh: 0,
    noData: 0,
    errors: 0,
    stoppedEarly: false,
    stopReason: '' as string,
    topOpportunities: [] as Array<{ set: string; name: string | null; multiple: number; sold: number | null; rrp: number | null }>,
  };
  const seededRows: Array<{ set: string; name: string | null; multiple: number | null; sold: number | null; rrp: number | null }> = [];

  const scraper = new PovScraper({ cdpPort: CDP_PORT, loggedOut: LOGGED_OUT });
  if (!DRY_RUN) await scraper.open();

  let consecutiveErrors = 0;
  try {
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      const { itemNo, itemSeq } = parseSetNumber(t.set_number);
      const opts = resolvePovOptions({ setNumber: itemNo, itemSeq, condition: CONDITION });

      if (DRY_RUN) {
        console.log(`[backfill] (dry) would scrape ${t.set_number} — ${t.set_name ?? ''}`);
        continue;
      }

      try {
        const res = await scraper.scrape(opts);
        const retail = SKIP_RRP ? null : await service.getUkRetailGbp(itemNo, itemSeq);
        const row = buildPovCacheRow(res, {
          usdToGbpRate: usdRate,
          ukRetailGbp: retail?.value ?? null,
          retailSource: retail?.source ?? null,
        });
        const stored = await service.upsert(row);
        stats.seeded++;
        consecutiveErrors = 0;
        const mult = stored?.partout_multiple != null ? Number(stored.partout_multiple) : null;
        const sold = stored?.sold_6mo_avg_gbp != null ? Number(stored.sold_6mo_avg_gbp) : null;
        const rrp = stored?.uk_retail_gbp != null ? Number(stored.uk_retail_gbp) : null;
        seededRows.push({ set: t.set_number, name: res.setName, multiple: mult, sold, rrp });
        console.log(
          `[backfill] ${i + 1}/${targets.length} ${t.set_number} ${res.setName ?? ''} — ` +
            `sold ${sold != null ? '£' + sold.toFixed(2) : '?'} | RRP ${rrp != null ? '£' + rrp.toFixed(2) : 'n/a'} | ` +
            `${mult != null ? mult.toFixed(2) + '×' : 'n/a'}`,
        );
      } catch (e) {
        if (e instanceof NotFoundError) {
          stats.noData++;
          console.log(`[backfill] ${i + 1}/${targets.length} ${t.set_number} — no POV data, skip`);
        } else if (e instanceof EmptyResponseError || e instanceof CaptchaError || e instanceof LoginRequiredError) {
          stats.stoppedEarly = true;
          stats.stopReason = `${(e as Error).name}: ${(e as Error).message}`;
          console.error(`[backfill] STOP — ${stats.stopReason}`);
          console.error('[backfill] BL throttled this IP. Wait ~10 min OR switch VPN endpoint, then re-run the SAME command — it resumes from where it stopped (skip-fresh).');
          break;
        } else {
          stats.errors++;
          consecutiveErrors++;
          console.error(`[backfill] ${t.set_number} error: ${(e as Error).message}`);
          if (consecutiveErrors >= 5) {
            stats.stoppedEarly = true;
            stats.stopReason = '5 consecutive errors';
            console.error('[backfill] STOP — 5 consecutive errors');
            break;
          }
        }
      }

      // Gentle, non-robotic pacing: jittered gap between scrapes, longer cooldown every N scrapes.
      // (Only real scrapes reach here — skip-fresh `continue`s above incur no delay.)
      if (i < targets.length - 1) {
        const scraped = stats.seeded + stats.noData + stats.errors;
        if (scraped > 0 && scraped % cooldownEvery === 0) {
          console.log(`[backfill] cooldown ${Math.round(cooldownMs / 1000)}s after ${scraped} scrapes…`);
          await sleep(cooldownMs);
        } else {
          await sleep(jitter(baseDelayMs));
        }
      }
    }
  } finally {
    if (!DRY_RUN) await scraper.close();
  }

  stats.topOpportunities = seededRows
    .filter((r) => r.multiple != null)
    .sort((a, b) => (b.multiple as number) - (a.multiple as number))
    .slice(0, 10)
    .map((r) => ({ set: r.set, name: r.name, multiple: +(r.multiple as number).toFixed(2), sold: r.sold, rrp: r.rrp }));

  const summary = { ...stats, finishedAt: new Date().toISOString() };
  fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2));

  console.log('\n=== POV BACKFILL SUMMARY ===');
  console.log(`seeded=${stats.seeded} skippedFresh=${stats.skippedFresh} noData=${stats.noData} errors=${stats.errors}`);
  if (stats.stoppedEarly) console.log(`STOPPED EARLY: ${stats.stopReason}`);
  console.log('Top part-out multiples:');
  for (const o of stats.topOpportunities) {
    console.log(`  ${o.multiple}×  ${o.set} ${o.name ?? ''} (sold £${o.sold?.toFixed(2) ?? '?'} / RRP £${o.rrp?.toFixed(2) ?? '?'})`);
  }
  console.log(`\nSummary written to ${SUMMARY_FILE}`);
}

main().catch((e) => {
  console.error('[backfill] fatal:', e);
  process.exit(1);
});
