export const meta = {
  name: 'validate-store-assessment',
  description: 'E2E-validate the BL store-assessment feature (schema, persisted data integrity, engine correctness, deploy) against live systems',
  phases: [
    { title: 'Validate', detail: 'schema · data integrity · engine audit · deploy' },
    { title: 'Verify', detail: 'adversarially refute each finding' },
    { title: 'Synthesize', detail: 'PASS/FAIL verdict' },
  ],
};

const REPO = 'C:/Users/Chris Hadley/claude-projects/hadley-bricks-inventory-management';
const PROJECT = 'modjoikyuhqzouxvieua';

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dimension', 'pass', 'summary', 'findings'],
  properties: {
    dimension: { type: 'string' },
    pass: { type: 'boolean' },
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'claim', 'evidence'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'info'] },
          claim: { type: 'string' },
          evidence: { type: 'string' },
        },
      },
    },
  },
};

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['upheld', 'reasoning'],
  properties: {
    upheld: { type: 'boolean' },
    reasoning: { type: 'string' },
  },
};

const DIMENSIONS = [
  {
    key: 'schema',
    prompt: `You are validating the LIVE Supabase schema for the new store-assessment feature.
Use the Supabase MCP tools (load via ToolSearch: mcp__plugin_supabase_supabase__list_tables, mcp__plugin_supabase_supabase__execute_sql). Project id: ${PROJECT}.
Confirm:
1. Table public.store_assessments EXISTS with the expected columns: user_id, store_slug, store_id, store_name, store_country, mode, grade, verdict, total_lots, total_pieces, total_value, median_ask_vs_market (renamed from median_ask_vs_uk in the v2 migration), engine_version, scan_truncated, buyable_lots, buyable_outlay_gbp, buyable_net_gbp, blended_margin_pct, high_str_lots, magnet_lots, feedback_score, positive_pct, orders_per_month, price_coverage, assessment (jsonb), report_md.
2. RLS is ENABLED and there are SELECT/INSERT/DELETE policies keyed on auth.uid() = user_id (query pg_policies).
3. At least one row exists (the Quaysretire verification run).
Report pass=true only if the table, columns, and RLS policies are all present. Return structured findings.`,
  },
  {
    key: 'data-integrity',
    prompt: `You are independently re-deriving the persisted store-assessment for store 'Quaysretire' to check the engine's numbers are honest.
Steps:
1. Read the raw scrape at ${REPO}/tmp/stores/Quaysretire/inventory.json (array of lots: itemType, invQty, unitPriceGBP, invNew).
2. Independently compute: total lots (array length), total pieces (sum invQty), total value (sum unitPriceGBP*invQty). Round value to pennies.
3. Load the Supabase MCP tools and query the latest store_assessments row for store_slug='Quaysretire' (mcp__plugin_supabase_supabase__execute_sql, project ${PROJECT}): select total_lots, total_pieces, total_value, buyable_lots, buyable_net_gbp, magnet_lots, price_coverage, grade, verdict, (assessment->'confidence') as conf, coalesce(assessment->'pricing'->>'weightedMedianAskVsMarket', assessment->'pricing'->>'weightedMedianAskVsUk') as wm order by scanned_at desc limit 1. (v1 rows use the old key; engine v2 rows the new one.)
4. Compare your independently computed total_lots / total_pieces / total_value to the stored columns — they must match (tiny rounding tolerance on value).
5. Sanity-check internal consistency: price_coverage should equal assessment.confidence.ukValueShare; buyable_net_gbp >= 0; grade in [0,100]; verdict in {BUY,REVIEW,SKIP}.
Report pass=true only if the recomputed size totals match the stored row and the internal consistency checks hold. Cite the actual numbers (yours vs stored) in evidence.`,
  },
  {
    key: 'engine-audit',
    prompt: `You are adversarially auditing the store-assessment engine for correctness bugs. Read:
- ${REPO}/apps/web/src/lib/bl-store-assessment/engine.ts
- ${REPO}/apps/web/src/lib/bl-store-assessment/types.ts
- ${REPO}/apps/web/scripts/lib/store-scrape.ts
Check specifically:
1. STR: the "high STR" gate and magnet gate use strLots (sold_lots/stock_lots, house def); the RESALE price uses strQty (Bricqer's sold_qty/stock_qty). Confirm the right basis feeds each.
2. Colour keying: scored lots look up pgMap and supplyMap with the SAME key (pgKey with blColour = colourId for parts, 0 otherwise). Confirm the world-supply read keys match the lookup.
3. Fee math: netPerUnit = ourList*(1-fees) - ask - inbound; fees = blFee+bricqerFee+paypalPct (0.094). Confirm.
4. Magnet definition matches spec: very low supply (worldSupplyLots <= magnetMaxSupplyLots) AND decent STR (strLots >= minStr) AND eligible (ask>=minAsk, no damage note).
5. Feedback parsing (store-scrape.ts): the feedback.asp Praise/Neutral/Complaint rows are 4 columns [week, month, 6mo, all-time]; feedbackLast6mo uses index 2, positivePct uses index 3 (all-time). Confirm no off-by-one.
6. Any place STR/coverage could be silently wrong or a NaN/undefined could leak into a headline number.
Report pass=true only if no blocker/major correctness bug. Cite file:line in evidence.`,
  },
  {
    key: 'deploy',
    prompt: `You are confirming the store-assessment feature deployed to production.
1. Run \`cd "${REPO}" && git log --oneline -3 origin/main\` and confirm the store-assessment commit is on main.
2. The routes are auth-gated. Confirm the production app serves the route without a 404/500: use bash curl -s -o /dev/null -w "%{http_code}" -L on the prod URL https://<prod-domain>/arbitrage/store-assessment — first discover the prod domain from ${REPO}/apps/web (check vercel.json or a recent deploy). A 200 or a redirect to /login (302/307) is a PASS; 404 or 500 is a FAIL. If you cannot resolve the prod domain, report info (not a blocker) and rely on the git-merged + build-green evidence.
Report pass based on the commit being on main and the route not 404/500.`,
  },
];

phase('Validate');
const results = await pipeline(
  DIMENSIONS,
  (d) => agent(d.prompt, { label: `validate:${d.key}`, phase: 'Validate', schema: FINDINGS_SCHEMA, agentType: 'general-purpose' }),
  (res, d) =>
    parallel(
      (res?.findings ?? [])
        .filter((f) => f.severity === 'blocker' || f.severity === 'major')
        .map((f) => () =>
          agent(
            `Adversarially REFUTE this store-assessment validation finding from dimension "${d.key}". Try to prove it WRONG or not actually a problem. Default to upheld=false if you cannot independently reproduce it. Finding: ${f.claim}\nEvidence given: ${f.evidence}\nRe-check against the live system / source (Supabase MCP project ${PROJECT}, repo ${REPO}).`,
            { label: `verify:${d.key}`, phase: 'Verify', schema: VERDICT_SCHEMA, agentType: 'general-purpose' },
          ).then((v) => ({ ...f, dimension: d.key, upheld: v?.upheld ?? true, verifyReasoning: v?.reasoning ?? '' })),
        ),
    ).then((verified) => ({ dimension: d.key, pass: res?.pass ?? false, summary: res?.summary ?? '', verified: verified.filter(Boolean) })),
);

phase('Synthesize');
const packed = results
  .filter(Boolean)
  .map((r) => `## ${r.dimension} — ${r.pass ? 'PASS' : 'FAIL'}\n${r.summary}\nConfirmed issues: ${JSON.stringify(r.verified.filter((f) => f.upheld), null, 2)}`)
  .join('\n\n');

const verdict = await agent(
  `You are the referee for the E2E validation of the BL store-assessment feature. Below are the per-dimension results after adversarial verification (only upheld findings count).\n\n${packed}\n\nProduce a concise PASS/FAIL verdict. Overall PASS requires: schema live, persisted data integrity holds (recomputed totals match), no upheld blocker/major engine correctness bug, and the route is merged to main and not 404/500. List any upheld blocker/major issues that must be fixed. Be direct.`,
  { label: 'referee', phase: 'Synthesize' },
);

log('VALIDATION COMPLETE');
return { verdict, dimensions: results.filter(Boolean).map((r) => ({ dimension: r.dimension, pass: r.pass, upheldIssues: r.verified.filter((f) => f.upheld).length })) };
