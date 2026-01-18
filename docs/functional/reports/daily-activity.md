# Daily Activity Report

## Overview

The Daily Activity report tracks daily operational metrics including items listed, items sold, and store status across platforms. Use this for operational monitoring and performance tracking.

**Navigation**: Reports → Daily Activity

## View Options

### Granularity Toggle

| Mode | Description |
|------|-------------|
| **Daily** | Day-by-day breakdown |
| **Monthly** | Aggregated by month |

Switch between views for different levels of detail.

### Column Visibility

Toggle which platforms to display:
- **Amazon** - Amazon marketplace columns
- **eBay** - eBay marketplace columns
- **BrickLink** - BrickLink store columns
- **Total** - Combined totals

## Metrics Per Day/Month

For each platform and the total:

| Metric | Description |
|--------|-------------|
| **Items Listed** | New listings created |
| **Listing Value** | Total value of new listings |
| **Items Sold** | Orders completed |
| **Sold Value** | Revenue from sales |

## Store Status Tracking

### Status Codes

| Code | Status | Color | Description |
|------|--------|-------|-------------|
| **O** | Open | Green | Normal trading day |
| **C** | Closed | Gray | Store closed/inactive |
| **H** | Holiday | Yellow | Holiday/vacation mode |

### Setting Status

1. Click on a status cell in the table
2. Select new status from dropdown
3. Status is saved automatically
4. Applies per platform per day

### Why Track Status?

- Understand sales dips (were you closed?)
- Account for holidays in performance analysis
- Track platform-specific activity patterns
- Historical reference for busy periods

## Table Structure

### Daily View

| Column | Description |
|--------|-------------|
| **Date** | Calendar date |
| **[Platform] Status** | O/C/H indicator |
| **[Platform] Listed** | Items listed |
| **[Platform] List Value** | Listing value |
| **[Platform] Sold** | Items sold |
| **[Platform] Sold Value** | Revenue |
| **Total Listed** | All platforms |
| **Total Sold** | All platforms |

### Monthly View

Same columns, aggregated by month:
- Status shows predominant status
- Counts are monthly totals
- Values are monthly sums

## Status Legend

At the bottom of the table, a legend explains:
- **O** = Open (normal trading)
- **C** = Closed (not trading)
- **H** = Holiday (vacation mode)

## Use Cases

### Daily Operations Monitoring

1. Open report in Daily view
2. Check today's listing count
3. Verify sales recorded
4. Update store status if needed

### Weekly Review

1. Select last 7 days
2. Review listing pace
3. Check sale patterns
4. Note any closed days affecting totals

### Monthly Performance

1. Switch to Monthly granularity
2. Compare month-over-month activity
3. Identify seasonal patterns
4. Account for holiday periods

### Debugging Missing Sales

If sales seem low:
1. Check store status for the period
2. Verify platform was marked Open
3. If Closed/Holiday, that explains gap
4. Cross-reference with platform dashboard

## Activity Patterns

### Healthy Patterns

- Consistent daily listings
- Regular sales matching listings
- Status accurately reflects activity
- Growing month-over-month trends

### Warning Signs

- Many days with zero listings
- Sales not matching listing activity
- Frequent "Closed" days unexplained
- Declining monthly totals

### Optimization Tips

1. **Listing Consistency** - Aim for daily listing activity
2. **Platform Balance** - Don't neglect any channel
3. **Status Accuracy** - Keep status current
4. **Holiday Planning** - Update status for vacations

## Technical Details

### Data Sources

- `inventory_items` with `listed_date` for listings
- `orders` with `order_date` for sales
- `store_statuses` table for O/C/H status

### Store Status Management

Status is stored per:
- Date (YYYY-MM-DD)
- Platform (amazon, ebay, bricklink)

### API Endpoints

```
GET /api/reports/daily-activity?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&granularity=daily

PUT /api/reports/store-status
{
  "date": "2026-01-18",
  "platform": "ebay",
  "status": "O"
}
```

### Calculation Notes

- Listed items counted by `listed_date`
- Sold items counted by order completion date
- Values summed from respective transactions
- Monthly view uses calendar month boundaries

## Related Documentation

- [Inventory Management](../inventory/overview.md) - Listing items
- [Orders](../orders/overview.md) - Order details
- [Platform Performance](./platform-performance.md) - Platform analysis
- [Profit & Loss](./profit-loss.md) - Financial overview
