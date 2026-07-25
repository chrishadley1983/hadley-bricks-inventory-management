# Viewing Pricing

> Compare market prices across Amazon, eBay, and BrickLink.

## Overview

After looking up a set, pricing data is automatically fetched from multiple platforms, allowing you to compare current market prices.

## Amazon Pricing

### Price Display
| Metric | Colour | Description |
|--------|--------|-------------|
| **Buy Box** | Amber | Current Buy Box winning price |
| **Lowest** | Amber | Lowest available offer |
| **Was Price** | Amber (muted) | Historical reference price |

### Offers Section
- Shows total seller count
- Click to open Amazon Offers Modal
- View all individual offers with:
  - Seller condition
  - Fulfillment type (FBA/FBM)
  - Listing and shipping price
  - Prime eligibility

## eBay Pricing

### New Condition
| Metric | Colour | Description |
|--------|--------|-------------|
| **Min** | Purple | Lowest current listing |
| **Avg** | Purple | Average listing price |
| **Max** | Purple | Highest current listing |

### Used Condition
| Metric | Colour | Description |
|--------|--------|-------------|
| **Min** | Orange | Lowest used listing |
| **Avg** | Orange | Average used price |
| **Max** | Orange | Highest used listing |

### Clickable Listings
- Click new section to open eBay New Modal
- Click used section to open eBay Used Modal
- Modals show actual listings with:
  - Listing title
  - Price
  - Seller
  - Link to eBay

## BrickLink Pricing

### New Condition
| Metric | Colour | Description |
|--------|--------|-------------|
| **Min** | Blue | Lowest UK new asking price |
| **Avg** | Blue | Quantity-weighted average UK new asking price |
| **Max** | Blue | Highest UK new asking price |

### Used Condition
| Metric | Colour | Description |
|--------|--------|-------------|
| **Min** | Teal | Lowest UK used asking price |
| **Avg** | Teal | Quantity-weighted average UK used asking price |
| **Max** | Teal | Highest UK used asking price |

### Lot Count
Number of lots currently for sale on BrickLink UK.

### Drill-down
Both BrickLink panels are clickable and open a detail modal:

| Section | Shows |
|---------|-------|
| Currently for sale | Min / avg / max asking price and lot count |
| Sold on BrickLink UK | Avg, median, volume, and quantity-basis STR |
| Months with UK sales on record | The dated months behind the sold figures |
| Links | Deep links to the BrickLink price guide and catalogue page |

**Read the sold months, not just the average.** The sold columns cover whatever months
BrickLink's UK sold table held at fetch time — not a rolling six months. For a slow set
that can be one or two points years apart (75192-1 New: 4 pieces, all Feb–Mar 2020). The
modal states the real span in the section heading, and lists the months rather than
drawing a trend line, because the gaps are months with no sales, not zero prices.

### Panel states
A BrickLink panel never shows an empty row of dashes for a failure. `status` distinguishes:

| Status | Panel shows |
|--------|-------------|
| `ok` | The price grid |
| `no-data` | The grid, plus an explicit "no UK listings or sales on record" note in the modal |
| `not-configured` | Amber "BrickLink not connected", with a link to Settings |
| `error` | Red "Lookup failed" and the underlying message |

## Price Comparison

### Typical Workflow
1. Look up set number
2. Review Amazon Buy Box (main selling channel)
3. Compare eBay new/used prices
4. Check BrickLink for specialist market
5. Determine optimal pricing strategy

### Price Hierarchy
- **Amazon Buy Box**: Most liquid market
- **eBay New**: Second most liquid
- **eBay Used**: Used market reference
- **BrickLink**: Specialist LEGO market

## Loading States

Each pricing section shows:
- Spinning loader while fetching
- "—" if no data available
- Actual prices when loaded

## Data Freshness

| Source | Cache Duration |
|--------|---------------|
| Amazon | 5 minutes |
| eBay | 5 minutes |
| BrickLink | 5 minutes |

Pricing refetches when:
- A new set is looked up
- Cache expires
- Page is refreshed

## Source Files

- [SetDetailsCard.tsx](../../../apps/web/src/components/features/brickset/SetDetailsCard.tsx:190-503) - Pricing sections
- [SetLookupEbayModal.tsx](../../../apps/web/src/components/features/brickset/SetLookupEbayModal.tsx) - eBay listings
- [AmazonOffersModal.tsx](../../../apps/web/src/components/features/brickset/AmazonOffersModal.tsx) - Amazon offers
- [SetLookupBricklinkModal.tsx](../../../apps/web/src/components/features/brickset/SetLookupBricklinkModal.tsx) - BrickLink drill-down, sold months, catalogue deep links

## API Endpoint

```
GET /api/brickset/pricing?setNumber=75192&ean=5702015869935&upc=673419267038
```

### Response
```json
{
  "data": {
    "amazon": {
      "buyBoxPrice": 649.99,
      "lowestPrice": 639.00,
      "wasPrice": 699.99,
      "offerCount": 12,
      "asin": "B06XHTHWMS",
      "offers": [...]
    },
    "ebay": {
      "minPrice": 580.00,
      "avgPrice": 625.50,
      "maxPrice": 750.00,
      "listingCount": 8
    },
    "ebayUsed": {
      "minPrice": 450.00,
      "avgPrice": 520.00,
      "maxPrice": 600.00,
      "listingCount": 15
    },
    "bricklink": {
      "status": "ok",
      "message": null,
      "minPrice": 590.00,
      "avgPrice": 610.00,
      "maxPrice": 680.00,
      "lotCount": 5,
      "soldAvg": 475.00,
      "soldMedian": 475.00,
      "soldLots": 4,
      "soldQty": 4,
      "strQty": 0.18,
      "byMonth": {
        "March 2020": { "avg": 500.00, "qty": 1, "lots": 1 },
        "February 2020": { "avg": 466.67, "qty": 3, "lots": 3 }
      },
      "freshnessDays": 4.2
    },
    "bricklinkUsed": {
      "status": "not-configured",
      "message": "BrickLink is not connected. Add credentials in Settings.",
      "minPrice": null,
      "avgPrice": null,
      "maxPrice": null,
      "lotCount": 0,
      "soldAvg": null,
      "soldMedian": null,
      "soldLots": 0,
      "soldQty": 0,
      "strQty": null,
      "byMonth": null,
      "freshnessDays": null
    }
  }
}
```
