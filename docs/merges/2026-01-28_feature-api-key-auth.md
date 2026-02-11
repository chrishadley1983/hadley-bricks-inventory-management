# Merge Report: feature/api-key-auth

**Merged At:** 2026-01-28T09:19:02Z
**Merge Commit:** 303b629ace19b57c8ebb13f0b4a4f028b6fa5b8e
**PR:** https://github.com/chrishadley1983/hadley-bricks-inventory-management/pull/21

## Summary

Fixed the automated negotiation cron job failing with "Failed to connect to eBay" error.

### Root Cause

The cron job at `/api/cron/negotiation` was triggered correctly by GCP Cloud Scheduler (HTTP 200), but failed internally because:

1. `NegotiationService` instantiated `EbayAuthService` without passing a Supabase client
2. `EbayAuthService.getCredentials()` called `createClient()` which requires cookies
3. Cron requests from GCP have no cookies, so RLS blocked access to `ebay_credentials`
4. Token fetch failed, service returned `false`, cron reported "Failed to connect to eBay"

### Solution

- Updated `EbayAuthService` to accept an optional Supabase client parameter
- Updated `NegotiationService` to pass the injected client to `EbayAuthService`
- Updated cron route to pass service role client through the chain
- Also included: API key auth for sync-all and picking-list endpoints

## Commits Merged

| Hash | Message |
|------|---------|
| 050816d | feat: add API key auth to sync-all and picking-list endpoints |
| 52d4747 | fix: Pass service role client to negotiation service for cron context |

## Files Changed

| File | Changes |
|------|---------|
| `apps/web/src/app/api/cron/negotiation/route.ts` | Pass supabase client to service |
| `apps/web/src/app/api/picking-list/amazon/route.ts` | Add API key auth |
| `apps/web/src/app/api/picking-list/ebay/route.ts` | Add API key auth |
| `apps/web/src/app/api/workflow/sync-all/route.ts` | Add API key auth |
| `apps/web/src/lib/api/validate-auth.ts` | NEW - Dual auth validation helper |
| `apps/web/src/lib/ebay/ebay-auth.service.ts` | Accept optional Supabase client |
| `apps/web/src/lib/ebay/negotiation.service.ts` | Pass client to EbayAuthService |

## Verification Results

| Check | Status | Notes |
|-------|--------|-------|
| TypeScript | PASS | No errors |
| Code Review | PASS | Approved |
| Production Test | PASS | Cron endpoint working |

### Production Test Results

```json
{
  "success": true,
  "usersProcessed": 1,
  "totalStatusSynced": 183,
  "totalOffersSent": 106,
  "totalOffersFailed": 0,
  "userResults": [{
    "userId": "4b6e94b4-661c-4462-9d14-b21df7d51e5b",
    "statusSync": {"accepted": 2, "expired": 181},
    "offersSent": 106,
    "offersFailed": 0
  }]
}
```

## Cleanup

| Action | Status |
|--------|--------|
| PR Merged | Complete |
| Local branch deleted | Complete (via PR merge) |
| Remote branch deleted | Complete (via PR merge) |
| References pruned | Complete |

## Other Unmerged Branches

- `fix/negotiation-cron-rls` - May be superseded by this fix
- `fix/unused-request-param` - Minor cleanup
- `feature/morning-sync-api` - Local only
