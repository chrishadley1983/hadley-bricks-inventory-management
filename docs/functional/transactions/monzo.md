# Monzo Transactions

## Overview

The Monzo tab displays banking transactions from your connected Monzo account. Track business income and expenses, categorise transactions, and add notes for bookkeeping.

**Navigation**: Transactions → Monzo tab

## Prerequisites

- Monzo bank account
- Monzo integration configured in Settings
- API access enabled

## Summary Metrics

| Metric | Description |
|--------|-------------|
| **Total Income** | Sum of positive transactions (credit) |
| **Total Expenses** | Sum of negative transactions (debit) |

Metrics are calculated for the selected date range.

## Transaction Fields

| Field | Description |
|-------|-------------|
| **Date** | Transaction timestamp |
| **Merchant** | Merchant name (if available) |
| **Description** | Transaction description |
| **Amount** | Transaction value (positive = income, negative = expense) |
| **Category** | Monzo's automatic category |
| **Local Category** | Your custom category assignment |
| **Notes** | Your notes for the transaction |

## Filtering

### Date Range

Select from presets:
- All Time (default)
- This Month
- Last Month
- Last Quarter
- Last Year

### Local Category

Filter by your custom categories:
- Income
- Stock Purchase
- Packing & Postage
- Selling Fees
- Bills
- Uncategorised

### Search

Search across:
- Description
- Merchant name
- Notes

## Sorting

Click column headers to sort by:
- **Date** (default, descending)
- **Merchant**
- **Description**
- **Amount**
- **Local Category**
- **Notes**

## Editing Transactions

### Edit Notes

1. Click the **Edit** (pencil) icon on a transaction
2. Side panel opens with transaction details
3. Enter notes in the **Notes** field
4. Click **Save**

### Set Local Category

1. Click the **Edit** icon on a transaction
2. Select a category from the **Local Category** dropdown
3. Click **Save**

Categories help with:
- Expense tracking
- Tax categorisation
- Profit & Loss reporting

## Sync

### Manual Sync

1. Click the **Sync** button in the header
2. Sync fetches recent transactions
3. Shows count of transactions processed
4. New transactions appear in the list

### Automatic Sync

- Monzo can be configured for auto-sync
- Checks for new transactions periodically
- Status indicator shows if sync is running

### Sync Status

| Status | Meaning |
|--------|---------|
| 🟢 Connected | Monzo account linked |
| ⏳ Syncing | Sync in progress |
| ✓ Complete | Sync finished |
| ❌ Error | Sync failed (check message) |

## Local Category Labels

| Category | Description | Use For |
|----------|-------------|---------|
| **Income** | Business revenue | Platform payouts, sales |
| **Stock Purchase** | Inventory acquisition | LEGO purchases |
| **Packing & Postage** | Shipping costs | Postage, packaging materials |
| **Selling Fees** | Platform fees | eBay fees, PayPal fees |
| **Bills** | Operating expenses | Storage, subscriptions |
| **Uncategorised** | Not yet assigned | Review and categorise |

## Amount Display

- Amounts stored in pence (smallest currency unit)
- Displayed in pounds (divided by 100)
- Positive amounts = money in (green)
- Negative amounts = money out (red)

## Integration with Reports

Monzo transactions feed into:
- **Profit & Loss Report** - Via local category
- **Purchase Analysis** - Stock purchase tracking
- **Monthly reconciliation** - Bank statement matching

## Troubleshooting

### "Not Connected"

1. Go to Settings → Integrations
2. Check Monzo connection status
3. Re-authenticate if needed

### Transactions Not Appearing

1. Check date range filter
2. Try clicking Sync button
3. Verify Monzo account has transactions
4. Check for API errors in sync status

### Category Not Saving

1. Ensure you click Save after editing
2. Check for success/error message
3. Refresh page and verify change

## API Details

### Endpoint

```
GET /api/transactions
```

### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `page` | number | Page number (1-indexed) |
| `pageSize` | number | Items per page |
| `search` | string | Search text |
| `localCategory` | string | Filter by category |
| `startDate` | ISO date | Start of date range |
| `endDate` | ISO date | End of date range |
| `sortField` | string | Field to sort by |
| `sortDirection` | string | 'asc' or 'desc' |

### Response

```json
{
  "data": {
    "transactions": [...],
    "pagination": {
      "page": 1,
      "pageSize": 50,
      "total": 1234,
      "totalPages": 25
    },
    "summary": {
      "totalIncome": 150000,
      "totalExpenses": 75000
    },
    "categories": ["Income", "Stock Purchase", ...]
  }
}
```

## Related Documentation

- [Transactions Overview](./overview.md) - All platform transactions
- [Profit & Loss Report](../reports/profit-loss.md) - Financial reporting
- [Purchases](../purchases/overview.md) - Stock purchase tracking
