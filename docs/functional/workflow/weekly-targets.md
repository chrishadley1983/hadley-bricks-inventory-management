# Journey: Weekly Targets

> **Entry Point:** `/workflow` (Weekly Targets Panel)
> **Prerequisites:** Platform integrations configured
> **Complexity:** Low

## Purpose

Monitor business performance against weekly targets. Track listing counts, listed value, sold value, and platform-specific metrics. Visualise progress with sparklines and progress bars to stay on track for weekly goals.

---

## Key Concepts

### Target Types

| Target | Description | Data Source |
|--------|-------------|-------------|
| **eBay Listings** | New listings created on eBay | eBay API sync |
| **Amazon Listings** | New listings created on Amazon | Amazon API sync |
| **BrickLink Weekly** | Total value listed on BrickLink | BrickLink sync |
| **Listed Value** | Total value of all new listings | Inventory data |
| **Sold Value** | Total value of completed sales | Order data |

### View Modes

| Mode | Description |
|------|-------------|
| **Daily** | Today's progress vs daily target |
| **Weekly** | Week-to-date progress vs weekly target |

### Metric Components

Each metric card displays:
- Current value (count or currency)
- Target value
- Progress bar (percentage filled)
- Sparkline (last 7 days trend)
- Gap indicator ("X to go" or "X ahead")

---

## User Flow

### Step 1: View Weekly Targets

1. Navigate to `/workflow`
2. **Weekly Targets Panel** appears below timer row
3. Shows 5 metric cards in a row

### Step 2: Toggle View Mode

1. Click **Daily** or **Weekly** toggle
2. Metrics recalculate for the selected period:
   - Daily: Today's values vs daily target
   - Weekly: Week totals vs weekly targets

### Step 3: Interpret Metrics

For each metric card:
1. **Top**: Label and current value
2. **Middle**: Large display of current/target
3. **Progress Bar**: Visual fill based on percentage
4. **Bottom**: Gap text and percentage
5. **Sparkline**: 7-day trend line (if available)

### Step 4: Track Progress

Progress bar colors indicate status:
- **Green**: 75%+ of target
- **Yellow**: 50-74% of target
- **Orange**: 25-49% of target
- **Red**: Under 25% of target

---

## Metrics Explained

### eBay Listings

- **What**: Count of eBay listings created
- **Weekly Target**: Number to list per week
- **Daily Target**: Weekly target ÷ 7
- **Data Source**: `dailyListingCounts.ebay` from eBay sync

### Amazon Listings

- **What**: Count of Amazon listings created
- **Weekly Target**: Number to list per week
- **Daily Target**: Weekly target ÷ 7
- **Data Source**: `dailyListingCounts.amazon` from Amazon sync

### BrickLink Weekly/Daily

- **What**: Total value listed on BrickLink
- **Weekly Target**: Value target per week
- **Daily Target**: Weekly target ÷ 7 (average)
- **Data Source**: `bricklinkWeeklyValue` from BrickLink sync
- **Note**: Includes 7-day history sparkline

### Listed Value

- **What**: Total value of all new listings across platforms
- **Weekly Target**: 7× daily target
- **Daily Target**: Configured daily listing value target
- **Data Source**: `dailyListedValue` from inventory data
- **Note**: Includes 7-day history sparkline

### Sold Value

- **What**: Total value of completed sales
- **Weekly Target**: 7× daily target
- **Daily Target**: Configured daily sales target
- **Data Source**: `dailySoldValue` from order data
- **Note**: Includes 7-day history sparkline

---

## Week Summary

Header shows week-to-date totals:
```
Week: £1,234 listed • £567 sold
```

This provides quick context regardless of view mode.

---

## Setting Targets

Targets are configured in the system:

| Target | Default | Configuration |
|--------|---------|---------------|
| eBay Listings | 50/week | Workflow settings |
| Amazon Listings | 30/week | Workflow settings |
| BrickLink Weekly Value | £500/week | Workflow settings |
| Daily Listed Value | £100/day | Workflow settings |
| Daily Sold Value | £200/day | Workflow settings |

To modify targets:
1. Click **Settings** in workflow header
2. Adjust target values
3. Changes take effect immediately

---

## Sparklines

Mini charts showing 7-day trends:
- Each point = one day's value
- Line connects daily values
- Helps identify patterns (up/down trends)
- Available for: BrickLink, Listed Value, Sold Value

---

## API Reference

### GET /api/workflow/metrics

Get weekly metrics and targets.

**Response:**
```json
{
  "listingCounts": {
    "ebay": 45,
    "amazon": 28,
    "bricklink": 120,
    "brickowl": 15
  },
  "dailyListingCounts": {
    "ebay": 8,
    "amazon": 5,
    "bricklink": 25,
    "brickowl": 3
  },
  "bricklinkWeeklyValue": {
    "current": 450,
    "target": 500,
    "history": [65, 70, 60, 75, 80, 55, 45]
  },
  "dailyListedValue": {
    "current": 95,
    "target": 100,
    "history": [80, 110, 95, 120, 85, 90, 95]
  },
  "dailySoldValue": {
    "current": 180,
    "target": 200,
    "history": [150, 220, 180, 250, 160, 200, 180]
  },
  "weekTotals": {
    "listedValue": 675,
    "soldValue": 1340,
    "listedCount": 156,
    "soldCount": 42
  },
  "targets": {
    "ebayListings": 50,
    "amazonListings": 30,
    "bricklinkWeeklyValue": 500,
    "dailyListedValue": 100,
    "dailySoldValue": 200
  }
}
```

---

## Utility Functions

The `use-metrics.ts` hook provides helpers:

### formatCurrency(value)

Formats number as GBP currency.

```typescript
formatCurrency(1234.56) // "£1,235"
formatCurrency(0)       // "£0"
```

### formatNumber(value)

Formats number with thousands separators.

```typescript
formatNumber(1234) // "1,234"
```

### getProgressPercentage(current, target)

Calculates percentage (capped at 100%).

```typescript
getProgressPercentage(75, 100) // 75
getProgressPercentage(150, 100) // 100
```

### getGapText(current, target, isCurrency)

Returns gap message.

```typescript
getGapText(75, 100, false)   // "25 to go"
getGapText(120, 100, false)  // "20 ahead"
getGapText(100, 100, false)  // "Target met!"
getGapText(75, 100, true)    // "£25 to go"
```

### getProgressColor(percentage)

Returns color HSL string based on progress.

```typescript
getProgressColor(80)  // Green
getProgressColor(60)  // Yellow
getProgressColor(30)  // Orange
getProgressColor(10)  // Red
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Metrics not loading | Check network; API endpoint may be down |
| Counts seem wrong | Data syncs periodically; wait for refresh |
| Sparklines not showing | History requires 7 days of data |
| Wrong week totals | Week resets on Monday |

---

## Source Files

| File | Purpose |
|------|---------|
| [WeeklyTargetsPanel.tsx](../../../apps/web/src/components/features/workflow/WeeklyTargetsPanel.tsx) | Targets panel |
| [MetricCard.tsx](../../../apps/web/src/components/features/workflow/MetricCard.tsx) | Individual metric |
| [use-metrics.ts](../../../apps/web/src/hooks/use-metrics.ts) | Metrics hooks |
| [metrics/route.ts](../../../apps/web/src/app/api/workflow/metrics/route.ts) | Metrics API |

---

## Related Journeys

- [Task Management](./task-management.md) - Tasks contribute to targets
- [Time Tracking](./time-tracking.md) - Time efficiency metrics

