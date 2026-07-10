/**
 * store-assessment-batch.ts — nightly sweep over the store watchlist.
 *
 * Picks due `store_assessment_watchlist` entries — never-assessed first, then by
 * verdict cadence (BUY 7d / REVIEW 14d / SKIP 60d, most overdue first) — runs the
 * single-store assess CLI for each (light mode — caches only, one polite scrape per
 * store), then Discord-alerts anything card-worthy: BUY verdicts, buyable-net jumps,
 * price drops, or promising first assessments. Each store runs in a CHILD PROCESS so
 * one bad store can't take the night down.
 *
 * Every ~90 days the sweep also re-scans the BL UK store directory (England group,
 * one slow page-load) and adds newly-opened stores to the watchlist.
 *
 * Usage:
 *   npx tsx scripts/store-assessment-batch.ts [--budget=25] [--min-age-days=5]
 *     [--store-slugs=a,b,c] [--pace-min-s=20] [--pace-max-s=45] [--mode=light]
 *     [--seed] [--dry-run] [--no-discord]
 *     [--sync-directory] [--directory-max-age-days=90] [--min-items=50]
 *
 *   --seed            upsert watchlist entries from assessed stores + arbitrage purchases, then exit
 *   --dry-run         print tonight's selection and exit (no store scraping)
 *   --sync-directory  force the England directory scan now (combine with --dry-run to only discover)
 *
 * Scheduled nightly via scripts/register-store-assessment-batch-task.ps1; needs the
 * CDP Chrome (:9222) up. Pacing is deliberately slow + jittered — see
 * feedback_gentle_external_scraping.
 */
import { createClient } from '@supabase/supabase-js';
import { spawnSync } from 'child_process';
import * as dotenv from 'dotenv';
import * as path from 'path';
import {
  planSweep, classifyDelta, type WatchlistCandidate, type RunSnapshot, type DeltaAlert,
} from '../src/lib/bl-store-assessment/batch';
import { connectCdp } from './lib/store-scrape';
import { scrapeEnglandStores } from './lib/store-directory';

dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

const argv = process.argv.slice(2).reduce<Record<string, string>>((acc, a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  acc[k] = v ?? 'true';
  return acc;
}, {});

const BUDGET = parseInt(argv['budget'] ?? '25', 10);
const MIN_AGE_DAYS = parseFloat(argv['min-age-days'] ?? '5');
const PACE_MIN_S = parseInt(argv['pace-min-s'] ?? '20', 10);
const PACE_MAX_S = parseInt(argv['pace-max-s'] ?? '45', 10);
const MODE = argv['mode'] === 'full' ? 'full' : 'light';
const SEED = argv['seed'] === 'true';
const DRY_RUN = argv['dry-run'] === 'true';
const NO_DISCORD = argv['no-discord'] === 'true';
const EXPLICIT_SLUGS = argv['store-slugs']?.split(',').map((s) => s.trim()).filter(Boolean) ?? null;
const CDP_PORT = parseInt(argv['cdp-port'] ?? '9222', 10);
// Quarterly England store-directory discovery.
const SYNC_DIRECTORY = argv['sync-directory'] === 'true';
const DIRECTORY_MAX_AGE_DAYS = parseFloat(argv['directory-max-age-days'] ?? '90');
const DIRECTORY_MIN_ITEMS = parseInt(argv['min-items'] ?? '50', 10);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) { console.error('Missing Supabase env'); process.exit(1); }
const supabase = createClient(supabaseUrl, supabaseKey);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitteredPaceMs = () => (PACE_MIN_S + Math.random() * Math.max(0, PACE_MAX_S - PACE_MIN_S)) * 1000;

async function resolveUserId(): Promise<string> {
  const fromEnv = argv['user-id'] ?? process.env.STORE_ASSESSMENT_USER_ID;
  if (fromEnv) return fromEnv;
  const res = await supabase.from('bricqer_inventory_snapshot').select('user_id').limit(1000);
  if (res.error) throw new Error(`resolveUserId: ${res.error.message}`);
  const owners = [...new Set((res.data ?? []).map((r) => r.user_id as string))];
  if (owners.length !== 1) throw new Error(`resolveUserId: ${owners.length} snapshot owners — set STORE_ASSESSMENT_USER_ID`);
  return owners[0];
}

// ---- seeding ---------------------------------------------------------------

async function seedWatchlist(userId: string): Promise<void> {
  const rows = new Map<string, { store_slug: string; store_name: string | null; source: string }>();
  const { data: assessed, error: e1 } = await supabase
    .from('store_assessments').select('store_slug,store_name').eq('user_id', userId).limit(1000);
  if (e1) throw e1;
  for (const r of assessed ?? []) rows.set(r.store_slug, { store_slug: r.store_slug, store_name: r.store_name, source: 'assessed' });
  const { data: purchases, error: e2 } = await supabase
    .from('arbitrage_purchases').select('store_slug').eq('user_id', userId).limit(1000);
  if (e2) throw e2;
  for (const r of purchases ?? []) {
    if (!rows.has(r.store_slug)) rows.set(r.store_slug, { store_slug: r.store_slug, store_name: null, source: 'arbitrage_purchase' });
  }
  if (rows.size === 0) { console.log('[seed] nothing to seed'); return; }
  const { error } = await supabase
    .from('store_assessment_watchlist')
    .upsert([...rows.values()].map((r) => ({ user_id: userId, ...r })), { onConflict: 'user_id,store_slug', ignoreDuplicates: true });
  if (error) throw error;
  console.log(`[seed] watchlist upserted ${rows.size} candidate stores`);
}

// ---- quarterly directory discovery ------------------------------------------

/**
 * One slow page-load of the BL UK store directory; new England stores land on the
 * watchlist. Runs when the latest store_directory_scans row is older than
 * DIRECTORY_MAX_AGE_DAYS (or --sync-directory forces it) — four times a year.
 */
async function syncDirectoryIfDue(userId: string): Promise<void> {
  if (!SYNC_DIRECTORY) {
    const { data } = await supabase
      .from('store_directory_scans')
      .select('scanned_at')
      .eq('user_id', userId)
      .order('scanned_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data && (Date.now() - Date.parse(data.scanned_at)) / 86400000 < DIRECTORY_MAX_AGE_DAYS) return;
    console.log(`[directory] last scan ${data ? data.scanned_at.slice(0, 10) : 'never'} — due, scanning England stores...`);
  } else {
    console.log('[directory] forced scan (--sync-directory)...');
  }

  const cdp = await connectCdp(CDP_PORT, 'browseStores');
  let stores;
  let totalUkOpen: number | null;
  try {
    ({ stores, totalUkOpen } = await scrapeEnglandStores(cdp));
  } finally {
    cdp.close();
  }
  if (stores.length === 0) throw new Error('[directory] scrape returned 0 England stores — page structure changed?');

  const bigEnough = stores.filter((s) => s.items >= DIRECTORY_MIN_ITEMS);
  const skippedSmall = stores.length - bigEnough.length;

  // Existing slugs (paginate — watchlist may exceed 1,000 once seeded).
  const existing = new Set<string>();
  for (let from = 0; from < 10000; from += 1000) {
    const { data, error } = await supabase
      .from('store_assessment_watchlist')
      .select('store_slug')
      .eq('user_id', userId)
      .order('store_slug', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    for (const r of data ?? []) existing.add(r.store_slug);
    if (!data || data.length < 1000) break;
  }

  const fresh = bigEnough.filter((s) => !existing.has(s.slug));
  for (let i = 0; i < fresh.length; i += 500) {
    const batch = fresh.slice(i, i + 500).map((s) => ({
      user_id: userId, store_slug: s.slug, store_name: s.name, source: 'directory',
      region: 'England', directory_items: s.items,
      notes: `directory scan ${new Date().toISOString().slice(0, 10)} · ${s.items.toLocaleString()} items`,
    }));
    const { error } = await supabase
      .from('store_assessment_watchlist')
      .upsert(batch, { onConflict: 'user_id,store_slug', ignoreDuplicates: true });
    if (error) throw error;
  }

  const { error: logErr } = await supabase.from('store_directory_scans').insert({
    user_id: userId, region: 'England',
    stores_found: stores.length, stores_added: fresh.length, stores_skipped_small: skippedSmall,
  });
  if (logErr) console.error(`[directory] scan log failed: ${logErr.message}`);

  console.log(`[directory] England: ${stores.length} stores (UK total ${totalUkOpen ?? '?'}) · ${fresh.length} new added · ${skippedSmall} skipped <${DIRECTORY_MIN_ITEMS} items`);
  await postDiscord('DISCORD_WEBHOOK_SYNC_STATUS', {
    content: `🗺️ BL directory scan: ${stores.length} England stores (${totalUkOpen ?? '?'} UK open) → **${fresh.length} new** on the watchlist (${skippedSmall} skipped as <${DIRECTORY_MIN_ITEMS} items). Next scan in ~${DIRECTORY_MAX_AGE_DAYS} days.`,
  });
}

// ---- selection -------------------------------------------------------------

async function loadCandidates(userId: string): Promise<WatchlistCandidate[]> {
  // Watchlist can exceed 1,000 rows once the England directory is seeded — paginate.
  const wl: Array<{ store_slug: string; store_name: string | null }> = [];
  for (let from = 0; from < 10000; from += 1000) {
    const { data, error } = await supabase
      .from('store_assessment_watchlist')
      .select('store_slug,store_name')
      .eq('user_id', userId).eq('enabled', true)
      .order('store_slug', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    wl.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  // Latest scanned_at + verdict per slug (paginate — CLAUDE.md 1,000-row rule).
  const lastBySlug = new Map<string, { scannedAt: string; verdict: string | null }>();
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error: e } = await supabase
      .from('store_assessments')
      .select('store_slug,scanned_at,verdict')
      .eq('user_id', userId)
      .order('scanned_at', { ascending: false })
      .range(from, from + 999);
    if (e) throw e;
    for (const r of data ?? []) if (!lastBySlug.has(r.store_slug)) lastBySlug.set(r.store_slug, { scannedAt: r.scanned_at, verdict: r.verdict });
    if (!data || data.length < 1000) break;
  }

  return wl.map((w) => ({
    storeSlug: w.store_slug,
    storeName: w.store_name,
    lastScannedAt: lastBySlug.get(w.store_slug)?.scannedAt ?? null,
    lastVerdict: lastBySlug.get(w.store_slug)?.verdict ?? null,
  }));
}

async function latestSnapshot(userId: string, slug: string): Promise<(RunSnapshot & { scannedAt: string }) | null> {
  const { data } = await supabase
    .from('store_assessments')
    .select('scanned_at,grade,verdict,buyable_lots,buyable_net_gbp,buyable_fresh_lots,median_ask_vs_market,total_value')
    .eq('user_id', userId).eq('store_slug', slug)
    .order('scanned_at', { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  return {
    scannedAt: data.scanned_at,
    grade: data.grade == null ? null : Number(data.grade),
    verdict: data.verdict,
    buyableLots: data.buyable_lots,
    buyableNetGbp: data.buyable_net_gbp == null ? null : Number(data.buyable_net_gbp),
    buyableFreshLots: data.buyable_fresh_lots,
    medianAskVsMarket: data.median_ask_vs_market == null ? null : Number(data.median_ask_vs_market),
    totalValue: data.total_value == null ? null : Number(data.total_value),
  };
}

// ---- child run -------------------------------------------------------------

interface StoreRunResult {
  slug: string;
  ok: boolean;
  error?: string;
  current?: RunSnapshot;
  storeName?: string | null;
  alerts: DeltaAlert[];
}

function runStoreChild(slug: string, userId: string): { ok: boolean; error?: string } {
  const res = spawnSync(
    'npx',
    ['tsx', 'scripts/store-assessment.ts', `--store-slug=${slug}`, `--mode=${MODE}`, `--user-id=${userId}`, `--cdp-port=${CDP_PORT}`],
    {
      cwd: path.resolve(__dirname, '..'),
      shell: true, // resolves npx.cmd on Windows
      encoding: 'utf8',
      timeout: 20 * 60 * 1000,
      env: { ...process.env, DOTENV_CONFIG_QUIET: 'true' },
    },
  );
  if (res.error) return { ok: false, error: res.error.message };
  if (res.status !== 0) {
    const tail = `${res.stderr ?? ''}`.trim().split('\n').slice(-3).join(' | ');
    return { ok: false, error: `exit ${res.status}: ${tail}` };
  }
  return { ok: true };
}

// ---- discord ---------------------------------------------------------------

async function postDiscord(webhookEnv: string, payload: object): Promise<void> {
  if (NO_DISCORD) return;
  const url = process.env[webhookEnv];
  if (!url) { console.error(`[discord] ${webhookEnv} not set — skipping`); return; }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) console.error(`[discord] ${webhookEnv} HTTP ${res.status}`);
}

function alertCard(r: StoreRunResult): object {
  const c = r.current!;
  const name = r.storeName ?? r.slug;
  return {
    embeds: [{
      title: `🏪 ${name} — ${c.verdict ?? '?'} (grade ${c.grade ?? '?'})`,
      url: `https://store.bricklink.com/${encodeURIComponent(r.slug)}#/shop`,
      color: c.verdict === 'BUY' ? 0x2ecc71 : 0xf1c40f,
      description: r.alerts.map((a) => `• ${a.headline}`).join('\n'),
      fields: [
        { name: 'Buyable', value: `${c.buyableLots ?? '—'} lots · £${(c.buyableNetGbp ?? 0).toFixed(2)} net`, inline: true },
        { name: 'Fresh (new/restock)', value: `${c.buyableFreshLots ?? '—'} lots`, inline: true },
        { name: 'Prices vs market', value: c.medianAskVsMarket != null ? `${Math.round(c.medianAskVsMarket * 100)}%` : '—', inline: true },
      ],
      footer: { text: `store-assessment nightly sweep · /arbitrage/store-assessment/${r.slug}` },
    }],
  };
}

// ---- main ------------------------------------------------------------------

async function main() {
  const userId = await resolveUserId();

  if (SEED) { await seedWatchlist(userId); return; }

  // Quarterly England directory discovery (one slow page-load, 4×/year).
  try {
    await syncDirectoryIfDue(userId);
  } catch (e) {
    console.error(`[directory] sync failed (sweep continues): ${(e as Error).message}`);
    await postDiscord('DISCORD_WEBHOOK_ALERTS', { content: `⚠️ BL directory scan failed: ${(e as Error).message}` });
  }

  let plan: WatchlistCandidate[];
  if (EXPLICIT_SLUGS) {
    plan = EXPLICIT_SLUGS.map((s) => ({ storeSlug: s, storeName: null, lastScannedAt: null, lastVerdict: null }));
  } else {
    const candidates = await loadCandidates(userId);
    plan = planSweep(candidates, { budget: BUDGET, minAgeDays: MIN_AGE_DAYS, now: new Date() });
    const never = plan.filter((p) => p.lastScannedAt == null).length;
    console.log(`[plan] ${candidates.length} watchlist stores → ${plan.length} selected (${never} never assessed; budget ${BUDGET}, cadence BUY 7d / REVIEW 14d / SKIP 60d)`);
  }
  for (const p of plan) console.log(`  - ${p.storeSlug}${p.lastScannedAt ? ` (last ${p.lastScannedAt.slice(0, 10)}, ${p.lastVerdict ?? '?'})` : ' (never assessed)'}`);
  if (DRY_RUN) return;
  if (plan.length === 0) { console.log('[plan] nothing stale enough tonight'); return; }

  // One up-front CDP check — abort cleanly instead of failing every store.
  const cdpUp = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then((r) => r.ok).catch(() => false);
  if (!cdpUp) {
    console.error(`[cdp] Chrome CDP not reachable on :${CDP_PORT} — aborting sweep`);
    await postDiscord('DISCORD_WEBHOOK_ALERTS', { content: `⚠️ store-assessment sweep aborted — CDP Chrome not reachable on :${CDP_PORT}` });
    process.exit(1);
  }

  const results: StoreRunResult[] = [];
  for (let i = 0; i < plan.length; i++) {
    const { storeSlug: slug, storeName } = plan[i];
    console.log(`\n[${i + 1}/${plan.length}] ${slug}...`);
    const previous = await latestSnapshot(userId, slug);
    const run = runStoreChild(slug, userId);
    if (!run.ok) {
      console.error(`  ✗ ${run.error}`);
      results.push({ slug, ok: false, error: run.error, alerts: [] });
    } else {
      let current = await latestSnapshot(userId, slug); // the row the child just persisted
      if (current && previous && current.scannedAt === previous.scannedAt) {
        // Child exited 0 but no new row landed (persist failure) — don't re-alert old data.
        console.error('  ⚠ no new assessment row persisted — skipping delta');
        current = null;
      }
      const alerts = current ? classifyDelta(current, previous) : [];
      const r: StoreRunResult = { slug, ok: true, current: current ?? undefined, storeName, alerts };
      results.push(r);
      console.log(`  ✓ ${current?.verdict ?? '?'} grade ${current?.grade ?? '?'} · £${(current?.buyableNetGbp ?? 0).toFixed(2)} net · ${current?.buyableFreshLots ?? '—'} fresh${alerts.length ? `  → ALERT: ${alerts[0].kind}` : ''}`);
      if (alerts.length) await postDiscord('DISCORD_WEBHOOK_OPPORTUNITIES', alertCard(r));
    }
    if (i < plan.length - 1) await sleep(jitteredPaceMs());
  }

  // League table + run summary.
  const ok = results.filter((r) => r.ok && r.current);
  const failed = results.filter((r) => !r.ok);
  const top = [...ok].sort((a, b) => (b.current!.buyableNetGbp ?? 0) - (a.current!.buyableNetGbp ?? 0)).slice(0, 5);
  console.log(`\n=== SWEEP SUMMARY: ${ok.length} assessed, ${failed.length} failed, ${results.filter((r) => r.alerts.length).length} alerts ===`);
  for (const r of top) console.log(`  ${r.slug.padEnd(24)} ${r.current!.verdict?.padEnd(7)} £${(r.current!.buyableNetGbp ?? 0).toFixed(2).padStart(8)} net · ${r.current!.buyableFreshLots ?? '—'} fresh`);
  for (const r of failed) console.log(`  FAILED ${r.slug}: ${r.error}`);

  await postDiscord('DISCORD_WEBHOOK_SYNC_STATUS', {
    content: [
      `🧭 store-assessment sweep: **${ok.length}** assessed, ${failed.length} failed, ${results.filter((r) => r.alerts.length).length} alert(s).`,
      ...top.slice(0, 3).map((r) => `• ${r.storeName ?? r.slug}: ${r.current!.verdict} · £${(r.current!.buyableNetGbp ?? 0).toFixed(2)} net · ${r.current!.buyableFreshLots ?? '—'} fresh`),
    ].join('\n'),
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
