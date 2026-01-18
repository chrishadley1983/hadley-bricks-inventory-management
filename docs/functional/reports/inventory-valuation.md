# Inventory Valuation Report

## Overview

The Inventory Valuation report shows the current value of your stock at both cost and estimated sale prices. Use this to understand your inventory investment and potential returns.

**Navigation**: Reports → Inventory Valuation

## Key Metrics

### Summary Cards

| Metric | Description |
|--------|-------------|
| **Total Items** | Count of items in inventory |
| **Total Cost Value** | Sum of purchase costs for all items |
| **Estimated Sale Value** | Sum of listing values (expected sell prices) |
| **Potential Profit** | Sale value minus cost value |
| **Potential Margin** | Potential profit as percentage of cost |
| **Unique SKUs** | Number of distinct items |

## Breakdowns

### Value by Condition

Pie chart showing inventory value distribution:
- **New** (Green) - Sealed, mint condition items
- **Used** (Amber) - Open box, pre-owned items

### Top Items by Value

Table showing highest value items:

| Column | Description |
|--------|-------------|
| **Item** | Set number and name |
| **Condition** | New or Used |
| **Status** | Current inventory status |
| **Cost** | What you paid |
| **Listing** | Expected sell price |
| **Potential** | Profit if sold at listing price |

Shows top 10 items sorted by listing value.

### Breakdown by Condition

Full table with:

| Column | Description |
|--------|-------------|
| **Condition** | New or Used |
| **Items** | Count of items |
| **Cost Value** | Total cost for condition |
| **Sale Value** | Total listing value |
| **Potential Profit** | Difference (green/red) |

### Breakdown by Status

Table showing value across inventory statuses:

| Status | Description |
|--------|-------------|
| **LISTED** | Currently listed for sale |
| **BACKLOG** | Ready to list |
| **NOT YET RECEIVED** | Purchased but not arrived |
| **SOLD** | Recently sold (still in inventory) |
| **PREORDER** | Pre-ordered items |

## Understanding the Numbers

### Cost Value

The sum of what you paid for all items:
- Based on `cost` field per inventory item
- Includes allocated costs from purchases
- Does not include shipping or fees

### Sale Value

The sum of expected sell prices:
- Based on `listing_value` field
- Represents your price targets
- May differ from actual sale prices

### Potential Profit

```
Potential Profit = Estimated Sale Value - Total Cost Value
```

This is theoretical maximum profit if:
- All items sell at listing price
- No platform fees applied
- No shipping costs

### Realistic Expectations

Actual profit will be lower due to:
- Platform fees (10-15%)
- Shipping costs
- Price reductions for slow-moving items
- Returns and issues

## Use Cases

### Business Valuation

Use this report to understand:
- Total capital tied up in inventory
- Potential value of your business
- Return on investment in stock

### Insurance Purposes

Export the report for:
- Stock valuation for insurance
- Documentation of inventory worth
- Claims support if needed

### Inventory Planning

Identify:
- Overinvestment in certain conditions
- High-value items needing priority listing
- Status distribution (too much in backlog?)

## Export

Click **Export CSV** to download:
- All inventory items with values
- Summary metrics
- Condition and status breakdowns

## Technical Details

### Data Source

- `inventory_items` table
- Filtered to exclude SOLD status (optionally)
- Real-time calculation on page load

### Calculation Notes

- Uses current `cost` and `listing_value` fields
- Items with no listing value show £0 potential
- Margin calculated as (Profit / Cost) × 100

### API Endpoint

```
GET /api/reports/inventory-valuation
```

No date range required - shows current snapshot.

## Related Documentation

- [Inventory Management](../inventory/overview.md) - Managing items
- [Inventory Aging](./inventory-aging.md) - Age analysis
- [Purchase Analysis](./purchase-analysis.md) - Cost tracking
