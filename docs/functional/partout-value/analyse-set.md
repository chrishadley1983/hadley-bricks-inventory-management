# Journey: Analyse Set Partout Value

> **Entry Point:** `/set-lookup`
> **Prerequisites:** BrickLink API credentials configured
> **Complexity:** Low

## Purpose

Look up any LEGO set and determine whether it's more profitable to sell the set complete or break it into individual parts for sale on BrickLink.

---

## Key Concepts

### When to Part Out

The screen answers this for you — the verdict clears a **2.0x POV multiple AND a £10 gap**,
not the old `ratio > 1` test. Supporting reasons to part out anyway:
- Magnets present (scarce, fast-moving lots that pull traffic to the store)
- Most lots land in the high STR bands, so the realisable rung holds up
- Overlap is mostly NEW / RESTOCK rather than DUPLICATE
- Set is incomplete or damaged, so it can't be sold whole

### When to Sell Complete

- The gate isn't cleared — at a 1.0–2.0x multiple the bench time isn't repaid
- Retired exclusive sets and premium boxes carry a complete-set premium
- Value is concentrated in a handful of slow lots (check "Where the value sits")

### When there's no complete-set price

You get `PART-OUT BELOW £X` (or `NOT WORTH PARTING OUT`), not "insufficient data". No set
price means no sell-complete comparison — but the acquisition question still has an
answer, and that's the actionable half: buy under £X and the part-out works.

`SKIP` now means only one thing: no priced parts at all, so there is nothing to value.

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

### Step 4: Read the assessment

The assessment panel leads. Read it in this order:

| Card | Shows |
|------|-------|
| **Assessment** | The verdict, why, and the POV multiple / gap against their gates |
| **Part-Out Value** | Gross → Realisable → **Net**. Only Net is money we'd see. |
| **Max buy** | Ceiling at 20% margin, and whether the current set price is within it |

Then the supporting cards: sell-through depth, where the value sits, magnets, and store
overlap. An amber banner warns when unpriced lots are understating everything above.

### Step 5: Toggle Condition

1. Use the **New / Used** tabs next to the "Part-Out Assessment" heading
2. The whole assessment, the parts table AND the BrickLink cross-check follow the toggle
3. New is selected by default

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

### A real "Sell Complete" (75192-1, July 2026)

```
Set price (New):  £878.11
Gross POV:        £905.89     <- flatters: every lot at guide price
Realisable:       £396.77     (44% capture)
Net:              £359.47     <- the decision figure, after 9.4% fees
POV multiple:     1.03x       (gate 2.00x)
Gap:              £27.78      (gate £10.00)
Max buy @ 20%:    £280.12     -> £597.99 over the current set price

Verdict: SELL COMPLETE
```

Note how far apart gross and net are. On the old `ratio > 1` model this set read as a
marginal part-out at 1.03x; on the gate it is clearly not worth the bench time.

### The BrickLink cross-check

The card below the assessment shows BrickLink's own published POV for the same set:
£910.71, a 0.5% difference from our **gross** rung. That agreement is the point — the two
diverge only after the liquidity haircut and fees, which is exactly what the
reconciliation note on the card says. BL's `1.24x` divides by RRP (£734.99); our `1.03x`
divides by what the set actually costs today (£878.11). Only ours drives the gate.

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
