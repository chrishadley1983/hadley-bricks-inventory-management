# Amazon Integration

## Overview

The Amazon integration enables pushing price and quantity updates to Amazon Seller Central, syncing orders from Amazon, and importing financial transaction data for reconciliation. This is one of the most complex integrations in the system, using Amazon's SP-API (Selling Partner API).

## Key Capabilities

| Capability | Description |
|------------|-------------|
| **Sync Queue** | Queue inventory items for price/quantity sync to Amazon |
| **Feed Submission** | Submit feeds to Amazon using JSON_LISTINGS_FEED format |
| **Two-Phase Sync** | Update price first, verify it's live, then update quantity |
| **Order Sync** | Import orders from Amazon SP-API with incremental sync |
| **Transaction Sync** | Import financial transactions for fee reconciliation |
| **Price Conflict Detection** | Detect when local prices differ from live Amazon prices |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              User Interface                              │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐   │
│  │ Amazon Sync Page │  │  Orders Page     │  │  Transactions Page   │   │
│  └────────┬─────────┘  └────────┬─────────┘  └──────────┬───────────┘   │
└───────────┼─────────────────────┼───────────────────────┼───────────────┘
            │                     │                       │
┌───────────▼─────────────────────▼───────────────────────▼───────────────┐
│                              React Hooks                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐   │
│  │ use-amazon-sync  │  │   use-orders     │  │ use-amazon-tx-sync   │   │
│  └────────┬─────────┘  └────────┬─────────┘  └──────────┬───────────┘   │
└───────────┼─────────────────────┼───────────────────────┼───────────────┘
            │                     │                       │
┌───────────▼─────────────────────▼───────────────────────▼───────────────┐
│                              API Routes                                  │
│  /api/amazon/sync/*       /api/orders/*              /api/amazon/tx/*   │
└───────────┼─────────────────────┼───────────────────────┼───────────────┘
            │                     │                       │
┌───────────▼─────────────────────▼───────────────────────▼───────────────┐
│                              Services                                    │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐   │
│  │AmazonSyncService │  │AmazonSyncService │  │AmazonTxSyncService   │   │
│  │(amazon/)         │  │(services/)       │  │                      │   │
│  └────────┬─────────┘  └────────┬─────────┘  └──────────┬───────────┘   │
└───────────┼─────────────────────┼───────────────────────┼───────────────┘
            │                     │                       │
┌───────────▼─────────────────────▼───────────────────────▼───────────────┐
│                           Amazon SP-API Clients                          │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐   │
│  │ AmazonFeedsClient│  │ AmazonClient     │  │AmazonFinancesClient  │   │
│  │ AmazonListings   │  │                  │  │                      │   │
│  └──────────────────┘  └──────────────────┘  └──────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

## User Journeys

| Journey | Description | Documentation |
|---------|-------------|---------------|
| [Sync Queue Management](./sync-queue.md) | Add items to queue, review, submit to Amazon | Detailed |
| [Order Sync](./order-sync.md) | Sync orders from Amazon, incremental updates | Detailed |
| [Transaction Sync](./transaction-sync.md) | Import financial data for reconciliation | Detailed |

## Key Files

### Pages
| File | Purpose |
|------|---------|
| `apps/web/src/app/(dashboard)/amazon-sync/page.tsx` | Main sync queue and history page |

### Components
| File | Purpose |
|------|---------|
| `SyncQueueTable.tsx` | Display queued items with price/quantity comparison |
| `SyncQueueSummary.tsx` | Summary statistics for queue |
| `SyncSubmitControls.tsx` | Dry run, two-phase sync, submit controls |
| `SyncFeedHistoryTable.tsx` | History of submitted feeds |
| `SyncFeedStatus.tsx` | Real-time feed processing status |
| `AddToSyncButton.tsx` | Button to add inventory items to queue |
| `PriceConflictDialog.tsx` | Handle price mismatch alerts |

### Services
| File | Purpose |
|------|---------|
| `lib/amazon/amazon-sync.service.ts` | Queue management, feed submission, polling |
| `lib/services/amazon-sync.service.ts` | Order sync from SP-API |
| `lib/amazon/amazon-transaction-sync.service.ts` | Transaction/fee sync |

### API Clients
| File | Purpose |
|------|---------|
| `lib/amazon/amazon-feeds.client.ts` | Feed submission via Feeds API |
| `lib/amazon/amazon-listings.client.ts` | Listings API for price/quantity |
| `lib/amazon/amazon-catalog.client.ts` | Catalog API for product types |
| `lib/amazon/amazon-finances.client.ts` | Finances API for transactions |
| `lib/amazon/client.ts` | Core Orders API client |

### Hooks
| File | Purpose |
|------|---------|
| `hooks/use-amazon-sync.ts` | Queue, feed, and two-phase sync hooks |
| `hooks/use-amazon-transaction-sync.ts` | Transaction sync hooks |

## Database Tables

| Table | Purpose |
|-------|---------|
| `amazon_sync_queue` | Items waiting to be synced |
| `amazon_sync_feeds` | Submitted feed records |
| `amazon_sync_feed_items` | Individual items within a feed |
| `amazon_transactions` | Financial transactions |
| `amazon_sync_config` | Sync cursors and configuration |
| `amazon_sync_log` | Sync operation history |
| `amazon_product_cache` | Cached product type info |
| `platform_orders` | Orders from Amazon (shared table) |

## Configuration

### Required Credentials
Stored encrypted in `platform_credentials` table:

| Field | Description |
|-------|-------------|
| `sellerId` | Amazon Seller ID |
| `clientId` | SP-API Application Client ID |
| `clientSecret` | SP-API Application Client Secret |
| `refreshToken` | OAuth 2.0 Refresh Token |
| `marketplaceIds` | Array of marketplace IDs (defaults to EU) |

### Default Marketplaces (EU)
| Marketplace | ID |
|-------------|-----|
| UK | A1F83G8C2ARO7P |
| Germany | A1PA6795UKMFR9 |
| France | A13V1IB3VIYBER |
| Italy | APJ6JRA9NG5V4 |
| Spain | A1RKKUPIHCS9HS |

## Feed Submission Flow

```
1. User adds inventory items to queue
       │
       ▼
2. System validates:
   - Item has ASIN
   - Item has listing price
   - Status is BACKLOG
   - No price conflicts
       │
       ▼
3. System queries live Amazon price (Listings API)
       │
       ▼
4. If price differs → Show conflict dialog
       │
       ▼
5. User chooses: Dry Run or Submit
       │
       ├── Dry Run → Validate payload only
       │
       └── Submit → Send to Feeds API
              │
              ▼
       6. Poll for processing result
              │
              ▼
       7. Parse result, update statuses
```

## Two-Phase Sync

The two-phase sync feature prevents selling at outdated prices when updating both price and quantity:

1. **Price Feed Submission**: Submit price update only
2. **Price Verification**: Poll until Amazon confirms price is live (up to 30 min)
3. **Quantity Submission**: Only after price is verified, submit quantity
4. **Completion**: Notify user via email/push notification

This is critical when raising prices - you don't want to add inventory at the old (lower) price.

## Error Handling

| Error Type | Handling |
|------------|----------|
| Rate Limit | Exponential backoff with retry |
| Auth Error | Redirect to reconnect credentials |
| Validation | Show specific field errors |
| Feed Error | Parse result, show per-item errors |
| Network | Retry with timeout |

## Related Documentation

- [eBay Integration](../ebay/overview.md) - Similar platform sync patterns
- [Orders](../orders/overview.md) - Order management across platforms
- [Inventory](../inventory/overview.md) - Source of items to sync
