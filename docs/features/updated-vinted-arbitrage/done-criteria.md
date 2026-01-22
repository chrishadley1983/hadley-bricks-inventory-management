# Done Criteria: Updated Vinted Arbitrage

**Created:** 2026-01-21
**Author:** Define Done Agent + Chris
**Status:** APPROVED

## Feature Summary

Replace the manual Vinted arbitrage scanning feature with a fully automated system using Claude Code + Chrome extension. The system continuously scans Vinted for mispriced LEGO sets using two modes (broad sweep and watchlist), calculates profitability against Amazon prices, and delivers push notifications for buying opportunities. Includes comprehensive safety controls (CAPTCHA detection, randomised timing, pause/resume), watchlist effectiveness tracking, and full operational visibility via dashboard UI. The existing manual scan feature is deprecated and removed.

## Scope Boundaries

### In Scope
- Automated scanning via Claude Code + Chrome extension
- Broad sweep mode (hourly, generic LEGO search)
- Watchlist mode (200 tracked sets, continuous throughout day)
- Watchlist composition from best sellers + popular retired sets
- Sales rank collection capability (SP-API bootstrap)
- Watchlist effectiveness tracking and health UI
- Push notifications via Pushover (opportunities, CAPTCHA warnings, daily summary)
- Full automation dashboard UI with status, opportunities, schedule, history
- Scanner configuration and settings
- CAPTCHA detection and automatic pause
- Randomised timing for all operations
- Deprecation of existing manual Vinted arbitrage feature
- Reusable logic extraction (set number extraction, ASIN matching, COG% calculation)

### Out of Scope
- Automated purchasing (user acts manually)
- Multi-account scanning
- Other platforms beyond Vinted
- Full execution of 3-day sales rank bootstrap (only capability verification)
- High-frequency scanning that risks detection

## Iteration Budget
- **Max iterations:** 8
- **Escalation:** If not converged after 8 iterations, pause for human review

---

## Phase 0: Deprecation Prep

### DP1: Set Number Extraction Utility Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** A shared utility function `extractSetNumber(title: string): string | null` exists in a shared location
- **Evidence:** File exists at `apps/web/src/lib/utils/set-number-extraction.ts` or similar shared path
- **Test:** `Grep for "export function extractSetNumber" in apps/web/src/lib/`

### DP2: Set Number Extraction Has Unit Tests
- **Tag:** AUTO_VERIFY
- **Criterion:** Unit tests exist for set number extraction covering patterns: 4-5 digit, "Set" prefix, "LEGO" prefix, hash prefix, and exclusions (compatible, moc, custom, block tech)
- **Evidence:** Test file exists with at least 8 test cases
- **Test:** `Grep for "extractSetNumber" in tests/ directory, verify test count`

### DP3: ASIN Matching Utility Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** A shared utility or service for matching set numbers to ASINs via `seeded_asins` table exists
- **Evidence:** Function/method exists that takes set numbers and returns ASIN mappings
- **Test:** `Grep for "setToAsin" or "matchSetToAsin" or similar in lib/`

### DP4: COG% Calculation Utility Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** A shared utility function for calculating COG%, profit, and ROI exists with Amazon fee constants
- **Evidence:** File contains `AMAZON_FEE_RATE = 0.1836` or equivalent and calculation functions
- **Test:** `Grep for "0.1836" or "cogPercent" calculation in shared utility`

### DP5: Set Number Converts To Brickset Format
- **Tag:** AUTO_VERIFY
- **Criterion:** Utility converts raw set number to Brickset format by appending "-1" suffix when needed
- **Evidence:** Function handles "75192" → "75192-1" conversion for database lookups
- **Test:** Unit test for format conversion or `Grep for "-1" append logic in ASIN matching`

---

## Phase 1: Infrastructure - Database Tables

### DB1: vinted_scanner_config Table Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Table `vinted_scanner_config` exists with columns: id, user_id, enabled, paused, pause_reason, broad_sweep_cog_threshold, watchlist_cog_threshold, near_miss_threshold, operating_hours_start, operating_hours_end, created_at, updated_at
- **Evidence:** Migration file exists and table queryable
- **Test:** `SELECT column_name FROM information_schema.columns WHERE table_name = 'vinted_scanner_config'` returns all columns

### DB2: vinted_watchlist Table Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Table `vinted_watchlist` exists with columns: id, user_id, set_number, asin, source (enum: best_seller, popular_retired), sales_rank, created_at, updated_at
- **Evidence:** Migration file exists and table queryable
- **Test:** `SELECT column_name FROM information_schema.columns WHERE table_name = 'vinted_watchlist'` returns all columns

### DB3: vinted_watchlist_stats Table Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Table `vinted_watchlist_stats` exists with columns: id, user_id, set_number, total_scans, listings_found, viable_found, near_miss_found, last_listing_at, last_viable_at, first_scanned_at, updated_at
- **Evidence:** Migration file exists and table queryable
- **Test:** `SELECT column_name FROM information_schema.columns WHERE table_name = 'vinted_watchlist_stats'` returns all columns

### DB4: vinted_watchlist_exclusions Table Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Table `vinted_watchlist_exclusions` exists with columns: id, user_id, set_number, reason, excluded_at
- **Evidence:** Migration file exists and table queryable
- **Test:** `SELECT column_name FROM information_schema.columns WHERE table_name = 'vinted_watchlist_exclusions'` returns all columns

### DB5: seeded_asin_rankings Table Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Table `seeded_asin_rankings` exists with columns: id, seeded_asin_id, asin, sales_rank, fetched_at
- **Evidence:** Migration file exists and table queryable
- **Test:** `SELECT column_name FROM information_schema.columns WHERE table_name = 'seeded_asin_rankings'` returns all columns

### DB6: vinted_scan_log Table Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Table `vinted_scan_log` exists with columns: id, user_id, scan_type (enum: broad_sweep, watchlist), set_number, started_at, completed_at, status (enum: success, failed, partial, captcha), listings_found, opportunities_found, error_message, timing_delay_ms
- **Evidence:** Migration file exists and table queryable
- **Test:** `SELECT column_name FROM information_schema.columns WHERE table_name = 'vinted_scan_log'` returns all columns

### DB7: vinted_opportunities Table Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Table `vinted_opportunities` exists with columns: id, user_id, scan_log_id, vinted_listing_id, vinted_url, set_number, set_name, vinted_price, amazon_price, cog_percent, estimated_profit, is_viable, status (enum: active, purchased, expired, dismissed), listed_at, found_at, expires_at
- **Evidence:** Migration file exists and table queryable
- **Test:** `SELECT column_name FROM information_schema.columns WHERE table_name = 'vinted_opportunities'` returns all columns

### DB8: All Tables Have RLS Policies
- **Tag:** AUTO_VERIFY
- **Criterion:** All 8 new tables have Row Level Security enabled with user_id-based policies
- **Evidence:** RLS policies exist for each table
- **Test:** `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname LIKE 'vinted_%' AND c.relrowsecurity = true` returns all vinted tables

### DB9: Foreign Key Indexes Exist
- **Tag:** AUTO_VERIFY
- **Criterion:** Indexes exist on user_id columns and foreign keys (scan_log_id, seeded_asin_id)
- **Evidence:** Index definitions in migration
- **Test:** Query `pg_indexes` for relevant index names

### DB10: vinted_dom_selectors Table Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Table `vinted_dom_selectors` exists with columns: id, selector_name, selector_value, version, active, created_at for maintainable CSS selectors
- **Evidence:** Migration file exists and table queryable
- **Test:** `SELECT column_name FROM information_schema.columns WHERE table_name = 'vinted_dom_selectors'` returns all columns

---

## Phase 1: Infrastructure - Sales Rank Collection

### SR1: Sales Rank API Endpoint Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** API endpoint `POST /api/admin/sales-rank/bootstrap` exists for triggering sales rank collection
- **Evidence:** Route file exists at `apps/web/src/app/api/admin/sales-rank/bootstrap/route.ts`
- **Test:** File exists check

### SR2: Sales Rank Bootstrap Fetches From SP-API
- **Tag:** AUTO_VERIFY
- **Criterion:** Bootstrap endpoint calls Amazon SP-API Pricing endpoint to fetch sales ranks
- **Evidence:** Code imports and uses AmazonPricingClient or similar
- **Test:** `Grep for "getCompetitivePricing" or "salesRank" in bootstrap route`

### SR3: Sales Rank Bootstrap Batches Requests
- **Tag:** AUTO_VERIFY
- **Criterion:** Bootstrap batches ASINs into groups of 20 (SP-API limit)
- **Evidence:** Code contains batch size of 20 and loop logic
- **Test:** `Grep for "20" or "batchSize" in bootstrap route`

### SR4: Sales Rank Bootstrap Stores Results
- **Tag:** AUTO_VERIFY
- **Criterion:** Bootstrap inserts results into `seeded_asin_rankings` table
- **Evidence:** Supabase insert to seeded_asin_rankings
- **Test:** `Grep for "seeded_asin_rankings" in bootstrap route`

### SR5: Sales Rank Bootstrap Handles Rate Limits
- **Tag:** AUTO_VERIFY
- **Criterion:** Bootstrap includes delay between batches to respect rate limits
- **Evidence:** Code contains delay/sleep between batch calls
- **Test:** `Grep for "delay" or "setTimeout" or "sleep" in bootstrap route`

### SR6: Sales Rank Bootstrap Can Run Partial
- **Tag:** AUTO_VERIFY
- **Criterion:** Bootstrap accepts parameters to limit scope (e.g., batch count, offset) for testing
- **Evidence:** Request body schema includes limit/offset parameters
- **Test:** `Grep for "limit" or "offset" or "batchCount" in bootstrap route`

---

## Phase 1: Infrastructure - Watchlist Materialisation

### WL1: Watchlist Refresh API Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** API endpoint `POST /api/arbitrage/vinted/watchlist/refresh` exists
- **Evidence:** Route file exists
- **Test:** File exists at `apps/web/src/app/api/arbitrage/vinted/watchlist/refresh/route.ts`

### WL2: Watchlist Includes Top 100 Best Sellers
- **Tag:** AUTO_VERIFY
- **Criterion:** Watchlist refresh queries platform_orders for top 100 ASINs by units sold (last 13 months)
- **Evidence:** SQL query includes ORDER BY COUNT(*) DESC LIMIT 100 from platform_orders
- **Test:** `Grep for "platform_orders" and "LIMIT 100" in watchlist refresh`

### WL3: Watchlist Includes Top 100 Popular Retired
- **Tag:** AUTO_VERIFY
- **Criterion:** Watchlist refresh queries seeded_asin_rankings for top 100 retired sets by sales rank, excluding best sellers
- **Evidence:** SQL query joins seeded_asin_rankings, filters retired sets, excludes best sellers
- **Test:** `Grep for "seeded_asin_rankings" and "exit_date" in watchlist refresh`

### WL4: Watchlist Excludes Manually Excluded Sets
- **Tag:** AUTO_VERIFY
- **Criterion:** Watchlist refresh filters out sets in vinted_watchlist_exclusions
- **Evidence:** Query includes NOT IN or LEFT JOIN exclusion logic
- **Test:** `Grep for "vinted_watchlist_exclusions" in watchlist refresh`

### WL5: Watchlist Stores 200 Sets Maximum
- **Tag:** AUTO_VERIFY
- **Criterion:** Watchlist materialisation produces exactly 200 sets (100 best sellers + 100 popular retired, deduplicated)
- **Evidence:** Logic combines both sources and limits to 200
- **Test:** `Grep for "200" in watchlist refresh logic`

### WL6: Watchlist Stores Source Attribution
- **Tag:** AUTO_VERIFY
- **Criterion:** Each watchlist entry has source field set to 'best_seller' or 'popular_retired'
- **Evidence:** Insert includes source enum value
- **Test:** `Grep for "best_seller" and "popular_retired" in watchlist refresh`

---

## Phase 2: Scanner Core - Broad Sweep

### BS1: Broad Sweep Claude Prompt Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Claude Code prompt file for broad sweep exists with scanning instructions
- **Evidence:** File exists at documented location (e.g., `scripts/vinted-scanner/broad-sweep.md` or similar)
- **Test:** File exists and contains "broad sweep" or "broad_sweep"

### BS2: Broad Sweep Prompt Uses Correct Search URL
- **Tag:** AUTO_VERIFY
- **Criterion:** Prompt instructs navigation to generic LEGO search with "New with tags" filter, sorted by newest
- **Evidence:** Prompt contains `status_ids[]=6` and `order=newest_first`
- **Test:** `Grep for "status_ids" and "newest_first" in prompt file`

### BS3: Broad Sweep Prompt Extracts Listing Data
- **Tag:** AUTO_VERIFY
- **Criterion:** Prompt instructs DOM parsing to extract: title, price, listing URL
- **Evidence:** Prompt contains `document.querySelectorAll` or extraction instructions
- **Test:** `Grep for "querySelectorAll" or "extract" in prompt file`

### BS4: Broad Sweep Prompt Varies Page Count
- **Tag:** AUTO_VERIFY
- **Criterion:** Prompt instructs scanning 1-3 pages with randomisation
- **Evidence:** Prompt mentions page variation or random page count
- **Test:** `Grep for "1-3" or "random" and "page" in prompt file`

### BS5: Broad Sweep Prompt Includes Dwell Time
- **Tag:** AUTO_VERIFY
- **Criterion:** Prompt instructs waiting 3-10 seconds on page before extraction
- **Evidence:** Prompt mentions dwell time or wait before extraction
- **Test:** `Grep for "dwell" or "wait" or "3-10" in prompt file`

### BS6: Broad Sweep Results Processing API Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** API endpoint `POST /api/arbitrage/vinted/automation/process` exists to receive scan results
- **Evidence:** Route file exists
- **Test:** File exists at `apps/web/src/app/api/arbitrage/vinted/automation/process/route.ts`

### BS7: Broad Sweep Processing Calculates COG%
- **Tag:** AUTO_VERIFY
- **Criterion:** Processing endpoint calculates COG%, profit, ROI using shared utility
- **Evidence:** Code imports and uses shared calculation utility
- **Test:** `Grep for "cogPercent" or "calculateProfit" in process route`

### BS8: Broad Sweep Processing Stores Opportunities
- **Tag:** AUTO_VERIFY
- **Criterion:** Processing endpoint inserts viable opportunities into vinted_opportunities table
- **Evidence:** Supabase insert to vinted_opportunities
- **Test:** `Grep for "vinted_opportunities" in process route`

### BS9: Broad Sweep Processing Logs Scan
- **Tag:** AUTO_VERIFY
- **Criterion:** Processing endpoint creates entry in vinted_scan_log with type='broad_sweep'
- **Evidence:** Supabase insert to vinted_scan_log with scan_type
- **Test:** `Grep for "vinted_scan_log" and "broad_sweep" in process route`

### BS10: Amazon Price Has RRP Fallback
- **Tag:** AUTO_VERIFY
- **Criterion:** If Buy Box price unavailable, system falls back to UK RRP from brickset_sets
- **Evidence:** Code checks for Buy Box first, then uses uk_retail_price if null
- **Test:** `Grep for "rrp" or "uk_retail_price" or "fallback" in price fetching logic`

### BS11: Duplicate Listings Are Deduplicated
- **Tag:** AUTO_VERIFY
- **Criterion:** Same vinted_listing_id is not inserted twice into vinted_opportunities
- **Evidence:** Upsert logic or unique constraint on (user_id, vinted_listing_id)
- **Test:** `Grep for "ON CONFLICT" or unique constraint on vinted_listing_id in opportunities insert`

### BS12: Vinted Listed Time Is Extracted
- **Tag:** AUTO_VERIFY
- **Criterion:** Scan extracts when Vinted listing was created (for visual aging calculation)
- **Evidence:** DOM parsing extracts listing age/date; stored in listed_at column
- **Test:** `Grep for "listed" or "created" or "posted" time extraction in parser`

---

## Phase 2: Scanner Core - Watchlist Scan

### WS1: Watchlist Scan Claude Prompt Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Claude Code prompt file for watchlist scan exists with set-specific instructions
- **Evidence:** File exists at documented location
- **Test:** File exists and contains "watchlist" in name or content

### WS2: Watchlist Prompt Accepts Set Number Parameter
- **Tag:** AUTO_VERIFY
- **Criterion:** Prompt is parameterised to accept a specific set number to search
- **Evidence:** Prompt contains placeholder or parameter syntax for set number
- **Test:** `Grep for "{set_number}" or "$SET_NUMBER" or similar in prompt`

### WS3: Watchlist Prompt Constructs Set-Specific Search
- **Tag:** AUTO_VERIFY
- **Criterion:** Prompt instructs searching for "LEGO {set_number}" on Vinted
- **Evidence:** Prompt constructs search URL with set number
- **Test:** `Grep for "LEGO" and "search_text" in prompt`

### WS4: Watchlist Scan Processing Updates Stats
- **Tag:** AUTO_VERIFY
- **Criterion:** Processing endpoint updates vinted_watchlist_stats for the scanned set
- **Evidence:** Supabase upsert to vinted_watchlist_stats
- **Test:** `Grep for "vinted_watchlist_stats" in process route`

### WS5: Watchlist Scan Logs Include Set Number
- **Tag:** AUTO_VERIFY
- **Criterion:** Scan log entries for watchlist scans include the set_number field
- **Evidence:** Insert includes set_number for watchlist scan type
- **Test:** `Grep for "set_number" in scan log insert for watchlist type`

---

## Phase 2: Scanner Core - CAPTCHA Detection

### CD1: CAPTCHA Detection Function Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** A function `detectCaptcha` or equivalent exists in scanner code
- **Evidence:** Function defined that checks for CAPTCHA indicators
- **Test:** `Grep for "detectCaptcha" or "captcha" detection in scanner files`

### CD2: CAPTCHA Detection Checks URL
- **Tag:** AUTO_VERIFY
- **Criterion:** Detection checks if page URL contains "captcha" or "captcha-delivery"
- **Evidence:** Code checks `url.includes('captcha')`
- **Test:** `Grep for "captcha-delivery" or "url.*captcha" in detection code`

### CD3: CAPTCHA Detection Checks DOM
- **Tag:** AUTO_VERIFY
- **Criterion:** Detection checks for CAPTCHA iframe or DataDome elements
- **Evidence:** Code queries for `iframe[src*="captcha"]` or `[class*="datadome"]`
- **Test:** `Grep for "datadome" or 'iframe.*captcha' in detection code`

### CD4: CAPTCHA Detection Checks Title
- **Tag:** AUTO_VERIFY
- **Criterion:** Detection checks if page title contains "blocked" or "captcha"
- **Evidence:** Code checks `document.title.toLowerCase().includes`
- **Test:** `Grep for "title" and "blocked" in detection code`

### CD5: CAPTCHA Triggers Automatic Pause
- **Tag:** AUTO_VERIFY
- **Criterion:** When CAPTCHA detected, scanner automatically sets config.paused=true with reason
- **Evidence:** Code updates vinted_scanner_config on CAPTCHA
- **Test:** `Grep for "paused" and "captcha" in same function/block`

### CD6: CAPTCHA Logs With Special Status
- **Tag:** AUTO_VERIFY
- **Criterion:** CAPTCHA detection creates scan log entry with status='captcha'
- **Evidence:** Insert to vinted_scan_log with status enum value
- **Test:** `Grep for "status.*captcha" in scan log insert`

---

## Phase 2: Scanner Core - Scheduling

### SC1: Cron Script Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Cron/scheduler script exists for triggering scans
- **Evidence:** Script file exists (bash, PowerShell, or Node)
- **Test:** File exists at `scripts/vinted-scanner/` or similar

### SC2: Cron Script Has Random Delay
- **Tag:** AUTO_VERIFY
- **Criterion:** Script includes random delay before execution (0-30 minutes for broad sweep)
- **Evidence:** Script contains RANDOM or Math.random delay logic
- **Test:** `Grep for "RANDOM" or "random" and "delay" or "sleep" in script`

### SC3: Cron Script Checks Operating Hours
- **Tag:** AUTO_VERIFY
- **Criterion:** Script checks current hour is within operating hours (default 08:00-22:00)
- **Evidence:** Script contains hour check and exit if outside range
- **Test:** `Grep for "08" or "22" or "operating" in script`

### SC4: Cron Script Calls Claude Code
- **Tag:** AUTO_VERIFY
- **Criterion:** Script invokes Claude Code with --chrome flag
- **Evidence:** Script contains `claude --chrome` or equivalent
- **Test:** `Grep for "claude" and "--chrome" in script`

### SC5: Cron Script Posts Results to API
- **Tag:** AUTO_VERIFY
- **Criterion:** Script sends scan results to processing API endpoint
- **Evidence:** Script contains curl or fetch to /api/arbitrage/vinted/automation/process
- **Test:** `Grep for "/automation/process" in script`

### SC6: Watchlist Scheduling Has Variable Gaps
- **Tag:** AUTO_VERIFY
- **Criterion:** Watchlist scanning uses 2-8 minute gaps with randomisation
- **Evidence:** Code/config contains 2-8 minute or 120000-480000ms range
- **Test:** `Grep for "2-8" or "120000" in scheduling logic`

### SC7: Watchlist Order Is Shuffled Daily
- **Tag:** AUTO_VERIFY
- **Criterion:** Watchlist processing order is randomised/shuffled each day
- **Evidence:** Code contains shuffle logic or random ordering
- **Test:** `Grep for "shuffle" or "randomize" in watchlist scheduling`

### SC8: Scheduler Checks Paused State
- **Tag:** AUTO_VERIFY
- **Criterion:** Scheduler skips execution if config.paused = true
- **Evidence:** Query checks paused flag before executing any scan
- **Test:** `Grep for "paused" check in scheduler before scan execution`

---

## Phase 3: Alerts - Pushover Integration

### AL1: sendVintedOpportunity Method Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Pushover service has method `sendVintedOpportunity` for opportunity alerts
- **Evidence:** Method exists in pushover.service.ts
- **Test:** `Grep for "sendVintedOpportunity" in pushover service`

### AL2: Opportunity Alert Contains Required Fields
- **Tag:** AUTO_VERIFY
- **Criterion:** Opportunity alert includes: set number, set name, Vinted price, Amazon price, COG%, estimated profit, Vinted URL
- **Evidence:** Method parameters or message template includes all fields
- **Test:** `Grep for "setNumber" and "vintedPrice" and "cogPercent" in sendVintedOpportunity`

### AL3: Excellent Opportunities Have High Priority
- **Tag:** AUTO_VERIFY
- **Criterion:** Opportunities with COG% < 30% use Pushover priority=1 (high)
- **Evidence:** Code checks COG threshold and sets priority
- **Test:** `Grep for "priority" and "30" or "excellent" in opportunity alert`

### AL4: sendVintedCaptchaWarning Method Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Pushover service has method `sendVintedCaptchaWarning` for CAPTCHA alerts
- **Evidence:** Method exists in pushover.service.ts
- **Test:** `Grep for "sendVintedCaptchaWarning" or "Captcha" in pushover service`

### AL5: CAPTCHA Alert Uses High Priority
- **Tag:** AUTO_VERIFY
- **Criterion:** CAPTCHA warning uses Pushover priority=1 (high priority)
- **Evidence:** Method sets priority=1
- **Test:** `Grep for "priority.*1" in CAPTCHA warning method`

### AL6: Daily Summary Method Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Pushover service has method for daily scanner summary
- **Evidence:** Method like `sendVintedDailySummary` exists
- **Test:** `Grep for "DailySummary" or "daily.*summary" in pushover service`

### AL7: Daily Summary Includes Stats
- **Tag:** AUTO_VERIFY
- **Criterion:** Daily summary includes: broad sweep count, watchlist scan count, opportunities found, near misses
- **Evidence:** Method parameters or message includes all stats
- **Test:** `Grep for "broadSweep" and "opportunities" in daily summary method`

### AL8: Consecutive Failure Alert Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Alert triggers after 3 consecutive scan failures
- **Evidence:** Code tracks consecutive failures and triggers alert at threshold
- **Test:** `Grep for "consecutive" and "3" or "failure" in scanner code`

### AL9: Pushover Gracefully Degrades If Not Configured
- **Tag:** AUTO_VERIFY
- **Criterion:** Pushover methods return success without error if PUSHOVER_USER_KEY or PUSHOVER_API_TOKEN not set
- **Evidence:** Code checks for missing env vars and returns early without throwing
- **Test:** `Grep for "PUSHOVER_USER_KEY" or "PUSHOVER_API_TOKEN" check with early return in pushover service`

---

## Phase 4: UI - Scanner Status Card

### UI1: Automation Page Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Page exists at `/arbitrage/vinted/automation`
- **Evidence:** Page file exists
- **Test:** File exists at `apps/web/src/app/(dashboard)/arbitrage/vinted/automation/page.tsx`

### UI2: Scanner Status Card Shows Running State
- **Tag:** AUTO_VERIFY
- **Criterion:** Status card displays "Running" with green indicator when enabled and not paused
- **Evidence:** Component renders status with conditional styling
- **Test:** `Grep for "Running" and "green" or "enabled" in automation page`

### UI3: Scanner Status Card Shows Paused State
- **Tag:** AUTO_VERIFY
- **Criterion:** Status card displays "Paused" with pause reason when paused
- **Evidence:** Component shows pause_reason from config
- **Test:** `Grep for "Paused" and "pause_reason" or "pauseReason" in automation page`

### UI4: Scanner Status Card Shows Last Scan Time
- **Tag:** AUTO_VERIFY
- **Criterion:** Status card displays time since last scan (e.g., "3 minutes ago")
- **Evidence:** Component formats and displays last scan timestamp
- **Test:** `Grep for "last.*scan" or "ago" in automation page`

### UI5: Scanner Status Card Shows Next Scan
- **Tag:** AUTO_VERIFY
- **Criterion:** Status card displays upcoming scan info (type and time)
- **Evidence:** Component displays next scheduled scan
- **Test:** `Grep for "next.*scan" or "upcoming" in automation page`

### UI6: Scanner Status Card Shows Today Stats
- **Tag:** AUTO_VERIFY
- **Criterion:** Status card displays today's counts: broad sweeps, watchlist scans, opportunities
- **Evidence:** Component displays daily counters
- **Test:** `Grep for "today" or "Today" in automation page with count display`

### UI7: Pause Button Exists and Works
- **Tag:** AUTO_VERIFY
- **Criterion:** Pause button exists that sets config.paused=true
- **Evidence:** Button with onClick that calls pause API
- **Test:** `Grep for "Pause" button and "paused" API call`

### UI8: Resume Button Exists With Confirmation
- **Tag:** AUTO_VERIFY
- **Criterion:** Resume button exists with confirmation dialog (especially after CAPTCHA)
- **Evidence:** Resume button with confirmation modal
- **Test:** `Grep for "Resume" and "confirm" in automation page`

### UI9: Scan Now Button Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Manual "Scan Now" button triggers immediate broad sweep
- **Evidence:** Button that calls scan trigger API
- **Test:** `Grep for "Scan Now" in automation page`

---

## Phase 4: UI - Opportunities Table

### UI10: Opportunities Table Displays Viable Items
- **Tag:** AUTO_VERIFY
- **Criterion:** Table shows opportunities where is_viable=true with columns: Set, Vinted, Amazon, COG%, Profit, Listed, Actions
- **Evidence:** Table component with specified columns
- **Test:** `Grep for "Opportunities" and "TableHeader" or column names in page`

### UI11: Opportunities Have Vinted Link
- **Tag:** AUTO_VERIFY
- **Criterion:** Each opportunity row has clickable link to Vinted listing (vinted_url)
- **Evidence:** ExternalLink icon with href to vinted_url
- **Test:** `Grep for "vinted_url" or "vintedUrl" and "ExternalLink" in opportunities table`

### UI12: Opportunities Have Amazon Link
- **Tag:** AUTO_VERIFY
- **Criterion:** Each opportunity row has clickable link to Amazon product (using ASIN)
- **Evidence:** Link to amazon.co.uk/dp/{asin}
- **Test:** `Grep for "amazon.co.uk/dp" in opportunities table`

### UI13: COG% Badge Is Color Coded
- **Tag:** AUTO_VERIFY
- **Criterion:** COG% displays as badge with colors: <30% green-600, 30-40% green-500, 40-50% yellow-500, 50-60% orange-500, >60% red-500
- **Evidence:** Badge component with conditional color classes
- **Test:** `Grep for "green-600" and "cogPercent" or COG badge logic`

### UI14: Listed Time Has Visual Aging
- **Tag:** AUTO_VERIFY
- **Criterion:** Listed time badge color changes: <4h green, 4-12h yellow, 12-24h orange, >24h red
- **Evidence:** Time badge with age-based color logic
- **Test:** `Grep for "4.*hour" or age-based color logic in table`

### UI15: Dismiss Action Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Dismiss button/action sets opportunity status='dismissed'
- **Evidence:** Button that calls dismiss API
- **Test:** `Grep for "Dismiss" or "dismissed" action in opportunities`

### UI16: Mark Purchased Action Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Mark Purchased button/action sets opportunity status='purchased'
- **Evidence:** Button that calls purchased API
- **Test:** `Grep for "Purchased" or "purchased" action in opportunities`

### UI17: Your Data Hover Popup Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Hovering "Your Data" column shows popup with: units sold (13mo), avg sell price, last sale, current stock (listed/backlog), avg days in stock
- **Evidence:** Tooltip or Popover component with sales/stock data
- **Test:** `Grep for "units sold" or "Popover" or "Tooltip" with sales data`

---

## Phase 4: UI - Near Misses Table

### UI18: Near Misses Table Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Separate table shows opportunities where COG% > threshold AND COG% <= near_miss_threshold
- **Evidence:** Second table filtered by near-miss range
- **Test:** `Grep for "Near Miss" or "nearMiss" table in page`

### UI19: Near Misses Have Same Columns
- **Tag:** AUTO_VERIFY
- **Criterion:** Near misses table has same columns as opportunities table
- **Evidence:** Same column structure reused
- **Test:** Visual comparison or shared column definition

---

## Phase 4: UI - Schedule View

### UI20: Schedule View Shows Upcoming Scans
- **Tag:** AUTO_VERIFY
- **Criterion:** Schedule section displays list of upcoming scans with time and type/set
- **Evidence:** List component showing scheduled scans
- **Test:** `Grep for "Upcoming" or "Schedule" with scan list`

### UI21: View Full Schedule Link Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Link to view complete schedule exists
- **Evidence:** Link or button to expanded schedule view
- **Test:** `Grep for "Full Schedule" or "View Schedule" link`

---

## Phase 4: UI - Scan History Table

### UI22: Scan History Table Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Table displays scan history with columns: Time, Type, Set, Result, Delay, Status
- **Evidence:** Table component for vinted_scan_log data
- **Test:** `Grep for "History" or "scan_log" table in page`

### UI23: Scan History Shows Success/Failed/CAPTCHA Status
- **Tag:** AUTO_VERIFY
- **Criterion:** Status column shows icons: ✓ Success, ✗ Failed, ⚠️ CAPTCHA
- **Evidence:** Conditional status icons
- **Test:** `Grep for "Success" or "Failed" or "captcha" status display`

### UI24: Scan History Shows Timing Delay
- **Tag:** AUTO_VERIFY
- **Criterion:** Delay column shows actual timing delay used (for audit)
- **Evidence:** Display of timing_delay_ms from scan log
- **Test:** `Grep for "delay" or "timing" column in history`

---

## Phase 4: UI - Settings Panel

### UI25: Settings Panel Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Settings section with form for scanner configuration
- **Evidence:** Form component for vinted_scanner_config
- **Test:** `Grep for "Settings" form or "scanner.*config" in page`

### UI26: Scanner Enable Toggle Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Toggle switch for enabling/disabling scanner
- **Evidence:** Switch/Toggle component bound to enabled field
- **Test:** `Grep for "enabled" toggle or switch`

### UI27: COG% Threshold Inputs Exist
- **Tag:** AUTO_VERIFY
- **Criterion:** Number inputs for broad sweep and watchlist COG% thresholds
- **Evidence:** Two threshold input fields
- **Test:** `Grep for "broad_sweep_cog" and "watchlist_cog" inputs`

### UI28: Near Miss Threshold Input Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Number input for near-miss threshold
- **Evidence:** Input field for near_miss_threshold
- **Test:** `Grep for "near_miss" input`

### UI29: Operating Hours Inputs Exist
- **Tag:** AUTO_VERIFY
- **Criterion:** Time inputs for operating hours start and end
- **Evidence:** Time input fields for operating hours
- **Test:** `Grep for "operating_hours" or time picker inputs`

### UI30: Save Settings Button Works
- **Tag:** AUTO_VERIFY
- **Criterion:** Save button persists settings to vinted_scanner_config
- **Evidence:** Save button with API call
- **Test:** `Grep for "Save" button and config update API`

### UI31: Default Thresholds Are Correct
- **Tag:** AUTO_VERIFY
- **Criterion:** Default values: broad_sweep_cog_threshold=40, watchlist_cog_threshold=40, near_miss_threshold=50
- **Evidence:** Migration DEFAULT values or config constants match requirements
- **Test:** `Grep for "DEFAULT 40" and "DEFAULT 50" in migration or "defaultValue.*40" in schema`

---

## Phase 4: UI - Watchlist Health Page

### UI31: Watchlist Health Page Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Page exists at `/arbitrage/vinted/automation/watchlist`
- **Evidence:** Page file exists
- **Test:** File exists at `apps/web/src/app/(dashboard)/arbitrage/vinted/automation/watchlist/page.tsx`

### UI32: Watchlist Health Summary Bar Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Summary shows: total sets, Active count, Low Yield count, Stale count
- **Evidence:** Summary bar with flag counts
- **Test:** `Grep for "Active" and "Low Yield" and "Stale" in watchlist page`

### UI33: Watchlist Health Table Shows Columns
- **Tag:** AUTO_VERIFY
- **Criterion:** Table shows: Set, Name, Source, Scans, Found, Viable, Last Seen, Flag
- **Evidence:** Table with specified columns
- **Test:** `Grep for column headers in watchlist health table`

### UI34: Watchlist Flags Display Correctly
- **Tag:** AUTO_VERIFY
- **Criterion:** Flags display as: ⚠️ Stale (no listings 30 days), 🔶 Low Yield (no viable 30 days), ✅ Active (viable in 7 days)
- **Evidence:** Flag logic and emoji display
- **Test:** `Grep for "Stale" and "Low Yield" and "Active" with emoji`

### UI35: Filter By Flag Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Filter controls to show only Stale, Low Yield, or Active sets
- **Evidence:** Filter dropdown or buttons
- **Test:** `Grep for filter by flag functionality`

### UI36: Remove Set Action Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Remove button adds set to exclusions table and removes from watchlist
- **Evidence:** Remove action that updates exclusions
- **Test:** `Grep for "Remove" and "exclusion" in watchlist page`

### UI37: Bulk Remove Stale Action Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** "Bulk Remove Stale" button removes all ⚠️ flagged sets
- **Evidence:** Bulk action for stale sets
- **Test:** `Grep for "Bulk Remove" or "Remove.*Stale" button`

### UI38: Refresh Watchlist Button Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Refresh button triggers watchlist materialisation
- **Evidence:** Button calling /watchlist/refresh API
- **Test:** `Grep for "Refresh" and "watchlist" in page`

### UI39: Export CSV Button Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Export button downloads watchlist stats as CSV
- **Evidence:** Export button with CSV download
- **Test:** `Grep for "Export" and "CSV" in watchlist page`

---

## Phase 4: UI - Navigation

### UI40: Automation Tab In Navigation
- **Tag:** AUTO_VERIFY
- **Criterion:** Navigation to automation page exists from Arbitrage section
- **Evidence:** Nav link in sidebar or tabs
- **Test:** `Grep for "/arbitrage/vinted/automation" in navigation`

### UI41: Watchlist Tab In Navigation
- **Tag:** AUTO_VERIFY
- **Criterion:** Navigation to watchlist health page exists
- **Evidence:** Nav link or tab to watchlist page
- **Test:** `Grep for "/automation/watchlist" in navigation`

---

## Phase 5: Polish - Error Handling

### EH1: API Endpoints Return Proper Error Responses
- **Tag:** AUTO_VERIFY
- **Criterion:** All new API endpoints return structured error JSON with status codes
- **Evidence:** NextResponse.json with error and status
- **Test:** `Grep for "NextResponse.json.*error" in all vinted automation routes`

### EH2: UI Shows Error States
- **Tag:** AUTO_VERIFY
- **Criterion:** Error states display with AlertCircle icon and message
- **Evidence:** Error state rendering in components
- **Test:** `Grep for "AlertCircle" or error display in automation pages`

### EH3: Retry Logic For Transient Failures
- **Tag:** AUTO_VERIFY
- **Criterion:** Scan processing has retry logic for transient failures
- **Evidence:** Retry loop or exponential backoff in processing
- **Test:** `Grep for "retry" or exponential backoff in processing code`

### EH4: Health Monitoring Tracks Consecutive Failures
- **Tag:** AUTO_VERIFY
- **Criterion:** System tracks consecutive failures in config or separate table
- **Evidence:** consecutiveFailures field or tracking logic
- **Test:** `Grep for "consecutive" or failure counter in code`

---

## Phase 5: Polish - Data Lifecycle

### DL1: Opportunities Expire After 7 Days
- **Tag:** AUTO_VERIFY
- **Criterion:** Opportunities auto-expire: set status='expired' after 7 days from found_at
- **Evidence:** Scheduled job or trigger that expires old opportunities
- **Test:** `Grep for "expires_at" or "7 days" expiration logic`

### DL2: Expired Opportunities Cleaned Up
- **Tag:** AUTO_VERIFY
- **Criterion:** Expired opportunities deleted after additional 7 days
- **Evidence:** Cleanup job that deletes old expired records
- **Test:** `Grep for DELETE and "expired" in cleanup logic`

### DL3: Purchased/Dismissed Kept 30 Days
- **Tag:** AUTO_VERIFY
- **Criterion:** Purchased and dismissed opportunities kept for 30 days for reporting
- **Evidence:** Cleanup logic excludes recent purchased/dismissed
- **Test:** `Grep for "30 days" or retention logic for purchased`

---

## Phase 6: Deprecation - Old Feature Removal

### DEP1: Old Page Removed
- **Tag:** AUTO_VERIFY
- **Criterion:** File `apps/web/src/app/(dashboard)/arbitrage/vinted/page.tsx` is deleted
- **Evidence:** File does not exist
- **Test:** File does NOT exist at `apps/web/src/app/(dashboard)/arbitrage/vinted/page.tsx`

### DEP2: Old API Route Removed
- **Tag:** AUTO_VERIFY
- **Criterion:** File `apps/web/src/app/api/arbitrage/vinted/route.ts` is deleted
- **Evidence:** File does not exist
- **Test:** File does NOT exist at `apps/web/src/app/api/arbitrage/vinted/route.ts`

### DEP3: Old Documentation Archived
- **Tag:** AUTO_VERIFY
- **Criterion:** Old manual scan documentation removed or archived
- **Evidence:** File `docs/functional/arbitrage/vinted-arbitrage.md` updated or removed
- **Test:** File either deleted or contains archive notice

### DEP4: Navigation Updated
- **Tag:** AUTO_VERIFY
- **Criterion:** Sidebar navigation for Vinted points to new automation page
- **Evidence:** Nav link href is `/arbitrage/vinted/automation`
- **Test:** `Grep for "/arbitrage/vinted" in Sidebar and verify points to automation`

### DEP5: Redirect In Place (Optional)
- **Tag:** AUTO_VERIFY
- **Criterion:** If redirect exists, `/arbitrage/vinted` redirects to `/arbitrage/vinted/automation`
- **Evidence:** Redirect configuration or middleware
- **Test:** Check for redirect in next.config.js or middleware

---

## Phase 6: Deprecation - Logic Migration Verification

### MIG1: New Feature Uses Shared Set Extraction
- **Tag:** AUTO_VERIFY
- **Criterion:** New automation imports shared extractSetNumber utility
- **Evidence:** Import statement in processing code
- **Test:** `Grep for "import.*extractSetNumber" in automation code`

### MIG2: New Feature Uses Same Fee Calculation
- **Tag:** AUTO_VERIFY
- **Criterion:** New automation uses same 18.36% fee rate as old feature
- **Evidence:** Code contains 0.1836 or imports shared constant
- **Test:** `Grep for "0.1836" or "AMAZON_FEE_RATE" in automation code`

### MIG3: COG% Calculation Parity
- **Tag:** AUTO_VERIFY
- **Criterion:** New COG% calculation produces same results as old (totalCost / amazonPrice * 100)
- **Evidence:** Same formula in shared utility
- **Test:** Unit test comparing old and new calculation

---

## Integration Testing

### INT1: Full Scan Flow Works End-to-End
- **Tag:** AUTO_VERIFY
- **Criterion:** A test scan can be triggered, processed, and results appear in UI
- **Evidence:** Integration test or manual test script
- **Test:** Playwright test covering scan trigger → processing → display

### INT2: Alert Delivery Works
- **Tag:** AUTO_VERIFY
- **Criterion:** Pushover alerts are delivered for test opportunity
- **Evidence:** Test mode or mock verification
- **Test:** Mock Pushover and verify sendVintedOpportunity called

### INT3: Pause/Resume Flow Works
- **Tag:** AUTO_VERIFY
- **Criterion:** Pausing scanner stops scans, resuming continues
- **Evidence:** Integration test for pause/resume
- **Test:** Test that verifies config.paused affects scan execution

### INT4: CAPTCHA Pause Flow Works
- **Tag:** AUTO_VERIFY
- **Criterion:** CAPTCHA detection pauses scanner and sends alert
- **Evidence:** Test with mocked CAPTCHA detection
- **Test:** Mock CAPTCHA detection and verify pause + alert

---

## Performance

### PERF1: Automation Page Loads Under 2 Seconds
- **Tag:** AUTO_VERIFY
- **Criterion:** Page at /arbitrage/vinted/automation loads in under 2 seconds
- **Evidence:** Performance test or lighthouse check
- **Test:** Time to interactive < 2000ms

### PERF2: Watchlist Health Page Handles 200 Sets
- **Tag:** AUTO_VERIFY
- **Criterion:** Watchlist health page renders 200 sets without performance issues
- **Evidence:** Table renders full watchlist smoothly
- **Test:** Render test with 200 row dataset

### PERF3: Opportunity Processing Under 5 Seconds
- **Tag:** AUTO_VERIFY
- **Criterion:** Processing a scan result with 50 listings completes in under 5 seconds
- **Evidence:** Timed processing test
- **Test:** Time processing of 50-listing payload

---

## Safety Testing Protocol (CRITICAL)

> **Note:** These criteria ensure account protection is verified before going live. They require human confirmation because they involve real-world testing over time periods that cannot be automated.

### SAFETY1: Manual Baseline Documented
- **Tag:** HUMAN_VERIFY
- **Criterion:** Document of normal manual Vinted usage patterns exists before automation starts
- **Evidence:** File `docs/features/updated-vinted-arbitrage/safety/manual-baseline.md` exists with: typical search frequency, time of day patterns, pages viewed per session
- **Verify:** User confirms baseline document is accurate and complete

### SAFETY2: Single Test Scan Verified No CAPTCHA
- **Tag:** HUMAN_VERIFY
- **Criterion:** A single automated test scan has been executed and completed without triggering CAPTCHA
- **Evidence:** Scan log entry with status='success' exists; user visually confirmed no CAPTCHA appeared
- **Verify:** User confirms they witnessed the test scan complete without CAPTCHA

### SAFETY3: Low-Frequency Test Period Completed
- **Tag:** HUMAN_VERIFY
- **Criterion:** Scanner has run at 50% planned frequency for minimum 1 week without any CAPTCHA or blocks
- **Evidence:** Scan logs show 7+ consecutive days of operation; no 'captcha' status entries; user confirms no manual interventions required
- **Verify:** User confirms 1-week test period completed successfully

### SAFETY4: Risk Checklist Signed Off
- **Tag:** HUMAN_VERIFY
- **Criterion:** Implementation risk checklist (per Appendix C of requirements) has been reviewed and signed off
- **Evidence:** File `docs/features/updated-vinted-arbitrage/safety/risk-checklist.md` exists with all items checked and dated
- **Verify:** User confirms all checklist items verified and accepts remaining risk

### SAFETY5: CAPTCHA Response Protocol Documented
- **Tag:** HUMAN_VERIFY
- **Criterion:** Written protocol exists for what to do if CAPTCHA is detected during live operation
- **Evidence:** File `docs/features/updated-vinted-arbitrage/safety/captcha-response-protocol.md` exists with: immediate actions, wait period, resume procedure, frequency adjustment steps
- **Verify:** User confirms protocol is understood and actionable

---

## Randomisation Verification

### RAND1: No Hardcoded Timing Values
- **Tag:** AUTO_VERIFY
- **Criterion:** No fixed timing delays exist in scanner code - all delays use randomisation
- **Evidence:** Code review shows no hardcoded `sleep(5000)` or similar fixed values without variance
- **Test:** `Grep for "sleep\(\d+\)" or "delay\(\d+\)" without random component; should find none`

### RAND2: Broad Sweep Random Window 0-55 Minutes
- **Tag:** AUTO_VERIFY
- **Criterion:** Broad sweep execution time randomised within 0-55 minute window of each hour
- **Evidence:** Code contains random delay up to 55 minutes (3300000ms) or 0-55 range
- **Test:** `Grep for "55" or "3300" in broad sweep scheduling; verify random selection`

### RAND3: Watchlist Gaps Are 2-8 Minutes Variable
- **Tag:** AUTO_VERIFY
- **Criterion:** Gap between watchlist scans varies between 2-8 minutes, not fixed at 4
- **Evidence:** Code shows min=2, max=8 (or 120000ms to 480000ms) with random selection
- **Test:** `Grep for "120000" and "480000" or "2.*8" minute range in scheduling`

### RAND4: Watchlist Order Not Same Two Days Running
- **Tag:** AUTO_VERIFY
- **Criterion:** Watchlist order is reshuffled daily using date-based seed or random on startup
- **Evidence:** Shuffle logic executes on each day change or process start
- **Test:** `Grep for "shuffle" with date check or daily reset logic`

### RAND5: Conservative Defaults Configured
- **Tag:** AUTO_VERIFY
- **Criterion:** Default timing values are at the conservative (longer) end of ranges
- **Evidence:** Default broad sweep delay uses upper half of range; default watchlist gap >= 4 minutes
- **Test:** Verify default constants: `DEFAULT_BROAD_SWEEP_DELAY >= 27 minutes (middle of 0-55)`; `DEFAULT_WATCHLIST_GAP >= 4 minutes`

### RAND6: Interaction Variation Implemented
- **Tag:** AUTO_VERIFY
- **Criterion:** Scanner includes occasional filter toggle (10% chance) and variable scroll behaviour
- **Evidence:** Code contains random chance for filter interaction and variable scroll logic
- **Test:** `Grep for "0.1" or "10%" and "filter" or "toggle" in scanner prompts/code`

---

## Operating Hours Enforcement

### OH1: Scanner Respects Operating Hours Start
- **Tag:** AUTO_VERIFY
- **Criterion:** No scans execute before configured operating_hours_start (default 08:00)
- **Evidence:** Scheduler checks current time against config before executing
- **Test:** `Grep for "operating_hours_start" check in scheduler; verify exit/skip logic`

### OH2: Scanner Respects Operating Hours End
- **Tag:** AUTO_VERIFY
- **Criterion:** No scans execute after configured operating_hours_end (default 22:00)
- **Evidence:** Scheduler checks current time against config before executing
- **Test:** `Grep for "operating_hours_end" check in scheduler; verify exit/skip logic`

### OH3: Daily Summary Sent At End Of Operating Hours
- **Tag:** AUTO_VERIFY
- **Criterion:** Daily summary notification triggers at or shortly after operating_hours_end
- **Evidence:** Scheduled job for daily summary uses operating_hours_end as trigger time
- **Test:** `Grep for "DailySummary" scheduling with operating hours reference`

---

## Your Data Popup Details

### YD1: Popup Shows Units Sold (13 Months)
- **Tag:** AUTO_VERIFY
- **Criterion:** Your Data popup displays units sold count from last 13 months
- **Evidence:** Query joins platform_orders with 13-month filter; displays count
- **Test:** `Grep for "13.*month" or "13 month" and "units" or "sold" in popup component`

### YD2: Popup Shows Average Sell Price
- **Tag:** AUTO_VERIFY
- **Criterion:** Your Data popup displays average selling price from your sales
- **Evidence:** Query calculates AVG of sale prices; displays formatted currency
- **Test:** `Grep for "average" or "avg" and "sell.*price" in popup component`

### YD3: Popup Shows Last Sale Date
- **Tag:** AUTO_VERIFY
- **Criterion:** Your Data popup displays date of most recent sale
- **Evidence:** Query gets MAX order_date; displays relative time or date
- **Test:** `Grep for "last.*sale" or "recent" and "date" in popup component`

### YD4: Popup Shows Current Stock By Status
- **Tag:** AUTO_VERIFY
- **Criterion:** Your Data popup displays current stock split by status (Listed, Backlog)
- **Evidence:** Query counts inventory_items grouped by status; displays breakdown
- **Test:** `Grep for "Listed" and "Backlog" in popup component`

### YD5: Popup Shows Average Days In Stock
- **Tag:** AUTO_VERIFY
- **Criterion:** Your Data popup displays average number of days items spend in stock
- **Evidence:** Query calculates average of (sold_date - acquired_date) or similar
- **Test:** `Grep for "days.*stock" or "stock.*days" or "average.*days" in popup component`

---

## Opportunity Cleanup Jobs

### CL1: Cleanup Job Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** A scheduled cleanup job or database trigger exists for opportunity lifecycle management
- **Evidence:** Cron job file, Supabase function, or API endpoint for cleanup
- **Test:** File exists for cleanup job or `Grep for "cleanup" and "opportunities" in cron/scheduled jobs`

### CL2: Expired Status Set After 7 Days
- **Tag:** AUTO_VERIFY
- **Criterion:** Opportunities with status='active' are set to status='expired' when found_at > 7 days ago
- **Evidence:** UPDATE query with 7-day condition
- **Test:** `Grep for "expired" and "7 day" or "INTERVAL '7 days'" in cleanup logic`

### CL3: Expired Records Deleted After 14 Days Total
- **Tag:** AUTO_VERIFY
- **Criterion:** Opportunities with status='expired' are deleted when found_at > 14 days ago (7 days active + 7 days expired)
- **Evidence:** DELETE query with 14-day condition for expired records
- **Test:** `Grep for "DELETE" and "expired" and "14 day" in cleanup logic`

### CL4: Purchased/Dismissed Retained 30 Days
- **Tag:** AUTO_VERIFY
- **Criterion:** Opportunities with status='purchased' or 'dismissed' are retained for 30 days before deletion
- **Evidence:** DELETE query excludes purchased/dismissed within 30 days
- **Test:** `Grep for "30 day" and ("purchased" or "dismissed") in cleanup logic`

---

## Server-Side Schedule Generation API

### SCHED1: Schedule API Endpoint Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** API endpoint `GET /api/arbitrage/vinted/automation/schedule` exists
- **Evidence:** Route file exists
- **Test:** File exists at `apps/web/src/app/api/arbitrage/vinted/automation/schedule/route.ts`

### SCHED2: Schedule Response Contains Required Fields
- **Tag:** AUTO_VERIFY
- **Criterion:** Schedule response includes: date, generatedAt, scheduleVersion, operatingHours, scans array
- **Evidence:** Response matches ScheduleResponse interface from requirements
- **Test:** `Grep for "scheduleVersion" and "operatingHours" in schedule route`

### SCHED3: Schedule Includes Broad Sweep Slots
- **Tag:** AUTO_VERIFY
- **Criterion:** Schedule contains one broad_sweep scan per hour during operating hours (14 total for 08:00-22:00)
- **Evidence:** Schedule generation creates hourly broad sweep entries
- **Test:** `Grep for "broad_sweep" in schedule generation logic`

### SCHED4: Schedule Includes Watchlist Scans
- **Tag:** AUTO_VERIFY
- **Criterion:** Schedule distributes all 200 watchlist sets across operating hours with 2-8 minute gaps
- **Evidence:** Schedule includes watchlist type scans with set numbers
- **Test:** `Grep for "watchlist" and "set_number" in schedule generation`

### SCHED5: Broad Sweep Times Are Random 0-55 Minutes
- **Tag:** AUTO_VERIFY
- **Criterion:** Each broad sweep scheduled at random minute 0-55 within its hour
- **Evidence:** Code generates random minute within 0-55 range
- **Test:** `Grep for "55" or random minute generation in broad sweep scheduling`

### SCHED6: Minimum 5 Minute Separation Between Broad/Watchlist
- **Tag:** AUTO_VERIFY
- **Criterion:** Watchlist scans maintain minimum 5 minute gap from nearest broad sweep
- **Evidence:** Collision detection logic pushes watchlist scans if too close to broad sweep
- **Test:** `Grep for "5.*min" or collision detection in schedule generation`

### SCHED7: Schedule Uses Seeded Random For Reproducibility
- **Tag:** AUTO_VERIFY
- **Criterion:** Same date + same watchlist produces identical schedule (deterministic)
- **Evidence:** Random functions use date-based seed (cyrb53 or similar hash)
- **Test:** `Grep for "seed" or "cyrb53" or deterministic random in schedule generation`

### SCHED8: Watchlist Order Shuffled Daily
- **Tag:** AUTO_VERIFY
- **Criterion:** Watchlist processing order is shuffled using seeded random based on date
- **Evidence:** Shuffle function with date seed
- **Test:** `Grep for "shuffle" with date-based seeding`

### SCHED9: Schedule Version Increments On Watchlist Change
- **Tag:** AUTO_VERIFY
- **Criterion:** When watchlist is refreshed, scheduleVersion increments
- **Evidence:** Version stored in database and incremented on watchlist change
- **Test:** `Grep for "scheduleVersion" increment logic`

### SCHED10: Mid-Day Schedule Regeneration
- **Tag:** AUTO_VERIFY
- **Criterion:** When watchlist changes mid-day, schedule regenerates for remaining hours only
- **Evidence:** Regeneration logic preserves executed scans, generates only future
- **Test:** `Grep for "remaining" or partial day regeneration logic`

---

## Config API

### CFG1: Config API Endpoint Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** API endpoint `GET /api/arbitrage/vinted/automation/config` exists
- **Evidence:** Route file exists
- **Test:** File exists at `apps/web/src/app/api/arbitrage/vinted/automation/config/route.ts`

### CFG2: Config Response Contains Required Fields
- **Tag:** AUTO_VERIFY
- **Criterion:** Config response includes: enabled, paused, pause_reason, thresholds, operating_hours, configVersion, scheduleVersion
- **Evidence:** Response matches expected config interface
- **Test:** `Grep for "configVersion" and "scheduleVersion" in config route`

### CFG3: Config Includes Machine ID Validation
- **Tag:** AUTO_VERIFY
- **Criterion:** Config endpoint validates machine ID from request header or query param
- **Evidence:** Machine ID check in config route
- **Test:** `Grep for "machineId" or "machine_id" in config route`

---

## Heartbeat API

### HB1: Heartbeat API Endpoint Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** API endpoint `POST /api/arbitrage/vinted/automation/heartbeat` exists
- **Evidence:** Route file exists
- **Test:** File exists at `apps/web/src/app/api/arbitrage/vinted/automation/heartbeat/route.ts`

### HB2: Heartbeat Request Accepts Required Fields
- **Tag:** AUTO_VERIFY
- **Criterion:** Heartbeat accepts: machineId, status, lastScanAt, scansToday, opportunitiesToday, errorMessage
- **Evidence:** Zod schema validates required fields
- **Test:** `Grep for "machineId" and "scansToday" in heartbeat route`

### HB3: Heartbeat Response Contains Version Info
- **Tag:** AUTO_VERIFY
- **Criterion:** Heartbeat response includes: configVersion, scheduleVersion, serverTime
- **Evidence:** Response includes version fields for client sync
- **Test:** `Grep for "configVersion" and "scheduleVersion" in heartbeat response`

### HB4: Heartbeat Updates Last Seen Timestamp
- **Tag:** AUTO_VERIFY
- **Criterion:** Heartbeat updates a `last_heartbeat_at` timestamp in database
- **Evidence:** Database update on heartbeat receipt
- **Test:** `Grep for "last_heartbeat" or "lastSeen" update in heartbeat route`

### HB5: Heartbeat Stores Machine Status
- **Tag:** AUTO_VERIFY
- **Criterion:** Heartbeat stores machine status (running/paused/error) for dashboard display
- **Evidence:** Status saved to database or cache
- **Test:** `Grep for "status" storage in heartbeat route`

---

## Dashboard Connection Status UI

### DCS1: Connection Status Shown On Dashboard
- **Tag:** AUTO_VERIFY
- **Criterion:** Automation dashboard displays local service connection status
- **Evidence:** UI component showing "Connected/Disconnected" with last seen time
- **Test:** `Grep for "Connected" or "last seen" or "heartbeat" in automation page`

### DCS2: Machine Name Displayed
- **Tag:** AUTO_VERIFY
- **Criterion:** Dashboard shows connected machine hostname/name
- **Evidence:** Machine identifier displayed in status card
- **Test:** `Grep for "machine" or "hostname" in automation page`

### DCS3: Disconnection Warning After 10 Minutes
- **Tag:** AUTO_VERIFY
- **Criterion:** If no heartbeat for 10+ minutes, show "Not Connected" warning
- **Evidence:** Time-based check with 10-minute threshold
- **Test:** `Grep for "10" and "minute" or disconnection logic in status component`

### DCS4: Disconnection Troubleshooting Steps
- **Tag:** AUTO_VERIFY
- **Criterion:** When disconnected, show troubleshooting checklist (PC powered, tray app running, internet)
- **Evidence:** Help text with troubleshooting steps
- **Test:** `Grep for "PC" or "powered" or "tray" in disconnection message`

### DCS5: Real-Time Status Updates
- **Tag:** AUTO_VERIFY
- **Criterion:** Connection status updates within 1 minute of actual state change
- **Evidence:** Polling or WebSocket for status updates
- **Test:** `Grep for "refetch" or polling interval in connection status hook`

---

## Windows Tray Application - Project Structure

### TRAY1: Windows App Project Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** A .NET 8 / C# project exists for the tray application
- **Evidence:** Project file (*.csproj) exists at expected location
- **Test:** File exists at `apps/windows-scanner/HadleyBricksScanner.csproj` or similar

### TRAY2: Windows Forms System Tray Integration
- **Tag:** AUTO_VERIFY
- **Criterion:** Project uses Windows Forms for system tray integration
- **Evidence:** NotifyIcon usage in codebase
- **Test:** `Grep for "NotifyIcon" in Windows app source files`

### TRAY3: App Targets .NET 8
- **Tag:** AUTO_VERIFY
- **Criterion:** Project targets .NET 8 or higher
- **Evidence:** TargetFramework in csproj is net8.0 or higher
- **Test:** `Grep for "net8.0" or higher in csproj file`

---

## Windows Tray Application - Installation

### INST1: Installer Package Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** An installer package (MSI, MSIX, or NSIS) exists
- **Evidence:** Installer project or build script
- **Test:** File exists for installer or `Grep for "installer" or "setup" in build scripts`

### INST2: Installs To LocalAppData
- **Tag:** AUTO_VERIFY
- **Criterion:** App installs to `%LOCALAPPDATA%\HadleyBricks\Scanner`
- **Evidence:** Install path configuration in installer
- **Test:** `Grep for "LocalAppData" or "HadleyBricks" in installer config`

### INST3: Creates Start Menu Shortcut
- **Tag:** AUTO_VERIFY
- **Criterion:** Installer creates Start Menu shortcut
- **Evidence:** Shortcut creation in installer
- **Test:** `Grep for "Start Menu" or "shortcut" in installer config`

### INST4: Optional Auto-Start Registration
- **Tag:** AUTO_VERIFY
- **Criterion:** Installer offers option to auto-start with Windows
- **Evidence:** Registry run key or startup folder option
- **Test:** `Grep for "Run" registry or "Startup" in installer`

### INST5: Validates Prerequisites On Install
- **Tag:** AUTO_VERIFY
- **Criterion:** Installer checks for Claude CLI and Chrome extension
- **Evidence:** Prerequisite checks in installer or first-run
- **Test:** `Grep for "claude" and "Chrome" validation in installer or app startup`

### INST6: Prompts For API Key
- **Tag:** AUTO_VERIFY
- **Criterion:** Installer or first-run prompts for Hadley Bricks API key
- **Evidence:** API key input UI
- **Test:** `Grep for "API key" or "apiKey" input in installer or app`

---

## Windows Tray Application - Tray Interface

### TUI1: System Tray Icon Displayed
- **Tag:** AUTO_VERIFY
- **Criterion:** Application displays icon in Windows system tray when running
- **Evidence:** NotifyIcon with icon set
- **Test:** `Grep for "NotifyIcon" and "Icon" assignment in app code`

### TUI2: Tray Icon Has Four States
- **Tag:** AUTO_VERIFY
- **Criterion:** Tray icon changes color for states: Green (Running), Yellow (Paused), Red (Error), Grey (Outside Hours)
- **Evidence:** Multiple icon assets or dynamic icon generation
- **Test:** `Grep for "Green" or "Yellow" or icon state logic in app code`

### TUI3: Tray Tooltip Shows Status
- **Tag:** AUTO_VERIFY
- **Criterion:** Hovering over tray icon shows: status, next scan, today's progress
- **Evidence:** NotifyIcon.Text property updated with status
- **Test:** `Grep for "Text" or "ToolTip" update in tray code`

### TUI4: Context Menu Contains Required Items
- **Tag:** AUTO_VERIFY
- **Criterion:** Right-click menu includes: Resume/Pause, Refresh Schedule, Open Dashboard, Settings, View Logs, Exit
- **Evidence:** ContextMenuStrip with menu items
- **Test:** `Grep for "Pause" and "Resume" and "Dashboard" in context menu code`

### TUI5: Resume/Pause Toggle Works
- **Tag:** AUTO_VERIFY
- **Criterion:** Resume/Pause menu item toggles scanner state via API call
- **Evidence:** API call to update paused state
- **Test:** `Grep for "paused" toggle and API call in menu handler`

### TUI6: Open Dashboard Opens Browser
- **Tag:** AUTO_VERIFY
- **Criterion:** "Open Dashboard" opens `/arbitrage/vinted/automation` in default browser
- **Evidence:** Process.Start or Shell.Execute with URL
- **Test:** `Grep for "arbitrage/vinted/automation" URL in dashboard handler`

### TUI7: View Logs Opens Log Folder
- **Tag:** AUTO_VERIFY
- **Criterion:** "View Logs" opens the log folder in File Explorer
- **Evidence:** Opens `%LOCALAPPDATA%\HadleyBricks\Scanner\logs\`
- **Test:** `Grep for "logs" folder open in menu handler`

---

## Windows Tray Application - Main Loop

### LOOP1: Startup Validation Runs
- **Tag:** AUTO_VERIFY
- **Criterion:** On startup, app validates Chrome installed and Claude CLI authenticated
- **Evidence:** Validation checks with error handling
- **Test:** `Grep for "Chrome" and "Claude" validation in startup code`

### LOOP2: Fetches Config On Startup
- **Tag:** AUTO_VERIFY
- **Criterion:** On startup, app fetches config from server
- **Evidence:** HTTP GET to /config endpoint
- **Test:** `Grep for "/config" API call in startup sequence`

### LOOP3: Fetches Schedule On Startup
- **Tag:** AUTO_VERIFY
- **Criterion:** On startup, app fetches today's schedule from server
- **Evidence:** HTTP GET to /schedule endpoint
- **Test:** `Grep for "/schedule" API call in startup sequence`

### LOOP4: Main Loop Runs Every 30 Seconds
- **Tag:** AUTO_VERIFY
- **Criterion:** Main loop checks for due scans every 30 seconds
- **Evidence:** Timer or loop with 30-second interval
- **Test:** `Grep for "30" and "second" or "30000" in main loop`

### LOOP5: Skips Execution Outside Operating Hours
- **Tag:** AUTO_VERIFY
- **Criterion:** Main loop exits early if current time is outside operating hours
- **Evidence:** Time check against config operating hours
- **Test:** `Grep for "operatingHours" or time range check in main loop`

### LOOP6: Skips Execution When Paused
- **Tag:** AUTO_VERIFY
- **Criterion:** Main loop exits early if config.paused is true
- **Evidence:** Paused state check
- **Test:** `Grep for "paused" check in main loop`

### LOOP7: Executes Due Scans
- **Tag:** AUTO_VERIFY
- **Criterion:** When scan is due (scheduledTime <= now AND not executed), executes via Claude CLI
- **Evidence:** Time comparison and Claude CLI invocation
- **Test:** `Grep for "scheduledTime" and "claude" execution in main loop`

### LOOP8: Posts Results To Server
- **Tag:** AUTO_VERIFY
- **Criterion:** After scan execution, posts results to /automation/process endpoint
- **Evidence:** HTTP POST with scan results
- **Test:** `Grep for "/process" API call after scan`

### LOOP9: Marks Scan As Executed Locally
- **Tag:** AUTO_VERIFY
- **Criterion:** After execution, marks scan as executed to prevent re-execution
- **Evidence:** Local state tracking of executed scan IDs
- **Test:** `Grep for "executed" or "completed" marking in scan handler`

---

## Windows Tray Application - Config Polling

### POLL1: Config Polled Every 5 Minutes
- **Tag:** AUTO_VERIFY
- **Criterion:** App polls /config endpoint every 5 minutes
- **Evidence:** Timer with 5-minute interval for config fetch
- **Test:** `Grep for "5" and "minute" or "300" in config polling code`

### POLL2: Detects Paused State Change
- **Tag:** AUTO_VERIFY
- **Criterion:** When config.paused changes, app updates local state immediately
- **Evidence:** Comparison of old vs new paused state
- **Test:** `Grep for "paused" state comparison in config poll handler`

### POLL3: Detects Schedule Version Change
- **Tag:** AUTO_VERIFY
- **Criterion:** When scheduleVersion changes, app fetches new schedule
- **Evidence:** Version comparison triggering schedule refresh
- **Test:** `Grep for "scheduleVersion" comparison in config poll handler`

### POLL4: Midnight Schedule Refresh
- **Tag:** AUTO_VERIFY
- **Criterion:** At midnight (or date change), clears executed flags and fetches new schedule
- **Evidence:** Date change detection and schedule refresh
- **Test:** `Grep for "midnight" or date change detection in app code`

---

## Windows Tray Application - Heartbeat

### THB1: Heartbeat Sent Every 5 Minutes
- **Tag:** AUTO_VERIFY
- **Criterion:** App sends heartbeat to server every 5 minutes
- **Evidence:** Timer with 5-minute interval for heartbeat POST
- **Test:** `Grep for "/heartbeat" API call with 5-minute interval`

### THB2: Heartbeat Contains Machine ID
- **Tag:** AUTO_VERIFY
- **Criterion:** Heartbeat includes unique machine identifier
- **Evidence:** Machine ID in heartbeat payload
- **Test:** `Grep for "machineId" in heartbeat sender`

### THB3: Heartbeat Contains Daily Stats
- **Tag:** AUTO_VERIFY
- **Criterion:** Heartbeat includes scansToday and opportunitiesToday counts
- **Evidence:** Counter values in heartbeat payload
- **Test:** `Grep for "scansToday" and "opportunitiesToday" in heartbeat sender`

---

## Windows Tray Application - Error Handling

### TERR1: Chrome Not Responding Retry
- **Tag:** AUTO_VERIFY
- **Criterion:** If Chrome doesn't respond, retries 3 times before pausing
- **Evidence:** Retry loop with 3 attempts
- **Test:** `Grep for "retry" or "3" attempts in Chrome error handling`

### TERR2: API Unreachable Uses Cached Schedule
- **Tag:** AUTO_VERIFY
- **Criterion:** If API unreachable, continues using cached schedule
- **Evidence:** Fallback to cached schedule on API error
- **Test:** `Grep for "cache" or fallback in API error handling`

### TERR3: Claude CLI Failure Skips Scan
- **Tag:** AUTO_VERIFY
- **Criterion:** If Claude CLI fails, logs error and skips to next scan
- **Evidence:** Error logging and continue logic
- **Test:** `Grep for "skip" or continue on Claude error`

### TERR4: CAPTCHA Detection Pauses Immediately
- **Tag:** AUTO_VERIFY
- **Criterion:** If CAPTCHA detected in scan result, pauses scanner and alerts user
- **Evidence:** CAPTCHA check and pause trigger
- **Test:** `Grep for "captcha" and "pause" in result handler`

---

## Windows Tray Application - Missed Scans

### MISS1: Missed Scans Are Skipped
- **Tag:** AUTO_VERIFY
- **Criterion:** Scans from past time slots are NOT executed (no catch-up)
- **Evidence:** Past scan detection and skip logic
- **Test:** `Grep for "skip" or "miss" or past time check in scheduler`

### MISS2: Resume From Next Scheduled Scan
- **Tag:** AUTO_VERIFY
- **Criterion:** When resuming, continues from next scheduled (not past) scan
- **Evidence:** Time-based filtering to find next valid scan
- **Test:** `Grep for "next" scan selection on resume`

### MISS3: Large Gap Warning Logged
- **Tag:** AUTO_VERIFY
- **Criterion:** If gap > 2 hours since last execution, log warning
- **Evidence:** Gap detection with warning log
- **Test:** `Grep for "2 hour" or gap warning in scheduler`

---

## Windows Tray Application - Logging

### LOG1: Daily Log Files Created
- **Tag:** AUTO_VERIFY
- **Criterion:** Log files created at `%LOCALAPPDATA%\HadleyBricks\Scanner\logs\scanner-YYYY-MM-DD.log`
- **Evidence:** Log file path with date pattern
- **Test:** `Grep for "scanner-" and date format in logging config`

### LOG2: Logs Retain 30 Days
- **Tag:** AUTO_VERIFY
- **Criterion:** Logs older than 30 days are automatically deleted
- **Evidence:** Log cleanup logic with 30-day retention
- **Test:** `Grep for "30" and "day" or log cleanup in app code`

### LOG3: Scan Executions Logged
- **Tag:** AUTO_VERIFY
- **Criterion:** Each scan execution logged with start, end, result
- **Evidence:** Log entries for scan lifecycle
- **Test:** `Grep for "scan" and "start" and "end" in logging`

### LOG4: API Communications Logged
- **Tag:** AUTO_VERIFY
- **Criterion:** API calls logged (endpoint, response status)
- **Evidence:** HTTP logging middleware or explicit logging
- **Test:** `Grep for HTTP logging in API client code`

---

## TypeScript and Code Quality

### TQ1: No TypeScript Errors
- **Tag:** AUTO_VERIFY
- **Criterion:** All new files pass TypeScript compilation with no errors
- **Evidence:** `npm run typecheck` passes
- **Test:** Run typecheck, verify no errors in new files

### TQ2: No ESLint Errors
- **Tag:** AUTO_VERIFY
- **Criterion:** All new files pass ESLint with no errors
- **Evidence:** `npm run lint` passes
- **Test:** Run lint, verify no errors in new files

### TQ3: Zod Schemas For API Validation
- **Tag:** AUTO_VERIFY
- **Criterion:** All new API endpoints use Zod schemas for request validation
- **Evidence:** Zod import and schema validation in routes
- **Test:** `Grep for "z.object" in all new route files`

---

## Dependencies

- Existing Pushover integration must be functional
- Amazon credentials must be configured for pricing lookups
- seeded_asins table must have discovered ASINs
- Claude Code CLI must be installed with Chrome extension
- Windows PC must be powered on during operating hours
- .NET 8 SDK for Windows tray application development
- Chrome browser installed with "Claude in Chrome" extension
- Hadley Bricks API key for server authentication

---

## Criteria Summary

| Category | Count | AUTO_VERIFY | HUMAN_VERIFY |
|----------|-------|-------------|--------------|
| Phase 0: Deprecation Prep | 5 | 5 | 0 |
| Phase 1: Database | 10 | 10 | 0 |
| Phase 1: Sales Rank | 6 | 6 | 0 |
| Phase 1: Watchlist | 6 | 6 | 0 |
| Phase 2: Broad Sweep | 12 | 12 | 0 |
| Phase 2: Watchlist Scan | 5 | 5 | 0 |
| Phase 2: CAPTCHA Detection | 6 | 6 | 0 |
| Phase 2: Scheduling | 8 | 8 | 0 |
| Phase 3: Alerts | 9 | 9 | 0 |
| Phase 4: UI Status | 9 | 9 | 0 |
| Phase 4: UI Opportunities | 8 | 8 | 0 |
| Phase 4: UI Near Misses | 2 | 2 | 0 |
| Phase 4: UI Schedule | 2 | 2 | 0 |
| Phase 4: UI History | 3 | 3 | 0 |
| Phase 4: UI Settings | 7 | 7 | 0 |
| Phase 4: UI Watchlist Health | 9 | 9 | 0 |
| Phase 4: UI Navigation | 2 | 2 | 0 |
| Phase 5: Error Handling | 4 | 4 | 0 |
| Phase 5: Data Lifecycle | 3 | 3 | 0 |
| Phase 6: Deprecation | 5 | 5 | 0 |
| Phase 6: Migration | 3 | 3 | 0 |
| **Safety Testing Protocol** | **5** | **0** | **5** |
| Randomisation Verification | 6 | 6 | 0 |
| Operating Hours Enforcement | 3 | 3 | 0 |
| Your Data Popup Details | 5 | 5 | 0 |
| Opportunity Cleanup Jobs | 4 | 4 | 0 |
| Integration | 4 | 4 | 0 |
| Performance | 3 | 3 | 0 |
| Code Quality | 3 | 3 | 0 |
| **Server-Side Schedule API** | **10** | **10** | **0** |
| Config API | 3 | 3 | 0 |
| Heartbeat API | 5 | 5 | 0 |
| Dashboard Connection Status | 5 | 5 | 0 |
| Windows Tray App - Project | 3 | 3 | 0 |
| Windows Tray App - Installation | 6 | 6 | 0 |
| Windows Tray App - Tray Interface | 7 | 7 | 0 |
| Windows Tray App - Main Loop | 9 | 9 | 0 |
| Windows Tray App - Config Polling | 4 | 4 | 0 |
| Windows Tray App - Heartbeat | 3 | 3 | 0 |
| Windows Tray App - Error Handling | 4 | 4 | 0 |
| Windows Tray App - Missed Scans | 3 | 3 | 0 |
| Windows Tray App - Logging | 4 | 4 | 0 |
| **TOTAL** | **214** | **209** | **5** |

---

*5 criteria require HUMAN_VERIFY (Safety Testing Protocol) - these involve real-world testing over time periods that cannot be automated and are critical for account protection.*

*66 new criteria added for v2 requirements: server-side scheduling (10), APIs (8), dashboard connection status (5), and Windows tray application (43).*
