# Amazon Transactions

## Overview

The Amazon tab displays financial transactions from the Amazon SP-API Finances endpoint. Track sales, fees, refunds, and settlements with detailed breakdowns.

**Navigation**: Transactions → Amazon tab

## Prerequisites

- Amazon Seller Central account
- Amazon SP-API credentials configured
- Integration enabled in Settings
- Selling Partner API access

## Summary Metrics

| Metric | Description |
|--------|-------------|
| **Total Sales** | Gross revenue from sales |
| **Total Fees** | Amazon fees (referral, FBA, etc.) |
| **Total Refunds** | Refund amounts |
| **Net Revenue** | Sales - Fees - Refunds |

Metrics calculated for the selected date range.

## Transaction Types

| Type | Description |
|------|-------------|
| **Order** | Product sale |
| **Refund** | Customer refund |
| **Adjustment** | Account adjustment |
| **Service Fee** | Amazon service charges |
| **Chargeback** | Payment dispute |
| **Guarantee Claim** | A-to-z claim |
| **Reimbursement** | Amazon reimbursement |

## Transaction Fields

| Field | Description |
|-------|-------------|
| **Posted Date** | When transaction posted |
| **Purchase Date** | Order date (for sales) |
| **Type** | Transaction type |
| **Order ID** | Amazon order number |
| **ASIN** | Product ASIN |
| **SKU** | Seller SKU |
| **Title** | Product title |
| **Quantity** | Units in transaction |
| **Total Amount** | Transaction value |
| **Fees** | Total fees |
| **Net Amount** | Amount after fees |
| **Marketplace** | Which Amazon marketplace |

## Fee Breakdown

For order transactions, fees include:

| Fee Type | Description |
|----------|-------------|
| **Referral Fee** | Amazon commission |
| **FBA Fulfillment Fee** | If using FBA |
| **FBA Per-Unit Fee** | Per-item FBA charge |
| **FBA Weight Fee** | Weight-based FBA charge |
| **Total Fees** | Sum of all fees |

## Filtering

### Transaction Type

Filter by specific types:
- Order
- Refund
- Adjustment
- Service Fee
- All types

### Date Range

Standard date range presets apply.

### Search

Search across:
- Order ID
- ASIN
- SKU
- Product title
- Description

## Sorting

Click column headers to sort by:
- **Purchase Date** (default for orders)
- **Posted Date**
- **Total Amount**
- **ASIN**

## Transaction Details

Click a transaction to view:
- Full transaction data
- Complete fee breakdown
- Order details (enriched from orders)
- Product information

## Sync

### Sync Modes

| Mode | Description |
|------|-------------|
| **Incremental** | Fetch recent transactions only |
| **Full** | Re-sync all transactions |

### Manual Sync

1. Select sync mode (Incremental/Full)
2. Click **Sync** button
3. Shows transactions processed
4. Updates transaction list

### When to Use Full Sync

- First time setup
- Suspected missing data
- After configuration changes
- Periodic reconciliation

### Sync Status

| Status | Meaning |
|--------|---------|
| Connected | Amazon account linked |
| Syncing | Fetch in progress |
| X processed, Y new | Sync complete |
| Error | Sync failed |

## Marketplace Support

Amazon transactions can come from multiple marketplaces:

| Marketplace | Region |
|-------------|--------|
| UK | amazon.co.uk |
| DE | amazon.de |
| FR | amazon.fr |
| IT | amazon.it |
| ES | amazon.es |

## Data Enrichment

Transactions are enriched with:
- Order details from platform_orders
- Product titles from order_items
- Additional ASINs from orders

This provides context missing from raw financial data.

## Use Cases

### Fee Analysis

1. Filter date range
2. Review Total Fees summary
3. Click transactions to see fee breakdowns
4. Calculate fee percentage of sales

### Refund Tracking

1. Filter by Type = Refund
2. Review refund amounts
3. Identify refund patterns
4. Link to original orders

### Marketplace Comparison

1. Review transactions by marketplace
2. Compare fee structures
3. Identify best-performing markets

### Monthly Reconciliation

1. Set date range to last month
2. Compare with Amazon reports
3. Verify totals match
4. Export for accounting

## Integration

Amazon transactions integrate with:
- **Platform Performance Report** - Cross-platform analysis
- **Profit & Loss Report** - Revenue and fee tracking
- **Orders Page** - Order details
- **Inventory** - SKU/ASIN matching

## Troubleshooting

### "Not Connected"

1. Go to Settings → Integrations
2. Check Amazon credentials
3. Verify SP-API access
4. Re-authorize if needed

### Missing Transactions

1. Try Full sync mode
2. Expand date range
3. Check Amazon Seller Central for data
4. Transactions may have posting delay

### Fee Discrepancies

- Amazon reports fees differently in various reports
- Transaction fees are per-transaction
- Settlement reports aggregate differently
- Use Posted Date for accurate matching

### Enrichment Missing

- Not all transactions link to orders
- Service fees don't have order context
- Run order sync before transaction sync

## API Details

### Endpoint

```
GET /api/amazon/transactions
```

### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `page` | number | Page number |
| `pageSize` | number | Items per page |
| `search` | string | Search text |
| `transactionType` | string | Filter by type |
| `fromDate` | ISO date | Start date |
| `toDate` | ISO date | End date |
| `sortBy` | string | Sort field |
| `sortOrder` | string | 'asc' or 'desc' |

### Response

```json
{
  "transactions": [...],
  "pagination": {
    "page": 1,
    "pageSize": 50,
    "total": 300,
    "totalPages": 6
  },
  "summary": {
    "totalSales": 8500.00,
    "totalFees": 1700.00,
    "totalRefunds": 200.00,
    "netRevenue": 6600.00
  }
}
```

## Related Documentation

- [Transactions Overview](./overview.md) - All platform transactions
- [Amazon Integration](../amazon/overview.md) - Amazon setup and features
- [Amazon Transaction Sync](../amazon/transaction-sync.md) - Detailed sync documentation
- [Platform Performance Report](../reports/platform-performance.md) - Cross-platform analysis
