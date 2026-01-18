# Orders Feature Overview

> **Feature Area:** Orders
> **Status:** Core Feature
> **Complexity:** High

## Purpose

The Orders feature provides centralised order management across all connected sales platforms (eBay, Amazon, Bricqer/BrickLink/Brick Owl). It enables viewing, syncing, status management, and inventory linking for orders from multiple marketplaces in a unified interface.

## Key Capabilities

| Capability | Description |
|------------|-------------|
| **Multi-Platform Sync** | Automatic order synchronisation from eBay, Amazon, Bricqer, BrickLink, and Brick Owl |
| **Unified Order View** | View orders from all platforms in a single paginated table |
| **Status Management** | Workflow-based status progression: Pending → Paid → Packed → Shipped → Completed |
| **Inventory Linking** | Match order items to inventory using SKU/ASIN mapping |
| **Picking Lists** | Generate PDF picking lists for order fulfilment |
| **Order Confirmation** | Bulk confirm orders and link to inventory items (FIFO recommendations) |
| **Platform-Specific Views** | Dedicated pages for eBay and Amazon with platform-specific features |
| **Bulk Status Updates** | Update status for multiple orders at once |
| **Status History** | Track all status changes with timestamps and notes |

## Data Model

### Platform Order

```typescript
interface PlatformOrder {
  id: string;
  user_id: string;
  platform: 'ebay' | 'amazon' | 'bricklink' | 'brickowl' | 'bricqer';
  platform_order_id: string;
  order_date: string | null;
  buyer_name: string | null;
  buyer_email: string | null;
  total: number | null;
  subtotal: number | null;
  shipping: number | null;
  tax: number | null;
  fees: number | null;
  currency: string | null;
  status: string | null;           // Raw platform status
  internal_status: OrderStatus;    // Normalised status
  shipping_address: ShippingAddress | null;
  tracking_number: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  synced_at: string | null;

  // Timestamps
  packed_at: string | null;
  shipped_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;

  // Related data
  items: OrderItem[];
  items_count: number | null;
}

type OrderStatus =
  | 'Pending'
  | 'Paid'
  | 'Packed'
  | 'Shipped'
  | 'Completed'
  | 'Cancelled';
```

### Order Item

```typescript
interface OrderItem {
  id: string;
  order_id: string;
  item_number: string | null;  // SKU or ASIN
  item_name: string | null;
  quantity: number;
  unit_price: number | null;
  total_price: number | null;
  currency: string | null;
  condition: string | null;
  inventory_item_id: string | null;  // Link to inventory
}
```

### Status History

```typescript
interface StatusHistoryEntry {
  id: string;
  status: string;
  previous_status: string | null;
  changed_by: string | null;
  notes: string | null;
  created_at: string;
}
```

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   React App     │────▶│   API Routes    │────▶│  OrderSyncSvc   │
│   (TanStack Q)  │     │   /api/orders   │     └─────────────────┘
└─────────────────┘     └─────────────────┘              │
                                                         ▼
                                               ┌─────────────────┐
                                               │ OrderRepository │
                                               └─────────────────┘
                                                         │
                               ┌────────────────┬────────┴────────┬─────────────────┐
                               ▼                ▼                 ▼                 ▼
                        ┌───────────┐    ┌───────────┐    ┌───────────┐    ┌───────────┐
                        │   eBay    │    │  Amazon   │    │  Bricqer  │    │ BrickLink │
                        │   Sync    │    │   Sync    │    │   Sync    │    │ Brick Owl │
                        └───────────┘    └───────────┘    └───────────┘    └───────────┘
```

### Service Layer

The `OrderSyncService` coordinates synchronisation across all platforms:

```typescript
// apps/web/src/lib/services/order-sync.service.ts
class OrderSyncService {
  async syncAllPlatforms(userId: string): Promise<UnifiedSyncResult>;
  async syncFromPlatform(platform: Platform): Promise<PlatformSyncResult>;
  async getPlatformSyncStatus(userId: string, platform: Platform): Promise<PlatformSyncStatus>;
  async testPlatformConnection(platform: Platform): Promise<boolean>;
}
```

### Repository Layer

The `OrderRepository` handles data access with filtering and pagination:

```typescript
// apps/web/src/lib/repositories/order.repository.ts
class OrderRepository extends BaseRepository<PlatformOrder> {
  async findAll(userId: string, filters: OrderFilters): Promise<PaginatedResult>;
  async findById(id: string): Promise<PlatformOrder | null>;
  async upsertOrder(order: PlatformOrder): Promise<PlatformOrder>;
  async upsertOrderItems(items: OrderItem[]): Promise<void>;
  async getOrderStatusTimestamps(platform: string): Promise<StatusTimestamps>;
}
```

## User Journeys

| Journey | Description |
|---------|-------------|
| [Viewing Orders](./viewing-orders.md) | Browse, search, and filter orders from all platforms |
| [eBay Orders](./ebay-orders.md) | Manage eBay-specific orders with SKU matching |
| [Amazon Orders](./amazon-orders.md) | Manage Amazon orders with ASIN matching |
| [Order Confirmation](./order-confirmation.md) | Bulk confirm orders and link to inventory |

## Business Rules

### Status Normalisation

Raw platform statuses are normalised to a standard set:

| Normalised Status | Matching Patterns |
|-------------------|-------------------|
| **Completed** | `completed`, `received` |
| **Shipped** | `shipped`, `dispatched` |
| **Packed** | `packed`, `ready` |
| **Paid** | `paid`, `payment` |
| **Cancelled** | `cancel`, `npb` (non-paying buyer) |
| **Pending** | Default fallback |

### Status Workflow

Orders progress through a defined workflow:

```
Pending → Paid → Packed → Shipped → Completed
                    ↘
                      → Cancelled (from any state except Completed)
```

### Allowed Transitions

| Current Status | Allowed Transitions |
|----------------|---------------------|
| Pending | Paid, Cancelled |
| Paid | Packed, Shipped, Cancelled |
| Packed | Shipped, Cancelled |
| Shipped | Completed, Cancelled |
| Completed | (None - terminal state) |
| Cancelled | (None - terminal state) |

### Inventory Linking

When confirming orders, items are linked to inventory using:

1. **FIFO (First In, First Out)** - Oldest inventory items are recommended first
2. **SKU Matching** - For eBay, match by SKU field
3. **ASIN Matching** - For Amazon, match by ASIN via `amazon_asin_mappings` table
4. **Manual Override** - User can select from multiple candidates

### Archive Location Pattern

When Amazon orders are confirmed, inventory items are moved to archive locations:
- Format: `SOLD-YYYY-MM` (e.g., `SOLD-2026-01`)
- Month based on confirmation date

## Integration Points

### Platform Sync APIs

| Platform | Sync Method | Auth Type |
|----------|-------------|-----------|
| eBay | `/api/integrations/ebay/sync` | OAuth 2.0 |
| Amazon | `/api/integrations/amazon/sync` | SP-API OAuth |
| Bricqer | `/api/integrations/bricqer/sync` | API Key |
| BrickLink | Via Bricqer | - |
| Brick Owl | Via Bricqer | - |

### Inventory Integration

- Order items link to `inventory_items` via `inventory_item_id`
- FIFO recommendations based on `created_at` timestamp
- Storage location displayed in confirmation dialog
- Items marked as Sold when orders are confirmed

### Picking List Generation

Generate PDF picking lists for unfulfilled orders:
- `/api/picking-list/ebay?format=pdf`
- `/api/picking-list/amazon?format=pdf`

## Source Files

| File | Purpose |
|------|---------|
| [orders/page.tsx](apps/web/src/app/(dashboard)/orders/page.tsx) | Main orders page with multi-platform view |
| [orders/amazon/page.tsx](apps/web/src/app/(dashboard)/orders/amazon/page.tsx) | Amazon orders page |
| [orders/ebay/page.tsx](apps/web/src/app/(dashboard)/orders/ebay/page.tsx) | eBay orders page |
| [orders/[id]/page.tsx](apps/web/src/app/(dashboard)/orders/[id]/page.tsx) | Order detail page |
| [order.repository.ts](apps/web/src/lib/repositories/order.repository.ts) | Data access layer |
| [order-sync.service.ts](apps/web/src/lib/services/order-sync.service.ts) | Sync coordination |
| [ConfirmOrdersDialog.tsx](apps/web/src/components/features/orders/ConfirmOrdersDialog.tsx) | Order confirmation |
| [EbaySkuMatcherDialog.tsx](apps/web/src/components/features/orders/EbaySkuMatcherDialog.tsx) | eBay SKU linking |
| [AmazonAsinMatcherDialog.tsx](apps/web/src/components/features/orders/AmazonAsinMatcherDialog.tsx) | Amazon ASIN linking |
| [use-orders.ts](apps/web/src/hooks/use-orders.ts) | React Query hooks |

## Related Features

- **Inventory** - Orders link to inventory items for tracking
- **Reports** - Order data feeds into sales and profit reports
- **Transactions** - Completed orders create transaction records
- **Platform Stock** - eBay stock levels affected by orders
