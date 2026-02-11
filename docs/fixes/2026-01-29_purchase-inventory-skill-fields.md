# Fix Report: Purchase Inventory Skill Field Names

**Date:** 2026-01-29
**Branch:** `fix/purchase-inventory-skill-fields`
**Status:** Ready for Code Review

## Issue

When using the `/purchase-inventory` skill to create inventory items, the **Listing Value** and **Storage Location** fields were not being populated in the database.

## Root Cause

Two bugs in the purchase-inventory skill command file (`.claude/commands/purchase-inventory.md`):

1. **Wrong field name for Storage Location**: The API call example used `location` but the database field is `storage_location`
2. **Missing listing_value**: The skill calculated the rounded buy box price during cost allocation but never included it in the API payload

## Changes Made

| File | Change |
|------|--------|
| `.claude/commands/purchase-inventory.md` | Fixed `location` → `storage_location` in API payload example |
| `.claude/commands/purchase-inventory.md` | Added `listing_value` field to API payload example |
| `.claude/commands/purchase-inventory.md` | Updated review table to show `listing_value` and correct `storage_location` |
| `.claude/commands/purchase-inventory.md` | Added step 7 documenting that rounded buy box price should be stored as `listing_value` |

## Verification

- [x] Lint passes (no new warnings)
- [x] Changes are documentation-only (no runtime code affected)
- [x] Field names now match database schema (`storage_location`, `listing_value`)

## Testing

Manual testing recommended:
1. Run `/purchase-inventory` with Amazon as the listing platform
2. Use "Proportional by listing value" cost allocation
3. Verify created inventory items have both `storage_location` and `listing_value` populated

## Next Steps

Ready for `/code-review branch`
