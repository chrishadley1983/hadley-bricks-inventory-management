# BrickLink Transactions

## Overview

The BrickLink tab displays orders from your BrickLink store. Track sales, shipping, and order status.

**Navigation**: Transactions → BrickLink tab

## Prerequisites

- BrickLink store account
- BrickLink API credentials (OAuth 1.0a)
- Integration configured in Settings

## Summary Metrics

| Metric | Description |
|--------|-------------|
| **Total Sales** | Order subtotals |
| **Total Shipping** | Shipping charges collected |
| **Total Tax** | Tax amounts |
| **Grand Total** | Sum of all orders |
| **Transaction Count** | Number of orders |

Metrics calculated for the selected date range.

## Transaction Fields

| Field | Description |
|-------|-------------|
| **Order Date** | When order was placed |
| **Order ID** | BrickLink order number |
| **Buyer** | Buyer name |
| **Status** | Order status |
| **Items** | Total items in order |
| **Lots** | Number of lots |
| **Subtotal** | Order value before shipping |
| **Shipping** | Shipping charge |
| **Tax** | Tax amount |
| **Grand Total** | Final order total |
| **Location** | Buyer country |

## Order Statuses

| Status | Description |
|--------|-------------|
| **Pending** | Awaiting payment |
| **Updated** | Order modified |
| **Processing** | Being prepared |
| **Ready** | Ready to ship |
| **Paid** | Payment received |
| **Packed** | Packaged for shipping |
| **Shipped** | Dispatched |
| **Received** | Delivered |
| **Completed** | Finalised |
| **Cancelled** | Order cancelled |

## Filtering

### Status Filter

Filter by order status:
- All statuses
- Pending
- Paid
- Shipped
- Completed
- etc.

### Date Range

Standard date range presets apply.

### Search

Search across:
- Order ID
- Buyer name
- Buyer email

## Sorting

Click column headers to sort by:
- **Order Date** (default, descending)
- **Buyer Name**
- **Status**
- **Grand Total**
- **Shipping**

## Order Details

Click an order to view:
- Full order information
- Buyer contact details
- Payment status and method
- Tracking number (if shipped)
- Order notes

## Sync

### Incremental Sync

1. Click **Sync** button
2. Fetches recent orders
3. Updates existing orders
4. Adds new orders

### Reset and Sync

1. Click **Reset & Sync** (if available)
2. Clears all BrickLink transactions
3. Re-syncs from scratch
4. Use if data appears corrupted

### What Gets Synced

- Order details
- Buyer information
- Payment status
- Shipping status
- Tracking numbers
- Order notes

## BrickLink-Specific Fields

### Additional Charges

| Field | Description |
|-------|-------------|
| **Add Charge 1** | First additional charge |
| **Add Charge 2** | Second additional charge |
| **Insurance** | Insurance charge |
| **Credit** | Store credit applied |
| **Coupon Credit** | Coupon discount |

### Payment Information

| Field | Description |
|-------|-------------|
| **Payment Status** | Payment state |
| **Payment Method** | How buyer paid |
| **Payment Date** | When paid |

## Use Cases

### Order Fulfilment

1. Filter by status = Paid
2. View orders needing dispatch
3. Click order for details
4. Update tracking after shipping

### Sales Analysis

1. Set date range (e.g., Last Month)
2. Review Grand Total summary
3. Check average order value
4. Compare with other platforms

### Buyer History

1. Search by buyer name
2. View all orders from buyer
3. Check order history
4. Review payment reliability

## Integration

BrickLink orders integrate with:
- **Platform Performance Report** - Sales comparison
- **Orders Page** - Unified order view
- **Inventory** - Stock level updates

## Troubleshooting

### "Not Connected"

1. Go to Settings → Integrations
2. Check BrickLink API credentials
3. Verify OAuth 1.0a tokens

### Orders Not Syncing

1. Check date range filter
2. Run manual sync
3. Try Reset & Sync if needed
4. Verify API access in BrickLink

### Missing Order Details

- Some fields may be empty if not set in BrickLink
- Tracking number only appears after shipping
- Notes sync from BrickLink order notes

## API Details

### Endpoint

```
GET /api/bricklink/transactions
```

### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `page` | number | Page number |
| `pageSize` | number | Items per page |
| `search` | string | Search text |
| `status` | string | Filter by status |
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
    "total": 150,
    "totalPages": 3
  },
  "summary": {
    "totalSales": 2500.00,
    "totalShipping": 350.00,
    "totalTax": 0,
    "totalGrandTotal": 2850.00,
    "transactionCount": 150
  }
}
```

## Related Documentation

- [Transactions Overview](./overview.md) - All platform transactions
- [Platform Performance Report](../reports/platform-performance.md) - Cross-platform analysis
- [Orders](../orders/overview.md) - Order management
