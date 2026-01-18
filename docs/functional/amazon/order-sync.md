# Amazon Order Sync

## Overview

The Amazon order sync imports orders from Amazon SP-API into the local database. It supports both full and incremental sync, automatically tracking the last sync timestamp to only fetch new/updated orders.

## How Order Sync Works

### Incremental Sync (Default)

1. System checks `synced_at` timestamp of most recent order
2. Queries Amazon for orders updated since that time (minus 1 minute buffer)
3. Uses `LastUpdatedAfter` parameter to catch status changes on older orders
4. Upserts orders to `platform_orders` table

### Full Sync

1. Fetches all orders from the last 90 days
2. Uses `LastUpdatedAfter` with 90-day lookback
3. Updates all existing orders and creates new ones

### First Sync

When no orders exist in database:
1. Defaults to 90-day historical import
2. Uses `CreatedAfter` parameter

## Triggering Order Sync

Order sync typically runs:
- Automatically as part of scheduled sync
- When viewing the Orders page (background refresh)
- Manually from sync controls

## Data Captured

For each Amazon order, the system stores:

### Order Details
| Field | Description |
|-------|-------------|
| `platform_order_id` | Amazon Order ID |
| `order_date` | Purchase date |
| `buyer_name` | Buyer's name |
| `buyer_email` | Buyer's email (if available) |
| `status` | Amazon order status |
| `internal_status` | Mapped internal status |

### Financial Details
| Field | Description |
|-------|-------------|
| `subtotal` | Item total |
| `shipping` | Shipping amount |
| `fees` | Amazon fees |
| `total` | Total order value |
| `currency` | Currency code (GBP, EUR, etc.) |

### Shipping Address
Stored as JSON:
- Street address lines
- City
- State/Region
- Postal code
- Country

### Order Items
When `includeItems: true`:
- ASIN
- Title
- Quantity
- Unit price
- Total price

## Status Mapping

Amazon statuses are mapped to internal statuses:

| Amazon Status | Internal Status |
|---------------|-----------------|
| Pending | Pending |
| Unshipped | Paid |
| Shipped | Shipped |
| PartiallyShipped | Shipped |
| Canceled | Cancelled |
| Unfulfillable | Cancelled |

## Marketplace Support

Default EU marketplaces synced:

| Country | Marketplace ID |
|---------|----------------|
| UK | A1F83G8C2ARO7P |
| Germany | A1PA6795UKMFR9 |
| France | A13V1IB3VIYBER |
| Italy | APJ6JRA9NG5V4 |
| Spain | A1RKKUPIHCS9HS |

Orders from all configured marketplaces are synced together.

## Sync Options

The `AmazonSyncService.syncOrders()` method accepts options:

| Option | Type | Description |
|--------|------|-------------|
| `createdAfter` | Date | Sync orders created after this date |
| `updatedAfter` | Date | Sync orders updated after this date |
| `statuses` | string[] | Filter by specific order statuses |
| `merchantFulfilledOnly` | boolean | Exclude FBA orders |
| `includeItems` | boolean | Fetch line items (slower) |
| `limit` | number | Maximum orders to fetch |
| `fullSync` | boolean | Force 90-day full sync |

## Error Handling

| Error | Handling |
|-------|----------|
| Rate limit exceeded | Returns reset time, retry later |
| Authentication error | Prompts to reconnect credentials |
| API error | Logged with error code |
| Individual order error | Continues with other orders |

## Sync Results

The sync returns a `SyncResult` object:

```typescript
{
  success: boolean;
  platform: 'amazon';
  ordersProcessed: number;
  ordersCreated: number;
  ordersUpdated: number;
  errors: string[];
  lastSyncedAt: Date;
}
```

## Viewing Synced Orders

**Navigation**: Dashboard sidebar → Orders

Orders page shows:
- Combined view of orders from all platforms
- Filter by platform (Amazon, eBay, etc.)
- Search by order ID, buyer name
- Click row to view order details

### Order Detail Page

Shows:
- Order header with status badge
- Buyer information
- Shipping address
- Line items with ASIN links
- Financial breakdown
- Raw data (for debugging)

## Related Files

| File | Purpose |
|------|---------|
| `apps/web/src/lib/services/amazon-sync.service.ts` | Main order sync service |
| `apps/web/src/lib/amazon/client.ts` | Amazon Orders API client |
| `apps/web/src/lib/amazon/adapter.ts` | Platform adapter interface |
| `apps/web/src/lib/repositories/order.repository.ts` | Order database operations |
| `apps/web/src/app/(dashboard)/orders/page.tsx` | Orders list page |

## Troubleshooting

### Orders not appearing
1. Check Amazon credentials in Settings → Integrations
2. Verify marketplace IDs are configured
3. Try triggering a full sync

### Status not updating
- Incremental sync uses `LastUpdatedAfter`
- Amazon must mark order as modified
- Force full sync to update all orders

### Missing order items
- Enable `includeItems: true` in sync options
- This makes additional API calls per order (slower)

### Duplicate orders
- System uses upsert on `platform_order_id`
- Duplicates should be automatically merged

### Rate limiting
- Amazon limits API calls per second
- System implements exponential backoff
- Large syncs may take several minutes
