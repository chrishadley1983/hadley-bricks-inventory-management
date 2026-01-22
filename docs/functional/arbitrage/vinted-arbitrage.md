# Journey: Vinted Arbitrage

> **Entry Point:** `/arbitrage/vinted`
> **Prerequisites:** Amazon credentials configured
> **Complexity:** Low

## Purpose

Scan Vinted listings for LEGO sets and instantly compare them against Amazon Buy Box prices to identify profitable arbitrage opportunities. Unlike the other arbitrage modes which work from tracked inventory, Vinted arbitrage is a real-time scanning tool for finding immediate buying opportunities.

## Key Concepts

### Cost of Goods Percentage (COG%)

Vinted arbitrage uses COG% as the primary viability metric:

```
COG% = (Vinted Price + £2.30 shipping) / Amazon Price × 100
```

Lower COG% = Higher profit potential

| COG% | Rating | Action |
|------|--------|--------|
| < 30% | Excellent | Buy immediately |
| 30-40% | Good | Buy (target zone) |
| 40-50% | Marginal | Consider carefully |
| 50-60% | Poor | Usually skip |
| > 60% | Not Viable | Skip |

### Profit Calculation

```
Net Payout = Amazon Price × (1 - 0.1836)  // After Amazon fees
Profit = Net Payout - Vinted Price - £2.30 shipping
ROI = Profit / (Vinted Price + £2.30) × 100
```

---

## User Flow

### Step 1: Navigate to Vinted Arbitrage

1. Click **Arbitrage** in the sidebar
2. Select the **Vinted** tab (or navigate to `/arbitrage/vinted`)

### Step 2: Configure Scan

**Vinted URL:**
- Enter or modify the Vinted catalog URL
- Default: `https://www.vinted.co.uk/catalog?search_text=lego&status_ids[]=6&order=newest_first`
- Filters for "New with tags" LEGO items sorted by newest

**COG% Threshold:**
- Adjust the slider (20% - 60%)
- Default: 40%
- Items below this threshold are marked as "viable"

### Step 3: Scan Listings

1. Click **Scan** button
2. System fetches the Vinted page
3. Parses listing data from HTML
4. Extracts LEGO set numbers from titles
5. Looks up corresponding ASINs from seeded database
6. Fetches Amazon pricing for matched sets
7. Calculates COG%, profit, and ROI

### Step 4: Review Results

**Summary Cards:**
- Total Listings scanned
- Identified Sets (with valid set numbers)
- Unique Sets (deduplicated)
- With Amazon Pricing
- Viable Opportunities (highlighted in green)

**Potential Buys Table:**
Shows items where COG% ≤ threshold:
- Set number
- Title with Vinted link
- Vinted price
- Amazon price (+ Was Price if available)
- COG% badge (color-coded)
- Estimated profit
- ROI percentage
- Amazon product link

**All Results Table:**
Complete list sorted by COG% (lowest first):
- Same columns as above
- Viable items highlighted with green background
- Non-viable items shown in normal styling

---

## Set Number Extraction

The system extracts LEGO set numbers from Vinted listing titles using these patterns:

| Pattern | Example | Priority |
|---------|---------|----------|
| 4-5 digit number | "LEGO 75192 Millennium Falcon" | High |
| "Set" prefix | "Set 10300 DeLorean" | High |
| "LEGO" prefix | "LEGO 76419 Hogwarts" | High |
| Hash prefix | "#42156 Peugeot" | High |

**Exclusions:**
Listings containing these keywords are skipped:
- "compatible" - Clone brands
- "moc " - Custom builds
- "custom" - Custom builds
- "block tech" - Clone brand

---

## ASIN Matching

Set numbers are matched to ASINs via the `seeded_asins` table:

1. Convert set number to Brickset format (e.g., "75192" → "75192-1")
2. Look up in `seeded_asins` joined with `brickset_sets`
3. Only use ASINs with `discovery_status = 'found'`
4. Retrieve UK RRP as fallback if no Buy Box price

---

## COG% Badge Colors

| Color | Range | Meaning |
|-------|-------|---------|
| 🟢 Green (dark) | < 30% | Excellent opportunity |
| 🟢 Green (light) | 30-40% | Good opportunity |
| 🟡 Yellow | 40-50% | Marginal, check carefully |
| 🟠 Orange | 50-60% | Poor margin |
| 🔴 Red | > 60% | Not viable |

---

## API Reference

### GET /api/arbitrage/vinted

Scan a Vinted catalog URL.

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| url | string | required | Vinted catalog URL to scan |
| cogThreshold | number | 40 | COG% threshold for viability |

**Response:**
```json
{
  "summary": {
    "totalListings": 48,
    "identifiedSets": 32,
    "uniqueSets": 28,
    "withAmazonPricing": 24,
    "viableOpportunities": 5,
    "cogThreshold": 40
  },
  "results": [
    {
      "setNumber": "75192",
      "title": "LEGO Star Wars 75192 Millennium Falcon",
      "vintedPrice": 450.00,
      "totalCost": 452.30,
      "amazonPrice": 749.99,
      "amazonBuyBox": 749.99,
      "amazonWasPrice": null,
      "cogPercent": 60.3,
      "profit": 160.20,
      "roi": 35.4,
      "viable": false,
      "asin": "B075SDMMMV",
      "vintedUrl": "https://www.vinted.co.uk/items/..."
    }
  ],
  "viable": [/* Items where viable=true */]
}
```

### POST /api/arbitrage/vinted

Parse raw HTML (for debugging or browser extension use).

**Request Body:**
```json
{
  "html": "<html>...</html>",
  "cogThreshold": 40
}
```

**Response:**
```json
{
  "summary": {
    "totalListings": 48,
    "identifiedSets": 32,
    "uniqueSets": 28,
    "cogThreshold": 40
  },
  "setNumbers": ["75192", "10300", ...],
  "listings": [/* Parsed listing objects */]
}
```

---

## Workflow Tips

### Optimal Scanning Strategy

1. **Use filtered URLs**: Add `status_ids[]=6` for "New with tags" only
2. **Sort by newest**: `order=newest_first` to catch fresh listings
3. **Scan frequently**: New listings sell fast
4. **Set realistic threshold**: 40% COG is the sweet spot

### Quick Buying Process

1. Identify viable opportunity in results
2. Click the purple Vinted link icon to open listing
3. Verify photos match description
4. Purchase on Vinted if satisfied
5. Click Amazon link to verify current pricing
6. List on Amazon once received

### What to Watch For

- **Was Price discrepancies**: Amazon prices fluctuate
- **Set condition**: Verify "New with tags" status
- **Shipping costs**: £2.30 is typical but verify
- **Multiple listings**: Same set at different prices - lowest matters
- **Clone sets**: Extracted set numbers might match non-LEGO items

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Failed to fetch Vinted page" | Vinted may be blocking; try again later |
| No viable opportunities | Lower COG threshold or wait for new listings |
| Missing Amazon pricing | ASIN not in seeded database or discovery pending |
| Wrong set number extracted | Regex may mismatch; review title manually |
| Low identification rate | Many listings lack clear set numbers |

---

## Source Files

| File | Purpose |
|------|---------|
| [vinted/page.tsx](../../../apps/web/src/app/(dashboard)/arbitrage/vinted/page.tsx) | Page component |
| [vinted/route.ts](../../../apps/web/src/app/api/arbitrage/vinted/route.ts) | API endpoint |

---

## Related Journeys

- [Amazon Arbitrage](./amazon-arbitrage.md) - Track your Amazon inventory vs BrickLink
- [eBay Arbitrage](./ebay-arbitrage.md) - Compare against eBay listings
- [Seeded ASINs](./seeded-asins.md) - Manage the seeded ASIN database
