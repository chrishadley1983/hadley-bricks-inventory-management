# Purchases Feature Overview

> **Feature Area:** Purchases
> **Status:** Core Feature
> **Complexity:** Medium

## Purpose

The Purchases feature tracks all buying activities for the LEGO resale business. It records purchase details, calculates associated travel costs, and links items to inventory for profitability tracking.

## Key Capabilities

| Capability | Description |
|------------|-------------|
| **Purchase Recording** | Track individual purchases with cost, source, payment method |
| **AI-Powered Input** | Natural language parsing for quick purchase entry |
| **Mileage Tracking** | Calculate travel costs for collections with automatic distance calculation |
| **Expense Tracking** | Record parking, tolls, and other associated expenses |
| **Inventory Linking** | Connect purchases to inventory items for profit calculation |
| **Image Attachments** | Store receipts and purchase documentation |
| **Bulk Operations** | Edit or delete multiple purchases at once |

## Data Model

### Purchase Record

```typescript
interface Purchase {
  id: string;
  user_id: string;
  short_description: string;
  cost: number;
  source: string | null;
  payment_method: string | null;
  purchase_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;

  // Mileage tracking
  mileage_entries: MileageEntry[];

  // Expense tracking
  expenses: Expense[];

  // Images
  image_count: number;

  // Linked inventory items
  inventory_items: InventoryItem[];
}
```

### Mileage Entry

```typescript
interface MileageEntry {
  id: string;
  purchase_id: string;
  distance_miles: number;
  rate_per_mile: number;  // Default: 0.45
  reason: 'Collection' | 'Delivery' | 'Viewing' | 'Car Boot' | 'Auction' | 'Other';
  destination_postcode: string | null;
  notes: string | null;
}
```

### Expense

```typescript
interface Expense {
  id: string;
  purchase_id: string;
  type: 'mileage' | 'parking' | 'toll' | 'other';
  amount: number;
  description: string | null;
}
```

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   React App     │────▶│   API Routes    │────▶│  PurchaseService│
│   (TanStack Q)  │     │   /api/purchases│     └─────────────────┘
└─────────────────┘     └─────────────────┘              │
                                                         ▼
                                               ┌─────────────────┐
                                               │PurchaseRepository│
                                               └─────────────────┘
                                                         │
                                                         ▼
                                               ┌─────────────────┐
                                               │    Supabase     │
                                               │   (purchases)   │
                                               └─────────────────┘
```

### Service Layer

The `PurchaseService` provides:
- CRUD operations for purchases
- Summary statistics (monthly totals, by source)
- Bulk update/delete operations
- Profitability calculations

### Repository Layer

The `PurchaseRepository` handles:
- Database queries with filters
- Pagination (50 items per page)
- Related data fetching (mileage, expenses, images)
- Search across description and notes

## User Journeys

| Journey | Description |
|---------|-------------|
| [Viewing Purchases](./viewing-purchases.md) | Browse, search, and filter purchase history |
| [Adding Purchases](./adding-purchases.md) | Multiple methods: Form, Natural Language, AI Quick Add |
| [Mileage Tracking](./mileage-tracking.md) | Track travel costs with automatic distance calculation |

## Business Rules

### Cost Calculations

| Calculation | Formula |
|-------------|---------|
| **Mileage Cost** | `distance_miles × rate_per_mile` (default 45p/mile) |
| **Total Expenses** | Sum of all expenses (mileage + parking + tolls + other) |
| **True Purchase Cost** | `purchase_cost + total_expenses` |

### Default Values

| Field | Default |
|-------|---------|
| Mileage Rate | £0.45 per mile |
| Purchase Date | Current date |
| Payment Method | None (optional) |

### Validation Rules

| Field | Rule |
|-------|------|
| short_description | Required, non-empty |
| cost | Required, must be ≥ 0 |
| purchase_date | Optional, valid date format |
| distance_miles | Must be > 0 if provided |

## Integration Points

### Inventory Integration

- Purchases can be linked to inventory items
- Purchase cost flows to inventory item `cost` field
- Multiple inventory items can reference the same purchase
- AI parsing can detect set numbers and auto-create inventory items

### AI Integration

| Feature | AI Service |
|---------|------------|
| Natural Language Parsing | Claude API - extracts structured data from text |
| Distance Calculation | Claude API - calculates miles between postcodes |

### Profitability Tracking

When inventory items linked to a purchase are sold:
- Sale price captured from order
- Profit calculated: `sale_price - purchase_cost - expenses - fees`
- Purchase profitability report shows ROI

## Source Files

| File | Purpose |
|------|---------|
| [purchases/page.tsx](apps/web/src/app/(dashboard)/purchases/page.tsx) | Main purchases page |
| [purchases/new/page.tsx](apps/web/src/app/(dashboard)/purchases/new/page.tsx) | Add purchase form |
| [purchase.service.ts](apps/web/src/lib/services/purchase.service.ts) | Business logic |
| [purchase.repository.ts](apps/web/src/lib/repositories/purchase.repository.ts) | Data access |
| [use-purchases.ts](apps/web/src/hooks/use-purchases.ts) | React Query hooks |
| [QuickAddPurchase.tsx](apps/web/src/components/features/purchases/QuickAddPurchase.tsx) | AI quick add |
| [MileageSection.tsx](apps/web/src/components/features/purchases/MileageSection.tsx) | Mileage tracking |
| [PurchaseTable.tsx](apps/web/src/components/features/purchases/PurchaseTable.tsx) | Purchase list table |

## Related Features

- **Inventory** - Items purchased are added to inventory
- **Orders** - When items sell, linked back to purchase for profit
- **Reports** - Purchase data feeds into financial reports
