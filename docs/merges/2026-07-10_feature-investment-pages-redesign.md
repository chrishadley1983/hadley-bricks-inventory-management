# Merge Report — feature/investment-pages-redesign

**Merged:** 2026-07-10 · PR [#559](https://github.com/chrishadley1983/hadley-bricks-inventory-management/pull/559) · merge commit `57318312`
**Track:** FEATURE (user-directed merge; plan approved in-session, no formal done-criteria doc)
**Commits:** 2 · **Files:** 27 changed (+2,394 / −322)

## Feature Summary

Redesign of both investment pages plus a new sets browser:

- **/investment** → dashboard: model-status strip (artifact `v2-1783087796899`, honest
  temporal-holdout metrics — 1yr Spearman 0.38 beats baseline, 3yr flagged unreliable at
  n_holdout=10, stale-scoring warning >14d), top-8 picks preview with max buy, retirement
  radar (retiring next 12mo / retired last 12mo with buy-box vs RRP via
  COALESCE(exit_date, expected_retirement_date)), market pattern charts (theme /
  retirement-year cohort / RRP band / licence medians from 1,231 observed labels).
- **/investment/top-picks** → ranked deal sheet: recommended max buy (green) + amber
  fallback + % of RRP, expected 1yr sale, HIGH/standard tier, rationale chips,
  theme / min-confidence / retiring filters, honest pagination (678 sets, 28 pages).
- **/investment/sets** → previous all-sets table, deep-linkable filters; sidebar now
  Dashboard / Top Picks / All Sets.
- Max-buy house formula extracted to `apps/web/src/lib/investment/max-buy.ts`
  (9 unit tests); `_export-maxbuy-list.ts` now imports it.
- New APIs: `/api/investment/model-status`, `/patterns`, `/retirement-radar`.
- **Bug fix:** `/api/investment/predictions` applied theme/retiring filters to the
  enrichment query, not the ranking — silently dropped cards while reporting unfiltered
  totals. Filters now apply before pagination.

## Verification

| Check | Status |
|-------|--------|
| TypeScript | ✅ clean |
| ESLint | ✅ clean (warnings pre-existing) |
| Vitest full suite | ✅ 3,490/3,490 |
| CI (Typecheck, Lint & Test) | ✅ pass (4m06s) |
| merge-tree dry run vs main | ✅ no conflicts (#555–#558 landed mid-branch) |
| Prod critical paths | ✅ 4/4 (dashboard, inventory, orders, order view) |
| Prod investment smoke | ✅ 4/4 (dashboard sections, deal sheet rows/pagination, sets browser, API data + filter-totals fix assertion) |
| Local prod server (NSSM :3000) | 🔄 rebuild + restart via redeploy-local.ps1 (was already 500ing pre-merge — lost its .next in the 08:17 wipe) |

## Cleanup

- PR merged with merge commit; branch deletion recorded below.
- Temp prod-smoke specs and auth-script variant removed.

## Notes

- Session context: the 2026-07-10 ~08:17 working-tree wipe (concurrent session
  "re-materialization") happened mid-build; all tracked files restored from git,
  in-flight work recommitted immediately. See memory `shared-checkout-collision-2026-07-10`.
- E2E auth for prod verification minted via a temp variant of
  `scripts/_refresh-e2e-auth.ts` with `E2E_COOKIE_DOMAIN` (the previous
  `_refresh-e2e-auth-prod.ts` was untracked and lost in the wipe — consider
  recreating it as a tracked script).
- Rollback: `git revert -m 1 57318312` — no schema changes.

## Other Unmerged Branches (pre-existing)

`feature/vinted-pov-modes`, `chore/cleanup-auction-logging`, `chore/investment-cron-schedules`,
`chore/investment-gcp-cron-schedules`, various `claude/*` and older branches — unchanged by this merge.
