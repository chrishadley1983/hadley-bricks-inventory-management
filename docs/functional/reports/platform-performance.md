# Platform Performance Report

## Overview

The Platform Performance report compares sales metrics across your selling platforms. Identify which channels are most profitable, understand fee structures, and optimize your multi-platform strategy.

**Navigation**: Reports → Platform Performance

## Key Metrics

### Summary Cards

| Metric | Description |
|--------|-------------|
| **Total Orders** | Orders across all platforms |
| **Total Revenue** | Gross revenue from sales |
| **Total Fees** | Sum of all platform fees |
| **Best Platform** | Highest net revenue platform |

## Platforms Tracked

| Platform | Color Code |
|----------|------------|
| **BrickLink** | Blue |
| **Brick Owl** | Orange |
| **eBay** | Yellow |
| **Amazon** | Amber |
| **Manual** | Gray |

## Date Range Options

| Preset | Period |
|--------|--------|
| **This Month** | Current calendar month (default) |
| **Last Month** | Previous calendar month |
| **This Quarter** | Current quarter |
| **Last Quarter** | Previous quarter |
| **This Year** | Year to date |
| **Custom** | User-selected range |

## Charts

### Revenue by Platform

Grouped bar chart comparing:
- **Revenue** (Blue) - Gross sales
- **Net Revenue** (Green) - After fees

Shows side-by-side comparison for each platform.

### Order Distribution

Pie chart showing:
- Proportion of orders by platform
- Helps identify where sales volume comes from
- May differ from revenue distribution

### Platform Fees Comparison

Bar chart showing:
- Total fees by platform (Red)
- Helps identify high-fee channels

## Detailed Comparison Table

| Column | Description |
|--------|-------------|
| **Platform** | Selling channel |
| **Orders** | Number of orders |
| **Items Sold** | Total items in orders |
| **Revenue** | Gross sales value |
| **Fees** | Platform fees (with %) |
| **Net Revenue** | Revenue minus fees |
| **Margin** | Profit margin percentage |
| **Avg Order** | Average order value |

### Totals Row

Summary row shows:
- Combined order count
- Total revenue
- Total fees
- Overall net revenue
- Average order value

## Understanding Platform Metrics

### Revenue vs Net Revenue

```
Net Revenue = Revenue - Fees
```

A platform with high revenue but high fees may be less profitable than one with lower revenue but minimal fees.

### Fee Percentages

Typical fee ranges:
- **Amazon**: 15-20% (referral + FBA)
- **eBay**: 10-13% (final value fee)
- **BrickLink**: 3% (transaction fee)
- **Brick Owl**: 2.5% (transaction fee)

### Profit Margin

```
Margin = ((Revenue - Fees - Cost) / Revenue) × 100
```

Higher margin = more profitable per sale.

### Average Order Value

```
Avg Order = Revenue / Order Count
```

Higher average order = more efficient fulfillment.

## Platform Strategy Insights

### Best Platform Analysis

The "Best Platform" card shows the highest net revenue channel. Consider:
- Is this where you're focusing effort?
- Can you increase volume here?
- What's driving success on this platform?

### Fee Optimization

If fees are high:
- Review listing strategies
- Consider platform-specific pricing
- Evaluate if volume justifies fees

### Volume vs Value

Compare order count to revenue:
- High orders, low revenue = many small sales
- Low orders, high revenue = fewer valuable sales

Choose strategy based on your goals and capacity.

## Use Cases

### Monthly Platform Review

1. Select "Last Month" preset
2. Compare net revenue across platforms
3. Identify any underperforming channels
4. Plan inventory allocation

### Fee Analysis

1. Review fees column and percentages
2. Calculate total fee impact
3. Compare against revenue generated
4. Consider if alternative platforms are better

### Expansion Planning

1. Identify best performing platform
2. Review what sells well there
3. Consider expanding inventory for that channel
4. Or investigate underperforming platforms for potential

## Export

Click **Export CSV** to download:
- All platform metrics
- Date range summary
- Detailed breakdown

## Technical Details

### Data Sources

- `orders` table for sales data
- Platform extracted from `selling_platform` field
- Fees from `platform_fees` field

### Calculation Notes

- Only completed orders included
- Fees include all recorded platform charges
- Revenue is gross order value

### API Endpoint

```
GET /api/reports/platform-performance?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
```

## Related Documentation

- [Profit & Loss](./profit-loss.md) - Overall profitability
- [Orders](../orders/overview.md) - Order details
- [eBay Integration](../ebay/overview.md) - eBay-specific info
- [Amazon Integration](../amazon/overview.md) - Amazon-specific info
