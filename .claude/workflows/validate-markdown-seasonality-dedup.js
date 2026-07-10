export const meta = {
  name: 'validate-markdown-seasonality-dedup',
  description:
    'E2E validation of PR #531 — season-aware markdown pricing + one Amazon proposal per (asin,condition) — against live production',
  whenToUse:
    'After merging + deploying PR #531, backfilling the Keepa 365d fields, and re-running the markdown sweep, to confirm the seasonal-trough HOLD guard fires correctly on the 8 seasonal sets, the Amazon proposals are deduped one-per-ASIN with correct units and no markdown/exit split-brain, and non-seasonal stale stock still marks down.',
  phases: [
    { title: 'Validate', detail: 'read-only validators: deploy, 365d data, dedup+conflict, seasonality, digest/UI' },
    { title: 'Verify', detail: 'adversarially re-check any FAIL/WARN finding' },
    { title: 'Synthesize', detail: 'PASS/FAIL report' },
  ],
};

const CTX = `
CONTEXT — you are validating PR #531 "feat(markdown): season-aware pricing + one Amazon proposal per ASIN" (squash commit 3e72dc3d, merged to main 2026-07-08) on PRODUCTION.

WHAT SHIPPED (two changes to the 30-day markdown sweep, api/cron/markdown/route.ts):

1. ONE Amazon proposal per (asin, condition). An Amazon price is per-ASIN and approval reprices EVERY in-play unit (queueAmazonRepriceByAsin). The old sweep created one proposal PER inventory unit — up to 21 rows for a single ASIN, and the same ASIN could get both a MARKDOWN and an EXIT/AUCTION rec on different-aged units (e.g. 30193). Now Amazon is decided ONCE per (asin, condition) group: the OLDEST unit drives the aging/exit decision, the price must clear the HIGHEST-cost unit's floor, and the proposal carries a units count (new column markdown_proposals.units). eBay stays per-listing (units=1).

2. Season-aware reference. The engine (apps/web/src/lib/pricing/engine.ts) matched a ~180d median that, for a seasonal set evaluated off-season, IS the annual trough. Added Keepa 365d avg (was_price_365d) + 365d high (high_365d) to amazon_arbitrage_pricing (Keepa client now stats=365). New guard isSeasonalTrough(stable, mkt): seasonal when seasonalHigh365 >= stable*1.25 AND keepaAvg365 >= stable*1.05. In computeAmazonCompetitorHoldsBox, if seasonal AND currentPrice <= seasonalHigh365 → HOLD (reason contains "Seasonal trough"), instead of matching the off-season market. Non-seasonal ASINs (365 ~= 180 ~= median) are unaffected. Guard has 3 unit tests (49 total in engine.test.ts, all pass).

OPS ALREADY DONE before this validation: (a) migration 20260708234500 applied; (b) _markdown-backfill-365-2026-07-08.ts populated was_price_365d/high_365d on today's (2026-07-08) snapshots for the 269 LISTED Amazon ASINs; (c) stale per-unit PENDING Amazon proposals were rejected + their inventory items' next_markdown_eval_at reset to 2026-07-08; (d) the markdown sweep (api/cron/markdown) was re-run, regenerating clean grouped + seasonal-aware proposals.

THE 8 SEASONAL SETS to check (all New): 40700 Winter Holiday Train B0DPGTRL66 (Christmas), 40777 Gingerbread Train Ornament B0G6XD72Q1 (Christmas), 40756 Lucky Knots B0DTV6K5HC (CNY), 40608 Halloween Fun VIP B0CKM181QH (Halloween), 40759 Valentine Box B0DV4475PN (Valentine), 40462 Valentine's Brown Bear B09LFJGXW9 (Valentine), 40764 Easter Bunny B0F3X9N8PC (Easter), 40417 Year of the Ox B08W4LQVVV (CNY, old 2021 set). Pre-fix these were all proposed for markdown matching an off-season trough. NOTE: seasonality is DATA-DRIVEN — a set only HOLDs if its Keepa 365d high/avg actually trip the guard; verify from the live 365d data, do not assume. 40585 World of Wonders (B0BWWXT1R9, 21 units) is a good NON-seasonal contrast: it should still mark down.

ENVIRONMENT: repo root C:\\Users\\Chris Hadley\\claude-projects\\hadley-bricks-inventory-management, main at 3e72dc3d. Throwaway scripts from apps/web: npx tsx --env-file=.env.local scripts/_validate-<name>.ts (PROD Supabase creds in .env.local). You may also query Supabase directly (project modjoikyuhqzouxvieua) via the execute_sql MCP if available. Prod app https://hadley-bricks-inventory-management.vercel.app . Beware the Supabase 1,000-row cap — paginate / head-count your own queries.

RULES: INDEPENDENT and ADVERSARIAL; READ-ONLY (no DB mutations, no approvals, no syncs). Recompute the engine's seasonal maths yourself from the live 365d columns rather than trusting proposal rows. Concrete evidence: counts, sample rows, file:line.`;

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
    key: 'deploy-schema',
    prompt: `Confirm PR #531 is deployed and the schema is live. (a) local main HEAD is 3e72dc3d (git log -1); (b) a successful Production Vercel deployment exists for that sha (gh api / gh pr checks 531) and prod /inventory/markdown returns 307/200 not 5xx; (c) engine tests pass: cd apps/web && npx vitest run src/lib/pricing (expect 49); (d) the migration columns exist: amazon_arbitrage_pricing.was_price_365d + high_365d and markdown_proposals.units (query information_schema.columns). Verdict FAIL if the sha isn't deployed or any column is missing.`,
  },
  {
    key: 'backfill-365',
    prompt: `Validate the 365d backfill covers what the seasonal guard needs. Using the LATEST snapshot per ASIN in amazon_arbitrage_pricing: (a) of the 269 LISTED Amazon ASINs, how many have non-null was_price_365d AND high_365d dated 2026-07-08? Report coverage % (expect near-100; a few Keepa "not found" ASINs are acceptable — list them). (b) All 8 seasonal ASINs (B0DPGTRL66, B0G6XD72Q1, B0DTV6K5HC, B0CKM181QH, B0DV4475PN, B09LFJGXW9, B0F3X9N8PC, B08W4LQVVV) must have non-null 365d data; print each one's was_price_365d, high_365d and the recent stable window (median buy_box_price over the last ~14-30 snapshots, or was_price_180d as a proxy). (c) Sanity: high_365d >= was_price_365d >= 0 for all rows (flag any inversion or absurd value as a data bug). Verdict FAIL if a seasonal ASIN lacks 365d data or values are corrupt.`,
  },
  {
    key: 'dedup-conflict',
    prompt: `Validate Amazon proposals are deduped one-per-ASIN with no split-brain, from your own prod queries over PENDING markdown_proposals joined to inventory_items. (a) For platform=amazon: every (amazon_asin, condition) must appear in AT MOST ONE pending proposal — report any group with >1 (that would be a dedup failure). (b) NO amazon ASIN may have both a PENDING MARKDOWN and a PENDING AUCTION proposal (the 30193 split-brain must be gone) — list any offenders. (c) For each pending amazon proposal, units must equal the count of in-play (status LISTED) inventory_items sharing that (asin, condition) that were DUE — spot-check 5 groups incl. 40585 B0BWWXT1R9 (expect ~21) and confirm units>1 rows really cover multiple units. (d) eBay pending proposals must remain per-listing with units=1. (e) Confirm the representative inventory_item_id on each amazon proposal is the OLDEST unit of its group (max aging) — spot-check 3. Verdict FAIL for any duplicate ASIN group or any markdown/exit conflict on one ASIN.`,
  },
  {
    key: 'seasonality',
    prompt: `Validate the seasonal-trough guard end-to-end by RECOMPUTING it yourself from the live 365d data, then cross-checking the proposal outcome. For each of the 8 seasonal ASINs: compute stable = median buy_box over recent snapshots (approx; state your window), and evaluate isSeasonalTrough = (high_365d >= stable*1.25) && (was_price_365d >= stable*1.05). Then: (a) where the guard is TRUE and current listing_value <= high_365d, there must be NO pending amazon MARKDOWN for that ASIN (it should HOLD) — confirm absence, and if any HOLD reason is queryable confirm it mentions "Seasonal trough". (b) where the guard is FALSE (e.g. 40417 Year of the Ox if its 365 high is flat), a markdown MAY legitimately still appear — that's correct, not a failure. (c) NON-seasonal contrast: 40585 World of Wonders B0BWWXT1R9 must still have a pending markdown (or a documented HOLD reason unrelated to seasonality) — confirm the guard did NOT over-fire on it. (d) Adversarial over-hold check: count how many of ALL LISTED amazon ASINs would now be held by isSeasonalTrough; if that number is implausibly large (e.g. >40% of stale stock), the thresholds may be too loose — report as WARN with the count and a few examples. Verdict FAIL only if the guard's live outcome contradicts its own maths (held when not seasonal, or cut a clearly-seasonal trough), or if it is silently holding a large swathe of non-seasonal stock.`,
  },
  {
    key: 'digest-ui',
    prompt: `Confirm the units count is surfaced everywhere a human reviews these, at code level on main (file:line). (a) apps/web/src/app/api/markdown/proposals/route.ts SELECT includes units. (b) apps/web/src/app/(dashboard)/inventory/markdown/page.tsx renders a units badge (×N units) in the row and "(oldest of N units)" in the detail dialog. (c) apps/web/src/lib/email/email.service.ts sendMarkdownDigest: MarkdownDigestSuggestion/Auction carry units, the table has a Units column, and totalReduction is UNIT-WEIGHTED (delta * units). (d) api/cron/markdown/route.ts passes units into both the suggestions and auctions digest arrays. Verdict FAIL if the unit-weighted total is wrong (would understate the true reduction) or units is dropped before reaching the reviewer.`,
  },
];

phase('Validate');
log('Fanning out 5 read-only validators (deploy+schema, 365d backfill, dedup+conflict, seasonality, digest/UI)');

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
  `${CTX}\n\nFindings (FAIL/WARN adversarially verified):\n${JSON.stringify(findings, null, 2)}\n\nWrite the final report: overall PASS/FAIL first, a per-dimension table, upheld issues with severity + recommended action, and a one-paragraph answer to "are the Amazon markdown proposals now correctly deduped one-per-ASIN and are the seasonal sets held out of their off-season trough?" Plain text, concise.`,
  { label: 'synthesize', phase: 'Synthesize' }
);

return { findings, report };
