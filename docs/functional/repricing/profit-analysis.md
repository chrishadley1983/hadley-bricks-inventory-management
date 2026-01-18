# Profit Analysis

> Understand profit margins with detailed fee breakdown for each listing.

## Overview

The Profit column shows calculated profit for each listing, with a tooltip breakdown of all Amazon fees.

## Profit Display

### Colour Coding

| Colour | Meaning |
|--------|---------|
| Green | Positive profit |
| Red | Negative profit (loss) |
| Grey dash | Cannot calculate (no cost data) |

### Tooltip Breakdown

Hover over any profit value to see the full breakdown:

```
Profit Breakdown
────────────────
Sale Price:        £49.99
Referral Fee (15%): -£7.50
DST (2%):          -£1.00
VAT on Fees (20%): -£1.70
Shipping:          -£4.50
────────────────
Net Payout:        £35.29
Product Cost:      -£25.00
────────────────
Total Profit:      £10.29
ROI:               +41.2%

COG %:             50.0%
Profit Margin:     +20.6%
```

## Fee Calculations

### Amazon FBM Fees

| Fee | Rate | Description |
|-----|------|-------------|
| **Referral Fee** | 15% | Amazon's commission on sale price |
| **Digital Services Tax** | 2% | UK DST on digital marketplace sales |
| **VAT on Fees** | 20% | VAT charged on referral + DST |
| **Shipping** | Variable | Estimated FBM shipping cost |

### Formula

```
Net Payout = Sale Price - Referral Fee - DST - VAT on Fees - Shipping
Total Profit = Net Payout - Product Cost
ROI = (Total Profit / Product Cost) × 100
Profit Margin = (Total Profit / Sale Price) × 100
COG % = (Product Cost / Sale Price) × 100
```

## Dynamic Profit Calculation

### Price Editing
When you edit a price, the profit recalculates immediately:
1. Enter a new price in the "Your Price" column
2. Profit column updates to show expected profit at new price
3. Tooltip shows full breakdown at the new price

### Cost Override
When you enter a manual cost:
1. Click pencil icon in Cost column
2. Enter manual cost value
3. Profit recalculates using manual cost
4. Helps test "what-if" scenarios

## Use Cases

### Finding Profitable Adjustments
1. Filter to "Buy Box lost" listings
2. Check the profit at the current Buy Box price
3. If profitable, edit price to match Buy Box
4. Push the update

### Margin Analysis
1. Sort or scan for low-margin items
2. Review tooltip to see where costs are high
3. Consider if shipping cost is accurate
4. Decide whether to raise price or accept margin

### Break-Even Analysis
- Red profit = selling at a loss
- Zero profit = break-even point
- Use cost override to find minimum profitable price

## Source Files

- [ProfitCalculator.tsx](../../../apps/web/src/components/features/repricing/ProfitCalculator.tsx:21-154) - Profit display and tooltip
- [calculations.ts](../../../apps/web/src/lib/arbitrage/calculations.ts) - Fee calculation functions

## Related

- [Arbitrage Profit Calculation](../arbitrage/overview.md) - Shared calculation logic
- [Amazon FBM Fees](https://sellercentral.amazon.co.uk/gp/help/external/200336920) - Official fee documentation
