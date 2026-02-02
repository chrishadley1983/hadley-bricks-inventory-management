# Fix: Amazon Sales P&L Understating Revenue

**Date:** 2026-02-02
**Branch:** `fix/amazon-sales-include-paid-orders`
**Status:** Ready for review

## Issue

P&L report showed Amazon Sales as £3,272.07 for January 2026, but Amazon Seller Central showed £3,377.04 - a £104.97 discrepancy.

## Root Cause

The `queryAmazonSales()` function in [profit-loss-report.service.ts](../../apps/web/src/lib/services/profit-loss-report.service.ts) only counted orders with `status = 'Shipped'`, excluding orders with `status = 'Paid'` (orders awaiting dispatch).

### Data Analysis

| Status | Orders | Total |
|--------|--------|-------|
| Shipped | 86 | £3,272.07 |
| **Paid** | **4** | **£104.97** ← Missing |
| Cancelled | 2 | £0.00 |

**Shipped + Paid = £3,377.04** (matches Amazon Seller Central)

### The 4 Missing Orders

All placed Jan 30, awaiting dispatch:
- 202-2308111-3513935: £28.49
- 202-0253442-1426718: £15.00
- 206-8455848-9648326: £37.99
- 026-9835656-3154736: £23.49

## Solution

Changed the query filter from:
```typescript
.eq('status', 'Shipped')
```

To:
```typescript
.in('status', ['Shipped', 'Paid'])
```

This matches Amazon Seller Central's "Ordered product sales" metric which includes all paid orders regardless of shipment status.

## Files Changed

| File | Change |
|------|--------|
| [profit-loss-report.service.ts](../../apps/web/src/lib/services/profit-loss-report.service.ts) | Include Paid orders in Amazon sales query |

## Verification

- [x] TypeScript compiles without errors
- [x] ESLint passes
- [ ] Manual test: Verify P&L report shows £3,377.04 for Jan 2026

## Next Steps

1. `/code-review branch` - Review changes
2. `/merge-feature fix/amazon-sales-include-paid-orders` - Merge to main
