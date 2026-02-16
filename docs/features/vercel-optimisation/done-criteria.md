# Done Criteria: vercel-optimisation

**Created:** 2026-02-12
**Author:** Define Done Agent + Chris
**Status:** APPROVED

## Feature Summary

Reduce Vercel Hobby tier usage to stay within free limits by optimising polling intervals, adding background polling guards, batching orders page queries into a single endpoint, and adding HTTP cache headers to high-frequency API routes. Target: 40-60% reduction in function invocations, Fluid Active CPU under 50%.

**Reference:** `docs/Vercel-Optimization-Plan.md`

## Success Criteria

### Functional

#### F1: Pomodoro Server Polling Interval Changed to 30s
- **Tag:** AUTO_VERIFY
- **Criterion:** `use-pomodoro.ts` `useCurrentPomodoro` hook uses `refetchInterval: 30000` (was 1000)
- **Evidence:** Grep file for `refetchInterval.*30000`
- **Test:** `rg "refetchInterval.*30000" apps/web/src/hooks/use-pomodoro.ts` returns a match

#### F2: Time Tracking Server Polling Interval Changed to 30s
- **Tag:** AUTO_VERIFY
- **Criterion:** `use-time-tracking.ts` `useCurrentTimeEntry` hook uses `refetchInterval: 30000` (was 1000)
- **Evidence:** Grep file for `refetchInterval.*30000`
- **Test:** `rg "refetchInterval.*30000" apps/web/src/hooks/use-time-tracking.ts` returns a match

#### F3: All Polling Hooks Set refetchIntervalInBackground: false
- **Tag:** AUTO_VERIFY
- **Criterion:** Every hook file containing `refetchInterval` also contains `refetchIntervalInBackground: false`
- **Evidence:** For each of the 12 hook files with polling, grep confirms the property is present
- **Files:**
  - `apps/web/src/hooks/use-pomodoro.ts`
  - `apps/web/src/hooks/use-time-tracking.ts`
  - `apps/web/src/hooks/use-vinted-automation.ts`
  - `apps/web/src/hooks/use-bricklink-uploads.ts`
  - `apps/web/src/hooks/use-ebay-sync.ts`
  - `apps/web/src/hooks/use-amazon-transaction-sync.ts`
  - `apps/web/src/hooks/use-brickowl-transaction-sync.ts`
  - `apps/web/src/hooks/use-bricklink-transaction-sync.ts`
  - `apps/web/src/hooks/use-paypal-sync.ts`
  - `apps/web/src/hooks/use-orders.ts`
  - `apps/web/src/hooks/use-workflow.ts`
  - `apps/web/src/hooks/use-metrics.ts`
- **Test:** `rg "refetchIntervalInBackground:\s*false" <file>` returns a match for each file

#### F4: 30-Second Polling Intervals Increased to 90s
- **Tag:** AUTO_VERIFY
- **Criterion:** `use-vinted-automation.ts` (scanner status) and `use-bricklink-uploads.ts` use `refetchInterval: 90000` (was 30000)
- **Evidence:** Grep files for `90000`
- **Test:** `rg "refetchInterval.*90000" apps/web/src/hooks/use-vinted-automation.ts apps/web/src/hooks/use-bricklink-uploads.ts` returns matches

#### F5: 60-Second Polling Intervals Increased to 120s
- **Tag:** AUTO_VERIFY
- **Criterion:** The following hooks use `refetchInterval: 120000` (was 60000):
  - `use-ebay-sync.ts` (idle polling)
  - `use-bricklink-transaction-sync.ts`
  - `use-brickowl-transaction-sync.ts`
  - `use-paypal-sync.ts` (idle + status)
  - `use-orders.ts` (BrickLink sync status)
  - `use-workflow.ts` (today's tasks)
  - `use-vinted-automation.ts` (opportunities + schedule)
- **Evidence:** Grep each file for `120000`
- **Test:** `rg "refetchInterval.*120000" <file>` returns a match for each listed file

#### F6: Time Tracking Summary Interval Increased to 300s
- **Tag:** AUTO_VERIFY
- **Criterion:** `use-time-tracking.ts` `useTimeSummary` hook uses `refetchInterval: 300000` (was 60000)
- **Evidence:** Grep file for `300000`
- **Test:** `rg "refetchInterval.*300000" apps/web/src/hooks/use-time-tracking.ts` returns a match

#### F7: Cache Headers Added to 8 API Endpoints
- **Tag:** AUTO_VERIFY
- **Criterion:** Each of the following API route GET handlers sets a `Cache-Control` response header:
  - `/api/pomodoro/current` — `private, max-age=5`
  - `/api/time-tracking/current` — `private, max-age=5`
  - `/api/time-tracking/summary` — `private, max-age=60, stale-while-revalidate=120`
  - `/api/orders/status-summary` — `private, max-age=15, stale-while-revalidate=30`
  - `/api/workflow/tasks/today` — `private, max-age=30, stale-while-revalidate=60`
  - `/api/workflow/metrics` — `private, max-age=120, stale-while-revalidate=300`
  - `/api/inventory/listing-counts` — `private, max-age=60, stale-while-revalidate=120`
  - At least one `/api/integrations/*/status` route — `private, max-age=30, stale-while-revalidate=60`
- **Evidence:** Grep each route file for `Cache-Control`
- **Test:** `rg "Cache-Control" <route-file>` returns a match for each endpoint

#### F8: Combined Orders Dashboard-Status Endpoint Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** File `apps/web/src/app/api/orders/dashboard-status/route.ts` exists and exports a `GET` handler that returns a combined response including `syncStatus`, `statusSummary`, and `ebayStatusSummary` keys
- **Evidence:** File exists; grep for `export.*GET`; grep for response keys
- **Test:**
  - File exists at expected path
  - `rg "export.*(async\s+)?function\s+GET|export\s+const\s+GET" apps/web/src/app/api/orders/dashboard-status/route.ts` returns a match
  - `rg "syncStatus|statusSummary|ebayStatusSummary" apps/web/src/app/api/orders/dashboard-status/route.ts` returns matches

#### F9: Orders Page Uses Combined Endpoint
- **Tag:** AUTO_VERIFY
- **Criterion:** Orders page (or its hooks) references `dashboard-status` instead of calling the 5 separate status endpoints individually for polling
- **Evidence:** Grep orders page/hooks for `dashboard-status`; individual status-summary polling queries removed or replaced
- **Test:**
  - `rg "dashboard-status" apps/web/src/` returns matches in orders-related files
  - The 5 separate polling queries (sync-all-orders, status-summary, ebay/status-summary, bricqer status, amazon status at 30s intervals) are no longer individually polled

### Error Handling

#### E1: Dashboard-Status Endpoint Handles Partial Failures Gracefully
- **Tag:** AUTO_VERIFY
- **Criterion:** If one sub-query in the dashboard-status endpoint fails, the endpoint still returns HTTP 200 with available data and `null` for the failed section (no full-endpoint crash)
- **Evidence:** Code inspection shows try/catch around each sub-query in the endpoint
- **Test:** `rg "try|catch" apps/web/src/app/api/orders/dashboard-status/route.ts` returns multiple matches showing individual error handling

#### E2: No TypeScript Errors in New/Modified Code
- **Tag:** AUTO_VERIFY
- **Criterion:** TypeScript compiles without errors for all new and modified files
- **Evidence:** `npm run typecheck` exits with code 0
- **Test:** Run `npm run typecheck` — exit code 0

### Integration

#### I1: All Existing Tests Pass
- **Tag:** AUTO_VERIFY
- **Criterion:** `npm run typecheck`, `npm run lint`, and `npm test` all pass with exit code 0
- **Evidence:** Exit code 0 for each command
- **Test:** Run all three commands sequentially; all must pass

#### I2: UI Timers Still Function With Longer Polling Interval
- **Tag:** AUTO_VERIFY
- **Criterion:** Local `setInterval` timers in `PomodoroPanel.tsx` and `TimeTrackingPanel.tsx` remain at 1000ms — these are UI-only display timers that must NOT be changed
- **Evidence:** Grep panel components for `setInterval` with 1000ms interval
- **Test:** `rg "setInterval.*1000|1000.*setInterval" apps/web/src/components/` returns matches in both panel components

### Performance

#### P1: No New Aggressive Polling Intervals
- **Tag:** AUTO_VERIFY
- **Criterion:** No `refetchInterval` value under 5000ms exists in any hook file, except for conditional sync hooks (`use-ebay-sync.ts`, `use-amazon-transaction-sync.ts`, `use-paypal-sync.ts`, `use-refresh-job.ts`, `use-quality-review.ts`) which only fire during active operations
- **Evidence:** Grep all hook files for `refetchInterval`; verify no values < 5000 outside the allowed conditional hooks
- **Test:** `rg "refetchInterval" apps/web/src/hooks/` — manually verify all values are >= 5000 or are in the exempted conditional hooks

## Out of Scope

- Monitoring Vercel dashboard metrics post-deploy (operational, not code)
- Changing the 5-minute polling intervals on `use-metrics.ts` (already reasonable)
- Changing conditional sync intervals that only fire during active operations (ebay-sync running, amazon-transaction-sync running, paypal-sync running, listing-refresh active, quality-review polling)
- Upgrading to Vercel Pro
- WebSocket or SSE migration (future optimisation)
- React Query `staleTime` changes (not part of this scope)

## Dependencies

- None — all changes are to existing codebase

## Iteration Budget

- **Max iterations:** 5
- **Escalation:** If not converged after 5 iterations, pause for human review
