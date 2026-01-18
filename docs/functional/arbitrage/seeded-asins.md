# User Journey: Seeded ASIN Discovery

> **Journey:** Discover Amazon ASINs for Brickset sets and track them for arbitrage
> **Entry Point:** `/arbitrage/seeded`
> **Complexity:** High

## Overview

Seeded ASIN Discovery allows you to track arbitrage opportunities for LEGO sets you don't currently have in your Amazon inventory. It uses the Brickset database (18,000+ sets) and automatically discovers corresponding Amazon ASINs using EAN/UPC barcodes and title matching.

## User Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Seeded ASIN Discovery                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│  Discover and manage ASINs from Brickset database for arbitrage tracking   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌───────────┐┌───────────┐┌───────────┐┌───────────┐┌───────────┐┌──────┐│
│  │Total Sets ││  Pending  ││   Found   ││ Not Found ││ Multiple  ││ Avg  ││
│  │  18,234   ││   3,421   ││  14,012   ││    645    ││    156    ││ Conf ││
│  │           ││           ││   76.8%   ││           ││           ││ 92%  ││
│  └───────────┘└───────────┘└───────────┘└───────────┘└───────────┘└──────┘│
│                                                                             │
│  Discovery Actions                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Initialize seeded ASINs from Brickset or run ASIN discovery        │   │
│  │                                                                     │   │
│  │                                       [Initialize]  [Run Discovery] │   │
│  │                                                                     │   │
│  │   ███████████████████░░░░░░░  78%                                  │   │
│  │   Processing: LEGO 10281 Bonsai Tree                               │   │
│  │   782 / 1,000 processed                                            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Filters ▼                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ [Search set number, name, ASIN...]  [Status ▼] [Min Confidence ▼]  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  2 selected                                    [Enable Sync] [Disable Sync]│
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │☐│ Set              │ ASIN       │ Status    │Confidence│ RRP  │Sync │  │
│  ├──────────────────────────────────────────────────────────────────────┤  │
│  │☑│ 10281-1          │ B08GHWCV2J │ ✓ found   │   100%   │£44.99│ ☑   │  │
│  │ │ Bonsai Tree      │            │           │          │      │     │  │
│  │ │ Botanical (2021) │            │           │          │      │     │  │
│  ├──────────────────────────────────────────────────────────────────────┤  │
│  │☑│ 42141-1          │ B09WDRQP7M │ ✓ found   │    95%   │£169.99│ ☑  │  │
│  │ │ McLaren F1       │            │           │          │      │     │  │
│  │ │ Technic (2022)   │            │           │          │      │     │  │
│  ├──────────────────────────────────────────────────────────────────────┤  │
│  │☐│ 75192-1          │ —          │ ⏳ pending│    —     │£734.99│ ☐  │  │
│  │ │ Millennium Falcon│            │           │          │      │     │  │
│  │ │ Star Wars (2017) │            │           │          │      │     │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  Showing 1-50 of 18,234                              [Previous] [Next]      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Key Concepts

### Discovery Status

| Status | Description | Badge Color |
|--------|-------------|-------------|
| `pending` | Not yet attempted | Amber |
| `found` | ASIN discovered successfully | Green |
| `not_found` | No matching ASIN on Amazon UK | Red |
| `multiple` | Multiple potential matches | Purple |
| `excluded` | Excluded by user | Gray |

### Match Methods

| Method | Confidence | Description |
|--------|------------|-------------|
| `ean` | 100% | EAN barcode exact match |
| `upc` | 95% | UPC barcode exact match |
| `title_exact` | 85% | Set number found in Amazon title |
| `title_fuzzy` | 60-80% | Fuzzy matching on set name |

### Confidence Levels

| Range | Badge | Meaning |
|-------|-------|---------|
| 95%+ | Green | High confidence (barcode match) |
| 85-94% | Blue | Good confidence (exact set number) |
| 60-84% | Amber | Fair confidence (fuzzy match) |

### Sync Preference

Each seeded ASIN has a user-specific sync preference:
- **Enabled**: Include in arbitrage tracking and pricing sync
- **Disabled**: Don't sync pricing (saves API quota)

---

## Steps

### 1. Initialize from Brickset

**Action:** Click "Initialize" button

**What Happens:**
1. Calls `initialize_seeded_asins()` database function
2. Creates `seeded_asins` records for all `brickset_sets`
3. Sets initial status to `pending`
4. Shows count of created/skipped records

**Database Function:**
```sql
-- Creates seeded_asins records from brickset_sets
-- Uses SECURITY DEFINER to bypass RLS
CREATE FUNCTION initialize_seeded_asins()
RETURNS TABLE(created_count integer, skipped_count integer)
```

**Result Toast:**
```
Initialization complete
Created 1,234 new seeded ASIN records, 17,000 already existed.
```

### 2. Run ASIN Discovery

**Action:** Click "Run Discovery" button

**Discovery Limit Dialog:**
```
┌─────────────────────────────────────────────────────────────────────────┐
│  Run ASIN Discovery                                              [✕]   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Set how many sets to process. Enter 0 to process all 3,421 pending    │
│  sets. At ~2 seconds per set, 1000 sets takes about 30 minutes.        │
│                                                                         │
│  Limit: [1000        ]                                                 │
│                                                                         │
│         [100] [500] [1,000] [All]                                      │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                        [Cancel]  [Start Discovery]      │
└─────────────────────────────────────────────────────────────────────────┘
```

**Discovery Process:**

1. **Fetch pending sets** from `seeded_asins` with `discovery_status = 'pending'`

2. **For each set, try matching strategies in order:**

   **Strategy 1: EAN Lookup (100% confidence)**
   ```
   GET /catalog/2022-04-01/items
   identifiers=5702016617245
   identifiersType=EAN
   marketplaceIds=A1F83G8C2ARO7P  (UK)
   ```

   **Strategy 2: UPC Lookup (95% confidence)**
   ```
   GET /catalog/2022-04-01/items
   identifiers=673419355469
   identifiersType=UPC
   marketplaceIds=A1F83G8C2ARO7P
   ```

   **Strategy 3: Title Search - Exact (85% confidence)**
   ```
   GET /catalog/2022-04-01/items
   keywords=LEGO 10281
   marketplaceIds=A1F83G8C2ARO7P
   ```
   Filter results where title contains exact set number.

   **Strategy 4: Title Search - Fuzzy (60-80% confidence)**
   ```
   GET /catalog/2022-04-01/items
   keywords=Bonsai Tree
   marketplaceIds=A1F83G8C2ARO7P
   ```
   Score results using Levenshtein distance.

3. **Save result** to `seeded_asins` table

4. **Rate limiting:** 500ms between requests, 5s pause every 100 sets

**Progress Display:**
```
Discovery in progress...
███████████████████░░░░░░░  78%
Processing: LEGO 10281 Bonsai Tree
782 / 1,000 processed
```

### 3. View Discovery Results

**Action:** Browse the seeded ASINs table

**Table Columns:**
| Column | Description |
|--------|-------------|
| ☐ | Selection checkbox |
| Set | Set number, name, theme, year |
| ASIN | Discovered ASIN (or dash if not found) |
| Status | Discovery status badge |
| Confidence | Match confidence percentage |
| RRP | UK retail price from Brickset |
| Sync | Checkbox to enable/disable sync |

### 4. Filter Results

**Action:** Expand Filters panel

**Available Filters:**
| Filter | Options |
|--------|---------|
| Search | Set number, name, or ASIN |
| Status | All, Found, Not Found, Pending, Multiple |
| Min Confidence | Any, 60%+, 75%+, 85%+, 95%+ |

### 5. Enable/Disable Sync

**Single Item:** Click the sync checkbox

**Bulk Action:**
1. Select items using checkboxes
2. Click "Enable Sync" or "Disable Sync"

**What "Enable Sync" Does:**
1. Creates/updates `user_seeded_asin_preferences` record
2. Sets `include_in_sync = true`
3. Item will appear in arbitrage views
4. Pricing sync jobs will include this ASIN

### 6. Handle Multiple Matches

**Action:** Click on a "multiple" status item

**Multiple Matches Dialog:**
```
┌─────────────────────────────────────────────────────────────────────────┐
│  Multiple ASIN Matches for 10281-1                               [✕]   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Multiple Amazon products match this set. Select the correct one:       │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ ○ B08GHWCV2J - LEGO 10281 Bonsai Tree Botanical          (95%) │  │
│  │ ○ B08QXZ5P2N - LEGO Bonsai Tree 10281 Creator Expert     (90%) │  │
│  │ ○ B0BJ8T9V2M - LEGO Botanical Collection Bonsai          (75%) │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ○ None of these - mark as not found                                   │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                        [Cancel]  [Confirm Selection]    │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Technical Details

### Seeded ASIN Data Structure

```typescript
interface SeededAsinWithBrickset {
  id: string;
  bricksetSetId: string;
  asin: string | null;
  discoveryStatus: DiscoveryStatus;
  matchMethod: MatchMethod | null;
  matchConfidence: number | null;
  amazonTitle: string | null;
  amazonImageUrl: string | null;
  amazonBrand: string | null;
  alternativeAsins: AlternativeAsin[] | null;
  lastDiscoveryAttemptAt: string | null;
  discoveryAttempts: number;
  discoveryError: string | null;

  // Joined Brickset data
  bricksetSet: {
    id: string;
    setNumber: string;
    setName: string;
    theme: string | null;
    yearFrom: number | null;
    ukRetailPrice: number | null;
    imageUrl: string | null;
    pieces: number | null;
    ean: string | null;
    upc: string | null;
  };

  // User preference
  userPreference?: {
    includeInSync: boolean;
    userStatus: 'active' | 'excluded';
    manualAsinOverride: string | null;
  };
}
```

### Discovery Summary Stats

```typescript
interface DiscoverySummary {
  pending: number;        // Not yet attempted
  found: number;          // Successfully matched
  notFound: number;       // No Amazon match
  multiple: number;       // Needs user review
  excluded: number;       // User excluded
  total: number;          // Total seeded ASINs
  foundPercent: number;   // found / total * 100
  avgConfidence: number;  // Average match confidence
  lastDiscoveryAt: string | null;
}
```

### Rate Limiting Constants

```typescript
const DISCOVERY_RATE_LIMIT_MS = 500;    // 500ms between requests
const DISCOVERY_BATCH_SIZE = 100;       // Pause after every 100
const DISCOVERY_BATCH_PAUSE_MS = 5000;  // 5 second pause
```

### Duplicate ASIN Handling

If the same ASIN is discovered for multiple sets:
1. First set keeps the ASIN
2. Subsequent sets marked as `multiple`
3. ASIN stored in `alternative_asins`
4. Error message: "ASIN {asin} already assigned to another set"

---

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/arbitrage/discovery` | GET | Get discovery summary and status |
| `/api/arbitrage/discovery` | POST | Initialize or run discovery |
| `/api/arbitrage/seeded` | GET | List seeded ASINs with filters |
| `/api/arbitrage/seeded` | POST | Update sync preferences |

### Discovery POST Actions

```typescript
// Initialize seeded ASINs from Brickset
POST /api/arbitrage/discovery
{ "action": "initialize" }

// Run discovery for pending sets
POST /api/arbitrage/discovery
{ "action": "run", "limit": 1000 }
```

---

## Error Handling

### Corrupted Barcode Data

Some Brickset EAN/UPC values are corrupted (scientific notation):

```typescript
// Invalid: "5.70E+12" (scientific notation from import)
// Valid: "5702016617245" (13-digit EAN)

const isValidBarcode = (code: string | null): boolean => {
  if (!code) return false;
  if (code.includes('E+') || code.includes('e+')) return false;
  return /^\d{12,13}$/.test(code);
};
```

### Amazon API Rate Limit

```
⚠️ Discovery paused
Rate limit reached. Will resume in 60 seconds.
[Resume Now] [Cancel]
```

### Partial Failure

```
Discovery partially complete
Processed: 950 / 1,000
Found: 712
Not Found: 198
Errors: 40

[View Errors] [Retry Failed]
```

---

## Source Files

| File | Purpose |
|------|---------|
| [seeded/page.tsx](../../../apps/web/src/app/(dashboard)/arbitrage/seeded/page.tsx) | Main page component |
| [SeededAsinManager.tsx](../../../apps/web/src/components/features/arbitrage/SeededAsinManager.tsx) | Manager component |
| [seeded-discovery.service.ts](../../../apps/web/src/lib/arbitrage/seeded-discovery.service.ts) | Discovery service |
| [levenshtein.ts](../../../apps/web/src/lib/utils/levenshtein.ts) | Fuzzy matching utilities |
| [amazon-catalog.client.ts](../../../apps/web/src/lib/amazon/amazon-catalog.client.ts) | Amazon Catalog API |
| [discovery/route.ts](../../../apps/web/src/app/api/arbitrage/discovery/route.ts) | Discovery API |
| [seeded/route.ts](../../../apps/web/src/app/api/arbitrage/seeded/route.ts) | Seeded ASINs API |

## Related Journeys

- [Amazon Arbitrage](./amazon-arbitrage.md) - View seeded items in arbitrage
- [eBay Arbitrage](./ebay-arbitrage.md) - eBay pricing for seeded items
- [Amazon Integration](../amazon/overview.md) - Amazon SP-API used for discovery
