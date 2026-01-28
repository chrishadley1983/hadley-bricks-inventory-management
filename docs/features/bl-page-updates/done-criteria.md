# Done Criteria: bl-page-updates

**Created:** 2026-01-28
**Author:** Define Done Agent + Chris
**Status:** DRAFT - AWAITING APPROVAL

## Feature Summary

Consolidate and improve the arbitrage tracker pages: merge BrickLink, eBay, and Seeded ASINs into a single unified arbitrage page with tab-based navigation; replace Margin % with COG % as the primary metric; add column sorting; fix sync status accuracy; and investigate BrickLink price entry exclusions.

## Feature Context

**Problem:** The current arbitrage tracker has separate pages for Amazon, eBay, BrickLink, and Seeded ASINs, causing fragmented workflow. The Amazon page uses Margin % instead of COG % (which is more useful for purchasing decisions). Column headers aren't clickable for sorting. Sync status times are inaccurate/misleading. Some BrickLink price entries have data quality issues (artificially low prices from sellers with high minimum spend/shipping).

**User:** Business owner (Chris)
**Trigger:** User navigates to `/arbitrage` page
**Outcome:** Single unified arbitrage page with accurate sync status, COG%-based filtering/sorting, and clickable column headers

## Success Criteria

### Functional - Page Consolidation

#### F1: Unified Arbitrage Route
- **Tag:** AUTO_VERIFY
- **Criterion:** Route `/arbitrage` exists and renders the unified arbitrage page
- **Evidence:** Navigation to `/arbitrage` loads the page without 404
- **Test:** `await page.goto('/arbitrage'); expect(page.url()).toContain('/arbitrage')`

#### F2: Tab-Based Navigation
- **Tag:** AUTO_VERIFY
- **Criterion:** Page has three main tabs: "BrickLink" (Amazon→BrickLink), "eBay" (Amazon→eBay), and "Seeded" (Seeded Discovery)
- **Evidence:** DOM contains TabsList with three TabsTrigger elements with text matching expected labels
- **Test:** `document.querySelectorAll('[role="tab"]').length === 3`

#### F3: Default Tab Selection
- **Tag:** AUTO_VERIFY
- **Criterion:** "BrickLink" tab is selected by default on page load
- **Evidence:** First tab has `aria-selected="true"` attribute on initial render
- **Test:** `document.querySelector('[role="tab"][aria-selected="true"]').textContent.includes('BrickLink')`

#### F4: Tab Content Switching
- **Tag:** AUTO_VERIFY
- **Criterion:** Clicking each tab renders the corresponding content panel without page reload
- **Evidence:** TabsContent changes based on active tab, URL may update with tab param but no full refresh
- **Test:** Click each tab, verify content panel updates

#### F5: Old Routes Redirect
- **Tag:** AUTO_VERIFY
- **Criterion:** Old routes `/arbitrage/amazon` and `/arbitrage/ebay` redirect to `/arbitrage` with appropriate tab selected
- **Evidence:** Navigation to old routes results in redirect to unified page
- **Test:** `await page.goto('/arbitrage/amazon'); expect(page.url()).toBe('/arbitrage?tab=bricklink')`

#### F6: Seeded ASINs Tab Redirect
- **Tag:** AUTO_VERIFY
- **Criterion:** Old route `/arbitrage/seeded` redirects to `/arbitrage?tab=seeded`
- **Evidence:** Navigation to old route redirects correctly
- **Test:** `await page.goto('/arbitrage/seeded'); expect(page.url()).toContain('tab=seeded')`

#### F7: Vinted Remains Separate
- **Tag:** AUTO_VERIFY
- **Criterion:** Vinted arbitrage page at `/arbitrage/vinted` is NOT affected and remains a separate page
- **Evidence:** `/arbitrage/vinted` loads its own page, not redirected
- **Test:** `await page.goto('/arbitrage/vinted'); expect(page.title()).toContain('Vinted')`

#### F8: Page Title Updated
- **Tag:** AUTO_VERIFY
- **Criterion:** Page header shows "BrickLink -> Amazon Arbitrage" when BrickLink tab is active (renamed from "Arbitrage Tracker - Amazon")
- **Evidence:** Header component text matches expected title
- **Test:** `document.querySelector('[data-testid="page-header"]').textContent.includes('BrickLink -> Amazon')`

### Functional - COG % Replacement

#### F9: COG Column Replaces Margin Column
- **Tag:** AUTO_VERIFY
- **Criterion:** Table column header shows "COG %" instead of "Margin"
- **Evidence:** Table header text is "COG %" not "Margin" or "Margin %"
- **Test:** `document.querySelector('th').textContent === 'COG %'` (for the appropriate column)

#### F10: COG Badge Color Coding
- **Tag:** AUTO_VERIFY
- **Criterion:** COG % values are displayed in colored badges: green (<=40%), amber (41-50%), default (>50%)
- **Evidence:** Badge CSS classes match expected color thresholds
- **Test:** Verify badge class includes `bg-green-500` for 35%, `bg-amber-500` for 45%, default for 55%

#### F11: Max COG Filter Control
- **Tag:** AUTO_VERIFY
- **Criterion:** Filter bar has "Max COG" input with default value of 50%
- **Evidence:** Input element with label "Max COG" exists with value="50"
- **Test:** `document.querySelector('input[name="maxCog"]').value === '50'`

#### F12: COG Filter Applied on Load
- **Tag:** AUTO_VERIFY
- **Criterion:** On initial page load, only items with COG % <= 50% are shown (opportunities filter active)
- **Evidence:** API request includes `maxCog=50` and `show=opportunities` parameters
- **Test:** Intercept network request, verify query params

#### F13: Opportunities Summary Uses COG
- **Tag:** AUTO_VERIFY
- **Criterion:** Summary card shows "Opportunities" count based on COG % threshold (<=maxCog%), not Margin %
- **Evidence:** Summary card description shows "<=50% COG" (or current maxCog value)
- **Test:** `document.querySelector('[data-testid="opportunities-card"] p').textContent.includes('COG')`

### Functional - Column Sorting

#### F14: Sortable Column Headers
- **Tag:** AUTO_VERIFY
- **Criterion:** All table column headers are clickable and trigger sorting
- **Evidence:** Column headers have `cursor-pointer` class and onClick handler
- **Test:** Click each header, verify it triggers sort

#### F15: Sort Indicator Display
- **Tag:** AUTO_VERIFY
- **Criterion:** Active sort column shows ascending/descending indicator (arrow icon)
- **Evidence:** Sorted column header contains ChevronUp or ChevronDown icon
- **Test:** `document.querySelector('[data-testid="sort-indicator"]')` exists on sorted column

#### F16: Sort Toggle Behavior
- **Tag:** AUTO_VERIFY
- **Criterion:** Clicking same column header toggles between ascending and descending sort
- **Evidence:** First click = ascending, second click = descending, third click = ascending
- **Test:** Click header twice, verify sort direction changes

#### F17: Default Sort Order
- **Tag:** AUTO_VERIFY
- **Criterion:** On page load, table is sorted by COG % ascending (lowest/best first)
- **Evidence:** First row has lowest COG % value, API request has `sortField=cog&sortDirection=asc`
- **Test:** Verify first row's COG % <= all other rows' COG %

#### F18: Sort Columns Available
- **Tag:** AUTO_VERIFY
- **Criterion:** Following columns are sortable: Item, Your Price, Buy Box, Was Price, Rank, BL Min, COG %, BL Lots
- **Evidence:** Each column header triggers API request with corresponding sortField
- **Test:** Click each header, verify sortField param in network request

#### F19: Sort State Persists in URL
- **Tag:** AUTO_VERIFY
- **Criterion:** Sort field and direction are reflected in URL query params
- **Evidence:** URL shows `?sortField=cog&sortDirection=asc` format
- **Test:** Change sort, verify URL updates; refresh page, verify sort preserved

### Functional - Sync Status Accuracy

#### F20: Sync Status Shows Actual Last Run
- **Tag:** AUTO_VERIFY
- **Criterion:** Sync status badges show `lastRunAt` timestamp from `arbitrage_sync_status` table, not hardcoded schedules
- **Evidence:** Relative time (e.g., "3 hours ago") matches actual database timestamp
- **Test:** Query database for `last_run_at`, compare with UI display

#### F21: Sync Status Distinguishes Success/Failure
- **Tag:** AUTO_VERIFY
- **Criterion:** Sync status shows different indicator for successful vs failed last run
- **Evidence:** Badge shows green check for success, red X for failed, amber clock for stale
- **Test:** Set status to 'failed' in DB, verify red indicator displays

#### F22: Remove Hardcoded Schedule Display
- **Tag:** AUTO_VERIFY
- **Criterion:** The static schedule text (e.g., "4:00am", "2:30am") is removed from sync status badges
- **Evidence:** Badge only shows relative time, not scheduled time
- **Test:** `document.querySelector('.sync-badge').textContent` does not contain "am" or "pm"

#### F23: Sync Status Tooltip Details
- **Tag:** AUTO_VERIFY
- **Criterion:** Hovering over sync status badge shows tooltip with: last run timestamp, items processed, items failed, duration
- **Evidence:** Tooltip contains detailed sync information from database
- **Test:** Hover over badge, verify tooltip displays expected fields

#### F24: Sync Status Refresh
- **Tag:** AUTO_VERIFY
- **Criterion:** Sync status data refreshes every 30 seconds (existing behavior preserved)
- **Evidence:** React Query staleTime is 30000ms for syncStatus query
- **Test:** Verify `staleTime: 30 * 1000` in useSyncStatus hook

### Functional - Per-ASIN Minimum BrickLink Price Override

#### F25: BrickLink API Limitation Documented
- **Tag:** AUTO_VERIFY
- **Criterion:** Documentation exists explaining that BrickLink API does not return seller IDs, making per-seller exclusions impossible
- **Evidence:** File `docs/features/bl-page-updates/bricklink-api-limitations.md` exists with explanation
- **Test:** File exists and contains "seller" and "anonymous" keywords

#### F26: Per-ASIN Min BL Price Field in Detail Modal
- **Tag:** AUTO_VERIFY
- **Criterion:** Item detail modal shows editable "Min BL Price" input field for overriding the minimum BrickLink price used in COG calculation
- **Evidence:** Input element with label "Min BL Price Override" in detail modal
- **Test:** Open item detail, verify input field exists and is editable

#### F27: Min BL Price Override Persists to Database
- **Tag:** AUTO_VERIFY
- **Criterion:** When user sets a Min BL Price override for an ASIN, it is saved to database and persists across page reloads and data syncs
- **Evidence:** Table `asin_bricklink_mappings` (or new column) stores `min_bl_price_override` per ASIN
- **Test:** Set override to £8 for ASIN, reload page, verify £8 still shown

#### F28: Override Survives BrickLink Sync
- **Tag:** AUTO_VERIFY
- **Criterion:** When BrickLink pricing sync runs, the per-ASIN min price override is NOT overwritten - it remains as user-configured
- **Evidence:** After sync, override value unchanged in database
- **Test:** Set override, trigger BrickLink sync, verify override still set

#### F29: COG Calculation Uses Override When Set
- **Tag:** AUTO_VERIFY
- **Criterion:** When an ASIN has a min_bl_price_override set, COG % is calculated using MAX(actual_bl_min, override) as the BL price
- **Evidence:** COG % increases when override > actual BL min price
- **Test:** Item with BL Min £4.50, set override £8, verify COG % recalculates using £8

#### F30: Override Indicator in Table
- **Tag:** AUTO_VERIFY
- **Criterion:** Items with a min BL price override show visual indicator in the table (e.g., asterisk, icon, or different color on BL Min cell)
- **Evidence:** DOM element indicates override is active
- **Test:** Set override on item, verify indicator visible in table row

#### F31: Clear Override Option
- **Tag:** AUTO_VERIFY
- **Criterion:** User can clear/remove the min BL price override to revert to actual BrickLink pricing
- **Evidence:** "Clear" or "Reset" button next to override input in detail modal
- **Test:** Set override, click clear, verify override removed and COG recalculates

### Error Handling

#### E1: Empty State Message
- **Tag:** AUTO_VERIFY
- **Criterion:** When no items match current filters, shows helpful empty state message with filter reset option
- **Evidence:** Empty state div visible with "No items found" text and "Reset filters" button
- **Test:** Apply restrictive filters, verify empty state renders

#### E2: Sync Error Display
- **Tag:** AUTO_VERIFY
- **Criterion:** When sync status indicates failure, error message from database is displayed
- **Evidence:** Sync badge tooltip shows `errorMessage` from last failed run
- **Test:** Set `error_message` in DB, verify it displays in UI

#### E3: Tab Error Isolation
- **Tag:** AUTO_VERIFY
- **Criterion:** Error in one tab (e.g., eBay API failure) does not prevent other tabs from loading
- **Evidence:** Error boundary isolates tab content, other tabs remain functional
- **Test:** Mock eBay API error, verify BrickLink tab still works

### Performance

#### P1: Tab Switch Speed
- **Tag:** AUTO_VERIFY
- **Criterion:** Switching between tabs renders content in under 500ms (no full page reload)
- **Evidence:** Time from click to content visible < 500ms
- **Test:** Measure time from tab click to content render

#### P2: Initial Load Performance
- **Tag:** AUTO_VERIFY
- **Criterion:** Page initial load with default filters completes in under 2 seconds
- **Evidence:** Time to interactive < 2000ms
- **Test:** Lighthouse/performance.now() measurement

#### P3: Sort Performance
- **Tag:** AUTO_VERIFY
- **Criterion:** Column sort triggers API request and updates table in under 1 second
- **Evidence:** Time from click to table update < 1000ms
- **Test:** Measure sort operation duration

### UI/UX

#### U1: Consistent Styling
- **Tag:** AUTO_VERIFY
- **Criterion:** Unified page uses same Card, Table, Badge, Skeleton components as existing eBay page
- **Evidence:** Component imports match shadcn/ui library
- **Test:** Code inspection for component imports

#### U2: Responsive Layout
- **Tag:** AUTO_VERIFY
- **Criterion:** Page layout adapts correctly at 375px, 768px, and 1024px breakpoints
- **Evidence:** No horizontal scroll, readable content at all breakpoints
- **Test:** Viewport resize testing

#### U3: Loading Skeletons
- **Tag:** AUTO_VERIFY
- **Criterion:** Tab content shows skeleton loading state while data fetches
- **Evidence:** Skeleton components render during isLoading state
- **Test:** Slow network, verify skeletons appear

#### U4: Tab Badge Counts
- **Tag:** AUTO_VERIFY
- **Criterion:** Each tab shows opportunity count badge (e.g., "BrickLink (1210)")
- **Evidence:** Badge element with count visible in tab trigger
- **Test:** Verify badge numbers match summary data

### Integration

#### I1: Sidebar Navigation Updated
- **Tag:** AUTO_VERIFY
- **Criterion:** Sidebar "ARBITRAGE TRACKER" section shows: "Arbitrage" (unified), "Vinted" (separate)
- **Evidence:** Sidebar nav items updated from individual pages to consolidated structure
- **Test:** Verify sidebar DOM structure

#### I2: Existing Hooks Reused
- **Tag:** AUTO_VERIFY
- **Criterion:** Page uses existing `useArbitrageData`, `useSyncStatus`, `useArbitrageSummary` hooks
- **Evidence:** No duplicate hook implementations
- **Test:** Code inspection for hook imports

#### I3: API Routes Unchanged
- **Tag:** AUTO_VERIFY
- **Criterion:** Backend API routes `/api/arbitrage/*` remain unchanged (frontend-only refactor)
- **Evidence:** No changes to route.ts files in api/arbitrage/
- **Test:** Git diff shows no changes to API routes

## Out of Scope

- Per-seller BrickLink exclusions (API limitation - sellers are anonymous)
- Per-listing BrickLink exclusions (API returns no listing IDs)
- Global/user-level BrickLink price filters (replaced by per-ASIN override)
- Country-level filtering (not needed with per-ASIN approach)
- Vinted page changes (remains separate)
- New sync triggers or cron job changes
- Mobile app / PWA considerations

## Dependencies

- Existing arbitrage infrastructure (API routes, services, hooks)
- `arbitrage_sync_status` table with accurate timestamp tracking
- `asin_bricklink_mappings` table (or similar) for storing per-ASIN overrides

## Iteration Budget

- **Max iterations:** 5
- **Escalation:** If not converged after 5 iterations, pause for human review

## Notes on BrickLink API Limitations

Investigation confirms the BrickLink API returns **anonymized** seller data:
- `price_detail` array contains: `quantity`, `unit_price`, `shipping_available`, `seller_country_code`
- **NO seller ID, store name, or listing ID** is provided
- This makes per-seller or per-listing exclusions impossible via API

**Workaround implemented:** Per-ASIN minimum BrickLink price override allows users to set a floor price for specific ASINs where artificially low listings (high shipping/minimum spend sellers) skew the data. The override persists across syncs and is used in COG % calculation as MAX(actual_bl_min, override).
