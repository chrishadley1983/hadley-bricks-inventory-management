# Done Criteria: listing-optimiser

**Created:** 2026-01-17
**Author:** Define Done Agent + Chris
**Status:** APPROVED

## Feature Summary

A listing optimisation tool for reviewing and improving existing eBay listings. Provides a dashboard view of all active eBay listings with quality metrics, AI-powered analysis against the eBay listing specification, specific improvement suggestions with one-by-one approval, pricing analysis with profit calculations, and direct application of changes to live listings via the eBay API.

## Success Criteria

### Functional - Core UI

#### F1: Listings Page Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Listings view page exists at `/listing-optimiser` and displays all active eBay listings from the user's account (including listings not linked to inventory)
- **Evidence:** Page loads at URL, table displays listings from eBay GetMyeBaySelling API
- **Test:** Navigate to `/listing-optimiser`, verify table renders with listing data

#### F2: Listings Table Columns
- **Tag:** AUTO_VERIFY
- **Criterion:** Listings table shows columns: Title, Price, Age (days), Views (90d), Watchers, Last Reviewed, Quality Score
- **Evidence:** DOM contains table headers matching all specified columns
- **Test:** `document.querySelectorAll('th')` returns headers for all 7 columns

#### F3: Filter Functionality
- **Tag:** AUTO_VERIFY
- **Criterion:** Listings can be filtered by: minimum age (days), minimum/maximum views, has watchers (yes/no), quality grade (A-F), reviewed status (reviewed/not reviewed)
- **Evidence:** Filter UI elements present, applying filters changes visible row count
- **Test:** Apply each filter type, verify filtered results count changes appropriately

#### F4: Sort Functionality
- **Tag:** AUTO_VERIFY
- **Criterion:** Listings can be sorted by any column (ascending/descending)
- **Evidence:** Clicking column header changes sort order, visual indicator shows sort direction
- **Test:** Click each column header, verify row order changes

#### F5: Multi-Select
- **Tag:** AUTO_VERIFY
- **Criterion:** User can multi-select listings using checkboxes
- **Evidence:** Checkboxes visible per row, selection count updates in UI
- **Test:** Select multiple rows, verify selection count matches

#### F6: Analyse Button State
- **Tag:** AUTO_VERIFY
- **Criterion:** "Analyse" button is visible and enabled when at least one listing is selected
- **Evidence:** Button disabled when 0 selected, enabled when >= 1 selected
- **Test:** Check button disabled state before/after selection

#### F7: Empty Selection Error
- **Tag:** AUTO_VERIFY
- **Criterion:** Clicking "Analyse" with no selection shows toast: "Select at least one listing"
- **Evidence:** Toast component appears with exact message
- **Test:** Click Analyse with 0 selections, verify toast appears

---

### Functional - Analysis

#### A1: Fetch Listing Data
- **Tag:** AUTO_VERIFY
- **Criterion:** Analysis fetches current listing data from eBay (title, description, item specifics, condition, price) via Trading API GetItem
- **Evidence:** API call made to GetItem, response data used in analysis
- **Test:** Network log shows GetItem request, analysis uses returned data

#### A2: AI Model
- **Tag:** AUTO_VERIFY
- **Criterion:** Analysis uses Gemini 3 Pro model (same as existing quality review)
- **Evidence:** Log output shows model ID `gemini-3-pro-preview`
- **Test:** Check server logs for model identifier during analysis

#### A3: Scoring Categories
- **Tag:** AUTO_VERIFY
- **Criterion:** Analysis scores listing on 5 categories: Title (25pts), Item Specifics (20pts), Description (25pts), Condition Accuracy (15pts), SEO (15pts)
- **Evidence:** Analysis response contains breakdown with all 5 categories and correct point allocations
- **Test:** Parse analysis response, verify all categories present with correct max scores

#### A4: Specification Alignment
- **Tag:** AUTO_VERIFY
- **Criterion:** Analysis criteria align with `docs/ebay-listing-specification.md` best practices (title length 65-80 chars, required item specifics, description structure, etc.)
- **Evidence:** AI prompt includes specification criteria, analysis checks against them
- **Test:** Review prompt content, verify spec rules included

#### A5: Overall Score and Grade
- **Tag:** AUTO_VERIFY
- **Criterion:** Analysis returns overall score (0-100) and grade (A+/A/B/C/D/F)
- **Evidence:** Response includes `score: number` and `grade: string` fields
- **Test:** Parse response, verify both fields present and valid

#### A6: Improvement Suggestions
- **Tag:** AUTO_VERIFY
- **Criterion:** For each category scoring below maximum, analysis generates specific improvement suggestions
- **Evidence:** Suggestions array contains entries for categories with non-perfect scores
- **Test:** Analyse listing with known issues, verify suggestions generated for those categories

---

### Functional - Suggestions Display

#### S1: Title Suggestion Format
- **Tag:** AUTO_VERIFY
- **Criterion:** For title suggestions: shows BOTH the complete replacement title AND an explanation of what changed (e.g., "Added set number, removed promotional text")
- **Evidence:** UI displays suggested title string AND change description string
- **Test:** Trigger title suggestion, verify both elements rendered

#### S2: Side-by-Side View
- **Tag:** AUTO_VERIFY
- **Criterion:** Side-by-side view shows current value on left, suggested value on right for each field
- **Evidence:** DOM structure contains left/right panels with current/suggested values
- **Test:** Visual inspection and DOM query for comparison layout

#### S3: Approval Buttons
- **Tag:** AUTO_VERIFY
- **Criterion:** Each suggestion has "Approve" and "Skip" buttons
- **Evidence:** Both buttons visible for each suggestion item
- **Test:** Query for button elements per suggestion

#### S4: One-by-One Approval
- **Tag:** AUTO_VERIFY
- **Criterion:** User approves/skips suggestions one at a time (not batch)
- **Evidence:** After approve/skip, next suggestion shown; no "approve all" button
- **Test:** Step through suggestions, verify sequential flow

---

### Functional - Pricing Analysis

#### PR1: Competitor Data
- **Tag:** AUTO_VERIFY
- **Criterion:** Pricing analysis fetches competitor data from eBay Finding API (active listings for same/similar items)
- **Evidence:** Finding API `findItemsByKeywords` or `findItemsByProduct` call made
- **Test:** Network log shows Finding API request for active listings

#### PR2: Sold Data
- **Tag:** AUTO_VERIFY
- **Criterion:** Pricing analysis fetches sold listings data from eBay Finding API (completed sales in last 90 days)
- **Evidence:** Finding API `findCompletedItems` call made with sold filter
- **Test:** Network log shows completed items request

#### PR3: Pricing Display
- **Tag:** AUTO_VERIFY
- **Criterion:** Pricing analysis displays: current price, average competitor price, average sold price, suggested price
- **Evidence:** UI shows all 4 price values
- **Test:** DOM contains elements for all 4 pricing metrics

#### PR4: Profit Estimate
- **Tag:** AUTO_VERIFY
- **Criterion:** For each pricing suggestion, displays estimated profit (£) using existing `calculateEbayProfit()` function
- **Evidence:** Profit value displayed in GBP format
- **Test:** Verify profit calculation matches expected output from `calculateEbayProfit()`

#### PR5: Profit Margin
- **Tag:** AUTO_VERIFY
- **Criterion:** For each pricing suggestion, displays profit margin (%)
- **Evidence:** Margin percentage displayed
- **Test:** Verify margin value present and formatted as percentage

#### PR6: Cost Source
- **Tag:** AUTO_VERIFY
- **Criterion:** Profit calculation uses the item's cost from inventory (`cost_price` field) when linked
- **Evidence:** Cost value matches linked inventory item's cost_price
- **Test:** Compare displayed cost to inventory record

#### PR7: No Cost Fallback
- **Tag:** AUTO_VERIFY
- **Criterion:** If listing is not linked to inventory (no cost data), pricing section shows "No cost data" instead of profit calculation
- **Evidence:** Unlinked listings display fallback message, no profit values
- **Test:** Analyse unlinked listing, verify fallback message displayed

---

### Functional - Apply Changes

#### AP1: ReviseItem API
- **Tag:** AUTO_VERIFY
- **Criterion:** Approved changes are applied to live eBay listing via Trading API ReviseItem
- **Evidence:** ReviseItem API call made with updated fields
- **Test:** Network log shows ReviseItem request with correct payload

#### AP2: Success Confirmation
- **Tag:** AUTO_VERIFY
- **Criterion:** Success confirmation shows after each change is applied
- **Evidence:** Toast or inline success message displayed
- **Test:** Apply change, verify success message appears

#### AP3: Auto Re-Analysis
- **Tag:** AUTO_VERIFY
- **Criterion:** After all approved changes are applied, listing is automatically re-analysed
- **Evidence:** New analysis triggered without user action
- **Test:** Apply changes, verify new analysis runs automatically

#### AP4: Score Comparison
- **Tag:** AUTO_VERIFY
- **Criterion:** Re-analysis results show new score compared to previous score (e.g., "72 → 85")
- **Evidence:** UI displays both old and new scores with arrow or comparison indicator
- **Test:** Compare displayed values to database records

---

### Dashboard/Summary

#### D1: Total Listings Count
- **Tag:** AUTO_VERIFY
- **Criterion:** Summary bar at top shows: Total Listings count
- **Evidence:** DOM element displays total count matching API response
- **Test:** Compare displayed count to listing array length

#### D2: Reviewed Count
- **Tag:** AUTO_VERIFY
- **Criterion:** Summary bar shows: Listings Reviewed count
- **Evidence:** Count matches listings with non-null `last_reviewed_at`
- **Test:** Compare to database query for reviewed listings

#### D3: Average Score
- **Tag:** AUTO_VERIFY
- **Criterion:** Summary bar shows: Average Score across reviewed listings
- **Evidence:** Calculated average displayed, matches manual calculation
- **Test:** Sum scores / reviewed count = displayed average

#### D4: Low Score Count
- **Tag:** AUTO_VERIFY
- **Criterion:** Summary bar shows: Low Score Count (listings with score < 70)
- **Evidence:** Count matches listings where quality_score < 70
- **Test:** Database query for score < 70 matches displayed count

#### D5: Dynamic Updates
- **Tag:** AUTO_VERIFY
- **Criterion:** Summary metrics update after each analysis completes
- **Evidence:** Values change after analysis without page refresh
- **Test:** Note values before analysis, verify they update after

---

### Data Persistence

#### DP1: Last Reviewed Timestamp
- **Tag:** AUTO_VERIFY
- **Criterion:** Each listing stores `last_reviewed_at` timestamp in database
- **Evidence:** Column exists and populated after analysis
- **Test:** Query database after analysis, verify timestamp set

#### DP2: Last Updated Timestamp
- **Tag:** AUTO_VERIFY
- **Criterion:** Each listing stores `last_updated_at` timestamp (when changes were applied) in database
- **Evidence:** Column exists and updated when ReviseItem succeeds
- **Test:** Query database after applying change, verify timestamp set

#### DP3: Quality Score Storage
- **Tag:** AUTO_VERIFY
- **Criterion:** Each listing stores `quality_score` (0-100) in database
- **Evidence:** Column exists with numeric value after analysis
- **Test:** Query database, verify score matches analysis result

#### DP4: Quality Grade Storage
- **Tag:** AUTO_VERIFY
- **Criterion:** Each listing stores `quality_grade` (A+/A/B/C/D/F) in database
- **Evidence:** Column exists with valid grade value after analysis
- **Test:** Query database, verify grade matches analysis result

#### DP5: Historical Reviews Table
- **Tag:** AUTO_VERIFY
- **Criterion:** Historical analysis results stored in `listing_quality_reviews` table (full history preserved, not overwritten)
- **Evidence:** New row inserted per analysis, old rows retained
- **Test:** Run multiple analyses, verify row count increases each time

---

### Error Handling

#### E1: Listing Fetch Error
- **Tag:** AUTO_VERIFY
- **Criterion:** If eBay API fails during listing fetch, error toast displays with "Retry" button
- **Evidence:** Toast visible with error message and retry action
- **Test:** Simulate API failure, verify toast appears with retry

#### E2: ReviseItem Error
- **Tag:** AUTO_VERIFY
- **Criterion:** If eBay ReviseItem API fails, error displays with eBay error message and listing remains unchanged
- **Evidence:** Error message shown, listing data unchanged on eBay
- **Test:** Simulate ReviseItem failure, verify error shown and no changes applied

#### E3: AI Analysis Error
- **Tag:** AUTO_VERIFY
- **Criterion:** If Gemini AI analysis fails, error displays with "Retry" button
- **Evidence:** Error state shown with retry action
- **Test:** Simulate Gemini API failure, verify retry available

#### E4: Pricing API Error
- **Tag:** AUTO_VERIFY
- **Criterion:** If Finding API fails during pricing analysis, pricing section shows "Unable to fetch pricing data" with retry option
- **Evidence:** Fallback message displayed, retry button visible
- **Test:** Simulate Finding API failure, verify fallback UI

---

### Performance

#### P1: Listing Fetch Speed
- **Tag:** AUTO_VERIFY
- **Criterion:** Listing fetch for up to 500 listings completes in under 30 seconds
- **Evidence:** Timed execution from request to render < 30000ms
- **Test:** Fetch 500 listings, measure time to complete

#### P2: Analysis Speed
- **Tag:** AUTO_VERIFY
- **Criterion:** Single listing analysis (content + pricing) completes in under 90 seconds
- **Evidence:** Time from "Analyse" click to results display < 90000ms
- **Test:** Measure analysis duration for single listing

#### P3: Apply Changes Speed
- **Tag:** AUTO_VERIFY
- **Criterion:** Applying a single change to eBay completes in under 10 seconds
- **Evidence:** Time from "Approve" click to confirmation < 10000ms
- **Test:** Measure ReviseItem round-trip time

---

### Integration

#### I1: Existing eBay Auth
- **Tag:** AUTO_VERIFY
- **Criterion:** Uses existing eBay OAuth connection (no separate login required)
- **Evidence:** Page uses tokens from platform_credentials table
- **Test:** Access page with existing connection, verify no auth prompt

#### I2: Connection Required
- **Tag:** AUTO_VERIFY
- **Criterion:** Page accessible only when user has active eBay connection
- **Evidence:** Unauthenticated or no-connection state shows connect prompt
- **Test:** Remove eBay connection, verify page shows connection prompt

#### I3: Inventory Linking
- **Tag:** AUTO_VERIFY
- **Criterion:** Links listing to inventory item via existing `ebay_listing_id` relationship when available
- **Evidence:** Linked listings show inventory data (SKU, cost, etc.)
- **Test:** View linked listing, verify inventory data displayed

---

## Out of Scope

- Image analysis (count only, no AI quality check)
- Batch approval of multiple suggestions
- Automatic optimization (all changes require approval)
- Scheduling recurring analysis
- Multi-platform (eBay only for MVP)
- Historical comparison charts/trends
- Export/reporting of optimization results
- Manual cost entry for unlinked listings

---

## Dependencies

- Active eBay OAuth connection with Trading API access
- Gemini API configured (`GOOGLE_AI_API_KEY`)
- eBay Finding API access (for pricing analysis)
- Existing inventory items linked to eBay listings (for cost/profit calculation on linked items)

---

## Database Changes Required

New table: `listing_quality_reviews`
```sql
CREATE TABLE listing_quality_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  ebay_listing_id TEXT NOT NULL,
  quality_score INTEGER NOT NULL CHECK (quality_score >= 0 AND quality_score <= 100),
  quality_grade TEXT NOT NULL CHECK (quality_grade IN ('A+', 'A', 'B', 'C', 'D', 'F')),
  breakdown JSONB NOT NULL,
  suggestions JSONB,
  pricing_analysis JSONB,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_listing_quality_reviews_user ON listing_quality_reviews(user_id);
CREATE INDEX idx_listing_quality_reviews_listing ON listing_quality_reviews(ebay_listing_id);
CREATE INDEX idx_listing_quality_reviews_date ON listing_quality_reviews(reviewed_at DESC);
```

Additional columns on existing table (TBD - may use `ebay_listings` or separate cache table):
- `last_reviewed_at TIMESTAMPTZ`
- `last_updated_at TIMESTAMPTZ`
- `quality_score INTEGER`
- `quality_grade TEXT`

---

## Iteration Budget

- **Max iterations:** 5
- **Escalation:** If not converged after 5 iterations, pause for human review

---

## Downstream Agents

| Agent | What It Receives |
|-------|------------------|
| Build Feature Agent | This done-criteria.md file |
| Verify Done Agent | This done-criteria.md file for verification |
| Test Plan Agent | Derives test cases from criteria |
