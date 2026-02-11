# Merge Report: fix/purchase-inventory-skill-fields

**Date:** 2026-01-29
**Track:** FIX
**PR:** #54
**Status:** ✅ MERGED

## Summary

Fixed the purchase-inventory skill to correctly populate Listing Value and Storage Location fields when creating inventory items.

## Changes

| File | Changes |
|------|---------|
| `.claude/commands/purchase-inventory.md` | +6 / -2 |

### Details

- Changed `location` to `storage_location` (correct database field name)
- Added `listing_value` field to API payload (rounded buy box price)
- Updated review table to show both fields
- Added step 7 documenting that rounded buy box price should be stored as `listing_value`

## Verification

| Check | Status |
|-------|--------|
| Lint | ✅ Pass |
| Code Review | ✅ Approved |
| PR Checks | ✅ Pass |
| Merge | ✅ Squash merged |

## Commits

- `26b5911` fix: correct field names in purchase-inventory skill

## Branch Cleanup

- [x] Local branch deleted
- [x] Remote branch deleted

## Post-Merge

The fix is now live. Next time `/purchase-inventory` is used with Amazon platform and "Proportional by listing value" cost allocation, both `listing_value` and `storage_location` will be populated correctly.
