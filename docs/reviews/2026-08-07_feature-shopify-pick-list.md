# Code Review — feature/shopify-pick-list (PR #664)

**Mode:** branch · **Date:** 2026-08-07 · **Files:** 11 changed (+1,015 / −12)

## Static Analysis

| Check | Status |
|-------|--------|
| TypeScript | ✅ No errors |
| ESLint | ✅ Clean on changed files |
| Tests | ✅ 28 pass (6 new route tests, 1 new sync regression test) |
| Migration | ✅ Applied to cloud (20260807090000) |

## Summary

| Category | Critical | Major | Minor | Nitpick |
|----------|----------|-------|-------|---------|
| Correctness | 0 | 0 | 2 | 0 |
| Security | 0 | 0 | 0 | 0 |
| Performance | 0 | 0 | 0 | 0 |
| Standards | 0 | 0 | 0 | 1 |

### Minor

**CR-001 — Tier-2 LISTED fallback doesn't check active-order commitments**
`apps/web/src/app/api/picking-list/shopify/route.ts` (tier-2 block). The LISTED-by-base-SKU
fallback can point at a unit already linked to an active Amazon/eBay order via
`order_items.inventory_item_id` (the Amazon route excludes these; this route doesn't).
Exposure is narrow: tier 2 only fires when the order sync failed to resolve the line, and
the composite-SKU fix in this same branch closes the main cause at ingestion. Follow-up,
not blocking.

**CR-002 — Orders search link assumes numeric id is searchable**
`PickingListDialog` links `/orders?search=<platform_order_id>` (numeric Shopify id).
Consistent with Amazon's behaviour; verify the orders search matches
`platform_order_id` for Shopify rows. Cosmetic if it doesn't.

### Nitpick

**CR-003 — Third copy of `naturalCompare` + PDF builder**
The Amazon/eBay/Shopify pick routes now carry three near-identical copies of the sort
helper, warning-box PDF builder and snapshot insert/cleanup block. Extract a shared
module next time a pick route is touched.

## Security checklist

- Auth via `validateAuth` (API key or session); user-scoped queries (`user_id`) ✅
- Service-role client only for the snapshot write — same pre-existing pattern as
  Amazon/eBay (public `/pick/*` pages read snapshots via the public RLS policy) ✅
- No credentials, no raw SQL, no new tables ✅

## Hadley Bricks checklist

| Check | Status |
|-------|--------|
| RLS for new tables | N/A (constraint change only) |
| Repository/service patterns | ✅ follows existing picking-list route pattern |
| Tests added | ✅ |

## Verdict

**✅ READY FOR MERGE** — no critical or major issues. CR-001/CR-003 as follow-ups.

Key win found during build: composite `"SKU | location"` variant SKUs were defeating the
order sync's inventory match (three live orders had sold stock still LISTED on Amazon —
double-sell risk). Fixed in `resolveListedItems` with regression test.
