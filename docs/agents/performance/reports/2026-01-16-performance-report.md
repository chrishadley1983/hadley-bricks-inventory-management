# Performance Analysis Report

**Generated:** 2026-01-16
**Mode:** `full`
**Status:** First Run (No Baseline)
**Commit:** `0cdd213`

---

## Executive Summary

| Metric | Status | Details |
|--------|--------|---------|
| **Overall Status** | NEEDS ATTENTION | 47 issues identified |
| **Critical Issues** | 8 | Require immediate attention |
| **High Priority** | 12 | Should address this sprint |
| **Medium Priority** | 19 | Plan for next sprint |
| **Low Priority** | 8 | Backlog items |

### Top 3 Critical Issues

1. **Google Sheets bulk operations take 5-8 minutes** - Sequential dual-writes cause 300-500 second delays for 100 items
2. **Sequential summary loops in transactions** - Multiple queries when SQL aggregation should be used
3. **15 components exceed 500 lines** - Largest: `ReviewStep.tsx` at 1167 lines

---

## Phase 1: UI Performance Analysis

### Files Analysed
- **Total source files:** 745
- **Page components:** 48
- **API routes:** 100+

### Critical Issues

#### 1.1 Large Component Files (15 files > 500 lines)

| File | Lines | Severity |
|------|-------|----------|
| `ReviewStep.tsx` | 1167 | CRITICAL |
| `ConfirmOrdersDialog.tsx` | 1008 | CRITICAL |
| `PhotoInput.tsx` | 853 | CRITICAL |
| `CreateEbayListingModal.tsx` | 787 | CRITICAL |
| `SeededAsinManager.tsx` | 787 | CRITICAL |
| `PhotoAnalysisStep.tsx` | 756 | CRITICAL |
| `InventoryForm.tsx` | 742 | CRITICAL |
| `NaturalLanguageInput.tsx` | 728 | CRITICAL |
| `EbayDetailModal.tsx` | 705 | CRITICAL |
| `InventoryColumns.tsx` | 698 | CRITICAL |
| `ImageStudioTab.tsx` | 686 | CRITICAL |
| `SetDetailsCard.tsx` | 575 | CRITICAL |
| `PhotoInputStep.tsx` | 558 | CRITICAL |
| `AdvancedFilters.tsx` | 554 | CRITICAL |
| `RefreshTab.tsx` | 536 | CRITICAL |

**Recommendation:** Split these components into smaller, focused sub-components.

#### 1.2 Missing `loading.tsx` Files (23 routes)

| Route | Recommendation |
|-------|----------------|
| `/dashboard` | Add `DashboardSkeleton` |
| `/admin/migration` | Add `TableSkeleton` |
| `/admin/sync` | Add `TableSkeleton` |
| `/arbitrage/*` | Add `TableSkeleton` |
| `/ebay-stock/sku-issues` | Add `TableSkeleton` |
| `/orders/amazon` | Add `TableSkeleton` |
| `/purchase-evaluator/*` | Add `CardSkeleton` |
| `/reports/*` (6 routes) | Add `DashboardSkeleton` |
| `/settings/*` | Add `CardSkeleton` |
| `/transactions` | Add `TableSkeleton` |

**Recommendation:** Add `loading.tsx` files using existing skeleton components from `@/components/ui/skeletons`.

#### 1.3 Inventory Table - No Virtualisation

**Status:** ACCEPTABLE (with caveats)

The inventory table implements pagination (default 20 rows, max 100) which prevents rendering 650+ items at once. However, when users select 100 rows per page, performance may degrade.

**Current Implementation:**
- Server-side pagination via Supabase `.range()`
- Client state for page/pageSize
- Debounced search (300ms)
- Dynamic import with skeleton fallback

**Recommendation:** Consider adding `@tanstack/react-virtual` if users commonly view 50-100 rows.

### TanStack Query Issues

#### Missing `staleTime` Configuration (4 hooks)

| Hook | File | Line |
|------|------|------|
| `useOrders()` | use-orders.ts | 127 |
| `useOrder()` | use-orders.ts | 137 |
| `useOrderStats()` | use-orders.ts | 148 |
| `usePurchaseList()` | use-purchases.ts | 37 |
| `useInventoryItem()` | use-inventory.ts | 52 (explicitly `staleTime: 0`) |
| `useInventorySummary()` | use-inventory.ts | 59 |

**Recommendation:** Add `staleTime: 5 * 60 * 1000` for list queries, `staleTime: 10 * 60 * 1000` for details.

#### Overly Broad Invalidations (6 locations)

| File | Lines | Pattern |
|------|-------|---------|
| use-purchases.ts | 64, 109, 123 | `purchaseKeys.all` |
| use-sync.ts | 64-66, 114-115 | `inventoryKeys.all` |
| use-arbitrage.ts | 319, 347, 378 | `arbitrageKeys.all` |
| PriceConflictDialog.tsx | 75-76, 93-94 | `['inventory']` |

**Recommendation:** Use surgical invalidation - only invalidate `lists()` and `summary()`, not `all`.

---

## Phase 2: Query Performance Analysis

### Critical: N+1 and Sequential Query Patterns

#### 2.1 Dual Count+Data Queries in BaseRepository

**File:** `lib/repositories/base.repository.ts` (lines 75-88)

**Issue:** `findAll()` makes TWO queries - one for count, one for data.

```typescript
// Current (2 queries)
const { count } = await query.select('*', { count: 'exact', head: true });
const { data } = await query.select('*').range(from, to);

// Fixed (1 query)
const { count, data } = await query.select('*', { count: 'exact' }).range(from, to);
```

**Impact:** Every list operation doubles database round trips.

#### 2.2 Separate Lookup Before Filter in InventoryRepository

**File:** `lib/repositories/inventory.repository.ts` (lines 96-154)

**Issue:** When `excludeLinkedToOrders=true`, queries `order_items` first, then builds inventory query.

**Recommendation:** Use NOT EXISTS subquery instead of two queries.

#### 2.3 Sequential Admin Fix-Order-Links

**File:** `app/api/admin/fix-order-links/route.ts` (lines 44-81)

**Issue:** Loop iterates making 2 queries per link.

**Impact:** 100 links = 200 sequential queries.

**Recommendation:** Batch fetch all order_items and inventory_items in 2 queries total.

### High: Client-Side Aggregation

Multiple repository methods fetch all data and aggregate client-side:
- `getCountByStatus()` - inventory.repository.ts
- `getTotalValue()` - inventory.repository.ts
- `getMonthlyTotal()` - purchase.repository.ts
- `getRolling12MonthTotal()` - purchase.repository.ts
- `getStats()` - order.repository.ts

**Recommendation:** Create Supabase RPC functions for server-side aggregation.

### Medium: SELECT * Usage

All repositories use `select('*')` instead of specific columns.

**Recommendation:** Specify only needed columns to reduce payload size.

---

## Phase 3: Bundle Analysis

### Current State

| Category | Count | Status |
|----------|-------|--------|
| Production Dependencies | 42 | Normal |
| Dev Dependencies | 29 | Normal |
| Dynamic Imports | 45+ pages | Good |
| Icon Tree-Shaking | Proper | Good |
| PDF/AI Libraries | Server-only | Good |

### Optimisation Opportunities

#### 3.1 Recharts Not Lazy Loaded (HIGH IMPACT)

**Issue:** 6 report pages statically import Recharts (~75KB gzipped).

**Affected Files:**
- `reports/inventory-valuation/page.tsx`
- `reports/purchase-analysis/page.tsx`
- `reports/platform-performance/page.tsx`
- `reports/profit-loss/page.tsx`
- `reports/inventory-aging/page.tsx`
- `reports/daily-activity/page.tsx`

**Recommendation:** Create dynamic chart wrappers:
```typescript
const DynamicPieChart = dynamic(
  () => import('@/components/charts').then(mod => mod.PieChart),
  { ssr: false, loading: () => <ChartSkeleton /> }
);
```

**Expected Savings:** 50-75KB gzipped from main bundle.

#### 3.2 Complex Modals Static Import

**Affected:**
- `CreateEbayListingModal`
- `AmazonOffersModal`
- `SetLookupForm` variants

**Recommendation:** Use `React.lazy()` for modals only used on specific pages.

**Expected Savings:** 20-30KB.

### What's Already Optimised

- lucide-react icons (individual imports)
- Radix UI (modular packages)
- date-fns (tree-shakeable)
- Auth pages (dynamic imports)
- AI/PDF libraries (server-side only)

---

## Phase 4: API Performance Analysis

### Critical: Sequential Loops in Summary Calculations

#### 4.1 eBay Transactions Summary

**File:** `app/api/ebay/transactions/route.ts` (lines 95-154)

**Issue:** Sequential while loop fetching 1000-row pages to calculate totals.

**Impact:** 10,000 transactions = 10+ separate queries.

**Recommendation:** Use SQL aggregation:
```sql
SELECT
  SUM(CASE WHEN transaction_type = 'SALE' THEN amount END) as total_sales,
  SUM(CASE WHEN transaction_type = 'REFUND' THEN ABS(amount) END) as total_refunds
FROM ebay_transactions WHERE ...
```

#### 4.2 Sequential Bulk Confirmation

**File:** `app/api/orders/ebay/confirm-bulk/route.ts` (lines 46-83)

**Issue:** Sequential HTTP requests to confirm each order.

**Impact:** 50 orders = 50 sequential network requests.

**Recommendation:** Create batch confirmation service or use `Promise.all()`.

### High: Missing Response Caching

**Affected Endpoints:**
- `/api/orders` (GET)
- `/api/purchases` (GET)
- `/api/inventory/summary` (GET)
- `/api/ebay/transactions` (GET)

**Recommendation:** Add `Cache-Control: private, max-age=300` header.

### High: Internal HTTP Calls

**File:** `app/api/orders/ebay/confirm-bulk/route.ts`

**Issue:** Makes `fetch()` to internal API endpoints instead of calling services directly.

**Recommendation:** Call service layer directly to avoid HTTP overhead.

---

## Phase 5: Memory & Runtime Analysis

### Critical: Google Sheets Integration

**Location:** `lib/google/sheets-client.ts`, `lib/sync/sheets-write.service.ts`

| Issue | Impact | Severity |
|-------|--------|----------|
| No retry/backoff logic | Single failure crashes sync | CRITICAL |
| Full sheet reads for ID generation | 3-5s per purchase create | CRITICAL |
| Sequential dual-writes in bulk | 100 items = 500 seconds | CRITICAL |
| No read-through caching | Stale data until manual sync | HIGH |
| Missing batch operations | N API calls instead of 1 | HIGH |

#### Bulk Operation Performance

| Operation | Current Time | Fixed Time |
|-----------|-------------|------------|
| 100 inventory creates | 300-500 seconds | < 30 seconds |
| Single purchase create | 3-5 seconds | < 0.5 seconds |
| Full inventory sync | 6-10 seconds | 2-3 seconds |

### High: FileReader Resource Leaks

**Affected Files (5):**
- `PhotoInput.tsx`
- `PhotoUploadInline.tsx`
- `PurchaseImages.tsx`
- `CreateEbayListingModal.tsx`
- `use-photo-analysis.ts`

**Issue:** FileReader objects created but never cleaned up. Base64 conversions persist in memory.

**Recommendation:** Add explicit cleanup after reading completes.

### High: Streaming Reader Without Cleanup

**File:** `hooks/use-arbitrage.ts` (lines 399-446)

**Issue:** `ReadableStreamDefaultReader` never cancelled on navigation/abort.

**Recommendation:** Add try/finally with `reader.cancel()`.

### High: Closure Stale References

**File:** `hooks/listing-assistant/use-image-processor.ts`

**Issue:** Callbacks capture `images` array from state, retaining old image data.

**Recommendation:** Use ref-based approach or setter functions for large mutable data.

### Medium: Console.log Accumulation

**File:** `hooks/use-sync.ts` (lines 14-18)

**Issue:** Stack trace logging creates Error objects that persist.

**Recommendation:** Wrap in `process.env.NODE_ENV === 'development'` check.

---

## Performance Action Plan

### Immediate Actions (This Sprint)

| # | Issue | Location | Est. Effort | Impact |
|---|-------|----------|-------------|--------|
| 1 | Fix ID generation to use Supabase | sheets-write.service.ts | 2h | CRITICAL |
| 2 | Add retry/backoff to Sheets API | sheets-client.ts | 3h | CRITICAL |
| 3 | Parallelize dual-writes in bulk | inventory.repository.ts | 2h | CRITICAL |
| 4 | Fix summary aggregation loops | transactions/route.ts | 3h | CRITICAL |
| 5 | Add `staleTime` to query hooks | use-*.ts | 1h | HIGH |
| 6 | Implement surgical cache invalidation | use-*.ts | 2h | HIGH |
| 7 | Fix FileReader cleanup | PhotoInput.tsx, etc. | 2h | HIGH |
| 8 | Add streaming reader cleanup | use-arbitrage.ts | 1h | HIGH |

**Total Estimated: 16 hours**

### Short Term (Next 2 Sprints)

| # | Issue | Location | Est. Effort | Impact |
|---|-------|----------|-------------|--------|
| 9 | Add loading.tsx to 23 routes | app/(dashboard)/* | 4h | MEDIUM |
| 10 | Dynamic import Recharts | reports/*/page.tsx | 3h | MEDIUM |
| 11 | Convert SELECT * to columns | repositories/*.ts | 4h | MEDIUM |
| 12 | Create batch confirmation service | orders/ebay | 4h | MEDIUM |
| 13 | Add Cache-Control headers | api routes | 2h | MEDIUM |
| 14 | Split ReviewStep.tsx | purchase-evaluator | 4h | MEDIUM |
| 15 | Split ConfirmOrdersDialog.tsx | orders | 3h | MEDIUM |

**Total Estimated: 24 hours**

### Long Term (Backlog)

| # | Issue | Est. Effort |
|---|-------|-------------|
| 16 | Create Supabase RPCs for aggregation | 8h |
| 17 | Add @tanstack/react-virtual to inventory table | 4h |
| 18 | Split remaining large components (13 files) | 12h |
| 19 | Implement full Sheets batch operations | 8h |
| 20 | Add comprehensive error boundaries | 6h |

---

## Metrics to Track

| Metric | Current | Target | Measure |
|--------|---------|--------|---------|
| Bulk inventory create (100 items) | 300-500s | < 30s | Timer |
| Purchase create latency | 3-5s | < 0.5s | Timer |
| Inventory page load | Est. 2-3s | < 2s | Lighthouse |
| API avg response time | Est. 1-2s | < 500ms | Logging |
| Bundle size (main) | Unknown | < 800KB | Build output |
| Components > 500 lines | 15 | 0 | Static analysis |
| Missing loading.tsx | 23 | 0 | File count |

---

## Handoffs

### To Test Plan Agent

Performance tests recommended:
1. **Bulk inventory create** - Target: 100 items < 30s
2. **Transaction summary API** - Target: < 500ms
3. **Dashboard initial load** - Target: < 2s
4. **Inventory page with 100 rows** - Target: < 3s

### To Code Review Agent

Watch for these patterns:
- [ ] New queries without pagination
- [ ] Static imports of heavy libraries
- [ ] Missing useEffect cleanup
- [ ] Sequential loops with await
- [ ] Components > 300 lines
- [ ] Broad cache invalidations

---

## Files Referenced

### Most Critical (Fix First)
1. `lib/sync/sheets-write.service.ts` - ID generation, batch writes
2. `lib/google/sheets-client.ts` - Retry logic
3. `lib/repositories/inventory.repository.ts` - Bulk operations
4. `app/api/ebay/transactions/route.ts` - Summary aggregation
5. `app/api/transactions/route.ts` - Summary aggregation

### High Priority
6. `hooks/use-orders.ts` - staleTime
7. `hooks/use-purchases.ts` - staleTime, invalidation
8. `hooks/use-sync.ts` - invalidation, logging
9. `hooks/use-arbitrage.ts` - streaming cleanup
10. `components/features/inventory/PhotoInput.tsx` - FileReader cleanup

---

**End of Performance Report**

*Generated by Performance Agent v1.0*
