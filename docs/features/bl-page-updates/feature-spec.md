# Feature Specification: bl-page-updates

**Generated:** 2026-01-28
**Based on:** done-criteria.md (31 criteria)
**Status:** READY_FOR_BUILD

---

## 1. Summary

This feature consolidates the separate BrickLink, eBay, and Seeded ASINs arbitrage pages into a single unified `/arbitrage` route with tab-based navigation. It replaces the "Margin %" metric with "COG %" (Cost of Goods percentage), adds clickable column headers for sorting with URL persistence, fixes the sync status display to show actual database timestamps instead of hardcoded schedules, and introduces per-ASIN minimum BrickLink price overrides to handle data quality issues from sellers with artificially low prices.

The implementation is primarily frontend-only, reusing existing API routes and hooks. One database schema change is required to add the `min_bl_price_override` column to the `asin_bricklink_mapping` table.

---

## 2. Criteria Mapping

| Criterion | Implementation Approach |
|-----------|------------------------|
| **F1: Unified Route** | Create new `/arbitrage/page.tsx` with tabbed layout |
| **F2: Tab Navigation** | Use shadcn/ui `Tabs` component with 3 tabs |
| **F3: Default Tab** | BrickLink tab as `defaultValue` |
| **F4: Tab Switching** | Client-side tab switching, no page reload |
| **F5-F6: Old Route Redirects** | Create `redirect()` in old page.tsx files |
| **F7: Vinted Separate** | No changes to `/arbitrage/vinted/*` |
| **F8: Page Title** | Dynamic title based on active tab |
| **F9: COG Column** | Replace "Margin" header with "COG %" in table |
| **F10: COG Badge Color** | Existing pattern from eBay page (green <=40%, amber 41-50%) |
| **F11: Max COG Filter** | Already exists in ArbitrageFilters, ensure default=50 |
| **F12: COG Filter on Load** | Set initial filter state with maxCog=50, show=opportunities |
| **F13: Opportunities Uses COG** | Summary card already uses COG threshold |
| **F14-16: Column Sorting** | Add onClick handlers to `<th>` elements with sort icons |
| **F17: Default Sort** | Initial sort: COG % ascending |
| **F18: All Columns Sortable** | Map all column headers to sortField values |
| **F19: Sort in URL** | Use `useSearchParams` for sort state |
| **F20-24: Sync Status** | Update SyncStatusBadge to use `lastRunAt`, add tooltip |
| **F25: API Docs** | Create `bricklink-api-limitations.md` |
| **F26: Min BL Price Field** | Add input to ArbitrageDetailModal |
| **F27-28: Override Persistence** | Add column to `asin_bricklink_mapping`, update API |
| **F29: Override in COG Calc** | Modify display logic to use MAX(blMin, override) |
| **F30: Override Indicator** | Add asterisk/icon to BL Min cell when override set |
| **F31: Clear Override** | Add reset button in detail modal |
| **E1: Empty State** | Already exists, verify filter reset option |
| **E2: Sync Error Display** | Add errorMessage to tooltip |
| **E3: Tab Error Isolation** | React error boundary per tab |
| **P1-P3: Performance** | No architectural changes needed |
| **U1-U4: UI Consistency** | Reuse existing components from eBay page |
| **I1: Sidebar Update** | Update Sidebar.tsx nav items |
| **I2: Reuse Hooks** | Import existing hooks |
| **I3: API Unchanged** | Frontend-only (except override field) |

---

## 3. Architecture

### 3.1 Integration Points

| Layer | Location | Integration |
|-------|----------|-------------|
| **UI (Page)** | `apps/web/src/app/(dashboard)/arbitrage/page.tsx` | New unified page |
| **UI (Redirects)** | `apps/web/src/app/(dashboard)/arbitrage/amazon/page.tsx` | Redirect to `/arbitrage?tab=bricklink` |
| **UI (Redirects)** | `apps/web/src/app/(dashboard)/arbitrage/ebay/page.tsx` | Redirect to `/arbitrage?tab=ebay` |
| **UI (Redirects)** | `apps/web/src/app/(dashboard)/arbitrage/seeded/page.tsx` | Redirect to `/arbitrage?tab=seeded` |
| **UI (Table)** | `apps/web/src/components/features/arbitrage/ArbitrageTable.tsx` | Add sortable headers |
| **UI (Modal)** | `apps/web/src/components/features/arbitrage/ArbitrageDetailModal.tsx` | Add override field |
| **UI (Nav)** | `apps/web/src/components/layout/Sidebar.tsx` | Update nav items |
| **Data** | `apps/web/src/hooks/use-arbitrage.ts` | Add override mutation |
| **API** | `apps/web/src/app/api/arbitrage/[asin]/route.ts` | Add PATCH for override |
| **Database** | `asin_bricklink_mapping` table | Add `min_bl_price_override` column |

### 3.2 Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         /arbitrage (Unified Page)                        │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  TabsList                                                        │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │    │
│  │  │ BrickLink    │  │ eBay         │  │ Seeded       │           │    │
│  │  │ (1210)       │  │ (432)        │  │ (156)        │           │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘           │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  TabsContent (active tab)                                        │    │
│  │                                                                  │    │
│  │  ┌───────────────────────────────────────────────────────────┐  │    │
│  │  │  Summary Cards (Total | Opportunities | Unmapped | Excluded)│  │    │
│  │  └───────────────────────────────────────────────────────────┘  │    │
│  │                                                                  │    │
│  │  ┌───────────────────────────────────────────────────────────┐  │    │
│  │  │  Sync Status Card (Amazon Inv | Amazon Price | BL | eBay) │  │    │
│  │  │  [Shows lastRunAt, status indicator, hover tooltip]        │  │    │
│  │  └───────────────────────────────────────────────────────────┘  │    │
│  │                                                                  │    │
│  │  ┌───────────────────────────────────────────────────────────┐  │    │
│  │  │  ArbitrageFilters                                          │  │    │
│  │  │  [Max COG: 50%] [Show: All Items ▼] [Sort: COG % ▼] [↑]   │  │    │
│  │  └───────────────────────────────────────────────────────────┘  │    │
│  │                                                                  │    │
│  │  ┌───────────────────────────────────────────────────────────┐  │    │
│  │  │  ArbitrageTable (with sortable headers)                    │  │    │
│  │  │  ┌────────┬────────┬────────┬────────┬────────┬────────┐  │  │    │
│  │  │  │ Item ↕ │ Price ↕│ BuyBox↕│ BL Min↕│ COG% ↕ │ Lots ↕ │  │  │    │
│  │  │  ├────────┼────────┼────────┼────────┼────────┼────────┤  │  │    │
│  │  │  │ ...    │ ...    │ ...    │ £4.50* │ 35.2%  │ 5      │  │  │    │
│  │  │  │        │        │        │ (ovr)  │        │        │  │  │    │
│  │  │  └────────┴────────┴────────┴────────┴────────┴────────┘  │  │    │
│  │  └───────────────────────────────────────────────────────────┘  │    │
│  │                                                                  │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘

                                    │
                                    │ onClick row
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      ArbitrageDetailModal                                │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  BrickLink Stock (UK, New)                                         │  │
│  │  ┌─────────┬─────────┬─────────┐                                   │  │
│  │  │ Min     │ Avg     │ Max     │                                   │  │
│  │  │ £4.50   │ £8.00   │ £18.00  │                                   │  │
│  │  └─────────┴─────────┴─────────┘                                   │  │
│  │                                                                     │  │
│  │  Min BL Price Override: [£8.00    ] [Clear]                        │  │
│  │  ───────────────────────────────────                               │  │
│  │  Effective price: £8.00 (override active)                          │  │
│  │                                                                     │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Tab State** | URL query param (`?tab=bricklink`) | Shareable URLs, browser back button works |
| **Sort State** | URL query params (`?sortField=cog&sortDirection=asc`) | Persistent across refresh, shareable |
| **Override Storage** | New column in existing table | Minimal schema change, keeps data with mapping |
| **Sort Implementation** | Server-side via existing API | Already supports sortField/sortDirection |
| **Tab Content** | Shared components with different filter defaults | Reduces code duplication |

---

## 4. File Changes

### 4.1 New Files

| File | Purpose | Est. Lines |
|------|---------|------------|
| `apps/web/src/app/(dashboard)/arbitrage/page.tsx` | Unified arbitrage page with tabs | 350-400 |
| `apps/web/src/app/(dashboard)/arbitrage/loading.tsx` | Loading skeleton | 20 |
| `docs/features/bl-page-updates/bricklink-api-limitations.md` | API limitation documentation | 50 |
| `supabase/migrations/20260128_add_bl_price_override.sql` | Add override column | 25 |

### 4.2 Modified Files

| File | Changes | Est. Lines Changed |
|------|---------|-------------------|
| `apps/web/src/app/(dashboard)/arbitrage/amazon/page.tsx` | Replace with redirect | -680, +5 |
| `apps/web/src/app/(dashboard)/arbitrage/ebay/page.tsx` | Replace with redirect | -680, +5 |
| `apps/web/src/app/(dashboard)/arbitrage/seeded/page.tsx` | Replace with redirect | -500, +5 |
| `apps/web/src/components/features/arbitrage/ArbitrageTable.tsx` | Add sortable headers, override indicator | +80 |
| `apps/web/src/components/features/arbitrage/ArbitrageDetailModal.tsx` | Add override input/save | +60 |
| `apps/web/src/components/layout/Sidebar.tsx` | Update nav items | 10 |
| `apps/web/src/hooks/use-arbitrage.ts` | Add override mutation | +30 |
| `apps/web/src/app/api/arbitrage/[asin]/route.ts` | Add PATCH for override | +40 |
| `apps/web/src/lib/arbitrage/arbitrage.service.ts` | Add override methods | +30 |

### 4.3 No Changes Needed

| File | Reason |
|------|--------|
| `apps/web/src/app/(dashboard)/arbitrage/vinted/*` | Remains separate as specified |
| `apps/web/src/components/features/arbitrage/ArbitrageFilters.tsx` | Already has COG filter |
| `apps/web/src/app/api/arbitrage/route.ts` | Already supports sort params |
| `apps/web/src/app/api/arbitrage/sync/*` | No changes to sync logic |

---

## 5. Implementation Details

### 5.1 Database Migration

```sql
-- Migration: 20260128_add_bl_price_override
-- Add per-ASIN minimum BrickLink price override

ALTER TABLE asin_bricklink_mapping
ADD COLUMN min_bl_price_override DECIMAL(10,2) DEFAULT NULL;

COMMENT ON COLUMN asin_bricklink_mapping.min_bl_price_override IS
  'User-set minimum BL price override. When set, COG% uses MAX(actual_bl_min, override)';
```

### 5.2 Component: Unified Arbitrage Page

**Location:** `apps/web/src/app/(dashboard)/arbitrage/page.tsx`

**Key Features:**
- Uses `useSearchParams` for tab and sort state
- Three tabs: BrickLink, eBay, Seeded
- Shared summary cards and sync status across tabs
- Tab-specific filter defaults:
  - BrickLink: `show=opportunities`, `sortField=cog`
  - eBay: `show=ebay_opportunities`, `sortField=ebay_margin`
  - Seeded: `show=seeded_only`, `sortField=cog`

**Code Pattern:**
```tsx
'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

type TabValue = 'bricklink' | 'ebay' | 'seeded';

export default function ArbitragePage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const activeTab = (searchParams.get('tab') as TabValue) || 'bricklink';
  const sortField = searchParams.get('sortField') || 'cog';
  const sortDirection = searchParams.get('sortDirection') || 'asc';

  const updateParams = (updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([k, v]) => params.set(k, v));
    router.push(`/arbitrage?${params.toString()}`);
  };

  return (
    <Tabs value={activeTab} onValueChange={(v) => updateParams({ tab: v })}>
      <TabsList>
        <TabsTrigger value="bricklink">BrickLink</TabsTrigger>
        <TabsTrigger value="ebay">eBay</TabsTrigger>
        <TabsTrigger value="seeded">Seeded</TabsTrigger>
      </TabsList>
      {/* Content per tab */}
    </Tabs>
  );
}
```

### 5.3 Component: Sortable Table Headers

**Location:** `apps/web/src/components/features/arbitrage/ArbitrageTable.tsx`

**Changes:**
- Accept `sortField`, `sortDirection`, `onSort` props
- Add `cursor-pointer` to `<th>` elements
- Display ChevronUp/ChevronDown icon on sorted column

**Code Pattern:**
```tsx
interface SortableHeaderProps {
  field: string;
  label: string;
  currentField: string;
  direction: 'asc' | 'desc';
  onSort: (field: string) => void;
  className?: string;
}

function SortableHeader({ field, label, currentField, direction, onSort, className }: SortableHeaderProps) {
  const isActive = field === currentField;
  return (
    <th
      className={cn("cursor-pointer select-none", className)}
      onClick={() => onSort(field)}
    >
      <div className="flex items-center gap-1">
        {label}
        {isActive && (direction === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />)}
      </div>
    </th>
  );
}
```

### 5.4 Component: Override Field in Detail Modal

**Location:** `apps/web/src/components/features/arbitrage/ArbitrageDetailModal.tsx`

**Changes:**
- Add "Min BL Price Override" input below BrickLink Stock section
- Show effective price when override is active
- Clear button to remove override
- Save override to database on blur/enter

**Code Pattern:**
```tsx
// In ArbitrageDetailModal
const [overrideInput, setOverrideInput] = useState<string>(
  item?.minBlPriceOverride ? item.minBlPriceOverride.toFixed(2) : ''
);

const saveOverrideMutation = useSaveBlPriceOverride();

const handleOverrideSave = () => {
  const value = parseFloat(overrideInput) || null;
  saveOverrideMutation.mutate({ asin: item.asin, override: value });
};

// JSX
<div className="mt-4 p-3 border rounded-lg bg-muted/30">
  <div className="flex items-center justify-between">
    <label className="text-sm font-medium">Min BL Price Override</label>
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground">£</span>
      <Input
        type="number"
        step="0.50"
        value={overrideInput}
        onChange={(e) => setOverrideInput(e.target.value)}
        onBlur={handleOverrideSave}
        className="w-20"
        placeholder="—"
      />
      {overrideInput && (
        <Button variant="ghost" size="sm" onClick={() => { setOverrideInput(''); handleOverrideSave(); }}>
          Clear
        </Button>
      )}
    </div>
  </div>
  {overrideInput && (
    <p className="text-xs text-blue-600 mt-1">
      COG% will use £{overrideInput} instead of actual BL Min (£{item.blMinPrice?.toFixed(2)})
    </p>
  )}
</div>
```

### 5.5 API: Override Endpoint

**Location:** `apps/web/src/app/api/arbitrage/[asin]/route.ts`

**Add PATCH handler:**
```typescript
const UpdateOverrideSchema = z.object({
  minBlPriceOverride: z.number().positive().nullable(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ asin: string }> }
) {
  const { asin } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const parsed = UpdateOverrideSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }

  const { error } = await supabase
    .from('asin_bricklink_mapping')
    .update({ min_bl_price_override: parsed.data.minBlPriceOverride })
    .eq('asin', asin)
    .eq('user_id', user.id);

  if (error) throw error;

  return NextResponse.json({ success: true });
}
```

### 5.6 Sync Status Badge Update

**Changes to SyncStatusBadge:**
- Remove hardcoded `schedule` prop
- Use `lastRunAt` instead of `lastSuccessAt` for display
- Add Tooltip with detailed info: timestamp, items processed, duration, error message

**Code Pattern:**
```tsx
function SyncStatusBadge({ label, syncStatus }: { label: string; syncStatus: ArbitrageSyncStatus | null }) {
  const { lastRunAt, status, itemsProcessed, itemsFailed, lastRunDurationMs, errorMessage } = syncStatus ?? {};

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn("flex items-center gap-2 border rounded-lg px-3 py-2", getStatusColor(status))}>
            {getStatusIcon(status)}
            <div>
              <span className="text-sm font-medium">{label}</span>
              <span className="text-xs text-muted-foreground block">
                {formatRelativeTime(lastRunAt)}
              </span>
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-xs space-y-1">
            <p>Last run: {lastRunAt ? new Date(lastRunAt).toLocaleString() : 'Never'}</p>
            <p>Status: {status ?? 'unknown'}</p>
            <p>Items: {itemsProcessed ?? 0} processed, {itemsFailed ?? 0} failed</p>
            {lastRunDurationMs && <p>Duration: {(lastRunDurationMs / 1000).toFixed(1)}s</p>}
            {errorMessage && <p className="text-red-500">Error: {errorMessage}</p>}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
```

### 5.7 Data Flow: Override COG Calculation

```
1. User opens detail modal for ASIN with low BL Min (£4.50)
2. User enters override: £8.00
3. On blur, PATCH /api/arbitrage/{asin} with { minBlPriceOverride: 8.00 }
4. Database updated: asin_bricklink_mapping.min_bl_price_override = 8.00
5. Query cache invalidated
6. Next fetch returns item with minBlPriceOverride: 8.00
7. Table displays:
   - BL Min: "£4.50*" (asterisk indicates override)
   - COG%: calculated using MAX(4.50, 8.00) = £8.00
8. User can clear override to revert to actual BL Min
```

---

## 6. Build Order

Given criteria dependencies, build in this order:

### Phase 1: Database (Foundation)
1. Create migration for `min_bl_price_override` column
2. Push migration to Supabase
3. Regenerate types

### Phase 2: API Layer
4. Add PATCH handler to `/api/arbitrage/[asin]/route.ts` for override
5. Update ArbitrageService with override methods
6. Add `useSaveBlPriceOverride` hook

### Phase 3: Unified Page Structure
7. Create `/arbitrage/page.tsx` with tab layout
8. Create `/arbitrage/loading.tsx` skeleton
9. Update Sidebar.tsx nav items
10. Create redirect files for old routes

### Phase 4: Table Sorting
11. Add sortable header component to ArbitrageTable
12. Wire up sort state to URL params
13. Verify all columns sortable

### Phase 5: Sync Status Fix
14. Update SyncStatusBadge to use `lastRunAt`
15. Remove hardcoded schedule display
16. Add detailed tooltip

### Phase 6: Override Feature
17. Add override input to ArbitrageDetailModal
18. Add override indicator to table
19. Wire up save/clear functionality

### Phase 7: Documentation & Polish
20. Create `bricklink-api-limitations.md`
21. Update page titles per active tab
22. Verify error handling and empty states
23. Test responsive layout

---

## 7. Risk Assessment

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| URL params cause hydration mismatch | Medium | Low | Use `useSearchParams` from `next/navigation`, not `window.location` |
| Sort toggle conflicts with column click | Low | Low | Clear sort direction logic (asc -> desc -> asc) |
| Override not persisting | Low | Medium | Test mutation invalidates correct queries |
| Tab state lost on navigation | Low | Low | Store in URL, not local state |

### Scope Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Scope creep to add more tabs | Medium | Medium | Strict adherence to done-criteria.md |
| Request to add sorting to Vinted | Low | Low | Out of scope per criteria |
| Request for column visibility toggles | Low | Low | Not in criteria, defer to future |

### Integration Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Breaking existing eBay page users | Medium | Medium | Redirect preserves functionality |
| Sync status data not available | Low | Low | Graceful fallback to "Unknown" |
| Override field nullable handling | Medium | Low | Proper null checks in UI |

---

## 8. Feasibility Validation

| Criterion | Feasible | Confidence | Notes |
|-----------|----------|------------|-------|
| F1: Unified Route | ✅ Yes | High | Standard Next.js page |
| F2: Tab Navigation | ✅ Yes | High | shadcn/ui Tabs exists |
| F3: Default Tab | ✅ Yes | High | defaultValue prop |
| F4: Tab Switching | ✅ Yes | High | Client-side state |
| F5-F6: Redirects | ✅ Yes | High | Next.js redirect() |
| F7: Vinted Separate | ✅ Yes | High | No changes needed |
| F8: Page Title | ✅ Yes | High | Conditional rendering |
| F9-13: COG % | ✅ Yes | High | Already exists on eBay page |
| F14-19: Sorting | ✅ Yes | High | API already supports, add UI |
| F20-24: Sync Status | ✅ Yes | High | Data in database, update display |
| F25: API Docs | ✅ Yes | High | Markdown file |
| F26-31: Override | ✅ Yes | High | Simple column + CRUD |
| E1-E3: Errors | ✅ Yes | High | Existing patterns |
| P1-P3: Performance | ✅ Yes | High | No architectural changes |
| U1-U4: UI | ✅ Yes | High | Reuse existing components |
| I1-I3: Integration | ✅ Yes | High | Minimal changes |

**Overall:** All 31 criteria feasible with planned approach. ✅

---

## 9. Notes for Build Agent

### Key Implementation Details

1. **URL State Management**: Use `useSearchParams` + `useRouter` for all filter/sort state. This ensures URL is always in sync and enables shareable links.

2. **Tab Badge Counts**: Each tab should show its opportunity count. This requires calling `useArbitrageSummary` once and displaying counts in TabsTrigger.

3. **Override Indicator**: In the table, when `item.minBlPriceOverride` is set, show an asterisk (*) or small icon next to the BL Min value to indicate override is active.

4. **COG Calculation with Override**: The effective BL price for COG% is `Math.max(item.blMinPrice, item.minBlPriceOverride || 0)`. This should be calculated on the frontend for display.

5. **Sync Status Simplification**: Remove the hardcoded schedule text ("2:30am", etc.) entirely. Only show the relative time since last run.

### Existing Code to Reuse

- `SummaryCardSkeleton` from eBay page
- `SyncStatusBadge` pattern (update it, don't recreate)
- `EbayArbitrageTable` pattern for BrickLink table
- `ArbitrageFilters` component (already has COG filter)
- `ArbitrageDetailModal` (add override section)

### Testing Priorities

1. Tab switching without page reload
2. Sort persistence in URL
3. Override save/clear/persistence
4. Sync status shows actual timestamps
5. Redirects from old routes work

---

**End of Feature Specification**
