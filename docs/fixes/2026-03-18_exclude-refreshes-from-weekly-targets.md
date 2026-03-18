# Fix: Exclude refreshed listings from weekly targets

**Date:** 2026-03-18
**Branch:** `fix/exclude-refreshes-from-weekly-targets`

## Problem

The "eBay Listed Value" weekly target on the workflow dashboard was showing £919 instead of £202. The 90-day listing refresh cron (`/api/cron/ebay-listing-refresh`) ends old eBay listings and recreates them, resetting `listing_date` to today. The metrics query summed all items with this week's `listing_date`, treating refreshed items identically to genuinely new listings.

- 41 refreshed items = £717.09 (false positive)
- 8 genuinely new listings = £201.92 (real value)

## Root Cause

`listing_date` is overwritten on refresh (needed for inventory aging), but the metrics query had no way to distinguish refreshes from new listings.

## Fix

1. Added `is_refresh BOOLEAN NOT NULL DEFAULT false` column to `inventory_items`
2. Set `is_refresh: true` in the refresh cron route and resume route when updating inventory
3. Added `.eq('is_refresh', false)` filter to all listing value queries in `/api/workflow/metrics`
4. Backfilled existing refresh items via SQL join on `ebay_listing_refresh_items`

## Files Changed

| File | Change |
|------|--------|
| `supabase/migrations/20260318000001_add_is_refresh_to_inventory.sql` | Add column + backfill |
| `apps/web/src/app/api/cron/ebay-listing-refresh/route.ts` | Set `is_refresh: true` on inventory update |
| `apps/web/src/app/api/cron/ebay-listing-refresh/resume/route.ts` | Set `is_refresh: true` on resume |
| `apps/web/src/app/api/workflow/metrics/route.ts` | Filter out refreshes from all listing value queries |
| `apps/web/src/hooks/__tests__/use-inventory.test.tsx` | Add `is_refresh` to test mocks |
| `packages/database/src/types.ts` | Regenerated from schema |
