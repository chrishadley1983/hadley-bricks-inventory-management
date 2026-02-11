# Investigation: eBay Inventory API "Invalid value for header Accept-Language" Error

**Date:** 2026-01-28
**Status:** RESOLVED
**Affected Feature:** Listing Optimiser - Inventory API updates
**Root Cause:** eBay Inventory API bug (errorId 25709) - EBAY_GB marketplace rejects `en-GB` Accept-Language but accepts `en-US`
**Fix:** Use `Accept-Language: en-US` header for all Inventory API requests

---

## Problem Description

When applying optimization suggestions to eBay listings that were created via the eBay Listing Assistant (which uses the Inventory API), the system encounters the following error:

```
Inventory API error: Invalid value for header Accept-Language.
```

This error occurs when calling the `createOrReplaceInventoryItem` endpoint to update an existing inventory item.

### Context

- Listings created via the Trading API can be modified via `ReviseFixedPriceItem` - this works fine
- Listings created via the Inventory API CANNOT be modified via the Trading API
- When the Trading API fails with "Inventory-based listing management is not currently supported", we fall back to the Inventory API
- The Inventory API fallback is where this error occurs

---

## Solution

### Root Cause

eBay has a bug where the EBAY_GB marketplace rejects `en-GB` in the Accept-Language header (and also fails when no header is sent), but accepts `en-US`.

### Fix Applied

Updated all Inventory API methods in `apps/web/src/lib/ebay/ebay-api.adapter.ts` to use `Accept-Language: en-US`:

```typescript
// CORRECT - Works for EBAY_GB marketplace
headers: {
  'Content-Language': 'en-GB',
  'Accept-Language': 'en-US',  // Must use en-US, NOT en-GB
}

// INCORRECT - Fails with errorId 25709
headers: {
  'Content-Language': 'en-GB',
  'Accept-Language': 'en-GB',  // eBay rejects this
}

// INCORRECT - Also fails (eBay defaults to invalid value)
headers: {
  'Content-Language': 'en-GB',
  // No Accept-Language header - eBay infers invalid default
}
```

### Methods Updated

| Method | File |
|--------|------|
| `getInventoryItem` | ebay-api.adapter.ts |
| `createOrReplaceInventoryItem` | ebay-api.adapter.ts |
| `createOffer` | ebay-api.adapter.ts |
| `updateOffer` | ebay-api.adapter.ts |
| `publishOffer` | ebay-api.adapter.ts |
| `withdrawOffer` | ebay-api.adapter.ts |
| `getInventoryLocations` | ebay-api.adapter.ts |
| `createInventoryLocation` | ebay-api.adapter.ts |

---

## Test Scenario

**Test Listing:**
- Set: 6780 (LEGO Space Classic XT Starship)
- Item ID: 177815885004
- Created via: eBay Listing Assistant (Inventory API)

**Debug Endpoint Test Results:**

```bash
# FAILS - No Accept-Language header
/api/debug/inventory-item?itemId=177815885004
# Result: 400 Bad Request - "Invalid value for header Accept-Language"

# FAILS - Accept-Language: en-GB
/api/debug/inventory-item?itemId=177815885004&acceptLang=en-GB
# Result: 400 Bad Request - "Invalid value for header Accept-Language"

# SUCCESS - Accept-Language: en-US
/api/debug/inventory-item?itemId=177815885004&acceptLang=en-US
# Result: 200 OK - Full inventory item returned
```

---

## Investigation Timeline

### Attempted Fixes (All Failed Before Solution Found)

| PR | Hypothesis | Change | Result |
|----|------------|--------|--------|
| #30 | Accept-Language header causing error | Removed header | FAILED |
| #33 | Read-only fields being rejected | Strip read-only fields | FAILED |
| #34 | Deep nested read-only fields present | Reconstruct all objects | FAILED |
| #35 | Extra fields cause issues | Use minimal fields | FAILED |
| #36 | eBay requires Accept-Language | Added `en-GB` header | FAILED |
| #37 | eBay expects locale in body | Added `locale: 'en_GB'` | FAILED |
| #38 | locale is read-only field | Removed locale field | FAILED |
| #39 | Base request method adding headers | More thorough header removal | FAILED |

### Key Discovery

Testing different Accept-Language values revealed that `en-US` works while `en-GB` and no header both fail. This is an eBay API bug specific to the EBAY_GB marketplace.

---

## API Debug Endpoint

A debug endpoint was created for testing: `/api/debug/inventory-item`

**Usage:**
- GET test: `/api/debug/inventory-item?itemId=177815885004`
- PUT test: `/api/debug/inventory-item?itemId=177815885004&testPut=true`
- BULK test: `/api/debug/inventory-item?itemId=177815885004&testBulk=true`
- List all: `/api/debug/inventory-item?itemId=177815885004&listAll=true`
- Accept-Language test: `/api/debug/inventory-item?itemId=177815885004&acceptLang=en-US`

---

## Files Modified

| File | Description |
|------|-------------|
| `apps/web/src/lib/ebay/ebay-api.adapter.ts` | Changed all Inventory API methods to use `Accept-Language: en-US` |
| `apps/web/src/app/api/debug/inventory-item/route.ts` | Debug endpoint for testing API calls |

---

## Lessons Learned

1. **Error messages can be misleading** - "Invalid value for header Accept-Language" suggests the value is wrong, not that the API has a bug with specific values
2. **Test with explicit header values** - Don't assume omitting a header means eBay won't use one internally
3. **Marketplace-specific bugs exist** - What works for EBAY_US might not work for EBAY_GB
4. **Raw fetch testing is essential** - Framework abstractions can mask the actual API behavior
5. **Document interim workarounds** - The debug endpoint proved invaluable for rapid iteration

---

*Last Updated: 2026-01-28*
*Status: RESOLVED - Fix applied to ebay-api.adapter.ts*
