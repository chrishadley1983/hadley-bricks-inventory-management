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
| **Min** | Blue | Lowest UK new price |
| **Avg** | Blue | Average UK new price |
| **Max** | Blue | Highest UK new price |

### Used Condition
| Metric | Colour | Description |
|--------|--------|-------------|
| **Min** | Teal | Lowest UK used price |
| **Avg** | Teal | Average UK used price |
| **Max** | Teal | Highest UK used price |

### Lot Count
Shows number of available lots on BrickLink.

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
      "minPrice": 590.00,
      "avgPrice": 610.00,
      "maxPrice": 680.00,
      "lotCount": 5
    },
    "bricklinkUsed": {
      "minPrice": 420.00,
      "avgPrice": 480.00,
      "maxPrice": 550.00,
      "lotCount": 8
    }
  }
}
```
