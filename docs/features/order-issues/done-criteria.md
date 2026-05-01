# Done Criteria: order-issues

**Created:** 2026-04-30
**Author:** Define Done Agent + Chris
**Status:** APPROVED
**Branch:** `feature/order-issues`

## Feature Summary

A standalone `/order-issues` screen for tracking buyer-side order issues on BrickLink and BrickOwl sales. Captures both proactive issues (lot found missing/damaged while picking) and reactive issues (buyer reports problem with order received). Anchors to existing `bricklink_transactions` / `brickowl_transactions`, picks affected lots from existing `order_items`, and unifies messages from 5 channels (personal Gmail, hadleybricks email forwarded into Gmail, BL native, BO native, Bricqer outbound) with content-fingerprint dedup. Admin-only — no inventory write-backs, no buyer self-service.

## Context

- **Problem:** No central tracking of buyer-side order issues; messages scatter across 4+ channels with inconsistent overlap
- **User:** Chris (admin, single user)
- **Trigger:** Proactive (picker workflow) + Reactive (buyer-initiated message)
- **Outcome:** One screen with full history per issue (lots affected + unified message log + resolution outcome)

## Success Criteria

### Functional — Schema & Data Model

#### F1: Migration creates `sales_order_issues` table
- **Tag:** AUTO_VERIFY
- **Criterion:** Table exists with columns: `id`, `user_id` (FK profiles), `platform` (bricklink|brickowl), `platform_order_id` (text snapshot), `platform_order_uuid` (FK platform_orders, nullable), `buyer_name`, `buyer_username`, `buyer_email`, `order_date`, `order_status`, `discovered_by` (us|buyer), `issue_status`, `planned_resolution`, `refund_amount`, `replacement_qty`, `credit_amount`, `latest_message_at`, `latest_message_preview`, `latest_message_from`, `latest_message_source`, `created_at`, `updated_at`
- **Evidence:** `\d sales_order_issues` matches schema
- **Test:** Migration applied via `npm run db:push`; types regenerated via `npm run db:types`

#### F2: Migration creates `sales_order_issue_items` table
- **Tag:** AUTO_VERIFY
- **Criterion:** Table exists with: `id`, `issue_id` FK, `order_item_id` FK to `order_items`, `qty_expected`, `qty_received`, `qty_missing` (generated column = expected - received), `issue_type` (missing_from_inventory|damaged_in_inventory|missing_from_shipment|damaged_in_transit|wrong_item_sent|wrong_qty_sent|shipment_lost|other), `notes`, `resolved`
- **Evidence:** Schema check + generated column verified by insert/select
- **Test:** Insert row with `qty_expected=5, qty_received=3` → `qty_missing` returns 2

#### F3: Migration creates `sales_order_issue_messages` table
- **Tag:** AUTO_VERIFY
- **Criterion:** Table exists with: `id`, `issue_id`, `source` (gmail|bricklink|brickowl|bricqer|manual), `external_message_id`, `direction` (inbound|outbound), `sent_at`, `from_address`, `subject`, `body`, `body_html`, `attachments` (jsonb), `content_fingerprint`, `duplicate_of_id` (self-FK nullable), `created_at`. Unique constraint on `(source, external_message_id)`.
- **Evidence:** Schema check + unique constraint enforced (duplicate insert raises)
- **Test:** Insert + duplicate insert; second errors with unique violation

#### F4: RLS policies on all 3 new tables
- **Tag:** AUTO_VERIFY
- **Criterion:** Each new table has RLS enabled and policies matching existing project patterns (authenticated read/write for owner)
- **Evidence:** `pg_policies` lookup returns expected policies
- **Test:** Anonymous query returns 0 rows; authenticated query returns owned rows

### Functional — UI

#### F5: Sidebar entry "Order Issues" near top of nav
- **Tag:** AUTO_VERIFY
- **Criterion:** Sidebar renders link with text "Order Issues" routing to `/order-issues`, positioned in the upper section of the nav (above Reports/Integrations/Admin collapsibles)
- **Evidence:** DOM query on rendered Sidebar finds `<a href="/order-issues">` with text "Order Issues"
- **Test:** Component test on `Sidebar.tsx`

#### F6: `/order-issues` route renders list view
- **Tag:** AUTO_VERIFY
- **Criterion:** GET `/order-issues` returns 200 with a table listing issues
- **Evidence:** Page renders without console errors and shows table element
- **Test:** Playwright navigation + DOM assertion

#### F7: List defaults to open issues with toggle to show all
- **Tag:** AUTO_VERIFY
- **Criterion:** Default render excludes `closed_no_action` and `resolved_*` statuses. A toggle (checkbox or filter) reveals them.
- **Evidence:** Seed mixed-status issues; default count < total; after toggle, count = total
- **Test:** Playwright with seeded data

#### F8: List shows required columns
- **Tag:** AUTO_VERIFY
- **Criterion:** Columns visible: Order date, Platform, Order #, Buyer, # affected items, Latest message (preview + age badge), Planned resolution, Status, Days open
- **Evidence:** DOM check on `<th>` cells
- **Test:** Component test on list table

#### F9: `/order-issues/[id]` detail view renders
- **Tag:** AUTO_VERIFY
- **Criterion:** Detail page renders order header card, items section, chronological message log, and status/resolution editor
- **Evidence:** All 4 sections present in DOM
- **Test:** Playwright with seeded issue

#### F10: Item picker sources from `order_items`
- **Tag:** AUTO_VERIFY
- **Criterion:** When adding items to an issue, the picker queries `order_items` filtered to that order's `platform_order_id` and shows real lot data (item_number, item_name, color_name, condition, quantity)
- **Evidence:** Picker for known synced order returns N lots matching `order_items` row count for that order
- **Test:** Integration test with seeded BL order

#### F11: Manual issue creation persists items + status
- **Tag:** AUTO_VERIFY
- **Criterion:** POST to create endpoint with header + items array → 1 row in `sales_order_issues` + N rows in `sales_order_issue_items`
- **Evidence:** Row counts match request payload after POST
- **Test:** API integration test

#### F12: Status transitions persist
- **Tag:** AUTO_VERIFY
- **Criterion:** PATCH issue with status sequence open → awaiting_buyer → awaiting_us → resolved_refund persists each step and updates `updated_at`
- **Evidence:** Each status read-back matches; `updated_at` advances
- **Test:** API integration test

#### F13: Resolution amounts persist
- **Tag:** AUTO_VERIFY
- **Criterion:** PATCH `refund_amount`, `replacement_qty`, `credit_amount` round-trips correctly with decimal precision preserved
- **Evidence:** Read-back matches input
- **Test:** API integration test

### Functional — Automation

#### F14: Gmail adapter ingests inbound + outbound by order #
- **Tag:** AUTO_VERIFY
- **Criterion:** Adapter searches Gmail for the issue's `platform_order_id`, ingests matching messages from inbox AND sent folder, sets `direction` correctly based on sender
- **Evidence:** For a known issue with order # in Gmail history, adapter run produces ≥1 inbound + ≥1 outbound message rows
- **Test:** Integration test against fixture Gmail thread

#### F15: Gmail coverage tests A–G runnable as script
- **Tag:** AUTO_VERIFY
- **Criterion:** Script `npm run test:gmail-coverage` runs the 7 coverage cases (A–G), exits 0 with per-case pass/fail report. Failed cases log as ingestion gaps but don't fail the script.
- **Evidence:** Script exits 0, output includes 7 case results
- **Test:** Run script in CI-like context

#### F16: BrickOwl messages adapter ingests messages
- **Tag:** AUTO_VERIFY
- **Criterion:** Adapter (BO API if available, CDP fallback otherwise) ingests messages for a given order and persists to `sales_order_issue_messages` with `source='brickowl'`
- **Evidence:** Adapter run for a known BO order with messages produces ≥1 row
- **Test:** Integration test (CDP-mocked or live)

#### F17: BrickLink CDP scraper ingests messages
- **Tag:** AUTO_VERIFY
- **Criterion:** CDP scraper navigates BL message thread for a given order and persists messages with `source='bricklink'`
- **Evidence:** Scraper run for a known BL order with messages produces ≥1 row
- **Test:** Integration test (CDP)

#### F18: Bricqer outbound investigation documented
- **Tag:** AUTO_VERIFY
- **Criterion:** `docs/features/order-issues/bricqer-investigation.md` exists with findings. EITHER an adapter is implemented and ingests messages with `source='bricqer'`, OR the file explicitly documents that Bricqer messages are fully captured via Gmail relay and the adapter is unnecessary.
- **Evidence:** File exists with finding + decision; adapter present (if applicable)
- **Test:** File existence check + (if adapter) integration test

#### F19: Auto-create issue from unmatched buyer message
- **Tag:** AUTO_VERIFY
- **Criterion:** When Gmail sync sees a message containing a BL/BO order # that has no existing issue, an issue is auto-created with `discovered_by='buyer'`, `issue_status='awaiting_us'`, header seeded from `bricklink_transactions`/`brickowl_transactions`
- **Evidence:** After sync, new issue row exists for the order with the correct `discovered_by` and `issue_status`
- **Test:** Integration test with seeded transaction + fixture Gmail message

#### F20: Dedup job populates `duplicate_of_id`
- **Tag:** AUTO_VERIFY
- **Criterion:** Background dedup job groups messages by `content_fingerprint` and sets `duplicate_of_id` on later rows pointing to earliest. Idempotent (re-running produces same result).
- **Evidence:** Insert two messages with identical fingerprint; run job; later row has `duplicate_of_id` = earlier row's id
- **Test:** Integration test

#### F21: `latest_message_*` snapshot updates on issue header
- **Tag:** AUTO_VERIFY
- **Criterion:** Inserting a new message updates parent issue's `latest_message_at`, `latest_message_preview`, `latest_message_from`, `latest_message_source` to reflect the newest message
- **Evidence:** Insert message; read issue header; values match new message
- **Test:** DB trigger or service-layer update verified by integration test

### Error Handling

#### E1: Empty list state
- **Tag:** AUTO_VERIFY
- **Criterion:** When zero open issues exist, list view shows an empty-state message (e.g. "No open issues")
- **Evidence:** Render with empty data set finds the empty-state component
- **Test:** Component test

#### E2: New-issue form rejects unknown order #
- **Tag:** AUTO_VERIFY
- **Criterion:** Submitting a new issue with an order # not present in `bricklink_transactions` or `brickowl_transactions` returns 400 with a specific error message
- **Evidence:** API response status 400 + body includes `"order not found"` (or similar specific text)
- **Test:** API integration test

#### E3: Adapter failure logged, doesn't crash UI
- **Tag:** AUTO_VERIFY
- **Criterion:** Gmail/BO/BL/Bricqer adapter throwing during sync logs error to `sync_errors` table (or equivalent) and the list/detail views still render normally
- **Evidence:** Stubbed adapter throws → error row inserted; list view returns 200
- **Test:** Integration test with adapter stub

### Performance

#### P1: List view loads in under 2s for 100 issues
- **Tag:** AUTO_VERIFY
- **Criterion:** With 100 seeded issues, list view renders within 2000ms (server response + initial paint)
- **Evidence:** Playwright timing measurement under threshold
- **Test:** Performance test with seeded data

## Out of Scope

- Buyer-facing self-service portal
- Inventory cost-basis or quantity write-backs on resolution (admin tracking only)
- Amazon, eBay, Vinted issue tracking (BL + BO only)
- Translation of foreign-language messages
- BL/BO platforms beyond messages (no feedback workflow integration)
- Sending replies from inside the app (read-only message log; you reply via Gmail/BL/BO UI)
- Notifications (no email/Slack/push when new buyer message arrives — surfaced in UI only)

## Dependencies

- Existing `bricklink_transactions`, `brickowl_transactions`, `order_items` tables populated by current sync services
- Gmail API credential (existing infrastructure)
- CDP Chrome on port 9222 (existing infrastructure for BL scraping)
- BO API credential (existing)

## Iteration Budget

- **Max iterations:** 5
- **Escalation:** If not converged after 5 iterations, pause for human review

## Build Order

1. F1–F4 (migration + RLS + types + Zod schemas)
2. F11–F13 (repo + service + API routes — backs F5–F10)
3. F5–F10 (UI: list + detail + sidebar) — screen shippable here
4. F14–F15 + F19 + F21 + E3 (Gmail adapter + auto-create + snapshot trigger)
5. F16 (BrickOwl adapter)
6. F17 (BrickLink CDP scraper)
7. F18 (Bricqer investigation + adapter or gap doc)
8. F20 (dedup job)
9. E1, E2, P1 (polish + perf)
