# Comparing Stock

> Identify discrepancies between Amazon listings and your inventory.

## Overview

The Comparison tab shows a side-by-side comparison of Amazon listing quantities versus your local inventory, helping you identify:

- Items listed on Amazon but missing from inventory
- Inventory items not listed on Amazon
- Quantity mismatches between platforms

## Summary Cards

At the top of the comparison view, summary cards show:

| Card | Colour | Description |
|------|--------|-------------|
| **Total** | Blue | Total items compared |
| **Match** | Green | Quantities match exactly |
| **Mismatch** | Orange | Different quantities |
| **Platform Only** | Red | On Amazon, not in inventory |
| **Inventory Only** | Yellow | In inventory, not on Amazon |

Click any card to filter the table to that category.

## Comparison Table

| Column | Description |
|--------|-------------|
| **ASIN** | Amazon product identifier |
| **Title** | Product title |
| **Platform Qty** | Quantity on Amazon |
| **Inventory Qty** | Quantity in local inventory |
| **Difference** | Platform - Inventory |
| **Platform Price** | Amazon listing price |
| **Status** | Discrepancy type badge |

### Difference Colours

| Colour | Meaning |
|--------|---------|
| Green (0) | Quantities match |
| Orange (+N) | More on Amazon than inventory |
| Red (-N) | Less on Amazon than inventory |

## Discrepancy Types

### Match
- Platform and inventory quantities are equal
- Shows green badge
- No action needed

### Platform Only
- Item is listed on Amazon
- No matching inventory items found (by ASIN)
- Suggestion: Add items to inventory

### Inventory Only
- Inventory items have this ASIN
- No Amazon listing found
- Suggestion: Create listing or remove ASIN from inventory

### Quantity Mismatch
- Both exist but quantities differ
- Shows the difference
- Investigate which is correct

## Filter Options

### Discrepancy Type
- **All**: Show all items
- **Match**: Only matching quantities
- **Mismatch**: Only quantity differences
- **Platform Only**: Only Amazon-only items
- **Inventory Only**: Only inventory-only items

### Search
- Search by ASIN or title
- Filters the comparison results

### Hide Zero Quantities
- Toggle to hide items where both platform and inventory are 0
- Useful for cleaning up the view

## Detail Sheet

Click any row to open a detail sheet showing:

### Amazon Listing Section
- Quantity and price
- SKU and ASIN
- Fulfillment channel
- Listing status
- Link to Amazon product page

### Inventory Section
- List of matching inventory items
- For each item:
  - Set number and name
  - Condition
  - Listing value
  - Storage location
  - Link to inventory detail

### Discrepancy Explanation
- Human-readable explanation of the issue
- Suggested action to resolve

## Matching Logic

The comparison matches by ASIN:

1. Amazon listings have `platformItemId` (ASIN)
2. Inventory items have `amazonAsin` field
3. Match when ASINs are equal
4. Sum inventory quantities for same ASIN

## Source Files

- [ComparisonView.tsx](../../../apps/web/src/components/features/platform-stock/ComparisonView.tsx:54-389)
- [ComparisonSummary.tsx](../../../apps/web/src/components/features/platform-stock/ComparisonSummary.tsx)
- [ComparisonFilters.tsx](../../../apps/web/src/components/features/platform-stock/ComparisonFilters.tsx)
- [DiscrepancyBadge.tsx](../../../apps/web/src/components/features/platform-stock/DiscrepancyBadge.tsx)

## API Endpoint

```
GET /api/platform-stock/comparison?platform=amazon&discrepancyType=mismatch
```

### Response Format
```json
{
  "data": {
    "comparisons": [...],
    "summary": {
      "total": 100,
      "match": 80,
      "mismatch": 15,
      "platformOnly": 3,
      "inventoryOnly": 2
    }
  }
}
```
