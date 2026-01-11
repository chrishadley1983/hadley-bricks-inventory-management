# Amazon Sync Price Fix - Test Results Log

## Test Configuration

- **Test Item Set Number**: `_______` (Find item with ASIN B0BYZHTMVW in inventory)
- **Test Item ASIN**: `B0BYZHTMVW`
- **Expected Price**: GBP _______
- **Test Environment**: Development (localhost:3000)
- **Test Start Date**: ________________

---

## Pre-Test Checklist

- [ ] Dev server running (`npm run dev`)
- [ ] Auth state saved (run `npx playwright test auth.setup --project=setup` if needed)
- [ ] Test item exists in inventory with:
  - [ ] Amazon ASIN assigned
  - [ ] No existing Amazon SKU for your account
  - [ ] `listing_value` > 0
- [ ] Test results directory exists (`test-results/amazon-sync/`)

---

## Baseline Test (Current Implementation)

**Date Tested**: ________________
**Variation**: `baseline`

### Payload Captured

```json
{
  "purchasable_offer": [
    {
      "marketplace_id": "A1F83G8C2ARO7P",
      "audience": "ALL",
      "currency": "GBP",
      "our_price": [
        {
          "schedule": [
            {
              "value_with_tax": <NUMBER or STRING?>
            }
          ]
        }
      ]
    }
  ]
}
```

### Results

| Test | Result | Notes |
|------|--------|-------|
| Dry Run | PASS / FAIL | |
| Validation Errors | | |
| Live Submit | PASS / FAIL | |
| Price on Amazon | GBP _____ | |

**Screenshots**: `test-results/amazon-sync/baseline-*.png`

---

## Variation A: String Price (`string_price`)

**Date Tested**: ________________

### Configuration

```
$env:AMAZON_PRICE_VARIATION="string_price"
```

### Expected Payload Change

```json
"value_with_tax": "15.00"  // String instead of number
```

### Results

| Test | Result | Notes |
|------|--------|-------|
| Dry Run | PASS / FAIL | |
| Validation Errors | | |
| Live Submit | PASS / FAIL | |
| Price on Amazon | GBP _____ | |

---

## Variation B: With start_at (`with_start_at`)

**Date Tested**: ________________

### Configuration

```
$env:AMAZON_PRICE_VARIATION="with_start_at"
```

### Expected Payload Change

```json
"schedule": [
  {
    "value_with_tax": 15.00,
    "start_at": "2025-01-10T00:00:00.000Z"
  }
]
```

### Results

| Test | Result | Notes |
|------|--------|-------|
| Dry Run | PASS / FAIL | |
| Validation Errors | | |
| Live Submit | PASS / FAIL | |
| Price on Amazon | GBP _____ | |

---

## Variation C: No Audience (`no_audience`)

**Date Tested**: ________________

### Configuration

```
$env:AMAZON_PRICE_VARIATION="no_audience"
```

### Expected Payload Change

```json
"purchasable_offer": [
  {
    "marketplace_id": "A1F83G8C2ARO7P",
    // "audience": "ALL" removed
    "currency": "GBP",
    ...
  }
]
```

### Results

| Test | Result | Notes |
|------|--------|-------|
| Dry Run | PASS / FAIL | |
| Validation Errors | | |
| Live Submit | PASS / FAIL | |
| Price on Amazon | GBP _____ | |

---

## Variation D: With offer_type (`with_offer_type`)

**Date Tested**: ________________

### Configuration

```
$env:AMAZON_PRICE_VARIATION="with_offer_type"
```

### Expected Payload Change

```json
"purchasable_offer": [
  {
    "offer_type": "B2C",  // Added
    "marketplace_id": "A1F83G8C2ARO7P",
    "audience": "ALL",
    "currency": "GBP",
    ...
  }
]
```

### Results

| Test | Result | Notes |
|------|--------|-------|
| Dry Run | PASS / FAIL | |
| Validation Errors | | |
| Live Submit | PASS / FAIL | |
| Price on Amazon | GBP _____ | |

---

## Variation E: Combined No Audience (`combined_no_audience`)

**Date Tested**: ________________

### Configuration

```
$env:AMAZON_PRICE_VARIATION="combined_no_audience"
```

### Expected Payload Change

```json
"purchasable_offer": [
  {
    "marketplace_id": "A1F83G8C2ARO7P",
    // No audience field
    "currency": "GBP",
    "our_price": [
      {
        "schedule": [
          {
            "value_with_tax": "15.00",  // String
            "start_at": "2025-01-10T00:00:00.000Z"  // Added
          }
        ]
      }
    ]
  }
]
```

### Results

| Test | Result | Notes |
|------|--------|-------|
| Dry Run | PASS / FAIL | |
| Validation Errors | | |
| Live Submit | PASS / FAIL | |
| Price on Amazon | GBP _____ | |

---

## Variation F: Combined With offer_type (`combined_with_offer_type`)

**Date Tested**: ________________

### Configuration

```
$env:AMAZON_PRICE_VARIATION="combined_with_offer_type"
```

### Expected Payload Change

```json
"purchasable_offer": [
  {
    "offer_type": "B2C",  // Added
    "marketplace_id": "A1F83G8C2ARO7P",
    // No audience field
    "currency": "GBP",
    "our_price": [
      {
        "schedule": [
          {
            "value_with_tax": "15.00",  // String
            "start_at": "2025-01-10T00:00:00.000Z"  // Added
          }
        ]
      }
    ]
  }
]
```

### Results

| Test | Result | Notes |
|------|--------|-------|
| Dry Run | PASS / FAIL | |
| Validation Errors | | |
| Live Submit | PASS / FAIL | |
| Price on Amazon | GBP _____ | |

---

## Summary

### Winning Variation

**Variation**: ________________

**Key Changes Required**:
1. ________________
2. ________________
3. ________________

### Additional Findings

________________

### Next Steps

1. [ ] Implement permanent fix in `amazon-sync.service.ts`
2. [ ] Update `buildPatches()` method as well
3. [ ] Test with multiple items
4. [ ] Verify existing SKU updates still work
5. [ ] Remove variation toggle code

---

## Commands Quick Reference

```powershell
# Run baseline test
npx playwright test amazon-sync-new-sku --headed

# Test specific variation
$env:AMAZON_PRICE_VARIATION="string_price"
npx playwright test amazon-sync-new-sku --headed

# Enable live testing
$env:AMAZON_LIVE_TEST="true"
$env:AMAZON_PRICE_VARIATION="combined_no_audience"
npx playwright test amazon-sync-new-sku --headed

# Reset auth
npx playwright test auth.setup --project=setup

# View test report
npx playwright show-report
```

---

## Test Execution Log

### Run 1
- **Date/Time**:
- **Variation**:
- **Result**:
- **Notes**:

### Run 2
- **Date/Time**:
- **Variation**:
- **Result**:
- **Notes**:

### Run 3
- **Date/Time**:
- **Variation**:
- **Result**:
- **Notes**:

(Add more as needed)
