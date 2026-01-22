# Partout Value (POV)

> **Entry Point:** `/set-lookup` (Partout tab)
> **Status:** Complete
> **Complexity:** Low

## Purpose

Calculate the total value of a LEGO set's individual parts if sold separately on BrickLink. Compare the "Part Out Value" (POV) to the complete set price to determine whether it's more profitable to sell the set whole or break it into parts.

---

## Key Concepts

### Part Out Value (POV)

The sum of average prices for all parts in a set, multiplied by their quantities:

```
POV = Σ (part_avg_price × quantity)
```

Calculated separately for New and Used conditions.

### POV Ratio

Compares part-out value to complete set price:

```
Ratio = POV / Set Price
```

| Ratio | Meaning | Recommendation |
|-------|---------|----------------|
| > 1.0 | Parts worth more than set | **Part Out** |
| < 1.0 | Set worth more than parts | **Sell Complete** |

### Price Caching

Part prices are cached in the database to minimize BrickLink API calls:
- Cache duration: configurable per part
- Force refresh: clears cache and re-fetches all prices
- Shows cache statistics in UI

---

## User Journeys

| Journey | Description | File |
|---------|-------------|------|
| [Analyse Set](./analyse-set.md) | Look up a set and view partout analysis | |

---

## Features

### Summary Cards

Four main metrics displayed as cards:

1. **POV (New)** - Total value if parts sold as New
2. **Ratio (New)** - POV divided by New set price
3. **POV (Used)** - Total value if parts sold as Used
4. **Ratio (Used)** - POV divided by Used set price

Plus recommendation, cache status, and missing prices indicators.

### Parts Table

Detailed breakdown of every part:

| Column | Description |
|--------|-------------|
| Image | Part thumbnail from BrickLink |
| Name | Part name with BrickLink link |
| Colour | Part colour from BrickLink |
| Qty | Quantity in set |
| Price | Average price (New or Used) |
| Total | Price × Quantity |
| Sell-Through % | How fast parts sell |
| Stock | Number of sellers with stock |
| Times Sold | Recent sales count |
| Cache | Indicates if from cache |

### Condition Toggle

Switch between New and Used pricing:
- Affects Price, Total, Sell-Through, Stock columns
- POV and Ratio update dynamically
- Table re-sorts by selected condition

### Force Refresh

Clear cached prices and re-fetch from BrickLink:
- Use when prices seem stale
- Shows progress indicator
- Updates all parts in one operation

---

## How Scoring Works

### Price Source

Prices come from BrickLink Price Guide API:
- **Stock data**: Current listings (for price average)
- **Sold data**: Last 6 months sales (for sell-through)

### Sell-Through Rate

```
Sell-Through % = (Times Sold / Stock Available) × 100
```

Higher = parts sell quickly = good for partout.

### Missing Prices

Some parts may not have price data:
- Rare colours not for sale
- New parts not yet listed
- Parts with no sales history

Missing parts show as £0.00 in calculations.

---

## API Reference

### GET /api/bricklink/partout

Get partout analysis for a set.

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| setNumber | string | Set number (e.g., "75192-1") |
| forceRefresh | boolean | Clear cache and re-fetch |

**Response:**
```json
{
  "data": {
    "setNumber": "75192-1",
    "totalParts": 342,
    "povNew": 1245.67,
    "povUsed": 876.23,
    "setPrice": {
      "new": 649.99,
      "used": 450.00
    },
    "ratioNew": 1.92,
    "ratioUsed": 1.95,
    "recommendation": "part-out",
    "cacheStats": {
      "fromCache": 280,
      "fromApi": 62,
      "total": 342
    },
    "parts": [
      {
        "partNumber": "3001",
        "partType": "PART",
        "name": "Brick 2 x 4",
        "colourId": 85,
        "colourName": "Dark Bluish Gray",
        "imageUrl": "https://img.bricklink.com/...",
        "quantity": 12,
        "priceNew": 0.15,
        "priceUsed": 0.08,
        "totalNew": 1.80,
        "totalUsed": 0.96,
        "sellThroughRateNew": 45.2,
        "sellThroughRateUsed": 62.8,
        "stockAvailableNew": 1250,
        "stockAvailableUsed": 890,
        "timesSoldNew": 565,
        "timesSoldUsed": 559,
        "fromCache": true
      }
    ]
  }
}
```

---

## Rate Limiting

BrickLink API has rate limits. The service uses:

| Setting | Value |
|---------|-------|
| Batch size | 10 parts |
| Request delay | 200ms between requests |
| Batch delay | 2000ms between batches |

If rate limit is hit:
- Fetching stops immediately
- Partial results are returned
- Cached prices are preserved
- Warning logged to console

---

## Cache System

### Database Table

`bricklink_part_price_cache`:
- Part number + colour ID (composite key)
- New and Used prices
- Sell-through rates
- Stock and sales counts
- Fetched timestamp

### Cache Lookup

1. Get all parts from set
2. Check cache for each part+colour
3. Split into cached vs uncached
4. Fetch only uncached from API
5. Upsert new prices to cache

### Force Refresh Flow

1. Delete cache entries for all parts
2. Fetch all prices from BrickLink
3. Insert new cache entries
4. Return complete fresh data

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| POV is £0.00 | Parts may not be priced on BrickLink; check individual parts |
| Ratio is N/A | Set price not available; BrickLink may not have sales data |
| Loading very slow | Many uncached parts; use Force Refresh to populate cache |
| Rate limit error | Wait 5-10 minutes before retrying |
| Missing prices warning | Some parts have no BrickLink sales data |

---

## Source Files

| File | Purpose |
|------|---------|
| [PartoutTab.tsx](../../../apps/web/src/components/features/set-lookup/PartoutTab.tsx) | Container component |
| [PartoutSummary.tsx](../../../apps/web/src/components/features/set-lookup/PartoutSummary.tsx) | Summary cards |
| [PartoutTable.tsx](../../../apps/web/src/components/features/set-lookup/PartoutTable.tsx) | Parts data table |
| [partout.service.ts](../../../apps/web/src/lib/bricklink/partout.service.ts) | Core calculation logic |
| [part-price-cache.service.ts](../../../apps/web/src/lib/bricklink/part-price-cache.service.ts) | Cache management |
| [usePartout.ts](../../../apps/web/src/hooks/usePartout.ts) | React hook |
| [partout.ts](../../../apps/web/src/types/partout.ts) | Type definitions |
| [partout/route.ts](../../../apps/web/src/app/api/bricklink/partout/route.ts) | API endpoint |

---

## Related Features

- [Set Lookup](../set-lookup/overview.md) - Parent feature for set information
- [Inventory](../inventory/overview.md) - Track partout inventory
