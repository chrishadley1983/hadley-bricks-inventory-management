---
name: pab-exit-arbitrage
description: >
  Scan a LEGO Pick a Brick exit/clearance filter (e.g. "2026midyearexit") for
  BrickLink arbitrage: capture the full PAB element list, map elements to BL
  parts, pull UK sold/stock price guides, run two-tier (retail vs wholesale)
  red-flag analysis, size a buy list, build the PAB basket via Upload List in
  Chrome, and generate a BrickStore .bsx for receiving. Use when the user says
  "PAB exit scan", "pick a brick arbitrage", "scan the PAB exit list", "check
  the midyear exit", "build a PAB basket", or "make the bsx for the PAB order".
---

# PAB Exit Arbitrage

End-to-end pipeline for buying soon-to-be-removed Pick a Brick elements that
resell on BrickLink above their PAB price. First run: July 2026
(`2026midyearexit`, 655 elements, £127.81 basket).

Reusable scripts already exist in `apps/web/scripts/` (clone + re-date them for
a new campaign): `_pab-exit-bl-scan-2026-07-03.ts` (resumable BL scan),
`_basket-tx-detail-2026-07-03.ts` (red-flag analysis),
`_pab-exit-price-shape-2026-07-03.ts` (monthly price shape). Playwright capture
scripts are in the session scratchpad pattern below. Outputs live in
`analysis/`.

## Phase 1 — Capture the PAB exit list

The PAB page is a Next.js app; the element grid is served by the
`PickABrickQuery` GraphQL endpoint (`https://www.lego.com/api/graphql/PickABrickQuery`).

Playwright (headless is fine for read-only browsing) with an en-GB context:
1. Load `https://www.lego.com/en-gb/pick-and-build/pick-a-brick?query=<TAG>`.
2. Age gate: click the exact text `Continue` (it is NOT a `<button>` —
   `getByText('Continue', {exact:true})`). Decline non-essential cookies.
3. Capture one `PickABrickQuery` POST (trigger pagination if needed) to get the
   full GraphQL query text, then replay it in-page for pages 1..N, 50/page.

**CRITICAL: paginate with `sort: {key:'PRICE', direction:'ASC'}`.** The default
RELEVANCE sort is unstable across pages — a full pass silently loses ~25% of
elements (dupes on every page). Merge + dedupe by element id if multiple passes.

Each result row gives: element `id`, `designId`, `name`, `price.formattedValue`
(GBP), `facets.color.name`, `facets.category.name`, `availability`.
Save `analysis/pab-<tag>-<date>.{json,csv}`.

## Phase 2 — BL scan (budget-aware, resumable)

BL API budget: ~1,500 calls/day usable (Bricqer eats the rest — see memory
`bricqer-bl-api-base-load`). 3 calls per element → ~500 elements/day max;
split across days via the resumable progress file.

Per element (clone `_pab-exit-bl-scan-2026-07-03.ts`):
1. `(bl as any).request('GET', '/item_mapping/<elementId>')` → BL part no +
   color_id (`request` is private — cast). ~99% success; very new elements
   miss (fall back to designId + colour by hand).
2. `bl.getPartPriceGuide(type, no, colorId, {condition:'N', countryCode:'UK',
   guideType:'sold'|'stock', currencyCode:'GBP'})` — sold 6mo + current stock.

Candidates: AVAILABLE, non-MULTIPACK, sorted by PAB price desc (sub-20p tail
last — least valuable to know about). Use `createScriptBlContext` from
`scripts/_bl-client.ts` so calls hit the daily counter. Save progress after
every element.

## Phase 3 — Analysis

- **STR** = sold lots ÷ current stock lots × 100 (memory `feedback_str_definition`).
- **Sold-backed multiple** = UK sold avg ÷ PAB price. Shortlist needs ≥5 units
  sold AND multiple ≥1.8 AND flat-or-rising price shape.
- **Two-tier red-flag check (the important one).** Fetch the GLOBAL sold price
  guide (NO `country_code` — the UK filter strips `price_detail`; global keeps
  per-transaction `quantity`, `unit_price`, `date_ordered`, last ~500 tx).
  Band each transaction: `>= planned ask` / `small < ask` / `bulk (≥25u) < ask`,
  bucket by month. Flags:
  - no ≥ask sales in the last 2 months
  - recent bulk lots below ask (overhang: someone can undercut for months)
  - hi-band monthly median falling >15% first→last months
  - last sale >1 month old
  Blended averages MISLEAD (mix-shift looks like price decline). Retail tier
  flat + bulk tier falling = fine at retail-sized positions; it is NOT a reason
  to skip, it is a reason to cap quantity.

## Phase 4 — Buy list sizing

- Sell price = **min(current UK min ask, Apr-Jun-style recent global median)** —
  never assume above today's floor.
- Fees 8.9% (BL/BO incl. Bricqer, memory `platform-fee-structure`).
- Qty = ~50% of UK 6-month sold units, capped where a wholesale tier exists:
  position size determines which tier you sell into. Retail flow absorbs only
  its own pace — bulk-lot volume in the sold stats is NOT retail velocity.
- Raise qty only where: retail tier deep+clean, no recent bulk dumping, thin
  UK ask-side depth. Hold/cut where bulk clears below your ask.

## Phase 5 — Build the basket (Chrome, real session)

Use Chris's real logged-in Chrome (claude-in-chrome), NOT headless — and the
PAB **Upload List** feature, not per-item searching (1 upload ≈ 6 clicks total,
minimal bot surface):
1. CSV format: header `elementId,quantity`, one line per element (max 200).
2. On the PAB page: Upload List → inject via JS (`file_upload` tool rejects
   host paths): build a `File` + `DataTransfer`, set `input[type=file].files`,
   dispatch `change`.
3. Review availability (items go OOS same-day — exit stock drains), then
   **Pick selected pieces → Add to Bag** and verify the "Updated My Bag" modal.
4. **Quantity edits in the tray do NOT sync to the bag** — you must click the
   tray's **Update bag** button and wait for the confirmation modal before
   navigating away. Verify at `lego.com/en-gb/cart` (free delivery threshold
   shows there).
5. STOP at the bag. Checkout/payment is Chris's.

## Phase 6 — BSX for BrickStore (on receiving)

Generate a `.bsx` so the order drops straight into BrickStore when parts arrive:

```
node .claude/skills/pab-exit-arbitrage/scripts/generate-bsx.js <basket.json> analysis/pab-<tag>-<date>.bsx
```

`basket.json` lines: `{part, colorId, qty, price, cost, condition?, itemName?,
remarks?, comments?}` — `part`/`colorId` come from the Phase-2 mapping, `price`
is the planned ask, `cost` the PAB unit price. Put the campaign tag + element id
in `remarks` for traceability. BrickStore resolves names from ItemID+ColorID.
Email the .bsx to Chris or leave it in `analysis/` and tell him the path.

## Watch-outs

- lego.com service pages are Cloudflare-protected (403 to headless) — the PAB
  app + GraphQL are fine. Free-delivery threshold: just read it off the cart.
- PAB stock is a shared drain during exits: re-verify availability at basket
  time; re-check OOS wishlist items for restocks before checkout.
- BL price guide `unit_quantity` = lots, `total_quantity` = units. Keep the
  distinction — STR uses lots (memory `feedback_str_median_first`: lead with
  median).
