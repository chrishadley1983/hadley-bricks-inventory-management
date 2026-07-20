# Merge Report — fix/pg-coverage-truth (PR #623)

**Date:** 2026-07-20
**Track:** FIX
**Merge commit:** `f440f217` (branch head `aa742d1f`, previous main `ccbe0b35`)
**Migration:** `20260720150000_pg_coverage_truth.sql` (pushed pre-merge, verified live)

## What shipped

The 2026-07-20 PG coverage audit fix plan, in full (see
`docs/features/pg-market-intelligence/coverage-metric-review-2026-07-20.md`, Resolution):

1. `bl_pg_refresh_queue.seeded_at` — seed stamp split from `last_refreshed_at`
   (now "actually scraped" only); ~78k fake-fresh stamps corrected.
2. No-data recorded as scraped (zero L1 `no_data=true` row + queue stamp, 90d re-check,
   no attempts climb) in nightly + page-sweep; 731 historical rows backfilled;
   `PgNotFoundError` parked permanently (was recycling at 90d).
3. Cycle constants centralised in `src/lib/bricklink/pg-cycle-policy.ts` (60/28/90);
   residual-fill 28d→60d active, page-sweep flat-28d→tier-correct; lane C throttle-shaped
   failures no longer climb the 8-attempt park ladder.
4. Ad-hoc scrapes write back to the queue (store-scan enrich, page-sweep, lane-A
   `last_refreshed_at`-only); 1,927 orphan L3 tuples adopted (tier=tail).
5. First-touch acceleration: 32,905 never-scraped active tuples made due now.
6. `pg_coverage_report` view — the canonical coverage/staleness/yield statement;
   pg-digest coverage section + BrickRadar digest card rewired to it.

## Verification

- CI (Typecheck, Lint & Test): GREEN on `aa742d1f`
- Local: typecheck + typecheck:scripts clean, eslint clean, vitest 3,537/3,537
- Migration verified live: `pg_coverage_report` totals reconcile exactly with the queue
  (153,384 = 151,457 + 1,927 adopted orphans); active 45.2% fresh; 32,905 active due-now;
  4 not-in-catalog parked with due_now=0
- Vercel production READY on `f440f217`; prod smoke: `/` 307→/dashboard, `/login` 200
- Local NSSM server rebuilt + restarted (pid 13016), `/` 307

## Post-merge

- `validate-pg-coverage-truth` workflow (DB re-derivation, adversarial code audit,
  deploy health, referee verdict) — see workflow output in session
- First nightly under new semantics: 2026-07-21 00:05 (watch telemetry `noData`/`notFound`
  counters inside `ok`)

## Rollback

`git revert -m 1 f440f217` + redeploy. The migration's data corrections are one-way
(seed stamps moved to `seeded_at`), but old code tolerates the new column and NULL
`last_refreshed_at` values, so a code-only rollback is safe. The view is additive.
