# Merge Report: fix/full-sync-ebay-cron-support

**Date:** 2026-01-30
**Track:** FIX
**PR:** #62
**Commit:** f728342

## Summary

Fixed eBay sync services failing in cron context by refactoring them to accept an optional Supabase client.

## Problem

The full-sync cron job was reporting "Failed to start sync" for eBay Orders and eBay Transactions. Root cause: the services used `createClient()` which requires cookie-based authentication, but cookies are unavailable in cron/background job contexts.

## Solution

Refactored eBay sync services to follow the dependency injection pattern already used by `EbayAuthService`:

1. **EbayOrderSyncService** - Added constructor accepting optional `SupabaseClient`
2. **EbayTransactionSyncService** - Added constructor accepting optional `SupabaseClient`
3. **EbayAutoSyncService** - Added constructor that creates child services with injected client
4. **Full-sync cron route** - Now instantiates eBay services with `createServiceRoleClient()`
5. **BrickLink timeout** - Increased from 60s to 90s for slower API responses

## Files Changed

| File | Changes |
|------|---------|
| `apps/web/src/lib/ebay/ebay-order-sync.service.ts` | +38 lines |
| `apps/web/src/lib/ebay/ebay-transaction-sync.service.ts` | +42 lines |
| `apps/web/src/lib/ebay/ebay-auto-sync.service.ts` | +74/-6 lines |
| `apps/web/src/app/api/cron/full-sync/route.ts` | +9/-2 lines |

## Verification

### Pre-merge
- [x] TypeScript compiles with no errors
- [x] ESLint passes (only pre-existing warnings)
- [x] 131 eBay service tests pass
- [x] Code review: APPROVED

### Post-merge
- [x] Vercel deployment: SUCCESS
- [x] Full-sync cron endpoint: WORKING
  - Response: `{"success":true,"duration":88053,"platformSyncs":5,...}`

## Breaking Changes

None. The services maintain backward compatibility:
- Default singleton exports preserved for existing callers
- New `SupabaseClient` parameter is optional

## Rollback Plan

```powershell
git revert f728342
git push origin main
```

## Related

- PR #61: Removed Vercel crons (migrated to GCS)
- Previous fix: Vercel deployment was blocked due to cron config
