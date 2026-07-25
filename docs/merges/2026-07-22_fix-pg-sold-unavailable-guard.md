# Merge Report — fix/pg-sold-unavailable-guard (PR #627)

**Date:** 2026-07-22 · **Track:** FIX · **Merge commit:** `1f55bd41` (branch head `4957d41a`, previous main `8fd2babc`)

## What merged

Guard for the 2026-07-21 BrickLink sold-data outage, where catalogPG pages rendered the
Last-6-Months-Sales quadrants as literal "(Unavailable)" for an item-specific subset of the
catalog (store API returned plausible zeros for the same items — no safe fallback lane).
Pre-guard, these pages classified as confirmed no-data: zero L1 rows (poisoning STR
silently) and 90d queue push-outs.

| Surface | Behaviour on an outage page |
|---|---|
| `price-guide-page.ts` | New `soldUnavailable` page kind + typed `PgSoldUnavailableError`; marker anchored to the sales-section header; outranks `noData` **and** `ok` |
| `pg-refresh-cycle` (lane D nightly) | Requeue +1d, `last_error='sold_unavailable'`, no zero row / no attempts climb / no refresh stamp; feeds the consecutive-fail session brake; Discord ops alert at ≥25/run |
| `pg-page-sweep` | Skip — no cache write, no queue stamp (tuple stays due) |
| `bl-pg-store-scan` | Skip — no empty-result caching |
| `pg-canary` | ≥3 golden tuples in outage state → dedicated Discord ops alert |
| `pg-residual-fill` + `pg-cycle-policy` (lane C anon curl) | `sold-unavailable` reason is throttle-shaped — attempts never climb, no false parking |

## Why today

The guard was built during the 21 Jul incident but the PR sat unmerged — last night's
lane D (22 Jul, 2,100 tuples) ran **unguarded** and happened to be clean (verified by
data probe: 0 of 2,099 rows show the sold-all-zero-with-stock signature, matching the
19→20 Jul baseline; probe at `apps/web/scripts/_tmp-laned-sold-check-2026-07-22.ts`).
BL's monthly maintenance window (22nd 06:00–07:00 UK) was the suspected trigger of the
original outage, so tonight's run needed the guard in place.

## Verification

- CI green on branch head (`Typecheck, Lint & Test` SUCCESS); PR body records 37/37 unit
  tests incl. classification precedence + cooked-regex regression, and live validation
  against the real outage (75192 healthy vs 60367/77006/72043 throwing the typed error).
- Fix-track branch code review completed in-session pre-merge: guard coherent across all
  five surfaces; no conflicts vs post-#628/#629 main (single file overlap
  `bl-pg-store-scan.ts` in disjoint regions — branch adds an error-handler in `enrich()`,
  main changed defaults/report rendering).
- Vercel production READY on `1f55bd41` (deployment `c2muktkfr`, 4m build); prod home
  307→/dashboard, /login 200.
- Local NSSM server rebuilt + restarted via `scripts/redeploy-local.ps1` (pid 34004,
  localhost:3000 OK).
- **Runtime checkouts updated** (the part that actually guards tonight — pg scripts run
  `tsx` from source): main checkout pulled to `1f55bd41`; `hb-assess-wt` worktree
  (02:15 store-assessment sweep) advanced `8fd2babc` → `1f55bd41` (was clean, detached).

## Rollback

`git revert -m 1 1f55bd41` and push — no migration, no schema change, no config change.
