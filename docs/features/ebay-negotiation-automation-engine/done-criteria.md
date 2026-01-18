# Done Criteria: ebay-negotiation-automation-engine

**Created:** 2026-01-17
**Author:** Define Done Agent + Chris
**Status:** APPROVED

## Feature Summary

An automated negotiation and pricing engine that uses the eBay Negotiation API to proactively send targeted discount offers to high-intent buyers (watchers and cart abandoners). The system calculates a score based on configurable criteria (primarily listing age) to determine discount percentages, tracks offer performance over time, and runs on a configurable schedule with manual override capability.

## Success Criteria

### Functional - API Integration

#### F1: eBay Negotiation API Client Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** A `NegotiationApiClient` class exists with methods for `findEligibleItems` and `sendOfferToInterestedBuyers`
- **Evidence:** File exists at expected path with exported class containing both methods
- **Test:** `grep -l "findEligibleItems\|sendOfferToInterestedBuyers" apps/web/src/lib/ebay/*.ts`

#### F2: findEligibleItems Returns Eligible Listings
- **Tag:** AUTO_VERIFY
- **Criterion:** Calling `findEligibleItems()` returns an array of listing IDs that have interested buyers, with pagination support
- **Evidence:** API call returns `{ eligibleItems: [{ listingId: string }], total: number }` shape
- **Test:** Integration test with mocked eBay response validates response shape and pagination

#### F3: sendOfferToInterestedBuyers Sends Offers
- **Tag:** AUTO_VERIFY
- **Criterion:** Calling `sendOfferToInterestedBuyers(listingId, discountPercentage, message)` sends offer and returns offer details
- **Evidence:** API call returns `{ offers: [{ offerId, offerStatus, buyer, discountPercentage }] }` shape
- **Test:** Integration test with mocked eBay response validates offer creation

### Functional - Scoring Engine

#### F4: Score Calculation Service Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** A `NegotiationScoringService` calculates a numeric score (0-100) for each eligible listing based on weighted criteria
- **Evidence:** Service exports `calculateScore(listing)` returning `{ score: number, factors: Record<string, number> }`
- **Test:** Unit test with known inputs produces expected score output

#### F5: Listing Age is Primary Factor (50%+ weight)
- **Tag:** AUTO_VERIFY
- **Criterion:** Original listing date contributes at least 50% of the total score weight
- **Evidence:** Score breakdown shows listing_age_contribution >= 0.5 * total_score
- **Test:** Unit test verifies listing age factor >= 50% of weighted score

#### F6: Score Includes All Required Factors
- **Tag:** AUTO_VERIFY
- **Criterion:** Score calculation includes: original listing age, stock level, item cost/value, category/theme, number of watchers
- **Evidence:** `factors` object in score result contains keys for all five criteria
- **Test:** Unit test verifies all factor keys present in score breakdown

#### F7: Original Listing Date Used (Not Current)
- **Tag:** AUTO_VERIFY
- **Criterion:** Listing age calculation uses the original `listing_date` from inventory_items, not current eBay listing start date
- **Evidence:** Service queries `listing_date` field from database, not eBay API listing start
- **Test:** Unit test with refreshed listing (current date differs from listing_date) uses listing_date

### Functional - Discount Rules

#### F8: Configurable Discount Grid Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Database table `negotiation_discount_rules` stores score ranges mapped to discount percentages
- **Evidence:** Table exists with columns: `id`, `min_score`, `max_score`, `discount_percentage`, `user_id`
- **Test:** Migration file creates table with required columns

#### F9: Score Maps to Discount Percentage
- **Tag:** AUTO_VERIFY
- **Criterion:** Given a score, the system returns the correct discount percentage from the configured grid
- **Evidence:** `getDiscountForScore(score)` returns percentage matching the rule where `min_score <= score <= max_score`
- **Test:** Unit test with configured rules verifies correct discount returned for various scores

#### F10: Minimum Discount is 10%
- **Tag:** AUTO_VERIFY
- **Criterion:** The system never sends an offer with less than 10% discount
- **Evidence:** All sent offers have `discountPercentage >= 10`
- **Test:** Attempt to configure <10% discount is rejected; sent offers validated >= 10%

#### F11: Eligibility Threshold is Configurable
- **Tag:** AUTO_VERIFY
- **Criterion:** A configurable setting `min_days_before_offer` determines when listings become eligible for offers (based on original listing date)
- **Evidence:** Setting stored in `negotiation_config` table; listings younger than threshold are skipped
- **Test:** Unit test verifies listings under threshold are excluded from offer candidates

### Functional - Offer Execution

#### F12: Manual Send Offers Button Works
- **Tag:** AUTO_VERIFY
- **Criterion:** Clicking "Send Offers Now" button on the Listing Optimiser page triggers offer processing for all eligible listings
- **Evidence:** Button click fires API call to `/api/negotiation/send-offers`; offers are created
- **Test:** E2E test clicks button, verifies API call made and offers recorded in database

#### F13: Automated Schedule Runs at Configured Times
- **Tag:** AUTO_VERIFY
- **Criterion:** Vercel cron job (or equivalent) triggers offer processing every 4 hours between 8am-8pm UK time (8:00, 12:00, 16:00, 20:00)
- **Evidence:** Cron configuration exists; logs show execution at scheduled times
- **Test:** Cron config file specifies correct schedule; API endpoint returns 200 when called

#### F14: Automation Toggle Enables/Disables Schedule
- **Tag:** AUTO_VERIFY
- **Criterion:** A toggle in settings enables/disables automatic offer sending without affecting manual sends
- **Evidence:** Setting `automation_enabled` in `negotiation_config` table; cron checks this before processing
- **Test:** With toggle off, cron endpoint returns early without sending; manual button still works

#### F15: Offers Recorded in Audit Log
- **Tag:** AUTO_VERIFY
- **Criterion:** Every offer sent is recorded in `negotiation_offers` table with: listing_id, ebay_offer_id, buyer_masked_username, discount_percentage, score, sent_at, status
- **Evidence:** Database record created for each offer sent
- **Test:** After sending offer, query database confirms record exists with all required fields

#### F16: Pushover Notification Sent on Automated Run
- **Tag:** AUTO_VERIFY
- **Criterion:** After automated offer run completes, Pushover notification sent with summary (e.g., "12 offers sent to interested buyers")
- **Evidence:** Pushover API called with message containing offer count
- **Test:** Mock Pushover API; verify called with expected message format after automated run

### Functional - Re-offer Logic

#### F17: Expired Offers Trigger Re-send with Escalation
- **Tag:** AUTO_VERIFY
- **Criterion:** When an offer expires (4 days on EBAY_GB), the system can re-send to the same buyer with a higher discount after configurable cooldown
- **Evidence:** `negotiation_offers` tracks `expired_at`; re-offer logic checks cooldown and increases discount
- **Test:** Unit test with expired offer past cooldown generates new offer with higher discount %

#### F18: Cooldown Period is Configurable
- **Tag:** AUTO_VERIFY
- **Criterion:** Setting `re_offer_cooldown_days` determines minimum days before re-sending to same buyer/listing
- **Evidence:** Config value queried before re-offer; offers within cooldown skipped
- **Test:** Unit test verifies offers within cooldown period are not re-sent

#### F19: Escalation Increment is Configurable
- **Tag:** AUTO_VERIFY
- **Criterion:** Setting `re_offer_escalation_percent` determines how much to increase discount on re-offer (e.g., +5%)
- **Evidence:** Re-offer discount = previous discount + escalation_percent
- **Test:** Unit test verifies re-offer discount is previous + configured increment

### Functional - Metrics & Tracking

#### F20: Offers Sent Count Tracked
- **Tag:** AUTO_VERIFY
- **Criterion:** Dashboard displays total offers sent, with ability to filter by date range and listing
- **Evidence:** API endpoint returns `{ totalOffers, offersByDate: [...], offersByListing: [...] }`
- **Test:** Integration test verifies metrics endpoint returns correct counts matching database

#### F21: Acceptance Rate Calculated
- **Tag:** AUTO_VERIFY
- **Criterion:** Dashboard displays acceptance rate as percentage (accepted offers / total offers * 100)
- **Evidence:** API returns `{ acceptanceRate: number }` calculated from offer statuses
- **Test:** With known accepted/total counts, verify calculated rate is correct

#### F22: Offer Status Synced from eBay
- **Tag:** AUTO_VERIFY
- **Criterion:** Offer status (PENDING, ACCEPTED, DECLINED, EXPIRED) is updated by polling eBay or receiving notification
- **Evidence:** `negotiation_offers.status` field updated; `status_updated_at` timestamp refreshed
- **Test:** After status change on eBay (mocked), database record reflects new status

#### F23: Average Discount Metrics Calculated
- **Tag:** AUTO_VERIFY
- **Criterion:** Dashboard displays: (a) average discount % sent, (b) average discount % that converted to sale
- **Evidence:** API returns `{ avgDiscountSent: number, avgDiscountConverted: number }`
- **Test:** With known offer data, verify both averages calculated correctly

### UI/UX

#### U1: Offers Tab in Listing Optimiser
- **Tag:** AUTO_VERIFY
- **Criterion:** A new "Offers" or "Negotiation" tab exists on the Listing Optimiser page
- **Evidence:** DOM query finds tab element with appropriate label
- **Test:** `document.querySelector('[data-testid="negotiation-tab"]') !== null`

#### U2: Send Offers Now Button Visible
- **Tag:** AUTO_VERIFY
- **Criterion:** "Send Offers Now" button is visible on the Offers tab
- **Evidence:** Button element with text "Send Offers Now" present in DOM
- **Test:** E2E test navigates to tab, finds button

#### U3: Metrics Dashboard Displays Key Stats
- **Tag:** AUTO_VERIFY
- **Criterion:** Dashboard shows: offers sent count, acceptance rate %, average discount sent, average discount converted
- **Evidence:** Four stat cards/widgets visible with data-testid attributes
- **Test:** E2E test verifies all four metric elements present and contain numeric values

#### U4: Recent Offers List Displayed
- **Tag:** AUTO_VERIFY
- **Criterion:** Table/list shows recent offers with columns: listing, buyer, discount %, status, sent date
- **Evidence:** Table with offer data rendered; at least 5 columns visible
- **Test:** E2E test verifies table structure and column headers

#### U5: Configuration Accessible via Settings
- **Tag:** AUTO_VERIFY
- **Criterion:** Settings button/link opens configuration panel (modal or subpage) for rule configuration
- **Evidence:** Clicking settings control opens panel with configurable fields
- **Test:** E2E test clicks settings, verifies config panel visible

#### U6: Automation Toggle in Config
- **Tag:** AUTO_VERIFY
- **Criterion:** Toggle switch for enabling/disabling automated offers visible in settings
- **Evidence:** Toggle element with data-testid="automation-toggle" present and functional
- **Test:** E2E test toggles switch, verifies state change persisted

#### U7: Discount Grid Configurable in UI
- **Tag:** AUTO_VERIFY
- **Criterion:** UI allows adding/editing/removing discount rules (score range → discount %)
- **Evidence:** Grid/table editor allows CRUD operations on rules
- **Test:** E2E test adds new rule, verifies it appears in list and persists to database

#### U8: Loading States During Offer Send
- **Tag:** AUTO_VERIFY
- **Criterion:** While offers are being sent, loading indicator shown and button disabled
- **Evidence:** Button shows loading spinner; button disabled attribute true during operation
- **Test:** E2E test initiates send, verifies loading state appears

### Error Handling

#### E1: No Eligible Listings Message
- **Tag:** AUTO_VERIFY
- **Criterion:** If no listings are eligible for offers, UI displays "No eligible listings found" message
- **Evidence:** Empty state component rendered when eligibleItems array is empty
- **Test:** With no eligible listings, verify empty state message displayed

#### E2: eBay API Error Handled Gracefully
- **Tag:** AUTO_VERIFY
- **Criterion:** If eBay API returns error, user sees toast with error message; operation does not crash
- **Evidence:** Toast component shows error; no unhandled exceptions
- **Test:** Mock API error response; verify toast appears and page remains functional

#### E3: Partial Failure Handling
- **Tag:** AUTO_VERIFY
- **Criterion:** If some offers succeed and some fail, successful ones are recorded and failures logged
- **Evidence:** Database contains successful offers; error log contains failure details
- **Test:** Mock mixed success/failure response; verify partial results saved

#### E4: Rate Limit Handling
- **Tag:** AUTO_VERIFY
- **Criterion:** If eBay rate limit hit, system backs off and retries; user notified if manual send affected
- **Evidence:** Retry logic in API client; toast shown if manual operation rate-limited
- **Test:** Mock 429 response; verify retry attempted and notification shown

#### E5: Invalid Configuration Rejected
- **Tag:** AUTO_VERIFY
- **Criterion:** Saving invalid config (e.g., discount < 10%, overlapping score ranges) shows validation error
- **Evidence:** Form validation prevents save; error message displayed
- **Test:** Attempt to save 5% discount; verify rejection with error message

### Performance

#### P1: Eligible Items Fetch Under 5 Seconds
- **Tag:** AUTO_VERIFY
- **Criterion:** `findEligibleItems` API call completes in under 5 seconds for typical inventory size
- **Evidence:** Response time < 5000ms
- **Test:** Timed integration test with realistic data volume

#### P2: Batch Offer Send Handles 50+ Listings
- **Tag:** AUTO_VERIFY
- **Criterion:** System can process and send offers for 50+ eligible listings in single batch without timeout
- **Evidence:** Batch operation completes successfully for 50 items
- **Test:** Load test with 50 eligible listings; verify all processed

#### P3: Metrics Dashboard Loads Under 3 Seconds
- **Tag:** AUTO_VERIFY
- **Criterion:** Metrics/dashboard API endpoint responds in under 3 seconds
- **Evidence:** Response time < 3000ms
- **Test:** Timed request to metrics endpoint

### Integration

#### I1: Uses Existing eBay OAuth Credentials
- **Tag:** AUTO_VERIFY
- **Criterion:** Negotiation API uses same OAuth token flow as existing eBay integrations
- **Evidence:** Token retrieved from same credential store; no separate auth required
- **Test:** Verify NegotiationApiClient uses shared token provider

#### I2: Links to Inventory Items
- **Tag:** AUTO_VERIFY
- **Criterion:** Offers are linked to inventory_items via `ebay_listing_id` for score calculation and tracking
- **Evidence:** `negotiation_offers` table has FK to inventory_items or joins via listing_id
- **Test:** Query offer with inventory item data; verify join successful

#### I3: Pushover Integration Reused
- **Tag:** AUTO_VERIFY
- **Criterion:** Notifications use existing Pushover notification service from Amazon sync feature
- **Evidence:** Same `PushoverService` class used; no duplicate implementation
- **Test:** Verify import path matches existing service location

## Out of Scope

- Counter-offer handling (if buyer counters, manual intervention required)
- Seasonal adjustments to scoring algorithm
- AI-powered rule suggestions (future enhancement once data accumulates)
- Amazon offer automation (eBay only for V1)
- Multi-variation listing support (eBay API limitation)
- Real-time webhooks for offer status (polling-based for V1)

## Dependencies

- eBay OAuth integration functional (existing)
- Inventory items with `ebay_listing_id` and `listing_date` populated
- Pushover notification service (existing from Amazon sync)
- Vercel cron or equivalent for scheduled execution

## Iteration Budget

- **Max iterations:** 5
- **Escalation:** If not converged after 5 iterations, pause for human review

## Database Tables Required

| Table | Purpose |
|-------|---------|
| `negotiation_config` | User settings (automation toggle, thresholds, weights) |
| `negotiation_discount_rules` | Score-to-discount mapping grid |
| `negotiation_offers` | Audit log of all offers sent |

## API Endpoints Required

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/negotiation/eligible` | GET | Fetch eligible listings with scores |
| `/api/negotiation/send-offers` | POST | Trigger manual offer send |
| `/api/negotiation/offers` | GET | List sent offers with filters |
| `/api/negotiation/metrics` | GET | Dashboard metrics |
| `/api/negotiation/config` | GET/PUT | Read/update configuration |
| `/api/negotiation/rules` | GET/POST/PUT/DELETE | CRUD discount rules |
| `/api/cron/negotiation` | POST | Cron endpoint for scheduled runs |
