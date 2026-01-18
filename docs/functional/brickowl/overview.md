# Feature: Brick Owl Integration

> **Category:** Platform Integration
> **Primary Entry Point:** Settings > Integrations
> **Complexity:** Low

## Overview

Brick Owl is a LEGO marketplace similar to BrickLink. The integration enables order synchronization and transaction tracking through the Brick Owl API. Unlike BrickLink's OAuth 1.0a, Brick Owl uses simple API key authentication.

**Key Value Proposition:**
- Sync sales orders from your Brick Owl store
- Track financial transactions with full breakdown
- Simple API key authentication (no OAuth complexity)
- Generous rate limits (10,000 requests/day)
- Transaction sync with historical import

## Data Model

### Core Entities

```
┌────────────────────────┐     ┌────────────────────────┐
│  brickowl_transactions │     │   brickowl_sync_log    │
├────────────────────────┤     ├────────────────────────┤
│ id (PK)                │     │ id (PK)                │
│ user_id                │     │ user_id                │
│ brickowl_order_id      │     │ sync_mode              │
│ order_date             │     │ status                 │
│ buyer_name             │     │ started_at             │
│ buyer_email            │     │ completed_at           │
│ order_total            │     │ orders_processed       │
│ shipping               │     │ orders_created         │
│ tax                    │     │ orders_updated         │
│ base_grand_total       │     │ error_message          │
│ order_status           │     └────────────────────────┘
│ payment_status         │
│ tracking_number        │     ┌────────────────────────┐
│ raw_response           │     │  brickowl_sync_config  │
└────────────────────────┘     ├────────────────────────┤
                               │ user_id (PK)           │
┌────────────────────────┐     │ auto_sync_enabled      │
│  platform_credentials  │     │ auto_sync_interval_hrs │
├────────────────────────┤     │ last_sync_date_cursor  │
│ user_id                │     │ historical_import_done │
│ platform: 'brickowl'   │     │ next_auto_sync_at      │
│ credentials_encrypted  │     └────────────────────────┘
└────────────────────────┘
```

### Credentials Structure

```typescript
interface BrickOwlCredentials {
  apiKey: string;  // Single API key (no OAuth)
}
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           BRICK OWL INTEGRATION                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐    │
│  │  BrickOwlClient    │  │ BrickOwlSyncService│  │ BrickOwlTxnSync    │    │
│  │  - API key auth    │  │ - syncOrders()     │  │ - syncTransactions │    │
│  │  - getOrders()     │  │ - testConnection() │  │ - historicalImport │    │
│  │  - getOrderItems() │  │ - saveCredentials()│  │ - getConnStatus()  │    │
│  └────────────────────┘  └────────────────────┘  └────────────────────┘    │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                             API LAYER                                        │
│  Base URL: https://api.brickowl.com/v1                                       │
│  Authentication: API key in query parameter (?key=xxx)                       │
│  Rate Limit: 10,000 requests/day                                             │
│  Timeout: 30 seconds                                                         │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                           DATA ADAPTER                                       │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │ normalizeOrder(order, items) → NormalizedBrickOwlOrder               │   │
│  │ - Maps Brick Owl statuses to normalized statuses                     │   │
│  │ - Parses currency strings to numbers                                  │   │
│  │ - Builds shipping address from fields                                 │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Order Statuses

| Brick Owl Status | Normalized Status | Description |
|------------------|-------------------|-------------|
| `Pending` | `Pending` | Order placed, awaiting action |
| `Payment Received` | `Paid` | Payment confirmed |
| `Payment Submitted` | `Payment Submitted` | Buyer submitted payment |
| `Processing` | `Processing` | Seller processing |
| `Processed` | `Processed` | Ready for shipment |
| `Shipped` | `Shipped` | Order dispatched |
| `Received` | `Received` | Buyer confirmed receipt |
| `Cancelled` | `Cancelled` | Order cancelled |
| `On Hold` | `On Hold` | Temporarily paused |

### Payment Statuses

| Status | Description |
|--------|-------------|
| `None` | No payment action |
| `Pending` | Awaiting payment |
| `Submitted` | Payment in progress |
| `Received` | Payment received |
| `Cleared` | Payment cleared |

---

## Item Conditions

| Code | Display | Description |
|------|---------|-------------|
| `new` | New | Brand new, sealed |
| `usedn` | Used - Near Mint | Used but excellent condition |
| `usedg` | Used - Good | Used with minor wear |
| `useda` | Used - Acceptable | Used with noticeable wear |

---

## Sync Modes

| Mode | Description | When Used |
|------|-------------|-----------|
| `INCREMENTAL` | Only new orders since last cursor | Default sync |
| `FULL` | All orders, no date filtering | Force refresh |
| `HISTORICAL` | Orders in specific date range | Backfill import |

---

## API Endpoints

### Brick Owl API (External)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/order/list` | GET | List orders with filtering |
| `/order/view` | GET | Get single order details |
| `/order/items` | GET | Get items for an order |

### Internal API

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/integrations/brickowl/status` | GET | Get connection status |
| `/api/integrations/brickowl/sync` | POST | Trigger sync |
| `/api/integrations/brickowl/sync/historical` | POST | Historical import |

---

## User Journeys

| Journey | Description | Entry Point |
|---------|-------------|-------------|
| [Authentication](./brickowl-authentication.md) | Connect Brick Owl account | Settings > Integrations |
| [Order Sync](./order-sync.md) | Sync orders and transactions | Automatic/Manual |

---

## Key Features

### Simple Authentication
- Single API key (no OAuth flow)
- Key passed as query parameter
- Test connection on save

### Transaction Tracking
- Full financial breakdown per order
- Subtotal, shipping, tax, discounts
- Batch upserts (100 records)
- Historical import support

### Sync Management
- Incremental sync with date cursor
- Auto-sync capability
- Sync log history
- Error tracking

---

## Comparison with BrickLink

| Aspect | Brick Owl | BrickLink |
|--------|-----------|-----------|
| Authentication | API key | OAuth 1.0a (4 credentials) |
| Rate Limit | 10,000/day | 5,000/day |
| API Format | JSON | JSON |
| Order Items | Separate endpoint | Separate endpoint |
| Status Updates | Polling | Polling |
| Complexity | Low | Medium |

---

## Error Handling

### Common Errors

| Error | Code | Resolution |
|-------|------|------------|
| Invalid API key | `INVALID_KEY` | Verify key in Brick Owl settings |
| Rate limit | `429` | Wait for reset (24 hours) |
| Network timeout | `TIMEOUT` | Retry later |
| Server error | `500` | Brick Owl API issue |

---

## Source Files

| File | Purpose |
|------|---------|
| [client.ts](../../../apps/web/src/lib/brickowl/client.ts) | API client with key auth |
| [adapter.ts](../../../apps/web/src/lib/brickowl/adapter.ts) | Response normalization |
| [types.ts](../../../apps/web/src/lib/brickowl/types.ts) | Type definitions |
| [brickowl-sync.service.ts](../../../apps/web/src/lib/services/brickowl-sync.service.ts) | Order sync service |
| [brickowl-transaction-sync.service.ts](../../../apps/web/src/lib/brickowl/brickowl-transaction-sync.service.ts) | Transaction sync |
| [use-brickowl-transaction-sync.ts](../../../apps/web/src/hooks/use-brickowl-transaction-sync.ts) | React hooks |

## Related Features

- [BrickLink Integration](../bricklink/overview.md) - Similar marketplace integration
- [Orders](../orders/overview.md) - Unified order management
- [Transactions](../transactions/overview.md) - Financial tracking
