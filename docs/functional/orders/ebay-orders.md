# User Journey: eBay Orders

> **Journey:** Manage eBay orders with SKU matching and fulfilment
> **Entry Point:** `/orders/ebay`
> **Complexity:** High

## Overview

The eBay Orders page provides a dedicated view for managing orders from the eBay marketplace. It includes status filtering, SKU-to-inventory matching, picking list generation, and bulk order confirmation.

## User Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         /orders/ebay                                │
├─────────────────────────────────────────────────────────────────────┤
│  eBay Orders                                         [Sync Orders]  │
│  View and manage orders from your eBay Seller account              │
├─────────────────────────────────────────────────────────────────────┤
│  Status Summary Cards                                               │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐       │
│  │   All   │ │  Paid   │ │ Packed  │ │Completed│ │Refunded │       │
│  │   300   │ │   25    │ │   10    │ │   250   │ │   15    │       │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘       │
├─────────────────────────────────────────────────────────────────────┤
│  Order History                                                      │
│  ┌──────────────────────────────────────────────────────────────────┐
│  │ [Search...]  [Platform ▼] [Status ▼] [Match Status ▼]           │
│  └──────────────────────────────────────────────────────────────────┘
│  ┌──────────────────────────────────────────────────────────────────┐
│  │ Order ID     │ Date   │ Buyer    │ Items      │ Status │ Total  │
│  ├──────────────────────────────────────────────────────────────────┤
│  │ 12-34567-890 │ Jan 18 │ buyer123 │ 1 item     │ Paid   │ £45.99 │
│  │              │        │          │ ✓ matched  │        │        │
│  ├──────────────────────────────────────────────────────────────────┤
│  │ 12-34567-891 │ Jan 17 │ buyer456 │ 2 items    │ Paid   │ £89.00 │
│  │              │        │          │ ⚠ 1 unmatched       │        │
│  │              │        │          │ ⚠ 1 no SKU │        │        │
│  └──────────────────────────────────────────────────────────────────┘
└─────────────────────────────────────────────────────────────────────┘
```

## Key Concepts

### eBay Order Statuses

| Status | Description | UI Colour |
|--------|-------------|-----------|
| **Paid** | Payment received, awaiting fulfilment | Purple |
| **Packed** | Items packed, ready to ship | Blue |
| **Completed** | Order shipped and delivered | Green |
| **Refunded** | Order refunded/cancelled | Red |

### Match Status

Each order item has a match status based on SKU mapping:

| Status | Meaning | Badge |
|--------|---------|-------|
| **matched** | SKU found in inventory | Green ✓ |
| **unmatched** | SKU exists but no inventory match | Orange ⚠ |
| **no_sku** | Item has no SKU on eBay | Red ⚠ |
| **linked** | Item already linked to inventory | Green with link icon |

### SKU Matching Flow

```
eBay Order Item
      │
      ▼
Has SKU? ──No──▶ "no_sku" status
      │
     Yes
      │
      ▼
SKU in inventory? ──No──▶ "unmatched" status (needs linking)
      │
     Yes
      │
      ▼
"matched" status (can confirm)
```

---

## Steps

### 1. Access eBay Orders

**Action:** Navigate to `/orders/ebay` (click "eBay" card on main orders page)

**What Happens:**
1. Page loads with eBay-specific status summary
2. Orders fetched from `ebay_orders` table
3. Match status computed for each order

### 2. View Status Summary

**Action:** Click status cards to filter

**Cards:**
| Card | Filter |
|------|--------|
| All | No filter |
| Paid | `ui_status = 'Paid'` |
| Packed | `ui_status = 'Packed'` |
| Completed | `ui_status = 'Completed'` |
| Refunded | `ui_status = 'Refunded'` |

### 3. Filter by Match Status

**Action:** Select from Match Status dropdown

**Options:**
| Value | Description |
|-------|-------------|
| All Match Status | No filter (default) |
| Matched | Orders with all items matched |
| Unmatched | Orders with unmatched items |
| No SKU | Orders with items missing SKU |

### 4. View Unmatched Items

**Action:** Click unmatched badge on order row

**Opens Dialog:**
```
┌─────────────────────────────────────────────────────────────────────┐
│  SKU Issues for Order #12-34567-891                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Items needing attention:                                           │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ LEGO Star Wars Millennium Falcon                              │ │
│  │ SKU: HB-75192-N                                               │ │
│  │ Status: Unmatched - Click to link                             │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ LEGO Technic Car                                              │ │
│  │ No SKU on eBay listing                                        │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                    [Close]          │
└─────────────────────────────────────────────────────────────────────┘
```

### 5. Link SKU to Inventory

**Action:** Click unmatched item to open SKU Matcher

**SKU Matcher Dialog:**
```
┌─────────────────────────────────────────────────────────────────────┐
│  Link SKU to Inventory                                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Item: LEGO Star Wars Millennium Falcon                            │
│  SKU: HB-75192-N                                                   │
│                                                                     │
│  Search Inventory:                                                  │
│  ┌─────────────────────────────────────────────────────────────────┐
│  │ [Search inventory items...]                                     │
│  └─────────────────────────────────────────────────────────────────┘
│                                                                     │
│  Matching Inventory Items:                                          │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ ○ 75192 Millennium Falcon - New Sealed     £599.99   A-01     │ │
│  │ ○ 75192 Millennium Falcon - New Sealed     £589.99   B-03     │ │
│  │ ○ 75192 Millennium Falcon - Used Complete  £449.99   C-12     │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                              [Cancel]  [Create SKU Mapping]         │
└─────────────────────────────────────────────────────────────────────┘
```

**Process:**
1. Search shows inventory items matching set number
2. Select the correct inventory item
3. Creates mapping in `ebay_sku_mappings` table
4. Future orders with same SKU auto-match

### 6. Generate Picking List

**Action:** Click "Pick List" from main orders page eBay card

**What Happens:**
1. Generates PDF with unfulfilled orders
2. Groups by storage location
3. Shows item details and quantities
4. Opens in new browser tab

### 7. Select Orders for Confirmation

**Action:** From main orders page, click "Confirm Orders Processed" on eBay card

**Opens Confirmation Dialog** - See [Order Confirmation](./order-confirmation.md)

### 8. Sync eBay Orders

**Action:** Click "Sync Orders" button

**Process:**
1. Calls `/api/integrations/ebay/sync`
2. Fetches recent orders from eBay API
3. Updates `ebay_orders` table
4. Shows success message with count

### 9. Switch to Other Platform

**Action:** Select different platform from dropdown

**Redirects:**
| Selection | Destination |
|-----------|-------------|
| All Platforms | `/orders` |
| Amazon | `/orders/amazon` |
| Bricqer | `/orders?platform=bricqer` |
| BrickLink | `/orders?platform=bricklink` |
| Brick Owl | `/orders?platform=brickowl` |

### 10. View Order Details

**Action:** Click "View Details" in row menu

**Navigation:** → `/orders/ebay/[id]`

---

## Table Columns

| Column | Description |
|--------|-------------|
| Order ID | eBay order reference (clickable) |
| Platform | Always "eBay" badge |
| Date | Order creation date |
| Buyer | Buyer username |
| Description | Item names (truncated) |
| Items | Item count + match badges |
| Status | UI status badge |
| Total | Order total |
| Actions | Dropdown menu |

## Match Badges

```
┌─────────────────────────────────────────────────────────────────────┐
│ Items column examples:                                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ 1 item(s)  [✓ matched]           All items have SKU mappings       │
│                                                                     │
│ 2 item(s)  [⚠ 1 unmatched]       1 item needs SKU linking          │
│                                                                     │
│ 3 item(s)  [⚠ 2 no SKU]          2 items have no SKU on eBay       │
│                                                                     │
│ 1 item(s)  [✓ linked]            Item already linked to inventory  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Technical Details

### Query Keys

```typescript
// eBay orders list
['ebay', 'orders', 'list', page, status, search, matchFilter]

// eBay status summary
['ebay', 'orders', 'status-summary', timeframe]

// eBay connection status
['ebay', 'status']

// eBay sync log
['ebay', 'sync-log']
```

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/orders/ebay` | GET | List eBay orders with filtering |
| `/api/orders/ebay/status-summary` | GET | Status counts |
| `/api/integrations/ebay/sync` | POST | Sync orders from eBay |
| `/api/integrations/ebay/status` | GET | Connection status |
| `/api/picking-list/ebay` | GET | Generate picking list PDF |

### Data Structure

```typescript
interface EbayOrder {
  id: string;
  ebay_order_id: string;
  buyer_username: string;
  creation_date: string;
  total: number;
  currency: string;
  order_fulfilment_status: string;  // Raw eBay status
  order_payment_status: string;
  ui_status: string;  // Normalised status
  items: EbayOrderItem[];
  match_summary: {
    total: number;
    unmatched: number;
    no_sku: number;
    linked: number;
    all_matched: boolean;
  };
}
```

### SKU Mapping Table

```sql
CREATE TABLE ebay_sku_mappings (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  sku VARCHAR NOT NULL,
  set_number VARCHAR,
  condition VARCHAR,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## Error Handling

### eBay Not Connected

```
┌─────────────────────────────────────────────────────────────────────┐
│  ⚠️ eBay not connected                                              │
│  Connect your eBay account to view and manage orders.              │
│                                                    [Connect eBay]   │
└─────────────────────────────────────────────────────────────────────┘
```

### No Matching Inventory

```
┌─────────────────────────────────────────────────────────────────────┐
│  No matching inventory items found                                  │
│  Try searching with different terms or check your inventory.       │
└─────────────────────────────────────────────────────────────────────┘
```

### Sync Failed

```
┌─────────────────────────────────────────────────────────────────────┐
│  ❌ Failed to sync eBay orders                                      │
│  Check your eBay connection and try again.                         │
│                                                    [Retry]          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Source Files

| File | Purpose |
|------|---------|
| [orders/ebay/page.tsx](apps/web/src/app/(dashboard)/orders/ebay/page.tsx) | eBay orders page |
| [EbaySkuMatcherDialog.tsx](apps/web/src/components/features/orders/EbaySkuMatcherDialog.tsx) | SKU linking dialog |
| [ConfirmOrdersDialog.tsx](apps/web/src/components/features/orders/ConfirmOrdersDialog.tsx) | Order confirmation |

## Related Journeys

- [Viewing Orders](./viewing-orders.md) - Main orders page
- [Amazon Orders](./amazon-orders.md) - Amazon order management
- [Order Confirmation](./order-confirmation.md) - Confirm and link orders
