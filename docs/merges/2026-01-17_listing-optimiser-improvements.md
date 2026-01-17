# Merge Report: Listing Optimiser Improvements

**Date**: 2026-01-17
**Commit**: 5c6b449
**Author**: Claude Opus 4.5

---

## Summary

Improved the Listing Optimiser feature with reliability fixes, better error handling, and support for eBay's product catalog locked aspects.

---

## Changes

### Files Modified (13 files, +1180/-97 lines)

| File | Changes |
|------|---------|
| `page.tsx` | Race condition fix for re-analysis timing |
| `analyse/route.ts` | Minor API route updates |
| `apply/route.ts` | Apply endpoint improvements |
| `route.ts` | Listing fetch improvements |
| `OptimiserTab.tsx` | Component updates |
| `AnalysisPanel.tsx` | UI state management fixes |
| `OptimiserTable.tsx` | Score badge color updates |
| `analyse-listing.ts` | AI prompt for locked product aspects |
| `listing-optimiser.service.ts` | JSON truncation recovery, product catalog detection |
| `ebay-trading.client.ts` | Detailed logging for ReviseFixedPriceItem |
| `types.ts` | Type additions |
| `types.ts` (database) | Applied suggestions table types |

### New Files

| File | Description |
|------|-------------|
| `20260117120000_listing_applied_suggestions.sql` | Migration for tracking applied suggestions |

---

## Key Improvements

### 1. Race Condition Fix
**Problem**: When approving the last suggestion, re-analysis would run before the apply completed, analysing stale data.

**Solution**:
- Set `hasApprovedAnyRef.current = true` BEFORE the async apply starts
- Added `pendingReanalyse` state to defer re-analysis if apply is pending
- Added `useEffect` to trigger re-analysis when apply completes

### 2. JSON Truncation Recovery
**Problem**: Gemini API responses sometimes truncated mid-JSON.

**Solution**:
- Increased `maxOutputTokens` from 4096 to 8192
- Added truncation detection (response not ending with `}`)
- Added `truncation-recovery` strategy that counts braces/brackets and closes them

### 3. eBay Product Catalog Handling
**Problem**: eBay silently ignores changes to "locked" product aspects when listings are linked to the product catalog.

**Solution**:
- Updated AI prompt to list locked aspects (Packaging, Brand, MPN, etc.)
- AI now suggests description/condition reinforcement instead
- Service detects product override warnings and returns user-friendly error

### 4. Better Error Visibility
- Apply failures now show 10-second toast (was default duration)
- Added detailed console logging for eBay API calls
- Log full request/response XML for debugging

---

## Testing

| Test | Status |
|------|--------|
| TypeScript compilation | ✅ Pass |
| ESLint | ✅ Pass (only pre-existing warnings) |
| Migration | ✅ Already applied |

---

## Database Changes

### New Table: `listing_applied_suggestions`

Tracks which AI suggestions have been applied to avoid re-suggesting similar changes.

```sql
CREATE TABLE listing_applied_suggestions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  ebay_listing_id TEXT NOT NULL,
  category TEXT NOT NULL,
  field TEXT NOT NULL,
  original_value TEXT,
  applied_value TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL,
  review_id UUID,
  created_at TIMESTAMPTZ NOT NULL
);
```

With RLS policies for user isolation.

---

## Rollback

If issues arise:
```powershell
git revert 5c6b449
git push origin main
```

---

## Notes

- The `.playwright-mcp/` screenshots were NOT committed (test artifacts)
- The `.claude/settings.local.json` was NOT committed (local config)
