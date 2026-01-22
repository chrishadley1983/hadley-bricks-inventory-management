# Done Criteria: partout-value

**Created:** 2026-01-20
**Author:** Define Done Agent + Chris
**Status:** APPROVED

## Feature Summary

Add a "Partout" tab to the Set Lookup page that displays the total value of a LEGO set's individual parts if sold separately on BrickLink. This helps decide whether to part out a set vs sell complete, identifies high-value parts for completeness assessment, and shows sell-through rates for individual pieces. Data sourced from BrickLink Price Guide POV endpoint.

**Key Feature:** Part pricing data is cached in a database table (keyed by part number + colour) with a configurable freshness period (default 6 months). This reduces BrickLink API calls and makes large sets viable to analyse without hitting daily API limits.

## Success Criteria

### Functional

#### F1: Partout Tab Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** A "Partout" tab is visible on the Set Lookup page when a set has been successfully looked up
- **Evidence:** DOM query finds tab element with text "Partout" or similar
- **Test:** `document.querySelector('[data-testid="partout-tab"]') !== null` after set lookup

#### F2: Partout Tab Fetches Data
- **Tag:** AUTO_VERIFY
- **Criterion:** Clicking the Partout tab triggers an API call to fetch partout data
- **Evidence:** Network request to partout API endpoint observed
- **Test:** Playwright click on tab, intercept network request to `/api/bricklink/partout` or similar

#### F3: Total Partout Value - New Condition
- **Tag:** AUTO_VERIFY
- **Criterion:** Total Partout Value for New condition is displayed with currency formatting (£X.XX)
- **Evidence:** Element with data-testid="pov-new-total" contains currency-formatted value
- **Test:** `document.querySelector('[data-testid="pov-new-total"]')?.textContent.match(/£[\d,]+\.\d{2}/)`

#### F4: Total Partout Value - Used Condition
- **Tag:** AUTO_VERIFY
- **Criterion:** Total Partout Value for Used condition is displayed with currency formatting (£X.XX)
- **Evidence:** Element with data-testid="pov-used-total" contains currency-formatted value
- **Test:** `document.querySelector('[data-testid="pov-used-total"]')?.textContent.match(/£[\d,]+\.\d{2}/)`

#### F5: Partout Ratio - New Condition
- **Tag:** AUTO_VERIFY
- **Criterion:** Partout Ratio for New condition displayed (POV ÷ Complete Set Price) as decimal or percentage
- **Evidence:** Element with data-testid="pov-new-ratio" contains numeric ratio
- **Test:** `document.querySelector('[data-testid="pov-new-ratio"]')?.textContent.match(/[\d.]+x?|[\d.]+%/)`

#### F6: Partout Ratio - Used Condition
- **Tag:** AUTO_VERIFY
- **Criterion:** Partout Ratio for Used condition displayed (POV ÷ Complete Set Price) as decimal or percentage
- **Evidence:** Element with data-testid="pov-used-ratio" contains numeric ratio
- **Test:** `document.querySelector('[data-testid="pov-used-ratio"]')?.textContent.match(/[\d.]+x?|[\d.]+%/)`

#### F7: Parts List Columns
- **Tag:** AUTO_VERIFY
- **Criterion:** Parts list table displays columns: Part Image, Part Name/Number, Colour, Qty in Set, Unit Price, Total Value, Sell-Through Rate, Stock Available, Times Sold
- **Evidence:** Table header row contains all required column headers
- **Test:** Check table headers include: Image, Name, Colour, Qty, Price, Total, Sell-Through, Stock, Sold

#### F8: Parts List Sorted by Value
- **Tag:** AUTO_VERIFY
- **Criterion:** Parts list is sorted by Total Value in descending order (highest value parts first)
- **Evidence:** First row total value >= second row total value >= third row total value
- **Test:** Extract Total Value column, verify values are in descending order

#### F9: New and Used Pricing Per Part
- **Tag:** AUTO_VERIFY
- **Criterion:** Both New and Used pricing is available for each part (either side-by-side columns or a toggle)
- **Evidence:** Each part row shows New price and Used price, OR toggle exists to switch condition view
- **Test:** DOM query for condition-specific price elements or condition toggle

#### F10: Minifigures Included
- **Tag:** AUTO_VERIFY
- **Criterion:** Minifigures from the set are included in the parts list with their individual values
- **Evidence:** Parts list includes rows with part type "Minifigure" or minifig part numbers
- **Test:** For a known set with minifigs (e.g., 75192), verify minifig rows appear in list

### Caching

#### C1: Part Price Cache Table Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Database table `bricklink_part_price_cache` exists with columns: part_number, colour_id, colour_name, price_new, price_used, sell_through_rate, stock_available, times_sold, fetched_at, updated_at
- **Evidence:** Migration file creates table; table queryable in Supabase
- **Test:** `SELECT * FROM bricklink_part_price_cache LIMIT 1` returns schema with expected columns

#### C2: Cache Keyed by Part + Colour
- **Tag:** AUTO_VERIFY
- **Criterion:** Cache table uses composite unique constraint on (part_number, colour_id) to store different colour variants separately
- **Evidence:** Unique constraint exists; inserting same part with different colours creates separate rows
- **Test:** Insert part "3001" with colour 1 (White) and colour 5 (Red), verify both rows exist

#### C3: Cache Freshness Check
- **Tag:** AUTO_VERIFY
- **Criterion:** When fetching part prices, system checks if cached data exists and is within freshness threshold before calling BrickLink API
- **Evidence:** For a part with fresh cache entry (< 6 months), no BrickLink API call is made
- **Test:** Insert fresh cache entry, request partout data, verify no API call for that part (mock/intercept)

#### C4: Cache Freshness Configurable via Environment Variable
- **Tag:** AUTO_VERIFY
- **Criterion:** Cache freshness threshold is configurable via `PARTOUT_CACHE_FRESHNESS_DAYS` environment variable, defaulting to 180 days (6 months)
- **Evidence:** Setting env var to 30 causes cache entries older than 30 days to trigger API refresh
- **Test:** Set env var, insert 60-day-old cache entry, verify API call is made to refresh

#### C5: Cache Miss Triggers API Fetch
- **Tag:** AUTO_VERIFY
- **Criterion:** When a part is not in cache or cache is stale, BrickLink API is called to fetch fresh pricing data
- **Evidence:** For uncached part, BrickLink API call observed; data returned to UI
- **Test:** Request partout for set with uncached parts, verify API calls made for missing parts

#### C6: API Response Inserted/Updated in Cache
- **Tag:** AUTO_VERIFY
- **Criterion:** After fetching part price from BrickLink API, the data is inserted (new) or updated (existing stale) in cache table with current timestamp
- **Evidence:** Cache table row exists with fetched_at timestamp matching request time
- **Test:** Fetch uncached part, query cache table, verify row exists with recent fetched_at

#### C7: Batched API Calls with Rate Limiting
- **Tag:** AUTO_VERIFY
- **Criterion:** When multiple parts need API refresh, requests are batched (max 50 parts per batch) with 1-second delay between batches to respect BrickLink rate limits
- **Evidence:** For set with 150 uncached parts, 3 batches observed with ~1s gaps
- **Test:** Mock large set with all cache misses, verify API calls are batched with delays

#### C8: Cache Hit/Miss Summary Displayed
- **Tag:** AUTO_VERIFY
- **Criterion:** UI displays summary of cache status, e.g., "450/500 parts from cache" or "95% cached"
- **Evidence:** Element with data-testid="cache-summary" shows cached vs total parts count
- **Test:** `document.querySelector('[data-testid="cache-summary"]')?.textContent.match(/\d+\/\d+ parts from cache|\d+% cached/)`

### UI/UX

#### U1: Visual Ratio Indicator
- **Tag:** AUTO_VERIFY
- **Criterion:** Partout ratio has colour-coded visual indicator: green/positive if ratio > 1 (part out profitable), red/negative if ratio ≤ 1 (sell complete better)
- **Evidence:** Ratio element has CSS class indicating positive (green) or negative (red) state
- **Test:** Check for class like `text-green-*` when ratio > 1, `text-red-*` when ratio ≤ 1

#### U2: Recommendation Label
- **Tag:** AUTO_VERIFY
- **Criterion:** A recommendation label displays "Part Out" if ratio > 1, "Sell Complete" if ratio ≤ 1
- **Evidence:** Element with data-testid="pov-recommendation" contains appropriate text
- **Test:** `document.querySelector('[data-testid="pov-recommendation"]')?.textContent` matches expected label

#### U3: Loading Skeleton
- **Tag:** AUTO_VERIFY
- **Criterion:** Loading skeleton is displayed while partout data is being fetched
- **Evidence:** Skeleton component visible between tab click and data render
- **Test:** Playwright: slow network, click tab, verify skeleton visible, then data replaces it

#### U4: Currency Formatting
- **Tag:** AUTO_VERIFY
- **Criterion:** All monetary values displayed in GBP (£) with 2 decimal places and thousands separator
- **Evidence:** All price elements match pattern £X,XXX.XX
- **Test:** Regex validation on all price elements

#### U5: Percentage Formatting
- **Tag:** AUTO_VERIFY
- **Criterion:** Sell-through rate displayed with % symbol
- **Evidence:** Sell-through column values end with %
- **Test:** Sell-through cells match pattern `[\d.]+%`

#### U6: DataTable Component
- **Tag:** AUTO_VERIFY
- **Criterion:** Parts table uses shadcn/ui DataTable component with pagination for large part lists
- **Evidence:** Table has pagination controls when parts count > page size (e.g., 50)
- **Test:** For set with 100+ parts, verify pagination controls exist and work

#### U7: Progressive Loading Indicator
- **Tag:** AUTO_VERIFY
- **Criterion:** When fetching uncached parts from API, a progress indicator shows how many parts have been fetched (e.g., "Fetching prices: 50/150 parts...")
- **Evidence:** Progress element updates during batch fetching
- **Test:** For set with many cache misses, verify progress indicator updates during fetch

### Error Handling

#### E1: API Failure Error State
- **Tag:** AUTO_VERIFY
- **Criterion:** If BrickLink API call fails, an error message is displayed with a retry button
- **Evidence:** Error element visible with retry button when API returns error
- **Test:** Mock API failure, verify error message and retry button appear

#### E2: No Parts Data Empty State
- **Tag:** AUTO_VERIFY
- **Criterion:** If set has no parts data on BrickLink, message "No partout data available for this set" is displayed
- **Evidence:** Empty state element visible for sets without BrickLink parts data
- **Test:** Look up obscure/new set without BrickLink data, verify empty state

#### E3: Missing Set Price Fallback
- **Tag:** AUTO_VERIFY
- **Criterion:** If complete set price is unavailable, ratio shows "N/A" instead of calculation error
- **Evidence:** Ratio element displays "N/A" when set price is null/undefined
- **Test:** Mock missing set price, verify ratio displays "N/A"

#### E4: Partial Cache Failure Graceful Handling
- **Tag:** AUTO_VERIFY
- **Criterion:** If some API calls fail during batch fetching, successfully fetched parts are still displayed with a warning about incomplete data
- **Evidence:** Partial results shown; warning message indicates "X parts could not be priced"
- **Test:** Mock partial API failure, verify successful parts displayed with warning

### Performance

#### P1: Load Time Under 5 Seconds for Cached Sets
- **Tag:** AUTO_VERIFY
- **Criterion:** Partout data loads and displays within 5 seconds when all parts are cached
- **Evidence:** Time from tab click to data render < 5000ms for fully cached set
- **Test:** Seed cache with all parts for a set, measure load time, assert < 5s

#### P2: Large Parts List Performance
- **Tag:** AUTO_VERIFY
- **Criterion:** Parts list renders without perceptible lag (< 500ms) for sets with 500+ parts, using virtualization or pagination
- **Evidence:** Table renders smoothly; no jank/freeze during scroll or pagination
- **Test:** Load set with 500+ parts (e.g., UCS Falcon 75192), verify responsive scrolling

#### P3: Uncached Set Load Time Under 60 Seconds
- **Tag:** AUTO_VERIFY
- **Criterion:** For a set with 500 uncached parts, partout data loads within 60 seconds (accounting for batched API calls with delays)
- **Evidence:** Time from tab click to full data render < 60000ms
- **Test:** Clear cache, request large set partout, measure total load time

### Integration

#### I1: Tab Disabled Until Set Loaded
- **Tag:** AUTO_VERIFY
- **Criterion:** Partout tab is disabled or hidden until a set has been successfully looked up
- **Evidence:** Tab has disabled attribute or is not visible before set lookup completes
- **Test:** Navigate to Set Lookup, verify Partout tab disabled; look up set, verify tab enabled

#### I2: API Route Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Backend API route exists to fetch partout data (e.g., `/api/bricklink/partout?setNumber=XXX`)
- **Evidence:** Route file exists and responds to GET requests
- **Test:** `GET /api/bricklink/partout?setNumber=75192` returns 200 with JSON body

#### I3: Uses BrickLink Credentials
- **Tag:** AUTO_VERIFY
- **Criterion:** Partout API uses existing BrickLink OAuth credentials from platform_credentials table
- **Evidence:** API does not require separate BrickLink auth setup; reuses existing integration
- **Test:** If BrickLink sync works, partout API should also work without additional config

#### I4: Migration Creates Cache Table
- **Tag:** AUTO_VERIFY
- **Criterion:** Database migration file exists and creates the `bricklink_part_price_cache` table with appropriate indexes
- **Evidence:** Migration file in `supabase/migrations/` creates table with index on (part_number, colour_id)
- **Test:** File exists; `npm run db:push` succeeds; table exists in Supabase

## Out of Scope

- **Inventory integration:** No adding POV to inventory items or bulk POV analysis for this MVP
- **Historical POV tracking:** Not tracking how POV changes over time (cache overwrites, doesn't version)
- **Part-out workflow:** No functionality to actually list parts for sale
- **Price trend charts:** Showing current data only, not historical price trends per part
- **Part images caching:** Images fetched from BrickLink directly, no local caching
- **Multi-currency:** GBP only for MVP; no currency conversion
- **Admin UI for cache config:** Freshness configured via env var only, no UI settings page

## Dependencies

- Set Lookup page must be functional
- BrickLink API credentials must be configured
- BrickLink Price Guide endpoint must be accessible
- Set must exist in BrickLink catalog
- Supabase database connection must be available

## Iteration Budget

- **Max iterations:** 5
- **Escalation:** If not converged after 5 iterations, pause for human review

## Technical Notes

### BrickLink API Endpoints Needed
1. **Get Set Inventory:** `GET /api/inventories/sets/{set_no}` - Returns parts list with colours
2. **Get Price Guide:** `GET /api/items/{type}/{no}/price` - Returns pricing per part
3. **Part Out Value:** BrickLink may have a dedicated POV endpoint, or calculate from above

### Environment Variables
```
# Cache freshness in days (default: 180 = 6 months)
PARTOUT_CACHE_FRESHNESS_DAYS=180
```

### Database Schema

```sql
CREATE TABLE bricklink_part_price_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_number VARCHAR(50) NOT NULL,
  part_type VARCHAR(20) NOT NULL DEFAULT 'PART', -- PART, MINIFIG, etc.
  colour_id INTEGER NOT NULL,
  colour_name VARCHAR(100),
  price_new DECIMAL(10,4),
  price_used DECIMAL(10,4),
  sell_through_rate DECIMAL(5,2), -- percentage 0-100
  stock_available INTEGER,
  times_sold INTEGER,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_part_colour UNIQUE (part_number, colour_id)
);

CREATE INDEX idx_part_price_cache_part ON bricklink_part_price_cache(part_number);
CREATE INDEX idx_part_price_cache_fetched ON bricklink_part_price_cache(fetched_at);
```

### Suggested File Structure
```
apps/web/src/
├── app/
│   └── api/
│       └── bricklink/
│           └── partout/
│               └── route.ts          # New API route
├── components/
│   └── features/
│       └── set-lookup/
│           └── PartoutTab.tsx        # New tab component
└── lib/
    └── bricklink/
        ├── client.ts                 # Extend with partout methods
        └── part-price-cache.ts       # Cache service
supabase/
└── migrations/
    └── YYYYMMDDHHMMSS_create_part_price_cache.sql
```

### Data Shape (Suggested)
```typescript
interface PartoutData {
  setNumber: string;
  totalParts: number;
  povNew: number;
  povUsed: number;
  setPrice: {
    new: number | null;
    used: number | null;
  };
  ratioNew: number | null;
  ratioUsed: number | null;
  recommendation: 'part-out' | 'sell-complete';
  cacheStats: {
    fromCache: number;
    fromApi: number;
    total: number;
  };
  parts: PartValue[];
}

interface PartValue {
  partNumber: string;
  partType: 'PART' | 'MINIFIG' | 'GEAR';
  name: string;
  colourId: number;
  colourName: string;
  imageUrl: string;
  quantity: number;
  priceNew: number;
  priceUsed: number;
  totalNew: number;
  totalUsed: number;
  sellThroughRate: number;
  stockAvailable: number;
  timesSold: number;
  fromCache: boolean;
}

interface PartPriceCache {
  partNumber: string;
  partType: string;
  colourId: number;
  colourName: string;
  priceNew: number | null;
  priceUsed: number | null;
  sellThroughRate: number | null;
  stockAvailable: number | null;
  timesSold: number | null;
  fetchedAt: Date;
}
```

### Caching Logic Flow
```
1. Get set inventory from BrickLink (parts list with colours)
2. For each part+colour combo:
   a. Query cache table for existing entry
   b. If exists AND fetched_at > (now - FRESHNESS_DAYS): use cached data
   c. Else: add to "needs refresh" list
3. Batch fetch uncached/stale parts from BrickLink API:
   a. Process in batches of 50
   b. Wait 1 second between batches
   c. Insert/upsert results into cache table
4. Combine cached + fresh data
5. Calculate totals and return to UI
```
