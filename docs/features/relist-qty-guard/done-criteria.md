# Done Criteria: relist-qty-guard

**Created:** 2026-03-19
**Author:** Define Done Agent + Chris
**Status:** APPROVED

## Feature Summary

Prevent the eBay listing refresh from automatically relisting items with quantity > 1. Instead, these items are skipped during the automated refresh and pushed to a manual review queue. A Discord alert (and optionally email) notifies Chris so he can review and adjust quantities before relisting. This avoids the class of bugs where cross-platform sales (BrickLink, Bricqer) reduce real stock but eBay's quantitySold doesn't reflect it.

## Success Criteria

### Functional

#### F1: Qty > 1 items excluded entirely from refresh cycle
- **Tag:** AUTO_VERIFY
- **Criterion:** The listing refresh excludes items with quantity > 1 from the eligible listings list — they are NOT fetched, NOT ended, NOT recreated. The filter applies in `getEligibleListings()` so multi-qty items never enter the refresh pipeline at all. This uses the quantity from the platform_listings import (same source as the existing `hasVariations` filter).
- **Evidence:** Items with quantity > 1 are filtered out before the refresh job is created, appearing as skipped in the job record
- **Test:** Read `getEligibleListings`; verify a quantity > 1 filter exists alongside the existing `hasVariations` filter

#### F2: Skipped items recorded in refresh job
- **Tag:** AUTO_VERIFY
- **Criterion:** When a qty > 1 item is skipped, the `ebay_listing_refresh_items` row is updated with `status = 'skipped'` and a skip reason indicating `quantity_review_required`
- **Evidence:** Query `ebay_listing_refresh_items` for items with `status = 'skipped'` and reason containing quantity
- **Test:** After a refresh run with qty > 1 items eligible, verify skipped rows exist with correct reason

#### F3: Discord alert sent for skipped qty > 1 items
- **Tag:** AUTO_VERIFY
- **Criterion:** When one or more items are skipped due to qty > 1, a Discord message is sent to the `#alerts` channel listing each skipped item with title, SKU, current quantity, and quantity sold
- **Evidence:** `DiscordService.sendAlert()` called with embed containing skipped item details
- **Test:** Grep cron route for Discord send call; verify embed fields include item title, SKU, quantity, quantitySold

#### F4: Resume route applies same qty > 1 guard
- **Tag:** AUTO_VERIFY
- **Criterion:** The resume route (`/api/cron/ebay-listing-refresh/resume`) also skips items with effective qty > 1 rather than recreating them
- **Evidence:** Resume route contains the same qty > 1 check before `addFixedPriceItem`
- **Test:** Read resume route; verify qty > 1 guard exists before listing creation

#### F5: Qty = 1 items continue to relist automatically
- **Tag:** AUTO_VERIFY
- **Criterion:** Items with quantity = 1 (and quantitySold = 0) continue through the refresh process unchanged — fetch, end, create as before
- **Evidence:** The existing refresh flow for qty = 1 items is not affected by the guard
- **Test:** Verify the guard condition only triggers for qty > 1; qty = 1 items pass through

#### F6: Manual quantity override still works
- **Tag:** AUTO_VERIFY
- **Criterion:** If a user has set `modifiedQuantity` (via the RefreshItemEditModal), that value is respected regardless of the original quantity — the guard only applies to unmodified items
- **Evidence:** `item.modifiedQuantity` check takes precedence over the qty > 1 guard
- **Test:** Read the quantity determination logic; verify modifiedQuantity bypasses the guard

### Error Handling

#### E1: Discord send failure does not block refresh
- **Tag:** AUTO_VERIFY
- **Criterion:** If the Discord notification fails to send, the refresh job continues processing remaining items (the alert is best-effort, not blocking)
- **Evidence:** Discord send is wrapped in try/catch; errors are logged but do not throw
- **Test:** Verify Discord call is in a try/catch block that does not re-throw

#### E2: Zero qty > 1 items sends no alert
- **Tag:** AUTO_VERIFY
- **Criterion:** If a refresh run has no qty > 1 items to skip, no Discord alert is sent (no empty/noise alerts)
- **Evidence:** Discord send is conditional on skipped-for-qty count > 0
- **Test:** Verify the alert is inside a conditional checking skipped count

### Integration

#### I1: Existing refresh metrics unaffected
- **Tag:** AUTO_VERIFY
- **Criterion:** The refresh job completion record (`ebay_listing_refreshes`) still correctly reports `skipped_count`, `created_count`, `ended_count`, and `failed_count` — with qty > 1 items counted in `skipped_count`
- **Evidence:** Job summary counts are accurate including the newly skipped items
- **Test:** Verify skippedCount is incremented for qty > 1 items

#### I2: TypeScript compiles without errors
- **Tag:** AUTO_VERIFY
- **Criterion:** `npm run typecheck` passes with zero errors after changes
- **Evidence:** Clean typecheck output
- **Test:** Run `npm run typecheck`

## Out of Scope

- Fixing the train track variation loss on relist (separate issue — `hasVariations` not stored during import)
- Building a dedicated UI review queue page for qty > 1 items (the existing RefreshTab + Discord alert is sufficient for now)
- Real-time stock sync between platforms
- Changes to the minifig sync process (`HB-MF-` SKU system is separate)
- Automatically calculating correct cross-platform quantity (this is what we're deliberately avoiding)
- Email notification (Discord #alerts is the primary channel; email can be added later if needed)

## Dependencies

- Discord webhook configured (`DISCORD_WEBHOOK_ALERTS` env var)
- `DiscordService` class available at `@/lib/notifications/discord.service`
- PR #319 merged (the `quantity - quantitySold` fix for the eBay-only case)

## Iteration Budget

- **Max iterations:** 3
- **Escalation:** This is a small, focused change — if not converged after 3 iterations, scope is wrong
