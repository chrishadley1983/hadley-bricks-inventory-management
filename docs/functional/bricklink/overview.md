# Feature: BrickLink Integration

> **Category:** Platform Integration
> **Primary Entry Point:** `/bricklink-uploads`, Settings > Integrations
> **Complexity:** Medium

## Overview

The BrickLink Integration provides connectivity to the BrickLink marketplace using OAuth 1.0a authentication. It enables tracking inventory uploads to BrickLink/BrickOwl stores, syncing sales orders, and managing transaction data for financial reconciliation.

**Key Value Proposition:**
- Track parts/sets uploaded to BrickLink stores with cost and selling price
- Sync sales orders from BrickLink API for order management
- Import transaction history for financial reporting
- Price guide lookups for arbitrage and valuation
- Bricqer integration for automatic upload batch syncing

## Data Model

### Core Entities

```
┌────────────────────┐     ┌────────────────────────┐     ┌────────────────────────┐
│  bricklink_uploads │     │  bricklink_transactions│     │   platform_orders      │
├────────────────────┤     ├────────────────────────┤     ├────────────────────────┤
│ id (PK)            │     │ id (PK)                │     │ id (PK)                │
│ user_id            │     │ user_id                │     │ user_id                │
│ upload_date        │     │ bricklink_order_id     │     │ platform = 'bricklink' │
│ total_quantity     │     │ order_date             │     │ platform_order_id      │
│ selling_price      │     │ buyer_name             │     │ order_date             │
│ cost               │     │ order_total            │     │ buyer_name             │
│ source             │     │ shipping               │     │ status                 │
│ condition          │     │ base_grand_total       │     │ total                  │
│ lots               │     │ order_status           │     │ items_count            │
│ reference          │     │ payment_status         │     │ raw_data               │
│ notes              │     │ tracking_number        │     └────────────────────────┘
│ synced_from_bricqer│     │ raw_response           │
└────────────────────┘     └────────────────────────┘

┌────────────────────────┐     ┌────────────────────────┐
│  bricklink_sync_config │     │   bricklink_sync_log   │
├────────────────────────┤     ├────────────────────────┤
│ user_id (PK)           │     │ id (PK)                │
│ auto_sync_enabled      │     │ user_id                │
│ auto_sync_interval_hrs │     │ sync_mode              │
│ last_sync_date_cursor  │     │ status                 │
│ include_filed_orders   │     │ started_at             │
│ historical_import_at   │     │ completed_at           │
└────────────────────────┘     │ orders_processed       │
                               │ orders_created         │
                               │ orders_updated         │
                               │ error_message          │
                               └────────────────────────┘
```

---

## Authentication

### OAuth 1.0a

BrickLink uses OAuth 1.0a authentication, requiring four credential values:

| Credential | Description |
|------------|-------------|
| Consumer Key | Application identifier from BrickLink developer portal |
| Consumer Secret | Application secret key |
| Token Value | User access token |
| Token Secret | User token secret |

**Signature Generation:**
- HMAC-SHA1 signature algorithm
- RFC 3986 percent encoding
- Nonce: 16 random bytes as hex
- Timestamp: Unix epoch seconds

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          BRICKLINK INTEGRATION                               │
├─────────────────┬─────────────────┬─────────────────┬───────────────────────┤
│    Uploads      │   Order Sync    │  Transactions   │    Price Guide        │
│   Management    │                 │      Sync       │                       │
├─────────────────┴─────────────────┴─────────────────┴───────────────────────┤
│                                                                              │
│  ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐    │
│  │ BrickLinkUploadSvc │  │  BrickLinkSyncSvc  │  │ BrickLinkTxnSync   │    │
│  │ - create/update    │  │  - syncOrders      │  │ - syncTransactions │    │
│  │ - getSummary       │  │  - testConnection  │  │ - historicalImport │    │
│  │ - getDistinctSrcs  │  │  - saveCredentials │  │ - getConnStatus    │    │
│  └────────────────────┘  └────────────────────┘  └────────────────────┘    │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│                            BrickLinkClient                                   │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  - OAuth 1.0a signature generation                                    │   │
│  │  - getOrders() / getSalesOrders() / getPurchaseOrders()              │   │
│  │  - getOrderWithItems()                                                │   │
│  │  - getPriceGuide() / getSetPriceGuide()                              │   │
│  │  - getCatalogItem() / setExists()                                     │   │
│  │  - Rate limit: 5000 requests/day                                      │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│                            BrickLinkAdapter                                  │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  - normalizeOrder() - Transform to internal format                    │   │
│  │  - normalizeStatus() - Map BL status to app status                   │   │
│  │  - calculateOrderStats() - Revenue, items, status breakdown          │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Order Status Mapping

| BrickLink Status | App Status | Description |
|------------------|------------|-------------|
| `PENDING` | Pending | Order placed, awaiting action |
| `UPDATED` | Updated | Order modified |
| `PROCESSING` | Processing | Being processed |
| `READY` | Ready | Ready for shipment |
| `PAID` | Paid | Payment received |
| `PACKED` | Packed | Items packed |
| `SHIPPED` | Shipped | Dispatched to buyer |
| `RECEIVED` | Received | Buyer confirmed receipt |
| `COMPLETED` | Completed | Order finalized |
| `OCR` | Order Cancelled (Refund) | Cancelled with refund |
| `NPB` | Non-Paying Buyer | Buyer didn't pay |
| `NPX` | Non-Paying Buyer (Expired) | NPB expired |
| `NRS` | Non-Responding Seller | Seller not responding |
| `NSS` | Non-Shipping Seller | Seller didn't ship |
| `CANCELLED` | Cancelled | Order cancelled |

---

## Sync Modes

### Order Sync

| Mode | Description |
|------|-------------|
| Incremental | Fetch orders since last sync cursor |
| Full | Fetch all orders, including filed/archived |
| Single | Sync specific order by ID |

### Transaction Sync

| Mode | Description | Use Case |
|------|-------------|----------|
| `INCREMENTAL` | Orders since last cursor | Daily sync |
| `FULL` | All orders, reset cursor | Data refresh |
| `HISTORICAL` | Date range import | Initial setup |

---

## Rate Limiting

| Metric | Limit |
|--------|-------|
| Daily Requests | 5,000 |
| Request Timeout | 30 seconds |
| Batch Size | 100 records |

The client tracks rate limit info from response headers and throws `RateLimitError` when exceeded.

---

## User Journeys

| Journey | Description | Entry Point |
|---------|-------------|-------------|
| [BrickLink Uploads](./bricklink-uploads.md) | Track inventory upload batches | `/bricklink-uploads` |
| [BrickLink Authentication](./bricklink-authentication.md) | Connect BrickLink account | Settings > Integrations |
| [Order Sync](./order-sync.md) | Sync sales orders from BrickLink | Orders page |

---

## Key Features

### Upload Tracking
- Record inventory batches uploaded to BrickLink/BrickOwl stores
- Track quantity, selling price, cost, and source
- Calculate profit margin
- Bricqer integration for automatic sync

### Order Synchronization
- Fetch sales orders (direction=in) from BrickLink API
- Incremental sync with date cursor
- Full order details with items
- Status change detection for selective updates

### Transaction History
- Import complete order history
- Financial breakdown: subtotal, shipping, tax, grand total
- Sync log with audit trail
- Auto-sync capability

### Price Guide Integration
- Get current stock prices for sets/parts
- Filter by condition (New/Used), country, currency
- Support for sold history lookup
- Catalog item validation

---

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/integrations/bricklink/status` | GET | Get connection status |
| `/api/integrations/bricklink/connect` | POST | Save credentials and test |
| `/api/integrations/bricklink/disconnect` | POST | Remove credentials |
| `/api/integrations/bricklink/sync` | POST | Trigger order sync |
| `/api/integrations/bricklink/sync/historical` | POST | Historical import |
| `/api/bricklink-uploads` | GET | List upload batches |
| `/api/bricklink-uploads` | POST | Create upload |
| `/api/bricklink-uploads/[id]` | GET/PUT/DELETE | Single upload CRUD |
| `/api/bricklink-uploads/sync` | POST | Sync from Bricqer |

---

## Source Files

| File | Purpose |
|------|---------|
| [client.ts](../../../apps/web/src/lib/bricklink/client.ts) | OAuth 1.0a API client |
| [adapter.ts](../../../apps/web/src/lib/bricklink/adapter.ts) | Response normalization |
| [types.ts](../../../apps/web/src/lib/bricklink/types.ts) | Type definitions |
| [bricklink-sync.service.ts](../../../apps/web/src/lib/services/bricklink-sync.service.ts) | Order sync service |
| [bricklink-upload.service.ts](../../../apps/web/src/lib/services/bricklink-upload.service.ts) | Upload management |
| [bricklink-transaction-sync.service.ts](../../../apps/web/src/lib/bricklink/bricklink-transaction-sync.service.ts) | Transaction sync |
| [use-bricklink-uploads.ts](../../../apps/web/src/hooks/use-bricklink-uploads.ts) | Upload hooks |
| [use-bricklink-transaction-sync.ts](../../../apps/web/src/hooks/use-bricklink-transaction-sync.ts) | Transaction hooks |
| [page.tsx](../../../apps/web/src/app/(dashboard)/bricklink-uploads/page.tsx) | Uploads list page |

---

## Related Features

- [Orders](../orders/overview.md) - View synced BrickLink orders
- [Transactions](../transactions/bricklink.md) - BrickLink financial transactions
- [Arbitrage](../arbitrage/overview.md) - BrickLink price guide for arbitrage
