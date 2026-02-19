# Done Criteria: ebay-minifig-sync

**Created:** 2026-02-19
**Author:** Define Done Agent + Chris
**Status:** DRAFT
**Spec:** `docs/bricqer-ebay-minifig-sync-spec.md`

## Feature Summary

Automated pipeline to identify used LEGO minifigures in Bricqer inventory, research eBay market data (Terapeak primary, BrickLink fallback), source high-quality images, create optimised eBay listings with AI-generated descriptions, stage them for review before publishing, and keep both platforms in sync when sales occur — all managed through Hadley Bricks, bypassing Bricqer's native eBay integration (avoiding 3.5% fee). Cross-platform sales trigger a removal review queue with explicit approval before any deletion occurs on the other platform.

---

## Phase 1: Inventory Discovery

### Database & Configuration

#### F1: Minifig sync database tables created
- **Tag:** AUTO_VERIFY
- **Criterion:** All 5 database tables exist: `minifig_sync_items`, `minifig_price_cache`, `minifig_removal_queue`, `minifig_sync_jobs`, `minifig_sync_config`
- **Evidence:** SQL query `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'` returns all 5 tables
- **Test:** Execute SQL against Supabase; assert all 5 table names present

#### F2: Minifig sync tables have correct schema
- **Tag:** AUTO_VERIFY
- **Criterion:** `minifig_sync_items` has all columns from spec: `id`, `bricqer_item_id` (UNIQUE), `bricklink_id`, `name`, `condition_notes`, `bricqer_price`, `bricqer_image_url`, `ebay_avg_sold_price`, `ebay_min_sold_price`, `ebay_max_sold_price`, `ebay_sold_count`, `ebay_active_count`, `ebay_sell_through_rate`, `ebay_avg_shipping`, `ebay_research_date`, `meets_threshold`, `recommended_price`, `ebay_sku`, `ebay_inventory_item_id`, `ebay_offer_id`, `ebay_listing_id`, `ebay_listing_url`, `listing_status`, `images`, `created_at`, `updated_at`, `last_synced_at`
- **Evidence:** `SELECT column_name FROM information_schema.columns WHERE table_name = 'minifig_sync_items'` returns all expected columns
- **Test:** SQL column introspection query

#### F3: Indexes created for performance
- **Tag:** AUTO_VERIFY
- **Criterion:** Indexes exist on `minifig_sync_items(bricqer_item_id)`, `minifig_sync_items(ebay_listing_id)`, `minifig_sync_items(listing_status)`, `minifig_sync_items(ebay_sku)`, `minifig_sync_items(bricklink_id)`, `minifig_price_cache(bricklink_id)`, `minifig_price_cache(expires_at)`, `minifig_removal_queue(status)`, `minifig_removal_queue(minifig_sync_id)`, `minifig_sync_jobs(job_type)`, `minifig_sync_jobs(status)`
- **Evidence:** `SELECT indexname FROM pg_indexes WHERE tablename IN ('minifig_sync_items', 'minifig_price_cache', 'minifig_removal_queue', 'minifig_sync_jobs')` returns all expected indexes
- **Test:** SQL pg_indexes query

#### F4: Config table seeded with default threshold values
- **Tag:** AUTO_VERIFY
- **Criterion:** `minifig_sync_config` contains rows for keys: `min_bricqer_listing_price` (3.00), `min_sold_count` (3), `min_sell_through_rate` (30), `min_avg_sold_price` (3.00), `min_estimated_profit` (1.50), `packaging_cost` (0.50), `ebay_fvf_rate` (0.128), `price_cache_months` (6), `reprice_after_days` (85), `poll_interval_minutes` (15)
- **Evidence:** `SELECT key, value FROM minifig_sync_config` returns all 10 config rows with correct defaults
- **Test:** SQL query + value comparison

#### F5: RLS policies on all minifig sync tables
- **Tag:** AUTO_VERIFY
- **Criterion:** Row Level Security is enabled on all 5 minifig sync tables with appropriate policies
- **Evidence:** `SELECT tablename, policyname FROM pg_policies WHERE tablename LIKE 'minifig_%'` returns at least one policy per table
- **Test:** SQL pg_policies query

### Bricqer Inventory Pull

#### F6: Pull inventory API route exists
- **Tag:** AUTO_VERIFY
- **Criterion:** `POST /api/minifigs/sync/pull-inventory` route exists and requires authentication
- **Evidence:** Route file exists at expected path; unauthenticated request returns 401
- **Test:** File existence check + HTTP request without auth

#### F7: Pull filters applied correctly
- **Tag:** AUTO_VERIFY
- **Criterion:** The inventory pull requests only minifigures from Bricqer with filters: category = Minifigures, condition = Used, status = Available, listed price >= config value (`min_bricqer_listing_price`)
- **Evidence:** Bricqer API call includes correct filter parameters; items returned match all filter criteria
- **Test:** Unit test on filter construction; integration test verifying Bricqer request params

#### F8: Extracted data stored in minifig_sync_items
- **Tag:** AUTO_VERIFY
- **Criterion:** After pull, each qualifying minifigure creates a row in `minifig_sync_items` with `bricqer_item_id`, `bricklink_id`, `name`, `condition_notes`, `bricqer_price`, `bricqer_image_url` populated, and `listing_status = 'NOT_LISTED'`
- **Evidence:** Query `minifig_sync_items` after pull; rows exist with expected fields non-null
- **Test:** Run pull → query database → verify row data

#### F9: Duplicate handling on re-pull
- **Tag:** AUTO_VERIFY
- **Criterion:** Running the pull a second time does not create duplicate rows; existing items are updated (price, status) rather than inserted
- **Evidence:** Row count does not increase on second pull; `updated_at` changes for existing rows
- **Test:** Pull twice → count rows → verify no duplicates; verify updated_at changed

#### F10: Pagination handled for large inventories
- **Tag:** AUTO_VERIFY
- **Criterion:** If Bricqer returns more than 100 minifigures, all pages are fetched and processed
- **Evidence:** Total items processed matches Bricqer total count across all pages
- **Test:** Mock Bricqer API with >100 items; verify all items fetched

#### F11: Sync job recorded
- **Tag:** AUTO_VERIFY
- **Criterion:** Each pull creates a row in `minifig_sync_jobs` with `job_type = 'INVENTORY_PULL'`, tracking `items_processed`, `items_created`, `items_updated`, `status`, and timestamps
- **Evidence:** Query `minifig_sync_jobs` after pull; row exists with correct counts
- **Test:** Run pull → query jobs table → verify counts match

### Error Handling (Phase 1)

#### E1: Bricqer API failure handled gracefully
- **Tag:** AUTO_VERIFY
- **Criterion:** If Bricqer API returns an error (4xx/5xx), the pull returns an error response with the Bricqer error details, and the sync job is marked `status = 'FAILED'` with the error logged in `error_log`
- **Evidence:** Mock Bricqer 500 → API returns error → jobs table shows FAILED status
- **Test:** Mock Bricqer failure → verify error response + job status

#### E2: Partial page failure continues processing
- **Tag:** AUTO_VERIFY
- **Criterion:** If one page of results fails but others succeed, successfully fetched items are still stored and the job records the partial failure in `error_log` with `items_errored` count
- **Evidence:** Items from successful pages are saved; error_log contains page failure details
- **Test:** Mock page 2 failure → verify page 1 items saved + error logged

---

## Phase 2: eBay Market Research

### Terapeak Scraping (Primary)

#### F12: Terapeak scraper module exists
- **Tag:** AUTO_VERIFY
- **Criterion:** A Terapeak scraper service exists at `apps/web/src/lib/minifig-sync/terapeak-scraper.ts` that exports a function to research a minifigure by name and BrickLink ID
- **Evidence:** File exists with exported research function
- **Test:** File grep for export + function signature

#### F13: Terapeak scraper authenticates with eBay session
- **Tag:** AUTO_VERIFY
- **Criterion:** The Terapeak scraper uses Playwright to navigate to `https://www.ebay.co.uk/sh/research` with stored eBay session cookies from encrypted credentials
- **Evidence:** Code loads cookies from credential store; navigates to Terapeak URL
- **Test:** Code inspection for cookie loading + URL navigation

#### F14: Terapeak extracts sold data
- **Tag:** AUTO_VERIFY
- **Criterion:** The scraper extracts from Terapeak results: average sold price, min/max sold price, number sold, total listings (for sell-through), and average shipping cost — filtering for Used condition and last 90 days
- **Evidence:** Returned data object contains all expected numeric fields
- **Test:** Unit test with mocked Terapeak HTML → verify extracted data shape

#### F15: Terapeak respects rate limits
- **Tag:** AUTO_VERIFY
- **Criterion:** Consecutive Terapeak requests have a minimum delay of 3 seconds between them
- **Evidence:** Timestamp logging between requests shows >= 3000ms gaps
- **Test:** Unit test with timing assertion on sequential calls

### BrickLink Fallback

#### F16: BrickLink Price Guide used as fallback
- **Tag:** AUTO_VERIFY
- **Criterion:** If Terapeak scraping fails or returns no results for a minifigure, the system falls back to BrickLink Price Guide API (`GET /price_guide/MINIFIG/{bricklink_id}?guide_type=sold&new_or_used=U`) and populates pricing data from BrickLink
- **Evidence:** On Terapeak failure, BrickLink API is called; pricing fields populated with BrickLink data
- **Test:** Mock Terapeak failure → verify BrickLink API called → verify data stored

#### F17: Research API route exists
- **Tag:** AUTO_VERIFY
- **Criterion:** `POST /api/minifigs/sync/research` route exists, accepts optional minifig IDs (or researches all unresearched), and returns research results
- **Evidence:** Route file exists; POST with body returns results
- **Test:** HTTP request test

#### F18: Force-refresh bypasses cache
- **Tag:** AUTO_VERIFY
- **Criterion:** `POST /api/minifigs/sync/research/refresh` accepts a specific minifig ID and re-runs research regardless of cache freshness
- **Evidence:** Cache entry `researched_at` is updated to current time after force-refresh
- **Test:** Set recent cache → force-refresh → verify cache updated

### Price Cache

#### F19: Price cache stores research results
- **Tag:** AUTO_VERIFY
- **Criterion:** After research, `minifig_price_cache` contains a row for the BrickLink ID with Terapeak fields (or BrickLink fallback fields), `source` column reflecting which source was used, `researched_at` = now, and `expires_at` = now + 6 months
- **Evidence:** Query cache table after research; row exists with expected fields and dates
- **Test:** Run research → query cache → verify row + expiry date

#### F20: Cache lookup prevents redundant research
- **Tag:** AUTO_VERIFY
- **Criterion:** If a valid (non-expired) cache entry exists for a BrickLink ID, the research step skips that minifigure and uses cached data
- **Evidence:** No Terapeak/BrickLink API call made for cached minifig; sync item pricing populated from cache
- **Test:** Seed cache with fresh entry → run research → verify no external API called

#### F21: Expired cache triggers re-research
- **Tag:** AUTO_VERIFY
- **Criterion:** If a cache entry exists but `expires_at < NOW()`, the system re-runs research and upserts the cache entry
- **Evidence:** Expired cache entry gets new `researched_at` and `expires_at` after research
- **Test:** Seed expired cache → run research → verify cache updated

### Threshold & Pricing

#### F22: Popularity threshold evaluation
- **Tag:** AUTO_VERIFY
- **Criterion:** After research, each minifig is evaluated against all 4 threshold criteria (from `minifig_sync_config`): min_sold_count >= 3, sell_through_rate >= 30%, avg_sold_price >= £3.00, estimated_profit >= £1.50. The `meets_threshold` boolean is set accordingly
- **Evidence:** Minifigs meeting all 4 criteria have `meets_threshold = TRUE`; those failing any have `FALSE`
- **Test:** Seed test data with known values → run threshold check → verify boolean

#### F23: Profit calculation uses configurable values
- **Tag:** AUTO_VERIFY
- **Criterion:** Estimated profit is calculated as: `avg_sold_price - (avg_sold_price * ebay_fvf_rate) - avg_shipping - packaging_cost`, using values from `minifig_sync_config`
- **Evidence:** Unit test with known inputs produces expected profit value
- **Test:** `calculateProfit(10.00, 0.128, 2.00, 0.50)` → `10.00 - 1.28 - 2.00 - 0.50 = 6.22`

#### F24: Recommended price calculated correctly
- **Tag:** AUTO_VERIFY
- **Criterion:** `recommended_price = ROUND(avg_sold_price * 1.05, 2)`, clamped between floor (`bricqer_price + 1.00`) and ceiling (`max_sold_price`)
- **Evidence:** Unit tests verify: base calculation, floor enforcement, ceiling enforcement
- **Test:** Three test cases: normal, floor-clamped, ceiling-clamped

#### F25: Best Offer thresholds set
- **Tag:** AUTO_VERIFY
- **Criterion:** Auto-accept is set to >= 95% of listed price; auto-decline is set to <= 75% of listed price
- **Evidence:** For a £10.00 listing: auto_accept = £9.50, auto_decline = £7.50
- **Test:** Unit test on threshold calculation

### Error Handling (Phase 2)

#### E3: Terapeak session expiry detected
- **Tag:** AUTO_VERIFY
- **Criterion:** If Terapeak navigation redirects to login page (session expired), the scraper logs an error, marks the job as failed with reason "session_expired", and does not attempt further Terapeak calls in this batch
- **Evidence:** Mock redirect → job fails with session_expired reason
- **Test:** Mock login redirect → verify early exit + error reason

#### E4: BrickLink API rate limit handled
- **Tag:** AUTO_VERIFY
- **Criterion:** If BrickLink returns 429 (rate limited), the system retries with exponential backoff (up to 3 retries) before marking the item as errored
- **Evidence:** Mock 429 → verify retry attempts → eventual success or error after 3 retries
- **Test:** Mock 429 responses → count retry attempts

---

## Phase 3: Listing Creation

### Image Sourcing

#### F26: Image sourcer module exists
- **Tag:** AUTO_VERIFY
- **Criterion:** An image sourcing service exists at `apps/web/src/lib/minifig-sync/image-sourcer.ts` that attempts to find 3 images per minifigure from multiple sources
- **Evidence:** File exists with exported function accepting BrickLink ID and name, returning array of image objects
- **Test:** File existence + export signature check

#### F27: Multi-source image search order
- **Tag:** AUTO_VERIFY
- **Criterion:** Image sourcing follows the priority stack: (1) non-stock sourced images via web search, (2) Rebrickable catalogue, (3) BrickLink catalogue, (4) Bricqer stored image — stopping when 3 images are collected
- **Evidence:** Source priority ordering in code; images array reflects priority (sourced images first)
- **Test:** Code inspection + integration test with mocked sources

#### F28: Non-stock image hunting via Playwright
- **Tag:** AUTO_VERIFY
- **Criterion:** The image sourcer uses Playwright to search Google Images for non-stock minifigure photos, filtering for large images on white/neutral backgrounds without watermarks
- **Evidence:** Playwright navigation to Google Images with correct search query; image validation criteria applied
- **Test:** Code inspection for Playwright usage + search query construction

#### F29: Rebrickable catalogue image lookup
- **Tag:** AUTO_VERIFY
- **Criterion:** If fewer than 3 sourced images found, the system queries Rebrickable API at `GET /api/v3/lego/minifigs/{fig_num}/` and uses the `set_img_url` field
- **Evidence:** Rebrickable API called with correct fig_num; returned URL added to images array
- **Test:** Mock Rebrickable response → verify image URL extracted

#### F30: BrickLink catalogue image URL constructed
- **Tag:** AUTO_VERIFY
- **Criterion:** As a final fallback, the system constructs the BrickLink catalogue image URL as `https://img.bricklink.com/ItemImage/MN/0/{bricklink_id}.png`
- **Evidence:** URL follows the expected pattern with correct BrickLink ID substitution
- **Test:** Unit test on URL construction

#### F31: Image validation criteria enforced
- **Tag:** AUTO_VERIFY
- **Criterion:** Sourced images must meet: minimum 800x800px resolution, single subject in frame, no watermark detection
- **Evidence:** Images below 800x800 are rejected; validation function returns pass/fail
- **Test:** Unit test with undersized image → rejected; oversized → accepted

#### F32: Images stored in sync item as JSONB
- **Tag:** AUTO_VERIFY
- **Criterion:** Each minifig's images are stored in `minifig_sync_items.images` as JSONB array with objects containing `source`, `url`, and `type` ('stock', 'sourced', 'original')
- **Evidence:** Query images column → valid JSON array with expected fields
- **Test:** After image sourcing → query DB → parse JSONB → verify structure

### Image Processing

#### F33: Server-side image processing with Sharp
- **Tag:** AUTO_VERIFY
- **Criterion:** Before upload to eBay, images are processed server-side with Sharp: resized to max 1600x1600px maintaining aspect ratio, transparent PNGs get white background fill, light sharpening applied, output as JPEG at quality 85
- **Evidence:** Sharp dependency installed; processing function applies all 4 operations
- **Test:** Process a test PNG → verify output is JPEG, <= 1600px, white background

### Description Generation

#### F34: Claude API generates listing descriptions
- **Tag:** AUTO_VERIFY
- **Criterion:** An eBay listing description is generated via Claude API using the prompt template from spec, including: minifig identification, set appearances (from Rebrickable), condition description, what's included, and collectibility note — formatted as HTML under 300 words
- **Evidence:** Generated description contains HTML tags; word count <= 300; includes BrickLink ID and set references
- **Test:** Generate description for known minifig → verify HTML format + word count + required content

#### F35: Set appearances fetched from Rebrickable
- **Tag:** AUTO_VERIFY
- **Criterion:** Before description generation, the system calls `GET /api/v3/lego/minifigs/{fig_num}/sets/` to get the sets this minifigure appears in, and passes them to the Claude prompt
- **Evidence:** Rebrickable sets API called; set names/numbers included in prompt context
- **Test:** Mock Rebrickable sets response → verify set data passed to Claude prompt

### eBay Staging

#### F36: Create staged eBay listings API route exists
- **Tag:** AUTO_VERIFY
- **Criterion:** `POST /api/minifigs/sync/create-listings` creates eBay inventory items and unpublished offers for qualifying minifigs (those with `meets_threshold = TRUE` and `listing_status = 'NOT_LISTED'`)
- **Evidence:** Route file exists; only processes qualifying minifigs
- **Test:** Seed qualifying + non-qualifying minifigs → call route → verify only qualifying get processed

#### F37: eBay inventory item created with correct data
- **Tag:** AUTO_VERIFY
- **Criterion:** The eBay Inventory API `PUT /sell/inventory/v1/inventory_item/{sku}` is called with SKU = `HB-MF-{bricqer_item_id}`, product title, description, image URLs, and aspects (Brand: LEGO, Type: Minifigure, Condition: USED_EXCELLENT)
- **Evidence:** eBay API request body matches expected structure with correct SKU prefix
- **Test:** Mock eBay API → capture request → verify body structure

#### F38: eBay offer created but NOT published
- **Tag:** AUTO_VERIFY
- **Criterion:** An eBay offer is created via `POST /sell/inventory/v1/offer` with correct pricing (recommended_price), Best Offer enabled (auto-accept at 95%, auto-decline at 75%), marketplace EBAY_GB, and business policies attached — but `publish` is NOT called
- **Evidence:** Offer creation API called; publish API NOT called; `listing_status = 'STAGED'`
- **Test:** Mock eBay APIs → verify offer created → verify publish NOT called → verify DB status

#### F39: Sync item updated to STAGED status
- **Tag:** AUTO_VERIFY
- **Criterion:** After staging, the `minifig_sync_items` row is updated with `listing_status = 'STAGED'`, `ebay_sku`, `ebay_offer_id`, and `updated_at`
- **Evidence:** Query row after staging → all fields populated; status = 'STAGED'
- **Test:** Create listing → query DB → verify fields

### Review Queue UI

#### F40: Review queue page exists at /minifigs/review
- **Tag:** AUTO_VERIFY
- **Criterion:** A page exists at `/minifigs/review` (within the dashboard layout) displaying all minifigs with `listing_status = 'STAGED'`
- **Evidence:** Page file exists; page renders with staged items
- **Test:** File existence at `apps/web/src/app/(dashboard)/minifigs/review/page.tsx`; Playwright navigation renders content

#### F41: Review card shows all required data
- **Tag:** AUTO_VERIFY
- **Criterion:** Each staged listing in the review queue displays: minifig name, BrickLink ID, 3 images with source labels, generated title (editable), generated description (editable), recommended price vs Bricqer price vs avg eBay sold price, market data summary (sold count, sell-through rate)
- **Evidence:** DOM contains elements for each data field
- **Test:** Playwright → navigate to review page → verify all elements present per card

#### F42: Publish action works
- **Tag:** AUTO_VERIFY
- **Criterion:** Clicking "Publish" on a staged listing calls `POST /api/minifigs/sync/publish` which calls eBay `POST /sell/inventory/v1/offer/{offerId}/publish`, and updates `listing_status = 'PUBLISHED'` with `ebay_listing_id` and `ebay_listing_url` stored
- **Evidence:** After publish → eBay publish API called → DB shows PUBLISHED status with listing URL
- **Test:** Mock eBay publish → click publish → verify API called + DB updated

#### F43: Reject action works
- **Tag:** AUTO_VERIFY
- **Criterion:** Clicking "Reject" on a staged listing calls `POST /api/minifigs/sync/reject` which deletes the eBay inventory item and offer, and updates `listing_status = 'NOT_LISTED'`
- **Evidence:** After reject → eBay delete APIs called → DB shows NOT_LISTED status
- **Test:** Mock eBay delete → click reject → verify APIs called + DB updated

#### F44: Bulk publish action
- **Tag:** AUTO_VERIFY
- **Criterion:** A "Bulk Publish" button publishes all staged listings that pass the quality check in a single operation
- **Evidence:** All qualifying staged items transition to PUBLISHED after bulk publish
- **Test:** Seed 3 staged items (2 passing quality, 1 failing) → bulk publish → verify 2 published, 1 remains staged

#### F45: Quality check enforced before publish
- **Tag:** AUTO_VERIFY
- **Criterion:** A listing cannot be published unless it passes: at least 2 images present, description > 50 characters, price > £0, all required eBay fields populated
- **Evidence:** Attempting to publish a listing with < 2 images returns a validation error
- **Test:** Create listing with 1 image → attempt publish → verify rejection with reason

#### F46: Edit functionality in review queue
- **Tag:** AUTO_VERIFY
- **Criterion:** Title, description, and price are editable inline in the review queue, and changes are saved to both the sync table and the eBay offer (via API update)
- **Evidence:** Edit title → save → DB updated + eBay offer updated
- **Test:** Playwright: edit title field → save → verify DB change + eBay API called

#### F47: Refresh pricing button per minifig
- **Tag:** AUTO_VERIFY
- **Criterion:** Each minifig in the review queue has a "Refresh pricing" button that calls the force-refresh research endpoint and updates the displayed pricing data
- **Evidence:** Button exists; clicking triggers research/refresh API; pricing data updates
- **Test:** Playwright: click refresh → verify API called → verify UI updated

### Error Handling (Phase 3)

#### E5: Image sourcing failure uses fallback
- **Tag:** AUTO_VERIFY
- **Criterion:** If Google Images search fails (network error, no results), the system continues to Rebrickable/BrickLink catalogue images without erroring the entire listing
- **Evidence:** After Google failure, catalogue images are still collected; listing creation proceeds
- **Test:** Mock Google failure → verify catalogue images used → listing still staged

#### E6: eBay inventory item creation failure recorded
- **Tag:** AUTO_VERIFY
- **Criterion:** If eBay API returns an error during inventory item or offer creation, the error is logged in `minifig_sync_jobs.error_log`, the item's status remains `NOT_LISTED`, and other items in the batch continue processing
- **Evidence:** Mock eBay error → item stays NOT_LISTED → other items still processed → error logged
- **Test:** Mock eBay 400 for one item → verify batch continues + error logged

#### E7: Claude API failure uses fallback description
- **Tag:** AUTO_VERIFY
- **Criterion:** If Claude API fails to generate a description, a template-based fallback description is used containing the minifig name, BrickLink ID, and condition
- **Evidence:** Mock Claude failure → listing still created with fallback description containing required fields
- **Test:** Mock Claude error → verify fallback description structure

---

## Phase 4: Cross-Platform Sync

### eBay Sale Detection

#### F48: eBay order polling cron route exists
- **Tag:** AUTO_VERIFY
- **Criterion:** `GET /api/cron/minifigs/poll-ebay-orders` polls the eBay Orders API for recent orders, filters for SKUs starting with `HB-MF-`, and creates removal queue entries
- **Evidence:** Route file exists; polls orders since last cursor; filters by SKU prefix
- **Test:** Mock eBay orders with HB-MF- SKU → verify removal queue entry created

#### F49: eBay sale creates removal queue entry
- **Tag:** AUTO_VERIFY
- **Criterion:** When an eBay sale with `HB-MF-` SKU is detected, a row is created in `minifig_removal_queue` with `sold_on = 'EBAY'`, `remove_from = 'BRICQER'`, sale details (price, date, order ID, order URL), and `status = 'PENDING'`
- **Evidence:** Removal queue row exists with correct fields after eBay sale detection
- **Test:** Trigger poll with mock sale → query removal queue → verify all fields

#### F50: Sync item status updated on eBay sale
- **Tag:** AUTO_VERIFY
- **Criterion:** When an eBay sale is detected, `minifig_sync_items.listing_status` is updated to `'SOLD_EBAY_PENDING_REMOVAL'`
- **Evidence:** Query sync item after sale → status = SOLD_EBAY_PENDING_REMOVAL
- **Test:** Trigger poll → verify status change

### Bricqer Sale Detection

#### F51: Bricqer order polling cron route exists
- **Tag:** AUTO_VERIFY
- **Criterion:** `GET /api/cron/minifigs/poll-bricqer-orders` polls Bricqer orders API for recent orders, matches items against `bricqer_item_id` in sync table, and creates removal queue entries
- **Evidence:** Route file exists; polls orders since last cursor; matches against sync table
- **Test:** Mock Bricqer order matching a sync item → verify removal queue entry

#### F52: Bricqer sale creates removal queue entry
- **Tag:** AUTO_VERIFY
- **Criterion:** When a Bricqer sale matching a published eBay listing is detected, a row is created in `minifig_removal_queue` with `sold_on = 'BRICQER'`, `remove_from = 'EBAY'`, and `status = 'PENDING'`
- **Evidence:** Removal queue row exists with `sold_on = 'BRICQER'`, `remove_from = 'EBAY'`
- **Test:** Trigger poll with mock Bricqer sale → query removal queue → verify fields

#### F53: Sync item status updated on Bricqer sale
- **Tag:** AUTO_VERIFY
- **Criterion:** When a Bricqer sale is detected for a published eBay item, `minifig_sync_items.listing_status` is updated to `'SOLD_BRICQER_PENDING_REMOVAL'`
- **Evidence:** Query sync item after sale → status = SOLD_BRICQER_PENDING_REMOVAL
- **Test:** Trigger poll → verify status change

### Removal Review Queue

#### F54: Removal queue page exists at /minifigs/removals
- **Tag:** AUTO_VERIFY
- **Criterion:** A page exists at `/minifigs/removals` displaying all removal queue entries with `status = 'PENDING'`
- **Evidence:** Page file exists; renders pending removals
- **Test:** File existence at `apps/web/src/app/(dashboard)/minifigs/removals/page.tsx`

#### F55: Removal card shows required data
- **Tag:** AUTO_VERIFY
- **Criterion:** Each pending removal displays: minifig name, BrickLink ID, which platform it sold on, sale price and date, what will be removed (Bricqer listing or eBay listing), and link to the order
- **Evidence:** DOM contains all required data elements per removal card
- **Test:** Playwright → navigate to removals → verify elements present

#### F56: Approve removal for eBay sale executes Bricqer deletion
- **Tag:** AUTO_VERIFY
- **Criterion:** Clicking "Approve Removal" on an eBay sale removal calls the Bricqer API to delete/zero the inventory item, updates removal status to `'EXECUTED'`, and updates sync item status to `'SOLD_EBAY'`
- **Evidence:** Bricqer API called → removal status = EXECUTED → sync status = SOLD_EBAY
- **Test:** Mock Bricqer delete → approve → verify all status changes

#### F57: Approve removal for Bricqer sale ends eBay listing
- **Tag:** AUTO_VERIFY
- **Criterion:** Clicking "Approve Removal" on a Bricqer sale removal calls eBay withdraw offer + delete inventory item, updates removal status to `'EXECUTED'`, and updates sync item status to `'SOLD_BRICQER'`
- **Evidence:** eBay withdraw + delete APIs called → removal status = EXECUTED → sync status = SOLD_BRICQER
- **Test:** Mock eBay APIs → approve → verify all status changes

#### F58: Bulk approve all pending removals
- **Tag:** AUTO_VERIFY
- **Criterion:** An "Approve All" button processes all pending removals in sequence, executing each removal and updating statuses
- **Evidence:** All PENDING removals transition to EXECUTED after bulk approve
- **Test:** Seed 3 pending removals → bulk approve → verify all EXECUTED

#### F59: Dismiss removal without action
- **Tag:** AUTO_VERIFY
- **Criterion:** Clicking "Dismiss" on a removal sets `status = 'DISMISSED'` without executing any API calls to eBay or Bricqer
- **Evidence:** No external APIs called; removal status = DISMISSED
- **Test:** Dismiss → verify no API calls → verify status = DISMISSED

#### F60: Discord notification on new removal
- **Tag:** AUTO_VERIFY
- **Criterion:** When a new removal queue entry is created, a Discord notification is sent to the configured alerts channel with minifig name, sale platform, and sale price
- **Evidence:** Discord webhook called with expected payload
- **Test:** Mock Discord webhook → trigger removal → verify webhook called with correct content

### Error Handling (Phase 4)

#### E8: Race condition — Bricqer already sold
- **Tag:** AUTO_VERIFY
- **Criterion:** If approving a removal tries to delete from Bricqer but the item returns 404/not-found (already sold/removed), the removal is still marked `'EXECUTED'` with a note rather than `'FAILED'`
- **Evidence:** Mock Bricqer 404 → removal status = EXECUTED with note
- **Test:** Mock 404 → approve → verify status + note

#### E9: Race condition — eBay already ended
- **Tag:** AUTO_VERIFY
- **Criterion:** If approving a removal tries to withdraw an eBay listing but it's already ended/sold, the removal is still marked `'EXECUTED'` with a note rather than `'FAILED'`
- **Evidence:** Mock eBay error (already ended) → removal status = EXECUTED with note
- **Test:** Mock eBay error → approve → verify status + note

#### E10: Removal execution failure recorded
- **Tag:** AUTO_VERIFY
- **Criterion:** If a removal execution fails for a non-race-condition reason (network error, auth failure), the removal status is set to `'FAILED'` with `error_message` populated
- **Evidence:** Mock network error → removal status = FAILED + error_message set
- **Test:** Mock network error → approve → verify FAILED + error message

#### E11: Polling cursor persists across invocations
- **Tag:** AUTO_VERIFY
- **Criterion:** The `last_poll_cursor` in `minifig_sync_jobs` is updated after each successful poll, so the next invocation only fetches new orders since the last cursor
- **Evidence:** First poll sets cursor; second poll starts from that cursor
- **Test:** Poll twice → verify second poll uses cursor from first

---

## Phase 5: Ongoing Operations

### Scheduled Jobs

#### F61: Daily inventory pull cron route
- **Tag:** AUTO_VERIFY
- **Criterion:** `GET /api/cron/minifigs/daily-inventory` triggers the Bricqer inventory pull and is configured for daily execution
- **Evidence:** Route file exists; calls the same pull logic as F6; returns success/failure
- **Test:** Route responds to GET with cron secret

#### F62: Research refresh cron route
- **Tag:** AUTO_VERIFY
- **Criterion:** `GET /api/cron/minifigs/research-refresh` identifies minifigs with expired price cache and re-runs research for them
- **Evidence:** Only processes items where cache `expires_at < NOW()`; fresh caches skipped
- **Test:** Seed expired + fresh cache entries → run cron → verify only expired researched

#### F63: eBay order poll runs every 15 minutes
- **Tag:** AUTO_VERIFY
- **Criterion:** The eBay order polling cron is configured with a 15-minute schedule (or configurable via `poll_interval_minutes` in config table)
- **Evidence:** Vercel cron config or route documentation specifies 15-minute interval
- **Test:** Check vercel.json or cron config

#### F64: Bricqer order poll runs every 15 minutes
- **Tag:** AUTO_VERIFY
- **Criterion:** The Bricqer order polling cron is configured with a 15-minute schedule matching the eBay poll interval
- **Evidence:** Vercel cron config specifies 15-minute interval
- **Test:** Check vercel.json or cron config

### Repricing

#### F65: Stale listing detection
- **Tag:** AUTO_VERIFY
- **Criterion:** Listings with `listing_status = 'PUBLISHED'` that have been listed for more than `reprice_after_days` (default 85 days) are flagged for repricing review
- **Evidence:** Query identifies listings older than threshold; repricing data refreshed
- **Test:** Seed listing 90 days old → stale check → verify flagged

#### F66: Repricing re-runs market research
- **Tag:** AUTO_VERIFY
- **Criterion:** When a stale listing is repriced, market research is re-run (bypassing cache) and the recommended price is recalculated based on fresh data
- **Evidence:** Cache is refreshed; new recommended_price calculated; eBay offer updated
- **Test:** Mock fresh research data → reprice → verify new price on eBay offer

### Dashboard

#### F67: Minifig sync dashboard page exists
- **Tag:** AUTO_VERIFY
- **Criterion:** A dashboard page exists at `/minifigs` showing sync overview metrics
- **Evidence:** Page file exists at `apps/web/src/app/(dashboard)/minifigs/page.tsx`
- **Test:** File existence check

#### F68: Dashboard shows required metrics
- **Tag:** AUTO_VERIFY
- **Criterion:** The dashboard displays: total minifigs in Bricqer inventory, total meeting threshold, count by status (staged/published/sold), revenue from eBay minifig sales, fee savings (3.5% Bricqer fee avoided), and average time to sell
- **Evidence:** DOM contains metric elements with correct labels and non-zero values (when data exists)
- **Test:** Seed data across statuses → navigate to dashboard → verify all 6 metrics displayed

#### F69: Dashboard API route
- **Tag:** AUTO_VERIFY
- **Criterion:** `GET /api/minifigs/dashboard` returns aggregated metrics calculated from `minifig_sync_items` and `minifig_removal_queue` data
- **Evidence:** API returns JSON with all expected metric fields
- **Test:** Seed data → call API → verify response shape and calculated values

---

## Integration Criteria

#### I1: All SKUs use HB-MF- prefix
- **Tag:** AUTO_VERIFY
- **Criterion:** Every eBay SKU created by this system uses the format `HB-MF-{bricqer_item_id}` — no exceptions
- **Evidence:** Grep codebase for SKU construction; all paths use the prefix; database query shows all ebay_sku values start with HB-MF-
- **Test:** Code grep + DB query on ebay_sku column

#### I2: No automatic publishing — all listings stage first
- **Tag:** AUTO_VERIFY
- **Criterion:** The listing creation flow NEVER calls eBay publish API; publish only occurs through the review queue UI actions (F42, F44)
- **Evidence:** Code grep for `publish` in create-listings route returns no hits; only review/publish route calls publish
- **Test:** Grep codebase for publish calls; verify only in publish route

#### I3: No automatic removals — all sales queue for review
- **Tag:** AUTO_VERIFY
- **Criterion:** Sale detection (eBay or Bricqer) NEVER directly calls delete/withdraw APIs; removals only execute through the removal queue approval actions (F56, F57, F58)
- **Evidence:** Code grep for Bricqer delete/eBay withdraw in poll routes returns no hits; only in approve route
- **Test:** Grep poll routes for delete/withdraw calls; verify none present

#### I4: Config values from database, not hardcoded
- **Tag:** AUTO_VERIFY
- **Criterion:** All threshold values (min_sold_count, min_sell_through_rate, min_avg_sold_price, min_estimated_profit, packaging_cost, ebay_fvf_rate, price_cache_months, reprice_after_days) are read from `minifig_sync_config` table, not hardcoded
- **Evidence:** Grep codebase for hardcoded threshold values; all references go through config lookup
- **Test:** Grep for literal threshold values in business logic files; verify absent

#### I5: Price floor respected
- **Tag:** AUTO_VERIFY
- **Criterion:** No listing is ever created with a price below `bricqer_price + £1.00`
- **Evidence:** Unit test with bricqer_price = £5.00 and avg_sold_price = £4.00 → recommended price = £6.00 (floor), not £4.20
- **Test:** Test pricing engine with low avg_sold_price → verify floor applied

#### I6: Encrypted credentials for eBay session cookies
- **Tag:** AUTO_VERIFY
- **Criterion:** eBay session cookies used by Terapeak scraper are stored encrypted via the existing `CredentialsRepository` pattern, not in plaintext
- **Evidence:** Cookie loading code uses `credentialsRepo.getCredentials()`; no plaintext cookie storage
- **Test:** Code grep for cookie handling → verify uses credentials repository

#### I7: TypeScript types generated
- **Tag:** AUTO_VERIFY
- **Criterion:** After all migrations, `npm run db:types` is run and the generated types include all minifig sync tables
- **Evidence:** Generated type file contains interfaces for all 5 tables
- **Test:** Grep generated types for `minifig_sync_items`, `minifig_price_cache`, etc.

---

## Performance Criteria

#### P1: Inventory pull handles 500+ minifigures
- **Tag:** AUTO_VERIFY
- **Criterion:** The Bricqer inventory pull successfully processes 500 minifigures across multiple pages without timeout (within Vercel's 300s limit)
- **Evidence:** Sync job shows items_processed = 500 with status = COMPLETED
- **Test:** Mock Bricqer with 500 items → run pull → verify completion within timeout

#### P2: Market research batch processes with rate limiting
- **Tag:** AUTO_VERIFY
- **Criterion:** Market research processes minifigures sequentially with rate limiting (3s between Terapeak calls) and can be resumed across multiple cron invocations (cursor-based)
- **Evidence:** Job tracks cursor; subsequent invocations resume from cursor; no rate limit violations
- **Test:** Start research on 10 items → verify 3s delays → verify cursor persistence

#### P3: Review queue page loads under 3 seconds
- **Tag:** AUTO_VERIFY
- **Criterion:** The review queue page (`/minifigs/review`) with 20 staged listings loads and renders within 3 seconds
- **Evidence:** Playwright page load timing < 3000ms
- **Test:** Seed 20 staged items → Playwright navigate → measure load time

#### P4: Order polling completes under 30 seconds
- **Tag:** AUTO_VERIFY
- **Criterion:** Both eBay and Bricqer order polling cron routes complete within 30 seconds for typical order volumes (< 50 new orders per poll)
- **Evidence:** Cron execution time < 30000ms
- **Test:** Mock 50 orders → time execution → verify under 30s

---

## Out of Scope

- Bricqer's native eBay integration (explicitly bypassed)
- Automatic publishing without review (always staged first)
- Automatic removals without review (always queued for approval)
- New/sealed minifigure listings (used only)
- Non-minifigure items (minifigures only)
- eBay Platform Notifications webhook (polling first; webhook is a future enhancement)
- Image copyright verification beyond basic heuristics
- Multi-user support (single user: Chris)
- Mobile-specific UI optimisation

## Dependencies

- eBay OAuth 2.0 connected and working (existing)
- Bricqer API credentials configured (existing)
- BrickLink API credentials configured (existing)
- Rebrickable API key configured
- Claude API key configured (existing)
- Playwright available in Node.js environment
- Sharp npm package installable
- Discord webhook configured for alerts (existing)

## Iteration Budget

- **Max iterations:** 8
- **Escalation:** If not converged after 8 iterations, pause for human review
- **Note:** This is a large feature spanning 5 phases. Consider phased implementation with verification checkpoints after each phase.
