# Done Criteria: full-sync-job

**Created:** 2026-01-29
**Author:** Define Done Agent + Chris
**Status:** APPROVED

## Feature Summary

A scheduled cron job that runs twice daily (7:45 AM and 1:45 PM UK time) to perform a comprehensive platform sync, add Amazon inventory ASINs to tracking, cleanup stale jobs, and send a detailed Discord status report to the #sync-status channel.

## Feature Context

**Problem:** Manual syncing is required to keep platform data up-to-date; there's no automated health monitoring or cleanup of stuck jobs.

**User:** Business owner (Chris) - automated background process

**Trigger:** Vercel Cron at 7:45 AM and 1:45 PM UK local time

**Outcome:** All platforms synced, inventory ASINs tracked, stale jobs cleaned up, Discord notification sent with comprehensive status report

**Scope:**
- Full platform sync (eBay, Amazon, BrickLink, Brick Owl)
- Amazon inventory ASIN sync (add to tracked_asins)
- Stale job detection and cleanup
- Discord status report
- NOT: ASIN Discovery (Brickset → Amazon lookup)

---

## Success Criteria

### Functional

#### F1: Cron Endpoint Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** A new API route exists at `/api/cron/full-sync/route.ts`
- **Evidence:** File exists and exports GET or POST handler
- **Test:** `fs.existsSync('apps/web/src/app/api/cron/full-sync/route.ts')`

#### F2: Cron Authentication
- **Tag:** AUTO_VERIFY
- **Criterion:** Endpoint validates Bearer token against `CRON_SECRET` environment variable, returns 401 if invalid/missing
- **Evidence:** Request without valid Authorization header returns HTTP 401
- **Test:** `fetch('/api/cron/full-sync', { method: 'POST' })` returns 401; with valid token returns 200

#### F3: Vercel Cron Configuration
- **Tag:** AUTO_VERIFY
- **Criterion:** `vercel.json` contains cron configuration for `/api/cron/full-sync` at 7:45 AM and 1:45 PM UK time (UTC: 07:45 and 13:45 in winter, 06:45 and 12:45 in summer BST)
- **Evidence:** vercel.json cron array includes the endpoint with correct schedule expressions
- **Test:** Parse vercel.json, verify cron entry exists with schedule `"45 7,13 * * *"` (or timezone-aware equivalent)

#### F4: Platform Sync Execution
- **Tag:** AUTO_VERIFY
- **Criterion:** Job executes all 5 platform syncs: eBay Orders, eBay Auto Sync, Amazon Orders, BrickLink Orders, Brick Owl Orders
- **Evidence:** Sync log entries created in respective tables (`ebay_sync_log`, `amazon_sync_log`, `bricklink_sync_log`, `brickowl_sync_log`) with timestamps within job execution window
- **Test:** Query sync log tables for entries with `started_at` within last 5 minutes after job trigger

#### F5: Platform Syncs Run in Parallel
- **Tag:** AUTO_VERIFY
- **Criterion:** Platform syncs are executed concurrently using `Promise.allSettled()` pattern (not sequential)
- **Evidence:** Code inspection shows `Promise.allSettled()` wrapping sync calls
- **Test:** Grep for `Promise.allSettled` in the route file

#### F6: Amazon Inventory ASIN Sync
- **Tag:** AUTO_VERIFY
- **Criterion:** Job calls `AmazonArbitrageSyncService.syncInventoryAsins()` to sync Amazon inventory ASINs to `tracked_asins` table
- **Evidence:** `tracked_asins` table updated with `source: 'inventory'` entries; `arbitrage_sync_status` updated for `job_type: 'inventory_asins'`
- **Test:** Query `arbitrage_sync_status` for `job_type = 'inventory_asins'` with `last_run_at` within job execution window

#### F7: Stale Job Detection - Stuck Jobs
- **Tag:** AUTO_VERIFY
- **Criterion:** Job identifies "stuck" jobs where status is 'running' or 'in_progress' AND last update was > 30 minutes ago
- **Evidence:** Query returns jobs matching stuck criteria from sync log/status tables
- **Test:** Insert test record with `status = 'running'` and `updated_at = NOW() - 35 minutes`, verify job detects it

#### F8: Stale Job Cleanup - Reset Stuck Jobs
- **Tag:** AUTO_VERIFY
- **Criterion:** Stuck jobs are reset to 'failed' or 'timeout' status with error message indicating automatic cleanup
- **Evidence:** Previously stuck jobs have status changed to 'failed'/'timeout' with `error_message` containing 'Automatically reset' or similar
- **Test:** After job runs, verify stuck test record has status = 'failed' or 'timeout'

#### F9: Continue On Failure
- **Tag:** AUTO_VERIFY
- **Criterion:** If one platform sync fails, job continues with remaining syncs and reports partial success
- **Evidence:** Code uses `Promise.allSettled()` (not `Promise.all()`); Discord message shows mixed success/failure states
- **Test:** Mock one sync to fail, verify other syncs complete and Discord message sent with partial results

#### F10: Sync Results Collection
- **Tag:** AUTO_VERIFY
- **Criterion:** Job collects results from each sync operation including: items processed, items created, items updated, items failed, duration
- **Evidence:** Results object contains per-platform metrics
- **Test:** Verify response/log contains structured results for each platform

#### F11: Weekly Stats Calculation
- **Tag:** AUTO_VERIFY
- **Criterion:** Job calculates weekly stats: listed this week, sold this week, backlog count
- **Evidence:** Discord message includes weekly stats section with numeric values
- **Test:** Parse Discord webhook payload for weekly stats fields

---

### Discord Notification

#### D1: Discord Webhook Integration
- **Tag:** AUTO_VERIFY
- **Criterion:** Job sends notification to `DISCORD_WEBHOOK_SYNC_STATUS` channel on completion
- **Evidence:** Discord webhook called with valid payload
- **Test:** Mock webhook, verify POST request made to `DISCORD_WEBHOOK_SYNC_STATUS` URL

#### D2: Discord Message Format - Header
- **Tag:** AUTO_VERIFY
- **Criterion:** Message includes header with job name, date, and time in format: "Hadley Bricks Full Sync - [Day], [Month] [Date] [Year] ([Time] UTC)"
- **Evidence:** Message title/embed title matches expected format
- **Test:** Regex match on webhook payload title

#### D3: Discord Message Format - Stuck Jobs Section
- **Tag:** AUTO_VERIFY
- **Criterion:** Message includes "STUCK JOBS" section with either list of stuck jobs found or "None found" message
- **Evidence:** Webhook payload contains field/section for stuck jobs
- **Test:** Parse webhook payload for stuck jobs section

#### D4: Discord Message Format - Platform Sync Results
- **Tag:** AUTO_VERIFY
- **Criterion:** Message includes sync results for each platform showing status (success/failed), items processed, and failures if any
- **Evidence:** Webhook payload contains per-platform results with counts
- **Test:** Parse webhook payload for platform results section

#### D5: Discord Message Format - Inventory ASIN Sync
- **Tag:** AUTO_VERIFY
- **Criterion:** Message includes Amazon Inventory ASIN sync results showing added/updated counts
- **Evidence:** Webhook payload contains inventory ASIN section with add/update counts
- **Test:** Parse webhook payload for inventory ASIN section

#### D6: Discord Message Format - Weekly Stats
- **Tag:** AUTO_VERIFY
- **Criterion:** Message includes weekly stats: listed this week, sold this week, backlog count
- **Evidence:** Webhook payload contains weekly stats section
- **Test:** Parse webhook payload for weekly stats fields

#### D7: Discord Message Format - Cleanup Summary
- **Tag:** AUTO_VERIFY
- **Criterion:** Message includes cleanup summary showing number of stuck jobs reset
- **Evidence:** Webhook payload contains cleanup section with count
- **Test:** Parse webhook payload for cleanup section

#### D8: Discord Message Format - Next Run Time
- **Tag:** AUTO_VERIFY
- **Criterion:** Message includes "Next sync:" with the next scheduled run time
- **Evidence:** Webhook payload footer or field contains next run time
- **Test:** Parse webhook payload for next run time

#### D9: Discord Color Coding
- **Tag:** AUTO_VERIFY
- **Criterion:** Discord embed uses green (0x57f287) for all success, orange (0xe67e22) for partial success, red (0xed4245) for all failed
- **Evidence:** Webhook payload `color` field matches expected value based on results
- **Test:** Trigger with all success, verify green; trigger with partial failure, verify orange

---

### Error Handling

#### E1: Missing Credentials Graceful Skip
- **Tag:** AUTO_VERIFY
- **Criterion:** If platform credentials are missing, that sync is skipped with warning (not fatal error)
- **Evidence:** Job completes, Discord message shows "Skipped - No credentials" for that platform
- **Test:** Remove one platform's credentials, verify job completes and reports skip

#### E2: Discord Webhook Failure Non-Fatal
- **Tag:** AUTO_VERIFY
- **Criterion:** If Discord webhook fails, job still completes successfully (notification is best-effort)
- **Evidence:** Job returns success even when webhook throws
- **Test:** Mock webhook to throw, verify job returns 200

#### E3: Timeout Protection
- **Tag:** AUTO_VERIFY
- **Criterion:** Route has `maxDuration = 300` (5 minutes) to prevent Vercel timeout
- **Evidence:** Route file exports `maxDuration` constant
- **Test:** Grep route file for `maxDuration`

#### E4: Individual Sync Timeout
- **Tag:** AUTO_VERIFY
- **Criterion:** Each platform sync has individual timeout of 60 seconds to prevent one slow sync from blocking others
- **Evidence:** Promise.race or AbortController used with 60s timeout per sync
- **Test:** Code inspection for timeout wrapper around each sync call

---

### Performance

#### P1: Total Execution Time
- **Tag:** AUTO_VERIFY
- **Criterion:** Full job completes within 5 minutes (Vercel function limit)
- **Evidence:** Job returns before maxDuration timeout
- **Test:** Measure execution time, verify < 300 seconds

#### P2: Parallel Sync Efficiency
- **Tag:** AUTO_VERIFY
- **Criterion:** Platform syncs run in parallel, not sequentially (total time < sum of individual times)
- **Evidence:** Log timestamps show overlapping execution
- **Test:** Compare parallel execution time vs sequential baseline

---

### Integration

#### I1: Reuses Existing Sync Services
- **Tag:** AUTO_VERIFY
- **Criterion:** Job uses existing sync services: `EbayOrderSyncService`, `EbayAutoSyncService`, `AmazonSyncService`, `BricklinkSyncService`, `BrickowlSyncService`, `AmazonArbitrageSyncService`
- **Evidence:** Import statements reference existing service files
- **Test:** Grep for service imports in route file

#### I2: Reuses Discord Service
- **Tag:** AUTO_VERIFY
- **Criterion:** Job uses existing `DiscordService` for notifications
- **Evidence:** Import statement references `discord.service.ts`
- **Test:** Grep for DiscordService import

#### I3: Consistent with Existing Cron Pattern
- **Tag:** AUTO_VERIFY
- **Criterion:** Route follows same pattern as existing cron jobs (auth, logging, error handling)
- **Evidence:** Code structure matches `/api/cron/amazon-sync` or similar
- **Test:** Code review comparison with existing cron routes

---

## Out of Scope

- ASIN Discovery (Brickset → Amazon lookup) - too slow for scheduled job
- Seeded ASIN initialization - manual operation only
- User-specific scheduling - runs for all configured platforms
- Retry logic for failed syncs - will retry on next scheduled run
- Historical job analysis - only current stuck job detection

## Dependencies

- Platform credentials configured in `platform_credentials` table
- `DISCORD_WEBHOOK_SYNC_STATUS` environment variable set
- `CRON_SECRET` environment variable set
- Existing sync services functional
- Vercel cron enabled on the project

## Iteration Budget

- **Max iterations:** 5
- **Escalation:** If not converged after 5 iterations, pause for human review

---

## Verification Checklist

Before marking complete, verify:

- [ ] `/api/cron/full-sync` endpoint exists and handles POST
- [ ] Bearer token auth with CRON_SECRET works
- [ ] vercel.json updated with cron schedule
- [ ] All 5 platform syncs execute
- [ ] Amazon inventory ASIN sync executes
- [ ] Stuck job detection works (> 30 min running)
- [ ] Stuck jobs reset to failed/timeout
- [ ] Discord message sent with full format
- [ ] Partial failure handling works
- [ ] TypeScript compiles with no errors
- [ ] No console errors during execution
