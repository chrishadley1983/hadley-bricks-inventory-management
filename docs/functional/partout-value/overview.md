# Partout Value (POV)

> **Entry Point:** `/set-lookup` (Partout tab)
> **Status:** Complete
> **Complexity:** Low

## Purpose

Calculate the total value of a LEGO set's individual parts if sold separately on BrickLink. Compare the "Part Out Value" (POV) to the complete set price to determine whether it's more profitable to sell the set whole or break it into parts.

---

## Key Concepts

### The honesty ladder

A single "POV" number flatters, because it assumes every lot clears at guide price. The
tab therefore shows three rungs, and only the last one is money we would actually see:

| Rung | Definition | What it is for |
|------|-----------|----------------|
| **Gross POV** | `Σ (part_price × quantity)` | Comparison with BrickLink's published POV. Never a decision. |
| **Realisable** | Gross discounted by the STR capture curve | What the lots plausibly sell for |
| **Net** | Realisable less the 9.4% variable fee stack | **The decision figure** |

Calculated separately for New and Used. The capture curve lives in
`liquidity-pov.ts` and carries an explicit `TODO(calibration)` — its brackets are the
spec's starting guess, not yet fitted to our own sales, so everything from the
realisable rung down inherits that uncertainty.

### The gate and the verdict

The verdict is **not** the old `ratio > 1` test. A set must clear both gates:

```
POV multiple = Gross POV / complete set price   (must be >= POV_MULTIPLE_MIN, 2.0x)
Gap          = Gross POV - complete set price   (must be >= POV_MIN_GAP_GBP, £10)
```

| Verdict | Meaning |
|---------|---------|
| `PART-OUT` | Both gates cleared |
| `SELL-COMPLETE` | Gates not cleared — the bench time isn't worth it |
| `SKIP` | No complete-set price on record, so the gate can't be applied |

Every threshold comes from `lib/bricklink/fees.ts`. Nothing in the assessment engine or
the UI declares a cutoff of its own.

### Max buy

The most we should pay for the set and still hit the target margin:

```
Max buy = Realisable × (1 − fee stack − target margin)
```

Target margin defaults to `DEFAULT_MIN_MARGIN` (20%). **Excludes acquisition postage and
teardown labour**, so treat it as an optimistic ceiling.

### Magnets

Lots with worldwide supply of 1–3 lots AND sell-through ≥ 0.5. They are surfaced
independently of the verdict — a set can fail the part-out gate and still be worth
buying for the traffic these pull to the store. Supply comes from
`bricklink_pg_summary_cache` via `readWorldSupply`, the same query the store assessment
uses. A zero supply count means "no data", not "infinitely scarce", and is excluded.

### Store overlap

Each lot is classified against our own Bricqer stock: `NEW`, `RESTOCK_OUT`,
`RESTOCK_THIN`, `DUPLICATE`. Sourced from `bricqer_inventory_snapshot`, which is
refreshed **fortnightly** by the `HadleyBricks-Bricqer-Snapshot-Local` scheduled task
(`scripts/register-bricqer-snapshot-task.ps1`). The panel shows `snapshotAt` so drift is
visible. When no snapshot is available the panel reports that plainly rather than
implying we hold nothing.

### Price caching

Part prices come from the unified cache (`bricklink_price_guide_cache`) through
`readPriceGuide` / `ensurePriceGuide`. Every API fetch captures all four quadrants, so a
partout run enriches the shared dataset for every other consumer.
- Default TTL: 180 days
- Force refresh: TTL 0, so every tuple is re-fetched and re-captured
- Cache statistics are shown in the UI

---

## User Journeys

| Journey | Description | File |
|---------|-------------|------|
| [Analyse Set](./analyse-set.md) | Look up a set and view partout analysis | |

---

## Features

### Assessment panel

The decision surface, rendered for the condition selected by the single New/Used toggle
at the top of the tab:

| Card | Shows |
|------|-------|
| Assessment | Verdict, plain-English reason, POV multiple and gap against their gates |
| Part-Out Value | The three-rung ladder (gross → realisable → net) |
| Max buy | Ceiling at the target margin, compared with the current set price |
| Sell-through depth | Lots / pieces / gross / realisable at each STR gate |
| Where the value sits | Top-10 share, lots to half the POV, split by item type, top lots |
| Magnets | Scarce, fast-moving lots — independent of the verdict |
| Store overlap | NEW / RESTOCK / DUPLICATE counts and value, with the snapshot date |

An amber banner appears when lots have no UK price data, because those contribute £0 and
understate every figure above.

### BrickLink cross-check

Below the assessment sits BrickLink's own published Part Out Value, explicitly labelled
as a cross-check. It shares the tab's condition toggle and carries a reconciliation
note: BL's figure is the same kind of number as our **Gross** rung, and the two multiples
have different denominators (BL divides by UK RRP, we divide by the set's current market
price). Where they disagree, the assessment wins.

### Summary cards

Raw POV totals and legacy ratios for both conditions at once, plus cache status and
missing-price indicators. Retained because the assessment panel shows one condition at a
time; the ladder's gross rung is the same figure.

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

### Sell-through rate

Two are in play and they are not interchangeable:

```
Lots basis (legacy table column) = (sold lots / stock lots) × 100
Quantity basis (the house standard, used by the assessment) = sold qty / stock qty
```

The assessment, the STR bands and the magnet test all use the **quantity basis** as a
0..1 fraction. Higher = parts sell quickly = good for partout.

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
    "assessment": {
      "new": {
        "condition": "new",
        "grossPov": 905.89,
        "realisablePov": 396.77,
        "captureRate": 0.438,
        "netPov": 359.47,
        "feePct": 0.094,
        "setPrice": 878.11,
        "povMultiple": 1.03,
        "gapGbp": 27.78,
        "verdict": "SELL-COMPLETE",
        "verdictReason": "POV is only 1.03x the set price ...",
        "gate": { "povMultipleMin": 2, "minGapGbp": 10 },
        "maxBuy": { "targetMargin": 0.2, "price": 280.12 },
        "strBands": [],
        "magnets": [],
        "concentration": {},
        "overlap": { "counts": {}, "snapshotAt": "2026-06-14T07:50:35Z" },
        "pricedLots": 684,
        "unpricedLots": 0
      },
      "used": {}
    },
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
| Request delay | 500ms between requests (each fetch = 4 parallel BL calls) |
| Batch delay | 2000ms between batches |

If rate limit is hit:
- Fetching stops immediately
- Partial results are returned
- Cached prices are preserved
- Warning logged to console

---

## Cache System

### Database table

`bricklink_price_guide_cache` — the **unified** cache shared by every BL price consumer.
(The old per-part `bricklink_part_price_cache` was retired in the price-cache cutover.)

- Item type + item number + colour ID
- All four quadrants: sold/stock × new/used, with lots, qty, min/avg/median/max
- `uk_detail` blob: per-side price histogram, min/max, and `byMonth` — the months BL had
  UK sales rows for. **`byMonth` is sparse and not gap-filled**: a busy part gets a dense
  recent run, an individual set often gets one or two points that may be years apart.
- `fetched_at` timestamp, used for the TTL

### Cache lookup

1. Get all parts from the set (`getSubsets`)
2. `readPriceGuide` for every part+colour ref, with the TTL
3. Split into cached (coverage `uk`) vs uncached
4. `ensurePriceGuide` the uncached ones — each fetch captures all four quadrants
5. Read worldwide supply and our own stock index for magnets and overlap

### Force refresh flow

1. Re-run with `ttlDays = 0`, so every cached row counts as stale
2. `ensurePriceGuide` re-fetches and re-captures each tuple
3. Return complete fresh data

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| POV is £0.00 | Parts may not be priced on BrickLink; check individual parts |
| Verdict is "Insufficient Data" (SKIP) | No complete-set price on record, so the gate can't be applied |
| Magnets panel says "no magnet lots" | Usually genuine — check the parts table's World lots column; a set of common parts has none |
| Store overlap says no snapshot | `bricqer_inventory_snapshot` is empty for this user, or the fortnightly refresh has not run |
| Overlap looks wrong | Check the snapshot date on the panel — the refresh is fortnightly, not live |
| Loading very slow | Many uncached parts; use Force Refresh to populate cache |
| Rate limit error | Wait 5-10 minutes before retrying |
| Missing prices warning | Some parts have no BrickLink sales data |

---

## Source Files

| File | Purpose |
|------|---------|
| [PartoutTab.tsx](../../../apps/web/src/components/features/set-lookup/PartoutTab.tsx) | Container component |
| [PartoutAssessmentPanel.tsx](../../../apps/web/src/components/features/set-lookup/PartoutAssessmentPanel.tsx) | The decision UI: ladder, gate, max buy, STR bands, magnets, overlap |
| [OfficialPovCard.tsx](../../../apps/web/src/components/features/set-lookup/OfficialPovCard.tsx) | BrickLink's published POV, as a cross-check with the reconciliation note |
| [PartoutSummary.tsx](../../../apps/web/src/components/features/set-lookup/PartoutSummary.tsx) | Raw POV/ratio cards for both conditions |
| [PartoutTable.tsx](../../../apps/web/src/components/features/set-lookup/PartoutTable.tsx) | Parts data table |
| [partout.service.ts](../../../apps/web/src/lib/bricklink/partout.service.ts) | Core calculation logic |
| [partout-assessment.ts](../../../apps/web/src/lib/bricklink/partout-assessment.ts) | Pure assessment engine — declares no thresholds of its own |
| [fees.ts](../../../apps/web/src/lib/bricklink/fees.ts) | The ONLY home for the fee stack, STR gates, magnet definition and part-out gate |
| [liquidity-pov.ts](../../../apps/web/src/lib/bricklink/liquidity-pov.ts) | Capture curve (uncalibrated — see `TODO(calibration)`) |
| [world-supply.ts](../../../apps/web/src/lib/bricklink/world-supply.ts) | Worldwide supply read, shared with the store assessment |
| [partout-error.ts](../../../apps/web/src/lib/bricklink/partout-error.ts) | Maps BL errors to real statuses and messages |
| [price-guide/read.ts](../../../apps/web/src/lib/bricklink/price-guide/read.ts) | Unified cache reader |
| [usePartout.ts](../../../apps/web/src/hooks/usePartout.ts) | React hook |
| [partout.ts](../../../apps/web/src/types/partout.ts) | Type definitions |
| [partout/route.ts](../../../apps/web/src/app/api/bricklink/partout/route.ts) | API endpoint |

---

## Related Features

- [Set Lookup](../set-lookup/overview.md) - Parent feature for set information
- [Inventory](../inventory/overview.md) - Track partout inventory
