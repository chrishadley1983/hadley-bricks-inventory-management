# Vinted LEGO Arbitrage Component

Quick-build component for scanning Vinted LEGO listings and comparing against Amazon Buy Box pricing.

## Features

- 🔍 **Vinted Scanner** - Fetches and parses Vinted catalog pages
- 💰 **Amazon Pricing** - Gets Buy Box price and Was Price via SP-API
- 📊 **COG% Calculator** - Cost of Goods percentage with threshold filtering
- 📈 **Profit Analysis** - Calculates potential profit and ROI
- 🎯 **Opportunity Detection** - Highlights viable arbitrage opportunities

## Installation

### 1. Copy Files

```bash
# API Route
cp api/route.ts apps/web/src/app/api/arbitrage/vinted/route.ts

# Page Component  
cp page.tsx apps/web/src/app/(dashboard)/arbitrage/vinted/page.tsx

# Amazon Pricing Client (if not exists)
cp amazon-pricing.client.ts apps/web/src/lib/amazon/amazon-pricing.client.ts
```

### 2. Add Navigation Link

In your sidebar/navigation component, add:

```tsx
{
  title: 'Vinted Arbitrage',
  href: '/arbitrage/vinted',
  icon: ShoppingCart, // from lucide-react
}
```

### 3. Dependencies

The component uses existing project dependencies:
- `@tanstack/react-query` - Data fetching
- `@/components/ui/*` - Shadcn UI components
- Supabase client - Auth and database

## API Endpoints

### GET `/api/arbitrage/vinted`

Scan a Vinted URL for LEGO arbitrage opportunities.

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `url` | string | required | Vinted catalog URL to scan |
| `cogThreshold` | number | 40 | COG% threshold for viable opportunities |

**Response:**
```json
{
  "summary": {
    "totalListings": 85,
    "identifiedSets": 42,
    "uniqueSets": 38,
    "withAmazonPricing": 31,
    "viableOpportunities": 3,
    "cogThreshold": 40
  },
  "results": [...],
  "viable": [...]
}
```

### POST `/api/arbitrage/vinted`

Parse raw HTML for LEGO listings.

**Request Body:**
```json
{
  "html": "<html>...</html>",
  "cogThreshold": 40
}
```

## How It Works

### 1. Fetch Vinted Page
Single HTTP request to Vinted catalog URL with browser-like headers.

### 2. Parse Listings
Extracts from HTML:
- Listing title
- Price
- Condition (filters to "New with tags")
- LEGO set number (regex extraction)

### 3. Map to Amazon ASINs
Looks up ASINs from `seeded_asins` table:
- Joins with `brickset_sets` for set number matching
- Gets RRP as fallback pricing

### 4. Fetch Amazon Pricing
Uses SP-API Product Pricing API:
- **Buy Box Price** - Current winning offer
- **List Price** - Manufacturer's suggested retail (Was Price)
- **Lowest Price** - Fallback if no Buy Box

### 5. Calculate COG%
```
COG% = (Vinted Price + £2.30 shipping) / Amazon Price × 100
```

### 6. Determine Viability
```
Profit = Amazon Price - (Amazon Fees × 18.36%) - Total Cost
ROI = Profit / Total Cost × 100
Viable = COG% ≤ threshold
```

## COG% Thresholds

| COG% | Rating | Meaning |
|------|--------|---------|
| <30% | 🟢🟢 Excellent | Buy immediately |
| 30-40% | 🟢 Good | Meets target, ~30% profit |
| 40-50% | 🟡 Marginal | Consider carefully |
| 50-60% | 🟠 Poor | Likely not worth it |
| >60% | 🔴 Not viable | Do not buy |

## Vinted URL Examples

**Default - New LEGO, newest first:**
```
https://www.vinted.co.uk/catalog?search_text=lego&status_ids[]=6&order=newest_first
```

**Star Wars only:**
```
https://www.vinted.co.uk/catalog?search_text=lego+star+wars&status_ids[]=6&order=newest_first
```

**Price range £5-£50:**
```
https://www.vinted.co.uk/catalog?search_text=lego&status_ids[]=6&price_from=5&price_to=50
```

## Database Dependencies

Requires existing tables:
- `seeded_asins` - ASIN mappings
- `brickset_sets` - Set data with RRP
- `integrations` - Amazon credentials

## TOS Compliance

This tool is designed to be TOS-compliant:
- ✅ Single page fetch per scan (not scraping)
- ✅ Human-initiated requests only
- ✅ No account interaction
- ✅ Browser-like headers
- ✅ Public data only

## Customization

### Adjust Shipping Cost
In `api/route.ts`:
```ts
const VINTED_SHIPPING_COST = 2.30; // Update this
```

### Adjust Amazon Fee Estimate
In calculation:
```ts
const amazonFees = amazonPrice * 0.1836; // ~18.36% effective FBM
```

### Add More Filters
Extend the Vinted URL parsing or add query params for:
- Theme filtering
- Price range
- Condition types

## Related Documentation

- [Amazon Arbitrage](../amazon-arbitrage.md) - BrickLink sourcing
- [eBay Arbitrage](../ebay-arbitrage.md) - eBay sourcing
- [Seeded ASINs](../seeded-asins.md) - ASIN discovery
