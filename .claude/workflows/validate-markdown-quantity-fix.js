export const meta = {
  name: 'validate-markdown-quantity-fix',
  description:
    'E2E validation of PR #513 (whole-ASIN reprice queue fixing the quantity-clamp blocker) + the stale AUCTION proposal cleanup — against live production',
  whenToUse:
    'After merging + deploying PR #513 and running _markdown-reject-stale-auctions-2026-07-07.ts, to confirm the clamp defect is gone, the buy-box-gap route still works, and the stale exit proposals were cleared so the new gate can act.',
  phases: [
    { title: 'Validate', detail: 'read-only validators: fix deploy, clamp-fix correctness, stale cleanup' },
    { title: 'Verify', detail: 'adversarially re-check any FAIL/WARN finding' },
    { title: 'Synthesize', detail: 'PASS/FAIL report' },
  ],
};

const CTX = `
CONTEXT — you are validating PR #513 "fix(markdown): queue whole-ASIN reprice to prevent quantity clamp on approval" (squash commit 3e0ad863, merged to main 2026-07-07 ~09:15 UTC) plus a data cleanup, on PRODUCTION.

Background: PR #512 routed Amazon markdown approvals into amazon_sync_queue, but inserted ONE row per approval with amazon_quantity:null. The two-phase sync aggregates by ASIN with totalQuantity = (first row's amazon_quantity ?? 0) + row count and phase 2 PATCHes fulfillment_availability to that absolute value — so approving a subset of a multi-unit ASIN would clamp live stock (e.g. 6→1). PR #513 fixes it by extracting the buy-box-gap pattern into apps/web/src/lib/amazon/reprice-queue.ts (queueAmazonRepriceByAsin): a reprice updates listing_value on and queues EVERY in-play (LISTED/BACKLOG) unit of the ASIN, so the pushed quantity equals the full HB unit count. Both apps/web/src/lib/markdown/apply.service.ts (amazon branch) and apps/web/src/app/api/reports/buy-box-gap/reprice/route.ts now use it. PR #513 also added a Keepa divergence guard (>25% → no deferral) to deferExitToMarket in apps/web/src/lib/pricing/engine.ts.

Data cleanup (already applied ~09:20 UTC via apps/web/scripts/_markdown-reject-stale-auctions-2026-07-07.ts): the 62 PENDING amazon AUCTION proposals (all generated pre-merge by the OLD engine) were REJECTED and their 62 inventory items had next_markdown_eval_at reset to 2026-07-07 so the next sweep re-evaluates them under the new exit gate (~5 expected to defer-reprice: 43223 x4, 40442).

ENVIRONMENT: repo root C:\\Users\\Chris Hadley\\claude-projects\\hadley-bricks-inventory-management, main at 3e0ad863. Throwaway scripts from apps/web: npx tsx --env-file=.env.local scripts/_validate-<name>.ts (PROD Supabase creds in .env.local). Supabase project modjoikyuhqzouxvieua. Prod app https://hadley-bricks-inventory-management.vercel.app . Beware the Supabase 1,000-row cap — paginate/head-count your own queries.

RULES: INDEPENDENT and ADVERSARIAL; READ-ONLY (no DB mutations, no approvals, no syncs, no Run Scan). Concrete evidence: counts, sample rows, file:line.`;

const FINDING_SCHEMA = {
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

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['upheld', 'reasoning'],
  properties: { upheld: { type: 'boolean' }, reasoning: { type: 'string' } },
};

const DIMENSIONS = [
  {
    key: 'fix-deploy',
    prompt: `Confirm PR #513 is deployed: (a) gh api deployments — a successful Production deployment exists for sha 3e0ad863...; (b) prod URL /inventory/markdown returns 307/200 not 5xx; (c) local main HEAD is 3e0ad863; (d) engine tests pass: cd apps/web && npx vitest run src/lib/pricing (46 expected).`,
  },
  {
    key: 'clamp-fix',
    prompt: `Validate the quantity-clamp fix end-to-end IN CODE + DATA (no live sync). (a) Read apps/web/src/lib/amazon/reprice-queue.ts and apply.service.ts on main: markdown amazon approvals must call queueAmazonRepriceByAsin; confirm it selects ALL inventory_items with the ASIN in status LISTED/BACKLOG (case variants), updates listing_value on all, queues each (BACKLOG via addToQueue(skipConflictCheck=true), LISTED via direct insert with is_new_sku:false, 23505→price update). Grep lib/markdown for any remaining single-row amazon_sync_queue insert or pushPrice — must be none. (b) Recompute the aggregation math: given getAggregatedQueueItems (amazon-sync.service.ts ~:582-623, totalQuantity = first row amazon_quantity??0 + row count), show that approving ONE proposal on B0FWPK8DNK now yields queue rows = number of in-play HB units, hence pushed quantity = HB unit count (query prod: count in-play inventory_items for B0FWPK8DNK and B0DTV6K5HC; compare with platform_listings quantity for those ASINs). (c) Flag (informational WARN, not FAIL) any of the pending-proposal ASINs where HB in-play unit count != platform_listings live quantity — pushing HB count is the app's HB-is-truth design (same as the long-standing buy-box-gap flow), but a large drift list is worth surfacing. (d) Confirm the buy-box-gap route (app/api/reports/buy-box-gap/reprice/route.ts) now delegates to the shared fn with an unchanged response shape (data.asin/newPrice/inventoryItemsUpdated/queuedForSync/errors + message). (e) Adversarial: any path where approval marks APPROVED but queueing partially failed (errors swallowed)? apply.service treats success = queued>0 AND errors.length===0 — verify. Verdict FAIL only for a defect that could still corrupt live stock or lose a price change.`,
  },
  {
    key: 'stale-cleanup',
    prompt: `Validate the stale-proposal cleanup with your own prod queries: (a) 0 PENDING amazon AUCTION markdown_proposals remain; (b) REJECTED amazon AUCTION proposals with updated_at today (2026-07-07) number exactly 62; (c) the 62 affected inventory items have next_markdown_eval_at = 2026-07-07; (d) eBay PENDING proposals were NOT touched (report their count) and PENDING amazon MARKDOWN proposals (~80) were NOT touched; (e) total pending is now ~132 (194 - 62) — recompute exactly. (f) Sanity: the next markdown sweep (api/cron/markdown) will pick these items up — read the cron's eligibility query to confirm next_markdown_eval_at <= today items with no PENDING proposal are re-evaluated. Verdict FAIL if any stale amazon AUCTION proposal remains PENDING or unrelated proposals were rejected.`,
  },
];

phase('Validate');
log('Fanning out 3 read-only validators (fix deploy, clamp fix, stale cleanup)');

const results = await pipeline(
  DIMENSIONS,
  (d) =>
    agent(`${CTX}\n\nYOUR DIMENSION: ${d.key}\n${d.prompt}\n\nReturn the structured finding.`, {
      label: `validate:${d.key}`,
      phase: 'Validate',
      schema: FINDING_SCHEMA,
    }),
  async (finding, d) => {
    if (!finding) return null;
    if (finding.verdict === 'PASS') return { ...finding, upheld: true };
    const v = await agent(
      `${CTX}\n\nA validator reported this ${finding.verdict} for "${d.key}":\nSummary: ${finding.summary}\nEvidence: ${finding.evidence}\nIssues: ${JSON.stringify(finding.issues)}\n\nAdversarially RE-CHECK from scratch (read-only). Real finding or validator error? Return the structured verdict.`,
      { label: `verify:${d.key}`, phase: 'Verify', schema: VERDICT_SCHEMA }
    );
    return { ...finding, upheld: v ? v.upheld : true, verifyReasoning: v?.reasoning };
  }
);

phase('Synthesize');
const findings = results.filter(Boolean);
const report = await agent(
  `${CTX}\n\nFindings (FAIL/WARN adversarially verified):\n${JSON.stringify(findings, null, 2)}\n\nWrite the final report: overall PASS/FAIL first, per-dimension table, upheld issues with severity + recommended action, and a one-paragraph "is it now safe for Chris to approve Amazon markdown proposals?" answer. Plain text, concise.`,
  { label: 'synthesize', phase: 'Synthesize' }
);

return { findings, report };
