export const meta = {
  name: 'validate-store-quality',
  description: 'Adversarially validate the store-quality production output against live Supabase',
  whenToUse: 'After running store-quality.ts --json on production, to independently verify the scorecard, action lists, coverage, and demand-gap join are correct.',
  phases: [
    { title: 'Verify', detail: 'parallel independent re-derivation of each part of the scorecard via SQL' },
    { title: 'Synthesize', detail: 'aggregate verdicts into an overall PASS/CONCERN/FAIL' },
  ],
}

// args: { jsonPath, projectId, snapshotDate, windowDays }
const A = args || {}
const JSON_PATH = A.jsonPath || 'tmp/store-quality-prod.json'
const PROJECT = A.projectId || 'modjoikyuhqzouxvieua'
const WINDOW = A.windowDays || 180

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    dimension: { type: 'string' },
    checks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          expected: { type: 'string' },
          actual: { type: 'string' },
          pass: { type: 'boolean' },
          note: { type: 'string' },
        },
        required: ['name', 'pass'],
      },
    },
    verdict: { type: 'string', enum: ['PASS', 'CONCERN', 'FAIL'] },
    summary: { type: 'string' },
  },
  required: ['dimension', 'checks', 'verdict', 'summary'],
}

const SYNTH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    overall: { type: 'string', enum: ['PASS', 'CONCERN', 'FAIL'] },
    headline: { type: 'string' },
    byDimension: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { dimension: { type: 'string' }, verdict: { type: 'string' } },
        required: ['dimension', 'verdict'],
      },
    },
    topIssues: { type: 'array', items: { type: 'string' } },
    recommendation: { type: 'string' },
  },
  required: ['overall', 'headline', 'topIssues', 'recommendation'],
}

const common = `
You are independently verifying the Hadley Bricks store-quality scorecard.
1. Read the engine's output JSON at: ${JSON_PATH} (use the Read tool).
2. Load the Supabase read tool: ToolSearch query "select:mcp__plugin_supabase_supabase__execute_sql".
3. Run your OWN SQL (read-only) against project_id "${PROJECT}" to re-derive the figures, and compare to the JSON.
KNOWN DATA RULES you must apply (the engine applies these — verify it did):
- Snapshot table bricqer_inventory_snapshot: filter user_id, quantity>0. Scope item_type in ('Part','Minifig').
- Join snapshot→BL cache (bricklink_part_price_cache) on (part_number, color_id==colour_id).
- cache sell_through_rate_* is (times_sold/stock_available)*100; a RATIO = that/100. 0 = real dead, NULL = no data (keep separate).
- Join snapshot→our sales (order_items+platform_orders, platform in bricklink/brickowl, upper(item_type)='PART'/'MINIFIG', order_date >= now()-'${WINDOW} days') on (item_number, lower(trim(color_name)), condition). Conditions normalise New/Used.
Small drift (<2%) from live-order changes since the JSON was generated is acceptable — flag only material discrepancies.
Return a structured verdict. Be adversarial: actively try to find where the engine is wrong.`

phase('Verify')

const dims = [
  {
    key: 'composition',
    prompt: `${common}
DIMENSION: Composition & totals.
Independently compute, from the snapshot (quantity>0, item_type in Part/Minifig): total lots, total pieces, total list value (sum quantity*bricqer_price), and the Part vs Minifig split.
Compare to JSON .totals and .composition[]. They must match within rounding. Report each as a check.`,
  },
  {
    key: 'velocity',
    prompt: `${common}
DIMENSION: Velocity classification.
From JSON .actions and the velocity profile, plus the engine rules, take a sample: pick 5 lots the engine called DEAD and 5 it called MOVER (you can infer MOVER lots from low-value movers, or re-derive). For each sampled lot, independently check via SQL: did we sell it in the window (order_items name-key)? what is its market STR ratio from cache? Confirm DEAD = (no sale by us AND market STR ratio < 0.05) and MOVER = (sold by us). Also re-derive the velocity-profile value shares (value per class ÷ total) and compare to JSON .velocityProfile valueShare. Report mismatches.`,
  },
  {
    key: 'score-math',
    prompt: `${common}
DIMENSION: Score math.
Recompute the composite: sum(weight_i * score_i) over JSON .dimensions[] and compare to JSON .compositeScore (weights are velocity .30, picking .25, margin .20, ageing .10, coverage .10, freshness .05). Check the weights sum to 1.0. Sanity-check freshness: snapshot age in days vs the freshness score (100 at <=7d, 0 at >=45d, linear). Check coverage score == 100*min(priceCoverage, velocityCoverage). Report any arithmetic mismatch.`,
  },
  {
    key: 'actions',
    prompt: `${common}
DIMENSION: Action-list predicates.
For each of STUCK-HIGH, UNDER-PRICED, DEAD, LOW-YIELD-PICK in JSON .actions, take up to 4 sample items and verify the predicate truly holds via SQL/recompute:
- STUCK-HIGH: price ÷ 6mo-avg > 1.5, 6mo-avg >= 0.05, not sold by us in window.
- UNDER-PRICED: ratio < 0.7, market STR ratio >= 0.5.
- DEAD: not sold by us, market STR ratio < 0.05 (incl 0, NOT null).
- LOW-YIELD-PICK: bricqer_price < 0.10 AND we did sell it (MOVER).
Flag any item that does not satisfy its predicate (false positives are failures).`,
  },
  {
    key: 'coverage-demandgap',
    prompt: `${common}
DIMENSION: Coverage & demand-gap join.
1. Independently compute price coverage (value share of lots with a positive condition-matched 6mo avg) and velocity coverage (value share with a realized sale OR non-null market STR). Compare to JSON .coverage.priceCoverage / .velocityCoverage.
2. Validate the demand-gap join principle: count part+colour+condition combos SOLD by us in the window (units>=2) that have ZERO matching stock in the snapshot by the NAME key. Confirm this join yields a sane, non-trivial number (the colour-NAME key should match far more than a colour-ID join would). Report the count and whether the name-key join is working.`,
  },
]

const verdicts = await parallel(
  dims.map((d) => () => agent(d.prompt, { label: `verify:${d.key}`, phase: 'Verify', schema: VERDICT_SCHEMA }))
)

phase('Synthesize')
const clean = verdicts.filter(Boolean)
const synth = await agent(
  `You are the referee. Here are independent verification verdicts on the store-quality scorecard:
${JSON.stringify(clean, null, 2)}

Produce an overall verdict. FAIL if any action-list predicate was violated or any total is materially wrong. CONCERN for non-blocking discrepancies (e.g., minor drift, documented coverage gaps). PASS if the engine reproduces independently. Give a crisp headline, the per-dimension verdicts, the top issues (if any), and a recommendation (ship / fix-then-ship / investigate).`,
  { label: 'synthesize', phase: 'Synthesize', schema: SYNTH_SCHEMA }
)

return { synth, verdicts: clean }
