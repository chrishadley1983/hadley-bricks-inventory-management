# Merge Report: feature/full-sync-job

**Date:** 2026-01-29
**PR:** [#58](https://github.com/chrishadley1983/hadley-bricks-inventory-management/pull/58)
**Merge Commit:** 30f8978
**Previous Commit:** 22fd36c

## Summary

Added a scheduled cron job that runs twice daily (7:45 AM and 1:45 PM UK time) to perform comprehensive platform syncs, track Amazon inventory ASINs, cleanup stuck jobs, and send Discord status reports.

## Commits Merged

| SHA | Message |
|-----|---------|
| c206c45 | feat: add full-sync scheduled cron job |
| 2d34049 | docs: add build state and log for full-sync-job |
| 7499dc6 | fix: use order_date instead of fulfilled_at for weekly sold stats |
| b0bdd44 | fix: include ebay_orders in weekly sold stats |

## Files Changed

| File | Change |
|------|--------|
| `apps/web/src/app/api/cron/full-sync/route.ts` | Added (686 lines) |
| `docs/features/full-sync-job/build-log.md` | Added |
| `docs/features/full-sync-job/build-state.json` | Added |
| `vercel.json` | Modified (added cron schedule) |

## Feature Details

### New Cron Endpoint: `/api/cron/full-sync`

**Schedule:** `45 7,13 * * *` (7:45 AM and 1:45 PM UTC)

**Functions:**
- Runs 5 platform syncs in parallel (eBay Orders, eBay Auto Sync, Amazon, BrickLink, Brick Owl)
- Syncs Amazon inventory ASINs to `tracked_asins` table
- Detects and resets stuck jobs (running > 30 minutes)
- Sends comprehensive Discord notification to #sync-status

**Technical Highlights:**
- `Promise.allSettled()` for parallel execution with continue-on-failure
- Individual 60-second timeouts per sync
- `maxDuration = 300` for Vercel function limit
- Weekly stats combine both `platform_orders` and `ebay_orders` tables
- Color-coded Discord embeds (green/orange/red based on results)

## Verification Results

| Check | Status | Notes |
|-------|--------|-------|
| TypeScript | PASS | No errors |
| ESLint | PASS | Clean |
| Manual Test | PASS | 66 seconds, all syncs completed |
| Discord Notification | PASS | Sent correctly to #sync-status |
| Weekly Stats | PASS | 16 orders (£558.54) - correct combined total |
| Production Deploy | PASS | Site responding (307 redirect as expected) |

## Done Criteria

All 26 AUTO_VERIFY criteria passed per `docs/features/full-sync-job/build-state.json`:

- Functional: 11/11
- Discord Notification: 9/9
- Error Handling: 4/4
- Performance: 2/2

## Cleanup

| Action | Status |
|--------|--------|
| PR Merged | COMPLETE |
| Worktree Removed | COMPLETE |
| Local Branch Deleted | COMPLETE |
| Remote Branch Deleted | COMPLETE |
| References Pruned | COMPLETE |

## Other Unmerged Branches

- `fix/add-accept-language-header`
- `fix/inventory-api-deep-clean`
- `fix/inventory-api-minimal-clean`
- Various debug branches

## Notes

- Pre-existing eBay RLS issue in sync services (using `createClient()` instead of `createServiceRoleClient()`) - syncs work but logging fails. Not related to this feature.
- Cron will trigger automatically at scheduled times once deployed

## Next Steps

1. Monitor first scheduled cron run (next: 7:45 AM or 1:45 PM UK time)
2. Check Discord #sync-status channel for notifications
3. Consider fixing eBay RLS issue in separate fix branch
