# User Journey: BrickLink Order Sync

> **Journey:** Synchronize sales orders from BrickLink to track revenue and fulfillment
> **Entry Point:** Settings > Integrations (or automatic sync)
> **Complexity:** Medium

## Overview

BrickLink Order Sync imports sales orders from your BrickLink store into the system. It uses intelligent incremental sync to minimize API calls, only fetching full order details for new or changed orders.

## User Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Settings > Integrations                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  BrickLink                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ [BrickLink Logo]                                                     │   │
│  │                                                                      │   │
│  │ BrickLink Integration                                                │   │
│  │ Your BrickLink store is connected.                                  │   │
│  │                                                                      │   │
│  │ Status: ✓ Connected                                                 │   │
│  │ Orders: 1,234 synced                                                │   │
│  │ Last Sync: Jan 18, 2026 14:30                                       │   │
│  │                                                                      │   │
│  │                              [Sync Now]  [Disconnect]               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Key Concepts

### Sync Modes

| Mode | Description | When Used |
|------|-------------|-----------|
| Incremental | Only fetch changed orders | Default sync |
| Full | Fetch all orders with items | Force refresh |

### Incremental Sync Optimization

The sync service compares `date_status_changed` timestamps to determine which orders need updates:

1. **Fetch all order summaries** (single API call)
2. **Compare against existing timestamps** from database
3. **Classify orders**:
   - New orders → fetch full details
   - Changed orders → fetch full details
   - Unchanged orders → skip (use existing data)

This optimization significantly reduces API calls for stores with many historical orders.

### Order Statuses

| BrickLink Status | Normalized Status | Description |
|------------------|-------------------|-------------|
| `PENDING` | `pending` | Order placed, awaiting action |
| `UPDATED` | `pending` | Buyer updated the order |
| `PROCESSING` | `pending` | Seller processing |
| `READY` | `pending` | Ready for payment |
| `PAID` | `processing` | Payment received |
| `PACKED` | `processing` | Items packed |
| `SHIPPED` | `shipped` | Shipped to buyer |
| `RECEIVED` | `completed` | Buyer confirmed receipt |
| `COMPLETED` | `completed` | Order finalized |
| `OCR` | `on_hold` | Order change request |
| `NPB` | `problem` | Non-paying buyer |
| `NPX` | `problem` | Non-paying buyer (extended) |
| `NRS` | `problem` | Non-responding seller |
| `NSS` | `problem` | Non-shipping seller |
| `CANCELLED` | `cancelled` | Order cancelled |

### Order Direction

BrickLink distinguishes between:
- **Sales Orders** (`direction='out'`): Orders you're selling (customers buying from you)
- **Purchase Orders** (`direction='in'`): Orders you're buying (you buying from sellers)

The sync focuses on sales orders for revenue tracking.

---

## Steps

### 1. Trigger Manual Sync

**Action:** Click "Sync Now" on the BrickLink integration card

**Sync Progress:**
```
┌─────────────────────────────────────────────────────────────────────────┐
│  Syncing BrickLink Orders                                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ███████████████████████░░░░░░░  78%                                   │
│                                                                         │
│  Processing: Order #12345678                                            │
│  234 / 300 orders                                                       │
│                                                                         │
│  Stats:                                                                 │
│  • Created: 5 new orders                                               │
│  • Updated: 12 changed orders                                          │
│  • Skipped: 217 unchanged orders                                       │
│                                                                         │
│                                                          [Cancel]       │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2. View Sync Results

**Success Result:**
```
┌─────────────────────────────────────────────────────────────────────────┐
│  ✓ Sync Complete                                                  [✕]   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  BrickLink orders synced successfully.                                 │
│                                                                         │
│  Summary:                                                               │
│  • Total processed: 300 orders                                         │
│  • Created: 5 new orders                                               │
│  • Updated: 12 orders                                                  │
│  • Skipped: 283 unchanged                                              │
│                                                                         │
│  Time taken: 45 seconds                                                │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                              [Done]     │
└─────────────────────────────────────────────────────────────────────────┘
```

**Partial Failure:**
```
┌─────────────────────────────────────────────────────────────────────────┐
│  ⚠️ Sync Completed with Errors                                   [✕]   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Most orders synced, but some errors occurred.                         │
│                                                                         │
│  Summary:                                                               │
│  • Total processed: 298 / 300 orders                                   │
│  • Created: 5 new orders                                               │
│  • Updated: 10 orders                                                  │
│  • Errors: 2 orders                                                    │
│                                                                         │
│  Errors:                                                                │
│  • Order #12345678: Invalid item data                                  │
│  • Order #12345679: Connection timeout                                 │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                        [View Errors]  [Retry Failed]    │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3. View Synced Orders

**Action:** Navigate to Orders page

**Synced orders appear in the unified orders table:**
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Orders                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [Search orders...]   [Platform ▼] BrickLink  [Status ▼] All               │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │☐│ Order ID    │ Platform  │ Date       │ Buyer     │ Status │ Total │  │
│  ├──────────────────────────────────────────────────────────────────────┤  │
│  │☐│ BL-12345678 │ BrickLink │ Jan 18, 26 │ John D.   │ Paid   │ £45.00│  │
│  │☐│ BL-12345677 │ BrickLink │ Jan 17, 26 │ Sarah M.  │ Shipped│ £89.50│  │
│  │☐│ BL-12345676 │ BrickLink │ Jan 16, 26 │ Mike R.   │Complete│£125.00│  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4. View Order Details

**Action:** Click on an order row

**Order Detail View:**
```
┌─────────────────────────────────────────────────────────────────────────┐
│  Order BL-12345678                                               [✕]    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Order Info                          Buyer                              │
│  ───────────                         ─────                              │
│  Platform: BrickLink                 Name: John Doe                     │
│  Order Date: Jan 18, 2026            Email: john@example.com           │
│  Status: Paid                                                           │
│  Updated: Jan 18, 2026 14:30                                           │
│                                                                         │
│  Shipping Address                                                       │
│  ─────────────────                                                     │
│  John Doe                                                               │
│  123 High Street                                                        │
│  London, SW1A 1AA                                                       │
│  United Kingdom                                                         │
│                                                                         │
│  Order Items (3 items)                                                  │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Item          │ Color      │ Qty │ Condition │ Price   │ Total │   │
│  ├─────────────────────────────────────────────────────────────────┤   │
│  │ 3001 Brick 2x4│ Red        │  50 │ New       │ £0.10   │ £5.00 │   │
│  │ 3003 Brick 2x2│ Blue       │ 100 │ New       │ £0.08   │ £8.00 │   │
│  │ 3004 Brick 1x2│ Black      │ 200 │ New       │ £0.05   │£10.00 │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Order Summary                                                          │
│  ─────────────                                                         │
│  Subtotal:   £23.00                                                    │
│  Shipping:   £4.50                                                     │
│  Fees:       £0.00                                                     │
│  ──────────────────                                                    │
│  Total:      £27.50                                                    │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│  [View on BrickLink]  [Refresh Order]                        [Close]    │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5. Sync Individual Order

**Action:** Click "Refresh Order" on order detail

**What Happens:**
1. Fetches latest order data from BrickLink
2. Updates order status, dates, and items
3. Shows success/failure toast

---

## Technical Details

### Sync Options

```typescript
interface BrickLinkSyncOptions {
  /** Include filed/archived orders */
  includeFiled?: boolean;
  /** Force full sync (ignore last sync time) */
  fullSync?: boolean;
  /** Sync items for each order (slower but more complete) */
  includeItems?: boolean;
}
```

### Sync Result Structure

```typescript
interface SyncResult {
  success: boolean;
  ordersProcessed: number;
  ordersCreated: number;
  ordersUpdated: number;
  ordersSkipped: number;
  errors: string[];
  lastSyncedAt: Date;
}
```

### Order Data Normalization

BrickLink order data is normalized before storage:

```typescript
interface NormalizedOrder {
  platformOrderId: string;
  orderDate: Date;
  statusChangedAt: Date | null;
  buyerName: string;
  buyerEmail: string | null;
  status: NormalizedOrderStatus;
  subtotal: number;
  shipping: number;
  fees: number;
  total: number;
  currency: string;
  shippingAddress: Address | null;
  trackingNumber: string | null;
  items: NormalizedOrderItem[];
  rawData: Record<string, unknown>;
}
```

### Order Item Structure

```typescript
interface NormalizedOrderItem {
  itemNumber: string;
  itemName: string;
  itemType: BrickLinkItemType;
  colorId: number | null;
  colorName: string | null;
  quantity: number;
  condition: 'N' | 'U';
  unitPrice: number;
  totalPrice: number;
  currency: string;
}
```

### Database Operations

The sync service uses upsert operations for idempotent syncing:

```typescript
// Order upsert - updates existing or creates new
await this.orderRepo.upsert(orderInsert);

// Items replace - deletes old, inserts new
await this.orderRepo.replaceOrderItems(savedOrder.id, itemInserts);
```

### Timestamp Comparison

Incremental sync compares `date_status_changed`:

```typescript
// Get existing timestamps
const existingTimestamps = await this.orderRepo.getOrderStatusTimestamps(
  userId,
  'bricklink'
);

// Compare for each order
const remoteStatusChanged = new Date(orderSummary.date_status_changed);
if (!existingTimestamp || remoteStatusChanged > existingTimestamp) {
  // Order needs update - fetch full details
  needsItemFetch = true;
}
```

---

## Error Handling

### Rate Limit Error

```
❌ Rate limit exceeded
BrickLink allows 5,000 API requests per day.
Resets at: Jan 19, 2026 00:00 UTC
[View Usage] [Retry Tomorrow]
```

### Authentication Error

```
❌ Connection Failed
Invalid OAuth signature. Your credentials may have expired.
[Reconnect BrickLink]
```

### Network Error

```
❌ Sync Failed
Could not connect to BrickLink API. Check your internet connection.
[Retry]
```

---

## Sync Status

The integration card shows sync status indicators:

| Indicator | Meaning |
|-----------|---------|
| 🟢 Synced | Last sync < 1 hour ago |
| 🟡 Stale | Last sync > 24 hours ago |
| 🔴 Error | Last sync failed |
| ⏳ Syncing | Sync in progress |

---

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/integrations/bricklink/sync` | POST | Trigger order sync |
| `/api/integrations/bricklink/status` | GET | Get sync status |
| `/api/orders` | GET | List synced orders |
| `/api/orders/[id]` | GET | Get order details |
| `/api/orders/[id]/refresh` | POST | Refresh single order |

---

## Source Files

| File | Purpose |
|------|---------|
| [bricklink-sync.service.ts](../../../apps/web/src/lib/services/bricklink-sync.service.ts) | Sync orchestration |
| [client.ts](../../../apps/web/src/lib/bricklink/client.ts) | BrickLink API client |
| [adapter.ts](../../../apps/web/src/lib/bricklink/adapter.ts) | Response normalization |
| [order.repository.ts](../../../apps/web/src/lib/repositories/order.repository.ts) | Order data access |
| [orders/page.tsx](../../../apps/web/src/app/(dashboard)/orders/page.tsx) | Orders list page |

## Related Journeys

- [BrickLink Authentication](./bricklink-authentication.md) - Connect BrickLink account
- [BrickLink Uploads](./bricklink-uploads.md) - Track inventory batches
- [Order Management](../orders/overview.md) - Unified order view
