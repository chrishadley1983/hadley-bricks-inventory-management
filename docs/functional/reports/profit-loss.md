# Profit & Loss Report

## Overview

The Profit & Loss report provides a comprehensive view of your business income, expenses, and profitability over time. Track monthly performance with category-level breakdowns and visual trend analysis.

**Navigation**: Reports → Profit & Loss

## Key Metrics

### Summary Cards

| Metric | Description |
|--------|-------------|
| **Total Income** | Gross revenue from all sales |
| **Total Expenses** | Sum of all expense categories |
| **Net Profit** | Income minus expenses |
| **Profit Margin** | Net profit as percentage of income |

## Date Range Options

| Preset | Period |
|--------|--------|
| **Last 12 Months** | Rolling 12-month view (default) |
| **This Year** | January 1st to current date |
| **Last Year** | Previous full calendar year |
| **This Quarter** | Current quarter |
| **Last Quarter** | Previous quarter |
| **Custom** | Select specific date range |

## Categories

The report organizes transactions into five categories:

### Income (Green)

Revenue from sales across all platforms:
- Amazon sales
- eBay sales
- BrickLink sales
- Brick Owl sales
- Manual/other sales

### Selling Fees (Red)

Platform fees and transaction costs:
- Amazon FBA/referral fees
- eBay final value fees
- PayPal/payment processing fees
- Platform subscription fees

### Stock Purchase (Orange)

Cost of goods acquired:
- LEGO set purchases
- Bulk lot purchases
- Wholesale orders

### Packing & Postage (Blue)

Shipping and fulfillment costs:
- Postage costs
- Packaging materials
- FBA inbound shipping

### Bills (Purple)

Business overhead:
- Storage costs
- Software subscriptions
- Business insurance
- Other operating expenses

## Monthly Table View

The main table shows:

| Column | Description |
|--------|-------------|
| **Month** | Calendar month |
| **Income** | Total sales revenue |
| **Selling Fees** | Platform/transaction fees |
| **Stock Purchase** | Cost of inventory acquired |
| **Packing & Postage** | Shipping costs |
| **Bills** | Operating expenses |
| **Net Profit** | Monthly profit/loss |

### Expandable Rows

Click the **+** button on any month to expand and see:
- Individual transactions within each category
- Date, description, and amount per line item
- Detailed category breakdowns

## Charts

### Turnover by Platform

Stacked bar chart showing monthly revenue by sales platform:
- Amazon (orange)
- eBay (yellow)
- BrickLink (blue)
- Brick Owl (orange)
- Other (gray)

**X-axis**: Month
**Y-axis**: Revenue (£)

### Profit by Month

Combo chart showing:
- **Bars**: Monthly net profit
- **Line**: Cumulative trend

Green bars indicate profit, red bars indicate loss.

## Export

Click **Export CSV** to download:
- All monthly data
- Category breakdowns
- Transaction details

## Understanding the Numbers

### Positive Profit Margin

A healthy P&L shows:
- Income exceeding total expenses
- Consistent monthly profit
- Margins above your target (typically 20-35%)

### Warning Signs

Review your operations if:
- Selling fees exceed 15% of revenue
- Multiple consecutive loss months
- Profit margin declining over time

### Improving Profitability

Based on report insights:
1. **High Selling Fees** - Consider platform mix or fee optimization
2. **High Stock Purchase** - Review buying decisions, check Purchase Analysis
3. **High Packing Costs** - Optimize shipping or negotiate rates
4. **Inconsistent Income** - Check Daily Activity for listing patterns

## Technical Details

### Data Sources

- **Income**: `orders` table with status = 'completed'
- **Expenses**: `transactions` table categorized by type
- **Stock**: `purchases` table

### Calculation Notes

- Net Profit = Total Income - Total Expenses
- Profit Margin = (Net Profit / Total Income) × 100
- Categories are determined by transaction `category` field

### API Endpoint

```
GET /api/reports/profit-loss?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
```

## Related Documentation

- [Platform Performance](./platform-performance.md) - Revenue by platform detail
- [Purchase Analysis](./purchase-analysis.md) - Stock purchase ROI
- [Orders](../orders/overview.md) - Income source details
