# Done Criteria: ebay-arbitrage-cleanup

**Created:** 2026-01-28
**Author:** Define Done Agent + Chris
**Status:** APPROVED

## Feature Summary

Migrate the existing Python-based eBay false-positive detector into the Hadley Bricks app as a scheduled cron endpoint. The job runs daily at 4am UTC (after the eBay pricing sync completes at 2am) and automatically excludes eBay listings that are false positives (minifigs, keyrings, instructions, wrong sets, etc.) from arbitrage calculations by adding them to the `excluded_ebay_listings` table.

## Success Criteria

### Functional

#### F1: Cron Endpoint Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** A POST endpoint exists at `/api/cron/ebay-fp-cleanup`
- **Evidence:** Route file exists and responds to POST requests
- **Test:** `curl -X POST /api/cron/ebay-fp-cleanup` returns JSON response (401 without auth, 200 with valid CRON_SECRET)

#### F2: Authentication Required
- **Tag:** AUTO_VERIFY
- **Criterion:** Endpoint requires `Authorization: Bearer {CRON_SECRET}` header
- **Evidence:** Returns 401 without valid auth, 200 with valid auth
- **Test:** Request without auth returns `{ "error": "Unauthorized" }` with status 401

#### F3: Scoring Service Implements All 14 Signals
- **Tag:** AUTO_VERIFY
- **Criterion:** TypeScript scoring service implements all 14 detection signals from the Python script:
  1. Very Low COG (<5%) - 35 pts
  2. Low COG (<10%) - 25 pts
  3. Suspicious COG (<15%) - 15 pts
  4. Part Number Pattern (e.g., "24183pb01") - 30 pts
  5. Minifigure Keywords - 25 pts
  6. Instructions Only - 30 pts
  7. Missing Set Number - 15 pts
  8. Parts/Pieces Keywords - 20 pts
  9. Incomplete Indicators - 25 pts
  10. Item Only Pattern ("X only") - 30 pts
  11. Keyring Detection - 30 pts
  12. Name Mismatch - 25 pts
  13. Wrong Set Number - 40 pts
  14. Price Anomaly (<£10 when Amazon >£50) - 20 pts
- **Evidence:** Service file exports `scoreListing()` function; unit tests cover all 14 signals
- **Test:** Unit test suite with test cases for each signal

#### F4: Score Capped at 100
- **Tag:** AUTO_VERIFY
- **Criterion:** Maximum score is capped at 100 regardless of how many signals trigger
- **Evidence:** `scoreListing()` returns `Math.min(totalScore, 100)`
- **Test:** Unit test with listing that triggers multiple signals totaling >100 returns exactly 100

#### F5: Default Threshold is 50
- **Tag:** AUTO_VERIFY
- **Criterion:** Items scoring 50+ are flagged for exclusion by default
- **Evidence:** Constant `DEFAULT_THRESHOLD = 50` used when no override provided
- **Test:** Listing scoring 49 is not excluded; listing scoring 50 is excluded

#### F6: Processes All Items (No Limit)
- **Tag:** AUTO_VERIFY
- **Criterion:** Job processes ALL items in `arbitrage_current_view` with eBay data (no artificial limit)
- **Evidence:** Query fetches all rows using pagination, no `LIMIT` cap
- **Test:** With 2000 items in view, all 2000 are analyzed

#### F7: Queries arbitrage_current_view
- **Tag:** AUTO_VERIFY
- **Criterion:** Job reads from `arbitrage_current_view` filtered to items with eBay data
- **Evidence:** Query selects from `arbitrage_current_view` where `ebay_listings IS NOT NULL`
- **Test:** Query returns items with `ebay_listings` populated

#### F8: Loads Valid Set Numbers from brickset_sets
- **Tag:** AUTO_VERIFY
- **Criterion:** Job loads all set numbers from `brickset_sets` table for "Wrong Set Number" detection (paginated to handle >1000 rows)
- **Evidence:** Paginated query fetches all rows from `brickset_sets`
- **Test:** With 18k+ sets in table, all are loaded into validation set

#### F9: Skips Already Excluded Listings
- **Tag:** AUTO_VERIFY
- **Criterion:** Listings already in `excluded_ebay_listings` are skipped during scoring
- **Evidence:** Query excludes item IDs present in `excluded_ebay_listings`
- **Test:** Add item to exclusions, run job - item not re-scored

#### F10: Inserts to excluded_ebay_listings
- **Tag:** AUTO_VERIFY
- **Criterion:** Flagged listings are inserted into `excluded_ebay_listings` with:
  - `user_id`: DEFAULT_USER_ID
  - `ebay_item_id`: from listing
  - `set_number`: from arbitrage item
  - `title`: listing title (truncated to 200 chars)
  - `reason`: comma-separated list of triggered signals (truncated to 500 chars)
- **Evidence:** Database insert statement includes all required fields
- **Test:** After job runs, query `excluded_ebay_listings` shows new records with all fields populated

#### F11: Handles Duplicate Exclusions Gracefully
- **Tag:** AUTO_VERIFY
- **Criterion:** If a listing is already excluded (duplicate key), the insert is ignored without error
- **Evidence:** Uses `ON CONFLICT DO NOTHING` or catches unique constraint violation
- **Test:** Run job twice with same data - no errors, same exclusion count

#### F12: Returns JSON Response with Stats
- **Tag:** AUTO_VERIFY
- **Criterion:** Endpoint returns JSON with: `success`, `itemsScanned`, `itemsFlagged`, `itemsExcluded`, `errors`, `duration`
- **Evidence:** Response body contains all required fields
- **Test:** Parse response JSON and verify all fields present

### Sync Status Tracking

#### S1: Creates Sync Status Record
- **Tag:** AUTO_VERIFY
- **Criterion:** Job creates/updates record in `arbitrage_sync_status` with `job_type = 'ebay_fp_cleanup'`
- **Evidence:** Upsert to `arbitrage_sync_status` on `user_id, job_type`
- **Test:** After job runs, query `arbitrage_sync_status WHERE job_type = 'ebay_fp_cleanup'` returns row

#### S2: Tracks Items Processed and Excluded
- **Tag:** AUTO_VERIFY
- **Criterion:** Sync status record includes `items_processed` (scanned) and `items_excluded` (flagged)
- **Evidence:** Fields populated in upsert statement
- **Test:** Query sync status after run shows accurate counts

#### S3: Tracks Duration
- **Tag:** AUTO_VERIFY
- **Criterion:** Sync status record includes `last_run_duration_ms`
- **Evidence:** Duration calculated from start to end of job
- **Test:** `last_run_duration_ms` is positive integer after run

#### S4: Tracks Success/Failure Status
- **Tag:** AUTO_VERIFY
- **Criterion:** Sync status `status` field is 'completed' on success, 'failed' on error
- **Evidence:** Status set based on try/catch outcome
- **Test:** Successful run shows 'completed'; simulated error shows 'failed'

#### S5: Tracks Error Message on Failure
- **Tag:** AUTO_VERIFY
- **Criterion:** On failure, `error_message` contains the error description
- **Evidence:** Catch block sets `error_message` field
- **Test:** Simulated error shows error message in sync status

### Discord Notifications

#### D1: Sends to Sync Status Channel on Success
- **Tag:** AUTO_VERIFY
- **Criterion:** On successful completion, sends notification to `DISCORD_WEBHOOK_SYNC_STATUS` with:
  - Title: "✅ eBay FP Cleanup Complete"
  - Items scanned, flagged, excluded counts
- **Evidence:** `discordService.sendSyncStatus()` called with success payload
- **Test:** Mock Discord service, verify `sendSyncStatus` called with expected payload

#### D2: Sends to Alerts Channel on Failure
- **Tag:** AUTO_VERIFY
- **Criterion:** On error, sends notification to `DISCORD_WEBHOOK_ALERTS` with:
  - Title: "🔴 eBay FP Cleanup Failed"
  - Error message
  - Priority: high
- **Evidence:** `discordService.sendAlert()` called in catch block
- **Test:** Mock Discord service, simulate error, verify `sendAlert` called

#### D3: Sends to Both Channels on Success with Exclusions
- **Tag:** AUTO_VERIFY
- **Criterion:** When items are excluded, notification includes count and sample reasons
- **Evidence:** Message body includes exclusion count and top 3 reasons
- **Test:** Verify notification message format includes exclusion summary

### Error Handling

#### E1: Handles Database Connection Errors
- **Tag:** AUTO_VERIFY
- **Criterion:** Database connection errors are caught, logged, and reported via Discord
- **Evidence:** Try/catch wraps database operations
- **Test:** Mock Supabase to throw, verify error handling

#### E2: Handles Empty Arbitrage View
- **Tag:** AUTO_VERIFY
- **Criterion:** If `arbitrage_current_view` returns no items, job completes successfully with 0 counts
- **Evidence:** Empty result handled gracefully
- **Test:** With empty view, job returns `{ success: true, itemsScanned: 0, itemsExcluded: 0 }`

#### E3: Handles Malformed Listing JSON
- **Tag:** AUTO_VERIFY
- **Criterion:** If `ebay_listings` JSON is malformed, item is skipped and error logged
- **Evidence:** JSON parsing wrapped in try/catch per item
- **Test:** Insert malformed JSON, run job - item skipped, others processed

#### E4: Handles Missing Environment Variables
- **Tag:** AUTO_VERIFY
- **Criterion:** If `CRON_SECRET` is not set, all requests are allowed (development mode)
- **Evidence:** Auth check skipped when `!process.env.CRON_SECRET`
- **Test:** Unset CRON_SECRET, request without auth succeeds

### Performance

#### P1: Completes in Under 5 Minutes
- **Tag:** AUTO_VERIFY
- **Criterion:** Job processing all items completes within Vercel Pro timeout (300 seconds)
- **Evidence:** `last_run_duration_ms < 300000` in sync status
- **Test:** Run with full dataset, verify completion within timeout

#### P2: Uses Batched Queries
- **Tag:** AUTO_VERIFY
- **Criterion:** Large tables (brickset_sets, excluded_ebay_listings) are queried with pagination (1000 rows per batch)
- **Evidence:** Queries use `.range()` with offset/limit
- **Test:** Code review confirms paginated queries

#### P3: Single Batch Insert for Exclusions
- **Tag:** AUTO_VERIFY
- **Criterion:** All exclusions are inserted in a single batch operation, not individual inserts
- **Evidence:** Single `.insert()` call with array of records
- **Test:** With 50 exclusions, only 1 database insert operation

### Integration

#### I1: Uses Existing Discord Service
- **Tag:** AUTO_VERIFY
- **Criterion:** Notifications use `discordService` from `@/lib/notifications`
- **Evidence:** Import statement: `import { discordService } from '@/lib/notifications'`
- **Test:** File imports existing discord service

#### I2: Uses Existing Supabase Client
- **Tag:** AUTO_VERIFY
- **Criterion:** Database access uses `createServiceRoleClient()` from `@/lib/supabase/server`
- **Evidence:** Import and usage of service role client
- **Test:** File imports existing supabase client factory

#### I3: Follows Existing Cron Pattern
- **Tag:** AUTO_VERIFY
- **Criterion:** Endpoint structure matches `/api/cron/ebay-pricing/route.ts` pattern (auth, logging, response format)
- **Evidence:** Similar code structure and conventions
- **Test:** Code review confirms consistent patterns

#### I4: Service Exported from Arbitrage Module
- **Tag:** AUTO_VERIFY
- **Criterion:** Scoring service exported from `@/lib/arbitrage` barrel file
- **Evidence:** `export { EbayFpDetectorService } from './ebay-fp-detector.service'` in index.ts
- **Test:** Import resolves: `import { EbayFpDetectorService } from '@/lib/arbitrage'`

## Out of Scope

- UI for viewing/managing auto-excluded items (use existing exclusions modal)
- Manual trigger button in dashboard (can call API directly)
- Configurable threshold via UI (hardcoded for now)
- Re-checking previously excluded items for restoration
- Image-based detection (can't verify photos programmatically)
- Real-time detection during eBay sync (this is post-sync cleanup)

## Dependencies

- eBay pricing sync must have run first (scheduled at 2am UTC)
- `excluded_ebay_listings` table must exist
- `arbitrage_current_view` must be populated with eBay data
- `brickset_sets` table must contain set numbers for validation
- Discord webhooks must be configured

## File Structure

```
apps/web/src/
├── app/api/cron/
│   └── ebay-fp-cleanup/
│       └── route.ts              # Cron endpoint
├── lib/arbitrage/
│   ├── ebay-fp-detector.service.ts  # Scoring service
│   ├── ebay-fp-detector.types.ts    # Types
│   └── index.ts                     # Updated exports
└── __tests__/
    └── ebay-fp-detector.test.ts     # Unit tests
```

## Iteration Budget

- **Max iterations:** 5
- **Escalation:** If not converged after 5 iterations, pause for human review
