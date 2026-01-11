# Arbitrage Tracker — Implementation Specification

**Feature Branch:** `feature/arbitrage-tracker`  
**Version:** 1.0  
**Date:** 11 January 2026  
**Author:** Claude (with Chris)

---

## 1. Overview

### 1.1 Purpose

The Arbitrage Tracker enables Hadley Bricks to identify profitable sourcing opportunities by comparing Amazon UK selling prices against BrickLink UK buying prices. The tool surfaces items where the margin between BrickLink acquisition cost and Amazon selling price exceeds a user-defined threshold.

### 1.2 Scope

**In Scope:**
- Phase 1: Track existing Amazon inventory ASINs (including zero stock)
- Phase 2: Discovery feature to seed new ASINs from BrickLink catalog
- Phase 3: Full tracking across inventory + discovered ASINs
- Support for future marketplace tabs (eBay, Vinted, Facebook Marketplace)

**Out of Scope (Phase 4+):**
- Email/push alerts for margin threshold triggers
- eBay, Vinted, Facebook Marketplace integrations
- Automated purchasing from BrickLink

### 1.3 Key Metrics

| Metric | Phase 1 | Phase 3 |
|--------|---------|---------|
| Tracked ASINs | ~650 | 2,000–5,000 |
| Daily API calls (Amazon) | ~35 | ~250 |
| Daily API calls (BrickLink) | ~650 | ~2,500 |
| Data refresh frequency | Daily | Daily |

---

## 2. User Interface

### 2.1 Navigation

New sidebar section: **Arbitrage Tracker**

```
📊 Arbitrage Tracker
├── Amazon ← Active (Phase 1)
├── eBay ← Placeholder (disabled)
├── Vinted ← Placeholder (disabled)
└── Facebook ← Placeholder (disabled)
```

The Amazon tab is the initial implementation. Other tabs display "Coming Soon" with disabled state.

### 2.2 Amazon Tab Layout

#### 2.2.1 Controls Bar

| Control | Type | Default | Description |
|---------|------|---------|-------------|
| Min Margin | Number input | 30% | Filter threshold for opportunities |
| Show | Dropdown | All Items | Options: All Items, Opportunities Only, In Stock (Amazon), Zero Qty Only, Pending Review (Phase 2) |
| Sort | Dropdown | Margin (High→Low) | Options: Margin ↑↓, BL Price ↑↓, Sales Rank ↑↓, Name A-Z |
| Search | Text input | — | Search by name, ASIN, or set number |
| Excluded | Button | — | Opens excluded ASINs management modal |
| Refresh | Button | — | Triggers manual sync (rate limited) |

#### 2.2.2 Summary Stats (Top Right)

- **Items:** Total tracked ASINs (active)
- **Opportunities:** Count meeting margin threshold

#### 2.2.3 Results Table

| Column | Source | Description |
|--------|--------|-------------|
| Item | Amazon + BrickLink | Image, name, set number, ASIN |
| Your Price | SP-API | Current listing price + stock qty |
| Buy Box | SP-API | Current Buy Box price + winner indicator |
| Offers | SP-API | Total seller count on listing |
| Was Price | SP-API | 90-day median price |
| Rank | SP-API | Sales rank + category |
| BL Min | BrickLink API | Minimum UK New price + avg price |
| Margin | Calculated | (Your Price - BL Min) / Your Price × 100 |
| BL Lots | BrickLink API | Available lot count |
| Action | — | View detail button |

**Row Highlighting:**
- Green background: Margin ≥ user threshold
- Default background: Below threshold

**Row Click:** Opens detail modal

#### 2.2.4 Detail Modal

**Header:**
- Product image
- Product name
- Set number, ASIN, SKU badges

**Amazon Data Section (5-cell grid):**
- Your Price (with qty)
- Buy Box (with winner indicator)
- Was Price (90-day median or Amazon reference)
- Sales Rank (with category)
- Offers (total sellers)

**Margin Highlight:**
- Large percentage display
- Profit calculation: "Buy at £X → Sell at £Y = £Z gross profit"

**BrickLink Section:**
- Stats row: Min / Avg / Max prices
- Scrollable price list showing all `price_detail` entries from API
- Each row: Qty, Unit Price, Country flag

**Footer:**
- Last updated timestamp
- "View on BrickLink" button → External link with UK + New filters

#### 2.2.5 Excluded ASINs Modal

Accessed via "Excluded" button in controls bar.

| Column | Description |
|--------|-------------|
| ASIN | The excluded ASIN |
| Name | Product name |
| Set # | BrickLink set number (if mapped) |
| Excluded | Date excluded |
| Reason | User-provided reason (optional) |
| Action | "Restore" button |

**Restore Action:** Moves ASIN back to active tracking, next sync will fetch data.

---

## 3. Data Model

### 3.1 Entity Relationship Diagram

```
┌─────────────────────┐       ┌──────────────────────────┐
│   tracked_asins     │       │  asin_bricklink_mapping  │
├─────────────────────┤       ├──────────────────────────┤
│ asin (PK)           │──────<│ asin (FK)                │
│ source              │       │ bricklink_set_number     │
│ status              │       │ match_confidence         │
│ name                │       │ verified_at              │
│ image_url           │       │ created_at               │
│ sku                 │       └──────────────────────────┘
│ added_at            │                   │
│ excluded_at         │                   │
│ exclusion_reason    │                   ▼
│ last_synced_at      │       ┌──────────────────────────┐
└─────────────────────┘       │ bricklink_pricing        │
          │                   ├──────────────────────────┤
          │                   │ id (PK)                  │
          ▼                   │ bricklink_set_number     │
┌─────────────────────┐       │ snapshot_date            │
│  amazon_pricing     │       │ condition                │
├─────────────────────┤       │ country_code             │
│ id (PK)             │       │ min_price                │
│ asin (FK)           │       │ avg_price                │
│ snapshot_date       │       │ max_price                │
│ your_price          │       │ qty_avg_price            │
│ buy_box_price       │       │ total_lots               │
│ buy_box_is_yours    │       │ total_qty                │
│ offer_count         │       │ price_detail_json        │
│ was_price_90d       │       │ created_at               │
│ sales_rank          │       └──────────────────────────┘
│ sales_rank_category │
│ fba_fee_estimate    │
│ created_at          │
└─────────────────────┘
```

### 3.2 Table Definitions

#### 3.2.1 tracked_asins

Primary table for all ASINs being monitored.

```sql
CREATE TABLE tracked_asins (
  asin VARCHAR(10) PRIMARY KEY,
  source VARCHAR(20) NOT NULL CHECK (source IN ('inventory', 'discovery', 'manual')),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'excluded', 'pending_review')),
  name VARCHAR(500),
  image_url VARCHAR(1000),
  sku VARCHAR(100),
  added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  excluded_at TIMESTAMP WITH TIME ZONE,
  exclusion_reason VARCHAR(500),
  last_synced_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_tracked_asins_status ON tracked_asins(status);
CREATE INDEX idx_tracked_asins_source ON tracked_asins(source);
```

**Field Notes:**
- `source`: How the ASIN was added (inventory sync, discovery process, manual entry)
- `status`: 
  - `active` — being tracked, included in daily sync
  - `excluded` — user excluded, NOT synced (saves API calls)
  - `pending_review` — Phase 2, discovered but not yet reviewed

#### 3.2.2 amazon_pricing

Historical pricing snapshots from Amazon.

```sql
CREATE TABLE amazon_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asin VARCHAR(10) NOT NULL REFERENCES tracked_asins(asin),
  snapshot_date DATE NOT NULL,
  your_price DECIMAL(10,2),
  your_qty INTEGER DEFAULT 0,
  buy_box_price DECIMAL(10,2),
  buy_box_is_yours BOOLEAN DEFAULT FALSE,
  offer_count INTEGER,
  was_price_90d DECIMAL(10,2),
  sales_rank INTEGER,
  sales_rank_category VARCHAR(100),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(asin, snapshot_date)
);

CREATE INDEX idx_amazon_pricing_asin_date ON amazon_pricing(asin, snapshot_date DESC);
```

#### 3.2.3 asin_bricklink_mapping

Maps Amazon ASINs to BrickLink set numbers.

```sql
CREATE TABLE asin_bricklink_mapping (
  asin VARCHAR(10) PRIMARY KEY REFERENCES tracked_asins(asin),
  bricklink_set_number VARCHAR(20) NOT NULL,
  match_confidence VARCHAR(20) NOT NULL CHECK (match_confidence IN ('exact', 'probable', 'manual')),
  match_method VARCHAR(50),
  verified_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_mapping_set_number ON asin_bricklink_mapping(bricklink_set_number);
```

**Match Confidence:**
- `exact` — ASIN title contains exact set number, high confidence
- `probable` — Fuzzy match on title, needs verification
- `manual` — User manually linked

#### 3.2.4 bricklink_pricing

Historical pricing snapshots from BrickLink.

```sql
CREATE TABLE bricklink_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bricklink_set_number VARCHAR(20) NOT NULL,
  snapshot_date DATE NOT NULL,
  condition VARCHAR(10) NOT NULL DEFAULT 'N' CHECK (condition IN ('N', 'U')),
  country_code VARCHAR(5) NOT NULL DEFAULT 'UK',
  min_price DECIMAL(10,2),
  avg_price DECIMAL(10,2),
  max_price DECIMAL(10,2),
  qty_avg_price DECIMAL(10,2),
  total_lots INTEGER,
  total_qty INTEGER,
  price_detail_json JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(bricklink_set_number, snapshot_date, condition, country_code)
);

CREATE INDEX idx_bricklink_pricing_set_date ON bricklink_pricing(bricklink_set_number, snapshot_date DESC);
```

### 3.3 Views

#### 3.3.1 Latest Pricing View

Denormalized view for fast UI queries.

```sql
CREATE VIEW arbitrage_current_view AS
SELECT 
  t.asin,
  t.name,
  t.image_url,
  t.sku,
  t.source,
  t.status,
  m.bricklink_set_number,
  m.match_confidence,
  
  -- Amazon latest
  ap.your_price,
  ap.your_qty,
  ap.buy_box_price,
  ap.buy_box_is_yours,
  ap.offer_count,
  ap.was_price_90d,
  ap.sales_rank,
  ap.sales_rank_category,
  ap.snapshot_date as amazon_snapshot_date,
  
  -- BrickLink latest (New, UK)
  bp.min_price as bl_min_price,
  bp.avg_price as bl_avg_price,
  bp.max_price as bl_max_price,
  bp.total_lots as bl_total_lots,
  bp.total_qty as bl_total_qty,
  bp.price_detail_json as bl_price_detail,
  bp.snapshot_date as bl_snapshot_date,
  
  -- Calculated margin
  CASE 
    WHEN ap.your_price > 0 AND bp.min_price > 0 
    THEN ROUND(((ap.your_price - bp.min_price) / ap.your_price) * 100, 1)
    ELSE NULL 
  END as margin_percent,
  
  CASE 
    WHEN ap.your_price > 0 AND bp.min_price > 0 
    THEN ROUND(ap.your_price - bp.min_price, 2)
    ELSE NULL 
  END as margin_absolute

FROM tracked_asins t
LEFT JOIN asin_bricklink_mapping m ON t.asin = m.asin
LEFT JOIN LATERAL (
  SELECT * FROM amazon_pricing 
  WHERE asin = t.asin 
  ORDER BY snapshot_date DESC 
  LIMIT 1
) ap ON true
LEFT JOIN LATERAL (
  SELECT * FROM bricklink_pricing 
  WHERE bricklink_set_number = m.bricklink_set_number 
    AND condition = 'N' 
    AND country_code = 'UK'
  ORDER BY snapshot_date DESC 
  LIMIT 1
) bp ON true
WHERE t.status = 'active';
```

---

## 4. API Integration

### 4.1 Amazon SP-API

#### 4.1.1 Endpoints Used

| Endpoint | Purpose | Rate Limit |
|----------|---------|------------|
| `GET /listings/2021-08-01/items/{sellerId}` | Your inventory ASINs | 5/sec |
| `GET /products/pricing/v0/competitivePrice` | Buy Box, offers | 10/sec, 20 ASINs/batch |
| `GET /products/pricing/v0/listings/{sellerId}` | Your price | 5/sec |
| `GET /catalog/2022-04-01/items` | Product details, sales rank | 2/sec |

#### 4.1.2 Batch Strategy

```
Phase 1 (650 ASINs):
├── Competitive Pricing: 650 ÷ 20 = 33 calls → ~4 seconds
├── Your Listings: 650 calls → ~130 seconds (parallelized)
├── Catalog Details: 650 calls → ~325 seconds (parallelized)
└── Total: ~8 minutes with conservative rate limiting
```

#### 4.1.3 Data Mapping

| SP-API Field | Database Field |
|--------------|----------------|
| `Offers[].ListingPrice.Amount` | `your_price` |
| `Offers[].BuyBoxPrices[0].LandedPrice.Amount` | `buy_box_price` |
| `NumberOfOffers` | `offer_count` |
| `SalesRankings[0].Rank` | `sales_rank` |
| `SalesRankings[0].ProductCategoryId` | `sales_rank_category` |

**Was Price (90-day median) calculation:**
```typescript
async function getWasPrice(asin: string, amazonReferencePrice?: number): Promise<number | null> {
  // Check if we have 90 days of snapshot data
  const snapshots = await db.amazon_pricing
    .where({ asin })
    .where('snapshot_date', '>=', subDays(new Date(), 90))
    .select('your_price');
  
  if (snapshots.length >= 30) {
    // Calculate median from historical data
    const prices = snapshots.map(s => s.your_price).filter(p => p > 0).sort((a, b) => a - b);
    const mid = Math.floor(prices.length / 2);
    return prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;
  }
  
  // Fall back to Amazon reference price
  return amazonReferencePrice ?? null;
}
```

### 4.2 BrickLink API

#### 4.2.1 Endpoint Used

```
GET /api/store/v1/items/{type}/{no}/price
```

**Parameters:**
- `type`: `SET`
- `no`: e.g., `40585-1`
- `new_or_used`: `N`
- `country_code`: `UK`
- `guide_type`: `stock`
- `currency_code`: `GBP`

#### 4.2.2 Rate Limits

BrickLink API: 5,000 requests/day

```
Phase 1 (650 unique set numbers): 650 calls → well within limit
Phase 3 (2,500 set numbers): 2,500 calls → 50% of daily limit
```

#### 4.2.3 Response Mapping

| API Field | Database Field |
|-----------|----------------|
| `min_price` | `min_price` |
| `avg_price` | `avg_price` |
| `max_price` | `max_price` |
| `qty_avg_price` | `qty_avg_price` |
| `unit_quantity` | `total_lots` |
| `total_quantity` | `total_qty` |
| `price_detail` | `price_detail_json` (stored as JSONB) |

---

## 5. Sync Jobs

### 5.1 Job Overview

| Job | Frequency | Phase | Description |
|-----|-----------|-------|-------------|
| `sync_inventory_asins` | Daily | 1 | Pull ASINs from Amazon inventory |
| `sync_amazon_pricing` | Daily | 1 | Fetch pricing for active ASINs |
| `sync_bricklink_pricing` | Daily | 1 | Fetch pricing for mapped sets |
| `map_asins_to_bricklink` | On demand | 1 | Map unmapped ASINs to set numbers |
| `cleanup_old_snapshots` | Weekly | 1 | Delete pricing snapshots older than 1 year |
| `discover_asins` | Weekly | 2 | Find new ASINs from BrickLink catalog |

### 5.2 Job Specifications

#### 5.2.1 sync_inventory_asins

**Trigger:** Daily at 02:00 UTC (or manual)

**Process:**
1. Call SP-API to get all inventory items (including qty=0)
2. For each ASIN:
   - If exists in `tracked_asins`: update `last_synced_at`
   - If new: insert with `source='inventory'`, `status='active'`
3. Log summary: added/updated/unchanged counts

**Error Handling:**
- Retry with exponential backoff (3 attempts)
- On failure: alert, continue with existing data

#### 5.2.2 sync_amazon_pricing

**Trigger:** Daily at 03:00 UTC (after inventory sync)

**Process:**
1. Query `tracked_asins` WHERE `status = 'active'`
2. Batch ASINs into groups of 20
3. For each batch:
   - Call Competitive Pricing API
   - Call Catalog API for sales rank
   - Rate limit: 100ms between calls
4. Insert snapshot row per ASIN into `amazon_pricing`
5. Update `tracked_asins.last_synced_at`

**Error Handling:**
- Per-ASIN errors: log and continue
- Batch errors: retry batch once, then skip

#### 5.2.3 sync_bricklink_pricing

**Trigger:** Daily at 04:00 UTC (after Amazon sync)

**Process:**
1. Query distinct `bricklink_set_number` from `asin_bricklink_mapping` 
   WHERE linked ASIN is `status = 'active'`
2. For each set number:
   - Call BrickLink Price Guide API (New, UK, Stock)
   - Rate limit: 200ms between calls
3. Insert snapshot row into `bricklink_pricing`

**Error Handling:**
- Per-set errors: log and continue
- API quota exceeded: pause until next day

#### 5.2.4 map_asins_to_bricklink

**Trigger:** After `sync_inventory_asins` or manual

**Process:**
1. Query `tracked_asins` WHERE `asin NOT IN (SELECT asin FROM asin_bricklink_mapping)`
2. For each unmapped ASIN:
   a. Get product title from Amazon
   b. Extract potential set number using regex patterns:
      - `(\d{4,5}-\d)` — standard format (40585-1)
      - `(\d{4,5})` — number only
      - `LEGO\s+(\d{4,5})` — LEGO prefix
   c. Verify set exists in BrickLink catalog API
   d. Insert mapping with confidence level
3. Flag low-confidence mappings for manual review

**Confidence Rules:**
- `exact`: Title contains `{number}-1` format, BrickLink confirms
- `probable`: Title contains number only, BrickLink confirms
- `manual`: User manually linked via unmapped ASINs screen

#### 5.2.5 cleanup_old_snapshots

**Trigger:** Weekly on Sunday at 05:00 UTC

**Process:**
1. Delete from `amazon_pricing` WHERE `snapshot_date < NOW() - INTERVAL '1 year'`
2. Delete from `bricklink_pricing` WHERE `snapshot_date < NOW() - INTERVAL '1 year'`
3. Log deleted row counts

```sql
-- Cleanup query
DELETE FROM amazon_pricing WHERE snapshot_date < CURRENT_DATE - INTERVAL '1 year';
DELETE FROM bricklink_pricing WHERE snapshot_date < CURRENT_DATE - INTERVAL '1 year';
```

### 5.3 Job Queue Implementation

Use existing job queue infrastructure (Supabase pg_cron or external scheduler).

```sql
-- Example pg_cron schedule
SELECT cron.schedule('sync-inventory', '0 2 * * *', 'SELECT sync_inventory_asins()');
SELECT cron.schedule('sync-amazon', '0 3 * * *', 'SELECT sync_amazon_pricing()');
SELECT cron.schedule('sync-bricklink', '0 4 * * *', 'SELECT sync_bricklink_pricing()');
SELECT cron.schedule('cleanup-snapshots', '0 5 * * 0', 'SELECT cleanup_old_snapshots()');
```

---

## 6. Frontend Implementation

### 6.1 Component Structure

```
src/
├── app/
│   └── arbitrage/
│       ├── page.tsx              # Main arbitrage page (redirects to /amazon)
│       ├── layout.tsx            # Sidebar + tab navigation
│       ├── amazon/
│       │   └── page.tsx          # Amazon tab content
│       └── unmapped/
│           └── page.tsx          # Manual mapping screen
├── components/
│   └── arbitrage/
│       ├── ArbitrageTable.tsx    # Main results table
│       ├── ArbitrageFilters.tsx  # Controls bar
│       ├── ArbitrageDetailModal.tsx  # Item detail popup
│       ├── ExcludedAsinsModal.tsx    # Manage exclusions
│       ├── UnmappedAsinsTable.tsx    # Manual mapping UI
│       ├── ArbitrageSummary.tsx  # Stats display
│       └── PlaceholderTab.tsx    # Coming soon state
├── hooks/
│   └── arbitrage/
│       ├── useArbitrageData.ts   # Data fetching + filtering
│       ├── useArbitrageSync.ts   # Manual sync trigger
│       ├── useExclusions.ts      # Exclusion management
│       └── useUnmappedAsins.ts   # Unmapped ASIN management
├── lib/
│   └── arbitrage/
│       ├── types.ts              # TypeScript interfaces
│       ├── calculations.ts       # Margin calculations
│       └── bricklink-url.ts      # URL builder for external links
└── server/
    └── arbitrage/
        ├── queries.ts            # Database queries
        └── actions.ts            # Server actions (exclude, restore, sync, map)
```

### 6.2 Key Components

#### 6.2.1 ArbitrageTable

**Props:**
```typescript
interface ArbitrageTableProps {
  data: ArbitrageItem[];
  isLoading: boolean;
  onRowClick: (item: ArbitrageItem) => void;
  sortConfig: SortConfig;
  onSortChange: (config: SortConfig) => void;
}
```

**Features:**
- Virtualized rows for performance (Phase 3 scaling)
- Sortable columns
- Row highlighting based on margin threshold
- Responsive column hiding on smaller screens

#### 6.2.2 ArbitrageDetailModal

**Props:**
```typescript
interface ArbitrageDetailModalProps {
  item: ArbitrageItem | null;
  isOpen: boolean;
  onClose: () => void;
  onExclude: (asin: string, reason?: string) => void;
}
```

**Features:**
- Amazon data grid (6 metrics)
- Margin highlight with profit calculation
- BrickLink price list with scroll
- External link to BrickLink (opens new tab)
- Exclude button with optional reason input

#### 6.2.3 ExcludedAsinsModal

**Props:**
```typescript
interface ExcludedAsinsModalProps {
  isOpen: boolean;
  onClose: () => void;
}
```

**Features:**
- Paginated list of excluded ASINs
- Search/filter within excluded items
- Restore button per row
- Bulk restore option

### 6.3 State Management

Use React Query for server state:

```typescript
// useArbitrageData.ts
export function useArbitrageData(filters: ArbitrageFilters) {
  return useQuery({
    queryKey: ['arbitrage', 'amazon', filters],
    queryFn: () => fetchArbitrageData(filters),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useExcludeAsin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: excludeAsin,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['arbitrage'] });
    },
  });
}
```

### 6.4 URL Structure

```
/arbitrage              → Redirects to /arbitrage/amazon
/arbitrage/amazon       → Amazon arbitrage tracker
/arbitrage/ebay         → Coming soon placeholder
/arbitrage/vinted       → Coming soon placeholder
/arbitrage/facebook     → Coming soon placeholder
```

---

## 7. Calculations

### 7.1 Margin Calculation

```typescript
function calculateMargin(amazonPrice: number, bricklinkMinPrice: number): number {
  if (amazonPrice <= 0 || bricklinkMinPrice <= 0) return 0;
  return ((amazonPrice - bricklinkMinPrice) / amazonPrice) * 100;
}
```

### 7.2 Profit Calculation

```typescript
interface ProfitCalculation {
  grossProfit: number;      // Amazon price - BrickLink price
  margin: number;           // Gross profit / Amazon price × 100
}

function calculateProfit(
  amazonPrice: number, 
  bricklinkPrice: number
): ProfitCalculation {
  const grossProfit = amazonPrice - bricklinkPrice;
  const margin = (grossProfit / amazonPrice) * 100;
  
  return { grossProfit, margin };
}
```

**Note:** FBA fees are not calculated in the system. Users should account for fees when setting their minimum margin threshold (e.g., set 40% margin if fees are ~15% to achieve 25% net margin).

---

## 8. Manual Mapping UI

### 8.1 Unmapped ASINs Screen

Accessed via notification badge in the Arbitrage Tracker header when unmapped ASINs exist.

**Layout:**
- Header: "Unmapped ASINs" with count badge
- Table showing ASINs that failed automatic mapping

| Column | Description |
|--------|-------------|
| ASIN | The unmapped ASIN |
| Product Name | From Amazon catalog |
| Detected Set # | What the regex extracted (if any) |
| Suggested Match | BrickLink search result (if close match found) |
| Action | Manual input field + Save button |

### 8.2 Manual Mapping Workflow

1. System displays ASINs where `match_confidence` would be null
2. User sees product name and any partial matches
3. User enters correct BrickLink set number (e.g., `40585-1`)
4. System validates set exists in BrickLink catalog
5. On save: creates mapping with `match_confidence = 'manual'`
6. ASIN moves to active tracking on next sync

### 8.3 Component

```typescript
interface UnmappedAsinRowProps {
  asin: string;
  productName: string;
  detectedSetNumber: string | null;
  suggestedMatch: string | null;
  onSave: (asin: string, setNumber: string) => Promise<void>;
  onSkip: (asin: string) => void;
}
```

**Validation:**
- Set number format: `^\d{4,6}-\d$` 
- BrickLink API call to verify set exists before saving

---

## 8. Phase Implementation Plan

### 8.1 Phase 1: Inventory-Based Tracking

**Duration:** 2–3 weeks

**Deliverables:**
1. Database schema and migrations
2. Sync jobs for inventory, Amazon pricing, BrickLink pricing
3. ASIN → BrickLink mapping logic
4. Arbitrage Tracker UI with Amazon tab
5. Detail modal with BrickLink link
6. Exclusion management

**Acceptance Criteria:**
- [ ] All 650 inventory ASINs loaded and displayed
- [ ] Daily sync runs successfully
- [ ] Margin filtering works correctly
- [ ] Exclusions stop API calls for excluded ASINs
- [ ] BrickLink external link opens correct filtered page

### 8.2 Phase 2: Discovery Feature

**Duration:** 2 weeks

**Deliverables:**
1. BrickLink catalog integration (GWP + retired sets)
2. Automated ASIN discovery via Amazon search
3. "Pending Review" status and UI
4. Review workflow (approve → active, reject → excluded)

**Acceptance Criteria:**
- [ ] Discovery job finds new ASINs not in inventory
- [ ] Pending review items shown in separate filter
- [ ] Approve/reject workflow functions correctly
- [ ] Discovered ASINs added to daily sync

### 8.3 Phase 3: Full Tracking

**Duration:** 1 week

**Deliverables:**
1. Performance optimisation for larger dataset
2. UI pagination/virtualisation
3. Database indexing review

**Acceptance Criteria:**
- [ ] 5,000 ASINs load without performance degradation
- [ ] Daily sync completes within API limits
- [ ] UI remains responsive

### 8.4 Phase 4: Alerts (Future)

**Deliverables:**
1. Threshold-based email alerts
2. Notification preferences UI
3. Alert history

---

## 9. Testing Strategy

### 9.1 Unit Tests

| Component | Tests |
|-----------|-------|
| `calculateMargin()` | Edge cases: zero prices, negative margins |
| `calculateProfit()` | Fee estimation accuracy |
| `extractSetNumber()` | Regex patterns against sample titles |
| `buildBricklinkUrl()` | URL encoding, filter parameters |

### 9.2 Integration Tests

| Flow | Test |
|------|------|
| Inventory sync | Mock SP-API, verify DB inserts |
| Amazon pricing sync | Mock SP-API, verify batch handling |
| BrickLink pricing sync | Mock BL API, verify snapshot storage |
| ASIN mapping | Mock both APIs, verify confidence scoring |

### 9.3 E2E Tests

| Scenario | Steps |
|----------|-------|
| View opportunities | Load page → verify filtered results |
| Exclude ASIN | Click exclude → verify removed from list |
| Restore ASIN | Open excluded → restore → verify returns |
| Detail modal | Click row → verify data displayed → click BL link |

---

## 10. Monitoring & Observability

### 10.1 Sync Job Metrics

| Metric | Alert Threshold |
|--------|-----------------|
| `sync_duration_seconds` | > 30 minutes |
| `sync_errors_count` | > 10 per run |
| `api_rate_limit_hits` | Any |
| `unmapped_asins_count` | > 50 new |

### 10.2 Data Freshness

| Check | Frequency | Alert |
|-------|-----------|-------|
| Amazon snapshot age | Hourly | > 36 hours old |
| BrickLink snapshot age | Hourly | > 36 hours old |
| Sync job last success | Hourly | > 24 hours |

### 10.3 Logging

All sync jobs log to structured logging with:
- Job name and run ID
- Start/end timestamps
- Records processed/failed
- API call counts
- Error details with stack traces

---

## 11. Security Considerations

### 11.1 API Credentials

- Amazon SP-API credentials: Stored in environment variables
- BrickLink API credentials: Stored in environment variables
- Never logged or exposed in error messages

### 11.2 Data Access

- Arbitrage data scoped to authenticated user (existing auth system)
- No public endpoints for arbitrage data
- Row-level security on all tables (if multi-tenant)

---

## 12. Resolved Decisions

| Question | Decision |
|----------|----------|
| **Was Price calculation** | Use 90-day median from stored snapshots if available; fall back to Amazon reference price if < 90 days of data |
| **FBA fee handling** | No fee estimation in UI — user accounts for fees via their margin threshold setting |
| **Mapping failures** | Error screen UI allowing manual ASIN → BrickLink set number mapping |
| **Historical retention** | 1 year retention for pricing snapshots; implement cleanup job to purge older data |

---

## 13. Appendix

### 13.1 BrickLink URL Builder

```typescript
function buildBricklinkUrl(setNumber: string): string {
  const filters = {
    cond: 'N',      // New
    loc: 'UK',      // UK sellers
  };
  
  const filterParam = encodeURIComponent(JSON.stringify(filters));
  return `https://www.bricklink.com/v2/catalog/catalogitem.page?S=${setNumber}#T=S&O=${filterParam}`;
}

// Example output:
// https://www.bricklink.com/v2/catalog/catalogitem.page?S=40585-1#T=S&O=%7B%22cond%22%3A%22N%22%2C%22loc%22%3A%22UK%22%7D
```

### 13.2 Sample API Responses

**Amazon Competitive Pricing:**
```json
{
  "ASIN": "B0BVMQ7J5W",
  "Product": {
    "Offers": [{
      "BuyBoxPrices": [{
        "condition": "New",
        "LandedPrice": { "Amount": 32.50, "CurrencyCode": "GBP" }
      }],
      "NumberOfOffers": [{ "condition": "New", "fulfillmentChannel": "Amazon", "OfferCount": 8 }]
    }]
  }
}
```

**BrickLink Price Guide:**
```json
{
  "meta": { "code": 200 },
  "data": {
    "item": { "no": "40585-1", "type": "SET" },
    "new_or_used": "N",
    "currency_code": "GBP",
    "min_price": "13.9900",
    "max_price": "49.9900",
    "avg_price": "26.9700",
    "qty_avg_price": "26.0300",
    "unit_quantity": 22,
    "total_quantity": 26,
    "price_detail": [
      { "quantity": 1, "unit_price": "13.9900", "seller_country_code": "UK" },
      { "quantity": 1, "unit_price": "15.0000", "seller_country_code": "UK" }
    ]
  }
}
```

---

**End of Specification**
