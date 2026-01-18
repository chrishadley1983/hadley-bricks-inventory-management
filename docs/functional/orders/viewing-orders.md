# User Journey: Viewing Orders

> **Journey:** Browse, search, and filter orders from all platforms
> **Entry Point:** `/orders`
> **Complexity:** Medium

## Overview

The main orders page provides a unified view of orders from all connected sales platforms (eBay, Amazon, Bricqer/BrickLink/Brick Owl). Users can filter by platform, status, and timeframe, with platform-specific cards showing sync status and quick actions.

## User Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                           /orders                                   │
├─────────────────────────────────────────────────────────────────────┤
│  Orders                                     [Timeframe ▼] [Sync All]│
│  View and manage orders from your connected platforms               │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────────────┐
│  │ Status Summary Cards                                             │
│  │ [ All ] [ Pending ] [ Paid ] [ Packed ] [ Shipped ] [ Done ] [X] │
│  │   847      12         45       23         156         598    13  │
│  └──────────────────────────────────────────────────────────────────┘
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐        │
│  │    Bricqer      │ │     Amazon      │ │      eBay       │        │
│  │  ✓ Connected    │ │  ✓ Connected    │ │  ✓ Connected    │        │
│  │  245 orders     │ │  302 orders     │ │  300 orders     │        │
│  │  Last: Jan 18   │ │  Last: Jan 18   │ │  Last: Jan 18   │        │
│  │  [Sync Bricqer] │ │  [Sync] [Pick]  │ │  [Sync] [Pick]  │        │
│  │                 │ │  [Confirm...]   │ │  [Confirm...]   │        │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘        │
├─────────────────────────────────────────────────────────────────────┤
│  Order History                                                      │
│  ┌──────────────────────────────────────────────────────────────────┐
│  │ [Search...    ] [Platform ▼] [Status ▼]                          │
│  └──────────────────────────────────────────────────────────────────┘
│  ┌──────────────────────────────────────────────────────────────────┐
│  │ ☐ │ Order ID    │ Platform │ Date   │ Buyer  │ Status │ Total   │
│  ├──────────────────────────────────────────────────────────────────┤
│  │ ☐ │ 123-456-789 │ eBay     │ Jan 18 │ buyer1 │ Paid   │ £45.99  │
│  │ ☐ │ 111-222-333 │ Amazon   │ Jan 17 │ Amazon │ Shipped│ £32.50  │
│  │ ...                                                              │
│  └──────────────────────────────────────────────────────────────────┘
│  Showing 1-20 of 847 orders                    [◀ Previous] [Next ▶]│
└─────────────────────────────────────────────────────────────────────┘
```

## Steps

### 1. Access Orders Page

**Action:** Navigate to `/orders` from the sidebar

**What Happens:**
1. Page loads with status summary cards
2. Platform status cards show connection status and order counts
3. Orders table loads with pagination (20 items per page)
4. Queries run in parallel: `orders`, `platform-statuses`, `status-summary`, `ebay-status-summary`

### 2. View Status Summary

**Action:** Observe the status summary cards

**Display:**
| Card | Shows |
|------|-------|
| All Orders | Total count across all platforms |
| Pending | Orders awaiting payment |
| Paid | Orders with payment received |
| Packed | Orders ready for shipping |
| Shipped | Orders dispatched |
| Completed | Delivered orders |
| Cancelled/Refunded | Cancelled or refunded orders |

**Behaviour:**
- Click any card to filter the table by that status
- Active filter highlighted with ring
- Click again to clear filter

### 3. View Platform Cards

**Action:** Examine platform status cards

**Each Card Shows:**
- Connection status indicator (✓ or ⚠)
- Total order count (clickable to filter)
- Status breakdown (coloured links)
- Last sync timestamp
- Action buttons

**Bricqer Card:**
```
Bricqer                              ✓
245 orders
12 Pending  23 Paid  156 Shipped  50 Done  4 Cancelled
Last sync: Jan 18, 2:30 pm
[Sync Bricqer]
```

**Amazon Card:**
```
Amazon                               ✓
302 orders
5 Pending  15 Paid  30 Shipped  248 Done  4 Cancelled
Last sync: Jan 18, 2:35 pm
[Sync]  [Pick List]
[Confirm Orders Processed]

────────────────────────────
15 items missing fee data
[Reconcile Fees]
```

**eBay Card:**
```
eBay                                 ✓
300 orders
25 Paid  10 Packed  250 Done  15 Refunded
Last sync: Jan 18, 2:40 pm
[Sync]  [Pick List]
[Confirm Orders Processed]
```

### 4. Filter by Timeframe

**Action:** Select from timeframe dropdown

**Options:**
| Value | Description |
|-------|-------------|
| All Time | Show all orders (default) |
| Last 7 Days | Orders from past week |
| Last 30 Days | Orders from past month |
| Last 90 Days | Orders from past quarter |

### 5. Search Orders

**Action:** Type in search box

**Behaviour:**
- Searches across: `platform_order_id`, `buyer_name`, item names
- No debounce on this page (immediate)
- Clear with X button

### 6. Filter by Platform

**Action:** Select from Platform dropdown

**Options:**
| Value | Description |
|-------|-------------|
| All Platforms | Show all (default) |
| Bricqer | BrickLink, Brick Owl, Bricqer orders |
| Amazon | Amazon orders only |
| eBay | eBay orders only |

### 7. Filter by Status

**Action:** Select from Status dropdown

**Options:**
| Value | Filter |
|-------|--------|
| All Statuses | No filter (default) |
| Pending | `internal_status = 'Pending'` |
| Paid | `internal_status = 'Paid'` |
| Packed | `internal_status = 'Packed'` |
| Shipped | `internal_status = 'Shipped'` |
| Completed | `internal_status = 'Completed'` |
| Cancelled | `internal_status = 'Cancelled'` |

### 8. Select Orders for Bulk Actions

**Action:** Check order checkboxes

**Behaviour:**
- Individual checkbox: Toggle single order
- Header checkbox: Toggle all visible orders
- Shows "X selected" counter
- Reveals bulk action dropdown

### 9. Bulk Update Status

**Action:** Click "Update Status" dropdown

**Options:**
| Action | Result |
|--------|--------|
| Mark as Paid | Set `internal_status = 'Paid'` |
| Mark as Packed | Set `internal_status = 'Packed'` |
| Mark as Shipped | Set `internal_status = 'Shipped'` |
| Mark as Completed | Set `internal_status = 'Completed'` |
| Cancel Orders | Set `internal_status = 'Cancelled'` |

### 10. Sync All Platforms

**Action:** Click "Sync All Platforms" button

**Process:**
1. Button shows "Syncing..." with spinner
2. Calls `/api/integrations/sync-all-orders`
3. Each platform synced in parallel
4. Success alert shows counts: "X orders processed (Y new, Z updated)"
5. All queries invalidated and refreshed

### 11. Sync Individual Platform

**Action:** Click platform-specific sync button

**Behaviour:**
- Only that platform synced
- Smaller scope, faster completion
- Updates platform card counts

### 12. Generate Picking List

**Action:** Click "Pick List" button on Amazon or eBay card

**Behaviour:**
- Opens PDF in new tab
- Lists unfulfilled orders with item details
- Shows storage locations for picking

### 13. View Order Details

**Action:** Click on order row or "View Details" in dropdown

**Navigation:**
- eBay orders: → `/orders/ebay/[id]`
- Other platforms: → `/orders/[id]`

### 14. Paginate Results

**Action:** Click Previous/Next or page numbers

**Behaviour:**
- 20 items per page
- Scroll position maintained
- Loading state during transition

---

## Table Columns

| Column | Description | Sortable |
|--------|-------------|----------|
| Select | Checkbox for bulk operations | No |
| Order ID | Platform-specific order identifier | No |
| Platform | Badge showing source platform | No |
| Date | Order creation date | Yes |
| Buyer | Buyer name or username | No |
| Description | Item names (truncated, with tooltip) | No |
| Status | Normalised status badge | No |
| Total | Order total in currency | No |
| Actions | Row action menu | No |

## Row Actions Menu

```
┌─────────────────┐
│ View Details    │ → Opens order detail page
├─────────────────┤
│ Update Status   │ → Opens order detail page
└─────────────────┘
```

---

## Technical Details

### Query Keys

```typescript
// Main orders list
['orders', page, platform, status, search]

// Platform sync status
['platforms', 'sync-status']

// Status summary (combined)
['orders', 'status-summary', timeframe]

// Platform-specific summaries
['orders', 'status-summary', 'bricqer', timeframe]
['orders', 'status-summary', 'amazon', timeframe]

// eBay status
['ebay', 'status']
['ebay', 'orders', 'status-summary', timeframe]
['ebay', 'sync-log']

// eBay orders (when platform=ebay)
['ebay', 'orders', 'list', page, status, search]
```

### Stale Times

| Query | Stale Time | Reason |
|-------|------------|--------|
| Orders list | Default (0) | Always fresh on navigation |
| Platform status | 30 seconds | Auto-refresh for sync status |
| Status summary | 30 seconds | Keep counts current |
| eBay status | 60 seconds | Connection check |

### Data Merging

When "All Platforms" is selected, orders from different tables are merged:

```typescript
// Regular orders (platform_orders table)
const regularOrders = ordersData?.data || [];

// eBay orders (ebay_orders table)
const ebayOrders = ebayOrdersData?.data.map(transformEbayOrderForDisplay);

// Combined and sorted by date
const orders = [...regularOrders, ...ebayOrders].sort((a, b) =>
  new Date(b.order_date).getTime() - new Date(a.order_date).getTime()
);
```

### Status Colour Mapping

```typescript
function getStatusColor(status: string): string {
  const statusLower = status.toLowerCase();

  if (statusLower.includes('completed') || statusLower.includes('received'))
    return 'bg-green-100 text-green-800';

  if (statusLower.includes('shipped') || statusLower.includes('packed'))
    return 'bg-blue-100 text-blue-800';

  if (statusLower.includes('paid') || statusLower.includes('ready'))
    return 'bg-purple-100 text-purple-800';

  if (statusLower.includes('pending') || statusLower.includes('processing'))
    return 'bg-yellow-100 text-yellow-800';

  if (statusLower.includes('cancel') || statusLower.includes('npb'))
    return 'bg-red-100 text-red-800';

  return 'bg-gray-100 text-gray-800';
}
```

---

## Error Handling

### No Platforms Configured

```
┌─────────────────────────────────────────────────────────────────────┐
│  ⚠️ No platforms configured                                         │
│  Connect Bricqer, Amazon, or eBay to sync orders.                  │
│                                                    [Configure]      │
└─────────────────────────────────────────────────────────────────────┘
```

### Sync Failed

```
┌─────────────────────────────────────────────────────────────────────┐
│  ❌ Sync failed                                                     │
│  Failed to sync orders from Amazon. Check your credentials.        │
│                                                    [Retry]          │
└─────────────────────────────────────────────────────────────────────┘
```

### No Orders Found

```
┌─────────────────────────────────────────────────────────────────────┐
│  No orders found. Try syncing with the selected platform.          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Source Files

| File | Purpose |
|------|---------|
| [orders/page.tsx](apps/web/src/app/(dashboard)/orders/page.tsx) | Main page component |
| [use-orders.ts](apps/web/src/hooks/use-orders.ts) | React Query hooks |
| [order.repository.ts](apps/web/src/lib/repositories/order.repository.ts) | Data access |
| [order-sync.service.ts](apps/web/src/lib/services/order-sync.service.ts) | Sync logic |

## Related Journeys

- [eBay Orders](./ebay-orders.md) - eBay-specific order management
- [Amazon Orders](./amazon-orders.md) - Amazon-specific order management
- [Order Confirmation](./order-confirmation.md) - Confirm and link orders
