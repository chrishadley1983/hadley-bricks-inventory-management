# Fix: Amazon Dispatch Items Not Displaying

**Date:** 2026-02-02
**Branch:** `fix/amazon-dispatch-items`
**Status:** Ready for review

## Issue

Amazon orders in the "Orders to Dispatch" workflow panel were showing:
- "0 items" count
- No product name/description (falling back to buyer name)

## Root Cause

The Amazon sync service defaults to `includeItems: false` to avoid API rate limits when syncing hundreds of orders. This means:

1. Order items are never fetched from Amazon SP-API
2. No rows are inserted into `order_items` table
3. `items_count` is set to 0

The dispatch workflow panel relies on `order_items` to display product names and counts.

## Solution

Modified `AmazonSyncService.processOrder()` to automatically fetch items for orders with dispatch-related statuses (`Unshipped`, `PartiallyShipped`), regardless of the global `includeItems` setting.

This provides a targeted approach:
- **Shipped/Cancelled orders**: No items fetched (not needed for workflow)
- **Orders awaiting dispatch**: Items fetched automatically

## Files Changed

| File | Change |
|------|--------|
| [amazon-sync.service.ts](../../apps/web/src/lib/services/amazon-sync.service.ts) | Added conditional item fetching for dispatch orders |

## Code Change

```typescript
// Always fetch items for orders awaiting dispatch (Unshipped, PartiallyShipped)
// These need item details for the dispatch workflow UI
const dispatchStatuses = ['Unshipped', 'PartiallyShipped'];
const needsItemsForDispatch = dispatchStatuses.includes(orderSummary.OrderStatus);
const shouldFetchItems = includeItems || needsItemsForDispatch;
```

## Verification

- [x] TypeScript compiles without errors
- [x] ESLint passes
- [ ] Manual test: Run Amazon sync, verify items appear in dispatch panel

## To Backfill Existing Orders

After merging, run a full Amazon sync to populate items for existing dispatch orders:

1. Go to Settings > Integrations > Amazon
2. Click "Sync Orders"

The sync will automatically fetch items for any orders awaiting dispatch.

## Next Steps

1. `/code-review branch` - Review changes
2. `/merge-feature fix/amazon-dispatch-items` - Merge to main
