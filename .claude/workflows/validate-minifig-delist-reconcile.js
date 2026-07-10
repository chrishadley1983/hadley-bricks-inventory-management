export const meta = {
  name: 'validate-minifig-delist-reconcile',
  description:
    'E2E validation of PR #532 — process-removals verify-before-EXECUTED + the minifig eBay/Bricqer reconciler — against live production. Code audit + live-data re-derivation + adversarial refutation.',
  whenToUse:
    'After merging + deploying PR #532, to confirm the eBay de-list is now verified before EXECUTED, the reconciler correctly flags double-sell + stale-listed drift, the route is live, and the GCP job is scheduled.',
  phases: [
    { title: 'Audit code path' },
    { title: 'Validate live state' },
    { title: 'Adversarial check' },
  ],
};

const CTX = `
CONTEXT — Hadley Bricks inventory app (Next.js 14 App Router, Supabase, Bricqer/eBay/Shopify). Windows + Git Bash via the Bash tool (PowerShell-isms not needed; use bash).
Repo root: C:/Users/Chris Hadley/claude-projects/hadley-bricks-inventory-management
Supabase: load the MCP tool via ToolSearch "select:mcp__plugin_supabase_supabase__execute_sql", project_id = "modjoikyuhqzouxvieua". USER_ID = "4b6e94b4-661c-4462-9d14-b21df7d51e5b".
Merged to main as commit cd76b16d ("fix(minifig): verify eBay de-list before EXECUTED + add reconciler (#532)").

THE BUG THIS FIXES: minifig pha005 ("Flying Mummy", bricqer_item_id 7449) DOUBLE-SOLD — sold on Bricqer (order 709, 30 Apr, £2.90) and again on eBay (order 18-14859-07444, 8 Jul, £6.57) off ONE physical figure. Root cause: apps/web/src/app/api/cron/minifigs/process-removals/route.ts wrapped the eBay withdrawOffer/deleteInventoryItem in bare try/catch and marked the removal row status=EXECUTED UNCONDITIONALLY — a silently-failed withdraw (or a null eBay adapter that run) looked identical to success, with no verify + no retry. eBay's Good-'Til-Cancelled auto-relist then kept the listing renewing under new item ids until it sold ~10 weeks later.

AUTHORITATIVE SIGNALS (critical — do not use the wrong one):
 - "is a minifig live on eBay" == getOffer(ebay_offer_id).status === 'PUBLISHED'. NOT the stored ebay_listing_id: GTC mints new item ids on renewal, so the stored id shows Completed while the item is still live under a new id.
 - "in stock on Bricqer" == getInventoryItem(bricqer_item_id).remainingQuantity >= 1.
 - getOffersBySku confirmed ONE offer per SKU on EBAY_GB FIXED_PRICE (no rogue duplicate offers), so offer status per tracked offer id is a complete signal for tracked items.

THE FIX (PR #532):
F1 — process-removals/route.ts: the row's remove_from is the REQUIRED action; only mark EXECUTED once confirmed. New module helper withdrawAndVerifyEbay(adapter, offerId, sku): withdraws + deletes, then getOffer must show status != 'PUBLISHED' (a 404 = offer gone = success); throws if still PUBLISHED or status unverifiable. For remove_from='EBAY': null adapter OR unverified teardown => teardownOk=false. For remove_from='BRICQER': reduceInventoryQuantity throw => teardownOk=false. If !teardownOk: DO NOT mark EXECUTED — leave row PENDING, write error_message, add to a Discord failure summary, continue. On success: mark EXECUTED with error_message=null. Shopify eBay safety-net (sold_on='SHOPIFY') stays best-effort (does not gate EXECUTED).
F2 — new apps/web/src/lib/minifig-sync/reconciler.service.ts (MinifigReconcilerService.reconcile) + route apps/web/src/app/api/cron/minifigs/reconcile/route.ts. Detection only, no mutations. Loads minifig_sync_items with ebay_offer_id NOT NULL; per item getOffer → offerStatus. Classes: DOUBLE-SELL RISK = offer PUBLISHED but Bricqer remainingQuantity<=0 (or Bricqer item 404); STALE LISTED = listing_status='PUBLISHED' but offer not PUBLISHED. Alerts to Discord (RED if any risk, else ORANGE). Registered GCP job minifig-reconcile, schedule "30 6 * * *", europe-west2.

EXPECTED BASELINE (from the author's pre-merge live run 2026-07-09 — verify independently, do NOT rubber-stamp; flag any drift from this):
 - 43 minifig_sync_items have ebay_offer_id NOT NULL.
 - Reconciler: checked=43, liveOnEbay=0, doubleSellRisks=0, staleListed=9, errors=0.
 - The 9 stale-listed (DB PUBLISHED but offer UNPUBLISHED): sw0505, sw0882, sw1047, pi057, sw1096, cas018, coltlbm42, ow002, lor031.
 - The 17 Bricqer-sold "de-listed" items all have offer status UNPUBLISHED (none live).
 - pha005: Bricqer qty 0; its eBay offer 989302921016 UNPUBLISHED; already sold (not a current live risk).

READ-ONLY DIAGNOSTIC SCRIPTS (apps/web/scripts, run: cd apps/web && npx tsx scripts/<name>):
 - _verify-reconciler.ts — runs MinifigReconcilerService against LIVE data with the Discord post STUBBED, prints checked/liveOnEbay/doubleSellRisks/staleListed/errors. This exercises the SAME service code as prod.
 - _audit-minifig-ebay-offers.ts — offer-status audit of the de-listed set (should show all UNPUBLISHED, 0 still-published).
 - _audit-published-minifigs.ts — the 9 PUBLISHED items vs live eBay offer + Bricqer qty.
 - _check-bricqer-item.ts <id> — {id, legoId, remainingQuantity, links[]}.
 - _probe-pha005-sku.ts, _probe-ebay-order-pha005.ts — pha005 specifics.
Env for scripts is in apps/web/.env.local (already present). eBay token comes from Supabase; scripts just work.

PROD trigger of the reconciler (validates the deployed route + job wiring): the GCP job carries the right auth. Run:
  AUTH=$(gcloud scheduler jobs describe minifig-reconcile --location=europe-west2 --format="value(httpTarget.headers.Authorization)")
  gcloud scheduler jobs run minifig-reconcile --location=europe-west2
Then read the result the route stored:
  SELECT job_name, status, http_status_code, records_processed, records_failed, result, started_at, completed_at FROM job_execution_history WHERE job_name='minifig-reconcile' ORDER BY started_at DESC LIMIT 3;
(The reconcile route calls jobExecutionService, storing a result JSON with checked/liveOnEbay/doubleSellRisks/staleListed/errors.) Triggering will post ONE Discord alert about the 9 stale-listed — that is expected, not a defect.
`;

const FINDING = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', description: 'true if this aspect is sound' },
    summary: { type: 'string', description: '1-2 sentence verdict' },
    evidence: {
      type: 'array',
      items: { type: 'string' },
      description: 'concrete facts: file:line, query result, or script output',
    },
    problems: {
      type: 'array',
      items: { type: 'string' },
      description: 'gaps/risks/failures with a severity tag (empty array if none)',
    },
  },
  required: ['ok', 'summary', 'evidence', 'problems'],
};

phase('Audit code path');
const codeFindings = await parallel([
  () =>
    agent(
      `${CTX}\nTASK: Audit F1 as MERGED. Read apps/web/src/app/api/cron/minifigs/process-removals/route.ts (and the withdrawAndVerifyEbay helper) end to end. Confirm ALL of:
(1) For remove_from='EBAY': the row is marked status=EXECUTED ONLY after withdrawAndVerifyEbay resolves (i.e. getOffer proved status != 'PUBLISHED'); a null ebayAdapter sets teardownOk=false (NOT executed); a missing ebay_offer_id is treated as nothing-live (acceptable).
(2) withdrawAndVerifyEbay: withdraw + delete are best-effort, but the FINAL getOffer gate is authoritative — status==='PUBLISHED' throws; a 404/not-found is treated as success; any other getOffer error throws (unverified => not executed).
(3) For remove_from='BRICQER': a reduceInventoryQuantity throw sets teardownOk=false (row stays PENDING).
(4) On !teardownOk: no EXECUTED update, error_message written, row remains PENDING (retries next run), added to the Discord failure summary; on success error_message is cleared to null.
(5) The Shopify safety-net (sold_on='SHOPIFY') is best-effort and does NOT gate EXECUTED.
Cite file:line for each. Set ok=false if EXECUTED can still be reached on an unverified/failed eBay teardown, if a null adapter can mark EXECUTED, or if a failed row can be silently lost (not retried, not surfaced).`,
      { label: 'audit:F1-process-removals', phase: 'Audit code path', schema: FINDING }
    ),
  () =>
    agent(
      `${CTX}\nTASK: Audit F2 as MERGED. Read apps/web/src/lib/minifig-sync/reconciler.service.ts and apps/web/src/app/api/cron/minifigs/reconcile/route.ts. Confirm:
(1) Candidate set = minifig_sync_items with ebay_offer_id NOT NULL (isNotNull filter), user-scoped.
(2) liveOnEbay is derived from getOffer(...).status==='PUBLISHED' — NOT the stored ebay_listing_id. A getOffer 404 is treated as not-live (GONE), other getOffer errors are recorded as errors (NOT as risks).
(3) DOUBLE-SELL RISK classification = live-on-eBay AND Bricqer remainingQuantity<=0 (or Bricqer item 404/missing). It only consults Bricqer for items that are live on eBay.
(4) STALE LISTED = listing_status==='PUBLISHED' AND not live on eBay.
(5) It performs NO writes/mutations (detection only) and alerts to Discord (RED when risks exist, else ORANGE); route is auth-gated (verifyCronAuth) and wired to jobExecutionService.
(6) The GCP job 'minifig-reconcile' is present in gcp/setup.ps1 at "30 6 * * *".
Cite file:line. Set ok=false if it could classify an in-stock item as a risk, MISS a live-out-of-stock item, rely on the stored listing id, or mutate data.`,
      { label: 'audit:F2-reconciler', phase: 'Audit code path', schema: FINDING }
    ),
]);

phase('Validate live state');
const liveFindings = await parallel([
  () =>
    agent(
      `${CTX}\nTASK: Validate the reconciler END-TO-END against prod + independently.
A) PROD PATH: trigger the deployed route via the GCP job (gcloud scheduler jobs run minifig-reconcile --location=europe-west2), wait ~20s, then read job_execution_history for job_name='minifig-reconcile' (latest row): assert http_status_code=200 and capture the result JSON (checked/liveOnEbay/doubleSellRisks/staleListed/errors).
B) INDEPENDENT RE-DERIVATION: run cd apps/web && npx tsx scripts/_verify-reconciler.ts (same service, Discord stubbed). Capture its printed counts + the stale-listed bricklink ids.
C) CROSS-CHECK: the prod result and the local re-derivation must AGREE with each other AND be internally consistent. Assert doubleSellRisks=0 (no minifig live on eBay while Bricqer=0). If staleListed>0, list the ids. Compare to the expected baseline (43 / 0 / 9 and the 9 named ids) and EXPLAIN any drift (counts can legitimately move if stock/listings changed since 2026-07-09 — a NEW double-sell risk (>0) is a FAIL; a changed stale count with a plausible cause is not).
Put the raw job_execution_history result JSON + script stdout in evidence. ok=false if the prod route errored, the two paths disagree, or doubleSellRisks>0.`,
      { label: 'live:reconciler-e2e', phase: 'Validate live state', schema: FINDING }
    ),
  () =>
    agent(
      `${CTX}\nTASK: Validate F1's live invariant — no EXECUTED-but-still-live, and failures are surfaced not lost.
1. Re-audit the de-listed set: run cd apps/web && npx tsx scripts/_audit-minifig-ebay-offers.ts. Assert 0 offers still PUBLISHED (all UNPUBLISHED). Any PUBLISHED here = an EXECUTED removal that didn't actually de-list = FAIL.
2. Removal-queue health via Supabase:
   - SELECT status, count(*) FROM minifig_removal_queue GROUP BY status;
   - Any PENDING rows: SELECT id, minifig_sync_id, sold_on, remove_from, error_message, created_at FROM minifig_removal_queue WHERE status='PENDING' ORDER BY created_at DESC; (post-fix, a genuinely-failing de-list SHOULD sit PENDING with an error_message — that is the fix working, not a defect, UNLESS it is also currently live on eBay AND out of stock on Bricqer, which would be an un-actioned double-sell.)
   - Confirm no removal row is marked EXECUTED while its item is still live on eBay (spot-check any suspicious ones with getOffer via _audit-minifig-ebay-offers.ts coverage).
3. pha005 sanity: confirm bricqer 7449 remainingQuantity=0 (scripts/_check-bricqer-item.ts 7449) and its offer 989302921016 is UNPUBLISHED (already sold; not a live risk). It should NOT appear as a current double-sell risk.
Put query output + script stdout in evidence. ok=false if any EXECUTED removal is still live on eBay, or a PENDING+error row is also live-and-out-of-stock with no alert path.`,
      { label: 'live:F1-invariant', phase: 'Validate live state', schema: FINDING }
    ),
  () =>
    agent(
      `${CTX}\nTASK: Validate the DEPLOY + GCP wiring.
1. Prod deploy landed: git -C "C:/Users/Chris Hadley/claude-projects/hadley-bricks-inventory-management" log --oneline -1 origin/main should be the #532 squash commit. Confirm the new route is live: curl -s -o /dev/null -w "%{http_code}" -X POST https://hadley-bricks-inventory-management.vercel.app/api/cron/minifigs/reconcile with NO auth header should be 401 (auth-gated, route exists); a plain 404 = NOT deployed = FAIL.
2. GCP job: gcloud scheduler jobs describe minifig-reconcile --location=europe-west2 --format="yaml(schedule,timeZone,state,httpTarget.uri,httpTarget.httpMethod)". Assert state=ENABLED, schedule="30 6 * * *", method POST, uri ends /api/cron/minifigs/reconcile. Also confirm it carries an Authorization header (do NOT print the secret value — just assert the header key exists) by checking the header keys list.
3. Confirm the fix did not disturb the sibling jobs: gcloud scheduler jobs list --location=europe-west2 shows minifig-process-removals still ENABLED at */30.
Put command output (secrets redacted) in evidence. ok=false if the route is 404 in prod, the job is missing/disabled/misconfigured, or auth is absent.`,
      { label: 'live:deploy-gcp', phase: 'Validate live state', schema: FINDING }
    ),
]);

phase('Adversarial check');
const adversarial = await agent(
  `${CTX}\nADVERSARIAL TASK: REFUTE the claim "PR #532 makes minifig cross-platform de-list safe against double-sell AND the reconciler reliably flags the drift that matters." Default ok=false unless you satisfy yourself there is no real, unmitigated hole. Probe with code reads + Supabase + the scripts:
- F1 FALSE-NEGATIVE: can EXECUTED still be reached while the eBay listing is live? e.g. getOffer returns a non-PUBLISHED status the moment after withdraw but a GTC renewal re-publishes later — does anything re-check? (The reconciler is the backstop — is it enough, and is it scheduled?) Is there any status value from getOffer other than PUBLISHED/UNPUBLISHED that should count as live?
- F1 FALSE-POSITIVE / liveness: a genuinely-stuck de-list now sits PENDING forever and re-alerts every 30 min. Confirm that is the intended trade-off and that process-removals still runs (GCP */30) so PENDING rows actually retry; check no PENDING row is silently starved (e.g. the .limit(50) fetch).
- RECONCILER BLIND SPOT: it only inspects items with ebay_offer_id NOT NULL. Could a minifig be LIVE on eBay while out of stock on Bricqer yet have a NULL ebay_offer_id in our DB (so the reconciler never checks it)? Reason about how such a row could exist (e.g. offer id cleared, or an untracked/duplicate listing). Quantify: SELECT count(*) FROM minifig_sync_items WHERE ebay_offer_id IS NULL AND listing_status NOT IN ('NOT_LISTED'); and judge residual risk. Also: getOffersBySku showed one-offer-per-sku for pha005 — is that guaranteed for all, or could a rogue second listing (like the one that sold pha005 under a different item id) escape an offer-status-only check?
- RECONCILER CORRECTNESS: independently pick 2-3 of the 9 stale-listed ids and confirm via getOffer they really are not PUBLISHED (so they are true stale, not false alarms). Confirm the reconciler would have FLAGGED pha005 as a double-sell risk had it still been live+out-of-stock (i.e. the logic actually fires on the real historical case).
- SCHEDULING/DEPLOY: is minifig-reconcile actually going to run daily in prod (job ENABLED + route 200 under auth), or will it 404/401 forever?
Report ok=true ONLY if none of these is a real, unmitigated problem. Put every concrete risk in problems with a severity tag (LOW/MED/HIGH).`,
  { label: 'adversarial:refute', phase: 'Adversarial check', schema: FINDING }
);

const findings = [...codeFindings.filter(Boolean), ...liveFindings.filter(Boolean), adversarial].filter(
  Boolean
);
const blocking = findings.filter((f) => f && f.ok === false);
const verdict = blocking.length === 0 ? 'PASS' : 'FAIL';
log(`PR #532 E2E validation ${verdict} — ${findings.length} checks, ${blocking.length} blocking issue(s)`);

return {
  verdict,
  checks: findings.map((f) => ({ ok: f.ok, summary: f.summary, problems: f.problems })),
  problems: findings.flatMap((f) => f.problems || []),
  findings,
};
