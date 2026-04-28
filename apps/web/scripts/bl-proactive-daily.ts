/**
 * BL proactive daily store evaluation.
 *
 * Picks the next pending UK store from tmp/bl-store-queue.json, scrapes it (no API), runs the
 * stale-pricing screener (cache-only, no API), updates the queue with the verdict, and emails
 * a summary to the user. Designed for Windows Task Scheduler at e.g. 09:00 daily.
 *
 * Critical design points:
 *   - ZERO BL API calls (--api-budget=0 forced)
 *   - Skips silently if CDP Chrome isn't on :9222 — emails the reason rather than crashing
 *   - Single-store-per-run: BL won't flag this volume as scraping
 *   - All cart-build phases skipped (--skip-cart) — humans control money
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/bl-proactive-daily.ts
 *   cd apps/web && npx tsx scripts/bl-proactive-daily.ts --dry-run   # don't update queue / email
 */
import * as path from 'path';
import * as fs from 'fs';
import { spawnSync } from 'child_process';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
import { Resend } from 'resend';
import { loadQueue, saveQueue, pickNext, markScreened, type ScreenVerdict } from './bl-store-queue';

const argv = process.argv.slice(2).reduce<Record<string, string>>((acc, a) => { const [k, v] = a.replace(/^--/, '').split('='); acc[k] = v ?? 'true'; return acc; }, {});
const DRY_RUN = argv['dry-run'] === 'true';
const STORE_OVERRIDE = argv['store-slug']; // optional: force a specific store (skip queue picking)
const CDP_PORT = parseInt(argv['cdp-port'] ?? '9222', 10);
// Resend test-mode accounts can only send to verified domain addresses; default to the
// business mailbox tied to the verified hadleybricks.co.uk domain. Override via
// PROACTIVE_EMAIL_TO env var or --email-to= flag.
const SMTP_TO = argv['email-to'] ?? process.env.PROACTIVE_EMAIL_TO ?? 'chris@hadleybricks.co.uk';
// Full-enrich mode: spend BL API budget to find actual arbitrage. Mid-loop checkpoint (PR #356)
// auto-aborts if the store turns out priced-above-market, so cost on a dud is bounded ~50 calls.
// Default off — daily cron is cache-only. Set --full-enrich for on-demand deep scans.
const FULL_ENRICH = argv['full-enrich'] === 'true';

interface ScreenResult {
  cacheCovered: number;
  medianRatio: number | null;
  p25: number | null;
  p75: number | null;
  bargainBombs: number;
  verdict: ScreenVerdict;
  inventoryCount?: number;
  scrapedAt?: string;
}

async function checkCdpOnline(): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch { return false; }
}

async function sendEmail(subject: string, text: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(`[proactive] RESEND_API_KEY missing — skipping email. Subject was: ${subject}`);
    console.log('---');
    console.log(text);
    return;
  }
  const resend = new Resend(apiKey);
  const from = process.env.PROACTIVE_EMAIL_FROM ?? 'Hadley Bricks <onboarding@resend.dev>';
  const { error } = await resend.emails.send({ from, to: SMTP_TO, subject, text });
  if (error) {
    console.error(`[proactive] Resend error: ${JSON.stringify(error)}`);
    return;
  }
  console.log(`[proactive] Email sent to ${SMTP_TO}: ${subject}`);
}

async function main() {
  console.log(`==== BL Proactive Daily ====\n${new Date().toISOString()}\n`);

  // Pre-flight: CDP must be running.
  const cdpUp = await checkCdpOnline();
  if (!cdpUp) {
    console.error('[proactive] CDP Chrome not running on :' + CDP_PORT);
    if (!DRY_RUN) await sendEmail('[Hadley Bricks] BL proactive: skipped (CDP offline)', `CDP Chrome wasn't reachable on :${CDP_PORT} when the daily proactive run kicked off.\n\nStart C:\\chrome-cdp\\launch-cdp-chrome.bat, log in to BrickLink, and the next run will pick up automatically.`);
    process.exit(0);
  }

  // Pick a store: explicit override, else queue.
  const queue = loadQueue();
  let slug: string;
  if (STORE_OVERRIDE) {
    slug = STORE_OVERRIDE;
    console.log(`[proactive] Using --store-slug override: ${slug}`);
  } else {
    const next = pickNext(queue);
    if (!next) {
      console.log('[proactive] Queue empty / all stores in skipUntil window. Nothing to do.');
      if (!DRY_RUN) await sendEmail('[Hadley Bricks] BL proactive: queue empty', 'Nothing to screen today — queue is empty or all stores are in their skipUntil window.\n\nAdd candidates by running a manual bl-basket cart build (auto-harvests buy-page candidates) or by editing tmp/bl-store-queue.json directly.');
      process.exit(0);
    }
    slug = next.slug;
    console.log(`[proactive] Picked from queue: ${slug} (last screened ${next.lastScreenedAt ?? 'never'}, addedFrom ${next.addedFrom})`);
  }

  // Run bl-basket as subprocess: scrape + screen.
  // Pass relative path to avoid windows-shell-quoting issues with spaces in absolute paths.
  // Full-enrich mode adds the proven arbitrage gates and drops --api-budget=0 so the API loop
  // runs (with mid-loop checkpoint protection from PR #356 to bound cost on duds).
  const baseArgs = ['tsx', 'scripts/bl-basket.ts', `--store-slug=${slug}`, '--shipping=3.00', '--skip-cart', '--yes'];
  const enrichArgs = FULL_ENRICH
    ? ['--min-ask=0.10', '--min-margin=0.35', '--min-str=0.25']
    : ['--api-budget=0'];
  const args = [...baseArgs, ...enrichArgs];
  console.log(`[proactive] Running ${args.slice(1).join(' ')}  (mode=${FULL_ENRICH ? 'FULL-ENRICH' : 'cache-only'})`);
  const proc = spawnSync('npx', args, {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    timeout: 45 * 60 * 1000, // 45 min hard cap (full enrichment of a huge store can take ~30min)
    shell: true,
    env: process.env,
  });

  // Surface bl-basket's exit + key log lines.
  if (proc.status !== 0) {
    console.error(`[proactive] bl-basket exited ${proc.status}`);
    console.error(proc.stderr?.slice(-2000) ?? '(no stderr)');
    if (!DRY_RUN) {
      markScreened(queue, slug, 'errored', null);
      saveQueue(queue);
      await sendEmail(`[Hadley Bricks] BL proactive: errored on ${slug}`, `bl-basket exited with code ${proc.status} for store ${slug}.\n\nLast stderr:\n${proc.stderr?.slice(-1500) ?? '(empty)'}\n\nLast stdout:\n${proc.stdout?.slice(-1500) ?? '(empty)'}`);
    }
    process.exit(1);
  }

  // Read the latest screen-<date>.json file from tmp/stores/<slug>/
  const screenDir = path.resolve(__dirname, '../../../tmp/stores', slug);
  const screenFiles = fs.existsSync(screenDir) ? fs.readdirSync(screenDir).filter((f) => f.startsWith('screen-')).sort().reverse() : [];
  if (screenFiles.length === 0) {
    console.error('[proactive] No screen file found in', screenDir);
    if (!DRY_RUN) await sendEmail(`[Hadley Bricks] BL proactive: ran but no screen output for ${slug}`, `bl-basket completed but no screen-<date>.json file was written. Possibly cache coverage was 0. Check tmp/stores/${slug}/ for inventory.json.`);
    process.exit(1);
  }
  const screen: ScreenResult = JSON.parse(fs.readFileSync(path.join(screenDir, screenFiles[0]), 'utf8'));

  // Update queue.
  if (!DRY_RUN) {
    markScreened(queue, slug, screen.verdict, {
      cacheCovered: screen.cacheCovered,
      medianRatio: screen.medianRatio,
      bargainBombs: screen.bargainBombs,
      inventoryCount: screen.inventoryCount ?? 0,
    });
    saveQueue(queue);
  }

  // Email summary.
  const isPromising = screen.verdict === 'promising';
  const subject = isPromising
    ? `[Hadley Bricks] PROMISING store: ${slug} (${screen.bargainBombs} bargain bombs)`
    : `[Hadley Bricks] BL proactive: ${slug} = ${screen.verdict.replace(/_/g, ' ')}`;
  const body = [
    `Daily store eval: ${slug}`,
    `Verdict: ${screen.verdict.toUpperCase()}`,
    '',
    `Inventory: ${screen.inventoryCount ?? '?'} items`,
    `Cache-covered items: ${screen.cacheCovered}`,
    `Median ask ÷ UK 6MA: ${screen.medianRatio?.toFixed(2) ?? 'n/a'}  (P25/P75: ${screen.p25?.toFixed(2) ?? '-'} / ${screen.p75?.toFixed(2) ?? '-'})`,
    `Bargain bombs: ${screen.bargainBombs}  (cache STR ≥ 0.50, undamaged, est. margin ≥ 35%)`,
    '',
    isPromising ? `Worth a closer look. To run full enrichment + cart build:\n  cd apps/web\n  npx tsx scripts/bl-basket.ts --store-slug=${slug} --shipping=3.00 --min-margin=0.35 --min-str=0.25 --yes` : `Skipping — verdict ${screen.verdict}. ${screen.verdict === 'priced_above_market' ? 'Store priced at-or-above UK 6MA — likely dynamic pricer.' : screen.verdict === 'low_priority' ? 'Below market but not enough bargain bombs to be worth API spend.' : 'Insufficient cache coverage — re-screen as cache grows.'}`,
    '',
    `Re-screen scheduled: ${queue.stores.find((s) => s.slug === slug)?.skipUntil?.slice(0, 10) ?? 'auto'}`,
  ].join('\n');

  if (DRY_RUN) {
    console.log('---DRY RUN---');
    console.log('Subject:', subject);
    console.log('---');
    console.log(body);
  } else {
    await sendEmail(subject, body);
  }

  console.log(`[proactive] Done. Verdict: ${screen.verdict}`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
