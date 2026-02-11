# Fix Report: Inventory API Listing Optimiser

**Date:** 2026-01-28
**Branch:** `fix/inventory-api-listing-optimiser`
**Author:** Claude Opus 4.5

## Issue

When attempting to optimise a listing created via the eBay Listing Assistant (which uses the Inventory API), the optimiser failed with the error:

> "Failed to Apply Change - Inventory-based listing management is not currently supported by this tool. Please refer to the tool used to create this listing."

## Root Cause

The listing creation feature uses the **eBay Inventory API** (`createOrReplaceInventoryItem` + `createOffer` + `publishOffer`) to create listings. However, the listing optimiser was using the **Trading API** (`ReviseFixedPriceItem`) to apply changes.

According to eBay's API documentation, listings created via the Inventory API are "inventory-based" and cannot be modified using the Trading API's `ReviseFixedPriceItem` call. Instead, changes must be made through the Inventory API by updating the inventory item or offer.

## Solution

Modified `listing-optimiser.service.ts` to:

1. **Detect inventory-based listings**: Catch the specific "inventory-based" error message from the Trading API
2. **Fallback to Inventory API**: When detected, automatically route changes through the Inventory API:
   - Get the SKU from the listing via `getItem`
   - Fetch the current inventory item via `getInventoryItem`
   - Apply the requested changes to the inventory item
   - Update via `createOrReplaceInventoryItem`

### Mapping of Changes

| Suggestion Type | Trading API | Inventory API |
|-----------------|-------------|---------------|
| Title | `request.title` | `item.product.title` |
| Description | `request.description` | `item.product.description` |
| Item Specifics | `request.itemSpecifics` | `item.product.aspects` |
| Condition Description | `request.conditionDescription` | `item.conditionDescription` |
| Condition | `request.conditionId` | `item.condition` (enum) |

## Files Changed

- `apps/web/src/lib/ebay/listing-optimiser.service.ts` (+147 lines)

## Testing Notes

To test this fix:
1. Create a new listing using the eBay Listing Assistant (Inventory API path)
2. Navigate to the Listing Optimiser
3. Select the listing and run analysis
4. Approve any suggested change (title, description, item specifics, etc.)
5. Verify the change is applied successfully via the Inventory API fallback
6. Check that changes appear on eBay (may take a few minutes to propagate)

## Additional Notes

- The fix returns a warning message when using the Inventory API: "Changes may take a few minutes to appear on eBay"
- If the listing doesn't have a SKU (rare edge case), the fix returns a helpful error message directing users to update via eBay directly
- Existing listings created via other methods (Trading API, eBay direct) continue to use the existing `ReviseFixedPriceItem` path
