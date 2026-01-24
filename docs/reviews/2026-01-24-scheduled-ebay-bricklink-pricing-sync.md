# Code Review: Scheduled eBay/BrickLink Pricing Sync

**Branch:** `feature/partout-progress-bar`
**Date:** 2026-01-24
**Reviewer:** Code Review Agent

---

## Summary

This PR implements automated daily scheduled syncs for eBay and BrickLink pricing data, replacing manual sync buttons. The implementation uses cursor-based pagination to process ~2,503 ASINs over a 3-day cycle.

**Verdict: APPROVE with minor suggestions**

| Category | Status |
|----------|--------|
| Correctness | PASS |
| Security | PASS |
| Performance | PASS |
| Standards | PASS |

---

## Changes Overview

| File | Lines | Change Type |
|------|-------|-------------|
| `supabase/migrations/20260124100001_arbitrage_watchlist.sql` | +166 | New migration |
| `apps/web/src/lib/arbitrage/watchlist.service.ts` | +499 | New service |
| `apps/web/src/app/api/cron/ebay-pricing/route.ts` | +231 | New cron endpoint |
| `apps/web/src/app/api/cron/bricklink-pricing/route.ts` | +232 | New cron endpoint |
| `.github/workflows/ebay-pricing-cron.yml` | +57 | New workflow |
| `.github/workflows/bricklink-pricing-cron.yml` | +57 | New workflow |
| `apps/web/src/lib/arbitrage/ebay-sync.service.ts` | +126 | Added `syncPricingBatch()` |
| `apps/web/src/lib/arbitrage/bricklink-sync.service.ts` | +114 | Added `syncPricingBatch()` |
| `apps/web/src/app/(dashboard)/arbitrage/amazon/page.tsx` | Modified | Removed sync buttons |
| `apps/web/src/app/(dashboard)/arbitrage/ebay/page.tsx` | Modified | Removed sync buttons |

---

## Detailed Review

### Security

**PASS - No security issues found**

1. **Cron Authentication**: Both cron endpoints verify `CRON_SECRET` from environment variables
   ```typescript
   if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
     return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
   }
   ```

2. **RLS Policies**: Migration includes proper RLS policies for user-scoped data
   ```sql
   ALTER TABLE arbitrage_watchlist ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "Users can view own arbitrage watchlist" ...
   CREATE POLICY "Service role can manage all watchlists" ...
   ```

3. **Service Role Access**: Cron jobs correctly use `createServiceRoleClient()` to bypass RLS

4. **No Hardcoded Secrets**: Secrets properly loaded from `process.env`

### Correctness

**PASS - Logic is sound**

1. **Cursor-Based Pagination**: Properly tracks cursor position in `arbitrage_sync_status` table
   - Resets cursor on new day
   - Advances cursor by processed count
   - Handles edge cases (empty batch, daily limit)

2. **Timestamp Updates**: Successfully synced items get their watchlist timestamps updated
   ```typescript
   if (successfulSetNumbers.length > 0) {
     await watchlistService.updateSyncTimestamp(userId, successfulSetNumbers, 'ebay');
   }
   ```

3. **Error Handling**: Individual item failures don't crash the batch
   - BrickLink: Handles `RateLimitError` and `BrickLinkApiError`
   - eBay: Uses `Promise.allSettled` for parallel processing

4. **Deduplication**: Watchlist correctly prioritizes `sold_inventory` over `retired_with_pricing`

### Performance

**PASS - Well optimized**

1. **Batch Processing**:
   - eBay: Parallel batches of 5 with 200ms delay between batches
   - BrickLink: Sequential with 200ms rate limit delay (API requirement)

2. **Database Indexes**: Proper indexes for cursor queries
   ```sql
   CREATE INDEX idx_arbitrage_watchlist_ebay_sync ON arbitrage_watchlist(user_id, ebay_last_synced_at NULLS FIRST)
     WHERE is_active = true;
   ```

3. **Pagination**: Uses Supabase `.range()` for efficient offset pagination

4. **Statistics View**: Pre-computed view for watchlist stats avoids repeated aggregations

### Standards

**PASS - Follows project conventions**

1. **TypeScript**: Full type safety, proper interfaces exported
2. **Service Pattern**: New service follows existing repository/service pattern
3. **Error Logging**: Consistent `[ClassName.methodName]` logging pattern
4. **Comments**: Good JSDoc comments on public methods

---

## Issues Found

### Major Issues

None.

### Minor Issues

#### 1. Hardcoded User ID (Minor)

**Location:** `apps/web/src/app/api/cron/ebay-pricing/route.ts:22`, `apps/web/src/app/api/cron/bricklink-pricing/route.ts:23`

```typescript
const DEFAULT_USER_ID = '4b6e94b4-661c-4462-9d14-b21df7d51e5b';
```

**Issue:** User ID is hardcoded. While acceptable for single-user personal app, this would need refactoring for multi-user support.

**Recommendation:** Add a TODO comment or consider environment variable for future flexibility:
```typescript
// TODO: For multi-user, iterate over all users with active watchlists
const DEFAULT_USER_ID = process.env.DEFAULT_USER_ID ?? '4b6e94b4-661c-4462-9d14-b21df7d51e5b';
```

**Severity:** Minor (acceptable for personal use)

#### 2. Unused Import in Cron Route (Nitpick)

**Location:** `apps/web/src/app/api/cron/ebay-pricing/route.ts:16`

```typescript
import { EbayArbitrageSyncService, ArbitrageWatchlistService } from '@/lib/arbitrage';
```

`ArbitrageWatchlistService` is imported but only used to create another instance inside the sync service. The `watchlistService` created on line 42 is only used for `getWatchlistCount()`.

**Recommendation:** This is fine architecturally - the cron route needs to count items and the sync service handles the actual work. No change needed.

**Severity:** Nitpick

#### 3. Duplicate Code Between Cron Routes (Minor)

**Location:** Both cron routes share nearly identical code (~95% similar)

**Recommendation:** Consider extracting common logic to a shared helper:
```typescript
// apps/web/src/lib/arbitrage/cron-helpers.ts
export async function runScheduledSync(config: {
  jobType: string;
  syncService: { syncPricingBatch: (...) => Promise<...> };
  dailyLimit: number;
  batchSize: number;
}) { ... }
```

**Severity:** Minor (acceptable as-is, but could reduce maintenance burden)

#### 4. Migration Comment Mismatch (Nitpick)

**Location:** `supabase/migrations/20260124100001_arbitrage_watchlist.sql:3`

```sql
-- Migration: 20260124000001_arbitrage_watchlist.sql
```

Comment says `20260124000001` but filename is `20260124100001`.

**Severity:** Nitpick

---

## Positive Highlights

1. **Excellent resumable design**: The cursor-based approach with daily reset is elegant and robust

2. **Comprehensive error handling**: Both services handle failures gracefully without losing progress

3. **Good observability**: Pushover notifications for start/complete/error states

4. **Proper RLS with service role bypass**: Cron jobs need full access, user queries are scoped

5. **Performance-conscious indexes**: Partial indexes on `is_active = true` for efficient queries

6. **Clean UI refactor**: Removed manual sync complexity, replaced with clear status display

---

## Checklist

### Hadley Bricks Specific

- [x] Platform credentials encrypted? (Uses existing OAuth infrastructure)
- [x] Adapter pattern followed? (Existing adapters reused)
- [x] Repository pattern followed? (New service follows pattern)
- [x] Dual-write implemented? N/A (not a Sheets integration feature)
- [x] RLS policies for new tables? (Yes, with service role bypass)
- [ ] Tests added for new code? (No tests - acceptable for personal project)

### General

- [x] TypeScript compiles without errors
- [x] ESLint passes (only pre-existing warnings)
- [x] No security vulnerabilities
- [x] No hardcoded secrets
- [x] Error handling implemented
- [x] Logging for debugging

---

## Verdict

**APPROVE** - Ready to merge

The implementation is solid, well-structured, and follows project conventions. The cursor-based resumable sync pattern is well-designed for handling large datasets across multiple days. Security is properly implemented with cron authentication and RLS policies.

The minor issues identified are acceptable for a personal project and don't warrant blocking the merge.
