export const meta = {
  name: 'validate-ebay-pricing-local',
  description: 'E2E validation of PR #476 — ebay-pricing moved off Vercel to the local bot — against live systems',
  whenToUse:
    'After merging + deploying PR #476 (ebay-pricing local migration), to independently confirm the GCP job is paused, the Windows task is scheduled, the local runner drives the localhost route to completion, the merge deployed cleanly, and ebay-pricing will keep running daily without double-running on Vercel.',
  phases: [
    { title: 'Validate', detail: 'one read-only validator per dimension (git/prod + live gcloud + Windows task + local route + Supabase)' },
    { title: 'Verify', detail: 'adversarially re-check any FAIL/WARN finding' },
    { title: 'Synthesize', detail: 'PASS/FAIL E2E report with the honest rolling-window caveat' },
  ],
};

const CTX = `
CONTEXT — you are validating, on LIVE systems, the change set PR #476 "move ebay-pricing off Vercel to the local bot". GOAL of the change: stop the daily eBay arbitrage pricing batch from executing on Vercel (to widen Vercel Fluid Active CPU headroom after the 26 Jun cuts), by running it on the LOCAL Windows bot instead.

WHY ebay-pricing ran on Vercel: the GCP Cloud Scheduler job \`ebay-pricing-sync\` targets a Cloud Run driver (gcp/functions/pricing-sync-driver) that LOOPS calling the Vercel route https://hadley-bricks-inventory-management.vercel.app/api/cron/ebay-pricing until the route returns { complete: true }. So the work executed ON Vercel. It is a once-daily, cursor-resumable batch: it prices up to 1,000 watchlist items/day in 100-item chunks (~10 chunks, all in a ~5-minute burst at 02:00 UTC, ~209 wall-s/day, ~100 CPU-s/day). It was the #1 untouched Vercel pricing job after PR #471.

THE CHANGE (PR #476, squash-merged to origin/main, expected HEAD commit ca42bdd4):
(A) NEW scripts/run-ebay-pricing.ps1 — a LOCAL runner that loops POSTing http://localhost:3000/api/cron/ebay-pricing (the local NSSM Next.js server, NOT vercel.app) until { complete: true }, mirroring the Cloud Run driver loop. Reads CRON_SECRET from apps/web/.env.local. Bounded by maxIterations (20) and aborts after 3 consecutive HTTP errors. exit 0 only on complete:true.
(B) NEW scripts/register-ebay-pricing-task.ps1 — registers Windows Scheduled Task "HadleyBricks-Ebay-Pricing-Local" to run run-ebay-pricing.ps1 daily at 03:00 local.
(C) GCP \`ebay-pricing-sync\` Cloud Scheduler job was PAUSED (was schedule "0 2 * * *") so the work no longer executes on Vercel. Reversible (gcloud scheduler jobs resume).
(D) docs updated: docs/functional/reference/cron-jobs.md, docs/vercel-cpu-reduction-2026-06-26.md.
NO apps/web source changed — the served Next bundle is identical; the route /api/cron/ebay-pricing still exists on prod AND on the local server (it was NOT removed, just no longer called from GCP).

IMPORTANT LEADING-INDICATOR CAVEAT: this validation runs the SAME DAY as the change. Today's eBay pricing already completed at 02:04 UTC via the (then-still-enabled) GCP job, so arbitrage_sync_status for job_type='ebay_scheduled_pricing' shows sync_date=TODAY, cursor_position=1000, status=completed. That means invoking the local runner TODAY will hit the route's "daily limit reached" early-return and return complete:true WITHOUT pricing anything — a safe no-op that proves the localhost integration (reachability + auth + loop + complete-detection) but NOT the multi-batch pricing path. The first REAL local multi-batch run happens tomorrow 01/07 at 03:00 local (new day -> cursor resets -> full 1,000-item run). Treat the no-op as sufficient proof of the integration; the route's pricing LOGIC is unchanged from what already ran successfully on Vercel.

ENVIRONMENT:
- gcloud IS authenticated. Describe the job's live state with:
  gcloud scheduler jobs describe ebay-pricing-sync --location=europe-west2 --project=gen-lang-client-0823893317 --format="value(state,schedule)"
  List all jobs: gcloud scheduler jobs list --location=europe-west2 --project=gen-lang-client-0823893317 --format="table(name.basename(),schedule,state)"
- Windows Task Scheduler: query via Git Bash with
  powershell.exe -NoProfile -Command "schtasks /query /tn 'HadleyBricks-Ebay-Pricing-Local' /fo LIST /v"
  (look for "Scheduled Task State: Enabled", "Schedule Type: Daily", "Start Time: 03:00:00", "Next Run Time", and "Task To Run" containing run-ebay-pricing.ps1)
- Local server: http://localhost:3000 (NSSM service). The route /api/cron/ebay-pricing is POST-only + CRON_SECRET-gated.
- Prod Supabase project_id = modjoikyuhqzouxvieua. Load the SQL tool with ToolSearch "select:mcp__plugin_supabase_supabase__execute_sql". Tables: job_execution_history (job_name, trigger, duration_ms, started_at, status); arbitrage_sync_status (user_id, job_type, status, sync_date, cursor_position, items_processed, last_run_at).
- Repo: read source at scripts/run-ebay-pricing.ps1 + scripts/register-ebay-pricing-task.ps1 on origin/main. Prod URL: https://hadley-bricks-inventory-management.vercel.app

RULES: Be INDEPENDENT and ADVERSARIAL. Run gcloud / schtasks / Supabase / curl / git yourself — do NOT trust the numbers in this context block; re-derive them. READ-ONLY: do NOT resume/alter any GCP job, do NOT unregister/alter the Windows task, do NOT mutate the DB (esp. arbitrage_sync_status.cursor_position), and do NOT force a real pricing run. You MAY invoke the local runner or curl the localhost route AT MOST ONCE, and ONLY after first confirming via SQL that arbitrage_sync_status shows sync_date=today & cursor_position=1000 (so it will be a safe no-op); if it is NOT a guaranteed no-op, do a liveness curl only (a 401/405 = exists+gated = healthy) and do NOT POST with a valid secret. Report concrete evidence (exact state strings, schedules, counts, http codes, computed numbers).`;

const FINDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dimension', 'verdict', 'summary', 'evidence', 'issues'],
  properties: {
    dimension: { type: 'string' },
    verdict: { type: 'string', enum: ['PASS', 'WARN', 'FAIL'] },
    summary: { type: 'string', description: 'one-line conclusion' },
    evidence: { type: 'string', description: 'concrete state strings / schedules / counts / http codes proving it' },
    issues: {
      type: 'array',
      description: 'genuine problems found (empty if PASS)',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['item', 'problem'],
        properties: { item: { type: 'string' }, problem: { type: 'string' } },
      },
    },
  },
};

const DIMENSIONS = [
  {
    key: 'merge-deploy-live',
    prompt: `Confirm PR #476 merged + deployed and nothing broke. (1) git: fetch origin; origin/main HEAD commit subject is "chore(vercel): move ebay-pricing off Vercel to the local bot (#476)" (HEAD short sha ~ca42bdd4) and BOTH new scripts exist at that commit (git show HEAD:scripts/run-ebay-pricing.ps1 and :scripts/register-ebay-pricing-task.ps1 succeed). (2) Prod core pages healthy: curl -s -o /dev/null -w "%{http_code}" https://hadley-bricks-inventory-management.vercel.app/ (200 or 307=login both OK) and /workflow (200). (3) NO-REGRESSION on the route: the ebay-pricing route must STILL exist on prod (it was only un-scheduled, not removed): curl -s -o /dev/null -w "%{http_code}" https://hadley-bricks-inventory-management.vercel.app/api/cron/ebay-pricing — 401 or 405 = PASS, 404/500 = FAIL. Do NOT POST it with a real secret. Verdict FAIL if HEAD lacks the scripts or the route 404s.`,
  },
  {
    key: 'runner-code-correctness',
    prompt: `Adversarially code-review scripts/run-ebay-pricing.ps1 (read it from origin/main HEAD). Confirm: (1) it POSTs to http://localhost:3000/api/cron/ebay-pricing — NOT a vercel.app URL (a vercel.app target would defeat the entire migration => FAIL). (2) It LOOPS until the JSON response .complete is true, then exit 0; it does NOT exit 0 before complete:true. (3) It is bounded — a finite maxIterations and an abort after N consecutive HTTP errors (no infinite loop, no hammering). (4) It reads CRON_SECRET from apps/web/.env.local and sends it as a Bearer header. (5) On never-completing or repeated errors it exits NON-zero (so the scheduled task records failure). Also sanity-check register-ebay-pricing-task.ps1: it schedules run-ebay-pricing.ps1 (not some other file), daily, task name "HadleyBricks-Ebay-Pricing-Local". List any real defect. Verdict FAIL for a wrong target URL, a premature exit-0, an unbounded loop, or a missing/incorrect secret.`,
  },
  {
    key: 'gcp-paused',
    prompt: `Independently run gcloud and confirm the load is OFF Vercel. (1) ebay-pricing-sync state = PAUSED (describe it). (2) ADVERSARIAL: scan ALL scheduler jobs (list command) and confirm NO OTHER enabled job drives ebay-pricing on Vercel (e.g. no second job with body jobType=ebay-pricing still ENABLED). (3) NO COLLATERAL DAMAGE: amazon-pricing-sync is still ENABLED at "0 */3 * * *", bricklink-pricing-sync still ENABLED (its own schedule), and the 6 already-migrated jobs (full-sync, ebay-fp-cleanup, investment-sync, cost-allocation, retirement-sync, investment-retrain) are still PAUSED — i.e. this change touched ONLY ebay-pricing-sync. Verdict FAIL if ebay-pricing-sync is not PAUSED, if another enabled job still runs ebay-pricing on Vercel, or if any unrelated job's state/schedule was disturbed.`,
  },
  {
    key: 'windows-task',
    prompt: `Independently query the Windows task via powershell.exe schtasks and confirm: task "HadleyBricks-Ebay-Pricing-Local" exists, Scheduled Task State = Enabled, Schedule Type = Daily, Start Time = 03:00:00, Next Run Time is set to the next 03:00 (expected 01/07/2026 03:00), and "Task To Run" invokes powershell with -File ...\\scripts\\run-ebay-pricing.ps1. Verdict FAIL if the task is missing, Disabled, has no next-run time, or points at the wrong script.`,
  },
  {
    key: 'functional-local',
    prompt: `Prove the local path works end to end. FIRST query arbitrage_sync_status (job_type='ebay_scheduled_pricing') and confirm sync_date=today & cursor_position=1000 (=> a runner invocation will be a safe no-op). THEN invoke the runner ONCE: from the repo root run  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts/run-ebay-pricing.ps1"  and confirm it prints complete=True and exits 0 (proves: local server reachable on :3000, CRON_SECRET valid, loop + complete-detection work). If the SQL precondition is NOT met (cursor != 1000 or sync_date != today), do NOT invoke the runner — instead do a liveness check only (curl the localhost route without a valid secret and accept 401/405) and WARN that the no-op precondition did not hold. Verdict PASS if the runner reaches complete:true via localhost (or, in the fallback, the local route is provably live + gated).`,
  },
  {
    key: 'cpu-impact-no-regression',
    prompt: `Quantify the win and confirm ebay-pricing will not silently stop. (1) From job_execution_history (project modjoikyuhqzouxvieua), compute ebay-pricing wall-seconds/day over the last ~7 complete days (sum duration_ms grouped by day, then average) — expect ~200-220 s/day. This is the Vercel wall-clock now removed. (2) Map to CPU using r~=0.48 (CPU:wall upper bound used by the prior validation) => ~100 CPU-s/day removed => rolling-30d steady-state drops ~100*30=~3,000s (~0.8h): from the prior ~3.6h projection to ~2.8h/30d. State the numbers. (3) NO-REGRESSION: ebay-pricing must keep happening daily — the Windows task is scheduled for tomorrow 03:00 (from the windows-task dimension) AND there is no gap risk beyond one day. Also confirm pausing GCP created no DOUBLE-RUN (GCP paused => only the local task runs). ADVERSARIALLY challenge: could ebay-pricing now be dropped entirely (e.g. if the local machine is off at 03:00)? Note that risk. Verdict PASS if the ~100 CPU-s/day removal is real and a daily local run is scheduled; WARN if the only concern is the local-machine-availability dependency.`,
  },
];

phase('Validate');
const findings = (
  await parallel(
    DIMENSIONS.map((d) => () =>
      agent(`${CTX}\n\nDIMENSION: ${d.key}\n${d.prompt}\n\nReturn your finding via the schema.`, {
        label: `validate:${d.key}`,
        phase: 'Validate',
        schema: FINDING_SCHEMA,
      })
    )
  )
).filter(Boolean);

phase('Verify');
const concerning = findings.filter((f) => f.verdict !== 'PASS');
const verifications = await parallel(
  concerning.map((f) => () =>
    agent(
      `${CTX}\n\nA validator reported dimension "${f.dimension}" as ${f.verdict}: ${f.summary}\nEvidence: ${f.evidence}\nClaimed issues: ${JSON.stringify(f.issues)}\n\nYou are the SKEPTIC. Independently re-derive this from LIVE systems (gcloud / schtasks / Supabase / git / curl) with your own commands. Decide whether each claimed issue is a REAL defect in the shipped migration or a false positive (e.g. the same-day no-op precondition, the rolling-window lag, an acceptable local-availability trade-off). Default to "real" only if you can reproduce it live.`,
      {
        label: `verify:${f.dimension}`,
        phase: 'Verify',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['dimension', 'confirmedReal', 'verdict', 'explanation'],
          properties: {
            dimension: { type: 'string' },
            confirmedReal: { type: 'boolean', description: 'true if a genuine defect in the shipped migration' },
            verdict: { type: 'string', enum: ['PASS', 'WARN', 'FAIL'] },
            explanation: { type: 'string' },
          },
        },
      }
    )
  )
);

phase('Synthesize');
const report = await agent(
  `${CTX}\n\nSynthesize the FINAL E2E validation verdict for the ebay-pricing local migration (PR #476) on LIVE systems.\n\nVALIDATOR FINDINGS:\n${JSON.stringify(findings, null, 2)}\n\nADVERSARIAL VERIFICATIONS (only run on non-PASS dimensions):\n${JSON.stringify(verifications, null, 2)}\n\nProduce a crisp report: an overall PASS / PASS-WITH-NOTES / FAIL, a one-line per-dimension status, the quantified CPU win (CPU-s/day removed + projected rolling-30d drop in hours), and any CONFIRMED-REAL defects with severity + suggested action. CRITICAL HONESTY: (a) state that this ran the SAME DAY, so functional proof is the localhost NO-OP path; the first REAL local multi-batch run is tomorrow 01/07 03:00 — recommend confirming tomorrow that ebay-pricing ran locally (arbitrage_sync_status sync_date=01/07 cursor=1000, and a job_execution_history ebay-pricing burst ~03:00 local). (b) state that the Vercel Fluid CPU dashboard figure LAGS 2-3 weeks, so the win shows up in the rolling-30d only as pre-change days roll off. (c) flag the residual dependency: ebay-pricing now needs the local machine on at 03:00 (skips a day if off — low risk for daily repricing).`,
  { label: 'synthesize', phase: 'Synthesize' }
);

log('E2E validation complete.');
return { findings, verifications, report };
