# User Journey: Viewing Purchases

> **Journey:** Browse, search, and filter purchase history
> **Entry Point:** `/purchases`
> **Complexity:** Medium

## Overview

The purchases list view provides a paginated data table for viewing and managing all purchase records. It includes search, filtering, and bulk operations for efficient purchase management.

## User Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         /purchases                                  │
├─────────────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ [All Purchases]  [Quick Add]                                   │ │
│  └────────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────────────┐
│  │ Search: [________________________] │ Source ▼ │ Payment ▼ │ ✕ │  │
│  └──────────────────────────────────────────────────────────────────┘
│  ┌──────────────────────────────────────────────────────────────────┐
│  │ Date Range: [From ____] [To ____]                               │
│  └──────────────────────────────────────────────────────────────────┘
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────────────┐
│  │ ☐ │ Date │ Description │ Source │ Payment │ Cost │ Expenses │ ⋯ │
│  ├──────────────────────────────────────────────────────────────────┤
│  │ ☐ │ 15 Jan │ Car boot sale haul │ Car Boot │ Cash │ £45 │ £12 │  │
│  │ ☐ │ 12 Jan │ eBay bundle │ eBay │ PayPal │ £120 │ - │          │
│  │ ...                                                              │
│  └──────────────────────────────────────────────────────────────────┘
├─────────────────────────────────────────────────────────────────────┤
│  Showing 1-50 of 234 purchases        │ ◀ │ Page 1 of 5 │ ▶ │      │
└─────────────────────────────────────────────────────────────────────┘
```

## Steps

### 1. Access Purchase List

**Action:** Navigate to `/purchases` from the sidebar

**What Happens:**
1. Page loads with skeleton loading state
2. `usePurchaseList` hook fetches first page of purchases
3. Data table renders with default sort (newest first)
4. Each row shows: date, description, source, payment method, cost, expenses

### 2. Search Purchases

**Action:** Type in the search box

**Behaviour:**
- Search input is **debounced** (300ms delay)
- Searches across: `short_description`, `notes`
- Results update automatically after typing stops
- Clear search with the X button

**Example Searches:**
- `car boot` - Find car boot sale purchases
- `eBay` - Find purchases from eBay
- `75192` - Find by set number in description

### 3. Filter by Source

**Action:** Select from Source dropdown

**Options:**
| Value | Description |
|-------|-------------|
| All Sources | Show all purchases |
| eBay | Items bought on eBay |
| Amazon | Items bought on Amazon |
| Car Boot | Car boot sale finds |
| Charity Shop | Charity shop purchases |
| Facebook | Facebook Marketplace |
| Gumtree | Gumtree purchases |
| Retail | Shop purchases (LEGO Store, Smyths, etc.) |
| Other | Other sources |

### 4. Filter by Payment Method

**Action:** Select from Payment dropdown

**Options:**
| Value | Description |
|-------|-------------|
| All Methods | Show all payment types |
| Cash | Cash payments |
| PayPal | PayPal transactions |
| Card | Credit/debit card |
| Bank Transfer | Direct bank transfer |

### 5. Filter by Date Range

**Action:** Select From and/or To dates

**Behaviour:**
- Leave From blank for "all history until To date"
- Leave To blank for "all from From date onwards"
- Both blank shows all purchases

### 6. Clear Filters

**Action:** Click the X button next to the dropdowns

**Behaviour:**
- Resets all filters to defaults
- Clears search text
- Clears date range
- Returns to full purchase view

### 7. Select Purchases

**Action:** Click checkbox in row or header

**Behaviour:**
- Individual row: Toggles selection for that purchase
- Header checkbox: Toggles all visible purchases on current page
- Selected purchases can be bulk edited or deleted

### 8. View Purchase Detail

**Action:** Click on a purchase row

**Behaviour:**
- Navigates to `/purchases/[id]`
- Shows full purchase details
- Linked inventory items displayed
- Mileage and expenses shown
- Edit and delete options available

### 9. Bulk Operations

When purchases are selected, action buttons appear:

```
┌──────────────────────────────────────────────────────────────────┐
│ 3 purchases selected │ [Bulk Edit] │ [Delete] │ [Clear Selection]│
└──────────────────────────────────────────────────────────────────┘
```

**Bulk Edit:**
- Opens dialog to update shared fields
- Only checked fields are modified
- Fields: source, payment_method, notes

**Bulk Delete:**
- Confirmation dialog with count
- Permanently removes selected purchases
- Also removes linked mileage and expenses

### 10. Paginate Results

**Action:** Use pagination controls at bottom

**Behaviour:**
- 50 items per page
- Previous/Next buttons
- Page number display
- Total count display

---

## Table Columns

| Column | Description | Sortable |
|--------|-------------|----------|
| Select | Checkbox for bulk operations | No |
| Date | Purchase date | Yes |
| Description | Short description | Yes |
| Source | Where purchased | Yes |
| Payment | Payment method used | Yes |
| Cost | Purchase cost in GBP | Yes |
| Expenses | Total mileage + expenses | No |
| Items | Linked inventory count | No |
| Actions | Row action menu | No |

## Row Actions Menu

```
┌─────────────┐
│ View        │
│ Edit        │
│ Delete      │
└─────────────┘
```

---

## Technical Details

### Query Keys

```typescript
purchaseKeys = {
  all: ['purchases'],
  lists: () => ['purchases', 'list'],
  list: (filters, pagination) => ['purchases', 'list', { filters, pagination }],
  details: () => ['purchases', 'detail'],
  detail: (id) => ['purchases', 'detail', id],
  profitability: (id) => ['purchases', 'profitability', id],
}
```

### Stale Times

| Query | Stale Time | Reason |
|-------|------------|--------|
| List | 5 minutes | Prevents unnecessary refetches |
| Detail | 10 minutes | Purchase details change less frequently |
| Profitability | 5 minutes | Depends on sales data |

### Filter Application

Filters are applied server-side in the repository layer:

```typescript
// Source filter
query = query.eq('source', filters.source);

// Payment method filter
query = query.eq('payment_method', filters.paymentMethod);

// Date range
query = query.gte('purchase_date', filters.dateFrom);
query = query.lte('purchase_date', filters.dateTo);

// Search (OR across multiple fields)
query = query.or(
  `short_description.ilike.%${term}%,notes.ilike.%${term}%`
);
```

### Performance Considerations

1. **Debounced Search:** 300ms delay prevents API spam
2. **Pagination:** Server-side with 50 items per page
3. **Stale Time:** 5 minutes reduces refetches
4. **Related Data:** Image count fetched via aggregate, not full images

---

## Source Files

| File | Purpose |
|------|---------|
| [purchases/page.tsx](apps/web/src/app/(dashboard)/purchases/page.tsx) | Page component with tabs |
| [PurchaseTable.tsx](apps/web/src/components/features/purchases/PurchaseTable.tsx) | Data table component |
| [PurchaseFilters.tsx](apps/web/src/components/features/purchases/PurchaseFilters.tsx) | Filter controls |
| [use-purchases.ts](apps/web/src/hooks/use-purchases.ts#L25-45) | List query hook |
| [purchase.repository.ts](apps/web/src/lib/repositories/purchase.repository.ts#L60-150) | Filter implementation |

## Related Journeys

- [Adding Purchases](./adding-purchases.md) - Create new purchase records
- [Mileage Tracking](./mileage-tracking.md) - Track travel costs
