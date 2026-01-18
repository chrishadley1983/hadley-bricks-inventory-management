# Resolving Inventory

> Manually link platform sales to inventory items when auto-linking fails.

## Overview

The Inventory Resolution page (`/settings/inventory-resolution`) helps you link eBay and Amazon sales to your inventory items when automatic linking fails.

## Why Resolution is Needed

Automatic inventory linking can fail for several reasons:

### eBay Reasons

| Reason | Description |
|--------|-------------|
| `no_sku` | eBay listing has no SKU |
| `no_matches` | No inventory items match SKU |
| `multiple_sku_matches` | Multiple inventory items have same SKU |
| `fuzzy_set_number` | Set number match needs confirmation |
| `fuzzy_title` | Title match needs confirmation |
| `multi_quantity` | Order contains multiple items |

### Amazon Reasons

| Reason | Description |
|--------|-------------|
| `no_asin` | Order has no ASIN |
| `no_matches` | No inventory items match ASIN |
| `insufficient_inventory` | Not enough items for quantity |
| `already_linked` | Inventory already sold |
| `multiple_asin_matches` | Multiple items match ASIN |
| `picklist_mismatch` | Pick list doesn't match |

## Page Layout

### Tab Selection

Switch between:
- **eBay**: eBay orders needing resolution
- **Amazon**: Amazon orders needing resolution

### Stats Cards

| Card | Description |
|------|-------------|
| **Pending Resolution** | Orders waiting for manual linking |
| **Resolved** | Orders successfully linked |

### Resolution Queue Table

| Column | Description |
|--------|-------------|
| **Order Date** | When the order was placed |
| **ASIN/SKU** | Product identifier |
| **Item** | Product title |
| **Qty** | Quantity ordered |
| **Amount** | Sale amount |
| **Reason** | Why auto-linking failed |
| **Action** | Resolve button |

## Resolution Process

### 1. Select Order
Click "Resolve" on any queued item to open the resolution dialog.

### 2. Review Order Details
- Order ID and date
- Item title and SKU/ASIN
- Quantity and sale amount

### 3. Choose Inventory Item

**Suggested Matches**:
- System shows potential matches with confidence scores
- Higher scores indicate better matches
- Click "Select" on the correct item

**Manual Search**:
- Search by SKU, ASIN, set number, or name
- Results show available inventory
- Toggle "Include already-sold items" for legacy data

### 4. Multi-Quantity Orders

For orders with quantity > 1:
- Progress bar shows selection count
- Select multiple inventory items
- Confirm when all items selected

### 5. Complete Resolution

**Select**: Links the inventory item(s) to the order
**Skip**: Marks item as skipped (review later)
**No Inventory**: Marks as no matching inventory exists

## Process Historical Orders

Button to reprocess all historical orders:

1. Click "Process [Platform] Historical Orders"
2. Optionally enable "Include already-sold items"
3. Watch progress bar
4. Review results summary

### Results Summary

| Metric | Description |
|--------|-------------|
| **Orders Processed** | Total orders reviewed |
| **Auto-Linked** | Successfully linked automatically |
| **Queued for Resolution** | Added to manual queue |
| **Complete Orders** | Fully resolved orders |

## Match Scoring

Suggested matches show confidence scores:

| Score | Badge | Meaning |
|-------|-------|---------|
| 75%+ | Green | High confidence match |
| 50-74% | Default | Medium confidence |
| <50% | Grey | Low confidence |

### Scoring Factors
- Exact SKU/ASIN match
- Set number match
- Title similarity
- Condition match
- Date proximity

## Source Files

- [page.tsx](../../../apps/web/src/app/(dashboard)/settings/inventory-resolution/page.tsx:380-1315)

## API Endpoints

### eBay Resolution
```
GET /api/ebay/resolution-queue
POST /api/ebay/resolution-queue/{id}/resolve
  Body: { inventoryItemIds: ["uuid1", "uuid2"] }
POST /api/ebay/resolution-queue/{id}/skip
  Body: { reason: "skipped" | "no_inventory" }
POST /api/ebay/inventory-linking/process-historical
  Body: { includeSold: boolean }
```

### Amazon Resolution
```
GET /api/amazon/resolution-queue
POST /api/amazon/resolution-queue/{id}/resolve
  Body: { inventoryItemIds: ["uuid1", "uuid2"] }
POST /api/amazon/resolution-queue/{id}/skip
  Body: { reason: "skipped" | "no_inventory" }
POST /api/amazon/inventory-linking/process-historical
  Body: { includeSold: boolean, mode: "auto" }
```

## Related Features

- [eBay Integration](../ebay/overview.md) - eBay order sync
- [Amazon Integration](../amazon/overview.md) - Amazon order sync
- [Orders](../orders/overview.md) - View all orders
- [Inventory](../inventory/overview.md) - Inventory management
