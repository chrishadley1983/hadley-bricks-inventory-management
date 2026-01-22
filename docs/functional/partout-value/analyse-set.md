# Journey: Analyse Set Partout Value

> **Entry Point:** `/set-lookup`
> **Prerequisites:** BrickLink API credentials configured
> **Complexity:** Low

## Purpose

Look up any LEGO set and determine whether it's more profitable to sell the set complete or break it into individual parts for sale on BrickLink.

---

## Key Concepts

### When to Part Out

Part out when:
- POV Ratio > 1.0 (parts worth more than set)
- High-value minifigures or rare parts
- Common set with easy-to-sell parts
- Set is incomplete or damaged

### When to Sell Complete

Sell complete when:
- POV Ratio < 1.0 (set worth more)
- Retired exclusive sets
- Sets with premium boxes
- Time cost of parting out not worthwhile

---

## User Flow

### Step 1: Navigate to Set Lookup

1. Go to `/set-lookup` from navigation
2. Page shows search form and recent lookups

### Step 2: Search for Set

1. Enter set number (e.g., "75192" or "75192-1")
2. Click **Search** or press Enter
3. Set details load in the Details tab

### Step 3: View Partout Analysis

1. Click **Partout** tab
2. Analysis loads automatically
3. Wait for price fetching (if uncached)

### Step 4: Review Summary

Four key metrics at the top:

| Card | Shows |
|------|-------|
| **POV (New)** | Total parts value if New |
| **Ratio (New)** | POV ÷ New set price |
| **POV (Used)** | Total parts value if Used |
| **Ratio (Used)** | POV ÷ Used set price |

**Recommendation Banner:**
- Green "Part Out" = parts worth more
- Red "Sell Complete" = set worth more

### Step 5: Toggle Condition

1. Use **New / Used** tabs above table
2. All values update to selected condition
3. Recommendation uses New condition by default

### Step 6: Explore Parts

In the parts table:
1. Click column headers to sort
2. Search by part name
3. Click part name to open on BrickLink
4. View individual part metrics

### Step 7: Interpret Data

For each part, assess:

| Metric | Meaning |
|--------|---------|
| **Price** | Average selling price |
| **Total** | Price × Quantity in set |
| **Sell-Through** | Higher % = sells quickly |
| **Stock** | How many sellers have it |
| **Times Sold** | Recent sales volume |

### Step 8: Force Refresh (Optional)

If prices seem stale:
1. Click **Force Refresh** button
2. Wait for all prices to re-fetch
3. Cache is cleared and repopulated

---

## Reading the Results

### Profitable Partout Example

```
Set: 75192-1 Millennium Falcon
Set Price (New): £649.99
POV (New): £1,245.67
Ratio: 1.92x

Recommendation: PART OUT
```

Meaning: Parts are worth 92% more than the complete set.

### Unprofitable Partout Example

```
Set: 40499-1 Santa's Sleigh
Set Price (New): £29.99
POV (New): £18.45
Ratio: 0.62x

Recommendation: SELL COMPLETE
```

Meaning: Set is worth 38% more than the parts.

---

## Understanding Cache Stats

The cache status card shows:

```
Parts Data: 280/342 from cache
62 fetched from BrickLink
```

**Why Cache Matters:**
- Cached = fast (no API calls)
- Uncached = slow (needs BrickLink fetch)
- Force refresh clears all cache

---

## Missing Prices

Some parts may not have prices:

```
Missing Prices: 12 New / 8 Used
of 342 total parts
```

**Common Causes:**
- Rare colour variants not listed
- Brand new parts not yet for sale
- Obscure parts with no sales history

**Impact:**
- Missing parts valued at £0
- POV may be understated
- Check individual parts if critical

---

## High-Value Parts to Watch

Look for these in the parts table:

| Part Type | Why Valuable |
|-----------|--------------|
| **Minifigures** | Often worth more than the rest |
| **Printed pieces** | Unique to specific sets |
| **Rare colours** | Hard to find variants |
| **Large plates** | Expensive per-part |
| **Technic pieces** | High demand |

Sort by Total (descending) to find most valuable.

---

## API Reference

### GET /api/bricklink/partout

**Request:**
```
GET /api/bricklink/partout?setNumber=75192-1
```

**With Force Refresh:**
```
GET /api/bricklink/partout?setNumber=75192-1&forceRefresh=true
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "No partout data available" | Set may not exist in BrickLink |
| Very slow loading | Many uncached parts; be patient or force refresh |
| POV seems low | Check missing prices count |
| Rate limit error | Wait a few minutes; refresh page |
| Wrong set loaded | Check set number format (add -1 suffix) |

---

## Source Files

| File | Purpose |
|------|---------|
| [page.tsx](../../../apps/web/src/app/(dashboard)/set-lookup/page.tsx) | Set lookup page |
| [PartoutTab.tsx](../../../apps/web/src/components/features/set-lookup/PartoutTab.tsx) | Partout tab |
| [PartoutSummary.tsx](../../../apps/web/src/components/features/set-lookup/PartoutSummary.tsx) | Summary cards |
| [PartoutTable.tsx](../../../apps/web/src/components/features/set-lookup/PartoutTable.tsx) | Parts breakdown |
| [usePartout.ts](../../../apps/web/src/hooks/usePartout.ts) | Data fetching hook |

---

## Related Journeys

- [Partout Value Overview](./overview.md) - Feature overview
- [Inventory Management](../inventory/overview.md) - Track partout pieces
