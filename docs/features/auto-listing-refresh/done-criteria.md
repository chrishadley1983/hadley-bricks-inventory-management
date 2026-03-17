# Done Criteria: auto-listing-refresh

**Created:** 2026-03-17
**Author:** Define Done Agent + Chris
**Status:** APPROVED

---

## Feature Summary

Automated weekly refresh of stale eBay listings (90+ days old) with an engagement-based price reduction engine. Ends old listings and recreates them as new ("Sell Similar") to get Cassini's new listing visibility boost. Prices are adjusted based on engagement signals (views/day, watchers, pending offers) with a floor to prevent losses. Runs Sunday 7 PM UK time via GCP Cloud Scheduler and sends an HTML email report.

**Problem:** Stale eBay listings lose Cassini visibility after 90 days; manual refresh is tedious and pricing is guesswork
**User:** Chris (business owner) — automated, no manual interaction
**Trigger:** GCP Cloud Scheduler POST to `/api/cron/ebay-listing-refresh` every Sunday 19:00 Europe/London
**Outcome:** Stale listings ended and recreated with smart pricing; email report sent; inventory_items updated

---

## Success Criteria

### Functional

#### F1: Eligible Listing Discovery
- **Tag:** AUTO_VERIFY
- **Criterion:** The cron queries `inventory_items` for rows where `status = 'LISTED'`, `ebay_listing_id IS NOT NULL`, and `listing_date <= NOW() - 90 days` (at the point the job runs), with correct pagination for >1000 rows
- **Evidence:** SQL query in the route uses the correct filters and paginated fetching
- **Test:** Code review of query; run with `?report=true` and verify returned items all have `listing_date` >= 90 days ago

#### F2: Engagement Enrichment
- **Tag:** AUTO_VERIFY
- **Criterion:** Each eligible listing is enriched with (a) view count from eBay Sell Analytics API (89-day range) and (b) pending offer count from the `negotiation_offers` table
- **Evidence:** The enrichment calls exist in the cron route before pricing calculation; views and pendingOffers are populated on each item
- **Test:** Code review confirms both enrichment calls; `?report=true` response includes views and pendingOffers per item

#### F3: Skip Items With Pending Offers
- **Tag:** AUTO_VERIFY
- **Criterion:** Items with `pendingOffers > 0` are excluded from the refresh batch entirely (not ended, not recreated, not repriced)
- **Evidence:** Filter applied after enrichment removes these items; they do not appear in the job items
- **Test:** Code review confirms filter; verify an item with a pending offer is absent from a test run's results

#### F4: Engagement Tier Classification
- **Tag:** AUTO_VERIFY
- **Criterion:** Each item is classified into exactly one tier using these rules (evaluated in order): HOT if `watchers >= 5`; WARM if `viewsPerDay >= 1.0 AND watchers >= 2`; COOL if `viewsPerDay < 1.0 OR watchers <= 1`; COLD if `viewsPerDay < 0.5 AND watchers == 0`. Where `viewsPerDay = views / ageDays`
- **Evidence:** Unit tests for the tier function cover all boundary cases
- **Test:** `npm test -- --grep "engagement tier"` passes with cases for each tier boundary

#### F5: Price Reduction Calculation
- **Tag:** AUTO_VERIFY
- **Criterion:** New price = `currentPrice * (1 - reductionPct)` where reductionPct is: HOT=0%, WARM=5%, COOL=10%, COLD=15%. Used condition items add +5% to the reduction (e.g. COLD+Used = 20%). Result is passed through `roundUpToNearest99` (= `Math.floor(price) + 0.99`). If result < floor price (`cost / (1 - 0.1323)`), use floor rounded up to .99. If result >= currentPrice, keep currentPrice unchanged
- **Evidence:** Unit tests for price calculation cover all tiers, used/new condition, floor clamping, and never-increase guard
- **Test:** `npm test -- --grep "refresh pricing"` passes

#### F6: Round Up To Nearest .99
- **Tag:** AUTO_VERIFY
- **Criterion:** The `roundUpToNearest99` function returns `Math.floor(price) + 0.99` for any positive input. Examples: 14.20 → 14.99, 15.10 → 15.99, 15.99 → 15.99, 16.00 → 16.99, 0.50 → 0.99
- **Evidence:** Unit tests cover these exact examples plus edge cases (0, negative, very small)
- **Test:** `npm test -- --grep "roundUpToNearest99"` passes

#### F7: Listing Refresh Execution (End + Create)
- **Tag:** AUTO_VERIFY
- **Criterion:** For each eligible item: (a) GetItem fetches full listing details, (b) EndFixedPriceItem ends the old listing, (c) AddFixedPriceItem creates a new listing with the calculated price, same SKU, same images/description/item specifics/business policies, GTC duration
- **Evidence:** The cron reuses `EbayListingRefreshService.executeRefresh()` or equivalent Trading API calls; new listing has a different `itemId` from the original
- **Test:** After a run, `job_execution_history` shows completed status; `ebay_listing_refresh_items` records show `status = 'created'` with `new_item_id` populated

#### F8: Inventory Items Updated
- **Tag:** AUTO_VERIFY
- **Criterion:** After successful refresh, each item's `inventory_items` row is updated: `ebay_listing_id` = new listing ID, `listing_date` = today, `listing_value` = new price
- **Evidence:** SQL UPDATE in the cron route or service after successful creation
- **Test:** Query `inventory_items` after a run; listing_date should be today and ebay_listing_id should match the new item ID

#### F9: Email Report Sent
- **Tag:** AUTO_VERIFY
- **Criterion:** After execution, an HTML email is sent via Resend containing: (a) summary header with count of refreshed listings, count of price reductions, total £ value change, (b) table with columns: set number, item name, old price, new price, reduction %, tier, views, watchers, age days, new eBay listing link, (c) rows colour-coded green if price unchanged, amber if reduced
- **Evidence:** `sendListingRefreshReport` method exists on EmailService and is called at end of cron
- **Test:** Code review confirms HTML generation and send call; Resend API logs show email delivered after a run

#### F10: Job Execution Logging
- **Tag:** AUTO_VERIFY
- **Criterion:** The cron logs to `job_execution_history` with `job_name = 'ebay-listing-refresh'`, recording start/complete timestamps, items processed count, and result summary (refreshed, skipped, failed counts)
- **Evidence:** `jobExecutionService.start()` and `execution.complete()` calls in the route
- **Test:** Query `job_execution_history WHERE job_name = 'ebay-listing-refresh'` after a run returns a completed row

---

### Error Handling

#### E1: eBay API Failure Per Item
- **Tag:** AUTO_VERIFY
- **Criterion:** If GetItem, EndItem, or AddItem fails for a single item, that item is marked as failed with error details but processing continues for remaining items. The email report includes failed items with error messages
- **Evidence:** Try/catch per item in execution loop; failed items tracked in results
- **Test:** Code review confirms per-item error handling; a simulated failure doesn't abort the batch

#### E2: No Eligible Listings
- **Tag:** AUTO_VERIFY
- **Criterion:** If no listings are >= 90 days old (or all have pending offers), the cron returns `{ success: true, message: "No eligible listings", refreshed: 0 }` and does NOT send an email
- **Evidence:** Early return in route when eligible list is empty
- **Test:** Code review confirms early return path; no email sent when nothing to do

#### E3: Authentication Failure
- **Tag:** AUTO_VERIFY
- **Criterion:** If eBay OAuth token refresh fails, the cron fails with an error logged to `job_execution_history` and no listings are modified
- **Evidence:** Auth error caught before any End/Create calls; execution marked as failed
- **Test:** Code review confirms auth is obtained before mutation phase

#### E4: Cron Auth Guard
- **Tag:** AUTO_VERIFY
- **Criterion:** The route rejects requests without a valid `Authorization: Bearer <CRON_SECRET>` header, returning 401
- **Evidence:** Auth check at top of POST handler
- **Test:** `curl -X POST .../api/cron/ebay-listing-refresh` without auth header returns 401

---

### Performance

#### P1: Execution Within Timeout
- **Tag:** AUTO_VERIFY
- **Criterion:** The cron completes within 300 seconds (`maxDuration = 300`) for up to 100 eligible listings, with 150ms delay between eBay API calls
- **Evidence:** `export const maxDuration = 300` in route; rate limiting between calls
- **Test:** Code review confirms maxDuration export and delay between API calls

---

### Integration

#### I1: GCP Cloud Scheduler Configured
- **Tag:** TOOL_VERIFY
- **Criterion:** A GCP Cloud Scheduler job named `ebay-listing-refresh` exists targeting `https://hadley-bricks-inventory-management.vercel.app/api/cron/ebay-listing-refresh` with schedule `0 19 * * 0` in timezone `Europe/London`
- **Evidence:** `gcloud scheduler jobs describe ebay-listing-refresh --location=europe-west2` shows correct URI, schedule, and timezone
- **Test:** Run the gcloud describe command after setup

#### I2: GCP README Documented
- **Tag:** AUTO_VERIFY
- **Criterion:** `gcp/README.md` contains the `gcloud scheduler jobs create` command for the `ebay-listing-refresh` job with correct URL, schedule, and timezone
- **Evidence:** Grep gcp/README.md for `ebay-listing-refresh`
- **Test:** `grep "ebay-listing-refresh" gcp/README.md` returns the scheduler command

---

## Out of Scope

- UI/dashboard for configuring the refresh (manual refresh UI already exists)
- Configurable engagement thresholds (hardcoded for MVP; can be moved to DB later)
- Refreshing listings on platforms other than eBay
- Category-specific pricing adjustments beyond Used condition modifier
- Moving listings between eBay campaigns after refresh (handled by existing promotions cron)
- Auction conversion for extremely stale items (existing markdown engine handles this separately)

---

## Dependencies

- Existing `EbayListingRefreshService` (end + create flow)
- eBay Trading API credentials (OAuth token refresh)
- eBay Sell Analytics API access (for view counts)
- `negotiation_offers` table (for pending offer counts)
- Resend email service configured
- `job_execution_history` table exists
- `ebay_listing_refresh_items` / `ebay_listing_refreshes` tables exist

---

## Iteration Budget

- **Max iterations:** 5
- **Escalation:** If not converged after 5 iterations, pause for human review

---

## Verification Summary

| ID | Criterion | Tag | Status |
|----|-----------|-----|--------|
| F1 | Eligible listing discovery (90+ days, paginated) | AUTO_VERIFY | PENDING |
| F2 | Engagement enrichment (views + pending offers) | AUTO_VERIFY | PENDING |
| F3 | Skip items with pending offers | AUTO_VERIFY | PENDING |
| F4 | Engagement tier classification (HOT/WARM/COOL/COLD) | AUTO_VERIFY | PENDING |
| F5 | Price reduction by tier with floor and Used modifier | AUTO_VERIFY | PENDING |
| F6 | roundUpToNearest99 function | AUTO_VERIFY | PENDING |
| F7 | Listing refresh execution (End + Create) | AUTO_VERIFY | PENDING |
| F8 | inventory_items updated with new listing data | AUTO_VERIFY | PENDING |
| F9 | Email report sent with summary and detail table | AUTO_VERIFY | PENDING |
| F10 | Job execution logged to history table | AUTO_VERIFY | PENDING |
| E1 | Per-item API failure doesn't abort batch | AUTO_VERIFY | PENDING |
| E2 | No eligible listings returns early, no email | AUTO_VERIFY | PENDING |
| E3 | Auth failure prevents mutations | AUTO_VERIFY | PENDING |
| E4 | Cron auth guard rejects unauthenticated requests | AUTO_VERIFY | PENDING |
| P1 | Completes within 300s for 100 listings | AUTO_VERIFY | PENDING |
| I1 | GCP scheduler job configured correctly | TOOL_VERIFY | PENDING |
| I2 | GCP README documents the scheduler command | AUTO_VERIFY | PENDING |

**Total:** 17 criteria (15 AUTO_VERIFY, 1 TOOL_VERIFY, 0 HUMAN_VERIFY)

---

## Handoff

Ready for: `/build-feature auto-listing-refresh`

**Key files likely affected:**
- `apps/web/src/lib/ebay/refresh-pricing.ts` (new)
- `apps/web/src/app/api/cron/ebay-listing-refresh/route.ts` (new)
- `apps/web/src/lib/email/email.service.ts` (modify — add sendListingRefreshReport)
- `gcp/README.md` (modify — add scheduler command)
- `apps/web/src/lib/ebay/ebay-listing-refresh.service.ts` (may need minor modifications for cron usage)
