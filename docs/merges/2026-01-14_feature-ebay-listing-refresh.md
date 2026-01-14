# Merge Report: feature/ebay-listing-refresh

**Date:** 2026-01-14
**Branch:** `feature/ebay-listing-refresh` → `main`
**Merge Commit:** `dd43acf`

## Summary

Added eBay listing refresh feature to boost algorithm visibility by ending old listings (>90 days) and recreating them as new listings.

## Changes Overview

| Category | Files Changed |
|----------|---------------|
| API Routes | 9 new files |
| Components | 12 new files |
| Hooks | 5 new files |
| Services | 3 new files |
| Database | 1 migration |
| Tests | 1 E2E spec |
| **Total** | **38 files, +6,811 lines** |

## Key Features

### Listing Discovery
- Fetch all active listings from eBay Trading API
- Filter to listings older than 90 days
- Display sortable table with engagement metrics (watchers, views, sales)

### Views Analytics Integration
- New `EbayAnalyticsClient` for eBay Sell Analytics API
- Fetches `LISTING_VIEWS_TOTAL` metric
- Handles 89-day date range (eBay's inclusive counting)
- Batch processing with 20 listings per request

### Refresh Execution
- Three-phase process: Fetch → End → Create
- Token refresh before each phase to prevent expiry
- Real-time progress via Server-Sent Events (SSE)
- Per-item error handling (batch continues on failure)

### Review Mode
- Optional pre-refresh review of each listing
- Edit title, price, quantity before recreation
- Approve/skip individual items
- Full original data preserved for audit

## New Files

### API Endpoints
```
apps/web/src/app/api/ebay/
├── connection/scopes/route.ts           # Check OAuth scopes
└── listing-refresh/
    ├── route.ts                         # POST create, GET history
    ├── eligible/
    │   ├── route.ts                     # GET eligible listings
    │   └── enrich/route.ts              # POST enrich with views (SSE)
    └── [id]/
        ├── route.ts                     # GET job details
        ├── execute/route.ts             # POST execute (SSE)
        └── items/
            ├── [itemId]/route.ts        # PATCH update item
            ├── approve/route.ts         # POST bulk approve
            └── skip/route.ts            # POST bulk skip
```

### React Components
```
apps/web/src/components/features/listing-assistant/
├── tabs/RefreshTab.tsx                  # Main tab component
└── refresh/
    ├── EligibleListingsTable.tsx        # Sortable DataTable
    ├── EngagementPopover.tsx            # Stats popover
    ├── RefreshHistoryList.tsx           # Past jobs list
    ├── RefreshItemEditModal.tsx         # Edit before refresh
    ├── RefreshJobProgress.tsx           # Execution progress
    ├── RefreshModeToggle.tsx            # Review/immediate toggle
    ├── RefreshResultsSummary.tsx        # Completion summary
    ├── ScopeUpgradePrompt.tsx           # OAuth reconnect prompt
    └── ViewsEnrichmentProgress.tsx      # Views loading progress
```

### React Hooks
```
apps/web/src/hooks/listing-refresh/
├── use-ebay-scopes.ts                   # Check OAuth scopes
├── use-eligible-listings.ts             # Fetch eligible listings
├── use-enrich-views.ts                  # Add views data (SSE)
├── use-execute-refresh.ts               # Execute job (SSE)
└── use-refresh-job.ts                   # Job management mutations
```

### Services
```
apps/web/src/lib/ebay/
├── ebay-analytics.client.ts             # Sell Analytics API client
├── ebay-listing-refresh.service.ts      # Main refresh service
└── listing-refresh.types.ts             # TypeScript types
```

### Database Migration
```sql
-- supabase/migrations/20260114112231_ebay_listing_refreshes.sql
CREATE TABLE ebay_listing_refreshes (
  -- Job tracking: status, counts, timing
);
CREATE TABLE ebay_listing_refresh_items (
  -- Per-item audit: original data, modified data, new listing
);
-- RLS policies, indexes, triggers
```

## Technical Notes

### eBay API Integration
- **Trading API**: `GetSellerList`, `GetItem`, `EndFixedPriceItem`, `AddFixedPriceItem`
- **Sell Analytics API**: `getTrafficReport` with `LISTING_VIEWS_TOTAL` metric
- **OAuth Scopes**: Added `sell.analytics.readonly` for views data
- **Rate Limiting**: 150ms delay between API calls

### Date Range Calculation
eBay counts date ranges inclusively, so a "90-day range" requires 89 days:
```typescript
const ANALYTICS_DATE_RANGE_DAYS = 89;
startDate.setDate(startDate.getDate() - ANALYTICS_DATE_RANGE_DAYS);
```

### Token Refresh Strategy
Token is refreshed at the start of each execution phase to prevent expiry during long batch operations:
```typescript
// Phase 1: Fetch
let client = await this.getTradingClient();
// ... process items ...

// Phase 2: End
client = await this.getTradingClient(); // Refresh token
// ... process items ...

// Phase 3: Create
client = await this.getTradingClient(); // Refresh token
// ... process items ...
```

## Verification

| Check | Status |
|-------|--------|
| TypeScript | ✅ Pass |
| ESLint | ✅ Pass (warnings only) |
| Unit Tests | ⚠️ Pre-existing failures (8 files, 47 tests) |
| Post-merge Build | ✅ Pass |

## Breaking Changes

None. Feature is additive under new "Refresh" tab in Listing Assistant.

## Migration Required

Database migration must be applied to create new tables:
```powershell
npm run db:push
```
