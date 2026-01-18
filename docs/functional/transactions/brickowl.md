# Brick Owl Transactions

## Overview

The Brick Owl tab displays orders from your Brick Owl store. Track sales, shipping, and order status.

**Navigation**: Transactions → Brick Owl tab

## Prerequisites

- Brick Owl store account
- Brick Owl API key configured
- Integration enabled in Settings

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
| **Order ID** | Brick Owl order number |
| **Buyer** | Buyer name |
| **Username** | Buyer's Brick Owl username |
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
| **Payment Received** | Paid, ready to process |
| **Processing** | Being prepared |
| **Shipped** | Dispatched |
| **Received** | Delivered/completed |
| **Cancelled** | Order cancelled |

## Filtering

### Status Filter

Filter by order status:
- All statuses
- Pending
- Payment Received
- Shipped
- Received
- Cancelled

### Date Range

Standard date range presets apply.

### Search

Search across:
- Order ID
- Buyer name
- Buyer username
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
- Complete order information
- Buyer contact details
- Payment information
- Shipping method
- Tracking number
- Notes (buyer, seller, public)

## Sync

### Sync Behaviour

- Brick Owl always does a full sync
- Fetches all orders from the API
- Updates existing order data
- Adds any new orders

### Manual Sync

1. Click **Sync** button
2. Full sync runs
3. Shows orders processed count
4. Updates transaction list

## Brick Owl-Specific Fields

### Discounts

| Field | Description |
|-------|-------------|
| **Coupon Discount** | Coupon code discount |
| **Combined Shipping Discount** | Multi-order discount |

### Notes

| Field | Description |
|-------|-------------|
| **Buyer Note** | Note from buyer |
| **Seller Note** | Your private note |
| **Public Note** | Visible to both parties |

### Shipping

| Field | Description |
|-------|-------------|
| **Shipping Method** | Selected shipping option |
| **Tracking Number** | Shipment tracking |

## Use Cases

### Order Processing

1. Filter by status = Payment Received
2. View orders ready to ship
3. Process and pack orders
4. Update with tracking numbers

### Sales Reporting

1. Set appropriate date range
2. Review summary totals
3. Compare with BrickLink
4. Export for accounting

### Customer Service

1. Search by order ID or buyer
2. View order history
3. Check notes and communication
4. Verify shipping status

## Integration

Brick Owl orders integrate with:
- **Platform Performance Report** - Cross-platform comparison
- **Orders Page** - Unified order management
- **Profit & Loss Report** - Revenue tracking

## Troubleshooting

### "Not Connected"

1. Go to Settings → Integrations
2. Check Brick Owl API key
3. Verify key has correct permissions

### Sync Issues

1. Brick Owl API may have rate limits
2. Wait a few minutes and retry
3. Check Brick Owl status page

### Missing Orders

1. Verify orders exist in Brick Owl
2. Check date range filter
3. Run manual sync
4. Contact support if persists

## API Details

### Endpoint

```
GET /api/brickowl/transactions
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
    "total": 75,
    "totalPages": 2
  },
  "summary": {
    "totalSales": 1200.00,
    "totalShipping": 180.00,
    "totalTax": 0,
    "totalGrandTotal": 1380.00,
    "transactionCount": 75
  }
}
```

## Related Documentation

- [Transactions Overview](./overview.md) - All platform transactions
- [Platform Performance Report](../reports/platform-performance.md) - Cross-platform analysis
- [Orders](../orders/overview.md) - Order management
