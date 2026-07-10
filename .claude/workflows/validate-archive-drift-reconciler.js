export const meta = {
  name: 'validate-archive-drift-reconciler',
  description: 'E2E validation of PR #467 Shopify archive-drift reconciler against live production',
  whenToUse: 'After merging + deploying reconcileArchiveDrift(), to confirm sold-but-live products are gone, the reconciler runs cleanly in prod, it does not over-archive legit LISTED stock, and the fix is deployed.',
  phases: [
    { title: 'Validate', detail: 'live-Shopify checks of state + reconciler behaviour' },
    { title: 'Verify', detail: 'adversarially re-check any FAIL/WARN' },
    { title: 'Synthesize', detail: 'PASS/FAIL report' },
  ],
};

const CTX = `
CONTEXT — validate PR #467 "fix(shopify): reconcile archive drift" on PRODUCTION.
The fix adds ShopifySyncService.reconcileArchiveDrift(): for every Shopify product whose backing inventory is ENTIRELY non-LISTED (all sold/removed), it checks the LIVE Shopify product status, re-archives any still ACTIVE, and Discord-alerts on the mismatch. Wired into the shopify-orders cron. Background: the price-sync E2E validation found ONE drifted product (Easter Basket set 40587, product 10419727270154) which has ALREADY been manually re-archived, so production should now be clean.

ENVIRONMENT: work from apps/web. Run scripts with: npx tsx --env-file=.env.local scripts/<name>.ts
.env.local has PROD creds (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SERVICE_USER_ID, Google SA). shopify_config is in Supabase — use ShopifyClient (getClient pattern in apps/web/scripts/_shopify-admin.ts). The reconciler lives in apps/web/src/lib/shopify/sync.service.ts (method reconcileArchiveDrift). A grouped Shopify product can be backed by MULTIPLE inventory units — only "all units non-LISTED" makes it a candidate; a product with even one LISTED backing unit must NOT be archived.

RULES: Be INDEPENDENT + ADVERSARIAL. Write your own throwaway tsx script (_validate-*.ts), read LIVE Shopify status (ShopifyClient), never trust the cached shopify_products.shopify_status (it is exactly what drifts). Where you must write, only the reconciler itself may archive — your validation scripts are READ-ONLY unless a dimension explicitly says to invoke the reconciler.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dimension', 'verdict', 'summary', 'evidence', 'issues'],
  properties: {
    dimension: { type: 'string' },
    verdict: { type: 'string', enum: ['PASS', 'WARN', 'FAIL'] },
    summary: { type: 'string' },
    evidence: { type: 'string' },
    issues: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['item', 'problem'], properties: { item: { type: 'string' }, problem: { type: 'string' } } } },
  },
};

const DIMENSIONS = [
  {
    key: 'state-clean',
    prompt: `Confirm production has ZERO sold-but-live products. Independently: pull every shopify_products mapping, group by product_id, and find products whose backing inventory is entirely non-LISTED (no unit status=LISTED). Live-check each such candidate via ShopifyClient (batch with a nodes query) — any that is status=ACTIVE is a drift. Verdict FAIL if any sold-backed product is still live ACTIVE. (Expect 0 — the one known drift, Easter Basket 40587, was already re-archived.) Report candidate count + how many live-active.`,
  },
  {
    key: 'no-collateral',
    prompt: `Confirm the reconciler does NOT over-archive legitimate stock. The reconciler only targets products with ZERO LISTED backing. Verify: (a) products that DO have >=1 LISTED backing unit are still status=ACTIVE on live Shopify (sample 30+ and read live status) — none wrongly archived; (b) specifically confirm set 40587's LISTED units' product 10545812373770 is still ACTIVE (it must survive — only the all-sold ghost 10419727270154 should be archived). Verdict FAIL if any LISTED-backed product was archived.`,
  },
  {
    key: 'reconciler-runs',
    prompt: `Confirm the DEPLOYED reconciler actually runs in production. Write a tiny script that instantiates ShopifySyncService(serviceRoleSupabase, SERVICE_USER_ID) and calls reconcileArchiveDrift(), printing the returned {checked, drifted, archived, failed, errors}. It executes the real deployed code path. Expected: completes with no thrown error; drifted should be 0 (state already clean) so archived=0 and NO Discord alert. If drifted>0, independently confirm each archived product was genuinely all-sold + was live-ACTIVE before (legit catch, not over-archiving). Verdict FAIL if it throws, or archives a product that had LISTED backing.`,
  },
  {
    key: 'deployed',
    prompt: `Confirm the fix is deployed. (1) git: origin/main HEAD commit message is the PR #467 archive-drift reconciler (run: git log origin/main --oneline -3). (2) the shopify-orders cron route (apps/web/src/app/api/cron/shopify-orders/route.ts) calls reconcileArchiveDrift. (3) reconcileArchiveDrift exists in sync.service.ts on origin/main. (4) Vercel prod core pages (https://hadley-bricks-inventory-management.vercel.app/, /workflow) return 200. Verdict PASS if all present.`,
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
      `${CTX}\n\nA validator reported "${f.dimension}" as ${f.verdict}: ${f.summary}\nEvidence: ${f.evidence}\nIssues: ${JSON.stringify(f.issues)}\n\nYou are the SKEPTIC. Independently reproduce against LIVE production. Decide if each issue is a REAL defect in the deployed reconciler (e.g. over-archived a LISTED-backed product, threw an error, missed a genuine sold-but-live) or a false positive (stale cache, pre-existing unrelated data, a product correctly left active). Default to "real" only if reproduced live.`,
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
  `${CTX}\n\nSynthesize the FINAL E2E verdict for PR #467 (archive-drift reconciler) on production.\n\nFINDINGS:\n${JSON.stringify(findings, null, 2)}\n\nADVERSARIAL VERIFICATIONS:\n${JSON.stringify(verifications, null, 2)}\n\nProduce: overall PASS / PASS-WITH-NOTES / FAIL; one line per dimension; whether the reconciler (a) runs cleanly in prod, (b) leaves 0 sold-but-live, (c) does NOT over-archive legit LISTED stock, (d) is deployed; and any CONFIRMED-REAL defect with severity + action. Be specific.`,
  { label: 'synthesize', phase: 'Synthesize' }
);

log('Archive-drift reconciler validation complete.');
return { findings, verifications, report };
