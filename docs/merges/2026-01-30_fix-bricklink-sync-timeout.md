# Merge Report: fix/bricklink-sync-timeout

**Date:** 2026-01-30
**Track:** FIX
**PR:** #63
**Commit:** 90b7876

## Summary

Increased the BrickLink client's internal request timeout from 30 seconds to 90 seconds to match the cron job's timeout wrapper.

## Problem

The BrickLink API can be slow to respond. The cron job's `withTimeout()` wrapper used 90 seconds for BrickLink syncs, but the BrickLink client had its own internal 30-second fetch timeout. This caused the client to timeout before the cron's timeout, resulting in sync failures.

## Solution

Aligned the BrickLink client's `REQUEST_TIMEOUT` constant with the cron job timeout:

- Changed `REQUEST_TIMEOUT` from 30000ms (30s) to 90000ms (90s)

## Files Changed

| File | Changes |
|------|---------|
| `apps/web/src/lib/bricklink/client.ts` | +1/-1 (timeout change) |

## Verification

### Pre-merge
- [x] TypeScript compiles with no errors
- [x] ESLint passes (only pre-existing warnings)
- [x] Code review: APPROVED

### Post-merge
- [x] Vercel deployment: PENDING (will verify)

## Breaking Changes

None.

## Rollback Plan

```powershell
git revert 90b7876
git push origin main
```

## Related

- PR #62: Fixed eBay sync services in cron context (also touched full-sync route)
- Full-sync cron job uses 90s timeout for BrickLink via `withTimeout()`
