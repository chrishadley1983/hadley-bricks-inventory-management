# Merge Report — fix/amazon-stock-report-timeout-retry

- **Date:** 2026-06-30
- **PR:** [#475](https://github.com/chrishadley1983/hadley-bricks-inventory-management/pull/475)
- **Merge commit:** `9f590e4c` (squash) — previous main `18f26f6d`
- **Track:** FIX (`fix/*`)
- **Code review:** skipped at user request

## Summary
Makes the Amazon stock import (`GET_MERCHANT_LISTINGS_ALL_DATA`) resilient to Amazon's intermittently-slow report queue, which was causing `"Report generation timed out after 300 seconds"` and silently skipping the stock refresh (stock had been stale 2026-06-25 → 30).

## Changes
- **Retry-on-timeout** — `amazon-reports.client.ts`: `waitForReport` throws a distinct exported `ReportTimeoutError`; `fetchReport` retries once with a **fresh** report on timeout (`DEFAULT_FETCH_MAX_ATTEMPTS=2`, `DEFAULT_RETRY_BACKOFF_MS=30000`, all overridable). `CANCELLED`/`FATAL` are **not** retried.
- **Throttle (anti over-pull)** — `amazon-stock.service.ts`: `triggerImport({ force?, cooldownMs? })` returns a recent **completed** import within a 10-min cooldown instead of re-pulling. `getRecentCompletedImport` filters `status='completed'`, so a recent **failed** import never throttles or blocks a retry.
- **Route** — `POST /api/platform-stock/amazon/import?force=true` bypasses the cooldown.

## Root cause
Failures clustered after rapid successive report requests (over-pull → Amazon queues/throttles generation). The import is **not** in the Vercel full-sync cron — it runs from the manual button + the **local** pick-list/morning routine — so a slow morning skipped the refresh.

## Verification
- ✅ 54 unit tests pass (4 new retry + 1 throttle); `tsc --noEmit` clean; `eslint` clean
- ✅ Pre-merge live re-run of the import: 26s, 849 listings
- ✅ Vercel production deploy: **success**; homepage 307, import route 401 (gated)
- ✅ **Local production server rebuilt + restarted** (`scripts/redeploy-local.ps1`) — the import runs on this box, not Vercel
- ✅ E2E validation workflow: `.claude/workflows/validate-amazon-stock-report-timeout.js`

## Notes
- **CI flake (unrelated):** the PR's "Typecheck, Lint & Test" run failed on `ebay-api.adapter.test.ts` rate-limiter timing (expected ≥100ms, got 99ms) — 127/128 test files green. Pre-existing timing flake, not this change. Suggest hardening that assertion separately.

## Rollback
```
gh pr revert 475   # or: git revert -m 1 9f590e4c && PR to main
# then re-run scripts/redeploy-local.ps1
```
