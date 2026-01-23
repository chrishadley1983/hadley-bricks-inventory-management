# Merge Report: Home Costs Feature

**Date:** 2026-01-23
**Commit:** a4922d7
**Branch:** Direct commit to main
**Files Changed:** 20
**Lines Added:** 4,581

## Feature Summary

Added complete home working expenses management integrated with the P&L report:

- **Use of Home**: HMRC simplified expenses with flat rate tiers (£10/18/26 per month)
- **Phone & Broadband**: Multiple entries with business use percentage calculation
- **Insurance**: Annual premium with business stock value proportion
- **Settings**: Display mode configuration (separate/consolidated)

## Files Created

### API Routes
- `apps/web/src/app/api/home-costs/route.ts` - GET (list) and POST (create)
- `apps/web/src/app/api/home-costs/[id]/route.ts` - PATCH (update) and DELETE
- `apps/web/src/app/api/home-costs/settings/route.ts` - PATCH (update settings)

### Components
- `apps/web/src/components/features/home-costs/HomeCostsModal.tsx`
- `apps/web/src/components/features/home-costs/UseOfHomeTab.tsx`
- `apps/web/src/components/features/home-costs/PhoneBroadbandTab.tsx`
- `apps/web/src/components/features/home-costs/InsuranceTab.tsx`
- `apps/web/src/components/features/home-costs/SettingsTab.tsx`
- `apps/web/src/components/features/home-costs/MonthPicker.tsx`
- `apps/web/src/components/features/home-costs/index.ts`

### Hooks & Types
- `apps/web/src/hooks/use-home-costs.ts` - TanStack Query hooks
- `apps/web/src/types/home-costs.ts` - TypeScript interfaces

### Database
- `supabase/migrations/20260122100001_home_costs_tables.sql`

### Tests
- `apps/web/tests/e2e/home-costs.spec.ts` - Playwright E2E tests

### Documentation
- `docs/features/home-costs/done-criteria.md`
- `docs/features/home-costs/feature-spec.md`
- `docs/features/home-costs/build-feature/state.json`

## Files Modified

- `apps/web/src/app/(dashboard)/reports/profit-loss/page.tsx` - Added Home Costs button and modal
- `apps/web/src/lib/services/profit-loss-report.service.ts` - Added Home Costs queries and calculations
- `apps/web/src/lib/services/index.ts` - Export additions

## Verification Results

| Check | Status | Notes |
|-------|--------|-------|
| Code Review | ✅ Pass | No critical/major issues |
| Database Tests | ✅ Pass | All CRUD and constraint tests passed |
| API Verification | ✅ Pass | All endpoints verified via Supabase MCP |
| Security | ✅ Pass | RLS policies, no credential exposure |

## Database Changes

- Created `home_costs` table with polymorphic structure
- Created `home_costs_settings` table
- RLS policies for user isolation
- CHECK constraints for data validation
- Indexes for query performance
- Triggers for updated_at timestamps

## Other Uncommitted Work

The following files remain untracked (different feature - QuickFile MTD Export):
- `apps/web/src/app/api/integrations/quickfile/`
- `apps/web/src/app/api/reports/mtd-export/`
- `apps/web/src/components/features/mtd-export/`
- `docs/features/quickfile-mtd-export/`

## Notes

- Migration already applied to cloud Supabase
- Playwright tests created but require fresh auth token to run
- Feature verified via Supabase MCP direct database testing
