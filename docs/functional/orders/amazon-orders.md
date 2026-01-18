# User Journey: Amazon Orders

> **Journey:** Manage Amazon orders with ASIN matching and fee reconciliation
> **Entry Point:** `/orders/amazon`
> **Complexity:** High

## Overview

The Amazon Orders page provides a dedicated view for managing orders from Amazon Seller Central. It includes ASIN-to-inventory matching, order item backfilling, fee reconciliation, and bulk order confirmation with archive location assignment.

## User Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        /orders/amazon                               │
├─────────────────────────────────────────────────────────────────────┤
│  Amazon Orders                                       [Sync Orders]  │
│  View and manage orders from your Amazon Seller account            │
├─────────────────────────────────────────────────────────────────────┤
│  Status Summary Cards                                               │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌────┐│
│  │   All   │ │ Pending │ │  Paid   │ │ Shipped │ │Completed│ │ X  ││
│  │   302   │ │    5    │ │   15    │ │   30    │ │   248   │ │  4 ││
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ └────┘│
├─────────────────────────────────────────────────────────────────────┤
│  Order History                                                      │
│  ┌──────────────────────────────────────────────────────────────────┐
│  │ [Search...]  [Platform ▼] [Status ▼] [Match Status ▼]           │
│  └──────────────────────────────────────────────────────────────────┘
│  ┌──────────────────────────────────────────────────────────────────┐
│  │ Order ID          │ Date   │ Buyer  │ Items      │ Status │Total│
│  ├──────────────────────────────────────────────────────────────────┤
│  │ 111-2222222-33333 │ Jan 18 │ Amazon │ 1 item     │ Paid  │£32.50│
│  │                   │        │Customer│ ✓ linked   │       │      │
│  ├──────────────────────────────────────────────────────────────────┤
│  │ 111-2222222-44444 │ Jan 17 │ Amazon │ 2 items    │ Shipped│£65.00│
│  │                   │        │Customer│ ⚠1 unmatched       │      │
│  │                   │        │        │ ⚠1 No ASIN │       │      │
│  └──────────────────────────────────────────────────────────────────┘
└─────────────────────────────────────────────────────────────────────┘
```

## Key Concepts

### Amazon Order Statuses

| Status | Description | UI Colour |
|--------|-------------|-----------|
| **Pending** | Order placed, awaiting confirmation | Yellow |
| **Paid** | Payment confirmed | Purple |
| **Shipped** | Order dispatched | Blue |
| **Completed** | Order delivered | Green |
| **Cancelled** | Order cancelled | Red |

### ASIN Matching

Amazon orders identify items by ASIN (Amazon Standard Identification Number). Matching flow:

| Status | Meaning | Badge |
|--------|---------|-------|
| **matched** | ASIN mapped to inventory | - |
| **unmatched** | ASIN exists, no mapping | Orange ⚠ |
| **no_asin** | Item has no ASIN | Red ⚠ |
| **linked** | Item linked to specific inventory | Green ✓ |

### ASIN Mapping Table

```
┌─────────────────────────────────────────────────────────────────────┐
│ amazon_asin_mappings                                                │
├─────────────────────────────────────────────────────────────────────┤
│ asin         │ set_number │ condition │ created_at                  │
├─────────────────────────────────────────────────────────────────────┤
│ B07JPLG4BS   │ 75192      │ New       │ 2026-01-10                  │
│ B09876WXYZ   │ 10294      │ New       │ 2026-01-12                  │
└─────────────────────────────────────────────────────────────────────┘
```

### Archive Location Pattern

When Amazon orders are confirmed, linked inventory items are moved to archive:
- Format: `SOLD-YYYY-MM`
- Example: `SOLD-2026-01` for January 2026
- Allows tracking of when items were sold

---

## Steps

### 1. Access Amazon Orders

**Action:** Navigate to `/orders/amazon` (click "Amazon" link from main orders page)

**What Happens:**
1. Page loads with Amazon-specific status summary
2. Orders fetched with match status computed
3. Status summary cards show counts

### 2. View Status Summary

**Action:** Click status cards to filter

**Cards:**
| Card | Filter |
|------|--------|
| All | No filter |
| Pending | `ui_status = 'Pending'` |
| Paid | `ui_status = 'Paid'` |
| Shipped | `ui_status = 'Shipped'` |
| Completed | `ui_status = 'Completed'` |
| Cancelled | `ui_status = 'Cancelled'` |

### 3. Filter by Match Status

**Action:** Select from Match Status dropdown

**Options:**
| Value | Description |
|-------|-------------|
| All Match Status | No filter (default) |
| Matched | Orders with all items mapped |
| Unmatched | Orders with unmapped ASINs |
| No ASIN | Orders with items missing ASIN |

### 4. View Unmatched Items

**Action:** Click unmatched/no ASIN badge on order row

**Opens Dialog:**
```
┌─────────────────────────────────────────────────────────────────────┐
│  ⚠️ Unmatched Items                                                 │
│  These items need to be linked to inventory                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ LEGO Star Wars Millennium Falcon                              │ │
│  │ ASIN: B07JPLG4BS                                              │ │
│  │ Click to link to inventory                                    │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ Unknown Item                                                  │ │
│  │ No ASIN on Amazon order - cannot link to inventory            │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                    [Close]          │
└─────────────────────────────────────────────────────────────────────┘
```

### 5. Link ASIN to Inventory

**Action:** Click unmatched item to open ASIN Matcher

**ASIN Matcher Dialog:**
```
┌─────────────────────────────────────────────────────────────────────┐
│  Link ASIN to Inventory                                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Item: LEGO Star Wars Millennium Falcon                            │
│  ASIN: B07JPLG4BS                                                  │
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
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                              [Cancel]  [Create ASIN Mapping]        │
└─────────────────────────────────────────────────────────────────────┘
```

**Process:**
1. Search shows inventory items matching set number
2. Select the correct inventory item
3. Creates mapping in `amazon_asin_mappings` table
4. Links order item to specific inventory item
5. Future orders with same ASIN auto-match

### 6. Fetch Missing Item Details (Backfill)

**From Main Orders Page - Amazon Card:**

```
┌─────────────────────────────────────────────────────────────────────┐
│  15 orders missing item details                                     │
│  [Fetch Missing Items]                                              │
└─────────────────────────────────────────────────────────────────────┘
```

**Process:**
1. Click "Fetch Missing Items"
2. Progress bar shows: "Fetching items: 5/15"
3. Calls Amazon SP-API for each order
4. Populates `platform_order_items` table
5. Can be stopped mid-process

**Progress Display:**
```
┌─────────────────────────────────────────────────────────────────────┐
│  Fetching items: 8/15                              ~2m remaining    │
│  ████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░           53%   │
│  6 success                                              2 failed    │
│  [Stop Backfill]                                                    │
└─────────────────────────────────────────────────────────────────────┘
```

### 7. Reconcile Amazon Fees

**From Main Orders Page - Amazon Card:**

```
┌─────────────────────────────────────────────────────────────────────┐
│  15 items missing fee data                                          │
│  [Reconcile Fees]                                                   │
└─────────────────────────────────────────────────────────────────────┘
```

**Process:**
1. Click "Reconcile Fees"
2. Fetches fee data from Amazon reports
3. Updates inventory items with actual fees
4. Shows success: "Updated 12 items"

### 8. Generate Picking List

**Action:** Click "Pick List" from main orders page Amazon card

**What Happens:**
1. Generates PDF with unfulfilled orders
2. Groups by storage location
3. Shows ASIN, item name, quantity
4. Opens in new browser tab

### 9. Confirm Orders Processed

**Action:** From main orders page, click "Confirm Orders Processed" on Amazon card

**Opens Confirmation Dialog** - See [Order Confirmation](./order-confirmation.md)

**Amazon-Specific:**
- Archive location auto-generated (e.g., `SOLD-2026-01`)
- Items moved to archive location on confirmation
- Status updated to Completed

### 10. Sync Amazon Orders

**Action:** Click "Sync Orders" button

**Process:**
1. Calls `/api/integrations/amazon/sync`
2. Fetches recent orders from Amazon SP-API
3. Updates `platform_orders` table
4. Shows success message with count

### 11. View on Amazon

**Action:** Click "View on Amazon" in row dropdown

**Opens:** `https://sellercentral.amazon.co.uk/orders-v3/order/[order_id]`

### 12. Switch to Other Platform

**Action:** Select different platform from dropdown

**Redirects:**
| Selection | Destination |
|-----------|-------------|
| All Platforms | `/orders` |
| eBay | `/orders/ebay` |
| Bricqer | `/orders?platform=bricqer` |

---

## Table Columns

| Column | Description |
|--------|-------------|
| Order ID | Amazon order reference |
| Platform | Always "Amazon" badge |
| Date | Order creation date |
| Buyer | "Amazon Customer" (privacy) |
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
│ 1 item(s)  [✓ linked]            Item linked to inventory          │
│                                                                     │
│ 2 item(s)  [⚠ 1 unmatched]       1 ASIN needs mapping              │
│                                                                     │
│ 3 item(s)  [⚠ 2 No ASIN]         2 items have no ASIN              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Technical Details

### Query Keys

```typescript
// Amazon orders list
['amazon', 'orders', page, status, search, matchFilter]

// Amazon status summary
['amazon', 'orders', 'status-summary']

// Amazon backfill status
['amazon', 'backfill']

// Fee reconciliation status
['amazon', 'fee-reconciliation']
```

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/orders/amazon` | GET | List Amazon orders with filtering |
| `/api/orders/amazon/status-summary` | GET | Status counts |
| `/api/integrations/amazon/sync` | POST | Sync orders from Amazon |
| `/api/orders/backfill` | GET | Get backfill status |
| `/api/orders/backfill` | POST | Start backfill process |
| `/api/orders/backfill` | DELETE | Stop backfill process |
| `/api/admin/reconcile-amazon-fees` | GET | Preview fee reconciliation |
| `/api/admin/reconcile-amazon-fees` | POST | Run fee reconciliation |
| `/api/picking-list/amazon` | GET | Generate picking list PDF |

### Data Structure

```typescript
interface AmazonOrder {
  id: string;
  platform_order_id: string;
  order_date: string | null;
  buyer_name: string | null;
  buyer_email: string | null;
  status: string | null;
  internal_status: string | null;
  ui_status: string;
  total: number | null;
  currency: string | null;
  notes: string | null;
  items: AmazonOrderItem[];
  match_summary: {
    total: number;
    unmatched: number;
    no_asin: number;
    linked: number;
    all_matched: boolean;
  };
}

interface AmazonOrderItem {
  id: string;
  item_number: string | null;  // ASIN
  item_name: string | null;
  quantity: number;
  unit_price: number | null;
  total_price: number | null;
  currency: string | null;
  condition: string | null;
  inventory_item_id: string | null;
  amazon_linked_at: string | null;
  amazon_link_method: string | null;
  match_status: 'matched' | 'unmatched' | 'no_asin' | 'linked';
}
```

### Backfill Progress

```typescript
interface BackfillProgress {
  total: number;
  processed: number;
  success: number;
  failed: number;
  isRunning: boolean;
  startedAt: string | null;
  estimatedSecondsRemaining: number | null;
  currentOrderId: string | null;
  errors: string[];
}
```

---

## Error Handling

### Amazon Not Connected

```
┌─────────────────────────────────────────────────────────────────────┐
│  ⚠️ Amazon not configured                                           │
│  Connect your Amazon Seller account to view and manage orders.     │
│                                                    [Configure]      │
└─────────────────────────────────────────────────────────────────────┘
```

### No Matching Inventory

```
┌─────────────────────────────────────────────────────────────────────┐
│  No matching inventory items found                                  │
│  Try searching with different terms or check your inventory.       │
└─────────────────────────────────────────────────────────────────────┘
```

### Backfill Rate Limited

```
┌─────────────────────────────────────────────────────────────────────┐
│  ⚠️ Rate limit reached                                              │
│  Amazon API rate limit hit. Backfill will resume in 60 seconds.    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Source Files

| File | Purpose |
|------|---------|
| [orders/amazon/page.tsx](apps/web/src/app/(dashboard)/orders/amazon/page.tsx) | Amazon orders page |
| [AmazonAsinMatcherDialog.tsx](apps/web/src/components/features/orders/AmazonAsinMatcherDialog.tsx) | ASIN linking dialog |
| [LinkedInventoryPopover.tsx](apps/web/src/components/features/orders/LinkedInventoryPopover.tsx) | Linked item preview |
| [ConfirmOrdersDialog.tsx](apps/web/src/components/features/orders/ConfirmOrdersDialog.tsx) | Order confirmation |

## Related Journeys

- [Viewing Orders](./viewing-orders.md) - Main orders page
- [eBay Orders](./ebay-orders.md) - eBay order management
- [Order Confirmation](./order-confirmation.md) - Confirm and link orders
