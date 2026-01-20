# Merge Report: Cost Modelling Feature

**Date:** 2026-01-18
**Commit:** 2fc5e28192e6f498686a61e44e5f3cf773a7db09
**Branch:** main (direct commit)
**Files Changed:** 31
**Lines Added:** 6,372

---

## Summary

Added comprehensive cost modelling and P&L projection tool for financial scenario planning in the LEGO resale business.

## Features Implemented

### Core Functionality
- **Scenario Management** - Create, save, duplicate, and delete financial scenarios
- **Per-Platform Assumptions** - Configure sales, fees, and COG for BrickLink, Amazon, eBay
- **P&L Calculations** - Full profit & loss calculations with VAT and UK tax support
- **Package Cost Matrix** - 6 package types × cost components with auto-totals
- **Summary Views** - Daily, Weekly, Monthly breakdowns with per-platform metrics
- **Compare Mode** - Side-by-side scenario comparison with delta highlighting
- **Export** - PDF and CSV export with formatted reports
- **Auto-Save Drafts** - 30-second auto-save with restoration dialog
- **Conflict Detection** - Optimistic locking for concurrent edits

### Technical Implementation
- Repository pattern with `CostModellingRepository`
- React Query hooks for data fetching
- Memoized calculations via `useCostCalculations`
- RLS policies for multi-tenant security
- Batch upsert for package cost updates (N+1 fix)

---

## Files Added/Modified

### New Files (26)

**Pages & Routes:**
- `apps/web/src/app/(dashboard)/cost-modelling/page.tsx`
- `apps/web/src/app/(dashboard)/cost-modelling/loading.tsx`

**API Routes:**
- `apps/web/src/app/api/cost-modelling/scenarios/route.ts`
- `apps/web/src/app/api/cost-modelling/scenarios/[id]/route.ts`
- `apps/web/src/app/api/cost-modelling/scenarios/[id]/duplicate/route.ts`
- `apps/web/src/app/api/cost-modelling/scenarios/[id]/draft/route.ts`

**Components:**
- `CostModellingPage.tsx` - Main orchestrator
- `ScenarioSelector.tsx` - Dropdown with actions
- `AssumptionsPanel.tsx` - Collapsible input sections
- `ProfitSummaryCards.tsx` - Hero metric cards
- `PLBreakdown.tsx` - Detailed P&L view
- `PackageCostMatrix.tsx` - Package cost editor
- `SummaryViewTabs.tsx` - Time-based summaries
- `CompareMode.tsx` - Side-by-side comparison
- `ComparisonSummary.tsx` - Delta table
- `ExportButtons.tsx` - PDF/CSV export
- `SaveAsDialog.tsx` - Create scenario dialog
- `DeleteConfirmDialog.tsx` - Delete confirmation
- `DraftRestorationDialog.tsx` - Draft restore prompt

**Hooks:**
- `apps/web/src/hooks/use-cost-modelling.ts`
- `apps/web/src/hooks/use-cost-calculations.ts`

**Services & Repositories:**
- `apps/web/src/lib/repositories/cost-modelling.repository.ts`
- `apps/web/src/lib/services/cost-calculations.ts`

**Types:**
- `apps/web/src/types/cost-modelling.ts`

**Database:**
- `supabase/migrations/20260118120001_cost_modelling_tables.sql`

### Modified Files (5)
- `apps/web/src/components/layout/Sidebar.tsx` - Added navigation link
- `apps/web/package.json` - Added jspdf dependencies
- `package-lock.json` - Updated lockfile
- `packages/database/src/types.ts` - Regenerated Supabase types
- `packages/database/src/index.ts` - Exported new types

---

## Verification

### Done Criteria (77 AUTO_VERIFY)
| Phase | Criteria | Status |
|-------|----------|--------|
| Core Model | F1-F24 | ✅ Pass |
| Package Cost Matrix | F25-F30 | ✅ Pass |
| Summary Views | F31-F34 | ✅ Pass |
| Compare Mode | F35-F44 | ✅ Pass |
| Polish & UX | F45-F56 | ✅ Pass |
| Error Handling | E1-E7 | ✅ Pass |
| Performance | P1-P6 | ✅ Pass |
| UI/UX | U1-U10 | ✅ Pass |
| Integration | I1-I4 | ✅ Pass |

### Code Review Fixes Applied
- ✅ Fixed unused variables (ESLint errors)
- ✅ Fixed N+1 query in package cost updates
- ✅ Removed invalid type import
- ✅ Added missing React hook dependencies

### Static Analysis
- ✅ ESLint: No errors in cost-modelling files
- ✅ Page returns HTTP 200
- ⚠️ TypeScript: 3 errors in unrelated test files

---

## Database Changes

### New Tables
1. `cost_model_scenarios` - Main scenario storage with all assumptions
2. `cost_model_package_costs` - Package cost matrix (6 rows per scenario)

### RLS Policies
- Full CRUD policies for both tables
- User isolation via `auth.uid() = user_id`

### Indexes
- `idx_cost_scenarios_user` - User lookup
- `idx_cost_scenarios_updated` - Updated timestamp
- `idx_cost_package_scenario` - Package cost by scenario

---

## Dependencies Added

```json
{
  "jspdf": "^3.0.4",
  "jspdf-autotable": "^5.0.2"
}
```

---

## Post-Merge Actions

- [ ] Push migration to Supabase: `npm run db:push`
- [ ] Verify page works in production
- [ ] Consider adding unit tests for calculations

---

## Related Documentation

- Done Criteria: `docs/features/cost-modelling/done-criteria.md`
- Specification: `docs/cost-modelling-specification.md`
