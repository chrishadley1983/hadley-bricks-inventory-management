# Journey: Compare Scenarios

> **Entry Point:** `/cost-modelling` with Compare Mode enabled
> **Prerequisites:** At least 2 scenarios
> **Complexity:** Low

## Purpose

Compare two scenarios side-by-side to understand the financial impact of different business strategies. See delta indicators highlighting significant changes (>10%) and make informed decisions about growth plans.

---

## Key Concepts

### Compare Mode

A toggle that switches from single-scenario view to side-by-side comparison:

| View | Description |
|------|-------------|
| **Single** | Full-width scenario with expanded sections |
| **Compare** | Two-column layout with compact accordions |

### Delta Indicators

Show the difference between Scenario A and B:

| Symbol | Meaning |
|--------|---------|
| **↑** | Scenario A is higher |
| **↓** | Scenario A is lower |
| **Green** | Positive change (profit up, cost down) |
| **Red** | Negative change (profit down, cost up) |

### Highlight Threshold

Changes >10% are highlighted with stronger colour to draw attention.

---

## User Flow

### Step 1: Enter Compare Mode

1. Navigate to `/cost-modelling`
2. Select your primary scenario (Scenario A)
3. Click **Compare** toggle in header
4. View splits into two columns

### Step 2: Select Scenario B

1. In the right column, click **Scenario B** dropdown
2. Select a scenario to compare
3. Scenario A options are filtered out (can't compare to itself)
4. Scenario B loads with all values

### Step 3: Review Comparison

Each column shows:
1. **Scenario Label** - Coloured dot (Blue=A, Green=B)
2. **Profit Summary Cards** - With delta indicators
3. **Assumptions Panel** - Collapsed by default
4. **P&L Breakdown** - Collapsed sections

### Step 4: Analyse Deltas

In the Profit Summary Cards:

1. Each metric shows delta vs the other scenario
2. Example: "Turnover: £50,400 (↑ +12%)"
3. Green highlight = favourable change
4. Red highlight = unfavourable change
5. Changes >10% get stronger visual emphasis

### Step 5: Edit and Compare

Both scenarios are editable in compare mode:

1. Expand an accordion section
2. Change an input value
3. Both columns recalculate
4. Delta indicators update in real-time
5. See immediate impact of changes

### Step 6: Exit Compare Mode

1. Click **Compare** toggle again
2. Returns to single-scenario view
3. Scenario A remains selected
4. All changes preserved

---

## Layout Details

### Desktop (lg+)

```
┌──────────────────────────────────────────────────┐
│  Scenario Selector                    [Compare]  │
├────────────────────────┬─────────────────────────┤
│      Scenario A        │       Scenario B        │
│  ● Blue indicator      │  ● Green indicator      │
├────────────────────────┼─────────────────────────┤
│  Summary Cards (+Δ)    │  Summary Cards (-Δ)     │
├────────────────────────┼─────────────────────────┤
│  ▸ Assumptions         │  ▸ Assumptions          │
├────────────────────────┼─────────────────────────┤
│  ▸ P&L Breakdown       │  ▸ P&L Breakdown        │
└────────────────────────┴─────────────────────────┘
```

### Mobile (< lg)

Columns stack vertically with Scenario A above Scenario B.

---

## Delta Calculation

For each metric, deltas are calculated:

```typescript
// From cost-calculations.ts
function calculateDelta(valueA: number, valueB: number) {
  const diff = valueA - valueB;
  const percentChange = valueB !== 0
    ? ((valueA - valueB) / Math.abs(valueB)) * 100
    : 0;

  return {
    diff,
    percentChange,
    isSignificant: Math.abs(percentChange) > 10
  };
}
```

### Metrics Compared

| Metric | Favourable |
|--------|------------|
| Turnover | Higher is better |
| Platform Fees | Lower is better |
| VAT | Lower is better |
| Other Costs | Lower is better |
| Gross Profit | Higher is better |
| COG | Lower is better |
| Net Profit | Higher is better |
| Tax | Lower is better (within reason) |
| Take-Home | Higher is better |

---

## Common Comparisons

### Volume Growth

Compare current vs increased sales:
- Same COG and fee rates
- Higher sales per month
- See profit scaling

### Platform Mix

Compare different channel strategies:
- Shift volume from eBay to BrickLink
- Lower fees, lower margins
- See net effect

### VAT Registration

Compare before/after VAT threshold:
- Toggle VAT in one scenario
- See flat rate impact
- Include higher accountant costs

### Cost Reduction

Compare current vs optimised costs:
- Lower postage (bulk deals)
- Reduced fixed costs
- Better COG (cheaper sourcing)

---

## API Reference

The compare mode uses the same endpoints:

### GET /api/cost-modelling/scenarios/[id]

Called twice (once per scenario) to load both datasets.

### PUT /api/cost-modelling/scenarios/[id]

Called when saving changes to either scenario.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Only one scenario available | Create another scenario first |
| Deltas not showing | Select Scenario B from dropdown |
| Changes lost on toggle | Save before exiting compare mode |
| Mobile columns overlapping | Scroll down; columns are stacked |

---

## Source Files

| File | Purpose |
|------|---------|
| [CompareMode.tsx](../../../apps/web/src/components/features/cost-modelling/CompareMode.tsx) | Two-column layout |
| [ComparisonSummary.tsx](../../../apps/web/src/components/features/cost-modelling/ComparisonSummary.tsx) | Delta summary |
| [ProfitSummaryCards.tsx](../../../apps/web/src/components/features/cost-modelling/ProfitSummaryCards.tsx) | Cards with delta support |
| [cost-calculations.ts](../../../apps/web/src/lib/services/cost-calculations.ts) | Delta calculation |

---

## Related Journeys

- [Scenario Management](./scenario-management.md) - Create scenarios to compare
- [P&L Projection](./pl-projection.md) - Edit individual scenarios
