/**
 * Batch-run the proactive daily evaluation N times in sequence.
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/bl-proactive-batch.ts --count=10
 *   cd apps/web && npx tsx scripts/bl-proactive-batch.ts --count=10 --min-delay-sec=120 --max-delay-sec=300
 *
 * Each iteration:
 *   1. Spawns bl-proactive-daily as subprocess (which picks next from queue, scrapes, screens, emails)
 *   2. Waits 2-5 min (random, configurable) before next iteration
 *
 * Stops early if:
 *   - bl-proactive-daily exits non-zero
 *   - queue empty (proactive runner emails "queue empty" and returns)
 *
 * Designed for "let's pre-scan a batch" use case — caches up multiple stores in one
 * sitting at low traffic rate. Anti-bot safe (3s/page baked into bl-basket scraping;
 * a few minutes between stores is more than enough to avoid concentrated patterns).
 */
import * as path from 'path';
import * as fs from 'fs';
import { spawnSync } from 'child_process';

const argv = process.argv.slice(2).reduce<Record<string, string>>((acc, a) => { const [k, v] = a.replace(/^--/, '').split('='); acc[k] = v ?? 'true'; return acc; }, {});
const COUNT = parseInt(argv['count'] ?? '10', 10);
const MIN_DELAY_SEC = parseInt(argv['min-delay-sec'] ?? '120', 10);
const MAX_DELAY_SEC = parseInt(argv['max-delay-sec'] ?? '300', 10);
const DRY_RUN = argv['dry-run'] === 'true';
const FULL_ENRICH = argv['full-enrich'] === 'true';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`==== BL Proactive Batch ====`);
  console.log(`Count:        ${COUNT}`);
  console.log(`Inter-run delay: ${MIN_DELAY_SEC}-${MAX_DELAY_SEC}s random`);
  console.log(`Dry-run:      ${DRY_RUN}\n`);

  const startedAt = Date.now();
  let done = 0, errors = 0, queueEmpty = false;

  for (let i = 0; i < COUNT; i++) {
    if (queueEmpty) break;
    const iterStart = Date.now();
    console.log(`\n[${i + 1}/${COUNT}] starting at ${new Date().toISOString()} ...`);

    const args = ['tsx', 'scripts/bl-proactive-daily.ts'];
    if (DRY_RUN) args.push('--dry-run');
    if (FULL_ENRICH) args.push('--full-enrich');
    const proc = spawnSync('npx', args, {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      timeout: 30 * 60 * 1000,
      shell: true,
      env: process.env,
    });

    if (proc.status !== 0) {
      console.error(`[${i + 1}/${COUNT}] EXIT ${proc.status}`);
      console.error(proc.stderr?.slice(-1000) ?? '');
      errors++;
      // Stop on error — better safe than spamming.
      break;
    }

    // Pick a few signal lines from stdout so the meta log is useful.
    const stdout = proc.stdout ?? '';
    const summaryLines = stdout.split('\n').filter((l) => /Picked from queue|Verdict|Email sent|queue empty|skipped/i.test(l)).map((l) => '   ' + l.trim());
    console.log(summaryLines.join('\n') || '   (no summary lines found in stdout)');

    if (/queue empty/i.test(stdout)) {
      console.log(`[${i + 1}/${COUNT}] queue exhausted — stopping early`);
      queueEmpty = true;
      done++;
      break;
    }

    done++;
    const iterMs = Date.now() - iterStart;
    console.log(`[${i + 1}/${COUNT}] done in ${(iterMs / 1000).toFixed(0)}s`);

    // Inter-run delay — randomised within configured range, only if not the last iteration.
    if (i < COUNT - 1) {
      const delaySec = MIN_DELAY_SEC + Math.floor(Math.random() * (MAX_DELAY_SEC - MIN_DELAY_SEC + 1));
      console.log(`   sleeping ${delaySec}s before next iteration ...`);
      await sleep(delaySec * 1000);
    }
  }

  const elapsedMin = ((Date.now() - startedAt) / 60_000).toFixed(1);
  console.log(`\n==== Batch done ====`);
  console.log(`Iterations completed: ${done}/${COUNT}`);
  console.log(`Errors:               ${errors}`);
  console.log(`Total elapsed:        ${elapsedMin} min`);
  console.log(`Queue empty:          ${queueEmpty}`);

  // Final queue snapshot
  const queuePath = path.resolve(__dirname, '../../../tmp/bl-store-queue.json');
  if (fs.existsSync(queuePath)) {
    const q = JSON.parse(fs.readFileSync(queuePath, 'utf8')) as { stores: Array<{ lastVerdict: string | null }> };
    const verdicts = q.stores.reduce<Record<string, number>>((acc, s) => { const k = s.lastVerdict ?? 'pending'; acc[k] = (acc[k] || 0) + 1; return acc; }, {});
    console.log(`Queue verdict counts: ${JSON.stringify(verdicts)}`);
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
