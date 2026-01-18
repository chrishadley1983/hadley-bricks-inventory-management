# Amazon Transaction Sync

## Overview

The Amazon transaction sync imports financial transactions from Amazon's Finances API v2024-06-19. This provides detailed fee breakdowns for each sale, refund, and other financial events - essential for accurate profit calculation and reconciliation.

## Why Transaction Sync?

Orders show what was sold, but transactions show the actual money:
- Exact referral fees charged
- FBA fees (if applicable)
- Shipping credits and taxes
- Promotional rebates
- Net payout amount

Without transaction data, profit calculations are estimates based on average fees.

## Accessing Transaction Data

**Navigation**: Dashboard sidebar → Transactions

The transactions page shows:
- All financial transactions across platforms
- Filter by Amazon to see Amazon-specific data
- Fee breakdown columns
- Link to related orders

## Sync Modes

### Incremental Sync (Default)

1. Reads `transactions_posted_cursor` from `amazon_sync_config`
2. Fetches transactions posted since that cursor
3. Updates cursor to newest transaction date
4. Runs quickly (usually seconds)

### Full Sync

1. Fetches all transactions from January 1, 2025
2. Updates all existing records
3. Used for initial setup or data repair

### Historical Import

1. Specify custom date range
2. Useful for importing older data
3. Handles Amazon's 180-day API limit with auto-chunking

## Transaction Types

The Finances API returns various transaction types:

| Type | Description |
|------|-------------|
| `Shipment` | Sale completed and shipped |
| `Refund` | Customer refund issued |
| `Adjustment` | Manual adjustments |
| `ServiceFee` | Amazon service charges |
| `Chargeback` | Credit card disputes |
| `Transfer` | Disbursement to bank |

## Fee Extraction

Each transaction has nested breakdowns. The system extracts:

| Fee Type | Database Column |
|----------|-----------------|
| Referral Fee | `referral_fee` |
| FBA Fulfillment Fee | `fba_fulfillment_fee` |
| FBA Per-Unit Fee | `fba_per_unit_fee` |
| FBA Weight-Based Fee | `fba_weight_fee` |
| FBA Storage Fee | `fba_inventory_storage_fee` |
| Shipping Credit | `shipping_credit` |
| Shipping Credit Tax | `shipping_credit_tax` |
| Promotional Rebate | `promotional_rebate` |
| Sales Tax Collected | `sales_tax_collected` |
| Marketplace Facilitator Tax | `marketplace_facilitator_tax` |
| Gift Wrap Credit | `gift_wrap_credit` |
| Other Fees | `other_fees` |

### Calculated Fields

| Field | Calculation |
|-------|-------------|
| `gross_sales_amount` | `total_amount + total_fees` (for Shipment type) |
| `net_amount` | Direct from API (payout amount) |
| `total_fees` | Sum of all negative breakdown amounts |

## Data Model

Each transaction record contains:

### Identifiers
- `amazon_transaction_id` - Generated unique ID
- `amazon_order_id` - Linked order ID
- `seller_order_id` - Your order reference
- `marketplace_id` - Which marketplace

### Timing
- `posted_date` - When Amazon posted the transaction
- `transaction_type` - Type of transaction
- `transaction_status` - Processing status

### Amounts
- `total_amount` - Net payout (positive or negative)
- `currency` - Currency code

### Item Context
- `asin` - Product ASIN
- `seller_sku` - Your SKU
- `quantity` - Units involved
- `store_name` - Amazon store name
- `fulfillment_channel` - MFN or FBA

### Raw Data
- `breakdowns` - Full fee breakdown JSON
- `contexts` - Item context JSON
- `related_identifiers` - Order/item IDs JSON
- `raw_response` - Complete API response

## Sync Status Tracking

The system tracks sync progress in `amazon_sync_log`:

| Field | Description |
|-------|-------------|
| `sync_type` | TRANSACTIONS |
| `sync_mode` | FULL, INCREMENTAL, or HISTORICAL |
| `status` | RUNNING, COMPLETED, FAILED |
| `started_at` | When sync began |
| `completed_at` | When sync finished |
| `records_processed` | Total transactions fetched |
| `records_created` | New records inserted |
| `records_updated` | Existing records updated |
| `last_sync_cursor` | Newest transaction date |
| `error_message` | Error details if failed |

## Triggering Sync

### From Transactions Page

1. Navigate to Transactions
2. Use sync controls (if available)
3. Choose incremental or full sync

### Programmatically

```typescript
const service = new AmazonTransactionSyncService();

// Incremental
await service.syncTransactions(userId);

// Full sync
await service.syncTransactions(userId, { fullSync: true });

// Historical import
await service.syncTransactions(userId, {
  fromDate: '2024-06-01T00:00:00.000Z',
  toDate: '2024-12-31T23:59:59.999Z'
});
```

## Transaction ID Generation

Amazon doesn't provide unique transaction IDs, so the system generates them:

1. Combines: type + date + amount + currency + orderId + marketplaceId
2. Generates hash for uniqueness
3. Format: `{orderId}_{hash}` or `tx_{hash}`

This ensures:
- Same transaction always gets same ID
- Deduplication works correctly
- Upserts merge properly

## API Limitations

Amazon Finances API has constraints:

| Constraint | Handling |
|------------|----------|
| 180-day date range limit | Auto-chunks requests |
| End date must be 2+ min before now | Uses 3-minute safety buffer |
| Rate limiting | 150ms delay between batches |
| Batch size | 100 records per upsert |

## Sync Results

Returns `AmazonSyncResult`:

```typescript
{
  success: boolean;
  syncType: 'FULL' | 'INCREMENTAL' | 'HISTORICAL';
  recordsProcessed: number;
  recordsCreated: number;
  recordsUpdated: number;
  lastSyncCursor?: string;
  error?: string;
  startedAt: Date;
  completedAt: Date;
}
```

## Using Transaction Data

### Profit Calculation

Transaction data enables accurate profit calculation:
```
Profit = Gross Sales - Cost of Goods - Actual Amazon Fees
```

Without transactions, fees are estimated at ~15-20%.

### Fee Analysis

Analyse which fees are eating into margins:
- High referral fees → Consider category changes
- High FBA fees → Compare with MFN fulfillment
- Unexpected fees → Investigate and dispute

### Reconciliation

Match transactions to:
- Bank deposits (Transfer type)
- Sales orders (Shipment type)
- Returns inventory (Refund type)

## Related Files

| File | Purpose |
|------|---------|
| `apps/web/src/lib/amazon/amazon-transaction-sync.service.ts` | Main sync service |
| `apps/web/src/lib/amazon/amazon-finances.client.ts` | Finances API client |
| `apps/web/src/lib/amazon/types.ts` | Type definitions |
| `apps/web/src/hooks/use-amazon-transaction-sync.ts` | React hooks |
| `apps/web/src/app/(dashboard)/transactions/page.tsx` | Transactions page |

## Troubleshooting

### "A transaction sync is already running"
- Only one sync can run at a time per user
- Check `amazon_sync_log` for stuck RUNNING entries
- May need to manually update status to FAILED

### Missing recent transactions
- Amazon has a ~2-hour delay posting transactions
- Very recent sales may not appear immediately
- Run incremental sync again later

### Duplicate transactions
- Deduplication uses generated IDs
- Same transaction should merge via upsert
- Check `amazon_transaction_id` for duplicates

### Fee amounts seem wrong
- Verify currency is correct
- Check `breakdowns` JSON for full detail
- Some fees may be in nested breakdowns

### Historical import fails
- Amazon limits to 180-day chunks
- System should auto-chunk, but may timeout
- Try smaller date ranges manually
