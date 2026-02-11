# Fix Report: eBay Listing Image Compression

**Date:** 2026-01-28
**Branch:** `fix/ebay-listing-image-compression`
**Status:** Ready for code review

## Issue

eBay listing creation was failing with a "Failed to fetch" error when attempting to create listings with photos.

## Root Cause

Photos were being sent as full-size base64 strings directly in the JSON request body to `/api/ebay/listing`. A single phone photo (3-8MB) with base64 encoding overhead (~33%) could exceed Vercel's 4.5MB serverless function payload limit by itself. With multiple photos, the payload could easily reach 20-50MB.

## Solution

Implemented a batched image upload flow with client-side compression:

### 1. Client-Side Image Compression
**File:** `apps/web/src/lib/utils/image-compression.ts` (new)

- Resizes images to max 1600px on longest side (sufficient for eBay)
- Compresses to JPEG at 80% quality
- Uses HTML5 Canvas API (no external dependencies)
- Typical result: 100-200KB per image (vs 3-8MB original)

### 2. Batched Upload API Endpoint
**File:** `apps/web/src/app/api/ebay/upload-images/route.ts` (new)

- Accepts up to 5 images per batch
- Uploads to Supabase Storage
- Returns URLs for use in listing creation
- Validates image size (max 500KB after compression)

### 3. Updated Modal Flow
**File:** `apps/web/src/components/features/inventory/CreateEbayListingModal.tsx`

- Images compressed immediately on selection
- Shows compression stats (original vs compressed size)
- Uploads to storage before calling listing API
- Visual indicators for upload status (pending/uploading/uploaded/error)
- Progress bar during batch upload

### 4. Service Layer Updates
**Files:**
- `apps/web/src/lib/ebay/listing-creation.types.ts` - Added URL-based image type
- `apps/web/src/lib/ebay/listing-creation.service.ts` - Handles both base64 (legacy) and URL images
- `apps/web/src/app/api/ebay/listing/route.ts` - Updated validation schema

## New Data Flow

```
User selects photos
       ↓
Compress client-side (1600px, 80% JPEG)
       ↓
Display in modal with size info
       ↓
User clicks "Create Listing"
       ↓
Upload to Supabase Storage (batches of 5)
       ↓
Receive URLs
       ↓
Call /api/ebay/listing with URLs (small payload ~10KB)
       ↓
Listing created successfully
```

## Files Changed

| File | Changes |
|------|---------|
| `apps/web/src/lib/utils/image-compression.ts` | New - compression utility |
| `apps/web/src/app/api/ebay/upload-images/route.ts` | New - batch upload endpoint |
| `apps/web/src/components/features/inventory/CreateEbayListingModal.tsx` | Updated - new upload flow |
| `apps/web/src/lib/ebay/listing-creation.types.ts` | Updated - URL image type |
| `apps/web/src/lib/ebay/listing-creation.service.ts` | Updated - handle URL images |
| `apps/web/src/app/api/ebay/listing/route.ts` | Updated - validation schema |

**Total:** 6 files, ~720 lines added/changed

## Verification

- [x] TypeScript compiles without errors
- [x] ESLint passes (only pre-existing warnings)
- [x] Production build succeeds
- [ ] Manual testing in browser (pending deployment)

## Testing Notes

To test the fix:
1. Navigate to any inventory item
2. Click "Create eBay Listing"
3. Upload multiple large photos (e.g., from phone camera)
4. Observe compression stats and upload progress
5. Submit listing - should succeed without "Failed to fetch" error

## Rollback Plan

If issues arise, revert the commit. The legacy base64 flow is still supported by the service layer - only the modal was changed to use the new upload flow.
