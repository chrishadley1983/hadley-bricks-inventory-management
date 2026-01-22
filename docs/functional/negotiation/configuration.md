# Journey: Configuration

> **Entry Point:** `/orders` (Offers tab → Settings)
> **Prerequisites:** None
> **Complexity:** Medium

## Purpose

Configure the negotiation engine to match your business strategy. Adjust scoring weights, set discount rules, customise offer messages, and control re-offer behaviour.

---

## Key Concepts

### Configuration Sections

| Section | Purpose |
|---------|---------|
| **General** | Automation toggle, timing settings |
| **Scoring Weights** | How factors influence the score |
| **Discount Rules** | Score-to-discount mapping |
| **Message Template** | Customise offer text |

### Weights vs Rules

- **Weights** determine the score (0-100)
- **Rules** map scores to discount percentages

---

## User Flow

### Step 1: Open Settings

1. Navigate to `/orders`
2. Click **Offers** tab
3. Click **Settings** button

### Step 2: General Settings

**Automation:**
- Toggle on/off for scheduled offers
- When enabled, runs 4× daily

**Timing:**
- **Min Days Before Offer**: Days a listing must exist before offering (default: 14)
- **Re-Offer Cooldown**: Days to wait before re-offering declined/expired (default: 7)
- **Re-Offer Escalation**: Extra discount % on re-offers (default: 5)

### Step 3: Scoring Weights

Adjust how much each factor influences the score:

| Factor | Default | Description |
|--------|---------|-------------|
| Listing Age | 50% | Primary factor (must be ≥50%) |
| Stock Level | 15% | More stock = higher score |
| Item Value | 15% | Lower value = higher score |
| Category | 10% | Future: category-specific |
| Watchers | 10% | Fewer watchers = higher score |

**Total must equal 100%**

### Step 4: Discount Rules

Define score ranges and their discounts:

```
Score 0-39   → 10% discount
Score 40-59  → 15% discount
Score 60-79  → 20% discount
Score 80-100 → 25% discount
```

**Rules:**
- Add/edit/delete custom rules
- Ranges must not overlap
- Discount must be 10-50%
- All scores should be covered

### Step 5: Message Template

Customise the offer message buyers receive:

**Available Placeholders:**
- `{discount}` - Discount percentage (e.g., "20")
- `{title}` - Listing title
- `{price}` - Original price (e.g., "£49.99")
- `{offer_price}` - Discounted price (e.g., "£39.99")

**Example Template:**
```
Hi! We're offering you {discount}% off "{title}".
Get it for just {offer_price} instead of {price}.
This exclusive offer expires in 4 days!
```

### Step 6: Save Changes

1. Review all settings
2. Click **Save** button
3. Settings applied immediately
4. Next offer batch uses new config

---

## Scoring Weights Detail

### Listing Age (Primary)

Must be at least 50% of total weight.

**Why Primary?**
- Older listings need discounting to move
- Core strategy: liquidate ageing stock
- New listings should sell at full price

**Score Calculation:**
- 0 days = 0 points
- 30 days = 33 points
- 60 days = 67 points
- 90+ days = 100 points

### Stock Level

Higher stock creates urgency to clear.

**Score Calculation:**
- 1 item = 20 points
- 2-3 items = 50 points
- 4-5 items = 70 points
- 6+ items = 100 points

### Item Value

Protect margins on high-value items.

**Score Calculation:**
- ≥£100 = 20 points (conservative)
- £50-99 = 40 points
- £25-49 = 60 points
- <£25 = 80 points (aggressive OK)

### Watchers

Fewer watchers = needs bigger push.

**Score Calculation:**
- 10+ watchers = 20 points (high interest)
- 5-9 watchers = 40 points
- 2-4 watchers = 60 points
- 0-1 watchers = 80 points

---

## Discount Rules Management

### Add a Rule

1. Click **Add Rule** button
2. Enter min score (0-100)
3. Enter max score (0-100)
4. Enter discount percentage (10-50)
5. Click **Save**

### Edit a Rule

1. Click edit icon on rule row
2. Modify values
3. Click **Save**

### Delete a Rule

1. Click delete icon on rule row
2. Confirm deletion
3. Fallback to default if no rules

### Validation

System prevents:
- Overlapping score ranges
- Discount below 10% or above 50%
- min > max in range
- Scores outside 0-100

---

## Example Configurations

### Conservative (Protect Margins)

```
Weights:
- Listing Age: 60%
- Stock Level: 15%
- Item Value: 15%
- Watchers: 10%

Rules:
- 0-49: 10%
- 50-74: 12%
- 75-89: 15%
- 90-100: 20%
```

### Aggressive (Clear Stock)

```
Weights:
- Listing Age: 50%
- Stock Level: 25%
- Item Value: 10%
- Watchers: 15%

Rules:
- 0-29: 15%
- 30-49: 20%
- 50-69: 30%
- 70-100: 40%
```

### Balanced (Default)

```
Weights:
- Listing Age: 50%
- Stock Level: 15%
- Item Value: 15%
- Category: 10%
- Watchers: 10%

Rules:
- 0-39: 10%
- 40-59: 15%
- 60-79: 20%
- 80-100: 25%
```

---

## API Reference

### GET /api/negotiation/config

Get current configuration.

### PATCH /api/negotiation/config

Update configuration.

**Request:**
```json
{
  "automationEnabled": true,
  "minDaysBeforeOffer": 14,
  "reOfferCooldownDays": 7,
  "reOfferEscalationPercent": 5,
  "weightListingAge": 50,
  "weightStockLevel": 15,
  "weightItemValue": 15,
  "weightCategory": 10,
  "weightWatchers": 10,
  "offerMessageTemplate": "Thank you for..."
}
```

### GET /api/negotiation/rules

Get discount rules.

### POST /api/negotiation/rules

Create rule.

### PUT /api/negotiation/rules/[id]

Update rule.

### DELETE /api/negotiation/rules/[id]

Delete rule.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Weights don't sum to 100 | Adjust sliders; system may auto-normalise |
| Rule overlap error | Ensure max of one rule < min of next |
| Discounts too small | Check rules; minimum is 10% |
| Changes not applying | Click Save; check for validation errors |

---

## Source Files

| File | Purpose |
|------|---------|
| [ConfigModal.tsx](../../../apps/web/src/components/features/negotiation/ConfigModal.tsx) | Settings dialog |
| [DiscountRulesEditor.tsx](../../../apps/web/src/components/features/negotiation/DiscountRulesEditor.tsx) | Rule management UI |
| [negotiation-scoring.service.ts](../../../apps/web/src/lib/ebay/negotiation-scoring.service.ts) | Weight calculations |
| [config/route.ts](../../../apps/web/src/app/api/negotiation/config/route.ts) | Config API |
| [rules/route.ts](../../../apps/web/src/app/api/negotiation/rules/route.ts) | Rules API |

---

## Related Journeys

- [Manual Offers](./manual-offers.md) - See configuration in action
- [Automation](./automation.md) - Enable scheduled offers
