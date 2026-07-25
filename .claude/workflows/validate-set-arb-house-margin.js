export const meta = {
  name: 'validate-set-arb-house-margin',
  description: 'E2E-validate PR #625: house net-margin contract on /arbitrage, snapshot fold + 28d backstop, weekly in-stock Keepa cadence, deploy health',
  whenToUse: 'After merging + deploying fix/set-arb-house-margin (PR #625) to confirm the ratified margin contract holds on live data and every freshness fix behaves.',
  phases: [
    { title: 'Audit', detail: '5 parallel auditors: contract math, data integrity, completeness, RPC cadence, deploy/docs' },
    { title: 'Verify', detail: 'adversarial referee per failed/warned check' },
    { title: 'Synthesize', detail: 'PASS/FAIL report' },
  ],
}

const REPO = 'C:/Users/Chris Hadley/claude-projects/hadley-bricks-inventory-management'
const CTX = `
Repo: ${REPO} (run tsx scripts from ${REPO}/apps/web with dotenv .env.local, Supabase service role — follow the pattern of apps/web/scripts/_tmp-bricktraders-verify-2026-07-20.ts).
Merged: PR #625, merge commit 422cd9b4, branch fix/set-arb-house-margin, deployed to Vercel prod + local NSSM rebuilt.
Ratified contract (Chris 2026-07-20): decision is NET margin %% of SALE only — GREEN >0.25, AMBER >0.15, drop below. net = sale*(1-0.17) - 4 - landed_unit_gbp. Constants ONLY from apps/web/src/lib/investment/max-buy.ts (MAX_BUY_FEE=0.17, MAX_BUY_SHIP=4, GREEN=0.25, AMBER=0.15). BSR + drops90 are displayed info, NEVER a gate.
Freshness: flagger folds amazon_arbitrage_pricing per-field latest-non-null over 45 days; bl_set_arb_candidates.net_margin_pct = CONSERVATIVE pct = min(pct at sell_price_gbp, pct at was_price_90d when present); sell_net_gbp = round2(sell_price_gbp*0.83 - 4); flag floor: conservative >= 0.15. New columns: was_price_90d, sales_rank, amazon_snapshot_date. Keepa top-up in flagger = backstop for snapshots >28d old only. RPC get_keepa_priority_asins (migration 20260720181500): in-stock (quantity>0) due only when last_snapshot IS NULL or <= today-7 (weekly); qty-0 stale daily as before; arb arm (brickset conf>=95 + fresh PG offers <=10d) unchanged.
Return ONLY the JSON the schema demands — no prose around it.`

const AUDIT_SCHEMA = {
  type: 'object',
  properties: {
    checks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          result: { type: 'string', enum: ['PASS', 'FAIL', 'WARN'] },
          evidence: { type: 'string' },
        },
        required: ['name', 'result', 'evidence'],
      },
    },
  },
  required: ['checks'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    upheld: { type: 'boolean' },
    severity: { type: 'string', enum: ['blocker', 'minor', 'info'] },
    explanation: { type: 'string' },
  },
  required: ['upheld', 'severity', 'explanation'],
}

phase('Audit')
const AUDITORS = [
  {
    key: 'contract-math',
    prompt: `${CTX}
AUDIT 1 — contract math re-derivation. Write+run a tsx script: sample 200 random ACTIVE bl_set_arb_candidates rows (any store). For each with source_zone='UK': recompute landed (buy + weight_g/100*ship_per_100g + ship_base/10 from bl_import_zone_costs UK row) and compare to landed_unit_gbp (±0.02). For ALL sampled rows: recompute sell_net = round2(sell_price_gbp*0.83-4) vs sell_net_gbp (±0.01); recompute conservative pct = min((sell_net-landed_unit_gbp)/sell_price_gbp, was_price_90d? (round2(was_price_90d*0.83-4)-landed_unit_gbp)/was_price_90d : same) vs net_margin_pct (±0.001); assert net_margin_pct >= 0.15. Also verify net_margin_gbp = round2(sell_net_gbp - landed_unit_gbp) (±0.02). Report counts of mismatches per check with 3 example rows each.`,
  },
  {
    key: 'data-integrity',
    prompt: `${CTX}
AUDIT 2 — full-table integrity. Write+run a tsx script over ALL active bl_set_arb_candidates (paginate — PostgREST 1,000-row cap): (a) count rows with net_margin_pct < 0.15 (must be 0); (b) count rows with amazon_snapshot_date older than 45 days or null while sell_price_gbp is set; (c) distribution of amazon_snapshot_date ages (buckets 0-7/8-14/15-28/29-45d); (d) count rows where was_price_90d/sales_rank are null (expected some — report %%); (e) verify no active row has sell_price_gbp null; (f) count excluded/bought rows and confirm none were resurrected to active with identical (item_no,sell_channel,source_store_id) — compare status counts vs computed_at dates. Report all numbers.`,
  },
  {
    key: 'completeness',
    prompt: `${CTX}
AUDIT 3 — completeness (no deal silently missing). Write+run a tsx script: take 400 random item_type='S' rows from bricklink_price_guide_cache with stock_offers not null and fetched_at within 10 days. For each, mirror the flagger: normalise set no ('-1'), require brickset_sets identity conf>=95 with amazon_asin, weight from bl_catalog_items, fold amazon_arbitrage_pricing snapshots <=45d (latest-non-null per field, paginated), compute conservative pct per NEW offer (UK zone for domestic; skip intl zones to keep it simple — note how many skipped). Every (set,store) with conservative pct >= 0.15 MUST exist as an active candidate row; every one below 0.15 must NOT be active. Report false-negatives (missing deals) and false-positives with examples. Small tolerance: rows computed at 2026-07-20 15:04 run; snapshots written since then can shift margins — classify mismatches explainable by a snapshot newer than the run as WARN not FAIL.`,
  },
  {
    key: 'rpc-cadence',
    prompt: `${CTX}
AUDIT 4 — RPC cadence. Write+run a tsx script using service role: (1) fetch the live function definition: select pg_get_functiondef('get_keepa_priority_asins(uuid,date,integer)'::regprocedure) via supabase.rpc? If no SQL RPC available, call the function directly: supabase.rpc('get_keepa_priority_asins', { p_user_id: <the user id from tracked_asins limit 1>, p_today: today, p_budget: 2000 }) and assert: (a) NO returned row has quantity>0 with last_snapshot within the last 6 days (weekly rule); (b) rows with quantity>0 and last_snapshot <= today-7 (or null) appear with priority 1; (c) arb-arm ASINs still present: pick 3 known Bricktraders ASINs (B09BNTQZXG, B0CGY3VF48, B08QBJB2K4) — they are due only if their snapshot is stale, so instead verify membership indirectly: at least some priority-2 rows exist and total rows > 500. Report the counts and any violation rows.`,
  },
  {
    key: 'deploy-docs',
    prompt: `${CTX}
AUDIT 5 — deploy + docs + constants hygiene. (1) curl https://hadley-bricks-inventory-management.vercel.app/arbitrage (expect 200) and /api/arbitrage/intl (expect 401 unauth). (2) curl http://localhost:3000/arbitrage (expect 200/307 — local NSSM rebuilt). (3) grep the repo: no file under apps/web/src other than investment/max-buy.ts may hardcode 0.58 or declare its own 25%%/15%% margin constants for Amazon sets (AMAZON_FEE_SHARE/AMAZON_OUTBOUND_SHIP_GBP in landed-cost.ts must be re-exports of MAX_BUY_*, check the source). (4) .claude/skills/set-buy-check/SKILL.md must contain the ratified margin-only rule and must NOT contain an active 'drops90 < 15' gate rule (a historical note saying it was removed is fine). (5) apps/web/src/app/api/arbitrage/intl/route.ts must pass salesRank/was90Gbp/snapshotDate/grade; the page must render BSR column + QuoteAgeBadge. (6) git: merge commit 422cd9b4 is on origin/main. Report each as a check.`,
  },
]

const audits = await parallel(AUDITORS.map((a) => () =>
  agent(a.prompt, { label: `audit:${a.key}`, phase: 'Audit', schema: AUDIT_SCHEMA })
    .then((r) => ({ key: a.key, checks: r?.checks ?? [] }))))

const flat = audits.filter(Boolean).flatMap((a) => a.checks.map((c) => ({ ...c, auditor: a.key })))
const suspect = flat.filter((c) => c.result !== 'PASS')
log(`${flat.length} checks: ${flat.length - suspect.length} PASS, ${suspect.length} FAIL/WARN → referee`)

phase('Verify')
const refereed = await parallel(suspect.map((c) => () =>
  agent(`${CTX}
You are an adversarial REFEREE. An auditor (${c.auditor}) reported this ${c.result}:
CHECK: ${c.name}
EVIDENCE: ${c.evidence}
Independently re-verify from live data/code. Try to REFUTE it: is the evidence real, is the expectation actually part of the ratified contract, is the discrepancy explainable (e.g. snapshots written after the 15:04 flagger run, excluded/bought rows, intl zones, rounding tolerance)? upheld=true only if it is a genuine defect in PR #625's behaviour.`,
    { label: `referee:${c.name.slice(0, 30)}`, phase: 'Verify', schema: VERDICT_SCHEMA })
    .then((v) => ({ ...c, verdict: v }))))

phase('Synthesize')
const upheld = refereed.filter(Boolean).filter((r) => r.verdict?.upheld)
const blockers = upheld.filter((r) => r.verdict.severity === 'blocker')
const report = await agent(`${CTX}
Write the final validation report for PR #625 as markdown. Overall verdict: ${blockers.length ? 'FAIL' : upheld.length ? 'PASS-WITH-FINDINGS' : 'PASS'}.
All checks (${flat.length}): ${JSON.stringify(flat.map((c) => ({ auditor: c.auditor, name: c.name, result: c.result })))}
Referee-upheld findings: ${JSON.stringify(upheld.map((r) => ({ name: r.name, severity: r.verdict.severity, explanation: r.verdict.explanation })))}
Refuted (no action): ${JSON.stringify(refereed.filter(Boolean).filter((r) => !r.verdict?.upheld).map((r) => ({ name: r.name, why: r.verdict?.explanation })))}
Sections: Verdict, Evidence highlights (the strongest PASS evidence per auditor), Upheld findings with severity + recommended action, Refuted findings one-liners. Save it to ${REPO}/docs/features/bl-intl-set-arb/validation-2026-07-20-house-margin.md (create dir if needed) and ALSO return the full markdown as your final text.`,
  { label: 'synthesize', phase: 'Synthesize' })

return { verdict: blockers.length ? 'FAIL' : upheld.length ? 'PASS-WITH-FINDINGS' : 'PASS', totalChecks: flat.length, upheld: upheld.map((r) => r.name), report }
