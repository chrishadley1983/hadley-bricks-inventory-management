# Feature Specification: partout-value

**Generated:** 2026-01-20
**Based on:** done-criteria.md (30 criteria)
**Status:** READY_FOR_BUILD

---

## 1. Summary

This feature adds a "Partout" tab to the Set Lookup page that displays the total value of a LEGO set's individual parts if sold separately on BrickLink. It includes a smart caching system that stores part prices (keyed by part number + colour) with a 6-month default freshness period to minimise BrickLink API calls. The feature helps users decide whether to part out a set vs sell complete, identifies high-value parts for completeness assessment, and shows sell-through rates. Parts are displayed in a sortable DataTable with full metrics (price, quantity, sell-through, stock, times sold).

---

## 2. Criteria Mapping

| Criterion | Implementation Approach |
|-----------|------------------------|
| **F1: Partout Tab Exists** | Add shadcn Tabs to SetDetailsCard area, with "Partout" as a tab |
| **F2: Tab Fetches Data** | React Query hook calls `/api/bricklink/partout?setNumber=XXX` |
| **F3-F4: POV New/Used** | Display POV totals in summary cards at top of tab |
| **F5-F6: Ratio New/Used** | Calculate ratio from POV / set price, display with colour coding |
| **F7: Parts List Columns** | DataTable with Image, Name, Colour, Qty, Price (N/U), Total, Sell-Through, Stock, Sold |
| **F8: Sorted by Value** | Default sort by `totalNew` descending |
| **F9: New/Used Pricing** | Show both columns side-by-side (no toggle needed) |
| **F10: Minifigures** | BrickLink subsets API includes MINIFIG type items |
| **C1: Cache Table** | Supabase migration creates `bricklink_part_price_cache` |
| **C2: Part + Colour Key** | Composite unique constraint on (part_number, colour_id) |
| **C3-C4: Freshness Check** | Service checks `fetched_at` vs env var `PARTOUT_CACHE_FRESHNESS_DAYS` |
| **C5-C6: Cache Miss → API** | Uncached/stale parts fetched from BrickLink, upserted to cache |
| **C7: Batched API Calls** | Process 50 parts per batch, 1s delay between batches |
| **C8: Cache Summary** | Display "X/Y parts from cache" in UI |
| **U1-U2: Ratio Indicator** | Green text + "Part Out" label if ratio > 1, red + "Sell Complete" if ≤ 1 |
| **U3: Loading Skeleton** | Skeleton component while fetching |
| **U4-U5: Formatting** | `formatCurrency` for £, percentage for sell-through |
| **U6: DataTable** | Use existing DataTable component with pagination |
| **U7: Progressive Loading** | Progress bar during batch API fetching |
| **E1: API Failure** | Error state with retry button |
| **E2: No Data** | Empty state message |
| **E3: Missing Price** | "N/A" for ratio when set price unavailable |
| **E4: Partial Failure** | Show successful parts + warning |
| **P1: < 5s Cached** | Cache queries are fast; target met |
| **P2: Large List** | DataTable pagination handles 500+ parts |
| **P3: < 60s Uncached** | Batching with delays allows 500 parts in ~10 batches = ~10s |
| **I1: Tab Disabled** | Tab disabled until `lookupMutation.isSuccess` |
| **I2: API Route** | Create `/api/bricklink/partout/route.ts` |
| **I3: BrickLink Creds** | Reuse existing BrickLink credential loading pattern |
| **I4: Migration** | Create migration file for cache table |

---

## 3. Architecture

### 3.1 Integration Points

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              UI Layer                                    │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ set-lookup/page.tsx                                                │  │
│  │                                                                    │  │
│  │  ┌──────────────────────┐  ┌─────────────────────────────────┐   │  │
│  │  │ SetLookupForm        │  │ Tabs                             │   │  │
│  │  └──────────────────────┘  │ ┌───────┐ ┌─────────┐ ┌───────┐ │   │  │
│  │                             │ │Details│ │ Stock   │ │Partout│ │   │  │
│  │  ┌──────────────────────┐  │ └───────┘ └─────────┘ └───────┘ │   │  │
│  │  │ SetDetailsCard       │  │           TabsContent            │   │  │
│  │  └──────────────────────┘  │ ┌─────────────────────────────┐ │   │  │
│  │                             │ │ PartoutTab (NEW)            │ │   │  │
│  │  ┌──────────────────────┐  │ │ - POV Summary Cards         │ │   │  │
│  │  │ SetStockCard         │  │ │ - Cache Status              │ │   │  │
│  │  └──────────────────────┘  │ │ - Parts DataTable           │ │   │  │
│  │                             │ └─────────────────────────────┘ │   │  │
│  │                             └─────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────────────┤
│                              API Layer                                   │
│                                                                          │
│  GET /api/bricklink/partout?setNumber=XXX                               │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ 1. Validate auth + input                                           │  │
│  │ 2. Call PartoutService.getPartoutValue(setNumber)                  │  │
│  │ 3. Return PartoutData JSON                                         │  │
│  └───────────────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────────────┤
│                            Service Layer                                 │
│                                                                          │
│  PartoutService                                                          │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ getPartoutValue(setNumber):                                        │  │
│  │ 1. BrickLinkClient.getSubsets(setNumber) → parts list             │  │
│  │ 2. PartPriceCacheService.getCachedPrices(parts) → split cached/   │  │
│  │    uncached                                                        │  │
│  │ 3. For uncached: batch fetch from BrickLink (50/batch, 1s delay)  │  │
│  │ 4. PartPriceCacheService.upsertPrices(freshPrices)                │  │
│  │ 5. Combine + calculate totals                                      │  │
│  │ 6. Return PartoutData                                              │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  PartPriceCacheService                                                   │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ getCachedPrices(parts[]) → { cached, uncached }                   │  │
│  │ upsertPrices(prices[]) → void                                      │  │
│  │ isFresh(fetchedAt) → boolean (checks FRESHNESS_DAYS env)           │  │
│  └───────────────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────────────┤
│                         BrickLink Client                                 │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ Existing: getPriceGuide(), getSetPriceGuide()                      │  │
│  │ NEW: getSubsets(type, no) → SubsetEntry[]                         │  │
│  │ NEW: getPartPriceGuide(type, no, colorId, options) → PriceGuide   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────────────┤
│                           Database Layer                                 │
│                                                                          │
│  bricklink_part_price_cache                                             │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ id, part_number, part_type, colour_id, colour_name,               │  │
│  │ price_new, price_used, sell_through_rate, stock_available,        │  │
│  │ times_sold, fetched_at, created_at, updated_at                    │  │
│  │                                                                    │  │
│  │ UNIQUE(part_number, colour_id)                                    │  │
│  │ INDEX(part_number), INDEX(fetched_at)                             │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Tab implementation** | shadcn/ui Tabs | Consistent with project patterns (InventoryAddTabs) |
| **Parts table** | Existing DataTable | Already supports pagination, sorting, 500+ rows |
| **Cache storage** | Supabase table | Persistent, queryable, supports upsert |
| **Batch delay** | 1 second | BrickLink rate limit is 5000/day; safe margin |
| **Batch size** | 50 parts | Balance between speed and API safety |
| **Freshness default** | 180 days | Parts prices change slowly; 6 months is reasonable |
| **Price source** | BrickLink "stock" guide | Current listings, not historical sales |
| **Currency** | GBP fixed | Consistent with existing pricing; no conversion |

### 3.3 BrickLink API Endpoints Required

| Endpoint | Purpose | Currently Implemented? |
|----------|---------|------------------------|
| `GET /items/SET/{no}/subsets` | Get parts list for a set | **NO - needs adding** |
| `GET /items/{type}/{no}/price` | Get price guide for part | YES - `getPriceGuide()` |
| `GET /items/SET/{no}/price` | Get set price (for ratio) | YES - `getSetPriceGuide()` |

---

## 4. File Changes

### 4.1 New Files

| File | Purpose | Est. Lines |
|------|---------|------------|
| `supabase/migrations/YYYYMMDD_create_part_price_cache.sql` | Database migration | 25 |
| `apps/web/src/app/api/bricklink/partout/route.ts` | API endpoint | 80 |
| `apps/web/src/lib/bricklink/partout.service.ts` | Business logic | 200 |
| `apps/web/src/lib/bricklink/part-price-cache.service.ts` | Cache service | 100 |
| `apps/web/src/components/features/set-lookup/PartoutTab.tsx` | UI component | 250 |
| `apps/web/src/components/features/set-lookup/PartoutSummary.tsx` | Summary cards | 80 |
| `apps/web/src/components/features/set-lookup/PartoutTable.tsx` | Parts table | 150 |
| `apps/web/src/hooks/usePartout.ts` | React Query hook | 40 |
| `apps/web/src/types/partout.ts` | Type definitions | 60 |

**Total new: ~985 lines across 9 files**

### 4.2 Modified Files

| File | Changes | Est. Lines Changed |
|------|---------|-------------------|
| `apps/web/src/app/(dashboard)/set-lookup/page.tsx` | Add Tabs wrapper, PartoutTab | 40 |
| `apps/web/src/lib/bricklink/client.ts` | Add `getSubsets()` method | 30 |
| `apps/web/src/lib/bricklink/types.ts` | Add `SubsetEntry`, `PartoutData` types | 50 |
| `apps/web/src/components/features/brickset/index.ts` | Export new components | 5 |

**Total modified: ~125 lines across 4 files**

### 4.3 No Changes Needed

| File | Reason |
|------|--------|
| `apps/web/src/components/ui/data-table.tsx` | Already supports pagination, sorting |
| `apps/web/src/components/ui/tabs.tsx` | Already exists, ready to use |
| Existing BrickLink API routes | Separate route, no modification needed |

---

## 5. Implementation Details

### 5.1 Database Migration

```sql
-- Migration: create_bricklink_part_price_cache

CREATE TABLE bricklink_part_price_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_number VARCHAR(50) NOT NULL,
  part_type VARCHAR(20) NOT NULL DEFAULT 'PART',
  colour_id INTEGER NOT NULL,
  colour_name VARCHAR(100),
  price_new DECIMAL(10,4),
  price_used DECIMAL(10,4),
  sell_through_rate DECIMAL(5,2),
  stock_available INTEGER,
  times_sold INTEGER,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT bricklink_part_price_cache_unique_part_colour
    UNIQUE (part_number, colour_id)
);

CREATE INDEX idx_bricklink_part_price_cache_part
  ON bricklink_part_price_cache(part_number);
CREATE INDEX idx_bricklink_part_price_cache_fetched
  ON bricklink_part_price_cache(fetched_at);

-- RLS: Allow service role full access (no user-specific data)
ALTER TABLE bricklink_part_price_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage cache"
  ON bricklink_part_price_cache
  FOR ALL
  USING (true)
  WITH CHECK (true);
```

### 5.2 BrickLink Client Extension

```typescript
// In client.ts - add getSubsets method

interface SubsetEntry {
  match_no: number;
  entries: Array<{
    item: {
      no: string;
      name: string;
      type: BrickLinkItemType;
      category_id: number;
    };
    color_id: number;
    color_name?: string;
    quantity: number;
    extra_quantity?: number;
    is_alternate?: boolean;
    is_counterpart?: boolean;
  }>;
}

async getSubsets(
  type: BrickLinkItemType,
  no: string,
  options: { breakMinifigs?: boolean; breakSets?: boolean } = {}
): Promise<SubsetEntry[]> {
  const queryParams: Record<string, string | undefined> = {};

  if (options.breakMinifigs !== undefined) {
    queryParams.break_minifigs = options.breakMinifigs ? 'true' : 'false';
  }
  if (options.breakSets !== undefined) {
    queryParams.break_sets = options.breakSets ? 'true' : 'false';
  }

  const endpoint = `/items/${type}/${encodeURIComponent(no)}/subsets`;
  return this.request<SubsetEntry[]>('GET', endpoint, queryParams);
}
```

### 5.3 Partout Service

```typescript
// partout.service.ts

export class PartoutService {
  constructor(
    private brickLinkClient: BrickLinkClient,
    private cacheService: PartPriceCacheService,
    private supabase: SupabaseClient
  ) {}

  async getPartoutValue(
    setNumber: string,
    onProgress?: (fetched: number, total: number) => void
  ): Promise<PartoutData> {
    // 1. Get parts list from BrickLink
    const subsets = await this.brickLinkClient.getSubsets('SET', setNumber, {
      breakMinifigs: false, // Keep minifigs as items, don't break into parts
    });

    // 2. Flatten parts list
    const parts = this.flattenSubsets(subsets);

    // 3. Check cache for each part+colour
    const { cached, uncached } = await this.cacheService.getCachedPrices(parts);

    // 4. Fetch uncached parts in batches
    const freshPrices = await this.fetchUncachedPrices(uncached, onProgress);

    // 5. Upsert fresh prices to cache
    await this.cacheService.upsertPrices(freshPrices);

    // 6. Get set prices for ratio calculation
    const [setPriceNew, setPriceUsed] = await Promise.all([
      this.getSetPrice(setNumber, 'N'),
      this.getSetPrice(setNumber, 'U'),
    ]);

    // 7. Combine and calculate
    const allPrices = [...cached, ...freshPrices];
    const povNew = this.calculateTotalPOV(allPrices, 'new');
    const povUsed = this.calculateTotalPOV(allPrices, 'used');

    return {
      setNumber,
      totalParts: parts.length,
      povNew,
      povUsed,
      setPrice: {
        new: setPriceNew,
        used: setPriceUsed,
      },
      ratioNew: setPriceNew ? povNew / setPriceNew : null,
      ratioUsed: setPriceUsed ? povUsed / setPriceUsed : null,
      recommendation: (povNew / (setPriceNew || Infinity)) > 1 ? 'part-out' : 'sell-complete',
      cacheStats: {
        fromCache: cached.length,
        fromApi: freshPrices.length,
        total: parts.length,
      },
      parts: this.buildPartsList(allPrices, parts),
    };
  }

  private async fetchUncachedPrices(
    parts: PartIdentifier[],
    onProgress?: (fetched: number, total: number) => void
  ): Promise<PartPrice[]> {
    const BATCH_SIZE = 50;
    const BATCH_DELAY_MS = 1000;
    const results: PartPrice[] = [];

    for (let i = 0; i < parts.length; i += BATCH_SIZE) {
      const batch = parts.slice(i, i + BATCH_SIZE);

      // Fetch batch in parallel
      const batchResults = await Promise.allSettled(
        batch.map(part => this.fetchPartPrice(part))
      );

      // Collect successful results
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        }
      }

      onProgress?.(Math.min(i + BATCH_SIZE, parts.length), parts.length);

      // Delay between batches (except last)
      if (i + BATCH_SIZE < parts.length) {
        await this.delay(BATCH_DELAY_MS);
      }
    }

    return results;
  }
}
```

### 5.4 API Route

```typescript
// /api/bricklink/partout/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getBrickLinkClient } from '@/lib/bricklink';
import { PartoutService } from '@/lib/bricklink/partout.service';
import { PartPriceCacheService } from '@/lib/bricklink/part-price-cache.service';

const QuerySchema = z.object({
  setNumber: z.string().min(1),
});

export async function GET(request: NextRequest) {
  try {
    // 1. Auth check
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Validate input
    const { searchParams } = new URL(request.url);
    const parsed = QuerySchema.safeParse({
      setNumber: searchParams.get('setNumber'),
    });
    if (!parsed.success) {
      return NextResponse.json({
        error: 'Invalid set number',
        details: parsed.error.flatten()
      }, { status: 400 });
    }

    // 3. Get BrickLink client
    const brickLinkClient = await getBrickLinkClient(supabase);
    if (!brickLinkClient) {
      return NextResponse.json({
        error: 'BrickLink not configured'
      }, { status: 400 });
    }

    // 4. Execute partout service
    const cacheService = new PartPriceCacheService(supabase);
    const partoutService = new PartoutService(brickLinkClient, cacheService, supabase);

    const data = await partoutService.getPartoutValue(parsed.data.setNumber);

    return NextResponse.json({ data });

  } catch (error) {
    console.error('[GET /api/bricklink/partout] Error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Internal server error'
    }, { status: 500 });
  }
}
```

### 5.5 React Component Structure

```typescript
// PartoutTab.tsx

export function PartoutTab({
  setNumber,
  enabled
}: {
  setNumber: string | null;
  enabled: boolean;
}) {
  const { data, isLoading, error, refetch } = usePartout(setNumber, enabled);

  if (!enabled || !setNumber) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Look up a set to see partout value
      </div>
    );
  }

  if (isLoading) {
    return <PartoutSkeleton />;
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Failed to load partout data</AlertTitle>
        <AlertDescription className="flex items-center justify-between">
          <span>{error.message}</span>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!data || data.parts.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No partout data available for this set
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PartoutSummary data={data} />
      <PartoutTable parts={data.parts} />
    </div>
  );
}
```

### 5.6 Data Flow

```
1. User looks up set on Set Lookup page
   └─> lookupMutation succeeds, currentSet populated

2. User clicks "Partout" tab
   └─> TabsContent renders PartoutTab
   └─> usePartout hook triggers with setNumber

3. usePartout calls GET /api/bricklink/partout?setNumber=XXX
   └─> API validates auth + input
   └─> PartoutService.getPartoutValue() called

4. PartoutService execution:
   a. BrickLinkClient.getSubsets() → parts list from BrickLink
   b. PartPriceCacheService.getCachedPrices() → split cached/uncached
   c. For uncached parts (in batches of 50, 1s delay):
      - BrickLinkClient.getPriceGuide() for each
      - Collect results
   d. PartPriceCacheService.upsertPrices() → save fresh prices
   e. Calculate POV totals, ratios, recommendation
   f. Return PartoutData

5. UI renders:
   - PartoutSummary: POV New/Used, Ratio, Recommendation
   - Cache status: "X/Y parts from cache"
   - PartoutTable: DataTable with parts, sorted by value
```

---

## 6. Build Order

### Phase 1: Database & Types (Foundation)
1. Create migration file `supabase/migrations/YYYYMMDDHHMMSS_create_part_price_cache.sql`
2. Push migration: `npm run db:push`
3. Regenerate types: `npm run db:types`
4. Create `apps/web/src/types/partout.ts` with type definitions

### Phase 2: BrickLink Client Extension
5. Add `SubsetEntry` type to `types.ts`
6. Add `getSubsets()` method to `client.ts`
7. Test with curl/Postman against BrickLink API

### Phase 3: Cache Service
8. Create `part-price-cache.service.ts`
9. Implement `getCachedPrices()` and `upsertPrices()`
10. Test cache operations

### Phase 4: Partout Service
11. Create `partout.service.ts`
12. Implement `getPartoutValue()` with batching logic
13. Unit test the service

### Phase 5: API Route
14. Create `/api/bricklink/partout/route.ts`
15. Wire up service, add error handling
16. Test API endpoint

### Phase 6: UI Components
17. Create `PartoutSummary.tsx` - summary cards with POV/ratio
18. Create `PartoutTable.tsx` - parts DataTable
19. Create `PartoutTab.tsx` - container component
20. Create `usePartout.ts` hook

### Phase 7: Integration
21. Modify `set-lookup/page.tsx` to add Tabs wrapper
22. Add PartoutTab to TabsContent
23. Test full flow end-to-end

### Phase 8: Polish
24. Add loading skeleton
25. Add progress indicator for batch fetching
26. Handle edge cases (empty, errors, partial failures)
27. Performance testing with large sets

---

## 7. Risk Assessment

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| BrickLink rate limit (5000/day) | Medium | High | Caching reduces calls; batching prevents bursts |
| Large set timeout (500+ parts) | Medium | Medium | Batching + delays; 60s is acceptable |
| BrickLink API change | Low | High | Wrap in try-catch; graceful degradation |
| Cache table grows too large | Low | Low | `fetched_at` index allows cleanup job later |
| Part not found in price guide | Medium | Low | Handle gracefully; exclude from totals with warning |

### Scope Risks

| Risk | Mitigation |
|------|------------|
| Temptation to add inventory integration | Explicitly out of scope in criteria |
| Request for multiple currencies | GBP only per criteria; future feature |
| Request for price history | Cache overwrites, no versioning per criteria |

### Integration Risks

| Risk | Probability | Mitigation |
|------|-------------|------------|
| BrickLink creds not configured | Medium | Check early; show "Configure BrickLink" message |
| Set not in BrickLink catalog | Low | Handle 404; show empty state |
| Subsets endpoint returns unexpected format | Low | Strict type validation; fallback to empty |

---

## 8. Feasibility Validation

| Criterion | Feasible | Confidence | Notes |
|-----------|----------|------------|-------|
| F1: Partout Tab | ✅ Yes | High | shadcn Tabs ready |
| F2: Fetches Data | ✅ Yes | High | Standard React Query pattern |
| F3-F4: POV Display | ✅ Yes | High | Simple calculation + display |
| F5-F6: Ratio Display | ✅ Yes | High | Division + colour coding |
| F7: Parts Columns | ✅ Yes | High | DataTable supports this |
| F8: Sort by Value | ✅ Yes | High | DataTable default sort |
| F9: N/U Pricing | ✅ Yes | High | Side-by-side columns |
| F10: Minifigures | ✅ Yes | High | BrickLink subsets includes them |
| C1-C2: Cache Table | ✅ Yes | High | Standard migration |
| C3-C4: Freshness | ✅ Yes | High | Timestamp comparison |
| C5-C6: API Fetch | ✅ Yes | High | BrickLink API available |
| C7: Batching | ✅ Yes | High | Standard async batching |
| C8: Cache Summary | ✅ Yes | High | Simple counter display |
| U1-U7: UI/UX | ✅ Yes | High | Existing patterns |
| E1-E4: Error Handling | ✅ Yes | High | Standard patterns |
| P1: < 5s Cached | ✅ Yes | High | DB query is fast |
| P2: Large List | ✅ Yes | High | DataTable pagination |
| P3: < 60s Uncached | ✅ Yes | Medium | Depends on BrickLink response times |
| I1-I4: Integration | ✅ Yes | High | Standard patterns |

**Issues:** None - all criteria feasible.

---

## 9. Notes for Build Agent

### Key Implementation Hints

1. **BrickLink Subsets API**: The endpoint is `GET /items/{type}/{no}/subsets`. It returns nested arrays grouped by "match_no". Flatten these to get all parts.

2. **Break Minifigs**: Set `break_minifigs=false` to keep minifigures as items (not break into parts). Users want to see minifig values.

3. **Sell-Through Rate**: BrickLink price guide doesn't directly return this. Calculate from `total_quantity / unit_quantity` or use the "sold" guide type to get sales data.

4. **Stock Available**: Get from the "stock" guide type's `total_quantity` field.

5. **Times Sold**: Get from the "sold" guide type's `total_quantity` field.

6. **Colour Names**: BrickLink subsets response may include `color_name`. If not, may need a colour lookup table.

7. **Image URLs**: Part images from BrickLink follow pattern: `https://img.bricklink.com/ItemImage/PT/{color_id}/{part_number}.png`

8. **Error Handling**: If a part's price guide returns 404, log it but continue. Some rare parts may not have price data.

9. **Upsert Pattern**: Use Supabase's `upsert` with `onConflict: 'part_number,colour_id'` for cache updates.

10. **Environment Variable**: Access `PARTOUT_CACHE_FRESHNESS_DAYS` via `process.env.PARTOUT_CACHE_FRESHNESS_DAYS || '180'`.

### Testing Recommendations

- **Small set test**: 75192-1 (UCS Falcon) has 7500+ parts - too large for initial testing
- **Medium set test**: 75192-1 may timeout; use smaller sets first
- **Good test sets**:
  - `31088-1` (Creator Deep Sea Creatures) - ~230 parts
  - `40760-1` (BrickHeadz) - ~175 parts
  - `10281-1` (Bonsai Tree) - ~878 parts

### Dependencies

- BrickLink API credentials must be configured
- Supabase connection must be available
- Migration must be pushed before testing

---

## 10. Appendix: Type Definitions

```typescript
// types/partout.ts

export interface PartoutData {
  setNumber: string;
  totalParts: number;
  povNew: number;
  povUsed: number;
  setPrice: {
    new: number | null;
    used: number | null;
  };
  ratioNew: number | null;
  ratioUsed: number | null;
  recommendation: 'part-out' | 'sell-complete';
  cacheStats: {
    fromCache: number;
    fromApi: number;
    total: number;
  };
  parts: PartValue[];
}

export interface PartValue {
  partNumber: string;
  partType: 'PART' | 'MINIFIG' | 'GEAR' | 'SET';
  name: string;
  colourId: number;
  colourName: string;
  imageUrl: string;
  quantity: number;
  priceNew: number | null;
  priceUsed: number | null;
  totalNew: number;
  totalUsed: number;
  sellThroughRate: number | null;
  stockAvailable: number | null;
  timesSold: number | null;
  fromCache: boolean;
}

export interface PartIdentifier {
  partNumber: string;
  partType: BrickLinkItemType;
  colourId: number;
  quantity: number;
}

export interface CachedPartPrice {
  partNumber: string;
  partType: string;
  colourId: number;
  colourName: string | null;
  priceNew: number | null;
  priceUsed: number | null;
  sellThroughRate: number | null;
  stockAvailable: number | null;
  timesSold: number | null;
  fetchedAt: Date;
}
```

---

**Status:** READY_FOR_BUILD

**Next step:**
```powershell
/build-feature partout-value
```
