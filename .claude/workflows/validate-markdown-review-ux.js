export const meta = {
  name: 'validate-markdown-review-ux',
  description:
    'E2E validation of PR #512 — markdown summary-count fix, detail dialog, queue-routed Amazon approvals, market-aware exit gate — against live production',
  whenToUse:
    'After merging + deploying PR #512, to independently confirm the deploy landed, the summary cards now match true DB counts (1,000-row cap fixed), the detail dialog works on prod, Amazon approvals queue instead of direct-push, and the 365d exit defers correctly for healthy-demand ASINs.',
  phases: [
    { title: 'Validate', detail: 'one read-only validator per dimension, against prod Vercel + Supabase + live UI' },
    { title: 'Verify', detail: 'adversarially re-check any FAIL/WARN finding' },
    { title: 'Synthesize', detail: 'PASS/FAIL E2E report' },
  ],
};

const CTX = `
CONTEXT — you are validating PR #512 "feat(markdown): review UX + queue-routed Amazon approvals + market-aware exit gate" (squash commit c125de04, merged to main 2026-07-07 ~08:40 UTC) on PRODUCTION.
The four changes:
 (1) /api/markdown/proposals summary was an unpaginated row-select that silently capped at Supabase's 1,000-row limit (markdown_proposals has ~1,422 rows; the Rejected card showed 272 vs true 581). Now per-status head:true count queries. UI: 5 cards (Pending Review, Auto-Relisted, Approved, Rejected, Failed) with subtexts.
 (2) The markdown page (/inventory/markdown) rows are now clickable and open a proposal detail dialog: full untruncated diagnosis_reason, plain-English diagnosis explanation, current/proposed/floor/market grid, days listed, approve/reject buttons for PENDING.
 (3) apps/web/src/lib/markdown/apply.service.ts Amazon branch no longer calls RepricingService.pushPrice directly; it inserts into amazon_sync_queue (is_new_sku:false, amazon_sku from platform_listings, product_type via getProductTypeForAsin) so approvals follow the standard two-phase feed → price-verify process. 23505 duplicate → update local_price on the existing queue row. Returns {queued:true}; proposal is marked APPROVED with pushed_to_platform=false.
 (4) apps/web/src/lib/pricing/engine.ts: the amazon_exit_days (365d) AUCTION exit now runs through deferExitToMarket() first: competitor holds box + salesRankDrops90 >= amazon_healthy_drops_90d + stable market clears floor + current price > market target → REPRICE to market ("exit deferred"); we hold box (or sole offer) + healthy drops → HOLD ("exit deferred"); otherwise (no market data, thin demand, already at market, market below floor) the AUCTION exit proceeds.

ENVIRONMENT: repo root C:\\Users\\Chris Hadley\\claude-projects\\hadley-bricks-inventory-management, on main at c125de04. Run throwaway scripts from apps/web with: npx tsx --env-file=.env.local scripts/_validate-<name>.ts . .env.local holds PROD Supabase creds (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY). Supabase project id: modjoikyuhqzouxvieua. Production app: https://hadley-bricks-inventory-management.vercel.app . Remember the Supabase 1,000-row cap — paginate or use head:true counts in your own queries too.

RULES: Be INDEPENDENT and ADVERSARIAL — recompute everything from source data; do not trust the PR description. READ-ONLY: do not mutate the DB, do not approve/reject any proposal, do not push prices, do not click Run Scan. Report concrete evidence (counts, sample rows, file:line).`;

const FINDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dimension', 'verdict', 'summary', 'evidence', 'issues'],
  properties: {
    dimension: { type: 'string' },
    verdict: { type: 'string', enum: ['PASS', 'WARN', 'FAIL'] },
    summary: { type: 'string', description: 'one-line conclusion' },
    evidence: { type: 'string', description: 'counts + sample rows / file:line proving it' },
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

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['upheld', 'reasoning'],
  properties: {
    upheld: { type: 'boolean', description: 'true if the original FAIL/WARN finding survives adversarial re-check' },
    reasoning: { type: 'string' },
  },
};

const DIMENSIONS = [
  {
    key: 'deploy',
    prompt: `Confirm PR #512 is DEPLOYED to production. (a) gh api repos/chrishadley1983/hadley-bricks-inventory-management/deployments?per_page=5 — find a Production deployment for sha c125de04... and check its latest status is success (deployments/{id}/statuses). (b) curl -s -o /dev/null -w "%{http_code}" https://hadley-bricks-inventory-management.vercel.app/inventory/markdown — expect 307/302 (auth redirect) or 200, NOT 5xx. (c) Confirm main HEAD locally is c125de04 (git log -1). Verdict FAIL if no successful Production deployment of the commit exists.`,
  },
  {
    key: 'summary-counts',
    prompt: `Validate the summary-count fix. (a) With your own tsx script using head:true counts, get TRUE per-status counts of markdown_proposals (PENDING, APPROVED, REJECTED, AUTO_APPLIED, FAILED, EXPIRED) and the total row count. (b) Confirm the bug precondition: total rows > 1000 (else the fix is unproven — WARN). (c) Read the deployed code apps/web/src/app/api/markdown/proposals/route.ts on main and confirm the summary uses head:true count queries per status (not a row select), and that markdowns/auctions counts use proposed_action. (d) Simulate the OLD bug: select rows with no range and show the returned row count caps at 1000, proving the old code undercounted. Report the true card values Chris should now see. Verdict FAIL if the deployed code could still undercount any card.`,
  },
  {
    key: 'ui-live',
    prompt: `Validate the LIVE UI on production via browser automation (Claude-in-Chrome MCP tools — load them with ONE ToolSearch call: select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__find,mcp__claude-in-chrome__get_page_text). Call tabs_context_mcp first, create a NEW tab, navigate to https://hadley-bricks-inventory-management.vercel.app/inventory/markdown (Chris's Chrome is logged in). Checks: (a) FIVE summary cards render: Pending Review, Auto-Relisted, Approved, Rejected, Failed — record their numbers. (b) Cross-check those numbers against the DB with your own tsx head-count script — they must match exactly. (c) Click the FIRST table row (not the checkbox, not the approve/reject icons) — a detail dialog must open showing the item name, the FULL diagnosis reason (untruncated), a plain-English explanation, and a price grid (Current/Proposed/Cost floor/Market reference/Days listed). Screenshot it. (d) Close the dialog (Escape or X) WITHOUT clicking Approve or Reject. NEVER click Approve, Reject, bulk buttons, or Run Scan. If the page shows a Vercel auth wall or login page, report WARN with what you saw. Verdict FAIL if cards mismatch the DB or the dialog does not open/show the full rationale.`,
  },
  {
    key: 'queue-routing',
    prompt: `Validate the Amazon approve→queue routing (code + schema, NO live approval). (a) Read apps/web/src/lib/markdown/apply.service.ts on main: confirm the amazon branch inserts into amazon_sync_queue and does NOT call RepricingService.pushPrice; confirm eBay branch still pushes live via reviseFixedPriceItem. (b) Verify the insert's columns against the amazon_sync_queue schema (supabase/migrations or packages database types): user_id, inventory_item_id, sku, asin, local_price, local_quantity, amazon_sku, amazon_price, amazon_quantity, product_type, is_new_sku must all exist and NOT-NULL constraints must be satisfied by the values used. (c) Confirm via SQL (information_schema / pg_constraint on prod) that a unique constraint exists that makes the 23505 duplicate-handling path reachable (e.g. unique on inventory_item_id or (user_id, inventory_item_id)) — if NO unique constraint exists, duplicate approvals would create duplicate queue rows: report as issue. (d) Trace the downstream: confirm the two-phase submit path (AmazonSyncService.submitTwoPhaseFeed / api/amazon/sync/submit + api/cron/amazon-sync) consumes amazon_sync_queue rows with is_new_sku=false and pushes local_price. (e) Adversarial: find any path where an approval marks the proposal APPROVED but the price change is silently lost (e.g. getProductTypeForAsin throwing, listing_value updated but queue insert failing). Verdict FAIL only for a defect that loses or corrupts a price change; design-level observations are WARN issues.`,
  },
  {
    key: 'exit-gate',
    prompt: `Validate the market-aware exit gate. (a) Run the engine tests: cd apps/web && npx vitest run src/lib/pricing — must pass. (b) Read deferExitToMarket in apps/web/src/lib/pricing/engine.ts and adversarially hunt edge cases: null handling (mkt, drops, stable), floor clamping (finalize clamps target up to floor — can that produce a proposal ABOVE the market? is that acceptable?), oscillation risk (defer→reprice→next sweep→exit or re-defer loops), interaction with the persistence gate (deferral skips it — is 365d of listing sufficient justification?), and the weAreTheMarket sole-offer case (drops on a sole-offer ASIN are OUR sales — is holding right?). (c) Ground it in prod data with a tsx script: for the PENDING AUCTION/EXIT proposals on amazon (status=PENDING, proposed_action=AUCTION), join their inventory items' amazon_asin to the latest keepa/amazon pricing data available (e.g. amazon_arbitrage_pricing / keepa snapshot tables — discover the actual table the markdown cron uses by reading apps/web/src/app/api/cron/markdown/route.ts buildAmazonMarketContext) and estimate how many would now DEFER instead of exit under the new gate (healthy drops + stable clears floor + current > market). Report the count and 3 examples (e.g. 40585 World of Wonders should plausibly defer if its ASIN has drops90 >= 10 and a viable stable price). Note: existing PENDING proposals were generated by the OLD engine and the sweep skips items with a PENDING proposal — flag as WARN if stale EXIT proposals will linger unless rejected/re-evaluated. Verdict FAIL only for a logic defect in the gate itself.`,
  },
];

phase('Validate');
log('Fanning out 5 read-only validators against prod (deploy, counts, live UI, queue routing, exit gate)');

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
      `${CTX}\n\nAn independent validator reported this ${finding.verdict} for dimension "${d.key}":\nSummary: ${finding.summary}\nEvidence: ${finding.evidence}\nIssues: ${JSON.stringify(finding.issues)}\n\nAdversarially RE-CHECK it from scratch (read the code / query prod yourself, read-only). Is the finding real, or a validator error (wrong table, stale assumption, misread code)? Return the structured verdict.`,
      { label: `verify:${d.key}`, phase: 'Verify', schema: VERDICT_SCHEMA }
    );
    return { ...finding, upheld: v ? v.upheld : true, verifyReasoning: v?.reasoning };
  }
);

phase('Synthesize');
const findings = results.filter(Boolean);
const report = await agent(
  `${CTX}\n\nAll validator findings (after adversarial verification of FAIL/WARN ones):\n${JSON.stringify(findings, null, 2)}\n\nWrite the final E2E validation report for PR #512: overall PASS/FAIL verdict first, then a per-dimension table (dimension, verdict, one-line evidence), then any upheld issues with severity and a recommended action each, then explicitly list the true summary-card values Chris should now see on /inventory/markdown. Plain text, concise, no fluff.`,
  { label: 'synthesize', phase: 'Synthesize' }
);

return { findings, report };
