# Done Criteria: lego-investment-phase2

**Created:** 2026-02-07
**Author:** Define Done Agent + Chris
**Status:** APPROVED
**PRD Reference:** `C:\Users\Chris Hadley\Documents\LEGO_INVESTMENT_PREDICTOR_PRD.md`
**Phase 1 Reference:** `docs/features/lego-investment-model/done-criteria.md`

## Feature Summary

Phase 2 of the LEGO Investment Predictor connects the Phase 1 data foundation to the existing Amazon pricing infrastructure. The investment dashboard is enriched with buy box prices, sales rank, and offer counts by linking `seeded_asins` ASINs to `brickset_sets`. Sets are auto-classified (licensed, UCS, modular, exclusivity tier) from theme/subtheme data with manual override support. A new set detail page at `/investment/[setNumber]` shows comprehensive investment data including a price history chart from `amazon_arbitrage_pricing` snapshots. Price movement alerts notify via Discord when buy box prices shift >20%.

**Key architectural decisions:**
- Reuse existing `seeded_asins` table for ASIN linkage (no new discovery process)
- Reuse existing `amazon_arbitrage_pricing` for price history (no new price collection)
- Auto-classify from theme/subtheme/name with configurable rules and JSONB override column
- Join Amazon pricing data into investment API via lateral join on latest snapshot
- Price history chart using Recharts (or similar) on set detail page

## Success Criteria

### Functional

#### F1: ASIN linkage from seeded_asins to brickset_sets
- **Tag:** AUTO_VERIFY
- **Criterion:** A service/cron populates `brickset_sets.amazon_asin` and `has_amazon_listing` from the existing `seeded_asins` table where `discovery_status = 'found'`. Only matched ASINs (confidence >= 60%) are linked. The linkage runs as part of the Rebrickable sync cron or a separate lightweight cron.
- **Evidence:** After running the linkage, `SELECT COUNT(*) FROM brickset_sets WHERE amazon_asin IS NOT NULL` > 0. The count approximates the matched ASINs in `seeded_asins`.
- **Test:** Run linkage, verify count matches. Spot-check 3 ASINs match between tables.

#### F2: Auto-classification of investment attributes
- **Tag:** AUTO_VERIFY
- **Criterion:** A classification service auto-populates `is_licensed`, `is_ucs`, `is_modular`, and `exclusivity_tier` on `brickset_sets` using theme/subtheme/name data. Licensed themes detected from a configurable list (Star Wars, Marvel, Harry Potter, Disney, etc.). UCS detected from subtheme containing "Ultimate Collector". Modular detected from subtheme containing "Modular". Exclusivity derived from Brickset `availability` field. A manual override column (`classification_override JSONB`) allows overriding any auto-classified value.
- **Evidence:** `SELECT COUNT(*) FROM brickset_sets WHERE is_licensed IS NOT NULL` covers all sets. Known UCS sets (e.g., 75192) have `is_ucs = true`. Known licensed sets have `is_licensed = true`.
- **Test:** Run classification, verify counts. Check 75192 (UCS Millennium Falcon) is `is_ucs = true, is_licensed = true`. Check 10312 (Jazz Club) is `is_modular = true`.

#### F3: Investment API returns Amazon pricing data
- **Tag:** AUTO_VERIFY
- **Criterion:** The `/api/investment` endpoint (and a new `/api/investment/[setNumber]` endpoint) returns Amazon pricing data for sets that have a linked ASIN. Data includes: `buy_box_price`, `was_price`, `sales_rank`, `offer_count`, `latest_snapshot_date`. The data is joined from `amazon_arbitrage_pricing` (latest snapshot per ASIN).
- **Evidence:** GET `/api/investment?search=75192` returns a result with `buy_box_price` populated. GET `/api/investment/75192-1` returns full pricing data.
- **Test:** Call API with a known ASIN-linked set, verify pricing fields present and non-null.

#### F4: Set detail page at /investment/[setNumber]
- **Tag:** AUTO_VERIFY
- **Criterion:** A new page at `/investment/[setNumber]` displays comprehensive investment data for a single set: set image, name, theme, year, RRP, retirement status/date/confidence, classification badges (licensed, UCS, modular, exclusivity tier), Amazon pricing summary (buy box, was price, sales rank, offer count), and a price history chart. The dashboard table rows link to this detail page.
- **Evidence:** Navigating to `/investment/75192-1` renders the detail page with all sections. Clicking a row in the investment table navigates to the detail page.
- **Test:** Page renders without console errors. All data sections present. Back navigation works.

#### F5: Price history chart on set detail page
- **Tag:** AUTO_VERIFY
- **Criterion:** The set detail page includes a line chart showing buy box price over time from `amazon_arbitrage_pricing` snapshots. X-axis is date, Y-axis is price (GBP). Shows RRP as a horizontal reference line. Uses an existing chart library (Recharts or similar). Handles sets with no price history gracefully (shows "No price data yet" message).
- **Evidence:** Chart renders with data points when price history exists. Chart shows empty state when no data. RRP reference line visible.
- **Test:** Navigate to a set with price history, verify chart has data points. Navigate to a set without, verify empty state message.

#### F6: Price movement Discord alerts
- **Tag:** AUTO_VERIFY
- **Criterion:** After the daily Amazon pricing cron completes, a post-processing step compares today's buy box price against the previous snapshot for each investment-tracked set. Price changes exceeding 20% trigger a Discord alert to the `DISCORD_WEBHOOK_ALERTS` channel. Alert includes: set number, set name, old price, new price, percentage change, and a link to the set detail page.
- **Evidence:** When a set's buy box price changes >20% between snapshots, a Discord message is sent. The message contains the required fields.
- **Test:** Insert two snapshots with >20% price difference for a test ASIN, run the alert check, verify Discord webhook called with correct payload.

### Error Handling

#### E1: Missing ASIN gracefully handled in UI
- **Tag:** AUTO_VERIFY
- **Criterion:** Sets without a linked ASIN show "No Amazon data" in the pricing section of the detail page and "—" in the buy box price column of the table. No errors thrown. The set is still fully viewable with all non-Amazon data.
- **Evidence:** Navigating to a set with no ASIN renders correctly with fallback text. Table renders "—" for buy box price.
- **Test:** Navigate to a set without ASIN, verify no console errors, verify fallback text present.

#### E2: Classification override persists through re-sync
- **Tag:** AUTO_VERIFY
- **Criterion:** If a manual override is set via `classification_override` JSONB column, the auto-classification service preserves the override and does not overwrite it on subsequent runs. Override values take precedence over auto-detected values in API responses.
- **Evidence:** Set an override for a test set, run classification again, verify override persists. API returns override value, not auto-detected value.
- **Test:** Set `classification_override = '{"is_ucs": true}'` on a non-UCS set, run classification, verify `is_ucs` still returns `true` from API.

### Integration

#### I1: Investment dashboard columns updated with Amazon data
- **Tag:** AUTO_VERIFY
- **Criterion:** The `/investment` DataTable adds columns for: buy box price (GBP, sortable), sales rank, and offer count. Buy box price is sortable. The existing filters continue to work. Column visibility settings persist.
- **Evidence:** Investment table shows new columns. Sorting by buy box price works. Filters still function.
- **Test:** Load `/investment`, verify new columns present. Sort by buy box price, verify order. Apply filter, verify results narrow.

### Performance

#### P1: Set detail page loads within 2 seconds
- **Tag:** AUTO_VERIFY
- **Criterion:** The `/investment/[setNumber]` page loads all data (set info, pricing, price history) within 2 seconds. Price history query uses the `amazon_arbitrage_pricing` index on `(asin, snapshot_date)`.
- **Evidence:** Page load time < 2000ms. No N+1 queries.
- **Test:** Measure page load for a set with 30+ price snapshots, verify < 2s.

## Out of Scope

- ML model training and predictions (Phase 3)
- Investment scoring algorithm (1-10 score)
- GWP tracker
- Portfolio manager / ROI tracking
- Theme analytics dashboard
- Manual classification admin UI (overrides via SQL for now)
- Intraday price monitoring (daily snapshots sufficient)
- Additional retirement sources beyond Brickset + Brick Tap
- New Amazon ASIN discovery process (uses existing seeded_asins)
- New Amazon price collection (uses existing amazon_arbitrage_pricing cron)

## Dependencies

- Phase 1 complete and merged (brickset_sets with investment columns, Rebrickable sync, retirement sync)
- Existing `seeded_asins` table with discovered ASINs (~1,500 matched)
- Existing `amazon_arbitrage_pricing` table with daily snapshots
- Existing Amazon pricing cron job at `/api/cron/amazon-pricing`
- Existing `AmazonPricingClient` in `apps/web/src/lib/amazon/`

## Iteration Budget

- **Max iterations:** 5
- **Escalation:** If not converged after 5 iterations, pause for human review
