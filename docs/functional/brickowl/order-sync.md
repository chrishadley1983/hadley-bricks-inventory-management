# User Journey: Brick Owl Order Sync

> **Journey:** Synchronize orders and transactions from your Brick Owl store
> **Entry Point:** Automatic (background) or Manual (Transactions page)
> **Complexity:** Low

## Overview

Brick Owl order sync imports your sales orders and financial transactions from the Brick Owl marketplace. The system supports incremental syncing (only new orders since last sync), full refresh, and historical imports for backfilling data.

## User Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Transactions Page                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Brick Owl Transactions                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ✓ Connected                          Last sync: Jan 18, 2026 14:30  │   │
│  │ 523 transactions                                                     │   │
│  │                                                                      │   │
│  │                              [Sync Now]  [Full Refresh]  [Import]   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ Order ID   │ Date       │ Buyer      │ Total   │ Status   │ Payment │  │
│  ├──────────────────────────────────────────────────────────────────────┤  │
│  │ 12345678   │ 18/01/2026 │ John D.    │ £45.99  │ Shipped  │ Cleared │  │
│  │ 12345677   │ 17/01/2026 │ Jane S.    │ £23.50  │ Received │ Cleared │  │
│  │ 12345676   │ 16/01/2026 │ Bob M.     │ £89.00  │ Pending  │ Pending │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Key Concepts

### Sync Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| **Incremental** | Only orders since last sync cursor | Daily sync (default) |
| **Full** | All orders, resets cursor | Data refresh, recovery |
| **Historical** | Orders in specific date range | Initial setup, backfill |

### Order Data Captured

| Field | Description |
|-------|-------------|
| `brickowl_order_id` | Unique order identifier |
| `order_date` | When order was placed |
| `buyer_name` | Customer name |
| `buyer_email` | Customer email |
| `order_total` | Total order value |
| `shipping` | Shipping cost |
| `tax` | Tax amount |
| `base_grand_total` | Subtotal before extras |
| `order_status` | Current order status |
| `payment_status` | Payment state |
| `tracking_number` | Shipment tracking |

### Auto-Sync Configuration

```typescript
interface SyncConfig {
  autoSyncEnabled: boolean;        // Enable automatic syncing
  autoSyncIntervalHours: number;   // Hours between syncs (default: 6)
  lastSyncDateCursor: string;      // ISO date of last sync
  historicalImportCompleted: boolean;
  nextAutoSyncAt: string;          // When next auto-sync is due
}
```

---

## Steps

### 1. Incremental Sync (Default)

**Action:** Click "Sync Now" or triggered automatically

**What Happens:**
1. Fetches orders modified since `lastSyncDateCursor`
2. For each order:
   - Fetch order details from API
   - Fetch order items (separate API call)
   - Normalize data format
   - Upsert to `brickowl_transactions` table
3. Updates `lastSyncDateCursor` to current time
4. Creates sync log entry

**Progress Indicator:**
```
┌─────────────────────────────────────────────────────────────────────────┐
│  Syncing Brick Owl Transactions                                         │
│                                                                         │
│  ████████████████░░░░░░░░░░░░░░░░░░░░░░░░  42%                        │
│                                                                         │
│  Processing order 12345678...                                          │
│  45 of 107 orders processed                                            │
└─────────────────────────────────────────────────────────────────────────┘
```

**Success Result:**
```
✓ Sync completed
  - 107 orders processed
  - 23 new orders created
  - 84 orders updated
```

### 2. Full Refresh

**Action:** Click "Full Refresh"

**Confirmation Dialog:**
```
┌─────────────────────────────────────────────────────────────────────────┐
│  Full Refresh                                                     [✕]   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  This will reset your sync cursor and re-fetch all orders from         │
│  Brick Owl. This may take several minutes depending on your order      │
│  history.                                                               │
│                                                                         │
│  Existing transaction records will be updated with fresh data.         │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                          [Cancel]  [Start Refresh]      │
└─────────────────────────────────────────────────────────────────────────┘
```

**What Happens:**
1. Resets `lastSyncDateCursor` to null
2. Fetches ALL orders from Brick Owl
3. Upserts all records (updates existing, creates new)
4. Sets new cursor to current time

### 3. Historical Import

**Action:** Click "Import" button

**Import Dialog:**
```
┌─────────────────────────────────────────────────────────────────────────┐
│  Historical Import                                               [✕]   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Import orders from a specific date range. Use this to backfill        │
│  historical data when first connecting your account.                   │
│                                                                         │
│  From Date *                                                            │
│  [2024-01-01        ] 📅                                               │
│                                                                         │
│  To Date                                                                │
│  [Today             ] 📅                                               │
│  Leave empty for all orders up to today                                │
│                                                                         │
│  ⓘ This will import all orders in the date range. Existing            │
│    records will be updated with the latest data.                       │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                          [Cancel]  [Start Import]       │
└─────────────────────────────────────────────────────────────────────────┘
```

**What Happens:**
1. Fetches orders within specified date range
2. Processes in batches of 100 for database efficiency
3. Creates sync log with `HISTORICAL` mode
4. Marks `historicalImportCompleted = true` when done

### 4. View Sync History

**Action:** Expand sync log section

**Sync Log Display:**
```
┌─────────────────────────────────────────────────────────────────────────┐
│  Recent Sync Activity                                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Jan 18, 2026 14:30  │ INCREMENTAL │ ✓ Completed │ 12 processed       │
│  Jan 18, 2026 08:30  │ INCREMENTAL │ ✓ Completed │ 8 processed        │
│  Jan 17, 2026 20:30  │ INCREMENTAL │ ✓ Completed │ 15 processed       │
│  Jan 15, 2026 10:00  │ FULL        │ ✓ Completed │ 523 processed      │
│  Jan 10, 2026 09:00  │ HISTORICAL  │ ✓ Completed │ 1,245 processed    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Technical Details

### Sync Service Architecture

```typescript
class BrickOwlTransactionSyncService {
  private client: BrickOwlClient;
  private supabase: SupabaseClient;
  private userId: string;

  // Sync transactions with date filtering
  async syncTransactions(options: SyncOptions): Promise<SyncResult> {
    const orders = await this.fetchOrders(options);
    const processed = await this.processOrders(orders);
    await this.updateSyncConfig(options.mode);
    return this.createSyncLog(processed);
  }

  // Historical import for specific date range
  async performHistoricalImport(fromDate: string, toDate?: string): Promise<SyncResult> {
    const orders = await this.fetchOrdersInRange(fromDate, toDate);
    return this.batchUpsert(orders);
  }
}
```

### Batch Processing

Orders are upserted in batches for performance:

```typescript
const BATCH_SIZE = 100;

async batchUpsert(orders: NormalizedOrder[]): Promise<void> {
  for (let i = 0; i < orders.length; i += BATCH_SIZE) {
    const batch = orders.slice(i, i + BATCH_SIZE);
    await this.supabase
      .from('brickowl_transactions')
      .upsert(batch, { onConflict: 'brickowl_order_id,user_id' });
  }
}
```

### API Rate Limiting

- **Daily Limit:** 10,000 requests
- **Per Order:** 2 requests (order details + items)
- **Practical Limit:** ~5,000 orders per day

The client tracks remaining quota and throws `BrickOwlRateLimitError` if exceeded.

### Sync Log Schema

```sql
CREATE TABLE brickowl_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  sync_mode TEXT NOT NULL,  -- 'INCREMENTAL', 'FULL', 'HISTORICAL'
  status TEXT NOT NULL,     -- 'RUNNING', 'COMPLETED', 'FAILED'
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  orders_processed INTEGER DEFAULT 0,
  orders_created INTEGER DEFAULT 0,
  orders_updated INTEGER DEFAULT 0,
  error_message TEXT
);
```

---

## Error Handling

### Common Errors

| Error | Cause | Resolution |
|-------|-------|------------|
| `INVALID_KEY` | API key revoked or incorrect | Re-enter API key in Settings |
| `429 Rate Limit` | Exceeded 10,000 daily requests | Wait 24 hours or retry tomorrow |
| `TIMEOUT` | API response took >30 seconds | Retry later |
| `NETWORK_ERROR` | Connection failed | Check internet, retry |

### Error States

**Sync Failed:**
```
┌─────────────────────────────────────────────────────────────────────────┐
│  ✕ Sync Failed                                                          │
│                                                                         │
│  Could not complete sync: Rate limit exceeded                          │
│                                                                         │
│  45 orders were processed before the error occurred.                   │
│  You can retry the sync later to continue.                             │
│                                                                         │
│                                                     [Dismiss]  [Retry] │
└─────────────────────────────────────────────────────────────────────────┘
```

**Partial Sync:**
- Some orders may have been saved before failure
- Next incremental sync will pick up where it left off
- Sync log records partial progress

---

## Auto-Sync Behavior

When `autoSyncEnabled` is true:

1. **Check on App Load:** Dashboard checks if sync is due
2. **Trigger Condition:** `now() >= nextAutoSyncAt`
3. **Background Execution:** Sync runs without blocking UI
4. **Next Schedule:** `nextAutoSyncAt = now() + autoSyncIntervalHours`

### Configuration

```typescript
// Default configuration
const defaultConfig: SyncConfig = {
  autoSyncEnabled: true,
  autoSyncIntervalHours: 6,
  historicalImportCompleted: false,
};
```

---

## Source Files

| File | Purpose |
|------|---------|
| [brickowl-transaction-sync.service.ts](../../../apps/web/src/lib/brickowl/brickowl-transaction-sync.service.ts) | Main sync service |
| [client.ts](../../../apps/web/src/lib/brickowl/client.ts) | API client |
| [adapter.ts](../../../apps/web/src/lib/brickowl/adapter.ts) | Data normalization |
| [use-brickowl-transaction-sync.ts](../../../apps/web/src/hooks/use-brickowl-transaction-sync.ts) | React hooks |

## Related Journeys

- [Brick Owl Authentication](./brickowl-authentication.md) - Connect your account first
- [BrickLink Order Sync](../bricklink/order-sync.md) - Similar sync for BrickLink
- [Transactions Overview](../transactions/overview.md) - View all transactions
