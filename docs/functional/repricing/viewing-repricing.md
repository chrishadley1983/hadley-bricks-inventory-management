# Viewing Repricing Data

> Browse and filter your Amazon FBM listings with Buy Box comparison.

## Overview

The repricing view displays all your Amazon listings with quantity >= 1, showing your price compared to the current Buy Box or lowest offer price.

## Table Columns

| Column | Description |
|--------|-------------|
| **ASIN** | Amazon product identifier (clickable link to Amazon) |
| **SKU** | Your seller SKU |
| **Title** | Product title (truncated with tooltip) |
| **Qty** | Available quantity |
| **Your Price** | Current listing price (editable) |
| **Buy Box** | Current Buy Box price or lowest offer |
| **Diff** | Difference between your price and Buy Box |
| **Was Price** | 90-day historical Buy Box price |
| **Cost** | Inventory cost (editable for manual override) |
| **Profit** | Calculated profit with fee breakdown |
| **Push** | Button to push price changes to Amazon |

## Filter Options

### Search
- Search by ASIN, SKU, or product title
- Debounced input (300ms delay)
- Clear button to reset search

### Checkboxes
- **With cost only**: Show only listings that have cost data
- **Buy Box lost**: Show only listings where you don't have the Buy Box

### Sync Button
- **Sync Prices**: Clears cache and fetches fresh pricing data from Amazon
- Shows spinning indicator while syncing
- Displays cache age (e.g., "2h 15m ago")

## Price Indicators

### Buy Box Status

| Indicator | Meaning |
|-----------|---------|
| Green price + "(yours)" | You have the Buy Box |
| Amber price | Buy Box exists but isn't yours |
| Purple price + "Low" badge | No Buy Box available, showing lowest offer |
| Grey dash | No pricing data available |

### Price Difference

| Color | Meaning |
|-------|---------|
| Red positive (+£X.XX) | Your price is higher than Buy Box |
| Green negative (-£X.XX) | Your price is lower than Buy Box |
| Grey dash | No comparison available |

### Was Price Trend

| Icon | Meaning |
|------|---------|
| ↑ Green arrow | Buy Box increased vs 90-day price |
| ↓ Red arrow | Buy Box decreased vs 90-day price |
| — Grey dash | Price unchanged |

## Summary Statistics

The filter bar shows summary statistics:
- Total listings count
- Listings with cost data
- Buy Box owned count (green)
- Buy Box lost count (amber)

## Pagination

- 50 items per page
- Previous/Next navigation buttons
- Current page indicator

## Data Source

### Source Files
- [RepricingView.tsx](../../../apps/web/src/components/features/repricing/RepricingView.tsx:18-139)
- [RepricingTable.tsx](../../../apps/web/src/components/features/repricing/RepricingTable.tsx:20-66)
- [RepricingFilters.tsx](../../../apps/web/src/components/features/repricing/RepricingFilters.tsx:28-178)

### API Endpoint
```
GET /api/repricing?page=1&pageSize=50&search=&showOnlyWithCost=true
```
