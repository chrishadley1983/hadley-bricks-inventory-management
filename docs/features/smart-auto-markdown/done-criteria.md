# Done Criteria: Smart Auto-Markdown

**Created:** 2026-03-12
**Author:** Define Done Agent + Chris
**Status:** DRAFT

---

## Feature Summary

Automated markdown engine for aged inventory that diagnoses WHY items aren't selling (overpriced vs low demand), applies platform-specific markdown strategies for Amazon and eBay, supports both review and auto modes, and provides an auction exit ramp for items where price cuts won't help — targeting at least 1 eBay auction ending per day.

**Problem:** Capital sits tied up in slow-moving inventory with no systematic strategy to reduce price, change platform, or exit via auction. Manual repricing is reactive and inconsistent.
**User:** Chris (inventory manager)
**Trigger:** Daily cron evaluates all LISTED items against aging thresholds; also accessible via dashboard for manual review
**Outcome:** Aged items are diagnosed, repriced (or auctioned) via the right strategy per platform, freeing working capital while preserving margin where possible

---

## Design Decisions

### Diagnosis Model: Overpriced vs Low Demand

Every aged item gets a **diagnosis** before any action is taken:

| Diagnosis | Signal | Action |
|-----------|--------|--------|
| **OVERPRICED** | Your price is >10% above Keepa 90-day avg (Amazon) or eBay avg sold price. Competitors actively selling at lower prices. | Markdown — reduce price in steps toward market |
| **LOW_DEMAND** | Price is already competitive (within 10% of market) but sales rank is poor (>100k) or no recent sold comps. Set may be niche/unpopular. | Auction exit — fixed-price markdowns won't help, auction finds the true market price |
| **HOLDING** | Item is within aging threshold OR has been manually held (exempt flag). Investment-grade sets appreciating. | No action — skip this cycle |

### Platform-Specific Markdown Paths

**Amazon path:**
- Step 1 (60 days): Match buy box / Keepa 90-day avg (round to charm price)
- Step 2 (90 days): Undercut by 5% below market
- Step 3 (120 days): Undercut by 10% below market
- Step 4 (150 days): Floor price (breakeven after 18.36% fees)
- All steps respect a calculated price floor (cost + fees = breakeven)

**eBay path:**
- Step 1 (60 days): Reduce by 5% from current listing price
- Step 2 (90 days): Reduce by 10% from original listing price
- Step 3 (120 days): Reduce to breakeven (after 18% fees)
- Step 4 (150 days): Recommend auction exit (if still listed)
- eBay can also receive auction recommendations at any step if diagnosed LOW_DEMAND

### Two Modes

**Review mode (default):**
- Cron runs daily, generates markdown proposals
- Proposals stored in a `markdown_proposals` table with status PENDING
- Dashboard page shows all proposals grouped by diagnosis and platform
- Chris approves/rejects individually or in batch
- Approved proposals execute immediately (price update or auction creation)

**Auto mode:**
- Same cron, but proposals with diagnosis OVERPRICED execute automatically
- LOW_DEMAND items still go to review (auction is a bigger decision)
- Auto-executed actions logged to the same table with status AUTO_APPLIED
- Discord summary sent daily: "Auto-applied 3 markdowns, 2 auction proposals awaiting review"

### Auction Exit Strategy

- Items diagnosed LOW_DEMAND at step 4 (or earlier if flagged) get an auction recommendation
- System checks how many auctions are currently scheduled to end each day
- Staggers new auctions so roughly 1 ends per day (7-day duration default, adjustable)
- Auction starting price = current listing price (let the market decide)
- No reserve price (keeps it simple, encourages bidding)
- If no bids after auction ends, item is flagged for manual review

### Hold / Exempt System

- Per-item `markdown_hold` boolean flag — skips all markdown logic
- Useful for investment-grade sets Chris believes will appreciate
- Can be set from inventory detail page or bulk-toggled from dashboard

---

## Success Criteria

### Functional

#### F1: Diagnosis Engine Classifies Items
- **Tag:** AUTO_VERIFY
- **Criterion:** The diagnosis service takes an inventory item with its pricing data and returns one of `OVERPRICED`, `LOW_DEMAND`, or `HOLDING` with a human-readable reason string
- **Evidence:** Unit test passes item fixtures through diagnosis and asserts correct classification
- **Test:** `npm test -- diagnosis.service.test.ts` — test cases: (1) item priced 20% above Keepa avg → OVERPRICED, (2) item at market price with sales rank >100k → LOW_DEMAND, (3) item listed 30 days ago → HOLDING, (4) item with markdown_hold=true → HOLDING

#### F2: Amazon Markdown Steps Applied Correctly
- **Tag:** AUTO_VERIFY
- **Criterion:** For Amazon LISTED items diagnosed OVERPRICED, the service calculates the correct new price based on aging bracket (60/90/120/150 days) using Keepa 90-day avg as the market reference, rounded to charm pricing (.49/.99), and never below the calculated price floor (cost / (1 - 0.1836))
- **Evidence:** Unit test with known cost/Keepa data produces expected prices at each bracket
- **Test:** `npm test -- amazon-markdown.test.ts` — item cost £40, Keepa avg £80, current price £95: at 60d → £79.99 (match market), at 90d → £75.99 (5% under), at 120d → £71.99 (10% under), at 150d → £48.99 (floor)

#### F3: eBay Markdown Steps Applied Correctly
- **Tag:** AUTO_VERIFY
- **Criterion:** For eBay LISTED items diagnosed OVERPRICED, the service calculates the correct new price based on aging bracket using percentage reductions from listing price, rounded to charm pricing, and never below the eBay price floor (cost / (1 - 0.18))
- **Evidence:** Unit test with known cost/listing data produces expected prices at each bracket
- **Test:** `npm test -- ebay-markdown.test.ts` — item cost £40, listed at £95: at 60d → £90.49 (5% off), at 90d → £85.49 (10% off), at 120d → £48.99 (floor), at 150d → auction recommendation

#### F4: Markdown Proposals Created and Stored
- **Tag:** AUTO_VERIFY
- **Criterion:** The daily cron creates rows in `markdown_proposals` table for each item needing action, with fields: `inventory_item_id`, `platform`, `diagnosis`, `reason`, `current_price`, `proposed_price`, `proposed_action` (MARKDOWN or AUCTION), `aging_days`, `status` (PENDING or AUTO_APPLIED), `markdown_step`
- **Evidence:** After cron runs against test data, proposals exist in the table with correct field values
- **Test:** Seed 5 items at various ages → run cron → query `markdown_proposals` → verify correct count, diagnoses, and proposed prices

#### F5: Review Mode — Approve/Reject Proposals
- **Tag:** AUTO_VERIFY
- **Criterion:** API endpoints exist to approve or reject proposals: `POST /api/markdown/proposals/[id]/approve` updates the item's listing price (via existing repricing infrastructure) and sets proposal status to APPROVED; `POST /api/markdown/proposals/[id]/reject` sets status to REJECTED
- **Evidence:** Approve endpoint triggers price update on the platform adapter, reject endpoint updates status only
- **Test:** Create PENDING proposal → call approve → verify inventory item listing_value updated and proposal status = APPROVED. Create another → call reject → verify proposal status = REJECTED, item price unchanged.

#### F6: Auto Mode — OVERPRICED Proposals Auto-Execute
- **Tag:** AUTO_VERIFY
- **Criterion:** When user config `markdown_mode` is set to `auto`, proposals with diagnosis OVERPRICED are created with status AUTO_APPLIED and the price update is executed immediately during the cron run. LOW_DEMAND proposals are still created as PENDING.
- **Evidence:** After cron with auto mode: OVERPRICED proposals have status AUTO_APPLIED and items have updated prices; LOW_DEMAND proposals have status PENDING
- **Test:** Set mode to auto → seed 1 OVERPRICED item + 1 LOW_DEMAND item → run cron → verify OVERPRICED item price changed + proposal AUTO_APPLIED, LOW_DEMAND proposal PENDING

#### F7: Bulk Approve/Reject from Dashboard
- **Tag:** AUTO_VERIFY
- **Criterion:** `POST /api/markdown/proposals/bulk` accepts an array of `{ id, action: 'approve' | 'reject' }` and processes all in a single request, returning success/failure counts
- **Evidence:** Bulk endpoint processes multiple proposals correctly
- **Test:** Create 5 PENDING proposals → bulk approve 3, reject 2 → verify correct statuses and price updates

#### F8: Auction Recommendation for LOW_DEMAND Items
- **Tag:** AUTO_VERIFY
- **Criterion:** Items diagnosed LOW_DEMAND at eBay step 4 (150+ days) or at any step if sales rank >100k and price is within 10% of market have `proposed_action = 'AUCTION'` in their proposal, with a suggested `auction_end_date` staggered to avoid >2 auctions ending on the same day
- **Evidence:** Proposals with AUCTION action include an end date, and no date has more than 2 auctions scheduled
- **Test:** Create 5 LOW_DEMAND items all needing auction → run cron → verify auction proposals spread across at least 3 different end dates

#### F9: Auction Stagger — Target 1 Per Day
- **Tag:** AUTO_VERIFY
- **Criterion:** The auction scheduler queries existing scheduled auctions (from `markdown_proposals` with action=AUCTION and status=APPROVED) and assigns new auction end dates to fill gaps, preferring days with 0 auctions, then days with 1, targeting 7-day durations (adjustable in config)
- **Evidence:** Given existing auctions on Mon/Wed, a new auction is scheduled for Tue or Thu
- **Test:** Seed approved auctions ending Mon + Wed → request new auction → end date is Tue, Thu, Fri, Sat, or Sun (not Mon or Wed)

#### F10: Auction Proposal Creates eBay Auction Listing
- **Tag:** AUTO_VERIFY
- **Criterion:** When an AUCTION proposal is approved, the system creates an eBay auction-format listing via the Inventory API with: format=AUCTION, startPrice=current listing price, duration=7 days (or configured), and the existing item's eBay listing is withdrawn first if active
- **Evidence:** eBay API adapter called with auction format parameters, old fixed-price listing withdrawn
- **Test:** Approve AUCTION proposal → verify `createOffer` called with format='AUCTION' and `withdrawOffer` called for old listing (mock eBay API)

#### F11: Hold/Exempt Flag Respected
- **Tag:** AUTO_VERIFY
- **Criterion:** Items with `markdown_hold = true` on the inventory item are always diagnosed as HOLDING and never receive markdown proposals, regardless of age
- **Evidence:** Held items excluded from proposals even at 200+ days age
- **Test:** Seed item at 200 days with markdown_hold=true → run cron → no proposal created for that item

#### F12: Price Floor Never Breached
- **Tag:** AUTO_VERIFY
- **Criterion:** No proposal ever has a `proposed_price` below the calculated floor: Amazon floor = `cost / (1 - 0.1836)`, eBay floor = `cost / (1 - 0.18)`. If the calculated markdown would breach the floor, the proposal uses the floor price instead (or recommends auction if already at floor).
- **Evidence:** Unit tests with edge-case costs verify floor is never breached
- **Test:** Item cost £45, Amazon fee 18.36% → floor = £55.15. Markdown step would produce £50 → proposal clamps to £55.49 (charm-rounded floor). Item already at floor → propose auction instead.

#### F13: Daily Discord Summary
- **Tag:** AUTO_VERIFY
- **Criterion:** After the cron completes, a Discord message is sent to the `sync-status` channel summarising: items evaluated, proposals created (by type), auto-applied count, auctions scheduled, items held/skipped
- **Evidence:** Discord webhook called with formatted summary embed
- **Test:** Run cron with mixed results → verify Discord service called with correct counts

---

### Error Handling

#### E1: Missing Pricing Data Graceful Skip
- **Tag:** AUTO_VERIFY
- **Criterion:** If an item has no Keepa data (Amazon) or no market price reference (eBay), the item is skipped with reason "insufficient pricing data" logged, and the cron continues processing remaining items
- **Evidence:** Items without pricing data don't produce proposals, don't crash the cron, and appear in the skip count in the Discord summary
- **Test:** Seed item with no Keepa data → run cron → no proposal, item counted in skipped, cron completes successfully

#### E2: eBay API Failure on Price Update
- **Tag:** AUTO_VERIFY
- **Criterion:** If the eBay `updateOffer` call fails when executing an approved markdown, the proposal is marked FAILED with the error message, and processing continues for remaining proposals
- **Evidence:** Failed proposal has status=FAILED and error field populated
- **Test:** Mock eBay API to return 500 → approve proposal → proposal status = FAILED, error message stored

#### E3: Auction Creation Failure
- **Tag:** AUTO_VERIFY
- **Criterion:** If eBay auction listing creation fails, the proposal is marked FAILED, the original fixed-price listing is NOT withdrawn (withdrawal only happens after successful auction creation), and a Discord alert is sent
- **Evidence:** Original listing remains active, proposal marked FAILED, Discord alert sent
- **Test:** Mock auction creation to fail → approve AUCTION proposal → old listing still active, proposal FAILED, Discord alert sent

#### E4: Duplicate Proposal Prevention
- **Tag:** AUTO_VERIFY
- **Criterion:** The cron does not create a new proposal for an item that already has a PENDING proposal (prevents accumulation of unreviewed proposals)
- **Evidence:** Running cron twice without reviewing produces only 1 proposal per item
- **Test:** Run cron → proposals created → run cron again → no duplicate proposals, original proposals unchanged

---

### Performance

#### P1: Cron Completes Within Vercel Timeout
- **Tag:** AUTO_VERIFY
- **Criterion:** The daily markdown cron processes up to 500 LISTED items (with pagination) and completes within 120 seconds
- **Evidence:** Cron route returns success within timeout, uses cursor-based processing if needed
- **Test:** Seed 100 LISTED items at various ages → time cron execution → completes in <120s

#### P2: Dashboard Loads Proposals Quickly
- **Tag:** AUTO_VERIFY
- **Criterion:** The proposals API returns paginated results (default 50 per page) in <500ms
- **Evidence:** API response time measured under load
- **Test:** Seed 200 proposals → GET /api/markdown/proposals?page=1 → response in <500ms

---

### UI/UX

#### U1: Markdown Dashboard Page
- **Tag:** AUTO_VERIFY
- **Criterion:** A page exists at `/inventory/markdown` accessible from the inventory navigation, showing: summary cards (pending/auto-applied/approved/rejected counts), filterable table of proposals with columns (item name, set number, platform, diagnosis, current price, proposed price, days listed, action), and batch approve/reject controls
- **Evidence:** Page renders at the route with all specified elements in the DOM
- **Test:** Navigate to `/inventory/markdown` → page loads, summary cards visible, table renders with correct columns, batch action buttons present

#### U2: Diagnosis Badges
- **Tag:** AUTO_VERIFY
- **Criterion:** Each proposal row shows a colour-coded diagnosis badge: OVERPRICED = amber, LOW_DEMAND = red, and proposed action badge: MARKDOWN = blue, AUCTION = purple
- **Evidence:** Badges rendered with correct variant classes per diagnosis/action
- **Test:** Proposals with different diagnoses render with distinct badge colours

#### U3: Hold Toggle on Inventory Detail
- **Tag:** AUTO_VERIFY
- **Criterion:** The inventory item detail page shows a "Hold from markdown" toggle (Switch component) that sets/clears `markdown_hold` on the item. When held, a "Held" badge appears next to the item status.
- **Evidence:** Toggle exists in DOM, toggles the database field, badge appears when held
- **Test:** Load item detail → toggle hold on → refresh → hold is persisted and badge visible → toggle off → badge gone

#### U4: Mode Toggle in Settings
- **Tag:** AUTO_VERIFY
- **Criterion:** The markdown settings (accessible from the dashboard page) include a mode toggle (Review / Auto) that persists to user config, with a clear explanation: "Review: all proposals require manual approval. Auto: overpriced items are repriced automatically, auction proposals still require approval."
- **Evidence:** Toggle persists mode to config, description text present
- **Test:** Set mode to Auto → refresh page → mode still Auto

#### U5: Auction Proposal Detail
- **Tag:** AUTO_VERIFY
- **Criterion:** AUCTION proposals in the table show additional info: suggested auction end date, estimated days until auction ends, and current number of auctions already scheduled for that day
- **Evidence:** Auction proposals render with end date and schedule context
- **Test:** Seed AUCTION proposal with end date → table row shows end date and auction count for that day

---

## Out of Scope

- BrickLink/Brick Owl markdown paths (Amazon and eBay only for MVP)
- Automatic eBay listing creation for items not already listed on eBay (only relists/converts existing)
- Integration with Amazon's automated pricing rules (SP-API repricing)
- Machine learning price prediction (uses simple rule-based brackets)
- Markdown history analytics/charts (just the proposals table for now)
- Cross-platform arbitrage (moving an Amazon item to eBay or vice versa)
- Vinted or Shopify markdown paths
- Auto-bidding on other people's auctions (that's the auction sniper feature)

---

## Dependencies

- Keepa pricing data populated via existing `amazon-pricing` cron (90-day avg, buy box price)
- eBay pricing data from existing `ebay-pricing` cron
- Existing charm pricing utility from minifig pricing engine (`pricing-engine.ts`)
- Existing eBay API adapter with `updateOffer()` and `createOffer()` methods
- Existing Discord notification service
- Existing inventory item detail page and mutation infrastructure
- Existing cron job pattern with job execution tracking
- eBay Inventory API auction format support (needs extension to adapter — `format: 'AUCTION'` type exists but auction-specific fields like duration/startPrice need adding)

---

## Iteration Budget

- **Max iterations:** 5
- **Escalation:** If not converged after 5 iterations, pause for human review

---

## Verification Summary

| ID | Criterion | Tag | Status |
|----|-----------|-----|--------|
| F1 | Diagnosis engine classifies OVERPRICED / LOW_DEMAND / HOLDING | AUTO_VERIFY | PENDING |
| F2 | Amazon markdown steps with Keepa reference + charm pricing + floor | AUTO_VERIFY | PENDING |
| F3 | eBay markdown steps with percentage reductions + floor | AUTO_VERIFY | PENDING |
| F4 | Proposals created and stored with all required fields | AUTO_VERIFY | PENDING |
| F5 | Review mode — approve/reject individual proposals | AUTO_VERIFY | PENDING |
| F6 | Auto mode — OVERPRICED auto-executes, LOW_DEMAND stays pending | AUTO_VERIFY | PENDING |
| F7 | Bulk approve/reject endpoint | AUTO_VERIFY | PENDING |
| F8 | Auction recommendation for LOW_DEMAND items | AUTO_VERIFY | PENDING |
| F9 | Auction stagger — target 1 per day, fill gaps | AUTO_VERIFY | PENDING |
| F10 | Approved auction creates eBay auction listing | AUTO_VERIFY | PENDING |
| F11 | Hold/exempt flag prevents all markdown | AUTO_VERIFY | PENDING |
| F12 | Price floor never breached | AUTO_VERIFY | PENDING |
| F13 | Daily Discord summary after cron | AUTO_VERIFY | PENDING |
| E1 | Missing pricing data — graceful skip | AUTO_VERIFY | PENDING |
| E2 | eBay API failure — mark FAILED, continue | AUTO_VERIFY | PENDING |
| E3 | Auction creation failure — don't withdraw old listing | AUTO_VERIFY | PENDING |
| E4 | Duplicate proposal prevention | AUTO_VERIFY | PENDING |
| P1 | Cron completes within 120s for 500 items | AUTO_VERIFY | PENDING |
| P2 | Dashboard API <500ms paginated | AUTO_VERIFY | PENDING |
| U1 | Markdown dashboard page with summary + table + batch controls | AUTO_VERIFY | PENDING |
| U2 | Colour-coded diagnosis and action badges | AUTO_VERIFY | PENDING |
| U3 | Hold toggle on inventory detail page | AUTO_VERIFY | PENDING |
| U4 | Mode toggle in settings (Review/Auto) | AUTO_VERIFY | PENDING |
| U5 | Auction proposal shows end date and schedule context | AUTO_VERIFY | PENDING |

**Total:** 24 criteria (24 AUTO_VERIFY, 0 HUMAN_VERIFY, 0 TOOL_VERIFY)

---

## Handoff

Ready for: `/build-feature smart-auto-markdown`

**Key files likely affected:**
- `apps/web/src/lib/services/markdown-diagnosis.service.ts` (new — diagnosis engine)
- `apps/web/src/lib/services/markdown-engine.service.ts` (new — markdown calculation + proposal creation)
- `apps/web/src/lib/services/auction-scheduler.service.ts` (new — stagger logic)
- `apps/web/src/app/api/cron/markdown/route.ts` (new — daily cron)
- `apps/web/src/app/api/markdown/proposals/route.ts` (new — list/bulk endpoints)
- `apps/web/src/app/api/markdown/proposals/[id]/approve/route.ts` (new)
- `apps/web/src/app/api/markdown/proposals/[id]/reject/route.ts` (new)
- `apps/web/src/app/api/markdown/config/route.ts` (new — mode + thresholds)
- `apps/web/src/app/(dashboard)/inventory/markdown/page.tsx` (new — dashboard)
- `apps/web/src/lib/ebay/ebay-api.adapter.ts` (extend — auction format fields)
- `apps/web/src/lib/ebay/listing-creation.service.ts` (extend — auction creation path)
- `apps/web/src/components/features/inventory/InventoryDetail.tsx` (modify — hold toggle)
- `supabase/migrations/YYYYMMDD_markdown_proposals.sql` (new — proposals table + config)
