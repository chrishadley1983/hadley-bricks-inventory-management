# Done Criteria: Arbitrage View Overhaul

**Created:** 2026-03-16
**Author:** Define Done Agent + Chris
**Status:** APPROVED

---

## Feature Summary

Overhaul the BrickLink arbitrage view (/arbitrage, BrickLink tab) to replace the misleading COG% metric with true Amazon FBM profit margin, add per-row data freshness indicators, provide advanced column-level filtering with proper server-side pagination, and clean up broken ASIN mappings that pollute the view.

**Problem:** The arbitrage view shows a simple COG% (BL price / Amazon price) that doesn't account for Amazon fees (~18.36%) or shipping (£3-4), making profit estimates wildly inaccurate. Filters are limited, data freshness is unclear per-row, and broken seeded mappings clutter results.
**User:** Chris (business owner)
**Trigger:** Navigate to /arbitrage (BrickLink tab)
**Outcome:** Accurate profit margins, filterable columns, per-row freshness indicators, cleaned data

---

## Success Criteria

### Functional

#### F1: Replace COG% with Profit Margin %
- **Tag:** AUTO_VERIFY
- **Criterion:** The table column previously labelled "COG %" now displays "Margin %" calculated using the full Amazon FBM profit formula: `(salePrice - referralFee - DST - VATonFees - shipping - productCost) / salePrice * 100`, where referralFee=15%, DST=2% on referral, VAT=20% on fees, shipping=£3 (<£14) or £4 (>=£14)
- **Evidence:** For a row with Amazon price £100 and BL price £50: old COG% would show 50%, new Margin% should show ~27.6% (profit £27.64 / £100). Verify calculation matches `calculateAmazonFBMProfit(100, 50).profitMarginPercent`
- **Test:** Call `/api/arbitrage`, pick an item with known Amazon and BL prices, verify `marginPercent` in response matches `calculateAmazonFBMProfit(amazonPrice, blPrice).profitMarginPercent` within 0.1%

#### F2: Margin Filter Replaces COG Filter
- **Tag:** AUTO_VERIFY
- **Criterion:** The filter bar input labelled "Max COG" is replaced with "Min Margin %" (default 0%). Setting min margin to 20 returns only items where the calculated profit margin % >= 20. The API parameter `minMargin` filters on the new calculation, not the old COG%
- **Evidence:** Set min margin to 20%, verify every returned item has `marginPercent >= 20`
- **Test:** Call `/api/arbitrage?minMargin=20`, assert all returned items have `marginPercent >= 20.0`

#### F3: Per-Row Data Freshness Indicators
- **Tag:** AUTO_VERIFY
- **Criterion:** Each row displays two freshness indicators — one for Amazon data and one for BrickLink data — showing relative time (e.g., "2h ago", "3d ago"). Items with data older than 7 days show a visual "stale" indicator (amber/red styling or icon)
- **Evidence:** The API response includes `amazonFetchedAt` and `blFetchedAt` ISO timestamps per item. The table renders these as relative time strings. Items with null timestamps show "No data"
- **Test:** Verify API response contains `amazonFetchedAt` and `blFetchedAt` fields. Render the table component with test data containing timestamps from 1h ago, 3d ago, and 10d ago — verify correct relative labels and stale styling on the 10d item

#### F4: Advanced Column Filters
- **Tag:** AUTO_VERIFY
- **Criterion:** A collapsible "Filters" panel above the table provides filter controls for: Amazon Price (min/max range), BL Min Price (min/max range), Margin % (min/max range), Sales Rank (min/max range), BL Lots (min/max range), Qty (min/max range), Source (Inventory/Seeded dropdown), Data Freshness (max age in days). Each filter is additive (AND logic). Active filter count shown on the toggle button
- **Evidence:** Each filter maps to a query parameter sent to the API. The API applies corresponding WHERE clauses to the `arbitrage_current_view` query
- **Test:** Apply Amazon Price min=50 max=200, verify API request includes these params. Verify all returned items have Amazon price between 50 and 200. Repeat for each filter type

#### F5: Server-Side Pagination With All Filters
- **Tag:** AUTO_VERIFY
- **Criterion:** All new filters are applied server-side via the Supabase query on `arbitrage_current_view`. Pagination (page/pageSize) works correctly with any combination of filters. The `totalCount` in the response accurately reflects the filtered count, not total rows
- **Evidence:** Apply multiple filters, paginate through results. Verify: (a) page 2 starts where page 1 ended, (b) no duplicate items across pages, (c) totalCount matches the number of items matching filters, (d) results stay within Supabase 1000-row limit per page request
- **Test:** Apply filters that produce ~150 results with pageSize=50. Fetch pages 1, 2, 3. Assert no duplicates, page 3 has <=50 items, all items on all pages match filter criteria. Assert totalCount equals sum of items across all pages

#### F6: Sorting Works With New Columns
- **Tag:** AUTO_VERIFY
- **Criterion:** Sorting by Margin % (ascending and descending) returns correctly ordered results. Sorting by all existing sort fields (name, buy_box, was_price, sales_rank, bl_price, bl_lots) continues to work. Clicking a column header toggles sort direction
- **Evidence:** Sort by margin desc — first item has highest margin. Sort by margin asc — first item has lowest margin (among non-null values)
- **Test:** Fetch `/api/arbitrage?sortField=margin&sortDirection=desc`, verify items are ordered by marginPercent descending

### Error Handling

#### E1: Missing Price Data Handling
- **Tag:** AUTO_VERIFY
- **Criterion:** Items with null Amazon price or null BL price show "—" for Margin % (not 0%, not NaN, not an error). These items are excluded when filtering by margin range. Freshness shows "No data" when timestamp is null
- **Evidence:** Verify items with null `buy_box_price` AND null `was_price_90d` display "—" for margin. Verify they don't appear when `minMargin > 0`
- **Test:** Include items with null prices in test data. Assert margin display is "—". Assert filter `minMargin=1` excludes them

#### E2: Empty Filter Results
- **Tag:** AUTO_VERIFY
- **Criterion:** When filters produce zero results, the table shows "No items found" empty state with suggestion to adjust filters. Pagination shows "0 / 0" or is hidden
- **Evidence:** Set impossible filter combination (e.g., min margin 99%), verify empty state message appears
- **Test:** Call API with `minMargin=99`, verify response has `totalCount: 0` and empty items array. Verify UI renders empty state

### Performance

#### P1: Filter Response Time
- **Tag:** AUTO_VERIFY
- **Criterion:** API response time for `/api/arbitrage` with any combination of filters completes in under 3 seconds for the current dataset size (~2000 items in arbitrage_current_view)
- **Evidence:** Measure response time with various filter combinations
- **Test:** Time 5 different filter combinations, assert all complete within 3000ms

### UI/UX

#### U1: Filter Panel Layout
- **Tag:** HUMAN_VERIFY
- **Criterion:** The advanced filter panel is collapsible (hidden by default), shows active filter count on toggle button, and does not overwhelm the default view. Range inputs use inline min/max fields. The existing search bar and Show dropdown remain visible in the default (collapsed) state
- **Evidence:** Visual inspection of the filter panel in collapsed and expanded states
- **Verify:** Screenshot review — collapsed shows search + show + filter toggle badge; expanded shows all range inputs in a grid

#### U2: Freshness Indicator Visibility
- **Tag:** HUMAN_VERIFY
- **Criterion:** Data freshness indicators are compact (don't widen columns excessively) and use colour coding: green (<24h), amber (1-7d), red (>7d). Displayed as small text below or beside the relevant price columns
- **Evidence:** Visual inspection with items at various freshness levels
- **Verify:** Screenshot showing green, amber, and red freshness indicators on the same page

---

## Out of Scope

- eBay tab changes (separate feature)
- Seeded tab changes (separate feature)
- Bulk deletion of broken ASIN mappings (separate pre-requisite cleanup task)
- Adding new per-row "delete mapping" button (can be a follow-up)
- Changes to the detail modal (ArbitrageDetailModal)
- Changes to sync functionality
- Mobile responsiveness improvements

---

## Dependencies

- `arbitrage_current_view` SQL view must expose `amazon_fetched_at` and `bl_fetched_at` columns (may need view update)
- `calculateAmazonFBMProfit()` in `calculations.ts` — already exists
- Existing filter/pagination infrastructure in ArbitrageFilters and ArbitrageService

---

## Iteration Budget

- **Max iterations:** 5
- **Escalation:** If not converged after 5 iterations, pause for human review

---

## Verification Summary

| ID | Criterion | Tag | Status |
|----|-----------|-----|--------|
| F1 | Replace COG% with Profit Margin % | AUTO_VERIFY | PENDING |
| F2 | Margin filter replaces COG filter | AUTO_VERIFY | PENDING |
| F3 | Per-row data freshness indicators | AUTO_VERIFY | PENDING |
| F4 | Advanced column filters | AUTO_VERIFY | PENDING |
| F5 | Server-side pagination with all filters | AUTO_VERIFY | PENDING |
| F6 | Sorting works with new columns | AUTO_VERIFY | PENDING |
| E1 | Missing price data handling | AUTO_VERIFY | PENDING |
| E2 | Empty filter results | AUTO_VERIFY | PENDING |
| P1 | Filter response time <3s | AUTO_VERIFY | PENDING |
| U1 | Filter panel layout | HUMAN_VERIFY | PENDING |
| U2 | Freshness indicator visibility | HUMAN_VERIFY | PENDING |

**Total:** 11 criteria (9 AUTO_VERIFY, 2 HUMAN_VERIFY)

---

## Handoff

Ready for: `/build-feature arbitrage-view-overhaul`

**Key files likely affected:**
- `apps/web/src/components/features/arbitrage/ArbitrageTable.tsx` (margin column, freshness indicators)
- `apps/web/src/components/features/arbitrage/ArbitrageFilters.tsx` (advanced filter panel)
- `apps/web/src/app/api/arbitrage/route.ts` (new filter params)
- `apps/web/src/lib/arbitrage/arbitrage.service.ts` (filter logic, margin calculation in transform)
- `apps/web/src/lib/arbitrage/types.ts` (new filter types, response fields)
- `supabase/migrations/XXXXXXXXXX_arbitrage_view_freshness.sql` (new — expose timestamp columns in view)
