# PayPal Transactions

## Overview

The PayPal tab displays payment transactions from your PayPal account. Track incoming payments, fees, and balances.

**Navigation**: Transactions → PayPal tab

## Prerequisites

- PayPal business account
- PayPal API credentials configured
- Integration enabled in Settings

## Summary Metrics

| Metric | Description |
|--------|-------------|
| **Total Fees** | PayPal processing fees |
| **Transaction Count** | Number of transactions |

Metrics calculated for the selected date range.

## Transaction Fields

| Field | Description |
|-------|-------------|
| **Date** | Transaction date/time |
| **Type** | Transaction type |
| **Status** | Payment status |
| **Gross** | Total amount received |
| **Fee** | PayPal fee charged |
| **Net** | Amount after fees |
| **Balance** | Account balance after transaction |
| **From** | Payer email address |
| **Name** | Payer name |
| **Description** | Transaction description |
| **Invoice ID** | Invoice reference (if applicable) |

## Filtering

### Date Range

Standard date range presets apply.

### Search

Search across:
- Description
- Payer name
- Payer email
- Invoice ID

## Sorting

Click column headers to sort by:
- **Date** (default, descending)
- **Fee Amount**
- **Gross Amount**
- **Payer Name**

## Transaction Details

Click a transaction to view:
- Full transaction data
- Payer information
- Fee breakdown
- Balance impact

## Sync

### Manual Sync

1. Click **Sync** button
2. Fetches recent transactions
3. Shows transactions processed and new count
4. Updates transaction list

### Sync Options

- **Incremental**: Fetch only new transactions
- Sync covers recent transaction history

### Sync Status

| Status | Meaning |
|--------|---------|
| Connected | PayPal account linked |
| Syncing | Fetch in progress |
| Complete | X processed, Y new |
| Error | Sync failed |

## Understanding PayPal Fees

PayPal charges:
- Percentage of transaction amount
- Fixed fee per transaction
- Different rates for domestic/international

Fee displayed is total fee for that transaction.

## Common Transaction Types

| Type | Description |
|------|-------------|
| **Payment** | Incoming payment |
| **Refund** | Money returned |
| **Transfer** | Bank withdrawal |
| **Fee** | PayPal charges |

## Use Cases

### Fee Tracking

1. Filter by date range
2. Review total fees
3. Compare with gross income
4. Calculate effective fee rate

### Payment Verification

1. Search by payer name/email
2. Find specific transaction
3. Verify amount and date
4. Check transaction status

### Bank Reconciliation

1. Match transfers to bank statements
2. Verify amounts match
3. Note any discrepancies

## Integration

PayPal transactions integrate with:
- **Profit & Loss Report** - Fee expenses
- **Order matching** - Payment verification

## Troubleshooting

### "Not Connected"

1. Go to Settings → Integrations
2. Check PayPal connection
3. Verify API credentials

### Missing Transactions

1. Expand date range
2. Run manual sync
3. Check transaction count

### Fee Mismatch

- Fees are as reported by PayPal API
- May include currency conversion costs
- Check PayPal dashboard for details

## API Details

### Endpoint

```
GET /api/paypal/transactions
```

### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `page` | number | Page number |
| `pageSize` | number | Items per page |
| `search` | string | Search text |
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
    "total": 200,
    "totalPages": 4
  },
  "summary": {
    "totalFees": 125.50,
    "transactionCount": 200
  }
}
```

## Related Documentation

- [Transactions Overview](./overview.md) - All platform transactions
- [Profit & Loss Report](../reports/profit-loss.md) - Fee expense tracking
