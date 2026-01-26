# Fix Report: Vinted Dismiss Button Not Working

**Date:** 2026-01-24
**Branch:** `fix/vinted-dismiss-button`
**PR:** https://github.com/chrishadley1983/hadley-bricks-inventory-management/pull/6

## Issue

The dismiss (X) button on the Vinted Automation opportunities table was not working correctly. When a user dismissed an opportunity, it would reappear after the next scan.

## Root Cause

In `apps/web/src/app/api/arbitrage/vinted/automation/process/route.ts`, the upsert logic was setting `status: 'active'` for all opportunities unconditionally:

```typescript
const opportunities = viableListings.map((listing) => ({
  // ...
  status: 'active',  // Always overwrites existing status!
}));

await supabase.from('vinted_opportunities').upsert(opportunities, {
  onConflict: 'user_id,vinted_listing_id',
  ignoreDuplicates: false,  // Update if exists
});
```

This meant that when a dismissed listing appeared in a subsequent scan, the upsert would overwrite the `dismissed` status back to `active`.

## Fix

1. Query for dismissed listings before upserting
2. Filter out dismissed listings from the upsert batch
3. Skip push notifications for dismissed listings
4. Add `dismissedSkipped` count to response for visibility

```typescript
// Check for previously dismissed listings
let dismissedIds = new Set<string>();
if (viableListings.length > 0) {
  const { data: dismissedListings } = await supabase
    .from('vinted_opportunities')
    .select('vinted_listing_id')
    .eq('user_id', userId)
    .eq('status', 'dismissed')
    .in('vinted_listing_id', listingIds);

  dismissedIds = new Set(
    (dismissedListings ?? []).map((d) => d.vinted_listing_id)
  );
}

// Filter viable listings to exclude dismissed ones
const newViableListings = viableListings.filter(
  (listing) => !dismissedIds.has(listing.vintedListingId)
);
```

## Files Changed

| File | Lines Changed |
|------|---------------|
| `apps/web/src/app/api/arbitrage/vinted/automation/process/route.ts` | +33/-7 |

## Verification

- [x] TypeScript compiles (`npm run typecheck`)
- [x] ESLint passes (`npm run lint`)
- [ ] Manual test: dismiss opportunity, run scan, verify stays dismissed

## Notes

- Pre-existing test failures in `vinted-automation.test.ts` are unrelated to this fix (mock setup issues)
- The fix is isolated to the scan processing logic and doesn't affect other parts of the system
