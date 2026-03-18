# Done Criteria: remove-vinted-scanner

**Created:** 2026-03-18
**Author:** Define Done Agent + Chris
**Status:** APPROVED

## Feature Summary

Remove all dead server-side Vinted scanner infrastructure from the Hadley Bricks app. The Chrome extension (separate repo at `Discord-Messenger/FB Refresh/vinted-sniper/`) has proven more robust and fully replaced this server-side approach. Tables are empty/stale (0 opportunities ever, last scan Feb 16). GCP job already paused. This is a pure deletion/cleanup — no new functionality.

## Success Criteria

### Functional

#### F1: Vinted Scanner Pages Deleted
- **Tag:** AUTO_VERIFY
- **Criterion:** The directories `apps/web/src/app/(dashboard)/arbitrage/vinted/` and `apps/web/src/app/(dashboard)/arbitrage/vinted/automation/` no longer exist
- **Evidence:** `glob` returns no matches for these paths
- **Test:** `ls apps/web/src/app/\(dashboard\)/arbitrage/vinted/` returns "not found"

#### F2: Vinted Automation Components Deleted
- **Tag:** AUTO_VERIFY
- **Criterion:** The directory `apps/web/src/components/features/vinted-automation/` no longer exists
- **Evidence:** `glob` returns no matches
- **Test:** `ls apps/web/src/components/features/vinted-automation/` returns "not found"

#### F3: Vinted Automation Hooks Deleted
- **Tag:** AUTO_VERIFY
- **Criterion:** The file `apps/web/src/hooks/use-vinted-automation.ts` no longer exists
- **Evidence:** File not found
- **Test:** `ls apps/web/src/hooks/use-vinted-automation.ts` returns "not found"

#### F4: Server-Side Vinted API Routes Deleted
- **Tag:** AUTO_VERIFY
- **Criterion:** All API routes under `apps/web/src/app/api/arbitrage/vinted/automation/` and the manual scan route `apps/web/src/app/api/arbitrage/vinted/route.ts` no longer exist
- **Evidence:** `glob` returns no matches for `api/arbitrage/vinted/automation/**` and `api/arbitrage/vinted/route.ts`
- **Test:** Directory and file listing confirms deletion

#### F5: Vinted Cleanup Cron Route Deleted
- **Tag:** AUTO_VERIFY
- **Criterion:** The directory `apps/web/src/app/api/cron/vinted-cleanup/` no longer exists
- **Evidence:** `glob` returns no matches
- **Test:** `ls apps/web/src/app/api/cron/vinted-cleanup/` returns "not found"

#### F6: Scanner Scripts Deleted
- **Tag:** AUTO_VERIFY
- **Criterion:** The directory `scripts/vinted-scanner/` no longer exists
- **Evidence:** `glob` returns no matches
- **Test:** `ls scripts/vinted-scanner/` returns "not found"

#### F7: Windows Scanner App Deleted
- **Tag:** AUTO_VERIFY
- **Criterion:** The directory `apps/windows-scanner/` no longer exists
- **Evidence:** `glob` returns no matches
- **Test:** `ls apps/windows-scanner/` returns "not found"

#### F8: GitHub Actions Workflow Deleted
- **Tag:** AUTO_VERIFY
- **Criterion:** The file `.github/workflows/vinted-cleanup-cron.yml` no longer exists
- **Evidence:** File not found
- **Test:** `ls .github/workflows/vinted-cleanup-cron.yml` returns "not found"

#### F9: Vinted Test Files Deleted
- **Tag:** AUTO_VERIFY
- **Criterion:** Test files `apps/web/src/app/api/__tests__/vinted-automation.test.ts`, `apps/web/src/types/__tests__/vinted-automation.test.ts`, and `apps/web/src/lib/services/__tests__/vinted-schedule.service.test.ts` no longer exist
- **Evidence:** Files not found
- **Test:** `glob` returns no matches

#### F10: GCP Scheduler Job Deleted
- **Tag:** AUTO_VERIFY
- **Criterion:** The `vinted-cleanup` job no longer exists in GCP Cloud Scheduler (not just paused — fully deleted)
- **Evidence:** `gcloud scheduler jobs describe vinted-cleanup --location=europe-west2` returns NOT_FOUND
- **Test:** Run gcloud describe command, expect error

### Integration

#### I1: Sidebar Nav Link Removed
- **Tag:** AUTO_VERIFY
- **Criterion:** The Sidebar component (`apps/web/src/components/layout/Sidebar.tsx`) no longer contains a link to `/arbitrage/vinted`
- **Evidence:** `grep "arbitrage/vinted" Sidebar.tsx` returns no matches
- **Test:** Grep for the string in Sidebar.tsx

#### I2: Parent Arbitrage Page Intact
- **Tag:** AUTO_VERIFY
- **Criterion:** The page at `apps/web/src/app/(dashboard)/arbitrage/page.tsx` still exists and contains BrickLink, eBay, and Seeded tabs
- **Evidence:** File exists and contains strings `bricklink`, `ebay`, `seeded`
- **Test:** File exists and grep confirms tab strings

#### I3: Discord Service Cleaned
- **Tag:** AUTO_VERIFY
- **Criterion:** The `sendVintedDailySummary` method is removed from `apps/web/src/lib/notifications/discord.service.ts` (only called by the deleted cleanup cron)
- **Evidence:** `grep "VintedDailySummary" discord.service.ts` returns no matches
- **Test:** Grep for the method name

#### I4: Vinted Purchase Components Preserved
- **Tag:** AUTO_VERIFY
- **Criterion:** Purchase-related Vinted components (`VintedPurchaseReviewRow`, `VintedImportModal`, `VintedImportButton`, `VintedInventoryReviewCard`) still exist in `components/features/purchases/`
- **Evidence:** Files still present
- **Test:** `glob` confirms all 4 files exist

#### I5: Vinted Watchlist API Route Decision
- **Tag:** AUTO_VERIFY
- **Criterion:** The route `apps/web/src/app/api/arbitrage/vinted/watchlist/` is either deleted (if only used by scanner) or preserved (if used elsewhere), and no broken imports reference it
- **Evidence:** If deleted, no remaining imports. If kept, still functional.
- **Test:** Grep for imports of this route across codebase

#### I6: Audit Documents Updated
- **Tag:** AUTO_VERIFY
- **Criterion:** `docs/scheduled-jobs-audit.html` and `docs/scheduled-jobs-audit.md` reflect vinted-cleanup as deleted (not just paused), and the job count is decremented
- **Evidence:** Grep for "vinted-cleanup" in both files shows "DELETED" or equivalent, job count shows 27
- **Test:** Grep both files

### Error Handling

#### E1: TypeScript Compilation Passes
- **Tag:** AUTO_VERIFY
- **Criterion:** `npm run typecheck` completes with zero errors
- **Evidence:** Exit code 0, no type errors in output
- **Test:** Run `npm run typecheck`

#### E2: No Broken Imports
- **Tag:** AUTO_VERIFY
- **Criterion:** No remaining `.ts`/`.tsx` file imports from any deleted path (`vinted-automation`, `use-vinted-automation`, `arbitrage/vinted/automation`, `cron/vinted-cleanup`)
- **Evidence:** Grep across `apps/web/src/` for deleted import paths returns zero matches
- **Test:** Grep for each deleted module path

## Out of Scope

- **Supabase tables NOT dropped** — `vinted_opportunities`, `vinted_scan_log`, `vinted_watchlist_stats`, `vinted_scanner_config`, `vinted_watchlist` remain in the database for now. Can be cleaned up in a separate migration later.
- **Chrome Extension not touched** — lives in separate repo `Discord-Messenger/FB Refresh/vinted-sniper/`
- **Vinted purchase import flow preserved** — `VintedImportModal`, `VintedPurchaseReviewRow` etc. in `components/features/purchases/` are for the email-purchases cron, not the scanner
- **No new functionality** — this is purely deletion

## Dependencies

- GCP CLI access for scheduler job deletion
- No database migrations (tables kept)

## Iteration Budget

- **Max iterations:** 3
- **Escalation:** This is straightforward deletion — if typecheck fails after 3 attempts, review remaining references manually
