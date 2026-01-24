# Done Criteria: scheduled-ebay-bricklink-pricing-sync

**Created:** 2026-01-24
**Author:** Define Done Agent + Chris
**Status:** DRAFT

---

## Feature Summary

Replace manual eBay and BrickLink sync buttons with automated daily scheduled syncs using cursor-based pagination to process ~2,503 ASINs over a 3-day cycle.

**Problem:** Manual sync buttons require user intervention and don't scale to the expanded watchlist of 2,503 items.
**User:** Chris (sole user)
**Trigger:** Automated cron schedule at 2am (eBay) and 2:30am (BrickLink) daily
**Outcome:** Pricing data for all watchlist items is automatically refreshed within a 3-day cycle, with staleness indicators showing data age.

---

## Success Criteria

### Functional - Database

#### F1: Watchlist Table Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Table `arbitrage_watchlist` exists with columns: `id`, `user_id`, `asin`, `bricklink_set_number`, `source`, `ebay_last_synced_at`, `bricklink_last_synced_at`, `is_active`, `created_at`, `updated_at`
- **Evidence:** Migration file creates table with all required columns and constraints
- **Test:** `SELECT column_name FROM information_schema.columns WHERE table_name = 'arbitrage_watchlist'` returns all expected columns

#### F2: Watchlist Source Constraint
- **Tag:** AUTO_VERIFY
- **Criterion:** The `source` column accepts only 'sold_inventory' or 'retired_with_pricing' values
- **Evidence:** CHECK constraint on source column
- **Test:** Attempt to insert invalid source value fails with constraint violation

#### F3: Sync Status Job Types Updated
- **Tag:** AUTO_VERIFY
- **Criterion:** `arbitrage_sync_status` table accepts 'ebay_scheduled_pricing' and 'bricklink_scheduled_pricing' job types
- **Evidence:** Updated CHECK constraint includes new job types
- **Test:** Insert records with new job types succeeds

### Functional - Watchlist Service

#### F4: Watchlist Service Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** `ArbitrageWatchlistService` class exists with methods: `refreshWatchlist`, `getWatchlistBatch`, `getWatchlistCount`, `updateSyncTimestamp`
- **Evidence:** File exists at `apps/web/src/lib/arbitrage/watchlist.service.ts` with exported class containing all methods
- **Test:** `grep -l "refreshWatchlist\|getWatchlistBatch\|getWatchlistCount\|updateSyncTimestamp" apps/web/src/lib/arbitrage/watchlist.service.ts`

#### F5: Watchlist Refresh Includes Sold ASINs
- **Tag:** AUTO_VERIFY
- **Criterion:** `refreshWatchlist()` includes all ASINs from `order_items` where platform is 'amazon' with source='sold_inventory'
- **Evidence:** Query joins `order_items` to `platform_orders` where `platform='amazon'`
- **Test:** Unit test verifies sold ASIN appears in watchlist with correct source

#### F6: Watchlist Refresh Includes Retired With Pricing
- **Tag:** AUTO_VERIFY
- **Criterion:** `refreshWatchlist()` includes seeded ASINs where `us_date_removed < CURRENT_DATE` AND (`buy_box_price IS NOT NULL` OR `was_price_90d IS NOT NULL`) with source='retired_with_pricing'
- **Evidence:** Query joins `seeded_asins` to `brickset_sets` and `amazon_arbitrage_pricing`
- **Test:** Unit test verifies retired ASIN with pricing appears in watchlist with correct source

#### F7: Watchlist Deduplicates
- **Tag:** AUTO_VERIFY
- **Criterion:** If an ASIN qualifies for both sources, only one record exists with source='sold_inventory' taking precedence
- **Evidence:** UNIQUE constraint on (user_id, bricklink_set_number) and upsert logic
- **Test:** Unit test with ASIN in both sources produces single 'sold_inventory' record

#### F8: Watchlist Batch Query Works
- **Tag:** AUTO_VERIFY
- **Criterion:** `getWatchlistBatch(userId, offset, limit)` returns items ordered consistently with pagination support
- **Evidence:** Method returns array of watchlist items with deterministic ordering
- **Test:** Unit test with offset=0,limit=10 then offset=10,limit=10 returns different non-overlapping sets

### Functional - Batch Sync Methods

#### F9: eBay Batch Sync Method Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** `EbaySyncService` has `syncPricingBatch(userId, { offset, limit })` method that syncs pricing for a batch of watchlist items
- **Evidence:** Method exists and calls eBay Browse API for specified batch
- **Test:** Integration test with mocked API verifies batch processing

#### F10: BrickLink Batch Sync Method Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** `BrickLinkSyncService` has `syncPricingBatch(userId, { offset, limit })` method that syncs pricing for a batch of watchlist items
- **Evidence:** Method exists and calls BrickLink API for specified batch
- **Test:** Integration test with mocked API verifies batch processing

#### F11: Sync Updates Watchlist Timestamps
- **Tag:** AUTO_VERIFY
- **Criterion:** After syncing, `ebay_last_synced_at` or `bricklink_last_synced_at` is updated for each processed item
- **Evidence:** `updateSyncTimestamp()` called after successful sync
- **Test:** Unit test verifies timestamp updated after sync call

### Functional - Cron Endpoints

#### F12: eBay Pricing Cron Endpoint Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** POST `/api/cron/ebay-pricing` endpoint exists and processes up to 1,000 items per invocation
- **Evidence:** Route file exists at `apps/web/src/app/api/cron/ebay-pricing/route.ts`
- **Test:** API endpoint responds to POST request

#### F13: BrickLink Pricing Cron Endpoint Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** POST `/api/cron/bricklink-pricing` endpoint exists and processes up to 1,000 items per invocation
- **Evidence:** Route file exists at `apps/web/src/app/api/cron/bricklink-pricing/route.ts`
- **Test:** API endpoint responds to POST request

#### F14: Cron Uses Cursor-Based Resume
- **Tag:** AUTO_VERIFY
- **Criterion:** Cron stores cursor position in `arbitrage_sync_status` and resumes from last position on next invocation
- **Evidence:** `cursor_position` field updated after each batch; next invocation reads cursor
- **Test:** Unit test: first call processes 0-999, next call processes 1000-1999

#### F15: Cron Resets Cursor on Cycle Complete
- **Tag:** AUTO_VERIFY
- **Criterion:** When cursor exceeds total watchlist count, cursor resets to 0 for next cycle
- **Evidence:** Cursor reset logic in cron handler
- **Test:** Unit test with cursor > total resets to 0

#### F16: Cron Returns Complete Status
- **Tag:** AUTO_VERIFY
- **Criterion:** Cron endpoint returns `{ complete: true, processed: N, cursor: X }` when batch completes
- **Evidence:** Response shape matches expected structure
- **Test:** API test verifies response structure

### Functional - GitHub Actions

#### F17: eBay Pricing Workflow Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** GitHub Actions workflow `.github/workflows/ebay-pricing-cron.yml` exists and runs at 2am UTC daily
- **Evidence:** Workflow file exists with `cron: '0 2 * * *'` schedule
- **Test:** File exists with correct cron expression

#### F18: BrickLink Pricing Workflow Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** GitHub Actions workflow `.github/workflows/bricklink-pricing-cron.yml` exists and runs at 2:30am UTC daily
- **Evidence:** Workflow file exists with `cron: '30 2 * * *'` schedule
- **Test:** File exists with correct cron expression

#### F19: Workflows Call Until Complete
- **Tag:** AUTO_VERIFY
- **Criterion:** Workflows call cron endpoint repeatedly until `complete: true` is returned
- **Evidence:** Workflow contains loop logic that checks response
- **Test:** Workflow file contains loop/retry logic

---

### UI/UX

#### U1: Sync Buttons Removed from eBay Page
- **Tag:** AUTO_VERIFY
- **Criterion:** The "Full Sync" button and individual sync buttons are removed from `/arbitrage/ebay` page
- **Evidence:** No button elements with sync-related text/actions on page
- **Test:** DOM query finds no elements with data-testid containing 'sync' or text 'Sync'

#### U2: Sync Buttons Removed from Amazon Page
- **Tag:** AUTO_VERIFY
- **Criterion:** The eBay/BrickLink sync buttons are removed from `/arbitrage/amazon` page
- **Evidence:** No button elements triggering ebay/bricklink sync on page
- **Test:** DOM query finds no elements with data-testid containing 'ebay-sync' or 'bricklink-sync'

#### U3: Last Sync Timestamp Displayed
- **Tag:** AUTO_VERIFY
- **Criterion:** Each arbitrage page displays "eBay: Last synced X ago" and "BrickLink: Last synced X ago" timestamps
- **Evidence:** Timestamp elements with data-testid present showing relative time
- **Test:** DOM query finds elements `[data-testid="ebay-last-sync"]` and `[data-testid="bricklink-last-sync"]`

#### U4: Staleness Indicator on Table Rows
- **Tag:** AUTO_VERIFY
- **Criterion:** Each row in arbitrage table shows data age badge: "Today" (green), "1 day" (blue), "2 days" (amber), "3+ days" (red)
- **Evidence:** Badge element with color-coded styling based on sync timestamp
- **Test:** DOM query finds staleness badge elements with appropriate color classes

#### U5: Settings Shows Sync Schedule Info
- **Tag:** AUTO_VERIFY
- **Criterion:** Settings/config section displays sync schedule: "eBay: Daily at 2am", "BrickLink: Daily at 2:30am", "Watchlist: X items", "Full cycle: ~3 days"
- **Evidence:** Info text elements present in settings section
- **Test:** DOM query finds schedule info text

---

### Error Handling

#### E1: Cron Handles API Errors Gracefully
- **Tag:** AUTO_VERIFY
- **Criterion:** If eBay/BrickLink API returns error, cron logs error and continues with next item (no crash)
- **Evidence:** Try-catch around individual item sync; error logged; batch continues
- **Test:** Mock API error for one item; verify other items still processed

#### E2: Cron Records Failed Items
- **Tag:** AUTO_VERIFY
- **Criterion:** Failed sync attempts are tracked with error message for later retry
- **Evidence:** `sync_error` or similar field updated on failure
- **Test:** After API error, verify error recorded in database

#### E3: Rate Limit Handling
- **Tag:** AUTO_VERIFY
- **Criterion:** If rate limit hit, cron stops current batch and returns with partial progress to resume later
- **Evidence:** 429 response triggers early return with current cursor position
- **Test:** Mock 429 response; verify batch stops and cursor saved

#### E4: Empty Watchlist Handled
- **Tag:** AUTO_VERIFY
- **Criterion:** If watchlist is empty, cron returns success without errors
- **Evidence:** Empty watchlist check returns `{ complete: true, processed: 0 }`
- **Test:** Test with empty watchlist returns success

---

### Performance

#### P1: Watchlist Refresh Under 30 Seconds
- **Tag:** AUTO_VERIFY
- **Criterion:** `refreshWatchlist()` completes in under 30 seconds for ~2,500 items
- **Evidence:** Response time < 30000ms
- **Test:** Timed integration test with realistic data volume

#### P2: Batch Sync Processes 1000 Items
- **Tag:** AUTO_VERIFY
- **Criterion:** Cron endpoint can process 1,000 items without timeout (Vercel 60s limit)
- **Evidence:** Batch of 1000 completes within function timeout
- **Test:** Integration test with 1000 items completes under 60s

#### P3: Staleness Query Performant
- **Tag:** AUTO_VERIFY
- **Criterion:** Query for staleness badges on 100 rows completes in under 500ms
- **Evidence:** Index on sync timestamp columns
- **Test:** Explain analyze shows index usage

---

### Integration

#### I1: Uses Existing eBay OAuth
- **Tag:** AUTO_VERIFY
- **Criterion:** eBay batch sync uses existing OAuth token from `platform_credentials`
- **Evidence:** Same token provider used as manual sync
- **Test:** Verify same credential lookup in batch method

#### I2: Uses Existing BrickLink OAuth
- **Tag:** AUTO_VERIFY
- **Criterion:** BrickLink batch sync uses existing OAuth 1.0a from `platform_credentials`
- **Evidence:** Same token provider used as manual sync
- **Test:** Verify same credential lookup in batch method

#### I3: Watchlist Links to Arbitrage Data
- **Tag:** AUTO_VERIFY
- **Criterion:** Watchlist items can be joined to `ebay_pricing` and `bricklink_arbitrage_pricing` via `bricklink_set_number`
- **Evidence:** Foreign key or join condition works
- **Test:** Query joining watchlist to pricing tables returns data

---

## Out of Scope

- Real-time sync (webhooks or immediate updates)
- User-configurable sync schedule (hardcoded to 2am/2:30am)
- Sync frequency per item (all items equal priority)
- Notifications on sync completion (silent background process)
- Manual trigger for individual items (buttons removed entirely)
- Amazon pricing in this feature (already has separate cron)

---

## Dependencies

- Existing eBay OAuth integration functional
- Existing BrickLink OAuth integration functional
- `amazon_arbitrage_pricing` table populated with pricing data
- `seeded_asins` table populated with discovered ASINs
- `brickset_sets` table with `us_date_removed` retirement dates
- GitHub Actions configured for repository

---

## Iteration Budget

- **Max iterations:** 5
- **Escalation:** If not converged after 5 iterations, pause for human review

---

## Database Tables Required

| Table | Purpose |
|-------|---------|
| `arbitrage_watchlist` | Persistent list of ASINs to sync with per-item timestamps |

## Database Changes Required

| Table | Change |
|-------|--------|
| `arbitrage_sync_status` | Add 'ebay_scheduled_pricing' and 'bricklink_scheduled_pricing' to job_type CHECK |

---

## API Endpoints Required

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/cron/ebay-pricing` | POST | Cron endpoint for scheduled eBay sync |
| `/api/cron/bricklink-pricing` | POST | Cron endpoint for scheduled BrickLink sync |

---

## Verification Summary

| ID | Criterion | Tag | Status |
|----|-----------|-----|--------|
| F1 | Watchlist table exists | AUTO_VERIFY | PENDING |
| F2 | Source constraint valid | AUTO_VERIFY | PENDING |
| F3 | Sync status job types updated | AUTO_VERIFY | PENDING |
| F4 | Watchlist service exists | AUTO_VERIFY | PENDING |
| F5 | Refresh includes sold ASINs | AUTO_VERIFY | PENDING |
| F6 | Refresh includes retired with pricing | AUTO_VERIFY | PENDING |
| F7 | Watchlist deduplicates | AUTO_VERIFY | PENDING |
| F8 | Batch query works | AUTO_VERIFY | PENDING |
| F9 | eBay batch sync method exists | AUTO_VERIFY | PENDING |
| F10 | BrickLink batch sync method exists | AUTO_VERIFY | PENDING |
| F11 | Sync updates timestamps | AUTO_VERIFY | PENDING |
| F12 | eBay cron endpoint exists | AUTO_VERIFY | PENDING |
| F13 | BrickLink cron endpoint exists | AUTO_VERIFY | PENDING |
| F14 | Cursor-based resume works | AUTO_VERIFY | PENDING |
| F15 | Cursor resets on cycle complete | AUTO_VERIFY | PENDING |
| F16 | Cron returns complete status | AUTO_VERIFY | PENDING |
| F17 | eBay workflow exists | AUTO_VERIFY | PENDING |
| F18 | BrickLink workflow exists | AUTO_VERIFY | PENDING |
| F19 | Workflows loop until complete | AUTO_VERIFY | PENDING |
| U1 | Sync buttons removed (eBay page) | AUTO_VERIFY | PENDING |
| U2 | Sync buttons removed (Amazon page) | AUTO_VERIFY | PENDING |
| U3 | Last sync timestamp displayed | AUTO_VERIFY | PENDING |
| U4 | Staleness indicator on rows | AUTO_VERIFY | PENDING |
| U5 | Settings shows schedule info | AUTO_VERIFY | PENDING |
| E1 | API errors handled gracefully | AUTO_VERIFY | PENDING |
| E2 | Failed items recorded | AUTO_VERIFY | PENDING |
| E3 | Rate limit handling | AUTO_VERIFY | PENDING |
| E4 | Empty watchlist handled | AUTO_VERIFY | PENDING |
| P1 | Watchlist refresh under 30s | AUTO_VERIFY | PENDING |
| P2 | Batch processes 1000 items | AUTO_VERIFY | PENDING |
| P3 | Staleness query performant | AUTO_VERIFY | PENDING |
| I1 | Uses existing eBay OAuth | AUTO_VERIFY | PENDING |
| I2 | Uses existing BrickLink OAuth | AUTO_VERIFY | PENDING |
| I3 | Watchlist links to pricing data | AUTO_VERIFY | PENDING |

**Total:** 34 criteria (34 AUTO_VERIFY, 0 HUMAN_VERIFY, 0 TOOL_VERIFY)

---

## Handoff

Ready for: `/build-feature scheduled-ebay-bricklink-pricing-sync`

**Key files likely affected:**
- `supabase/migrations/[timestamp]_arbitrage_watchlist.sql` (new)
- `apps/web/src/lib/arbitrage/watchlist.service.ts` (new)
- `apps/web/src/app/api/cron/ebay-pricing/route.ts` (new)
- `apps/web/src/app/api/cron/bricklink-pricing/route.ts` (new)
- `.github/workflows/ebay-pricing-cron.yml` (new)
- `.github/workflows/bricklink-pricing-cron.yml` (new)
- `apps/web/src/lib/arbitrage/ebay-sync.service.ts` (modify - add batch method)
- `apps/web/src/lib/arbitrage/bricklink-sync.service.ts` (modify - add batch method)
- `apps/web/src/app/(dashboard)/arbitrage/ebay/page.tsx` (modify - remove buttons, add staleness)
- `apps/web/src/app/(dashboard)/arbitrage/amazon/page.tsx` (modify - remove buttons, add staleness)
