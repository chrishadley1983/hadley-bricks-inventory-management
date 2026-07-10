export const meta = {
  name: 'validate-vercel-cpu-reduction',
  description: 'E2E validation of PR #471 + GCP schedule cuts — confirm projected Vercel Fluid CPU < 4h',
  whenToUse:
    'After merging PR #471 and applying the GCP scheduler frequency cuts, to independently confirm the code deployed, the schedules actually changed live, the migrated jobs still run, and the projected rolling-30d Fluid Active CPU clears the 4h Hobby limit.',
  phases: [
    { title: 'Validate', detail: 'one read-only validator per dimension (prod Vercel + live gcloud + prod Supabase)' },
    { title: 'Verify', detail: 'adversarially re-check any FAIL/WARN finding' },
    { title: 'Synthesize', detail: 'PASS/FAIL E2E report with the honest rolling-window caveat' },
  ],
};

// Shared context every validator needs.
const CTX = `
CONTEXT — you are validating, on LIVE systems, a change set that aims to bring the rolling-30d Vercel Fluid Active CPU back under the Hobby free limit of 4h (= 14,400 seconds). Before the change it was 7h59m (28,740s = 199.6%) and RISING.

ROOT CAUSE that was fixed: the 12 Jun migration moved 6 heavy crons to a local bot (paused them on GCP) but LEFT the #1 Vercel CPU consumer running — \`amazon-pricing\`, fired every 30 min. The GCP job "amazon-pricing-sync" targets a Cloud Run driver (gcp/functions/pricing-sync-driver) that LOOPS calling the Vercel route https://hadley-bricks-inventory-management.vercel.app/api/cron/amazon-pricing, so the work executes ON Vercel (it writes a job_execution_history row job_name='amazon-pricing'). It was ~1,138 wall-s/day = 57% of remaining Vercel cron load.

THE CHANGE had two parts:
(A) In-repo PR #471 (merged to origin/main, squash commit 6b5192e3, deployed to Vercel):
  - apps/web/src/hooks/use-pomodoro.ts + use-time-tracking.ts: the "current" polls dropped 1s -> 10s (refetchInterval: 10000); time-tracking summary 60s -> 5min.
  - refetchIntervalInBackground: false added to ALL 14 polling hooks under apps/web/src/hooks (stops polling in hidden browser tabs).
  - status pollers bumped 30s->90s / 60s->120s (use-orders, use-workflow, use-paypal-sync, use-bricklink-uploads, use-bricklink-transaction-sync, use-brickowl-transaction-sync).
  - apps/web/src/app/api/cron/vercel-usage/route.ts: removed the HARDCODED string "migration effect surfaces as pre-change days roll off (~5d)" (it printed whenever the metric was NOT falling = false reassurance); now prints the real signed slope (RISING / flat / falling).
(B) GCP Cloud Scheduler frequency cuts (gcloud, project gen-lang-client-0823893317, location europe-west2). OLD -> NEW:
  - amazon-pricing-sync:      */30 * * * *  ->  0 */3 * * *     (every 3h)
  - ebay-auction-sniper:      */15 * * * *  ->  */30 * * * *    (every 30 min)
  - amazon-fee-reconcile:     0 * * * *     ->  0 8 * * *       (daily 08:00)
  - amazon-orders-backfill:   15 * * * *    ->  15 */6 * * *    (every 6h)
  - amazon-transactions-sync: 30 * * * *    ->  30 */6 * * *    (every 6h)
  - order-issues-sync:        */30 * * * *  ->  0 */2 * * *     (every 2h)

ALREADY-MIGRATED jobs that must STILL be paused on GCP and STILL running on the local bot (NOT on Vercel): full-sync, ebay-fp-cleanup, investment-sync, cost-allocation, retirement-sync, investment-retrain. (These appear in job_execution_history but execute locally now.)

ENVIRONMENT:
- gcloud IS authenticated. List live schedules with:
  gcloud scheduler jobs list --location=europe-west2 --project=gen-lang-client-0823893317 --format="table(name.basename(),schedule,state)"
- Prod Supabase project_id = modjoikyuhqzouxvieua. Query job_execution_history via the Supabase MCP tool (load it with ToolSearch "select:mcp__plugin_supabase_supabase__execute_sql"). Columns: job_name, trigger, duration_ms, started_at, status.
- Repo: read source at apps/web/src/hooks/* and apps/web/src/app/api/cron/vercel-usage/route.ts. origin/main HEAD should be 6b5192e3.
- Prod URL: https://hadley-bricks-inventory-management.vercel.app

PROJECTION METHOD (for the cpu-projection dimension): from job_execution_history over the LAST 7 DAYS (all post-12-Jun, steady state), compute per Vercel-EXECUTING job its wall-seconds/day; EXCLUDE the 6 migrated-to-local jobs above; apply each changed job's NEW frequency factor (amazon-pricing x0.167 = 8/48; ebay-auction-sniper x0.5; the hourly->6h/daily/2h pollers if they even have rows); sum to get post-change Vercel wall-s/day. Pre-change Vercel total was ~1,979 wall-s/day; target post-change ~880 wall-s/day. Then map wall-clock to Active CPU. The current rolling-30d Active CPU is 28,740s/30 = 958 s/day against ~1,979 Vercel wall-s/day => CPU:wall ratio r ~= 0.48 (this is an UPPER bound — the current figure is inflated by pre-migration days still in the window, so true r is lower => the projection is conservative). Projected rolling-30d Active CPU = r * (post-change wall-s/day) * 30. Confirm < 14,400s (4h).

RULES: Be INDEPENDENT and ADVERSARIAL. Run gcloud / Supabase / curl / git yourself — do NOT trust the numbers in this context block; re-derive them. Read-only: do NOT mutate schedules, the DB, or invoke any cron route that has side-effects (e.g. do NOT POST /api/cron/vercel-usage — it sends Discord/email; a GET/curl that returns 401/405 is fine for liveness). Report concrete evidence (exact schedules, counts, computed numbers).`;

const FINDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dimension', 'verdict', 'summary', 'evidence', 'issues'],
  properties: {
    dimension: { type: 'string' },
    verdict: { type: 'string', enum: ['PASS', 'WARN', 'FAIL'] },
    summary: { type: 'string', description: 'one-line conclusion' },
    evidence: { type: 'string', description: 'concrete numbers / schedules / counts proving it' },
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
    key: 'deploy-live',
    prompt: `Confirm PR #471 is deployed. (1) git: origin/main HEAD is squash commit 6b5192e3 (fetch + log). (2) Vercel prod core pages return 200 (curl https://hadley-bricks-inventory-management.vercel.app/ and one dashboard page). (3) The vercel-usage cron route is live + auth-gated: curl -s -o /dev/null -w "%{http_code}" https://hadley-bricks-inventory-management.vercel.app/api/cron/vercel-usage — 401 or 405 = exists+protected = PASS, 404/500 = FAIL. Do NOT POST it. Verdict PASS if deployed + routes healthy.`,
  },
  {
    key: 'code-correctness',
    prompt: `At origin/main HEAD, read the actual source and confirm the in-repo changes landed. (1) EVERY hook file under apps/web/src/hooks that sets refetchInterval also sets refetchIntervalInBackground: false — grep both and confirm counts match (14 polling hooks). List any hook with refetchInterval but WITHOUT the background guard. (2) use-pomodoro.ts useCurrentPomodoro and use-time-tracking.ts useCurrentTimeEntry use refetchInterval: 10000 (NOT 1000). (3) apps/web/src/app/api/cron/vercel-usage/route.ts no longer contains the substring "(~5d)" and instead branches on slopePerDay to print RISING/flat/falling. Verdict FAIL if any 1s poll remains, any hook lacks the guard, or the "~5d" string is still present.`,
  },
  {
    key: 'gcp-schedules',
    prompt: `Independently run the gcloud scheduler jobs list command and confirm the 6 changed jobs are ENABLED at their NEW schedules EXACTLY: amazon-pricing-sync="0 */3 * * *", ebay-auction-sniper="*/30 * * * *", amazon-fee-reconcile="0 8 * * *", amazon-orders-backfill="15 */6 * * *", amazon-transactions-sync="30 */6 * * *", order-issues-sync="0 */2 * * *". ALSO confirm NO regression: the migrated jobs full-sync, ebay-fp-cleanup, investment-sync, cost-allocation, retirement-sync, investment-retrain are still state=PAUSED (so they are not double-running on Vercel). Verdict FAIL if any schedule differs from NEW, or any migrated job got un-paused.`,
  },
  {
    key: 'cpu-projection',
    prompt: `THE KEY QUANTITATIVE CHECK. Independently query job_execution_history (project modjoikyuhqzouxvieua) for the last 7 days, per job_name: runs and sum(duration_ms). Build the set of Vercel-EXECUTING jobs (exclude the 6 migrated-to-local jobs). Apply the NEW frequency factors and compute post-change Vercel wall-seconds/day. Then project rolling-30d Active CPU using r ~= 0.48 (and also report the optimistic r ~= 0.20 lower bound from the pre-migration anchor). Confirm the projected rolling-30d Active CPU is < 14,400s (4h). State your computed numbers explicitly: pre-change wall-s/day, post-change wall-s/day, % reduction, projected CPU hours at r=0.48 and r=0.20. ADVERSARIALLY challenge: (a) are there Vercel-executing jobs you failed to exclude/include? (b) does amazon-pricing really drop to 8 runs/day? (c) is the r=0.48 ratio defensible as an upper bound? Verdict PASS only if projected CPU < 4h under the r=0.48 (conservative) assumption with some margin; WARN if it lands 3.8-4.0h (thin); FAIL if >= 4h.`,
  },
  {
    key: 'no-regression',
    prompt: `Confirm the change did not break business function. (1) The migrated jobs still RUN locally: full-sync, ebay-fp-cleanup, investment-sync, cost-allocation, retirement-sync each have a job_execution_history row within the last ~36h (they must not have silently stopped when paused on GCP). (2) amazon-pricing still runs at the new cadence: confirm job_execution_history shows amazon-pricing rows continuing (expect roughly every 3h going forward; recent rows present). (3) Amazon in-stock pricing freshness is preserved: spapi-buybox-refresh is UNTOUCHED at */30 (the urgent buy-box path) — confirm via gcloud it is still "*/30 * * * *" ENABLED. Verdict FAIL if a migrated job has gone silent (no rows in 36h) or spapi-buybox-refresh was altered.`,
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

// Adversarially verify anything not a clean PASS.
phase('Verify');
const concerning = findings.filter((f) => f.verdict !== 'PASS');
const verifications = await parallel(
  concerning.map((f) => () =>
    agent(
      `${CTX}\n\nA validator reported dimension "${f.dimension}" as ${f.verdict}: ${f.summary}\nEvidence: ${f.evidence}\nClaimed issues: ${JSON.stringify(f.issues)}\n\nYou are the SKEPTIC. Independently re-derive this from LIVE systems (gcloud / Supabase / git / curl) with your own commands. Decide whether each claimed issue is a REAL defect in the shipped change or a false positive (e.g. a job with no job_execution_history rows so its frequency cut "saves nothing measurable" but is still harmless; a rolling-window lag being mistaken for a failed change; an acceptable in-stock freshness trade-off). Default to "real" only if you can reproduce it live.`,
      {
        label: `verify:${f.dimension}`,
        phase: 'Verify',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['dimension', 'confirmedReal', 'verdict', 'explanation'],
          properties: {
            dimension: { type: 'string' },
            confirmedReal: { type: 'boolean', description: 'true if a genuine defect in the shipped change' },
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
  `${CTX}\n\nSynthesize the FINAL E2E validation verdict for the Vercel CPU-reduction change (PR #471 + the 6 GCP schedule cuts) on LIVE systems.\n\nVALIDATOR FINDINGS:\n${JSON.stringify(findings, null, 2)}\n\nADVERSARIAL VERIFICATIONS (only run on non-PASS dimensions):\n${JSON.stringify(verifications, null, 2)}\n\nProduce a crisp report: an overall PASS / PASS-WITH-NOTES / FAIL, a one-line per-dimension status, the projected rolling-30d Fluid Active CPU in hours (and whether it clears 4h), and the list of any CONFIRMED-REAL defects with severity + suggested action. CRITICAL HONESTY: explicitly state the caveat that the rolling-30d dashboard figure is a LAGGING aggregate — it will keep showing >4h for ~2-3 weeks as pre-change days roll off the window, so the validation rests on leading indicators (schedules live + daily-burn projection + deploy live), NOT on the dashboard number being <4h today. Recommend the one verification to do in ~5 days (the daily vercel-usage report should now show Fluid CPU FALLING).`,
  { label: 'synthesize', phase: 'Synthesize' }
);

log('E2E validation complete.');
return { findings, verifications, report };
