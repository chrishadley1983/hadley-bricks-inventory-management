# Fix: eBay Refresh ItemID Type Mismatch

**Date:** 2026-03-18
**Branch:** `fix/ebay-refresh-itemid-type-mismatch`

## Problem

The automated eBay listing refresh cron produced 0 price reductions across all runs since launch (March 17). All 40+ items showed `UNKNOWN` tier, 0 views, 0 watchers, 0d age in the email report.

## Root Cause

`fast-xml-parser` defaults `parseTagValue: true`, which converts numeric-looking XML text to JavaScript numbers. eBay's `ItemID` (e.g. `"177670564916"`) was parsed as the **number** `177670564916` instead of a string.

The `enrichedMap` stored number keys, but after round-tripping through the PostgreSQL TEXT column `original_item_id`, the lookup used string keys. `Map.get("177670564916")` never matched `Map.get(177670564916)` because Map uses strict equality.

This caused:
- Zero price reductions (enrichedMap lookup always returned undefined)
- All inventory updates skipped (same lookup failure)
- Email report showed UNKNOWN tier / 0 metrics for every item

## Fix

1. **`ebay-trading.client.ts`** — Added `parseTagValue: false` to XMLParser config so all XML text stays as strings
2. **`ebay-listing-refresh.service.ts`** — Added `String()` wrap on `platformItemId` as defence-in-depth
3. **`reprice/route.ts`** — Updated one-off reprice script with already-reduced guard (compares `listing_value` vs `original_price`) and multi-job support for retroactive repricing

## Verification

- TypeScript: pass
- Lint: pass (also cleaned up unused `delay`/`RATE_LIMIT_DELAY_MS` in route)
- All existing numeric field parsing uses `parseInt(String(...))` / `parseFloat(String(...))` — safe with the change
