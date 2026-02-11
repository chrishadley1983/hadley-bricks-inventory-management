# Fix Report: Arbitrage Sync Status and Invalid Parameters

**Date:** 2026-01-28
**Branch:** `fix/arbitrage-sync-status-and-invalid-params`
**Status:** Ready for code review

## Issues Fixed

### Issue 1: Sync Status Showing Wrong Data

**Symptom:** Amazon Inventory showed "4 days ago" when it was actually synced more recently. BrickLink and Amazon Pricing showed "Never synced" despite running daily.

**Root Cause:** The database uses different job type names than what the UI expects:

| Database Job Type | UI Expected | Result |
|-------------------|-------------|--------|
| `bricklink_scheduled_pricing` | `bricklink_pricing` | "Never synced" |
| `ebay_scheduled_pricing` | `ebay_pricing` | "Never synced" |
| `pricing_sync` | `amazon_pricing` | "Never synced" |

**Fix:** Added mapping in `ArbitrageService.getSyncStatus()` to translate database job types to UI-expected types.

### Issue 2: "Invalid parameters" Error

**Symptom:** Error loading arbitrage data with message "Invalid parameters".

**Root Cause:** The page sends `sortField: 'cog'` but the API Zod schema only allowed `['margin', 'bl_price', 'sales_rank', 'name', 'ebay_margin', 'ebay_price']`.

**Fix:** Added all valid sort fields to the Zod schema: `'cog'`, `'your_price'`, `'buy_box'`, `'was_price'`, `'bl_lots'`.

### Enhancement: Added Sync Button for Amazon Inventory

Since `inventory_asins` is the only sync job without a scheduled cron (must be triggered manually), added a sync button to the "Amazon Inventory" badge in the Sync Status card.

## Files Changed

| File | Changes |
|------|---------|
| `apps/web/src/app/api/arbitrage/route.ts` | Added missing sort fields to Zod schema |
| `apps/web/src/lib/arbitrage/arbitrage.service.ts` | Added job type mapping in `getSyncStatus()` |
| `apps/web/src/app/(dashboard)/arbitrage/page.tsx` | Added sync button, progress display, RefreshCw icon |

## Verification

- [x] TypeScript compiles with no errors
- [x] ESLint passes (no new warnings)
- [x] Changes are scoped to 3 files

## Next Steps

Run `/code-review branch` to review the changes.
