# Code Review Report

**Mode:** branch
**Branch:** `fix/amazon-sync-shipped-status`
**Timestamp:** 2026-03-03
**Files Changed:** 2 (+ 1 deleted)
**Lines Added:** 200
**Lines Removed:** 4

---

## Summary

| Category | Critical | Major | Minor | Nitpick |
|----------|----------|-------|-------|---------|
| Correctness | 0 | 1 | 0 | 0 |
| Security | 0 | 0 | 0 | 0 |
| Performance | 0 | 0 | 1 | 0 |
| Standards | 0 | 0 | 0 | 1 |
| **Total** | **0** | **1** | **1** | **1** |

### Static Analysis

| Check | Status |
|-------|--------|
| TypeScript | Pass |
| ESLint | Pass (0 new warnings) |
| Tests | Pass (39/39) |

---

## Major Issues (1)

### CR-001: DB query error silently swallowed in verifyDispatchOrderStatuses

**File:** `apps/web/src/lib/services/amazon-sync.service.ts:455`
**Category:** Correctness
**Severity:** Major

```typescript
if (error || !dispatchOrders || dispatchOrders.length === 0) {
  return;
}
```

**Problem:** If the Supabase query fails (`error` is truthy), the method silently returns without logging or recording the error. A transient DB failure would mean the dispatch verification step is silently skipped with no indication in logs or the `SyncResult`.

**Recommendation:** Log the error and optionally push it to `result.errors` so it surfaces:

```typescript
if (error) {
  console.error('[AmazonSyncService] Failed to query dispatch orders:', error.message);
  return;
}
if (!dispatchOrders || dispatchOrders.length === 0) {
  return;
}
```

**Required Action:** Should fix before merge.

---

## Minor Issues (1)

### CR-002: Rate-limit sleep runs after last order unnecessarily

**File:** `apps/web/src/lib/services/amazon-sync.service.ts:487`
**Category:** Performance

```typescript
// Rate limit between API calls
await new Promise((resolve) => setTimeout(resolve, 200));
```

**Problem:** The 200ms sleep runs after *every* order, including the last one. For a single dispatch order this adds a needless 200ms to every sync.

**Suggestion:** Move the sleep to the top of the loop (skip on first iteration) or add a check:

```typescript
if (i < dispatchOrders.length - 1) {
  await new Promise((resolve) => setTimeout(resolve, 200));
}
```

This is minor — the 200ms overhead is small and correctness matters more than a fraction of a second.

---

## Nitpicks (1)

### CR-003: `terminalStatuses` array could be a module-level constant

**File:** `apps/web/src/lib/services/amazon-sync.service.ts:333`

```typescript
const terminalStatuses = ['Canceled', 'Cancelled/Refunded'];
```

This is declared inside `processOrder` and re-created on every call. It's harmless, but extracting it as a `const` at module scope (next to `DEFAULT_EU_MARKETPLACES`) would be marginally cleaner and consistent with `dispatchStatuses` being extracted too in the future.

---

## Files Reviewed

| File | Status | Issues |
|------|--------|--------|
| `apps/web/src/lib/services/amazon-sync.service.ts` | Review | 3 |
| `apps/web/src/lib/services/__tests__/amazon-sync.service.test.ts` | Pass | 0 |
| `apps/web/check-shipped-orders.ts` | Deleted | 0 |

---

## Hadley Bricks Checklist

| Check | Status | Notes |
|-------|--------|-------|
| Platform credentials encrypted? | N/A | No credential changes |
| Adapter pattern followed? | Pass | |
| Repository pattern followed? | Pass | Uses `orderRepo` consistently |
| Dual-write implemented? | N/A | No new writes |
| RLS policies added? | N/A | No new tables |
| Tests added for new code? | Pass | 5 new tests covering all 3 fixes |

---

## CLAUDE.md Health

| Check | Status |
|-------|--------|
| Length (143 lines) | Pass |
| Inline code blocks | Pass |
| Feature docs | Pass |
| Incident rules | Pass |
| Duplication | Pass |

---

## Recommendations

1. **Should Fix (Before Merge)**
   - CR-001: Log the Supabase query error rather than silently returning

2. **Consider**
   - CR-002: Avoid trailing sleep after last dispatch order
   - CR-003: Extract terminal statuses to module constant

---

## Verdict

## READY FOR MERGE (with CR-001 fix)

No critical issues. 1 major issue (silent error swallowing) is a quick one-liner to add logging. The 3 fixes are correct, well-tested, and follow existing patterns.
