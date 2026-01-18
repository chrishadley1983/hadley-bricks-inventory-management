# User Journey: eBay Stock Management

> **Journey:** View and manage eBay listings with stock levels
> **Entry Point:** `/ebay-stock`
> **Complexity:** Medium

## Overview

The eBay Stock Management page provides a comprehensive view of all eBay listings with filtering, sorting, price editing, and stock synchronisation capabilities. It includes two main views: Listings (table view) and Stock Comparison (inventory matching).

## User Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         /ebay-stock                                 │
├─────────────────────────────────────────────────────────────────────┤
│  eBay Stock                                         [Import from eBay]
│  Manage your eBay listings and stock levels                        │
├─────────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ ⚠ 12 items have SKU issues                 [View SKU Issues]  │ │
│  └───────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────┤
│  [Listings]  [Stock Comparison]                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  eBay Listings (523 items)                              [Columns ▼] │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ [Search...]  [Status ▼]  [Has SKU ▼]                         │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ SKU       │ Item ID    │ Title       │ Qty │ Price  │ Status │  │
│  ├──────────────────────────────────────────────────────────────┤  │
│  │ HB-75192  │ 1234567890 │ LEGO 75192  │ 1   │ £599.99│ Active │  │
│  │ HB-10281  │ 1234567891 │ LEGO 10281  │ 2   │ £89.99 │ Active │  │
│  │ Empty     │ 1234567892 │ LEGO Technic│ 1   │ £149.99│ Active │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  Page 1 of 11                            [◀ Previous] [Next ▶]     │
└─────────────────────────────────────────────────────────────────────┘
```

## Key Concepts

### Listing Statuses

| Status | Description | UI Badge |
|--------|-------------|----------|
| **Active** | Live on eBay | Default (green) |
| **Inactive** | Not visible to buyers | Secondary (grey) |
| **Incomplete** | Missing required info | Destructive (red) |
| **Out of Stock** | Quantity is zero | Destructive (red) |

### SKU Issues

Listings without SKUs (Custom Labels) cannot be matched to inventory. The SKU Issues banner shows count and links to resolution.

### Stock Comparison

Compares eBay listings against inventory to identify:
- Listings without matching inventory
- Inventory without matching listings
- Quantity mismatches

---

## Steps

### 1. Access eBay Stock Page

**Action:** Navigate to `/ebay-stock` from sidebar

**What Happens:**
1. Checks eBay connection status
2. Loads listings from `platform_listings` table
3. Shows SKU issues banner if applicable
4. Displays listings table with pagination

### 2. Import/Sync from eBay

**Action:** Click "Import from eBay" button

**What Happens:**
1. Button shows "Syncing..." with spinner
2. Calls `/api/ebay-stock` with method POST
3. Fetches all active listings from eBay Trading API
4. Upserts to `platform_listings` table
5. Shows success toast with count

**Process:**
```
┌──────────────────────────────────────────────────────────────────┐
│  Syncing eBay Listings                                           │
│  ────────────────────────────────────────────────────────────    │
│  Fetching listings from eBay...                                  │
│  Processing page 1 of 3                                          │
│  ■■■■■■■■■■■■■■■■□□□□ 65%                                        │
└──────────────────────────────────────────────────────────────────┘
```

### 3. Filter Listings

**Action:** Use filter controls

**Available Filters:**

| Filter | Options |
|--------|---------|
| Search | Search by title, SKU, or Item ID |
| Status | All, Active, Inactive, Out of Stock |
| Has SKU | All, Has SKU, No SKU |

### 4. Sort Listings

**Action:** Click column header to sort

**Sortable Columns:**
- SKU (Custom Label)
- Item ID
- Title
- Quantity
- Price
- Status

**Sort Icons:**
- ↑ Ascending
- ↓ Descending
- ⇅ Unsorted (click to sort)

### 5. Edit Price Inline

**Action:** Hover over price and click edit icon

**Inline Edit Flow:**
```
┌───────────────────────────────────────────────────┐
│ £ [599.99]  [✓] [✕]                              │
└───────────────────────────────────────────────────┘
```

**Process:**
1. Click pencil icon to enter edit mode
2. Type new price
3. Press Enter or click ✓ to confirm
4. Opens confirmation dialog

**Price Update Dialog:**
```
┌─────────────────────────────────────────────────────────────────────┐
│  Update Price                                                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Item: LEGO 75192 Millennium Falcon                                │
│  Current Price: £599.99                                            │
│  New Price: £579.99                                                │
│                                                                     │
│  ☑ Update Best Offer thresholds                                    │
│                                                                     │
│  Auto Accept: 95% of price (£550.99)                               │
│  [━━━━━━━━━━━━━━━━━━━●━] 95%                                       │
│                                                                     │
│  Min Offer: 85% of price (£492.99)                                 │
│  [━━━━━━━━━━━━━━━━●━━━━] 85%                                       │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                              [Cancel]  [Update Price]               │
└─────────────────────────────────────────────────────────────────────┘
```

**What Happens on Confirm:**
1. Calls `/api/ebay-stock/[itemId]` with PATCH
2. Updates price via eBay Trading API (ReviseFixedPriceItem)
3. Optionally updates Best Offer thresholds
4. Shows success/error toast
5. Refreshes listing data

### 6. Toggle Columns

**Action:** Click "Columns" dropdown

**Available Columns:**
| Column | Default | Description |
|--------|---------|-------------|
| SKU | ✓ | Custom Label |
| Item ID | ✓ | eBay listing ID |
| Title | ✓ | Listing title |
| Quantity | ✓ | Available quantity |
| Price | ✓ | Current price |
| Status | ✓ | Listing status |
| Condition | ✓ | Item condition |
| Type | | Fixed Price / Auction |
| Watchers | | Watcher count |

### 7. View SKU Issues

**Action:** Click "View SKU Issues" in banner

**Navigates to:** `/ebay-stock/sku-issues`

**SKU Issues Page:**
```
┌─────────────────────────────────────────────────────────────────────┐
│  SKU Issues                                                         │
│  Listings without SKUs cannot be matched to inventory               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ Item ID     │ Title                          │ Action        │  │
│  ├──────────────────────────────────────────────────────────────┤  │
│  │ 1234567892  │ LEGO Technic 42141             │ [Set SKU]     │  │
│  │ 1234567893  │ LEGO City 60198                │ [Set SKU]     │  │
│  │ 1234567894  │ LEGO Creator 10281             │ [Set SKU]     │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 8. View on eBay

**Action:** Click Item ID link (external link icon)

**What Happens:**
- Opens eBay listing in new tab
- URL format: `https://www.ebay.co.uk/itm/{itemId}`

### 9. Switch to Stock Comparison

**Action:** Click "Stock Comparison" tab

**Stock Comparison View:**
```
┌─────────────────────────────────────────────────────────────────────┐
│  Stock Comparison                                      [Sync All]   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Summary:                                                           │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐                   │
│  │   Matched   │ │  Unmatched  │ │  No Listing │                   │
│  │     489     │ │      34     │ │      12     │                   │
│  └─────────────┘ └─────────────┘ └─────────────┘                   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ SKU      │ eBay Qty │ Inv. Qty │ Status    │ Action          │  │
│  ├──────────────────────────────────────────────────────────────┤  │
│  │ HB-75192 │ 1        │ 1        │ ✓ Matched │                 │  │
│  │ HB-10281 │ 2        │ 1        │ ⚠ Mismatch│ [Sync to eBay]  │  │
│  │ HB-42141 │ -        │ 1        │ No Listing│ [Create Listing]│  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Table Columns Detail

| Column | Description | Source |
|--------|-------------|--------|
| SKU | Custom Label field from eBay | `ebay_data.sku` |
| Item ID | eBay listing identifier | `platform_item_id` |
| Title | Listing title | `title` |
| Quantity | Available stock | `quantity` |
| Price | Current buy-it-now price | `price` |
| Status | Listing status | `listing_status` |
| Condition | Item condition text | `ebay_data.condition` |
| Type | Fixed Price or Auction | `ebay_data.format` |
| Watchers | Number of watchers | `ebay_data.watchers` |

---

## Technical Details

### Query Keys

```typescript
// eBay listings list
['ebay-stock', 'listings', filters, page, pageSize]

// eBay listing details
['ebay-stock', 'listing', itemId]

// Stock comparison
['ebay-stock', 'comparison']

// SKU issues
['ebay-stock', 'sku-issues']
```

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/ebay-stock` | GET | List listings with filters |
| `/api/ebay-stock` | POST | Trigger import from eBay |
| `/api/ebay-stock/[itemId]` | GET | Get single listing |
| `/api/ebay-stock/[itemId]` | PATCH | Update price |
| `/api/ebay-stock/comparison` | GET | Stock comparison data |
| `/api/ebay-stock/sku-issues` | GET | Listings without SKUs |

### Data Structure

```typescript
interface EbayListingFilters {
  search?: string;
  status?: ListingStatus | 'all';
  hasSku?: 'all' | 'has_sku' | 'no_sku';
  sort?: {
    column: SortableColumnKey;
    direction: 'asc' | 'desc';
  };
}

interface PlatformListing {
  id: string;
  platformItemId: string;
  platformSku: string | null;
  title: string | null;
  price: number | null;
  currency: string;
  quantity: number;
  listingStatus: ListingStatus;
  rawData: EbayListingData;
}
```

### Price Update Request

```typescript
interface PriceUpdateRequest {
  newPrice: number;
  updateBestOffer?: boolean;
  autoAcceptPercent?: number;  // e.g., 95 for 95%
  minOfferPercent?: number;    // e.g., 85 for 85%
}

// Response
interface PriceUpdateResponse {
  success: boolean;
  newPrice: number;
  autoAcceptPrice: number | null;
  minOfferPrice: number | null;
}
```

---

## Error Handling

### eBay Not Connected

```
┌─────────────────────────────────────────────────────────────────────┐
│  ⚠️ eBay Connection Required                                        │
│  Connect your eBay account to view and manage listings.            │
│                                                    [Connect eBay]   │
└─────────────────────────────────────────────────────────────────────┘
```

### Import Failed

```
┌─────────────────────────────────────────────────────────────────────┐
│  ❌ Import Failed                                                   │
│  Failed to import listings from eBay. Please try again.            │
│                                                    [Retry]          │
└─────────────────────────────────────────────────────────────────────┘
```

### Price Update Failed

```
┌─────────────────────────────────────────────────────────────────────┐
│  ❌ Price Update Failed                                             │
│  Could not update price on eBay. The listing may have ended        │
│  or you may not have permission to modify it.                      │
│                                                    [Dismiss]        │
└─────────────────────────────────────────────────────────────────────┘
```

### No Listings

```
┌─────────────────────────────────────────────────────────────────────┐
│  No listings found                                                  │
│  Import listings from eBay to get started.                         │
│                                          [Import from eBay]         │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Source Files

| File | Purpose |
|------|---------|
| [ebay-stock/page.tsx](apps/web/src/app/(dashboard)/ebay-stock/page.tsx) | Main page component |
| [EbayListingsView.tsx](apps/web/src/components/features/ebay-stock/EbayListingsView.tsx) | Listings table |
| [EbayComparisonView.tsx](apps/web/src/components/features/ebay-stock/EbayComparisonView.tsx) | Stock comparison |
| [EbayListingsFilters.tsx](apps/web/src/components/features/ebay-stock/EbayListingsFilters.tsx) | Filter controls |
| [PriceUpdateDialog.tsx](apps/web/src/components/features/ebay-stock/PriceUpdateDialog.tsx) | Price edit dialog |
| [SkuIssuesBanner.tsx](apps/web/src/components/features/ebay-stock/SkuIssuesBanner.tsx) | SKU warning |
| [use-ebay-stock.ts](apps/web/src/hooks/use-ebay-stock.ts) | React Query hooks |
| [ebay-stock.service.ts](apps/web/src/lib/platform-stock/ebay/ebay-stock.service.ts) | Stock service |

## Related Journeys

- [eBay Authentication](./ebay-authentication.md) - Required connection
- [Listing Creation](./listing-creation.md) - Create new listings
- [Listing Optimiser](./listing-optimiser.md) - Improve existing listings
- [eBay Orders](../orders/ebay-orders.md) - View orders for listed items
