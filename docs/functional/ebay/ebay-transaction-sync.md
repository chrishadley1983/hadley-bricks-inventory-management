# User Journey: eBay Transaction Sync

> **Journey:** Sync financial transactions and payouts from eBay
> **Entry Point:** `/transactions` or background cron
> **Complexity:** Medium

## Overview

The eBay Transaction Sync imports financial data from eBay's Finances API, including sales transactions, fees, refunds, and payouts. It supports incremental sync, full sync, and historical imports, tracking all fee types for accurate profit calculation.

## User Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Transactions                                 │
├─────────────────────────────────────────────────────────────────────┤
│  Transactions                                            [Sync eBay]│
│  View and manage financial transactions from all platforms          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Summary (Last 30 days)                                            │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐   │
│  │   Revenue   │ │    Fees     │ │   Payouts   │ │    Net      │   │
│  │  £12,450.00 │ │  £1,867.50  │ │  £10,582.50 │ │  £10,582.50 │   │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ [Search...]  [Platform ▼]  [Type ▼]  [Date Range ▼]          │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ Date       │ Type    │ Order ID    │ Amount  │ Fees   │ Net  │  │
│  ├──────────────────────────────────────────────────────────────┤  │
│  │ Jan 18     │ SALE    │ 12-34567-8  │ £45.99  │ £5.52  │ £40.47│  │
│  │ Jan 17     │ SALE    │ 12-34567-9  │ £89.99  │ £10.80 │ £79.19│  │
│  │ Jan 17     │ REFUND  │ 12-34568-0  │ -£29.99 │ £0.00  │-£29.99│  │
│  │ Jan 16     │ PAYOUT  │ -           │ -       │ -      │£1,234 │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Key Concepts

### Transaction Types

| Type | Description | Booking Entry |
|------|-------------|---------------|
| SALE | Item sold | CREDIT |
| REFUND | Refund issued | DEBIT |
| SHIPPING_LABEL | Postage purchase | DEBIT |
| TRANSFER | Bank transfer | DEBIT |
| DISPUTE | Case/dispute charge | DEBIT |
| CREDIT | Seller adjustment | CREDIT |
| NON_SALE_CHARGE | Monthly fees, etc. | DEBIT |

### Fee Types Tracked

| Fee Type | Column | Description |
|----------|--------|-------------|
| FINAL_VALUE_FEE_FIXED_PER_ORDER | `final_value_fee_fixed` | Fixed per-order fee |
| FINAL_VALUE_FEE | `final_value_fee_variable` | Percentage-based fee |
| REGULATORY_OPERATING_FEE | `regulatory_operating_fee` | Regulatory fee |
| INTERNATIONAL_FEE | `international_fee` | International shipping fee |
| AD_FEE | `ad_fee` | Promoted Listings fee |
| INSERTION_FEE | `insertion_fee` | Listing insertion fee |

### Sync Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| INCREMENTAL | From last sync cursor | Regular updates |
| FULL | All transactions | Re-sync everything |
| HISTORICAL | Specific date range | Import old data |

---

## Steps

### 1. Trigger Manual Sync

**Action:** Click "Sync eBay" button on transactions page

**What Happens:**
1. Checks for running sync (prevents duplicates)
2. Creates sync log entry with RUNNING status
3. Gets OAuth access token
4. Fetches transactions from eBay Finances API
5. Upserts to `ebay_transactions` table
6. Updates sync cursor for next incremental
7. Marks sync as COMPLETED

**Progress Display:**
```
┌─────────────────────────────────────────────────────────────────────┐
│  Syncing eBay Transactions                                          │
│  ────────────────────────────────────────────────────────────────   │
│  Fetching transactions from eBay...                                │
│  Page 2 of 5 (1,847 transactions)                                  │
│                                                                     │
│  ■■■■■■■■■■■■■■■■□□□□ 40%                                          │
└─────────────────────────────────────────────────────────────────────┘
```

### 2. View Sync Status

**Action:** Check sync status

**Status Display:**
```
┌─────────────────────────────────────────────────────────────────────┐
│  eBay Transaction Sync                                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Last Sync: Jan 18, 2026 at 2:45 PM                                │
│  Status: ✓ Completed                                                │
│  Records: 47 processed (12 new, 35 updated)                        │
│                                                                     │
│  Payout Sync: Jan 18, 2026 at 2:46 PM                              │
│  Status: ✓ Completed                                                │
│  Records: 3 processed (1 new, 2 updated)                           │
│                                                                     │
│                              [Sync Now]  [Full Sync]                │
└─────────────────────────────────────────────────────────────────────┘
```

### 3. Historical Import

**Action:** Import transactions from a specific date

**Historical Import Dialog:**
```
┌─────────────────────────────────────────────────────────────────────┐
│  Historical Import                                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Import eBay transactions from a specific date.                    │
│  This may take several minutes for large date ranges.              │
│                                                                     │
│  From Date: [2025-01-01]                                           │
│  To Date:   [2026-01-18] (today)                                   │
│                                                                     │
│  ⚠️ This will fetch all transactions in this range,                │
│  which may use significant API quota.                              │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                              [Cancel]  [Start Import]               │
└─────────────────────────────────────────────────────────────────────┘
```

**What Happens:**
1. Updates sync config with import parameters
2. Fetches all transactions in date range
3. Fetches all payouts in date range
4. Upserts to respective tables
5. Marks historical import complete

### 4. View Transaction Details

**Action:** Click on a transaction row

**Transaction Detail:**
```
┌─────────────────────────────────────────────────────────────────────┐
│  Transaction Details                                        [✕]    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Transaction ID: 12345678901234                                    │
│  Order ID: 12-34567-89012                                          │
│  Date: Jan 18, 2026 at 10:30 AM                                    │
│                                                                     │
│  Type: SALE                                                         │
│  Status: COMPLETED                                                  │
│                                                                     │
│  Buyer: buyer_username123                                          │
│                                                                     │
│  ────────────────────────────────────────────────────────────────   │
│                                                                     │
│  Gross Amount:     £45.99                                          │
│                                                                     │
│  Fees:                                                              │
│    Final Value (Fixed):     -£0.30                                 │
│    Final Value (Variable):  -£4.60                                 │
│    Regulatory Operating:    -£0.32                                 │
│    Ad Fee (Promoted):       -£0.30                                 │
│    ─────────────────────────────                                   │
│    Total Fees:              -£5.52                                 │
│                                                                     │
│  Net Amount:       £40.47                                          │
│                                                                     │
│  Payout: PO-12345678 (Jan 19, 2026)                               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 5. View Payouts

**Action:** Filter by type "PAYOUT" or view Payouts tab

**Payout Details:**
```
┌─────────────────────────────────────────────────────────────────────┐
│  Payout Details                                             [✕]    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Payout ID: PO-12345678                                            │
│  Date: Jan 19, 2026                                                │
│  Status: SUCCEEDED                                                  │
│                                                                     │
│  Amount: £1,234.56                                                 │
│  Currency: GBP                                                      │
│                                                                     │
│  Bank Account: ****1234 (Barclays)                                 │
│  Reference: EBAY-PO12345678                                        │
│                                                                     │
│  Transactions Included: 47                                         │
│                                                                     │
│  ────────────────────────────────────────────────────────────────   │
│                                                                     │
│  [View Included Transactions]                                       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Technical Details

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/ebay/transactions/sync` | POST | Trigger transaction sync |
| `/api/ebay/transactions` | GET | List transactions |
| `/api/ebay/payouts/sync` | POST | Trigger payout sync |
| `/api/ebay/payouts` | GET | List payouts |
| `/api/ebay/sync-status` | GET | Get sync status |

### eBay Finances API Calls

| Endpoint | Max per Page | Purpose |
|----------|--------------|---------|
| `GET /sell/finances/v1/transaction` | 1000 | Fetch transactions |
| `GET /sell/finances/v1/payout` | 200 | Fetch payouts |

### Transaction Data Structure

```typescript
interface EbayTransaction {
  id: string;
  user_id: string;
  ebay_transaction_id: string;
  ebay_order_id: string | null;
  transaction_type: string;
  transaction_status: string;
  transaction_date: string;
  amount: number;                    // Net amount
  currency: string;
  booking_entry: 'CREDIT' | 'DEBIT';
  payout_id: string | null;
  buyer_username: string | null;
  total_fee_amount: number | null;
  final_value_fee_fixed: number | null;
  final_value_fee_variable: number | null;
  regulatory_operating_fee: number | null;
  international_fee: number | null;
  ad_fee: number | null;
  insertion_fee: number | null;
  gross_transaction_amount: number | null;
  raw_response: Json;
}
```

### Payout Data Structure

```typescript
interface EbayPayout {
  id: string;
  user_id: string;
  ebay_payout_id: string;
  payout_status: string;
  payout_date: string;
  amount: number;
  currency: string;
  payout_instrument: {
    instrumentType: string;
    nickname: string;
    accountLastFourDigits: string;
  } | null;
  transaction_count: number | null;
  bank_reference: string | null;
}
```

### Sync Configuration

```typescript
interface EbaySyncConfig {
  user_id: string;
  transactions_date_cursor: string | null;
  payouts_date_cursor: string | null;
  auto_sync_enabled: boolean;
  next_auto_sync_at: string | null;
  historical_import_started_at: string | null;
  historical_import_from_date: string | null;
  historical_import_completed_at: string | null;
}
```

### Sync Log Entry

```typescript
interface EbaySyncLog {
  id: string;
  user_id: string;
  sync_type: 'TRANSACTIONS' | 'PAYOUTS';
  sync_mode: 'INCREMENTAL' | 'FULL' | 'HISTORICAL';
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  started_at: string;
  completed_at: string | null;
  records_processed: number | null;
  records_created: number | null;
  records_updated: number | null;
  last_sync_cursor: string | null;
  from_date: string | null;
  to_date: string | null;
  error_message: string | null;
}
```

### Date Filter Format

```typescript
// Transaction date filter (eBay API format)
static buildTransactionDateFilter(fromDate?: string, toDate?: string): string {
  const parts: string[] = [];

  if (fromDate) {
    parts.push(`transactionDate:[${fromDate}..`);
  }
  if (toDate) {
    parts.push(`${toDate}]`);
  }

  return parts.join('');
}

// Example: "transactionDate:[2025-01-01..2026-01-18]"
```

---

## Error Handling

### Sync Already Running

```
┌─────────────────────────────────────────────────────────────────────┐
│  ⚠️ Sync In Progress                                                │
│                                                                     │
│  A transaction sync is already running. Please wait for it         │
│  to complete before starting another.                              │
│                                                                     │
│                                                    [OK]             │
└─────────────────────────────────────────────────────────────────────┘
```

### Token Expired

```
┌─────────────────────────────────────────────────────────────────────┐
│  ❌ Sync Failed                                                     │
│                                                                     │
│  No valid eBay access token. Please reconnect to eBay.             │
│                                                                     │
│                              [Reconnect eBay]  [Close]              │
└─────────────────────────────────────────────────────────────────────┘
```

### API Rate Limit

```
┌─────────────────────────────────────────────────────────────────────┐
│  ⚠️ Rate Limited                                                    │
│                                                                     │
│  eBay API rate limit reached. The sync will resume automatically   │
│  in a few minutes.                                                 │
│                                                                     │
│                                                    [OK]             │
└─────────────────────────────────────────────────────────────────────┘
```

### Partial Failure

```
┌─────────────────────────────────────────────────────────────────────┐
│  ⚠️ Sync Partially Complete                                         │
│                                                                     │
│  Transactions synced: 1,234 / 1,500                                │
│  Error: Connection timeout after page 5                            │
│                                                                     │
│  The sync will continue from where it left off on next run.        │
│                                                                     │
│                              [Retry Now]  [Close]                   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Background Sync (Cron)

The system can run automatic syncs via a cron job:

```typescript
// /api/cron/ebay-sync

// Runs every 6 hours
// 1. Gets all users with auto_sync_enabled
// 2. Triggers incremental sync for each
// 3. Updates next_auto_sync_at

async function cronEbaySync() {
  const users = await getUsersWithAutoSync();

  for (const user of users) {
    await ebayTransactionSyncService.syncTransactions(user.id);
    await ebayTransactionSyncService.syncPayouts(user.id);
  }
}
```

---

## Source Files

| File | Purpose |
|------|---------|
| [ebay-transaction-sync.service.ts](apps/web/src/lib/ebay/ebay-transaction-sync.service.ts) | Main sync service |
| [ebay-api.adapter.ts](apps/web/src/lib/ebay/ebay-api.adapter.ts) | API adapter |
| [transactions/page.tsx](apps/web/src/app/(dashboard)/transactions/page.tsx) | Transactions page |
| [sync/route.ts](apps/web/src/app/api/ebay/transactions/sync/route.ts) | Sync API endpoint |

## Related Journeys

- [eBay Authentication](./ebay-authentication.md) - Required connection
- [eBay Orders](../orders/ebay-orders.md) - Links transactions to orders
- [Reports](../reports/overview.md) - Uses transaction data for profit reports
