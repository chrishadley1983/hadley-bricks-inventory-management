# Viewing Listings

> Browse and filter all Amazon listings in the Listings tab.

## Overview

The Listings tab displays all Amazon listings imported from your Seller Central account, with filtering, sorting, and column customisation.

## Table Columns

| Column | Description | Default |
|--------|-------------|---------|
| **ASIN** | Amazon Standard Identification Number | Visible |
| **SKU** | Your seller SKU | Visible |
| **Title** | Product title (truncated) | Visible |
| **Qty** | Available quantity | Visible |
| **Price** | Current listing price | Visible |
| **Status** | Listing status (Active, Inactive, etc.) | Visible |
| **Fulfillment** | FBA or FBM | Visible |
| **Condition** | Item condition | Hidden |

### Column Customisation

Click the **Columns** button to show/hide columns:
1. Opens dropdown menu
2. Check/uncheck columns to toggle visibility
3. Changes apply immediately

## Filter Options

### Search
- Text search across ASIN, SKU, and title
- Debounced input for performance
- Clear button to reset

### Status Filter
- **All**: Show all statuses
- **Active**: Currently active listings
- **Inactive**: Disabled listings
- **Incomplete**: Missing required data
- **Out of Stock**: Zero quantity

### Fulfillment Filter
- **All**: Show all channels
- **FBA**: Fulfilled by Amazon
- **FBM**: Fulfilled by Merchant

### Quantity Filter
- **Has Quantity**: Only show items with qty > 0

## Status Badges

| Status | Badge Style | Meaning |
|--------|-------------|---------|
| Active | Green/Default | Listing is live |
| Inactive | Grey/Secondary | Listing disabled |
| Incomplete | Red/Destructive | Missing data |
| Out of Stock | Red/Destructive | Zero quantity |
| Unknown | Outline | Status not recognised |

## Pagination

- 50 items per page (fixed)
- Previous/Next navigation
- Page indicator (e.g., "Page 1 of 5")
- Resets to page 1 when filters change

## Empty States

### No Listings
> "No listings found"
> "Import listings from Amazon to get started"

### No Filter Results
> "No listings found"
> "Try adjusting your filters"

## Data Source

### Source Files
- [ListingsView.tsx](../../../apps/web/src/components/features/platform-stock/ListingsView.tsx:77-315)
- [ListingsFilters.tsx](../../../apps/web/src/components/features/platform-stock/ListingsFilters.tsx)

### API Endpoint
```
GET /api/platform-stock?platform=amazon&page=1&pageSize=50&search=&status=Active
```

### Response Format
```json
{
  "data": {
    "listings": [...],
    "pagination": {
      "page": 1,
      "pageSize": 50,
      "total": 150,
      "totalPages": 3
    },
    "latestImport": {...}
  }
}
```
