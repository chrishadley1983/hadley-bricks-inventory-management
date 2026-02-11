# Done Criteria: lego-investment-model

**Created:** 2026-02-07
**Author:** Define Done Agent + Chris
**Status:** APPROVED
**PRD Reference:** `C:\Users\Chris Hadley\Documents\LEGO_INVESTMENT_PREDICTOR_PRD.md`

## Feature Summary

Build the data foundation and retirement tracking layer for a LEGO Investment Predictor, integrated into the existing Hadley Bricks Inventory Management app. This covers Phase 1 (Data Foundation) and Phase 2 (Retirement Tracking) of the PRD, adapted to use Supabase PostgreSQL, TypeScript, and existing infrastructure (Brickset API client, cron jobs, repository/service patterns). The existing `brickset_sets` table is extended with investment-specific columns, a Rebrickable API auto-sync populates 2,000+ sets, and retirement data is aggregated from multiple sources into a new dashboard page.

**Key architectural decisions:**
- Extend existing `brickset_sets` table (not separate table)
- Rebrickable REST API with automated weekly cron sync
- Full retirement tracker with multi-source aggregation
- ML model (XGBoost/ONNX) for predictions in future phase (not Claude API)
- New `/investment` dashboard page with DataTable

## Success Criteria

### Functional

#### F1: Schema migration extends brickset_sets with investment columns
- **Tag:** AUTO_VERIFY
- **Criterion:** A Supabase migration adds investment and retirement columns to `brickset_sets`, creates `retirement_sources` table (per-source retirement dates with confidence levels), and creates `price_snapshots` table (for future price history tracking). All existing data is preserved. RLS is enabled on new tables.
- **Evidence:** Migration file exists in `supabase/migrations/`. Running `npm run db:push` succeeds. Querying existing `brickset_sets` rows returns all prior data unchanged. New columns (`exclusivity_tier`, `retirement_status`, `expected_retirement_date`, `amazon_asin`, `has_amazon_listing`, `category`, `is_licensed`, `is_ucs`, `is_modular`) exist and default to NULL. `retirement_sources` and `price_snapshots` tables exist with correct schema and RLS policies.
- **Test:** Run migration, query `brickset_sets` count matches pre-migration count, new columns present, new tables queryable.

#### F2: Rebrickable API client and weekly cron sync
- **Tag:** AUTO_VERIFY
- **Criterion:** A Rebrickable API client exists that fetches sets, themes, and minifig counts from the Rebrickable REST API. A cron job endpoint runs weekly, inserting new sets and updating existing ones. The sync merges with `brickset_sets` without overwriting Brickset-specific fields (ratings, pricing, images).
- **Evidence:** API client file exists at `apps/web/src/lib/rebrickable/`. Cron route exists at `apps/web/src/app/api/cron/rebrickable-sync/route.ts`. Calling the cron endpoint returns 200 with sync stats (inserted, updated, skipped counts). Brickset-specific fields on existing rows are unchanged after sync.
- **Test:** Call cron endpoint, verify response contains `{ inserted: N, updated: N, skipped: N }`. Verify a known set's Brickset fields (e.g., `lego_rating`) are unchanged after sync.

#### F3: Rebrickable sync populates 2,000+ current sets
- **Tag:** AUTO_VERIFY
- **Criterion:** After running a full Rebrickable sync, the `brickset_sets` table contains at least 2,000 currently available LEGO sets. Each set has: `set_number`, `name`, `year`, `theme`, `subtheme`, `piece_count`, `minifig_count` populated.
- **Evidence:** SQL count query on `brickset_sets` returns >= 2,000 rows. Sample of 10 random rows all have non-null `set_number`, `name`, `year`, `theme`, `piece_count`.
- **Test:** `SELECT COUNT(*) FROM brickset_sets` >= 2000. `SELECT * FROM brickset_sets WHERE set_number IS NULL OR name IS NULL OR year IS NULL LIMIT 1` returns 0 rows.

#### F4: Retirement data aggregated from at least 2 sources
- **Tag:** AUTO_VERIFY
- **Criterion:** Retirement data is collected from at least 2 sources: Brickset API (availability/retirement status) and Brick Tap Google Sheet (expected retirement dates). Each source's data is stored in the `retirement_sources` table with source name, date, and confidence level.
- **Evidence:** `retirement_sources` table contains rows with `source IN ('brickset', 'bricktap')`. Both sources have data for overlapping sets. Each row has `set_num`, `source`, `expected_retirement_date`, `confidence`.
- **Test:** `SELECT DISTINCT source FROM retirement_sources` returns at least 2 values. `SELECT COUNT(*) FROM retirement_sources WHERE source = 'brickset'` > 0 AND `SELECT COUNT(*) FROM retirement_sources WHERE source = 'bricktap'` > 0.

#### F5: Retirement status rollup calculated per set
- **Tag:** AUTO_VERIFY
- **Criterion:** Each set in `brickset_sets` has a `retirement_status` derived from `retirement_sources`: `available`, `retiring_soon`, or `retired`. The `expected_retirement_date` uses the highest-confidence source. Confidence levels are: `confirmed` (LEGO official), `likely` (2+ sources agree), `speculative` (single non-official source).
- **Evidence:** Sets with retirement source data have non-null `retirement_status`. A set with 2 agreeing sources shows `likely` confidence. A set with official LEGO data shows `confirmed`.
- **Test:** `SELECT COUNT(*) FROM brickset_sets WHERE retirement_status IS NOT NULL` > 0. Verify rollup logic by checking a known retiring set has correct status and confidence.

#### F6: Investment dashboard page at /investment
- **Tag:** AUTO_VERIFY
- **Criterion:** A new page exists at `/investment` showing all tracked sets in a filterable DataTable. Columns include: set number, name, theme, RRP (GBP), retirement status, expected retirement date, piece count, minifig count. Filters available for: retirement status, theme, year range, and "retiring within" (3/6/12 months). Sidebar navigation is updated with an "Investment" section containing a link to this page.
- **Evidence:** Navigating to `/investment` renders a DataTable with the specified columns. Filter controls are present and functional. Sidebar shows "Investment" section with active link highlighting.
- **Test:** Page renders without console errors. DataTable has >= 7 columns. Filter dropdowns are present. Sidebar contains "Investment" nav item linking to `/investment`.

### Error Handling

#### E1: Rebrickable API failure is non-destructive
- **Tag:** AUTO_VERIFY
- **Criterion:** If the Rebrickable API is unavailable during sync, the cron job logs the error, sends a Discord alert to the alerts webhook, and exits without modifying or deleting any existing data in `brickset_sets`.
- **Evidence:** Simulating API failure (invalid API key or network error) results in: error logged to console, Discord webhook called, zero rows modified in `brickset_sets`, cron response includes error details.
- **Test:** Call cron endpoint with invalid Rebrickable API key. Verify response indicates failure. Verify `brickset_sets` row count unchanged. Verify Discord alert sent (or mock verified).

#### E2: Individual retirement source failure doesn't block others
- **Tag:** AUTO_VERIFY
- **Criterion:** If one retirement source (e.g., Brick Tap) is unreachable during sync, data from other sources (e.g., Brickset) still processes successfully. The sync response logs which sources succeeded and which failed.
- **Evidence:** When Brick Tap is unavailable, Brickset retirement data still updates. Sync response contains `{ sources: { brickset: 'success', bricktap: 'failed' } }` or equivalent.
- **Test:** Mock Brick Tap as unavailable, run retirement sync. Verify Brickset data processed. Verify response reports partial success.

### Integration

#### I1: Migration preserves all existing brickset_sets data
- **Tag:** AUTO_VERIFY
- **Criterion:** The migration uses `ALTER TABLE` only (no DROP/RECREATE). All existing rows in `brickset_sets` retain their current values for all pre-existing columns. New columns default to NULL.
- **Evidence:** Migration SQL file contains only `ALTER TABLE ... ADD COLUMN` and `CREATE TABLE` statements for new tables. Row count before and after migration is identical. A known existing row's `set_number`, `name`, `year`, `bricklink_new_price` values are unchanged.
- **Test:** Compare pre/post migration row count. Spot-check 3 existing rows for data integrity.

### Performance

#### P1: Full Rebrickable sync completes within Vercel function timeout
- **Tag:** AUTO_VERIFY
- **Criterion:** A full Rebrickable sync processing 2,000+ sets completes within 300 seconds (Vercel's maximum function duration). Uses batch processing with pagination to handle the Supabase 1,000-row limit.
- **Evidence:** Cron job response includes `duration_ms` field. Value is < 300,000ms. Sync processes all available sets (no truncation at 1,000).
- **Test:** Run full sync, verify `duration_ms < 300000` and total processed count >= 2,000.

## Out of Scope

- ML model training and predictions (Phase 3)
- Amazon PA-API price tracking (Phase 5)
- Investment scoring algorithm (Phase 4)
- GWP tracking (Phase 2 in PRD)
- Portfolio manager integration with existing inventory
- ASIN discovery / Amazon listing lookup
- Manual exclusivity tagging UI (can be done via SQL for now)
- Price snapshot collection (table created but not populated)

## Dependencies

- Existing `brickset_sets` table and Brickset API client
- Rebrickable API key (free, needs registration)
- Brick Tap Google Sheet must be publicly accessible
- Existing cron infrastructure and Discord webhook setup

## Iteration Budget

- **Max iterations:** 5
- **Escalation:** If not converged after 5 iterations, pause for human review
