# User Journey: Viewing Inventory

> **Journey:** Browse, search, and filter inventory items
> **Entry Point:** `/inventory`
> **Complexity:** Medium

## Overview

The inventory list view is the primary interface for viewing and managing inventory items. It provides a paginated data table with comprehensive filtering, sorting, and search capabilities.

## User Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         /inventory                                  │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐  ┌──────────────────────────────────────────┐│
│  │   Sync Controls  │  │              Add Item Button             ││
│  └──────────────────┘  └──────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────────────┐
│  │ Search: [________________________] │ Status ▼ │ Condition ▼ │ Platform ▼ │ ✕ │
│  └──────────────────────────────────────────────────────────────────┘
│  ┌──────────────────────────────────────────────────────────────────┐
│  │ Natural Language Filter: [Ask in plain English...]              │
│  └──────────────────────────────────────────────────────────────────┘
│  ┌──────────────────────────────────────────────────────────────────┐
│  │ ▶ Advanced Filters (collapsed by default)                        │
│  └──────────────────────────────────────────────────────────────────┘
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────────────┐
│  │ ☐ │ Set # │ Name │ Condition │ Status │ Cost │ Value │ Platform ││
│  ├──────────────────────────────────────────────────────────────────┤
│  │ ☐ │ 75192 │ Millennium Falcon │ New │ LISTED │ £180 │ £550 │ eBay ││
│  │ ☐ │ 10294 │ Titanic │ Used │ BACKLOG │ £120 │ - │ - ││
│  │ ...                                                              │
│  └──────────────────────────────────────────────────────────────────┘
├─────────────────────────────────────────────────────────────────────┤
│  Showing 1-50 of 1,234 items          │ ◀ │ Page 1 of 25 │ ▶ │     │
└─────────────────────────────────────────────────────────────────────┘
```

## Steps

### 1. Access Inventory List

**Action:** Navigate to `/inventory` from the sidebar or dashboard

**What Happens:**
1. Page loads with skeleton loading state
2. `useInventoryList` hook fetches first page of inventory
3. `useInventorySummary` hook fetches statistics
4. Data table renders with default sort (newest first)

### 2. Search for Items

**Action:** Type in the search box

**Behaviour:**
- Search input is **debounced** (300ms delay) to prevent excessive API calls
- Searches across: `set_number`, `item_name`, `sku`
- Results update automatically after typing stops
- Clear search with the X button

**Example Searches:**
- `75192` - Find by set number
- `Millennium` - Find by name fragment
- `HB-NEW` - Find by SKU prefix

### 3. Filter by Status

**Action:** Select from Status dropdown

**Options:**
| Value | Label | Description |
|-------|-------|-------------|
| `all` | All Statuses | Show all items |
| `NOT YET RECEIVED` | Not Yet Received | Purchased, awaiting delivery |
| `BACKLOG` | Backlog | In stock, not listed |
| `LISTED` | Listed | Active on selling platform |
| `SOLD` | Sold | Sale completed |

### 4. Filter by Condition

**Action:** Select from Condition dropdown

**Options:**
| Value | Label |
|-------|-------|
| `all` | All Conditions |
| `New` | New |
| `Used` | Used |

### 5. Filter by Platform

**Action:** Select from Platform dropdown

**Options:**
- All Platforms
- eBay
- Amazon
- BrickLink
- Brick Owl
- Bricqer

### 6. Use Natural Language Filter

**Action:** Type a query in plain English in the Natural Language Filter input

**Examples:**
- "Items bought from eBay last month over £50"
- "New sealed sets in backlog"
- "Sold items with profit over £20"

**Behaviour:**
1. AI parses the natural language query
2. Converts to structured filter parameters
3. Applies filters automatically
4. Shows interpreted filters for transparency

### 7. Use Advanced Filters

**Action:** Expand the Advanced Filters section

**Available Filters:**

| Category | Filters |
|----------|---------|
| **Numeric Ranges** | Cost, Listing Value, Sold Gross, Sold Net, Profit, Fees, Postage |
| **Date Ranges** | Purchase Date, Listing Date, Sold Date |
| **Empty/Not Empty** | Storage Location, Amazon ASIN, Linked Lot, Linked Order, Notes, SKU, eBay Listing, Archive Location |

**Numeric Range Filter:**
- Enter min and/or max values
- Leave blank for no limit

**Date Range Filter:**
- Select from and/or to dates
- Leave blank for no limit

**Empty Filters:**
- `Empty` - Field has no value
- `Not Empty` - Field has a value

### 8. Clear Filters

**Action:** Click the X button next to the dropdowns

**Behaviour:**
- Resets all filters to defaults
- Clears search text
- Returns to full inventory view

### 9. Select Items

**Action:** Click checkbox in row or header

**Behaviour:**
- Individual row: Toggles selection for that item
- Header checkbox: Toggles all visible items on current page
- Selected items can be bulk edited or deleted

### 10. Navigate to Item Detail

**Action:** Click on an item row

**Behaviour:**
- Navigates to `/inventory/[id]`
- Shows full item details
- Edit and delete options available

### 11. Paginate Results

**Action:** Use pagination controls at bottom

**Behaviour:**
- 50 items per page (configurable)
- Previous/Next buttons
- Page number display
- Total count display

## Technical Details

### Query Keys

```typescript
inventoryKeys = {
  all: ['inventory'],
  lists: () => ['inventory', 'list'],
  list: (filters, pagination) => ['inventory', 'list', { filters, pagination }],
  details: () => ['inventory', 'detail'],
  detail: (id) => ['inventory', 'detail', id],
  summary: () => ['inventory', 'summary'],
  platforms: () => ['inventory', 'platforms'],
}
```

### Stale Times

| Query | Stale Time | Reason |
|-------|------------|--------|
| List | 5 minutes | Prevents unnecessary refetches |
| Detail | 10 minutes | Item details change less frequently |
| Summary | 5 minutes | Expensive to compute |
| Platforms | 5 minutes | Rarely changes |

### Filter Application

Filters are applied server-side in the repository layer:

```typescript
// Basic filters
query = query.eq('status', filters.status);
query = query.eq('condition', filters.condition);
query = query.eq('listing_platform', filters.platform);

// Search (OR across multiple fields)
query = query.or(
  `set_number.ilike.%${term}%,item_name.ilike.%${term}%,sku.ilike.%${term}%`
);

// Numeric ranges
query = query.gte('cost', filters.costRange.min);
query = query.lte('cost', filters.costRange.max);

// Date ranges
query = query.gte('purchase_date', filters.purchaseDateRange.from);
query = query.lte('purchase_date', filters.purchaseDateRange.to);

// Empty/not empty
query = query.is('storage_location', null); // empty
query = query.not('storage_location', 'is', null); // not empty
```

### Performance Considerations

1. **Debounced Search:** 300ms delay prevents API spam
2. **Pagination:** Server-side with 50 items per page
3. **Stale Time:** 5 minutes reduces refetches
4. **Selective Invalidation:** Only list queries invalidated on updates

## Source Files

| File | Line | Purpose |
|------|------|---------|
| [inventory/page.tsx](apps/web/src/app/(dashboard)/inventory/page.tsx) | - | Page component |
| [InventoryFilters.tsx](apps/web/src/components/features/inventory/InventoryFilters.tsx) | 39-156 | Filter controls |
| [AdvancedFilters.tsx](apps/web/src/components/features/inventory/AdvancedFilters.tsx) | - | Advanced filter panel |
| [NaturalLanguageFilter.tsx](apps/web/src/components/features/inventory/NaturalLanguageFilter.tsx) | - | AI-powered filter |
| [use-inventory.ts](apps/web/src/hooks/use-inventory.ts) | 37-43 | List query hook |
| [inventory.repository.ts](apps/web/src/lib/repositories/inventory.repository.ts) | 85-277 | Filter application |

## Related Journeys

- [Adding Inventory](./adding-inventory.md) - Add new items to inventory
- [Bulk Operations](./bulk-operations.md) - Edit or delete multiple items
