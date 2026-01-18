# User Journey: eBay Arbitrage

> **Journey:** Compare Amazon selling prices against eBay sourcing prices
> **Entry Point:** `/arbitrage/ebay`
> **Complexity:** High

## Overview

The eBay Arbitrage page helps identify profitable opportunities by comparing your Amazon selling prices against eBay "New" condition listings. This is useful for finding sets that are cheaper on eBay than BrickLink, or when BrickLink doesn't have stock.

## User Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Arbitrage Tracker - eBay                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐          │
│  │Total Tracked│ │eBay Opps    │ │  Unmapped   │ │  Excluded   │          │
│  │    523      │ │     32      │ │     12      │ │      8      │          │
│  │             │ │   ≥30%      │ │ Need linking│ │  Manage →   │          │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘          │
│                                                                             │
│  Sync Status                                              [Full Sync]       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ✓ Amazon Inventory   ✓ Amazon Pricing    ✓ BrickLink   ⏳ eBay     │   │
│  │   Jan 18, 10:30        Jan 18, 14:45       Jan 18          [↻]     │   │
│  │                                                                     │   │
│  │   eBay Pricing  [Syncing...]                                       │   │
│  │   ███████████████████░░░░░░░  78%                                  │   │
│  │   234 / 300 sets                                                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  [eBay Opportunities] [Unmapped] [Settings]                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ [Search...]  [Show ▼] All Items  [Min Margin ▼] 30%                  │  │
│  │                               [Sort ▼] eBay Margin  [View Excluded]  │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ Item              │Your Price│Buy Box│eBay Min│eBay Margin│Listings │  │
│  ├──────────────────────────────────────────────────────────────────────┤  │
│  │ [img] LEGO 10281  │  £45.99  │£44.99 │ £25.00 │   +44.4%  │   12    │  │
│  │       10281-1     │ Qty: 5   │       │        │           │   🔗    │  │
│  ├──────────────────────────────────────────────────────────────────────┤  │
│  │ [img] LEGO 42141  │ £149.99  │£159.99│ £110.00│   +26.7%  │    8    │  │
│  │       42141-1     │ Qty: 0   │       │        │           │   🔗    │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  Showing 1-50 of 234 items  [First][Prev] Page 1 of 5 [Next][Last]        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Key Concepts

### eBay vs BrickLink Arbitrage

| Aspect | BrickLink Page | eBay Page |
|--------|----------------|-----------|
| Source | BrickLink Price Guide API | eBay Browse API search |
| Condition | "New" from UK sellers | "New" with UK shipping |
| Price | Min price from price guide | Total price (item + shipping) |
| Listings | Not shown individually | Viewable, excludable |

### Seeded ASIN Badge

Items from the Brickset database show a "Seeded" badge with confidence level:
- **Green (95%+)**: EAN/UPC match
- **Blue (85-94%)**: Exact set number match
- **Amber (<85%)**: Fuzzy title match

### Filter Options (eBay-specific)

| Filter | Description |
|--------|-------------|
| All Items | Show all tracked ASINs |
| Opportunities Only | eBay margin ≥ threshold |
| With eBay Data | Items with eBay pricing data |
| No eBay Data | Items missing eBay data |
| In Stock (Amazon) | Your quantity > 0 |
| Zero Qty Only | Your quantity = 0 |

### Sort Options (eBay-specific)

| Sort | Description |
|------|-------------|
| Margin (eBay) | Highest eBay margin first |
| eBay Price | Lowest eBay price first |
| Sales Rank | Best selling first |
| Name | Alphabetical |

---

## Steps

### 1. Sync eBay Pricing

**Action:** Click the eBay sync button

**What Happens:**
1. Fetches tracked ASINs with BrickLink mappings
2. For each set, searches eBay for "LEGO {set_number} New"
3. Filters to UK listings only
4. Extracts price + shipping for total cost
5. Saves to `ebay_arbitrage_pricing` table
6. Streams progress to UI

**Progress Display:**
```
eBay Pricing  [Syncing...]
███████████████████░░░░░░░  78%
234 / 300 sets
```

**Streaming Response:**
```typescript
interface EbaySyncProgress {
  type: 'start' | 'progress' | 'complete' | 'error';
  message?: string;
  processed?: number;
  total?: number;
  percent?: number;
  result?: { updated: number; failed: number; total: number };
}
```

### 2. View eBay Opportunities

**Action:** Browse the opportunities table

**Table Columns:**
| Column | Description |
|--------|-------------|
| Item | Product image, name, set number, badges |
| Your Price | Your Amazon listing price, quantity |
| Buy Box | Amazon buy box (or lowest offer) |
| eBay Min | Minimum eBay total price |
| eBay Margin | Calculated profit margin |
| Listings | Number of eBay listings found |
| Action | Link to eBay search |

### 3. View eBay Item Detail

**Action:** Click on a table row

**eBay Detail Modal:**
```
┌─────────────────────────────────────────────────────────────────────────┐
│  LEGO 10281 Bonsai Tree                                          [✕]   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [Product Image]                                                        │
│                                                                         │
│  Amazon Data                           eBay Data                        │
│  ──────────────                        ──────────                       │
│  ASIN: B08GHWCV2J                     Set: 10281-1                     │
│  Your Price: £45.99                   Min Price: £25.00                │
│  Buy Box: £44.99                      Avg Price: £28.50                │
│  Your Qty: 5                          Max Price: £35.00                │
│  Sales Rank: #2,890                   Listings: 12                     │
│                                                                         │
│  eBay Listings                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Title                        │ Price  │ Ship  │ Total │ Action  │   │
│  ├─────────────────────────────────────────────────────────────────┤   │
│  │ LEGO 10281 Bonsai Tree New   │ £22.00 │ £3.00 │ £25.00│ [🔗][✕]│   │
│  │ LEGO Botanical Bonsai Sealed │ £24.99 │ £2.99 │ £27.98│ [🔗][✕]│   │
│  │ LEGO 10281 Bonsai BNIB       │ £26.00 │ Free  │ £26.00│ [🔗][✕]│   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Profit Calculation                                                     │
│  ─────────────────                                                     │
│  Sale Price (Amazon):   £45.99                                          │
│  Amazon Fees (18.36%): -£8.44                                          │
│  Shipping:             -£4.00                                          │
│  Net Payout:            £33.55                                          │
│  eBay Cost:            -£25.00                                          │
│  Profit:                £8.55                                           │
│  ROI:                   34.2%                                           │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│  [View on Amazon]  [Search eBay]                [Exclude]  [Close]      │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4. Exclude eBay Listings

**Why Exclude:**
- Listing is not actually the correct set
- Listing is incomplete (missing pieces)
- Seller has poor feedback
- Listing is from your own store

**Action:** Click [✕] next to a listing in the detail modal

**What Happens:**
1. Listing added to `excluded_ebay_listings` table
2. Stats recalculated excluding the listing
3. Min/avg/max prices updated
4. eBay margin recalculated

**Excluded Listing:**
```typescript
interface ExcludedEbayListing {
  id: string;
  userId: string;
  ebayItemId: string;
  setNumber: string;
  title: string | null;
  reason: string | null;
  excludedAt: string;
}
```

### 5. Restore Excluded Listings

**Action:** View excluded listings and click Restore

**Excluded Listings Panel (in detail modal):**
```
┌─────────────────────────────────────────────────────────────────────────┐
│  Excluded Listings for 10281-1                                          │
├─────────────────────────────────────────────────────────────────────────┤
│  LEGO 10281 Bonsai (parts only)  │ Excluded Jan 15  │ [Restore]        │
│  LEGO Bonsai Tree Instructions   │ Excluded Jan 12  │ [Restore]        │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Technical Details

### eBay Search Strategy

```typescript
// Search query construction
const searchQuery = `LEGO ${setNumber} New`;

// Filters applied
{
  condition: 'New',
  deliveryCountry: 'GB',
  itemLocationCountry: 'GB',
  buyingOptions: 'FIXED_PRICE', // Excludes auctions
}
```

### eBay Listing Data

```typescript
interface EbayListing {
  itemId: string;
  title: string;
  price: number;           // Item price
  currency: string;
  shipping: number;        // Shipping cost
  totalPrice: number;      // price + shipping
  seller: string;
  sellerFeedback: number;
  url: string;
}
```

### eBay Margin Recalculation

When listings are excluded, the system recalculates:

```typescript
// Filter out excluded listings
const activeListings = allListings.filter(
  listing => !excludedIds.has(listing.itemId)
);

// Recalculate stats
const prices = activeListings.map(l => l.totalPrice);
const newMinPrice = Math.min(...prices);
const newAvgPrice = prices.reduce((a,b) => a+b, 0) / prices.length;

// Recalculate margin
const sellPrice = yourPrice ?? buyBoxPrice;
const newMargin = ((sellPrice - newMinPrice) / sellPrice) * 100;
```

### Pagination

```typescript
// Pagination controls
const currentPage = filters.page ?? 1;
const pageSize = filters.pageSize ?? 50;
const totalPages = Math.ceil(totalCount / pageSize);

// Range display
const startItem = (currentPage - 1) * pageSize + 1;
const endItem = Math.min(currentPage * pageSize, totalCount);
```

---

## Error Handling

### No eBay Listings Found

```
eBay Data: —
No listings found for this set on eBay UK.
[Search eBay]
```

### All Listings Excluded

```
eBay Data: 0 listings
All eBay listings have been excluded.
[View Excluded] to restore.
```

### eBay API Error

```
⚠️ eBay sync partially complete
Error fetching listings for sets: 10281-1, 42141-1
Processed: 298 / 300
[Retry Failed]
```

---

## Source Files

| File | Purpose |
|------|---------|
| [ebay/page.tsx](../../../apps/web/src/app/(dashboard)/arbitrage/ebay/page.tsx) | Main page component |
| [EbayDetailModal.tsx](../../../apps/web/src/components/features/arbitrage/EbayDetailModal.tsx) | eBay-specific detail modal |
| [ebay-sync.service.ts](../../../apps/web/src/lib/arbitrage/ebay-sync.service.ts) | eBay pricing sync |
| [ebay-url.ts](../../../apps/web/src/lib/arbitrage/ebay-url.ts) | eBay URL building |
| [sync/ebay/route.ts](../../../apps/web/src/app/api/arbitrage/sync/ebay/route.ts) | Streaming sync endpoint |
| [ebay-exclusions/route.ts](../../../apps/web/src/app/api/arbitrage/ebay-exclusions/route.ts) | Exclusion management |

## Related Journeys

- [Amazon Arbitrage](./amazon-arbitrage.md) - Compare against BrickLink
- [Seeded ASINs](./seeded-asins.md) - Track sets you don't own
- [eBay Integration](../ebay/overview.md) - eBay API connection
