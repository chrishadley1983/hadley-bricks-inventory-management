# Journey: Manual Offers

> **Entry Point:** `/orders` (Offers tab)
> **Prerequisites:** eBay OAuth connected, listings with watchers
> **Complexity:** Low

## Purpose

Manually select and send discount offers to interested eBay buyers. Review eligible listings, check calculated discounts, and send personalised offers for specific items.

---

## Key Concepts

### Eligible Listings

A listing is eligible for offers when:
- Listed for at least X days (configurable, default 14)
- Has interested buyers (watchers/cart adds)
- Not already at max offers limit
- Re-offer cooldown has passed (if previously offered)

### Planned Offers Table

Shows all eligible listings with:
- Selection checkbox
- Listing title and ID
- Current price
- Score (0-100)
- Calculated discount percentage
- Watcher count
- Previous offer count

---

## User Flow

### Step 1: Navigate to Offers Tab

1. Go to `/orders`
2. Click **Offers** tab
3. View eligible listings in "Planned Offers" section

### Step 2: Review Eligible Listings

For each listing you can see:
1. **Title** - Click to open on eBay
2. **Price** - Current listing price
3. **Score** - 0-100 based on factors
4. **Discount** - Calculated percentage to offer
5. **Watchers** - Number of interested buyers
6. **Previous Offers** - How many times offered before

### Step 3: Select Listings

1. Check boxes next to listings you want to offer
2. Or use "Select All" to choose all eligible
3. Selection count shows in the Send button

### Step 4: Send Offers

1. Click **Send X Offers** button
2. System sends offers via eBay API
3. Each interested buyer on selected listings receives offer
4. Toast notification shows results

### Step 5: Review Results

After sending:
1. Toast shows offers sent count
2. Sent offers appear in "Recent Offers" table
3. Selection is cleared on success
4. Metrics dashboard updates

---

## Offer Process Detail

When you click Send:

1. **For each selected listing:**
   - Build personalised message using template
   - Calculate offer price (price × (1 - discount))
   - Call eBay sendOfferToInterestedBuyers API

2. **eBay creates offers for each interested buyer:**
   - Offer appears in buyer's messages
   - Buyer has 4 days to accept
   - You see one record per buyer

3. **Result tracking:**
   - Each offer saved to database
   - Status tracked (PENDING → ACCEPTED/DECLINED/EXPIRED)
   - Linked to inventory item for reporting

---

## Understanding Scores

### Score Breakdown

Click a score to see factors:

```
Score: 65
├── Listing Age:  70 (45 days old)
├── Stock Level:  50 (2 items)
├── Item Value:   60 (£35 item)
├── Category:     50 (default)
└── Watchers:     60 (3 watchers)
```

### Why This Discount?

Discount is determined by score ranges:
- Score 65 falls in 60-79 range
- Default rule: 20% discount
- Custom rules can override

---

## Re-Offers

If a buyer declined or let an offer expire:

1. Listing becomes eligible again after cooldown
2. Shows "(Re-offer)" badge in table
3. Discount escalates by X% (default +5%)
4. Links to previous offer for tracking

Example:
- First offer: 15% discount → Expired
- Wait 7 days (cooldown)
- Second offer: 20% discount (+5% escalation)

---

## Error Handling

### No Eligible Listings

Message: "No listings are currently eligible for offers"

**Causes:**
- Listings too new (< minDaysBeforeOffer)
- No watchers on any listings
- All listings already offered recently

### No Interested Buyers

Message: "X eligible listings found, but no interested buyers"

**Meaning:**
- eBay has no buyers to offer to
- Watchers may have disappeared
- Wait for new watchers

### Max Offers Reached

Message: "Maximum offers reached for this listing"

**eBay limit:**
- Each listing has an offer limit
- Wait for existing offers to expire
- Or choose different listings

---

## API Reference

### POST /api/negotiation/send-offers

**Request:**
```json
{
  "listingIds": ["123456789", "987654321"]
}
```

**Response:**
```json
{
  "data": {
    "offersSent": 5,
    "offersFailed": 0,
    "offersSkipped": 0,
    "eligibleCount": 2,
    "results": [
      {
        "success": true,
        "listingId": "123456789",
        "ebayOfferId": "abc123",
        "buyerMaskedUsername": "j***n",
        "discountPercentage": 15,
        "score": 45,
        "offersCreated": 3
      }
    ]
  }
}
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| No listings in table | Check minDaysBeforeOffer setting |
| Wrong discount | Review discount rules in settings |
| Send button disabled | Select at least one listing |
| API error | Check eBay OAuth token is valid |

---

## Source Files

| File | Purpose |
|------|---------|
| [PlannedOffersTable.tsx](../../../apps/web/src/components/features/negotiation/PlannedOffersTable.tsx) | Eligible listings table |
| [OffersTab.tsx](../../../apps/web/src/components/features/negotiation/OffersTab.tsx) | Send button logic |
| [send-offers/route.ts](../../../apps/web/src/app/api/negotiation/send-offers/route.ts) | API endpoint |

---

## Related Journeys

- [Automation](./automation.md) - Automatic offer sending
- [Configuration](./configuration.md) - Adjust settings
