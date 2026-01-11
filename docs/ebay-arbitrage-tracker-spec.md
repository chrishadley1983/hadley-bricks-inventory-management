# eBay Arbitrage Tracker — Implementation Specification

**Feature Branch:** `feature/ebay-arbitrage-tracker`  
**Version:** 1.0  
**Date:** 11 January 2026  
**Author:** Claude (with Chris)  
**Prerequisite:** BrickLink Arbitrage Tracker Phase 1 complete

---

## 1. Overview

### 1.1 Purpose

The eBay Arbitrage Tracker extends the existing Arbitrage Tracker to identify profitable sourcing opportunities on eBay UK. It compares eBay "Buy It Now" prices against Amazon UK selling prices to surface items where the margin exceeds a user-defined threshold.

### 1.2 Relationship to BrickLink Tracker

This feature reuses the existing Arbitrage Tracker infrastructure built for BrickLink:
- Same sidebar navigation (eBay tab becomes active)
- Same `tracked_asins` and `asin_bricklink_mapping` tables
- Same margin calculation logic
- Same exclusion management
- New `ebay_pricing` table for eBay-specific snapshots

### 1.3 Key Differences from BrickLink

| Aspect | BrickLink | eBay |
|--------|-----------|------|
| Data format | Aggregated stats (min/avg/max) | Individual listings — you calculate |
| Category filter | SET type | Category ID 19006 (Complete Sets & Packs) |
| API | Price Guide API (OAuth1) | Browse API (OAuth2 client credentials) |
| Auth | User token | Application token (simpler) |
| Rate limit | 5,000/day | 5,000/day |
| Search method | Exact set number | Keyword search + category filter |

### 1.4 Implementation Phases

Mirrors BrickLink phases:

| Phase | Description |
|-------|-------------|
| Phase 1 | Track existing Amazon inventory ASINs via eBay search |
| Phase 2 | Discovery — find new ASINs from eBay listings |
| Phase 3 | Full tracking across inventory + discovered ASINs |
| Phase 4 | Email/push alerts for margin thresholds |

---

## 2. API Integration

### 2.1 eBay Browse API

**Authentication:** Client Credentials Grant (Application Token)

```typescript
// Get application token
const response = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
  },
  body: new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'https://api.ebay.com/oauth/api_scope'
  })
});
```

**Note:** Already tested and working with existing `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET` credentials.

### 2.2 Search Endpoint

**Endpoint:**
```
GET https://api.ebay.com/buy/browse/v1/item_summary/search
```

**Required Headers:**
```
Authorization: Bearer {application_token}
X-EBAY-C-MARKETPLACE-ID: EBAY_GB
```

**Query Parameters for LEGO Complete Sets:**

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `q` | `LEGO {set_number}` | Search by set number |
| `category_ids` | `19006` | LEGO Complete Sets & Packs |
| `filter` | `conditions:{NEW},buyingOptions:{FIXED_PRICE},itemLocationCountry:GB` | New, Buy It Now, UK sellers |
| `sort` | `price` | Sort by price ascending |
| `limit` | `50` | Max results per call |

**Example Request:**
```
GET /buy/browse/v1/item_summary/search?
    q=LEGO%2040585
    &category_ids=19006
    &filter=conditions:{NEW},buyingOptions:{FIXED_PRICE},itemLocationCountry:GB
    &sort=price
    &limit=50
```

### 2.3 Response Structure

```typescript
interface EbaySearchResponse {
  href: string;
  total: number;
  limit: number;
  offset: number;
  itemSummaries?: EbayItemSummary[];
}

interface EbayItemSummary {
  itemId: string;
  title: string;
  price: {
    value: string;
    currency: string;
  };
  condition: string;
  conditionId: string;
  itemWebUrl: string;
  image?: {
    imageUrl: string;
  };
  seller: {
    username: string;
    feedbackPercentage: string;
    feedbackScore: number;
  };
  shippingOptions?: Array<{
    shippingCost?: {
      value: string;
      currency: string;
    };
    type: string;
  }>;
  itemLocation?: {
    country: string;
    postalCode?: string;
  };
}
```

### 2.4 Rate Limits

| Limit | Value |
|-------|-------|
| Daily calls | 5,000 |
| Results per search | Up to 200 (use `limit` param) |

**Phase 1 Usage (650 ASINs):**
- 650 searches/day = 13% of daily limit ✓
- With 50 results per search, captures most listings per set

---

## 3. Data Model

### 3.1 New Table: ebay_pricing

```sql
CREATE TABLE ebay_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  set_number VARCHAR(20) NOT NULL,
  snapshot_date DATE NOT NULL,
  country_code VARCHAR(5) NOT NULL DEFAULT 'GB',
  condition VARCHAR(10) NOT NULL DEFAULT 'NEW',
  
  -- Calculated aggregates
  min_price DECIMAL(10,2),
  avg_price DECIMAL(10,2),
  max_price DECIMAL(10,2),
  total_listings INTEGER,
  
  -- Raw listing data for detail view
  listings_json JSONB,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(set_number, snapshot_date, country_code, condition)
);

CREATE INDEX idx_ebay_pricing_set_date ON ebay_pricing(set_number, snapshot_date DESC);
```

**listings_json structure:**
```json
[
  {
    "itemId": "v1|205988726767|0",
    "title": "LEGO Star Wars Millennium Falcon 75192 NEW SEALED",
    "price": 720.70,
    "currency": "GBP",
    "shipping": 0,
    "totalPrice": 720.70,
    "seller": "seller_username",
    "sellerFeedback": 99.5,
    "url": "https://www.ebay.co.uk/itm/205988726767"
  }
]
```

### 3.2 Updated View: arbitrage_current_view

Extend existing view to include eBay data:

```sql
CREATE OR REPLACE VIEW arbitrage_current_view AS
SELECT 
  t.asin,
  t.name,
  t.image_url,
  t.sku,
  t.source,
  t.status,
  m.bricklink_set_number,
  m.match_confidence,
  
  -- Amazon latest (existing)
  ap.your_price,
  ap.your_qty,
  ap.buy_box_price,
  ap.buy_box_is_yours,
  ap.offer_count,
  ap.was_price_90d,
  ap.sales_rank,
  ap.sales_rank_category,
  ap.snapshot_date as amazon_snapshot_date,
  
  -- BrickLink latest (existing)
  bp.min_price as bl_min_price,
  bp.avg_price as bl_avg_price,
  bp.max_price as bl_max_price,
  bp.total_lots as bl_total_lots,
  bp.total_qty as bl_total_qty,
  bp.price_detail_json as bl_price_detail,
  bp.snapshot_date as bl_snapshot_date,
  
  -- eBay latest (NEW)
  ep.min_price as ebay_min_price,
  ep.avg_price as ebay_avg_price,
  ep.max_price as ebay_max_price,
  ep.total_listings as ebay_total_listings,
  ep.listings_json as ebay_listings,
  ep.snapshot_date as ebay_snapshot_date,
  
  -- BrickLink margin (existing)
  CASE 
    WHEN ap.your_price > 0 AND bp.min_price > 0 
    THEN ROUND(((ap.your_price - bp.min_price) / ap.your_price) * 100, 1)
    ELSE NULL 
  END as bl_margin_percent,
  
  -- eBay margin (NEW)
  CASE 
    WHEN ap.your_price > 0 AND ep.min_price > 0 
    THEN ROUND(((ap.your_price - ep.min_price) / ap.your_price) * 100, 1)
    ELSE NULL 
  END as ebay_margin_percent

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
LEFT JOIN LATERAL (
  SELECT * FROM ebay_pricing 
  WHERE set_number = m.bricklink_set_number 
    AND condition = 'NEW' 
    AND country_code = 'GB'
  ORDER BY snapshot_date DESC 
  LIMIT 1
) ep ON true
WHERE t.status = 'active';
```

---

## 4. Sync Jobs

### 4.1 New Job: sync_ebay_pricing

**Trigger:** Daily at 04:30 UTC (after BrickLink sync)

**Process:**
1. Query distinct `bricklink_set_number` from `asin_bricklink_mapping` WHERE linked ASIN is `status = 'active'`
2. For each set number:
   a. Get application token (cache for 2 hours)
   b. Call Browse API search with category filter
   c. Filter results to exclude non-matches (title validation)
   d. Calculate min/avg/max from filtered results
   e. Store top 20 listings in `listings_json`
3. Insert snapshot row into `ebay_pricing`
4. Rate limit: 100ms between calls

```typescript
async function syncEbayPricing(setNumber: string): Promise<EbayPricingSnapshot> {
  const token = await getEbayApplicationToken(); // Cached
  
  const response = await fetch(
    `https://api.ebay.com/buy/browse/v1/item_summary/search?` +
    `q=${encodeURIComponent(`LEGO ${setNumber}`)}` +
    `&category_ids=19006` +
    `&filter=conditions:{NEW},buyingOptions:{FIXED_PRICE},itemLocationCountry:GB` +
    `&sort=price` +
    `&limit=50`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB'
      }
    }
  );
  
  const data: EbaySearchResponse = await response.json();
  
  // Filter to valid listings (title must contain set number)
  const validListings = (data.itemSummaries || [])
    .filter(item => isValidLegoListing(item.title, setNumber))
    .map(item => ({
      itemId: item.itemId,
      title: item.title,
      price: parseFloat(item.price.value),
      currency: item.price.currency,
      shipping: parseFloat(item.shippingOptions?.[0]?.shippingCost?.value || '0'),
      totalPrice: parseFloat(item.price.value) + parseFloat(item.shippingOptions?.[0]?.shippingCost?.value || '0'),
      seller: item.seller.username,
      sellerFeedback: parseFloat(item.seller.feedbackPercentage),
      url: item.itemWebUrl
    }));
  
  if (validListings.length === 0) {
    return { setNumber, noListings: true };
  }
  
  const prices = validListings.map(l => l.totalPrice);
  
  return {
    setNumber,
    minPrice: Math.min(...prices),
    avgPrice: prices.reduce((a, b) => a + b, 0) / prices.length,
    maxPrice: Math.max(...prices),
    totalListings: validListings.length,
    listings: validListings.slice(0, 20) // Store top 20 only
  };
}
```

### 4.2 Title Validation Function

Filter out non-set items (display mounts, instructions, parts):

```typescript
function isValidLegoListing(title: string, setNumber: string): boolean {
  const titleLower = title.toLowerCase();
  
  // Must contain the set number
  const setNumMatch = setNumber.replace('-1', ''); // Handle 40585-1 → 40585
  if (!title.includes(setNumMatch)) {
    return false;
  }
  
  // Exclude common non-set items
  const excludePatterns = [
    /\bmount\b/i,
    /\bbracket\b/i,
    /\bstand\b/i,
    /\bdisplay\b/i,
    /\binstructions?\b/i,
    /\bmanual\b/i,
    /\bminifig(ure)?s?\s+only\b/i,
    /\bparts\s+only\b/i,
    /\bspares?\b/i,
    /\bcompatible\b/i,
    /\bfor\s+lego\b/i,  // "For Lego" = third party accessory
    /\balternative\b/i,
    /\bknockoff\b/i,
    /\breplica\b/i,
    /\blepin\b/i,
    /\bking\b/i,  // Common knockoff brand
    /\bbela\b/i,  // Common knockoff brand
  ];
  
  for (const pattern of excludePatterns) {
    if (pattern.test(title)) {
      return false;
    }
  }
  
  // Should contain "LEGO" (official branding)
  if (!titleLower.includes('lego')) {
    return false;
  }
  
  return true;
}
```

### 4.3 Updated Cron Schedule

```sql
-- Existing jobs
SELECT cron.schedule('sync-inventory', '0 2 * * *', 'SELECT sync_inventory_asins()');
SELECT cron.schedule('sync-amazon', '0 3 * * *', 'SELECT sync_amazon_pricing()');
SELECT cron.schedule('sync-bricklink', '0 4 * * *', 'SELECT sync_bricklink_pricing()');

-- New eBay job
SELECT cron.schedule('sync-ebay', '30 4 * * *', 'SELECT sync_ebay_pricing()');

-- Existing cleanup
SELECT cron.schedule('cleanup-snapshots', '0 5 * * 0', 'SELECT cleanup_old_snapshots()');
```

---

## 5. User Interface

### 5.1 eBay Tab Activation

Enable the eBay tab in the Arbitrage Tracker sidebar:

```typescript
// Before (Phase 1 BrickLink only)
const tabs = [
  { id: 'amazon', label: 'Amazon', enabled: true, component: AmazonArbitrageTab },
  { id: 'ebay', label: 'eBay', enabled: false, component: PlaceholderTab },
  // ...
];

// After (eBay Phase 1)
const tabs = [
  { id: 'amazon', label: 'Amazon', enabled: true, component: AmazonArbitrageTab },
  { id: 'ebay', label: 'eBay', enabled: true, component: EbayArbitrageTab },
  // ...
];
```

### 5.2 eBay Tab Layout

Identical structure to Amazon/BrickLink tab but with eBay-specific columns:

**Controls Bar:** Same as BrickLink tab (margin threshold, filters, sort, search, excluded, refresh)

**Results Table:**

| Column | Source | Description |
|--------|--------|-------------|
| Item | Amazon + Mapping | Image, name, set number, ASIN |
| Your Price | SP-API | Current Amazon listing price + qty |
| Buy Box | SP-API | Current Buy Box price |
| eBay Min | eBay API | Minimum UK price (inc. shipping) |
| Margin | Calculated | (Your Price - eBay Min) / Your Price × 100 |
| eBay Listings | eBay API | Number of available listings |
| Action | — | View detail button |

### 5.3 eBay Detail Modal

**Header:** Same as BrickLink (product image, name, badges)

**Amazon Data Section:** Same 5-cell grid

**Margin Highlight:** Same format

**eBay Section (replaces BrickLink section):**
- Stats row: Min / Avg / Max prices
- Scrollable listing list showing stored listings from `listings_json`
- Each row: Price (inc shipping), Seller, Feedback %, link icon

**Footer:**
- Last updated timestamp
- "Search on eBay" button → Opens eBay search in new tab

**eBay Search URL Builder:**
```typescript
function buildEbaySearchUrl(setNumber: string): string {
  const query = encodeURIComponent(`LEGO ${setNumber}`);
  return `https://www.ebay.co.uk/sch/19006/i.html?_nkw=${query}&LH_BIN=1&LH_ItemCondition=1000&LH_PrefLoc=1`;
}

// Parameters:
// 19006 = LEGO Complete Sets & Packs category
// LH_BIN=1 = Buy It Now only
// LH_ItemCondition=1000 = New only
// LH_PrefLoc=1 = UK only
```

---

## 6. Component Structure

### 6.1 New/Modified Components

```
src/
├── components/
│   └── arbitrage/
│       ├── EbayArbitrageTab.tsx      # NEW: eBay tab content
│       ├── EbayDetailModal.tsx       # NEW: eBay-specific detail modal
│       └── EbayListingsList.tsx      # NEW: Scrollable eBay listings
├── hooks/
│   └── arbitrage/
│       └── useEbayArbitrageData.ts   # NEW: eBay data fetching
├── lib/
│   └── arbitrage/
│       ├── ebay-url.ts               # NEW: eBay URL builder
│       └── listing-validator.ts      # NEW: Title validation logic
└── server/
    └── arbitrage/
        ├── ebay-queries.ts           # NEW: eBay database queries
        └── ebay-sync.ts              # NEW: eBay sync job
```

### 6.2 Shared Components

These existing components work for both BrickLink and eBay tabs:
- `ArbitrageFilters.tsx` — Same controls
- `ArbitrageSummary.tsx` — Same stats display
- `ExcludedAsinsModal.tsx` — Shared exclusions
- `UnmappedAsinsTable.tsx` — Shared mapping UI

---

## 7. Phase Implementation Plan

### 7.1 Phase 1: Inventory-Based Tracking (eBay)

**Duration:** 1 week (leverages existing infrastructure)

**Deliverables:**
1. `ebay_pricing` table migration
2. eBay sync job implementation
3. Title validation function
4. eBay tab UI activation
5. eBay detail modal

**Acceptance Criteria:**
- [ ] Daily eBay sync runs successfully for mapped set numbers
- [ ] eBay tab shows margin data alongside Amazon prices
- [ ] Detail modal displays eBay listings
- [ ] Invalid listings (mounts, instructions) filtered out
- [ ] External "Search on eBay" link works correctly

### 7.2 Phase 2: Discovery (eBay)

**Duration:** 1–2 weeks

**Deliverables:**
1. eBay → ASIN discovery via search
2. Pending review workflow for eBay-discovered ASINs
3. Integration with existing discovery UI

### 7.3 Phase 3: Full Tracking (eBay)

**Duration:** 1 week

**Deliverables:**
1. Combined tracking list with eBay-sourced ASINs
2. Performance optimization for larger dataset

### 7.4 Phase 4: Alerts (eBay)

**Deliverables:**
1. eBay-specific alert thresholds
2. Combined BrickLink + eBay alert digest

---

## 8. Testing Strategy

### 8.1 Unit Tests

| Component | Tests |
|-----------|-------|
| `isValidLegoListing()` | Various title patterns (valid sets, mounts, knockoffs) |
| `buildEbaySearchUrl()` | URL encoding, parameter correctness |
| Price calculations | Include/exclude shipping scenarios |

### 8.2 Integration Tests

| Flow | Test |
|------|------|
| eBay token acquisition | Mock OAuth, verify caching |
| eBay search | Mock API, verify category filtering |
| Snapshot storage | Verify aggregates and listing JSON |

### 8.3 Manual Testing Checklist

- [ ] Search for known set returns correct results
- [ ] Display mounts and accessories are filtered out
- [ ] Prices include shipping where applicable
- [ ] Detail modal shows clickable eBay links
- [ ] Tab switching preserves filter state

---

## 9. Appendix

### 9.1 eBay Category Reference

| Category | ID | Notes |
|----------|------|-------|
| LEGO Complete Sets & Packs | 19006 | Primary category for arbitrage |
| LEGO Minifigures | 19001 | Excluded (not full sets) |
| LEGO Bricks & Pieces | 19003 | Excluded (parts only) |
| LEGO Instruction Manuals | 19007 | Excluded |

### 9.2 Sample API Response

```json
{
  "href": "https://api.ebay.com/buy/browse/v1/item_summary/search?q=LEGO%2075192&category_ids=19006&limit=3",
  "total": 323,
  "limit": 3,
  "offset": 0,
  "itemSummaries": [
    {
      "itemId": "v1|205988726767|0",
      "title": "LEGO Star Wars Millennium Falcon Ultimate Collector Series Set 75192 NEW SEALED",
      "price": {
        "value": "720.70",
        "currency": "GBP"
      },
      "condition": "New",
      "conditionId": "1000",
      "itemWebUrl": "https://www.ebay.co.uk/itm/205988726767",
      "image": {
        "imageUrl": "https://i.ebayimg.com/thumbs/images/g/..."
      },
      "seller": {
        "username": "lego_seller_uk",
        "feedbackPercentage": "99.8",
        "feedbackScore": 15420
      },
      "shippingOptions": [
        {
          "shippingCost": {
            "value": "0.00",
            "currency": "GBP"
          },
          "type": "Free"
        }
      ],
      "itemLocation": {
        "country": "GB"
      }
    }
  ]
}
```

### 9.3 Excluded Title Examples

These titles would be filtered out by `isValidLegoListing()`:

| Title | Reason |
|-------|--------|
| "For Lego UCS Millennium Falcon 75192 - Horizontal Wall Display Mount Bracket" | Contains "mount", "bracket", "For Lego" |
| "LEGO 75192 Instructions Manual Only" | Contains "instructions", "manual" |
| "King 81085 Star Destroyer Compatible with 75192" | Contains "compatible", "King" |
| "Lepin 05132 Millennium Falcon" | Contains "Lepin" |
| "LEGO 75192 Minifigures Only - Han Solo Chewie" | Contains "minifigures only" |

---

**End of Specification**
