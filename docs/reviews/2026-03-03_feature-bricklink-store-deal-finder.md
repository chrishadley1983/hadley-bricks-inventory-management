# Code Review Report

**Mode:** branch
**Branch:** feature/bricklink-store-deal-finder
**Timestamp:** 2026-03-03
**Files Changed:** 27
**Lines Added:** 2,221
**Lines Removed:** 32

## Summary

| Category | Critical | Major | Minor | Nitpick |
|----------|----------|-------|-------|---------|
| Correctness | 0 | 2 | 2 | 0 |
| Security | 1 | 1 | 1 | 0 |
| Performance | 0 | 1 | 5 | 1 |
| Standards | 0 | 0 | 3 | 4 |
| **Total** | **1** | **4** | **11** | **5** |

### Static Analysis

| Check | Status |
|-------|--------|
| TypeScript | N/A (tsc not installed at root) |
| ESLint | 3 warnings (all pre-existing, none in changed files) |
| CLAUDE.md | 143 lines (under 200 limit) |

---

## Critical Issues (1)

### CR-001: Unvalidated setNumbers array elements in batch sync route

**File:** `apps/web/src/app/api/arbitrage/sync/bricklink-stores/route.ts:18`
**Category:** Security (Input Validation)

The Zod schema validates that `setNumbers` is an array of strings, but does not validate the format of each string. The `[setNumber]` single-set route correctly validates with `SET_NUMBER_REGEX`, but the batch route bypasses this. Arbitrary strings could be passed to the scraper's URL construction.

**Recommendation:** Add regex validation to array elements:
```typescript
z.array(z.string().regex(/^\d{3,7}(-\d+)?$/))
```

**Required Action:** Must fix before merge.

---

## Major Issues (4)

### CR-002: Delete-then-insert not atomic in scrapeAndStore

**File:** `apps/web/src/lib/arbitrage/bricklink-store-deal.service.ts:139-161`
**Category:** Correctness

The method deletes all existing listings for a set, then inserts new ones in batches. If the process crashes or times out between delete and final insert batch, all cached data for that set is lost. Since `upsert` with the unique constraint is already used, the preceding delete is only needed to remove stores that no longer appear. Consider: upsert new rows, then delete rows not in the new set.

### CR-003: NaN handling in price override flow

**File:** `apps/web/src/components/features/arbitrage/ArbitrageDetailModal.tsx:65-76`
**Category:** Correctness

When the user clears the override input, `parseFloat('')` yields `NaN`. Since `NaN` is not nullish, `overrideValue ?? null` evaluates to `NaN`, not `null`. This causes: (a) Save button appears unexpectedly, (b) `NaN` sent to API, (c) toast shows "Override set to NaN".

**Recommendation:**
```typescript
const overrideValue = overrideInput && !isNaN(parseFloat(overrideInput)) ? parseFloat(overrideInput) : null;
```

### CR-004: Browser profile with session cookies in home directory

**File:** `apps/web/src/lib/arbitrage/bricklink-store-scraper.ts:18`
**Category:** Security/Operations

`PROFILE_DIR` stores BrickLink session cookies in `~/.hadley-bricks/bricklink-profile` with default filesystem permissions. In serverless/containerised environments, this directory is ephemeral. On persistent servers, these session cookies are accessible to any process running as the same user.

### CR-005: Error response .json() can throw on non-JSON responses

**File:** `apps/web/src/hooks/use-arbitrage.ts` (multiple locations)
**Category:** Correctness

Every fetch error path calls `await response.json()` without guarding against non-JSON responses (502 proxy errors, HTML error pages). This throws a `SyntaxError` with an unhelpful message instead of the meaningful error.

**Recommendation:** Wrap in try-catch:
```typescript
if (!response.ok) {
    const text = await response.text();
    let msg = `Request failed (${response.status})`;
    try { msg = JSON.parse(text).error || msg; } catch {}
    throw new Error(msg);
}
```

---

## Minor Issues (11)

### CR-006: getExcludedStoreNames called N times in batch scrape
**File:** `bricklink-store-deal.service.ts:81`
**Category:** Performance
Each call to `scrapeAndStore` in a batch independently queries the exclusions table. Fetch once and pass in.

### CR-007: Rate limiter is per-instance, not per-process
**File:** `bricklink-store-scraper.ts:41`
**Category:** Performance
Concurrent API requests create separate scraper instances, each with their own `lastRequestTime`. The rate limit is bypassed.

### CR-008: Only 3 currencies recognised (GBP, USD, EUR)
**File:** `bricklink-store-scraper.ts:246-258`
**Category:** Correctness
Listings in other currencies (AUD, CAD, SEK, etc.) are silently skipped with `unitPrice === 0`. No logging.

### CR-009: ExcludedBrickLinkStoresModal query fires on page load
**File:** `ExcludedBrickLinkStoresModal.tsx:48` / `arbitrage/page.tsx:473`
**Category:** Performance
Modal is always mounted, so `useExcludedBrickLinkStores()` fires on page load even when modal is never opened. Either conditionally render or pass `enabled: isOpen`.

### CR-010: Concurrent restore button race condition
**File:** `ExcludedBrickLinkStoresModal.tsx:140`
**Category:** Correctness
Only the last-clicked store's restore button is disabled. Rapid clicking fires concurrent mutations.

### CR-011: Double DB round-trip on POST for single set
**File:** `bricklink-stores/[setNumber]/route.ts:81-84`
**Category:** Performance
After `scrapeAndStore` inserts rows, the handler immediately reads them back with `getListingsForSet`. The data was already in memory.

### CR-012: request.json() not wrapped in try/catch
**File:** `bricklink-store-exclusions/route.ts:69, 105`
**Category:** Standards
Invalid JSON body returns 500 instead of 400. The batch route correctly uses `.catch(() => ({}))`.

### CR-013: storeName unbounded length, reason not validated against enum
**File:** `bricklink-store-exclusions/route.ts:19-20`
**Category:** Standards
DB column is `VARCHAR(200)` but Zod only checks `min(1)`. The `reason` field accepts any string but the constants file defines a fixed set. Add `.max(200)` and `z.enum([...])`.

### CR-014: writer.close() in finally block can throw on client disconnect
**File:** `sync/bricklink-stores/route.ts:150`
**Category:** Standards
If the client disconnects mid-stream, `writer.close()` in the finally block will throw. Wrap in try/catch.

### CR-015: Estimated shipping always formatted as GBP
**File:** `StoreListingsPanel.tsx:180`
**Category:** Correctness
`formatCurrency(listing.estimatedShipping)` defaults to GBP while other columns use `listing.currencyCode`. Intentional but potentially confusing.

### CR-016: Inconsistent toast libraries
**File:** `ArbitrageDetailModal.tsx` uses `sonner`, `StoreListingsPanel.tsx` uses `@/hooks/use-toast`
**Category:** Standards
Toast notifications from the same modal appear in different UI locations.

---

## Nitpick Issues (5)

- **CR-017:** `Record<string, unknown>` casting discards Supabase type safety (`bricklink-store-deal.service.ts:216`)
- **CR-018:** No store name normalisation in exclusion service (case/whitespace)
- **CR-019:** `_queryClient` unused parameter in `createStreamingSyncMutation` (`use-arbitrage.ts:463`)
- **CR-020:** Duplicate import of `cn` and `formatCurrency` could be combined (`StoreListingsPanel.tsx`)
- **CR-021:** Missing `aria-label` on empty table header for actions column (`StoreListingsPanel.tsx:152`)

---

## Database Migration Review

**File:** `supabase/migrations/20260303000001_bricklink_store_deals.sql`

| Check | Status |
|-------|--------|
| RLS enabled | Yes (both tables) |
| User-scoped policies | Yes (`auth.uid() = user_id`) |
| Service role access | Yes (full access for background jobs) |
| Indexes | Yes (user_id, user+set, user+scraped_at) |
| Unique constraints | Yes (user+store_name, user+set+store) |
| Comments | Thorough |
| Constraint update | `arbitrage_sync_status` job_type check updated |

The migration is well-structured with proper RLS, indexes, and constraints.

---

## Delivery Report Fixes Review

**Files:** `apps/delivery-report/src/` (4 files)

| Check | Status |
|-------|--------|
| get_active_orders() join | Correct PostgREST embedded join syntax |
| matcher.py fallback chain | `order.get("item_name") or cached or "Unknown"` |
| GDPR modal dismissal | Aggressive JS removal of all Tealium/privacy elements |
| Sign-in force click | `force=True` defence-in-depth |
| Result summary logging | `cd_tracking_matches` added for diagnostics |

No issues found. These are straightforward, well-scoped fixes.

---

## Hadley Bricks Checklist

| Check | Status | Notes |
|-------|--------|-------|
| Platform credentials encrypted? | N/A | No credential storage in this branch |
| Adapter pattern followed? | N/A | Scraper is new pattern (not a platform adapter) |
| Repository pattern followed? | Partial | Services query Supabase directly, consistent with arbitrage module |
| RLS policies for new tables? | Pass | Both tables have user-scoped RLS |
| Tests added? | No | No tests for new code |
| Input validation with Zod? | Partial | CR-001 (batch route missing), CR-013 (exclusions incomplete) |

---

## CLAUDE.md Health

| Check | Status |
|-------|--------|
| Length | 143 lines (OK, under 200) |
| Inline code | No long code blocks |
| Feature docs | No feature-specific docs embedded |
| Incident rules | None |
| Duplication | None |

No issues.

---

## Verdict

## ⚠️ CONDITIONAL MERGE

**1 critical issue** (CR-001: unvalidated batch input) should ideally be fixed before merge.
**4 major issues** can be addressed in follow-up but are worth noting.

### Must Fix (Before Merge)
- **CR-001:** Add regex validation to `setNumbers` array elements in batch sync route

### Should Fix (Soon)
- **CR-003:** NaN handling in override input
- **CR-005:** Guard `.json()` calls in error paths

### Can Fix Later
- CR-002, CR-004, CR-006-CR-016
