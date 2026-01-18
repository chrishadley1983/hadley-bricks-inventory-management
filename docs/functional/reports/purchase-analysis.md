# Purchase Analysis Report

## Overview

The Purchase Analysis report tracks return on investment (ROI) for your purchases. See which buying sources are most profitable, account for mileage costs on collections, and identify your best and worst buying decisions.

**Navigation**: Reports → Purchase Analysis

## Key Metrics

### Summary Cards - Primary

| Metric | Description |
|--------|-------------|
| **Items Acquired** | Total items from purchases |
| **Total Spent** | Sum of all purchase costs |
| **Revenue (Sold)** | Revenue from sold items |
| **Total Profit** | Revenue minus costs |
| **Overall ROI** | Return on investment percentage |

### Summary Cards - Mileage

| Metric | Description |
|--------|-------------|
| **Total Mileage** | Combined miles for collections |
| **Mileage Cost** | At HMRC rate (45p/mile) |
| **Items Sold** | Sold count vs acquired |

## ROI Calculation

```
ROI = ((Revenue - Total Cost) / Total Cost) × 100
```

Where Total Cost includes:
- Purchase price
- Mileage cost (if collection)
- Any other recorded costs

### ROI Indicators

| ROI | Badge | Meaning |
|-----|-------|---------|
| 50%+ | Green | Excellent return |
| 0-49% | Gray | Positive return |
| Negative | Red | Loss on investment |

## Date Range Options

| Preset | Period |
|--------|--------|
| **This Year** | January 1st to date (default) |
| **Last Year** | Previous full year |
| **This Quarter** | Current quarter |
| **Last Quarter** | Previous quarter |
| **Custom** | User-selected range |

## Charts

### ROI by Purchase

Bar chart showing:
- Top 10 purchases by ROI
- Green bars = positive ROI
- Red bars = negative ROI
- X-axis: Purchase description (truncated)
- Y-axis: ROI percentage

### Investment by Source

Pie chart showing:
- Total spent by source
- Identifies where money is going
- Helps prioritize buying channels

## Performance by Source

Table analyzing ROI by purchase source:

| Column | Description |
|--------|-------------|
| **Source** | Where purchased (eBay, Car Boot, etc.) |
| **Purchases** | Number of purchases |
| **Spent** | Total investment |
| **Items** | Items acquired |
| **Sold** | Items sold |
| **Revenue** | Revenue from sales |
| **Profit** | Net profit/loss |
| **ROI** | Return percentage |

### Source Examples

- **eBay** - Online auctions
- **FB Marketplace** - Facebook Marketplace
- **Car Boot** - Car boot sales
- **BrickLink** - BrickLink store purchases
- **Amazon** - Amazon marketplace
- **Retail** - Retail/clearance purchases
- **Private** - Private sales
- **Auction** - Auction house

## Purchase Details Table

Complete breakdown of individual purchases:

| Column | Description |
|--------|-------------|
| **Date** | Purchase date |
| **Description** | What was bought |
| **Source** | Where from |
| **Cost** | Purchase price |
| **Mileage** | Miles traveled (with £ cost) |
| **Items** | Sold/Total count |
| **Revenue** | Sales revenue |
| **Profit** | Profit/loss |
| **ROI** | Return percentage |

## Mileage Tracking

### Recording Mileage

When creating a purchase:
1. Enter mileage if collected in person
2. System calculates cost at 45p/mile (HMRC rate)
3. Mileage cost added to total investment

### Why Track Mileage?

- True cost of "bargain" car boot finds
- Compare collection vs shipping costs
- Tax-deductible business expense
- Better ROI calculation

### Example

```
Purchase: £50 at car boot 30 miles away
Mileage: 60 miles round trip × £0.45 = £27
True Cost: £50 + £27 = £77
```

A £50 purchase with £30 mileage isn't as good as a £55 purchase delivered.

## Understanding Your ROI

### High ROI Purchases

Signs of good buying:
- ROI consistently above 50%
- Quick turnover (items selling fast)
- Low mileage cost ratio

### Problem Purchases

Warning signs:
- Negative ROI
- Very few items sold from purchase
- High mileage cost vs purchase value

### Improving ROI

1. **Better Buying** - Focus on sources with best ROI
2. **Reduce Travel** - Minimize collection trips
3. **Faster Listing** - List items quickly after purchase
4. **Better Pricing** - Research before buying
5. **Avoid Bad Sources** - Stop buying from low-ROI sources

## Use Cases

### Source Evaluation

1. Review "Performance by Source" table
2. Identify highest and lowest ROI sources
3. Focus buying effort on best performers
4. Reconsider or improve low performers

### Purchase Post-Mortem

For a specific purchase:
1. Find in Purchase Details table
2. Check ROI and sold count
3. If low ROI, understand why:
   - Items not selling?
   - Paid too much?
   - High mileage cost?

### Annual Review

1. Set date range to full year
2. Review overall ROI
3. Compare year-over-year if data available
4. Plan buying strategy for next year

## Export

Click **Export CSV** to download:
- All purchase records
- ROI calculations
- Source summaries

## Technical Details

### Data Sources

- `purchases` table for purchase records
- `inventory_items` linked to purchases
- `orders` for sale data

### Calculation Notes

- ROI based on sold items only
- Mileage at fixed 45p/mile (2024-25 HMRC rate)
- Profit = Revenue - Cost - Mileage Cost

### API Endpoint

```
GET /api/reports/purchase-analysis?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
```

## Related Documentation

- [Purchases](../purchases/overview.md) - Recording purchases
- [Purchase Evaluator](../purchase-evaluator/overview.md) - Pre-purchase analysis
- [Profit & Loss](./profit-loss.md) - Overall profitability
