# Inventory Management

> **Feature Area:** Core inventory tracking for LEGO resale business
> **Complexity:** High
> **Last Updated:** 2026-01-18

## Purpose

The Inventory Management feature is the central hub for tracking all LEGO inventory items throughout their lifecycle - from purchase to sale. It manages item details, costs, listing values, storage locations, and platform integrations.

## Capabilities

| Capability | Description |
|------------|-------------|
| **Item Tracking** | Track individual LEGO sets with set number, name, condition, cost, and listing value |
| **Status Management** | Items progress through statuses: Not Yet Received → Backlog → Listed → Sold |
| **Multi-Platform Support** | Items can be listed on eBay, Amazon, BrickLink, Brick Owl |
| **Bulk Operations** | Select multiple items for bulk edit or delete operations |
| **Advanced Filtering** | Filter by status, condition, platform, date ranges, numeric ranges |
| **Natural Language Search** | AI-powered filter interpretation for complex queries |
| **eBay Integration** | Create eBay listings directly from inventory items |
| **SKU Generation** | Automatic SKU generation in format `HB-{NEW/USED}-{SetNumber}-{Timestamp}` |
| **Purchase Linking** | Link inventory items to purchase records for cost tracking |
| **Google Sheets Sync** | Dual-write to Google Sheets for backup/migration |

## User Journeys

| Journey | Description | Link |
|---------|-------------|------|
| **Viewing Inventory** | Browse, search, and filter inventory items | [viewing-inventory.md](./viewing-inventory.md) |
| **Adding Inventory** | Multiple methods to add items to inventory | [adding-inventory.md](./adding-inventory.md) |
| **Bulk Operations** | Edit or delete multiple items at once | [bulk-operations.md](./bulk-operations.md) |
| **eBay Integration** | Create eBay listings from inventory | [ebay-integration.md](./ebay-integration.md) |

## Data Model

### Inventory Item

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Unique identifier |
| `set_number` | string | LEGO set number (e.g., "75192") |
| `item_name` | string | Set name (e.g., "Millennium Falcon") |
| `condition` | enum | "New" or "Used" |
| `status` | enum | "NOT YET RECEIVED", "BACKLOG", "LISTED", "SOLD" |
| `cost` | number | Purchase cost in GBP |
| `listing_value` | number | Current listing price in GBP |
| `purchase_date` | date | When item was purchased |
| `listing_date` | date | When item was listed for sale |
| `sold_date` | date | When item was sold |
| `sold_gross_amount` | number | Sale price before fees |
| `sold_net_amount` | number | Sale price after fees |
| `sold_fees_amount` | number | Platform fees paid |
| `sold_platform` | string | Platform where sold |
| `source` | string | Where purchased (e.g., "eBay", "Car Boot") |
| `sku` | string | Stock keeping unit |
| `storage_location` | string | Physical storage location |
| `listing_platform` | string | Platform where listed |
| `amazon_asin` | string | Amazon ASIN if applicable |
| `ebay_listing_id` | string | eBay listing ID if listed |
| `linked_lot` | string | Lot grouping reference |
| `purchase_id` | UUID | Link to purchase record |
| `notes` | string | Additional notes |

### Status Lifecycle

```
┌─────────────────┐
│ NOT YET RECEIVED│ (Item purchased but not delivered)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│     BACKLOG     │ (In stock, not listed)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│     LISTED      │ (Active listing on platform)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│      SOLD       │ (Sale completed)
└─────────────────┘
```

## Architecture

### Component Structure

```
apps/web/src/
├── app/(dashboard)/inventory/
│   ├── page.tsx              # Inventory list page
│   ├── [id]/page.tsx         # Item detail view
│   ├── [id]/edit/page.tsx    # Edit item
│   └── new/page.tsx          # Add inventory (tabbed interface)
├── components/features/inventory/
│   ├── InventoryTable.tsx    # Main data table
│   ├── InventoryColumns.tsx  # Column definitions
│   ├── InventoryFilters.tsx  # Basic filter controls
│   ├── AdvancedFilters.tsx   # Advanced filter panel
│   ├── NaturalLanguageFilter.tsx # AI-powered filter
│   ├── InventoryAddTabs.tsx  # Add item tab interface
│   ├── InventoryForm.tsx     # Single item form
│   ├── NaturalLanguageInput.tsx # AI-powered bulk input
│   ├── PhotoInput.tsx        # Photo-based input
│   ├── CsvImportWizard.tsx   # CSV import wizard
│   ├── BulkEntryGrid.tsx     # Spreadsheet-like entry
│   ├── BulkEditDialog.tsx    # Bulk edit modal
│   ├── CreateEbayListingModal.tsx # eBay listing creation
│   ├── PurchaseLookup.tsx    # Link to purchases
│   └── QuickPurchaseDialog.tsx # Quick purchase creation
├── lib/
│   ├── services/inventory.service.ts  # Business logic
│   └── repositories/inventory.repository.ts # Data access
└── hooks/
    ├── use-inventory.ts      # Query/mutation hooks
    ├── use-inventory-import.ts # Import utilities
    └── use-parse-inventory.ts # AI parsing
```

### Data Flow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   React UI      │────▶│   TanStack      │────▶│   API Routes    │
│   Components    │     │   Query/Hooks   │     │   /api/inventory│
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                       │
                                                       ▼
                                              ┌─────────────────┐
                                              │InventoryService │
                                              └─────────────────┘
                                                       │
                                              ┌────────┴────────┐
                                              ▼                 ▼
                                    ┌─────────────────┐ ┌─────────────────┐
                                    │   Supabase      │ │  Google Sheets  │
                                    │   (Primary)     │ │  (Dual-write)   │
                                    └─────────────────┘ └─────────────────┘
```

## Key Source Files

| File | Purpose |
|------|---------|
| [inventory/page.tsx](apps/web/src/app/(dashboard)/inventory/page.tsx) | Main inventory list page |
| [inventory/new/page.tsx](apps/web/src/app/(dashboard)/inventory/new/page.tsx) | Add inventory page |
| [InventoryAddTabs.tsx](apps/web/src/components/features/inventory/InventoryAddTabs.tsx) | Multi-method add interface |
| [NaturalLanguageInput.tsx](apps/web/src/components/features/inventory/NaturalLanguageInput.tsx) | AI-powered inventory parsing |
| [InventoryFilters.tsx](apps/web/src/components/features/inventory/InventoryFilters.tsx) | Filter controls |
| [BulkEditDialog.tsx](apps/web/src/components/features/inventory/BulkEditDialog.tsx) | Bulk edit functionality |
| [CreateEbayListingModal.tsx](apps/web/src/components/features/inventory/CreateEbayListingModal.tsx) | eBay listing creation |
| [inventory.service.ts](apps/web/src/lib/services/inventory.service.ts) | Business logic layer |
| [inventory.repository.ts](apps/web/src/lib/repositories/inventory.repository.ts) | Data access layer |
| [use-inventory.ts](apps/web/src/hooks/use-inventory.ts) | React Query hooks |

## Related Features

- **Purchases** - Source of cost data, linked via `purchase_id`
- **Orders** - Sales completed, updates `sold_*` fields
- **eBay Stock** - Platform-specific inventory view
- **Amazon Sync** - Two-phase sync for Amazon listings
- **Reports** - Inventory valuation, aging, profit analysis

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/inventory` | List items with filters and pagination |
| GET | `/api/inventory/[id]` | Get single item |
| POST | `/api/inventory` | Create item(s) - supports array |
| PUT | `/api/inventory/[id]` | Update single item |
| DELETE | `/api/inventory/[id]` | Delete single item |
| PUT | `/api/inventory/bulk` | Bulk update items |
| DELETE | `/api/inventory/bulk` | Bulk delete items |
| GET | `/api/inventory/summary` | Get inventory statistics |
| GET | `/api/inventory/platforms` | Get distinct platforms |
