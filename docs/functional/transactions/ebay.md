# eBay Transactions

## Overview

The eBay tab displays financial transactions from the eBay Finances API. Track sales, refunds, fees, and payouts with detailed breakdowns.

**Navigation**: Transactions → eBay tab

## Prerequisites

- eBay account connected via OAuth 2.0
- eBay developer credentials configured
- Managed payments enabled on eBay account

## Summary Metrics

| Metric | Description |
|--------|-------------|
| **Total Sales** | Gross revenue from sales |
| **Total Fees** | Platform fees (FVF, international, etc.) |
| **Total Refunds** | Refund amounts processed |
| **Net Revenue** | Sales - Fees - Refunds |

Metrics calculated for the selected date range.

## Transaction Types

| Type | Description |
|------|-------------|
| **Sale** | Item sold to buyer |
| **Refund** | Money returned to buyer |
| **Credit** | Credit applied to account |
| **Dispute** | Case or dispute transaction |
| **Fee** | Non-sale charge (subscription, etc.) |
| **Shipping Label** | Postage label purchase |
| **Transfer** | Account transfer |
| **Adjustment** | Manual adjustment |
| **Payout** | Transfer to bank account |

## Transaction Fields

| Field | Description |
|-------|-------------|
| **Date** | Transaction date |
| **Type** | Transaction type (Sale, Refund, etc.) |
| **Status** | Transaction status |
| **Item** | Item title (for sales) |
| **SKU** | Custom label/SKU |
| **Order ID** | eBay order reference |
| **Buyer** | Buyer username |
| **Amount** | Transaction value |
| **Fees** | Fee breakdown |

## Fee Breakdown

For sale transactions, fees include:

| Fee Type | Description |
|----------|-------------|
| **Final Value Fee (Fixed)** | Fixed portion of FVF |
| **Final Value Fee (Variable)** | Percentage of sale |
| **International Fee** | Cross-border selling fee |
| **Regulatory Operating Fee** | Regulatory compliance fee |
| **Total Fees** | Sum of all fees |

## Filtering

### Transaction Type

Filter by specific types:
- Sale
- Refund
- Credit
- Dispute
- Fee
- Shipping Label
- Transfer
- Adjustment
- Payout

### Date Range

Standard date range presets apply.

### Search

Search across:
- Item title
- SKU/Custom label
- Order ID
- Buyer username

## Sorting

Click column headers to sort by:
- **Date** (default, descending)
- **Amount**
- **Item Title**

## Transaction Details

Click a transaction to view:
- Full transaction data
- Complete fee breakdown
- Order reference links
- Transaction memo

## Sync

### Manual Sync

1. Click **Sync** button
2. Fetches recent transactions from eBay
3. Shows orders and transactions processed
4. Updates transaction list

### What Gets Synced

- Financial transactions (last 90 days)
- Associated order data
- Fee breakdowns
- Payout information

### Sync Status Messages

| Message | Meaning |
|---------|---------|
| "Syncing..." | Sync in progress |
| "X orders, Y transactions processed" | Sync complete |
| Error message | Sync failed |

## Understanding Net Revenue

```
Net Revenue = Total Sales - Total Fees - Total Refunds
```

This represents actual money earned before:
- Cost of goods
- Shipping costs
- Other expenses

## Payout Tracking

Payout transactions show:
- Amount transferred to bank
- Payout date
- Payout reference

Match with bank statements for reconciliation.

## Integration with Other Features

### Orders Page
- Links to full order details
- SKU matching with inventory

### Reports
- Feeds into Platform Performance report
- Contributes to Profit & Loss

### Inventory
- SKU links to inventory items
- Sale updates item status

## Troubleshooting

### "Not Connected"

1. Go to Settings → Integrations
2. Check eBay connection
3. Re-authenticate if token expired

### Missing Transactions

1. Check date range filter
2. Ensure managed payments enabled
3. Run manual sync
4. Transactions may take time to appear in eBay API

### Fee Discrepancies

- Fees are as reported by eBay
- May differ from eBay invoices
- Check transaction memo for details

## API Details

### Endpoint

```
GET /api/ebay/transactions
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
    "total": 500,
    "totalPages": 10
  },
  "summary": {
    "totalSales": 5000.00,
    "totalFees": 650.00,
    "totalRefunds": 50.00,
    "netRevenue": 4300.00
  }
}
```

## Related Documentation

- [Transactions Overview](./overview.md) - All platform transactions
- [eBay Integration](../ebay/overview.md) - eBay connection setup
- [eBay Transaction Sync](../ebay/ebay-transaction-sync.md) - Detailed sync documentation
- [Platform Performance Report](../reports/platform-performance.md) - Cross-platform analysis
