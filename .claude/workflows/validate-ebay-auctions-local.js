export const meta = {
  name: 'validate-ebay-auctions-local',
  description:
    'E2E validation of the eBay auction sniper migration to the local bot (every 5 min, 5-min window, used-POV scan on) — against live systems',
  whenToUse:
    'After merging + deploying the ebay-auctions local migration, to independently confirm the GCP ebay-auction-sniper job is paused, the 5-min Windows task drives the localhost route (NEW + USED scans), config matches (scan_window_minutes=5, used_pov_mode_enabled=true), alerts carry POV audit columns, and nothing double-runs on Vercel.',
  phases: [
    { title: 'Validate', detail: 'one read-only validator per dimension (git/prod + gcloud + Windows task + local route/log + Supabase)' },
    { title: 'Verify', detail: 'adversarially re-check any FAIL/WARN finding' },
    { title: 'Synthesize', detail: 'PASS/FAIL E2E report' },
  ],
};

const CTX = `
CONTEXT — you are validating, on LIVE systems, the migration of the eBay AUCTION SNIPER off Vercel to the local Windows bot, with a tighter cadence.

BACKGROUND: the sniper scans eBay UK LEGO AUCTIONS ending soon. Per scan it runs a NEW-condition Browse API search (alerts on Amazon resale margin OR New part-out-value >= pov_multiple x cost — PR #477) and, because ebay_auction_config.used_pov_mode_enabled=true, a second USED-condition search judged purely on Used POV (PR #477 + early-return fix PR #480). Alerts go to Discord and are recorded in ebay_auction_alerts with POV audit columns (pov_condition, pov_sold_gbp, pov_multiple, buy_signal). Previously the GCP Cloud Scheduler job \`ebay-auction-sniper\` (schedule "*/30 * * * *" after the 26 Jun CPU cuts) POSTed the Vercel route https://hadley-bricks-inventory-management.vercel.app/api/cron/ebay-auctions with scan_window_minutes=15→10 — leaving coverage gaps (auctions ending between window-end and the next run were never scanned).

THE CHANGE (branch chore/ebay-auctions-local, squash-merged to origin/main):
(A) NEW scripts/run-ebay-auctions.ps1 — LOCAL runner that POSTs http://localhost:3000/api/cron/ebay-auctions ONCE per invocation (single scan; the route is not cursor-based), reads CRON_SECRET from apps/web/.env.local, appends a one-line summary per run to logs\\ebay-auctions-local.log (gitignored), exits non-zero on HTTP error or scan error.
(B) NEW scripts/register-ebay-auctions-task.ps1 — registers Windows Scheduled Task "HadleyBricks-Ebay-Auctions-Local" repeating EVERY 5 MINUTES indefinitely (MultipleInstances IgnoreNew, ExecutionTimeLimit 4 min).
(C) ebay_auction_config.scan_window_minutes set to 5 — matching the 5-min cadence for contiguous coverage (run at T scans auctions ending <= T+5; next run at T+5 continues seamlessly).
(D) GCP \`ebay-auction-sniper\` Cloud Scheduler job PAUSED (reversible: gcloud scheduler jobs resume ebay-auction-sniper --location=europe-west2 --project=gen-lang-client-0823893317, then restore scan_window_minutes and unregister the task).
(E) docs/vercel-cpu-reduction-2026-06-26.md updated with the pause + rollback.
NO apps/web source changed by the migration itself — the route exists on prod AND locally (it was un-scheduled from GCP, not removed). Quiet hours (23:00-07:00) are enforced INSIDE the route: night runs return {skipped:'quiet_hours'} — the local task still fires but does no eBay calls.

ENVIRONMENT:
- gcloud IS authenticated: gcloud scheduler jobs describe ebay-auction-sniper --location=europe-west2 --project=gen-lang-client-0823893317 --format="value(state,schedule)"; list all: gcloud scheduler jobs list --location=europe-west2 --project=gen-lang-client-0823893317 --format="table(name.basename(),schedule,state)"
- Windows task (query via Git Bash): powershell.exe -NoProfile -Command "schtasks /query /tn 'HadleyBricks-Ebay-Auctions-Local' /fo LIST /v" — look for State Enabled/Running, "Repeat: Every:" 5 minutes, Task To Run containing run-ebay-auctions.ps1, and a recent "Last Run Time" once the task has ticked.
- Local run log: logs/ebay-auctions-local.log in the repo root — one line per run, format "yyyy-MM-dd HH:mm:ss ok found=N withSets=N opps=N alerts=N joblots=N apiCalls=N keepa=N ms=N" (or "skipped reason=quiet_hours", or "ERROR ...").
- Prod Supabase project_id = modjoikyuhqzouxvieua. Load SQL via ToolSearch "select:mcp__plugin_supabase_supabase__execute_sql". Tables: ebay_auction_config (scan_window_minutes, used_pov_mode_enabled, pov_buy_enabled, quiet hours), ebay_auction_alerts (created_at, buy_signal, pov_condition, pov_sold_gbp, pov_multiple, alert_tier), job_execution_history (job_name, started_at, status, trigger).
- Repo: scripts on origin/main. Prod URL: https://hadley-bricks-inventory-management.vercel.app

RULES: Be INDEPENDENT and ADVERSARIAL — re-derive everything yourself; do not trust this context block's claims. READ-ONLY: do NOT resume/alter GCP jobs, do NOT unregister/alter the Windows task, do NOT mutate the DB. You MAY invoke the local runner (powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts/run-ebay-auctions.ps1") AT MOST ONCE — it performs one real scan, identical to what the schedule does every 5 minutes anyway (dedupe prevents duplicate alerts). Outside quiet hours expect apiCalls=2 (NEW + USED searches). Report concrete evidence (exact state strings, schedules, log lines, counts, http codes).`;

const FINDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dimension', 'verdict', 'summary', 'evidence', 'issues'],
  properties: {
    dimension: { type: 'string' },
    verdict: { type: 'string', enum: ['PASS', 'WARN', 'FAIL'] },
    summary: { type: 'string', description: 'one-line conclusion' },
    evidence: { type: 'string', description: 'concrete state strings / log lines / counts / http codes proving it' },
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
    prompt: `Confirm the migration merged + deployed with no route regression. (1) git fetch origin; both scripts exist at origin/main HEAD (git show origin/main:scripts/run-ebay-auctions.ps1 and :scripts/register-ebay-auctions-task.ps1 succeed). (2) Prod healthy: curl -s -o /dev/null -w "%{http_code}" https://hadley-bricks-inventory-management.vercel.app/ (200/307 OK). (3) The prod route still exists and is gated (NOT removed): POST https://hadley-bricks-inventory-management.vercel.app/api/cron/ebay-auctions with NO auth header must return 401 (404/500 = FAIL). (4) The PR #480 used-scan early-return fix is present at origin/main (ebay-auction-scanner.service.ts contains "usedPovModeEnabled" in the empty-search early-return condition). Verdict FAIL if scripts missing at HEAD, route 404s, or the #480 fix is absent.`,
  },
  {
    key: 'runner-code-correctness',
    prompt: `Adversarially review scripts/run-ebay-auctions.ps1 at origin/main. Confirm: (1) targets http://localhost:3000/api/cron/ebay-auctions — NOT vercel.app (wrong target defeats the migration => FAIL). (2) Sends CRON_SECRET from apps/web/.env.local as Bearer. (3) Exits non-zero on HTTP error AND on a scan-level error field; exits 0 on ok or skipped(quiet_hours). (4) Appends a run line to logs/ebay-auctions-local.log and bounds the file size (trim logic). (5) register-ebay-auctions-task.ps1 schedules THAT script, task name "HadleyBricks-Ebay-Auctions-Local", RepetitionInterval 5 minutes, MultipleInstances IgnoreNew (no pile-up), ExecutionTimeLimit ~4 min. List any real defect (e.g. a hang risk, an unbounded log, a swallowed error).`,
  },
  {
    key: 'gcp-paused-no-collateral',
    prompt: `Run gcloud yourself. (1) ebay-auction-sniper state = PAUSED. (2) Scan ALL scheduler jobs and confirm no other ENABLED job still drives ebay-auctions on Vercel. (3) NO COLLATERAL: ebay-pricing-sync still PAUSED (its own prior migration), amazon-pricing-sync still ENABLED "0 */3 * * *", spapi-buybox-refresh still ENABLED "*/30 * * * *", and the other 26-Jun-paused jobs unchanged — this change touched ONLY ebay-auction-sniper. Verdict FAIL if the sniper job is not paused, another enabled job still hits the Vercel auctions route, or an unrelated job was disturbed.`,
  },
  {
    key: 'windows-task-5min',
    prompt: `Query the Windows task and prove the 5-minute cadence is real. schtasks /query /tn 'HadleyBricks-Ebay-Auctions-Local' /fo LIST /v must show: task exists, State Enabled (or Running), "Task To Run" invoking run-ebay-auctions.ps1, and repetition every 5 minutes ("Repeat: Every:" field). Then prove it is actually FIRING: logs/ebay-auctions-local.log must contain lines at ~5-minute spacing covering at least the last 10-15 minutes (or "Last Run Time" within the last 5-6 min). Verdict FAIL if missing/disabled/wrong script; WARN if registered but no evidence of a tick yet.`,
  },
  {
    key: 'functional-local-scan',
    prompt: `Prove the local scan path works end to end. Preferred evidence: recent "ok ..." lines in logs/ebay-auctions-local.log with apiCalls=2 (NEW + USED searches ran) outside quiet hours. If the log lacks a recent ok line, invoke the runner ONCE (powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts/run-ebay-auctions.ps1") and confirm it prints an ok line with apiCalls=2 and exits 0. Cross-check Supabase: ebay_auction_config has scan_window_minutes=5, used_pov_mode_enabled=true, pov_buy_enabled=true. Also confirm alert integrity where data exists: any ebay_auction_alerts rows created AFTER the PR #477 deploy (2026-07-02 08:50Z) must have non-null buy_signal and pov_condition in ('new','used') — zero such rows is fine (no opportunities yet), null buy_signal on a post-deploy row is a FAIL. Verdict FAIL if the local route errors, apiCalls stays 1 outside quiet hours with used mode on, or config does not match 5/true/true.`,
  },
  {
    key: 'coverage-and-cpu',
    prompt: `Assess coverage + Vercel impact honestly. (1) COVERAGE: with cadence 5 min and scan_window_minutes=5, coverage of auctions ending soon is contiguous (run at T covers ending <= T+5; next run continues). Under the OLD setup (*/30 cadence, 15→10-min window) 50-67% of ending auctions were never scanned. State this improvement. Adversarially note residual gaps: a missed tick (machine busy/off, IgnoreNew skip if a run overruns 5 min) creates a 5-min blind spot; quiet hours 23:00-07:00 are intentionally unscanned; alert lead time is now 0-5 min before auction end — tight for manual bidding. (2) VERCEL CPU: the sniper previously ran 48 Vercel invocations/day (*/30) at roughly 1.5-15s wall each; those are now zero — a modest additional saving on top of the ebay-pricing migration, and crucially the 6x cadence increase (288 local runs/day) costs Vercel NOTHING. (3) NO DOUBLE-RUN: GCP paused + local task = exactly one runner. Verdict PASS unless you find a real double-run or a coverage regression vs the old setup.`,
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
      `${CTX}\n\nA validator reported dimension "${f.dimension}" as ${f.verdict}: ${f.summary}\nEvidence: ${f.evidence}\nClaimed issues: ${JSON.stringify(f.issues)}\n\nYou are the SKEPTIC. Independently re-derive this from LIVE systems (gcloud / schtasks / the run log / Supabase / git / curl) with your own commands. Decide whether each claimed issue is a REAL defect in the shipped migration or a false positive (e.g. quiet-hours skip lines, no-opportunities-yet, task registered-but-not-yet-ticked). Default to "real" only if you can reproduce it live.`,
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
  `${CTX}\n\nSynthesize the FINAL E2E validation verdict for the ebay-auctions local migration on LIVE systems.\n\nVALIDATOR FINDINGS:\n${JSON.stringify(findings, null, 2)}\n\nADVERSARIAL VERIFICATIONS (only run on non-PASS dimensions):\n${JSON.stringify(verifications, null, 2)}\n\nProduce a crisp report: overall PASS / PASS-WITH-NOTES / FAIL, one-line per-dimension status, the coverage improvement (contiguous 5-min coverage vs the prior 33-50%), the Vercel saving, and any CONFIRMED-REAL defects with severity + suggested action. HONESTY NOTES: (a) if no ebay_auction_alerts row has been written since the change, say the POV-alert columns are verified by code + config only, and recommend re-checking after the first real alert lands; (b) flag the residual dependency — the sniper now requires the local machine to be on (each missed tick = one 5-min blind spot, and quiet hours are intentionally dark); (c) alert lead time is 0-5 minutes before auction end.`,
  { label: 'synthesize', phase: 'Synthesize' }
);

log('E2E validation complete.');
return { findings, verifications, report };
