# eBay Negotiation Engine

> **Entry Point:** `/orders` (Offers tab)
> **Status:** Complete
> **Complexity:** Medium

## Purpose

Automate sending targeted discount offers to interested eBay buyers. The engine identifies listings with watchers or cart abandoners, calculates an appropriate discount based on listing age and other factors, and sends personalised offers either manually or on a schedule.

---

## Key Concepts

### Interested Buyers

eBay identifies "interested buyers" as users who have:
- Added your item to their watchlist
- Added your item to cart but not purchased
- Viewed your listing multiple times

These buyers are eligible to receive special discount offers via eBay's Negotiation API.

### Scoring System

Each eligible listing receives a score (0-100) based on weighted factors:

| Factor | Default Weight | Logic |
|--------|----------------|-------|
| **Listing Age** | 50% | Older listings score higher (need discounting) |
| **Stock Level** | 15% | More stock = higher urgency to clear |
| **Item Value** | 15% | Lower value items can have bigger discounts |
| **Category** | 10% | Reserved for future category rules |
| **Watchers** | 10% | Fewer watchers = needs bigger push |

Higher score = more aggressive discount.

### Discount Rules

Score ranges map to discount percentages:

| Score Range | Default Discount |
|-------------|------------------|
| 0-39 | 10% |
| 40-59 | 15% |
| 60-79 | 20% |
| 80-100 | 25% |

Minimum discount: 10%. Maximum discount: 50%.

---

## User Journeys

| Journey | Description | File |
|---------|-------------|------|
| [Manual Offers](./manual-offers.md) | Send offers to selected listings | |
| [Automation](./automation.md) | Configure automatic offer sending | |
| [Configuration](./configuration.md) | Set weights, rules, and messages | |

---

## Features

### Manual Offer Sending

1. View eligible listings with calculated scores
2. Select specific listings to send offers
3. Review discount percentages before sending
4. Send offers with personalised messages
5. Track results in offers history

### Automation

When enabled:
- Runs 4 times daily (8am, 12pm, 4pm, 8pm UK time)
- Processes all eligible listings automatically
- Applies configured discount rules
- Sends Pushover notification with results

### Offer Message Templates

Customisable message with placeholders:
- `{discount}` - Discount percentage
- `{title}` - Listing title
- `{price}` - Original price
- `{offer_price}` - Discounted price

Default template:
> "Thank you for your interest! We're offering you an exclusive {discount}% discount on this item. Don't miss out on this special offer!"

### Re-Offer Logic

For buyers who declined or let offers expire:
- Configurable cooldown period (default 7 days)
- Escalation: next offer adds X% (default +5%)
- Tracks offer chains for conversion analysis

### Metrics Dashboard

Real-time statistics:
- Total offers sent
- Acceptance rate
- Average discount sent
- Average discount on converted offers
- Pending/declined/expired counts

---

## Scoring Details

### Listing Age Score

Older listings need more aggressive discounting:

```
0 days   → Score 0
30 days  → Score 33
60 days  → Score 67
90+ days → Score 100
```

### Stock Level Score

Higher stock means more urgency to sell:

```
1 item    → Score 20 (low urgency)
2-3 items → Score 50 (medium urgency)
4-5 items → Score 70 (high urgency)
6+ items  → Score 100 (very high urgency)
```

### Item Value Score

Lower value items can handle bigger discounts:

```
≥£100 → Score 20 (protect margin)
£50-99 → Score 40
£25-49 → Score 60
<£25   → Score 80 (OK to discount)
```

### Watcher Score

Fewer watchers means less organic interest:

```
10+ watchers → Score 20 (high interest)
5-9 watchers → Score 40
2-4 watchers → Score 60
0-1 watchers → Score 80 (needs push)
```

---

## API Reference

### GET /api/negotiation/config

Get user's negotiation configuration.

**Response:**
```json
{
  "data": {
    "id": "uuid",
    "automationEnabled": false,
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
}
```

### PATCH /api/negotiation/config

Update configuration.

### GET /api/negotiation/eligible

Get eligible listings with scores.

**Response:**
```json
{
  "data": [
    {
      "listingId": "123456789",
      "title": "LEGO Star Wars 75192",
      "currentPrice": 649.99,
      "stockLevel": 1,
      "watcherCount": 5,
      "previousOfferCount": 0,
      "score": 45,
      "scoreFactors": {
        "listing_age": 60,
        "stock_level": 20,
        "item_value": 20,
        "category": 50,
        "watchers": 40
      },
      "discountPercentage": 15,
      "isReOffer": false
    }
  ]
}
```

### POST /api/negotiation/send-offers

Send offers to specified listings.

**Request:**
```json
{
  "listingIds": ["123456789", "987654321"],
  "dryRun": false
}
```

**Response:**
```json
{
  "data": {
    "offersSent": 3,
    "offersFailed": 0,
    "offersSkipped": 1,
    "eligibleCount": 2,
    "results": [...]
  }
}
```

### GET /api/negotiation/offers

Get sent offers with pagination.

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| status | string | Filter by status |
| triggerType | string | "manual" or "automated" |
| limit | number | Page size |
| offset | number | Page offset |

### GET /api/negotiation/metrics

Get dashboard metrics.

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| days | number | Lookback period (default 30) |

### GET /api/negotiation/rules

Get discount rules.

### POST /api/negotiation/rules

Create discount rule.

### PUT /api/negotiation/rules/[id]

Update discount rule.

### DELETE /api/negotiation/rules/[id]

Delete discount rule.

---

## Offer Statuses

| Status | Description |
|--------|-------------|
| `PENDING` | Offer sent, awaiting buyer response |
| `ACCEPTED` | Buyer accepted, order created |
| `DECLINED` | Buyer explicitly declined |
| `EXPIRED` | Offer expired (4 days default) |
| `FAILED` | Error sending offer |

---

## Configuration Options

| Setting | Default | Description |
|---------|---------|-------------|
| `automationEnabled` | false | Enable scheduled offers |
| `minDaysBeforeOffer` | 14 | Days since listing before eligible |
| `reOfferCooldownDays` | 7 | Days to wait before re-offering |
| `reOfferEscalationPercent` | 5 | Extra discount on re-offers |
| `weightListingAge` | 50 | Scoring weight (%) |
| `weightStockLevel` | 15 | Scoring weight (%) |
| `weightItemValue` | 15 | Scoring weight (%) |
| `weightCategory` | 10 | Scoring weight (%) |
| `weightWatchers` | 10 | Scoring weight (%) |
| `offerMessageTemplate` | ... | Custom message with placeholders |

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| No eligible listings | Check minDaysBeforeOffer; listings must be old enough |
| 0 offers sent | No interested buyers on eBay for those listings |
| Max offers error | eBay limits offers per listing; wait or choose different listings |
| Automation not running | Check Vercel cron configuration |
| Scores seem wrong | Review scoring weights in settings |

---

## Source Files

| File | Purpose |
|------|---------|
| [OffersTab.tsx](../../../apps/web/src/components/features/negotiation/OffersTab.tsx) | Main UI tab |
| [MetricsDashboard.tsx](../../../apps/web/src/components/features/negotiation/MetricsDashboard.tsx) | Metrics display |
| [PlannedOffersTable.tsx](../../../apps/web/src/components/features/negotiation/PlannedOffersTable.tsx) | Eligible listings |
| [RecentOffersTable.tsx](../../../apps/web/src/components/features/negotiation/RecentOffersTable.tsx) | Sent offers history |
| [ConfigModal.tsx](../../../apps/web/src/components/features/negotiation/ConfigModal.tsx) | Settings dialog |
| [DiscountRulesEditor.tsx](../../../apps/web/src/components/features/negotiation/DiscountRulesEditor.tsx) | Rule management |
| [negotiation.service.ts](../../../apps/web/src/lib/ebay/negotiation.service.ts) | Main service |
| [negotiation-scoring.service.ts](../../../apps/web/src/lib/ebay/negotiation-scoring.service.ts) | Scoring logic |
| [ebay-negotiation.client.ts](../../../apps/web/src/lib/ebay/ebay-negotiation.client.ts) | eBay API client |
| [negotiation.types.ts](../../../apps/web/src/lib/ebay/negotiation.types.ts) | Type definitions |
| [useNegotiation.ts](../../../apps/web/src/hooks/useNegotiation.ts) | React hooks |

---

## Related Features

- [eBay Orders](../orders/ebay.md) - Offers can result in orders
- [Platform Listings](../inventory/platform-listings.md) - Source of eligible listings
