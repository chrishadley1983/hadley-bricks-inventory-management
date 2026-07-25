export const meta = {
  name: 'validate-pg-coverage-truth',
  description: 'E2E-validate the PG coverage-truth fix: migration data corrections, pg_coverage_report view, cycle-policy adoption across all queue writers, digest rewiring, deploy health',
  whenToUse: 'After merging + deploying fix/pg-coverage-truth (migration 20260720150000) to confirm the seed-stamp lie is gone, no-data is recorded, the view is canonical, and every writer follows the 60/28/90 policy.',
  phases: [
    { title: 'DB state', detail: 'live Supabase re-derivation of every data correction' },
    { title: 'Code audit', detail: 'policy adoption + digest rewiring, adversarial read' },
    { title: 'Deploy', detail: 'merge landed, Vercel healthy, local checkout current' },
    { title: 'Verdict', detail: 'adversarial synthesis to PASS/FAIL' },
  ],
}

const FINDINGS = {
  type: 'object',
  properties: {
    checks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          pass: { type: 'boolean' },
          expected: { type: 'string' },
          actual: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['name', 'pass', 'expected', 'actual'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['checks', 'summary'],
}

phase('DB state')
const dbChecksPrompt = `You are validating the PG coverage-truth migration (20260720150000_pg_coverage_truth.sql) against LIVE cloud Supabase, read-only.

Work from ${'C:/Users/Chris Hadley/claude-projects/hadley-bricks-inventory-management/apps/web'} — write a throwaway tsx script under scripts/_tmp-validate-cov-<n>.ts using createClient with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local (see scripts/_tmp-pg-coverage-audit-2026-07-20.ts for the pattern — ALWAYS paginate with an explicit .order() on item_type,item_no,colour_id; unordered pagination under concurrent writes silently drops rows).

Verify, reporting expected vs actual for each:
1. bl_pg_refresh_queue has a seeded_at column (select it on one row).
2. "Fake fresh" is dead: count queue rows where last_refreshed_at IS NOT NULL that have NO bricklink_price_guide_cache row (exact tuple key, or for sets bare-number + '-1' suffix match) AND NO bricklink_pg_summary_cache no_data=true row. Expect ~0 (small drift from same-day scrapes tolerated, <100).
3. No queue rows remain with last_error LIKE 'Price guide has no sales/stock%'. Expect 0.
4. bricklink_pg_summary_cache has no_data=true rows for the backfilled tuples: total no_data count should be >= 7000 (was 6716 pre-fix + 731 backfilled, minus overlap).
5. Not-in-catalog parked: every queue row with last_error LIKE 'Not in BL catalog%' has next_due_at > '2100-01-01'. Expect 4+ rows, all parked.
6. First-touch acceleration: count active-tier rows with last_refreshed_at IS NULL and next_due_at <= now() — expect >25,000 (the ~33k backlog was made due, minus whatever tonight's runs have since scraped).
7. Orphan adoption: count bricklink_price_guide_cache rows with no queue row (same join as check 2, reverse direction). Expect ~0 (<100 drift).
8. The pg_coverage_report view is readable via supabase .from('pg_coverage_report').select('*') and: statuses are within {fresh,stale,no_data_fresh,no_data_stale,not_in_catalog,error_parked,never_scraped}; sum of tuples across all rows equals the bl_pg_refresh_queue total count; active-tier 'fresh' tuples > 25,000; due_now <= tuples on every row; with_uk_sold <= tuples on every row.
Delete your throwaway script when done. Return the structured checks.`
const db = await agent(dbChecksPrompt, { label: 'db-state', phase: 'DB state', schema: FINDINGS })

phase('Code audit')
const codePrompts = [
  `Adversarially audit cycle-policy adoption in ${'C:/Users/Chris Hadley/claude-projects/hadley-bricks-inventory-management'}. The rule: the 60/28/90-day cadence constants live ONLY in apps/web/src/lib/bricklink/pg-cycle-policy.ts and every bl_pg_refresh_queue writer that sets next_due_at after a scrape imports from it. Check apps/web/scripts/pg/pg-refresh-cycle.ts, pg-residual-fill.ts, pg-page-sweep.ts, pg-universe.ts and apps/web/scripts/bl-pg-store-scan.ts: (a) no hardcoded 28/60/90-day next_due arithmetic that bypasses the module (except pg-universe's 90-day random SPREAD which is a thundering-herd spacer, not a cycle, and residual-fill's inventory-file spreadDue — same); (b) pg-universe seed-from-cache writes seeded_at, never last_refreshed_at; (c) pg-refresh-cycle's PgNoDataError path writes a zero L1 row + stamps last_refreshed_at + attempts=0, and PgNotFoundError parks far-future; (d) residual-fill gap-fill filters seeded_at IS NULL and throttle-shaped failures (HTTP status/network) do NOT increment attempts. Report each as a check with pass/fail and file:line evidence.`,
  `Adversarially audit the reporting path in ${'C:/Users/Chris Hadley/claude-projects/hadley-bricks-inventory-management'}. Rule: coverage/freshness truth = the pg_coverage_report view (L3 presence + fetched_at), never bl_pg_refresh_queue.last_refreshed_at. Check: (a) apps/web/scripts/pg/pg-digest.ts coverage section reads pg_coverage_report and no longer counts last_refreshed_at windows; (b) the discord.service.ts digest payload/rendering matches the new PgDigestCoverageHealth fields (no stale activeWithin28dPct references anywhere in the repo); (c) the view definition in supabase/migrations/20260720150000_pg_coverage_truth.sql uses security_invoker=true, handles the set '-1' suffix join, and classifies fresh/stale by 60d active / 90d tail; (d) grep the repo for any OTHER coverage query still keyed off queue.last_refreshed_at that should have been rewired. Report checks with pass/fail and file:line evidence.`,
]
const code = await parallel(codePrompts.map((p, i) => () => agent(p, { label: `code:${i === 0 ? 'policy' : 'reporting'}`, phase: 'Code audit', schema: FINDINGS })))

phase('Deploy')
const deploy = await agent(
  `Verify the fix/pg-coverage-truth merge deployed cleanly for repo ${'C:/Users/Chris Hadley/claude-projects/hadley-bricks-inventory-management'}: (a) git log on main contains the merge (gh pr list --state merged --limit 5 or git log); (b) the local checkout is ON main and up to date with origin/main (git status + git fetch + compare — the nightly Windows tasks run npx tsx from this checkout, so a stale checkout means the fix is NOT live for tonight's 00:05 run); (c) the latest Vercel production deployment for this project is READY/healthy (use VERCEL_API_TOKEN from apps/web/.env.local against api.vercel.com, or 'npx vercel ls' — read-only), since live-check.service.ts ships to prod; (d) supabase migration list shows 20260720150000 applied (npx supabase migration list from the repo root reads the linked project, or check the supabase_migrations.schema_migrations via a tsx read — if neither is feasible, infer from the pg_coverage_report view existing, which the DB-state phase proved). Return structured checks.`,
  { label: 'deploy-health', phase: 'Deploy', schema: FINDINGS },
)

phase('Verdict')
const all = [db, ...code.filter(Boolean), deploy].filter(Boolean)
const verdict = await agent(
  `You are the adversarial referee for the pg-coverage-truth validation. Here are the check results from three independent phases (DB re-derivation, code audit, deploy health):\n\n${JSON.stringify(all, null, 2)}\n\nScrutinise: are any 'pass' verdicts based on weak evidence (e.g. inferred rather than measured)? Do any failures actually matter or are they tolerable drift? Produce a final PASS/FAIL verdict with: failed checks that block, tolerated deviations with reasons, and any follow-up actions. Be strict — a check that could not be verified is NOT a pass.`,
  { label: 'referee', phase: 'Verdict', schema: {
    type: 'object',
    properties: {
      verdict: { type: 'string', enum: ['PASS', 'FAIL'] },
      blocking: { type: 'array', items: { type: 'string' } },
      tolerated: { type: 'array', items: { type: 'string' } },
      followUps: { type: 'array', items: { type: 'string' } },
      summary: { type: 'string' },
    },
    required: ['verdict', 'blocking', 'tolerated', 'followUps', 'summary'],
  } },
)

return { verdict, phases: { db, code, deploy } }
