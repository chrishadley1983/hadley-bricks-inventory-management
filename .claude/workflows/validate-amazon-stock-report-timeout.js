export const meta = {
  name: 'validate-amazon-stock-report-timeout',
  description: 'E2E validation of PR #475 — Amazon stock-import retry-on-timeout + throttle — against live production',
  whenToUse: 'After merging + deploying PR #475, to confirm the retry-on-timeout and the over-pull throttle are deployed and correct, the import is healthy in prod (no new timeouts, fresh stock), and the throttle cannot silently wedge the morning stock refresh.',
  phases: [
    { title: 'Validate', detail: 'code + live-data checks of the retry + throttle fix' },
    { title: 'Verify', detail: 'adversarially re-check any FAIL/WARN' },
    { title: 'Synthesize', detail: 'PASS/FAIL report' },
  ],
};

const PROJECT = 'modjoikyuhqzouxvieua';

const CTX = `
CONTEXT — validate PR #475 "fix(amazon): retry stock report on timeout + throttle re-pulls" on PRODUCTION (squash-merged to main as commit 9f590e4c, deployed).

THE BUG it fixes: the Amazon stock import (GET_MERCHANT_LISTINGS_ALL_DATA) intermittently failed with "Report generation timed out after 300 seconds". It normally completes in 25-90s for ~850 listings, but Amazon's report queue is occasionally slow and a single report sits IN_QUEUE/IN_PROGRESS past the 5-min poll window. The failures CLUSTER after several rapid report requests in a short window (over-pulling → Amazon queues/throttles report generation). On 2026-06-25 there were two consecutive timeouts (16:03 and 16:13) right after three rapid successes (14:58/15:15/15:48). The import is NOT in the Vercel full-sync cron — it runs from the manual button (POST /api/platform-stock/amazon/import) and the local pick-list/morning routine — so a slow morning silently skipped the stock refresh and stock went stale (last success before a manual re-run was 2026-06-25; a manual re-run on 2026-06-30 ~10:41 UTC completed in 26s with 849 listings).

THE FIX (two parts):
  (A) Retry-on-timeout — apps/web/src/lib/platform-stock/amazon/amazon-reports.client.ts:
      - waitForReport now throws a distinct exported class ReportTimeoutError (NOT a generic Error) on timeout. CANCELLED/FATAL still throw the generic "Report generation failed with status: ..." error.
      - fetchReport wraps create+wait in a retry loop: it requests a FRESH report each attempt; on a ReportTimeoutError AND attempts remaining it logs, sleeps a backoff, and retries; on any other error (CANCELLED/FATAL/auth/etc.) it rethrows immediately; after the last attempt it rethrows the ReportTimeoutError. Defaults: DEFAULT_FETCH_MAX_ATTEMPTS=2, DEFAULT_RETRY_BACKOFF_MS=30000. fetchReport/fetchMerchantListingsReport accept an options arg { maxAttempts, retryBackoffMs, maxWaitMs, pollIntervalMs }.
  (B) Throttle (anti over-pull) — apps/web/src/lib/platform-stock/amazon/amazon-stock.service.ts:
      - triggerImport(options?: { force?: boolean; cooldownMs?: number }). Before requesting a report, unless force, it calls getRecentCompletedImport() and if a COMPLETED import finished within the cooldown (DEFAULT_IMPORT_COOLDOWN_MS = 10*60*1000) it RETURNS that import instead of pulling a new report. cooldownMs:0 disables the throttle.
      - getRecentCompletedImport filters status='completed' specifically — so a recent FAILED import never throttles (a retry after a failure always proceeds), and a failure is never returned as a success.
      - Route apps/web/src/app/api/platform-stock/amazon/import/route.ts: POST reads ?force=true and passes { force } so a deliberate refresh bypasses the cooldown.

WHY the throttle is safe (the thing to adversarially check): the morning/pick-list routine runs roughly once per day, far outside the 10-min cooldown, so it is never throttled. Only rapid successive triggers (the over-pull pattern) are deduped. And because the throttle keys on the most recent COMPLETED import, a transient failure does NOT block the next attempt — the system can always recover. A throttle that keyed on ANY recent import (incl. failed) would be a bug (could wedge recovery); confirm it does NOT.

ENVIRONMENT: read-only validation. Use the Supabase MCP tool — load it with ToolSearch query "select:mcp__plugin_supabase_supabase__execute_sql" then call it with project_id "${PROJECT}". Code lives in the working tree on branch main (already merged): the three files above. Use Read/Grep for code and "git log origin/main --oneline -3" for deploy state. DO NOT mutate any data, DO NOT trigger an import.

RULES: Be INDEPENDENT + ADVERSARIAL. Run your own SQL and read the actual deployed code; do not assume. A PASS requires the code to be present on main AND the live data to be consistent with a healthy, deployed fix.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dimension', 'verdict', 'summary', 'evidence', 'issues'],
  properties: {
    dimension: { type: 'string' },
    verdict: { type: 'string', enum: ['PASS', 'WARN', 'FAIL'] },
    summary: { type: 'string' },
    evidence: { type: 'string' },
    issues: {
      type: 'array',
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
    key: 'deployed',
    prompt: `Confirm the fix is deployed. (1) git: "git log origin/main --oneline -3" — HEAD must be the squash-merge "fix(amazon): retry stock report on timeout + throttle re-pulls (#475)". (2) Grep amazon-reports.client.ts on main: "ReportTimeoutError" class is exported AND waitForReport throws it (not a generic Error) AND fetchReport has a retry loop that retries ONLY on ReportTimeoutError. (3) Grep amazon-stock.service.ts: triggerImport accepts options, references DEFAULT_IMPORT_COOLDOWN_MS and getRecentCompletedImport, and returns early on a recent completed import. (4) Grep the import route for "?force" / searchParams.get('force') passed into triggerImport. (5) prod liveness: POST https://hadley-bricks-inventory-management.vercel.app/api/platform-stock/amazon/import returns 401 (auth-gated => route deployed) and the homepage returns 200/307. Verdict PASS only if ALL present.`,
  },
  {
    key: 'retry-correct',
    prompt: `Audit the retry logic in amazon-reports.client.ts (deployed code on main). Confirm: (a) waitForReport throws ReportTimeoutError on timeout; (b) fetchReport loops up to maxAttempts (default DEFAULT_FETCH_MAX_ATTEMPTS=2), requesting a FRESH report via createReport each attempt; (c) it retries ONLY when the caught error is a ReportTimeoutError AND attempt < maxAttempts, sleeping retryBackoffMs (default 30000) before retrying; (d) it does NOT retry CANCELLED/FATAL/auth errors — those rethrow immediately (this is critical: retrying a FATAL report would loop on a genuine failure); (e) after the final attempt the ReportTimeoutError is rethrown (the caller/import still marks failed). Also confirm tests exist in __tests__/amazon-reports.client.test.ts for: retry-then-succeed, exhaustion rethrow, and no-retry-on-FATAL. Verdict FAIL if retry is unbounded, retries on FATAL/CANCELLED, or does not request a fresh report per attempt.`,
  },
  {
    key: 'throttle-correct',
    prompt: `Audit the throttle in amazon-stock.service.ts (deployed code on main). Confirm: (a) triggerImport, unless options.force, checks getRecentCompletedImport() and returns it when (now - completed_at) < cooldownMs (default DEFAULT_IMPORT_COOLDOWN_MS = 10 min), WITHOUT requesting a report; (b) getRecentCompletedImport queries platform_listing_imports filtered to status='completed' ordered by completed_at desc (NOT any status) — so a recent FAILED import neither throttles nor is returned; (c) cooldownMs:0 disables the throttle and force bypasses it; (d) the import route passes force from ?force=true. Confirm a throttle test exists in __tests__/amazon-stock.service.test.ts (recent completed import => no report requested). Verdict FAIL if the throttle could return/cling to a FAILED import, block a post-failure retry, or cannot be bypassed.`,
  },
  {
    key: 'live-health',
    prompt: `Confirm the import is healthy in production via Supabase (project ${PROJECT}). (1) Query platform_listing_imports where platform='amazon' order by created_at desc limit 15: the most recent import(s) must be status='completed'; confirm there are NO 'failed' rows with error_message ILIKE '%timed out%' AFTER 2026-06-30 10:00 UTC (the historical 2026-06-25 timeouts are expected/acceptable); confirm completed imports run in a normal duration (extract(epoch from completed_at - started_at) typically 20-120s, not ~300s). (2) Confirm platform_listings has a fresh full set for amazon: select count(*) where platform='amazon' — expect ~840-860 rows (the last import imported 849). Verdict PASS if the latest import is completed, there are no post-deploy timeout failures, and the listings count is fresh; WARN if stock looks stale (latest completed import older than ~24h); FAIL on a new post-deploy timeout failure or an empty/decimated listings table.`,
  },
  {
    key: 'no-silent-wedge',
    prompt: `Adversarially confirm the throttle cannot silently wedge the daily stock refresh. (1) Reason from the code + data: the morning/pick-list routine triggers the import ~once/day, far outside the 10-min cooldown, so it is never throttled; demonstrate by checking the typical gap between successive completed imports in platform_listing_imports (should be >> 10 min). (2) Confirm that after a FAILED import, the next trigger is NOT throttled — getRecentCompletedImport ignores failed rows, so the cooldown only ever reflects a genuinely fresh successful pull. (3) Note the retry worst case (~2 x 5min + 30s backoff ≈ 10.5 min) and confirm this path runs where there is no hard function timeout (it is NOT wired into the Vercel full-sync cron whose maxDuration=300; it runs from the manual route + local server). Flag (WARN) if the manual Vercel route could be killed by a platform timeout mid-retry, but this is not a regression. Verdict FAIL only if the throttle could block legitimate daily refreshes or post-failure recovery.`,
  },
];

phase('Validate');
const findings = (
  await parallel(
    DIMENSIONS.map((d) => () =>
      agent(`${CTX}\n\nDIMENSION: ${d.key}\n${d.prompt}\n\nReturn your finding via the schema.`, {
        label: `validate:${d.key}`,
        phase: 'Validate',
        schema: SCHEMA,
      })
    )
  )
).filter(Boolean);

phase('Verify');
const concerning = findings.filter((f) => f.verdict !== 'PASS');
const verifications = await parallel(
  concerning.map((f) => () =>
    agent(
      `${CTX}\n\nA validator reported "${f.dimension}" as ${f.verdict}: ${f.summary}\nEvidence: ${f.evidence}\nIssues: ${JSON.stringify(f.issues)}\n\nYou are the SKEPTIC. Independently reproduce against LIVE production (own SQL on ${PROJECT} / own code reads on main). Decide whether each issue is a REAL defect in the deployed change (missing/incorrect retry, a throttle that could wedge or cling to a failure, a new post-deploy timeout, decimated listings) or a false alarm (the historical 2026-06-25 timeouts, a stale read, or the acceptable Vercel-timeout note). Default to "real" only if reproduced live.`,
      {
        label: `verify:${f.dimension}`,
        phase: 'Verify',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['dimension', 'confirmedReal', 'verdict', 'explanation'],
          properties: {
            dimension: { type: 'string' },
            confirmedReal: { type: 'boolean' },
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
  `${CTX}\n\nSynthesize the FINAL E2E verdict for PR #475 on production.\n\nFINDINGS:\n${JSON.stringify(findings, null, 2)}\n\nADVERSARIAL VERIFICATIONS:\n${JSON.stringify(verifications, null, 2)}\n\nProduce: overall PASS / PASS-WITH-NOTES / FAIL; one line per dimension; explicitly state whether (a) the fix is deployed (commit + code present), (b) the retry is correct and bounded and does not retry FATAL/CANCELLED, (c) the throttle is correct (returns only recent COMPLETED imports, bypassable, cannot block post-failure recovery), (d) the import is healthy in prod with no post-deploy timeouts and fresh stock, (e) the throttle cannot silently wedge the daily refresh; and any CONFIRMED-REAL defect with severity + concrete action. Be specific and decisive.`,
  { label: 'synthesize', phase: 'Synthesize' }
);

log('Amazon stock-report retry + throttle validation complete.');
return { findings, verifications, report };
