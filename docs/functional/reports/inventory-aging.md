# Inventory Aging Report

## Overview

The Inventory Aging report analyzes how long items have been in your inventory. Identify slow-moving stock that may need attention, repricing, or clearance.

**Navigation**: Reports → Inventory Aging

## Age Brackets

Items are grouped into five age brackets based on days since acquisition:

| Bracket | Days | Color | Health Indicator |
|---------|------|-------|------------------|
| **0-30 days** | 0-30 | Green | Excellent - Fresh stock |
| **31-60 days** | 31-60 | Blue | Good - Normal turnover |
| **61-90 days** | 61-90 | Amber | Monitor - Getting stale |
| **91-180 days** | 91-180 | Red | Action needed - Slow moving |
| **180+ days** | >180 | Purple | Critical - Very old stock |

## Key Metrics

### Summary Cards

| Metric | Description |
|--------|-------------|
| **Total Items** | Items analyzed |
| **Total Value** | Sum of listing values |
| **Average Age** | Mean days in inventory |
| **Slow-Moving Items** | Count of items 91+ days old |

### Slow-Moving Alert

If items exist in 91+ day brackets:
- Warning card highlights the issue
- Shows count and total value at risk
- Prompts action (repricing, bundling, clearance)

## Charts

### Items by Age Bracket

Bar chart showing:
- X-axis: Age brackets
- Y-axis: Number of items
- Colors match bracket indicators

### Value Distribution

Pie chart showing:
- Proportion of inventory value by age
- Helps identify where capital is tied up
- Older stock holding significant value = problem

## Oldest Items Table

Shows items in the 180+ day bracket:

| Column | Description |
|--------|-------------|
| **Item** | Set number and name |
| **Days** | Exact age in days |
| **Condition** | New or Used |
| **Listing Value** | Current price |
| **Platform** | Where it's listed |

## Drill-Down Sheet

Click on any age bracket bar to open a detail panel:

### Bracket Details

Shows all items in selected bracket:
- Set number and name
- Days in inventory
- Condition
- Current listing value
- Listed platform

Sort and review items needing attention.

## Action Strategies by Age

### 0-30 Days

- Normal new stock
- Focus on quality listings
- Optimize titles and photos

### 31-60 Days

- Standard inventory
- Review pricing competitiveness
- Consider promotion timing

### 61-90 Days

- Begin monitoring closely
- Research current market prices
- Consider small price reductions (5-10%)

### 91-180 Days

- Active intervention needed
- Price reduction (10-20%)
- Consider bundle offers
- Review if platform is appropriate
- Check listing quality

### 180+ Days

- Critical action required
- Significant price reduction (20-30%+)
- Consider clearance/bulk sale
- Evaluate if item should be relisted elsewhere
- Review why item isn't selling

## Improving Turnover

### Listing Quality

For slow-moving items, review:
- Photo quality
- Title optimization
- Item condition accuracy
- Competitive pricing

### Platform Strategy

Consider moving items between platforms:
- Amazon → eBay (if rank too high)
- eBay → BrickLink (collector appeal)
- BrickLink → Brick Owl (different audience)

### Bundling

Combine slow-movers:
- Create lot listings
- Theme-based bundles
- "3 for 2" style offers

### Clearance

For very old stock:
- Accept loss to free up capital
- Sell to other resellers
- Use for parts

## Technical Details

### Data Source

- `inventory_items` table
- Age calculated from `purchase_date` or `created_at`
- Excludes SOLD status items

### Calculation Notes

```
Age = TODAY - purchase_date (or created_at if no purchase_date)
```

Brackets are inclusive of lower bound, exclusive of upper:
- 0-30 means 0 ≤ days ≤ 30
- 31-60 means 31 ≤ days ≤ 60
- etc.

### API Endpoint

```
GET /api/reports/inventory-aging
```

No date range - analyzes current inventory.

## Related Documentation

- [Inventory Valuation](./inventory-valuation.md) - Value analysis
- [Inventory Management](../inventory/overview.md) - Managing items
- [Listing Assistant](../listing-assistant/overview.md) - Improving listings
