# Vercel Optimization Plan

**Hadley Bricks Inventory Management**
February 2026

---

> **Objective:** Reduce Vercel Hobby tier usage to stay within free limits without upgrading to Pro ($20/month). Target: 40–60% reduction in function invocations and meaningful reduction in Fluid Active CPU.

---

## 1. Current State (Verified)

The following metrics are from the Vercel dashboard for the period Jan 13 – Feb 12, 2026.

| Metric | Current Usage | Free Tier Limit | Utilisation |
|---|---|---|---|
| Fluid Active CPU | 3h 2m | 4h | 75.8% |
| Function Invocations | 265,623 | 1,000,000 | 26.6% |
| Fluid Compute | 113.9 GB-Hrs | — | 99% from hadley-bricks |
| Fast Origin Transfer | 1.16 GB | 10 GB | 11.6% |
| Edge Requests | 273K | 1M | 27.3% |

*Key observation: Usage spiked dramatically around Jan 27–31, then dropped. Function invocations hit 100% in the previous billing cycle (before Feb 4). The current cycle is tracking lower but Fluid Active CPU is the primary concern at 75.8%.*

### 1.1 What's Driving Usage

Analysis of the codebase identified three primary contributors to Vercel resource consumption:

| Contributor | Impact | Detail |
|---|---|---|
| Client-side polling | High | 19 polling configurations across the app, including 2 at 1-second intervals |
| Orders page multi-query | Medium–High | 9 concurrent polling queries (5 at 30s, 3 at 60s, 1 dynamic) |
| Lack of HTTP caching | Medium | Only 5 of 342 API routes actually cache responses |

---

## 2. Strategy 1: Increase Polling Intervals

> **Estimated Impact:**
> - Function invocations: −40–55% reduction
> - Fluid Active CPU: −20–30% reduction (fewer function executions = less CPU)

### 2.1 Current Polling Inventory (Verified)

Every refetchInterval and setInterval in the codebase, grouped by frequency:

#### 1-Second Intervals (Critical)

| File | Hook / Component | Endpoint | Interval |
|---|---|---|---|
| hooks/use-pomodoro.ts | useCurrentPomodoro() | /api/pomodoro/current | 1,000ms |
| hooks/use-time-tracking.ts | useCurrentTimeEntry() | /api/time-tracking/current | 1,000ms |
| components/.../TimeTrackingPanel.tsx | setInterval (UI only) | None (local state) | 1,000ms |
| components/.../PomodoroPanel.tsx | setInterval (UI only) | None (local state) | 1,000ms |

*Note: The two setInterval instances in the Panel components are UI-only timers that update local display state. They do NOT hit the server. The two useQuery hooks are the ones generating API calls.*

#### 2–5 Second Intervals (Conditional)

| File | Hook | Endpoint | Interval | Condition |
|---|---|---|---|---|
| hooks/use-ebay-sync.ts | useEbaySync() | /api/integrations/ebay/sync | 5,000ms | Only when isRunning=true |
| hooks/use-amazon-transaction-sync.ts | useAmazonTransactionSync() | /api/integrations/amazon/transactions/sync | 5,000ms | Only when isRunning=true |
| hooks/use-paypal-sync.ts | usePayPalSync() | /api/integrations/paypal/sync | 5,000ms | Only when isRunning=true |
| hooks/listing-refresh/use-refresh-job.ts | useRefreshJob() | /api/ebay/listing-refresh/{id} | 2,000ms | Only during active refresh |
| hooks/use-quality-review.ts | Manual polling | /api/ebay/listing/{id}/quality-review | 2,000ms | Max 60 attempts |

*These conditional intervals are reasonable — they only fire during active operations and stop when done. Lower priority for changes.*

#### 30-Second Intervals

| File | Hook | Endpoint |
|---|---|---|
| hooks/use-vinted-automation.ts | useScannerStatus() | /api/arbitrage/vinted/automation |
| hooks/use-bricklink-uploads.ts | useBrickLinkUploadSyncStatus() | /api/bricklink-uploads/sync |
| hooks/use-amazon-sync.ts | useSyncFeed() | /api/amazon/sync/feeds/{feedId} (conditional) |

#### 60-Second Intervals

| File | Hook | Endpoint |
|---|---|---|
| hooks/use-time-tracking.ts | useTimeSummary() | /api/time-tracking/summary |
| hooks/use-ebay-sync.ts | useEbaySync() (idle) | /api/integrations/ebay/sync |
| hooks/use-bricklink-transaction-sync.ts | useBrickLinkTransactionSync() | /api/integrations/bricklink/status |
| hooks/use-brickowl-transaction-sync.ts | useBrickOwlTransactionSync() | /api/integrations/brickowl/status |
| hooks/use-paypal-sync.ts | usePayPalSync() (idle + status) | /api/integrations/paypal/status |
| hooks/use-orders.ts | useBrickLinkSyncStatus() | /api/integrations/bricklink/sync |
| hooks/use-workflow.ts | useTodaysTasks() | /api/workflow/tasks/today |
| hooks/use-vinted-automation.ts | useOpportunities() | /api/arbitrage/vinted/automation/opportunities |
| hooks/use-vinted-automation.ts | useSchedule() | /api/arbitrage/vinted/automation/schedule/web |

#### 5-Minute Intervals

| File | Hook | Endpoint |
|---|---|---|
| hooks/use-metrics.ts | useWeeklyMetrics() | /api/workflow/metrics |
| hooks/use-metrics.ts | useListingCounts() | /api/inventory/listing-counts |

### 2.2 Proposed Changes

#### Change A: Pomodoro & Time Tracking (1s → 10s + client-side timer)

The 1-second server polling exists to display a live countdown/stopwatch. The UI panels already have local setInterval timers for display. The server poll is redundant for display purposes — it only needs to sync state occasionally.

| File | Current | Proposed | Savings |
|---|---|---|---|
| use-pomodoro.ts | refetchInterval: 1000 | refetchInterval: 10000 | 90% fewer calls |
| use-time-tracking.ts (current) | refetchInterval: 1000 | refetchInterval: 10000 | 90% fewer calls |

*Impact calculation: If a user has time tracking active for 6 hours/day, this drops from 21,600 calls/day to 2,160. Over 30 days = saving ~584,000 invocations/month per timer.*

#### Change B: Add refetchIntervalInBackground: false globally

Currently, none of the 16 refetchInterval hooks set refetchIntervalInBackground. This means polling continues even when the browser tab is not visible. Adding this single property stops all background polling across the app.

| File | Change |
|---|---|
| All 14 hooks with refetchInterval | Add `refetchIntervalInBackground: false` to each useQuery config |

*Impact: If the user has the app open in a background tab for 8 hours (common with browser tabs), this eliminates all background polling. Potentially saves 30–50% of all polling invocations depending on usage patterns.*

#### Change C: Increase remaining intervals

| Current Interval | Proposed | Rationale |
|---|---|---|
| 30s (vinted scanner, bricklink uploads) | 90s | Status checks don't need sub-minute updates |
| 60s (integration statuses, workflow) | 120s | Integration status rarely changes within a minute |
| 60s (time tracking summary) | 300s | Summary data is informational, not real-time |
| 5min (metrics, listing counts) | No change | Already reasonable |

---

## 3. Strategy 2: Batch Orders Page Queries

> **Estimated Impact:**
> - Function invocations: −10–15% reduction (Orders page is often open for extended periods)
> - Fluid Active CPU: −5–10% reduction

### 3.1 Current State (Verified)

When the Orders page is open with all platforms configured and connected, these queries poll concurrently:

#### 30-Second Polling Queries (5 queries)

1. Platform sync status — /api/integrations/sync-all-orders
2. Order status summary — /api/orders/status-summary
3. eBay status summary — /api/orders/ebay/status-summary
4. Bricqer status summary — /api/orders/status-summary?platform=bricqer
5. Amazon status summary — /api/orders/status-summary?platform=amazon

#### 60-Second Polling Queries (3 queries)

1. eBay connection status — /api/integrations/ebay/status
2. eBay sync log — /api/integrations/ebay/sync
3. Amazon fee reconciliation — /api/admin/reconcile-amazon-fees

#### Dynamic Polling (1 query)

1. Amazon backfill status — /api/orders/backfill (2s when running, 30s when idle)

**Total: 15 requests/minute idle, up to 43/min during backfill.** Over an 8-hour day with the Orders page open: 7,200 requests (idle) to 20,640 requests (backfill active).

### 3.2 Proposed Changes

#### Change D: Create a combined /api/orders/dashboard-status endpoint

Merge the 5 status summary queries (items 1–5 above) into a single endpoint that returns all platform statuses and counts in one response.

| Aspect | Detail |
|---|---|
| New endpoint | /api/orders/dashboard-status |
| Replaces | 5 separate queries (sync-all-orders, status-summary, ebay/status-summary, bricqer status, amazon status) |
| Polling interval | 60s (up from 30s, since we're getting more data per call) |
| Response shape | `{ syncStatus, statusSummary, ebayStatusSummary, bricqerStatusSummary, amazonStatusSummary }` |

*Impact calculation: Reduces from 10 requests/min (5 queries at 30s each) to 1 request/min. That's 9 fewer requests per minute, or 4,320 fewer per 8-hour session.*

#### Change E: Combine connection status queries

Merge the eBay connection check, eBay sync log, and Amazon fee reconciliation into the dashboard-status endpoint or a separate /api/orders/connection-status endpoint polled at 120s.

*Impact: Reduces 3 queries/min to 0.5 queries/min. Saves ~1,200 requests over an 8-hour session.*

---

## 4. Strategy 3: Add HTTP Cache Headers

> **Estimated Impact:**
> - Function invocations: −5–15% reduction
> - Fluid Active CPU: −5–10% reduction (cached responses avoid hitting Supabase)

### 4.1 Current State (Verified)

| Category | Count | Percentage |
|---|---|---|
| Routes with actual caching (max-age > 0) | 5 | 1.5% |
| Routes with no-cache headers | 12 | 3.5% |
| Routes with no cache headers at all | 325 | 95.0% |
| Total API routes | 342 | 100% |

#### Routes that currently cache:

- /api/purchases — private, max-age=30
- /api/inventory — private, max-age=30
- /api/inventory/summary — private, max-age=30, stale-while-revalidate=60
- /api/orders/stats — private, max-age=60, stale-while-revalidate=120
- /api/integrations/bricqer/inventory/stats-cached (GET) — implicit

### 4.2 Proposed Changes

#### Change F: Add cache headers to high-frequency read endpoints

Focus on endpoints that are polled frequently and return data that doesn't change second-by-second.

| Endpoint | Proposed Cache Header | Rationale |
|---|---|---|
| /api/integrations/*/status | private, max-age=30, swr=60 | Connection status rarely changes within 30s |
| /api/orders/status-summary | private, max-age=15, swr=30 | Order counts update on sync, not continuously |
| /api/workflow/tasks/today | private, max-age=30, swr=60 | Task list changes on user action, not polling |
| /api/workflow/metrics | private, max-age=120, swr=300 | Weekly metrics are inherently slow-changing |
| /api/inventory/listing-counts | private, max-age=60, swr=120 | Listing counts change on sync events |
| /api/time-tracking/summary | private, max-age=60, swr=120 | Daily summary doesn't need real-time |
| /api/pomodoro/current | private, max-age=5 | Short cache to deduplicate rapid requests |
| /api/time-tracking/current | private, max-age=5 | Short cache to deduplicate rapid requests |

*Note on React Query interaction: React Query already deduplicates in-flight requests on the client. HTTP cache headers add a second layer that helps with: (a) browser back/forward navigation, (b) middleware re-requests, (c) multiple components mounting simultaneously. The primary value here is reducing Supabase database load per request, which lowers CPU time.*

---

## 5. Implementation Plan

### Phase 1: Quick Wins (1–2 hours)

These changes are low-risk, high-impact, and can be deployed immediately.

1. **Change B:** Add `refetchIntervalInBackground: false` to all 14 polling hooks. This is a one-line addition per hook with zero risk of breaking functionality.
2. **Change A:** Update use-pomodoro.ts and use-time-tracking.ts intervals from 1000ms to 10000ms. Verify the existing PomodoroPanel/TimeTrackingPanel setInterval timers keep the UI responsive.
3. **Change C:** Increase 30s intervals to 90s and 60s intervals to 120s across all hooks.
4. **Change F:** Add cache headers to the 8 endpoints listed above.

### Phase 2: Batching (3–4 hours)

Requires creating new API endpoints and updating the Orders page component.

1. **Change D:** Create /api/orders/dashboard-status endpoint that aggregates the 5 status queries.
2. **Change E:** Merge connection status queries into the same or a companion endpoint.
3. Update Orders page.tsx to use the new combined query instead of 8 individual ones.

### Phase 3: Verify & Monitor (Ongoing)

- Deploy to preview branch and verify no functionality regressions
- Monitor Vercel usage dashboard for 48–72 hours after deploy
- Compare invocation counts week-over-week
- Check Fluid Active CPU trending — target: under 50% utilisation

---

## 6. Expected Impact Summary

| Change | Invocation Reduction | CPU Reduction | Effort | Risk |
|---|---|---|---|---|
| A: Pomodoro/Time 1s→10s | ~580K/month (if active 6hrs/day) | Low–Medium | 15 min | Very Low |
| B: Background polling off | 30–50% of all polling | Low–Medium | 30 min | None |
| C: Increase other intervals | ~40% of remaining polling | Low | 30 min | Very Low |
| D+E: Batch Orders queries | ~5,500/day (8hr session) | Medium | 3–4 hrs | Low |
| F: Cache headers | 5–15% overall | Medium | 1 hr | Very Low |

> **Bottom Line:**
> Phase 1 alone (Changes A–C, F) should reduce function invocations by 40–60% and Fluid Active CPU by 20–35%. Adding Phase 2 (Changes D–E) brings total reduction to 50–70% for invocations. This should comfortably keep you within Hobby tier limits without upgrading to Pro.

### 6.1 Files to Modify (Complete List)

#### Phase 1 — Hook files (refetchInterval changes):

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

#### Phase 1 — API route files (cache headers):

- `apps/web/src/app/api/pomodoro/current/route.ts`
- `apps/web/src/app/api/time-tracking/current/route.ts`
- `apps/web/src/app/api/time-tracking/summary/route.ts`
- `apps/web/src/app/api/orders/status-summary/route.ts`
- `apps/web/src/app/api/workflow/tasks/today/route.ts`
- `apps/web/src/app/api/workflow/metrics/route.ts`
- `apps/web/src/app/api/inventory/listing-counts/route.ts`
- `apps/web/src/app/api/integrations/*/status/route.ts` (multiple)

#### Phase 2 — New + modified files:

- `apps/web/src/app/api/orders/dashboard-status/route.ts` (NEW)
- `apps/web/src/app/(dashboard)/orders/page.tsx` (refactor queries)
