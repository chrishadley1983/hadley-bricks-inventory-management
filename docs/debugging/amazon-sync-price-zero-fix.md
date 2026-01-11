# Amazon Sync Price=0 Issue - RESOLVED

## Problem Statement

When submitting a listing to Amazon where:
- The ASIN exists in Amazon's catalog
- The user has never listed against that ASIN (no existing SKU)

The listing was created successfully with correct quantity, but the **price was set to 0**.

**Test ASIN**: `B0BYZHTMVW`

---

## SOLUTION (January 2026)

### Root Cause

The `audience: "ALL"` field in the `purchasable_offer` attribute was causing Amazon to silently fail to apply the price.

### Fix Applied

1. **Remove `audience` field** from `purchasable_offer` - this was the key fix
2. **Add `list_price` attribute** - required for UK marketplace since mid-2024
3. **Add staged verification** - Amazon takes up to 30 minutes to apply price

### Working Payload Structure

```json
{
  "purchasable_offer": [{
    "marketplace_id": "A1F83G8C2ARO7P",
    "currency": "GBP",
    "our_price": [{
      "schedule": [{
        "value_with_tax": 15
      }]
    }]
  }],
  "list_price": [{
    "marketplace_id": "A1F83G8C2ARO7P",
    "currency": "GBP",
    "value_with_tax": 15
  }]
}
```

**Note**: NO `audience: "ALL"` field!

### Files Modified

| File | Change |
|------|--------|
| `amazon-sync.config.ts` | Added variation system, default to `no_audience` |
| `amazon-sync.service.ts` | Added `list_price`, verification flow |
| `amazon-sync.types.ts` | Added verification status types |
| `20260111074100_amazon_feed_price_verification.sql` | Added verification tracking columns |

### New Feed Status Flow

For new SKUs:
```
pending → submitted → processing → done_verifying → verified
                                               ↘ verification_failed
```

For existing SKUs (PATCH updates):
```
pending → submitted → processing → done
```

---

## SP-API Research Findings

### Official Amazon Documentation Analysis

Based on comprehensive research of Amazon SP-API documentation:

#### 1. `value_with_tax` Data Type
- **Official recommendation**: Numeric values (e.g., `50.00`, `15.00`)
- Documentation consistently uses numbers, not strings
- **Conclusion**: Numeric implementation is CORRECT

#### 2. `start_at` in Schedule
- **OPTIONAL** for regular pricing (`our_price`)
- Only used for promotional/sale pricing
- **Conclusion**: NOT required

#### 3. `audience` Field - THE BUG!
- `"ALL"` = Standard B2C offers (Sell on Amazon)
- Despite documentation saying it's valid, **including it causes price=0 on new SKUs**
- **Conclusion**: DO NOT INCLUDE for new SKU creation

#### 4. `list_price` Attribute
- **REQUIRED** for UK marketplace since mid-2024
- Must include `value_with_tax` and `currency`
- **Conclusion**: Always include for UK offers

### Key Documentation Sources

1. [Listings Items API](https://developer-docs.amazon.com/sp-api/docs/listings-items-api)
2. [Building Listings Management Workflows](https://developer-docs.amazon.com/sp-api/docs/building-listings-management-workflows-guide)
3. [GitHub Issue #3958](https://github.com/amzn/selling-partner-api-models/issues/3958) - list_price requirement
4. [GitHub Issue #2785](https://github.com/amzn/selling-partner-api-models/issues/2785) - price acceptance issues

---

## Investigation Timeline

### Phase 1: Initial Research
- Reviewed Amazon SP-API documentation
- Analyzed existing feed submissions in database
- Found that `LISTING_OFFER_ONLY` requirements was correct

### Phase 2: Database Analysis
| Feed ID | ASIN | Requirements | list_price | Result |
|---------|------|--------------|------------|--------|
| 52704020463 | B0BYZHTMVW | `LISTING` | Yes | ERROR |
| 52703020463 | B0BRMQMPMY | `LISTING_OFFER_ONLY` | Yes | price=0 |

### Phase 3: GitHub Research
- Found issue #3958 about `list_price` requirement
- Found issue #2785 about prices being "ACCEPTED" but not applied

### Phase 4: Testing Variations
Created variation system to test different payload structures:

| Variation | `audience` | Result |
|-----------|------------|--------|
| `baseline` | `"ALL"` | price=0 |
| `no_audience` | (omitted) | **WORKS!** |

### Phase 5: Verification Flow
- Discovered Amazon takes up to 30 minutes to apply price
- Added staged verification system:
  - `done_verifying` status for feeds with new SKUs
  - API endpoint to verify prices on Amazon
  - 30-minute timeout before marking as failed

---

## Testing

### Manual Test
1. Add item with ASIN to sync queue
2. Submit feed
3. Verify status shows `done_verifying`
4. Wait 5-30 minutes
5. Call verify endpoint or check Seller Central
6. Verify price shows correct amount

### E2E Test Files
- `tests/e2e/amazon-sync/amazon-sync-new-sku.spec.ts`
- `tests/e2e/amazon-sync/helpers/amazon-sync.helpers.ts`

### Environment Variables for Testing
```powershell
# Test different variations
$env:AMAZON_PRICE_VARIATION="baseline"  # BROKEN
$env:AMAZON_PRICE_VARIATION="no_audience"  # WORKING (default)
```

---

## Lessons Learned

1. **Amazon's documentation is incomplete** - The `audience` field issue is not documented
2. **"ACCEPTED" doesn't mean "APPLIED"** - Always verify actual state
3. **UK marketplace has special requirements** - `list_price` is mandatory
4. **Price application is asynchronous** - Can take up to 30 minutes
5. **Keep variation system** - Useful for debugging future issues

---

*Last Updated: January 2026*
*Status: RESOLVED*
