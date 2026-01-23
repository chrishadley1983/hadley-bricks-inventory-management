# Merge Report: Vinted Import & Improvements

**Date:** 2026-01-22
**Commit:** acae65f
**Mode:** Direct commit to main (no feature branch)
**Files Changed:** 47
**Lines Added:** ~3,565
**Lines Removed:** ~123

---

## Summary

This commit adds a comprehensive Vinted purchase import feature with AI-powered screenshot parsing, plus various improvements and bug fixes across the inventory management system.

---

## New Features

### Vinted Screenshot Import
Multi-step modal workflow for importing Vinted purchases:
- **AI Screenshot Parsing**: Uses Claude to extract purchase details from Vinted screenshots
- **Monzo Transaction Matching**: Automatically matches extracted purchases to Monzo transactions for accurate dates
- **Duplicate Detection**: Checks for exact, likely, and possible duplicates before import
- **Inventory Item Review**: Configure set numbers, conditions, and pricing before import
- **Batch Import**: Creates purchases and inventory items efficiently with batch database operations

**New Files:**
- `apps/web/src/app/api/purchases/parse-vinted-screenshot/route.ts`
- `apps/web/src/app/api/purchases/import-vinted/route.ts`
- `apps/web/src/app/api/purchases/match-monzo/route.ts`
- `apps/web/src/app/api/purchases/check-duplicates/route.ts`
- `apps/web/src/components/features/purchases/VintedImportButton.tsx`
- `apps/web/src/components/features/purchases/VintedImportModal.tsx`
- `apps/web/src/components/features/purchases/VintedPurchaseReviewRow.tsx`
- `apps/web/src/components/features/purchases/VintedInventoryReviewCard.tsx`
- `apps/web/src/hooks/use-vinted-import.ts`
- `apps/web/src/lib/ai/prompts/parse-vinted-screenshot.ts`

### Editable Inventory Cells
- New `EditableCell` component for inline editing
- Status and condition columns now editable directly in the table
- Support for text, number, currency, date, and select types

**New File:**
- `apps/web/src/components/ui/editable-cell.tsx`

### UI Enhancements
- Sortable columns in scan detail dialog (set number, prices, COG%, profit)
- SellerAmp links in opportunities table for quick product research
- SellerAmp lookup in inventory review cards

---

## Improvements

### Performance
- **Batch Database Operations**: Import API now uses 2 queries instead of 2N (was causing up to 100 sequential calls)
- **useMemo Optimization**: Fixed dependency warning in ScanDetailDialog to prevent unnecessary re-renders

### Data Quality
- **ASIN Matching**: Now returns set names even when ASIN not found
- **Set Name Lookup**: Broad sweeps now fetch set names from brickset_sets
- **Partout Pricing**: Now uses actual sold prices instead of asking prices

### Amazon Sync
- Queue items cleared immediately on successful submission (not waiting for two-phase completion)
- ASIN whitespace trimming to prevent matching issues
- Listing platform now set to 'amazon' when items listed

### Order Fulfilment
- Archive location now includes original storage location (format: `SOLD-YYYYMMDD-{original_location}`)

### Code Quality
- Extracted shared `deriveInventoryStatusFromVinted` function to `lib/utils.ts`
- Added blob URL cleanup in Vinted import modal to prevent memory leaks
- Added global error banner visible across all import steps

---

## Bug Fixes

- Fixed 4 ESLint errors (unused imports in OptimiserTable, partout.service, part-price-cache.service, vinted-schedule.service.test)
- Fixed workflow service to use correct RPC function `count_all_unlinked_order_items_since`

---

## Verification Results

| Check | Status | Notes |
|-------|--------|-------|
| TypeScript | ✅ Pass | No errors |
| ESLint | ✅ Pass | 0 errors, 18 warnings (pre-existing) |
| Push | ✅ Complete | `e09d858..acae65f  main -> main` |
| Working Tree | ✅ Clean | No uncommitted changes |

---

## Other Unmerged Branches

None - all work is on main.

---

## Code Review Issues Addressed

| Issue | Severity | Resolution |
|-------|----------|------------|
| CR-001: Unused imports | Major | Removed all 4 unused imports |
| CR-002: useMemo dependency | Major | Moved rawListings inside useMemo |
| CR-003: N+1 queries | Major | Implemented batch inserts |
| CR-005: Error visibility | Major | Added global error banner |
| CR-011: Duplicate function | Minor | Extracted to shared utility |
| CR-012: Memory leak | Minor | Added blob URL cleanup |

---

## Next Steps

1. Test the Vinted import feature end-to-end with real screenshots
2. Monitor performance of batch import with large datasets
3. Consider adding progress indicators for import operations
4. Add tests for new Vinted import functionality
