# Unified Markdown & Repricing — Design

**Status:** Design (approved decisions baked in — not yet implemented)
**Author:** Generated 2026-06-02, decisions confirmed 2026-06-03
**Supersedes / merges:** `eBay Listing Refresh` (`/api/cron/ebay-listing-refresh`, `lib/ebay/refresh-pricing.ts`) + `Smart Auto-Markdown` (`/api/cron/markdown`, `lib/markdown/*`)

---

## 1. Goal

One coherent pricing system for **both eBay and Amazon**, with two clearly separated jobs:

1. **eBay 90-day relist — AUTO.** Every eBay listing that reaches **90 days** is automatically **ended, re-priced, and re-listed** (Cassini "Sell Similar" reset) at the system's current target price. No approval step.
2. **30-day suggestion — RECOMMEND (both platforms).** Each item is re-evaluated **30 days after its first listing date** (then every 30 days). The system computes a suggested price (or eBay auction recommendation) and **emails a report of suggested changes**. Nothing is applied automatically; Chris approves.

The two jobs share **one pricing engine, one aging clock, one config, one proposals table** — eliminating the current dual-engine collisions documented in §2.

**Confirmed decisions (2026-06-03):**
1. 90-day eBay relist = **auto**; 30-day suggestions = **recommend** for both eBay and Amazon.
2. Evaluation cadence is **per-item, anchored to first listing date + 30 days** (not a global daily/weekly batch) so work and emails spread naturally across all calendar days.
3. eBay pricing signals stay **as currently done** (engagement tiers + aging-step reductions) — no new external market-data source.
4. Auctions are **email recommendations only** — surfaced as a section in the 30-day email, never auto-executed.
5. Fee rates come from the **already-documented canonical constants** (§4.1), not the inconsistent inline values.

---

## 2. Why the current two systems collide (the problem we're fixing)

Both already exist and overlap on aged eBay inventory, but never call each other:

| Collision | Today | Consequence |
|---|---|---|
| Two pricing brains | Refresh = engagement tiers (`refresh-pricing.ts`); Markdown = aging-step curve (`markdown-engine.service.ts`) | Same item priced two different ways |
| Both write `inventory_items.listing_value` | Refresh `route.ts:303`; Markdown approve `approve/route.ts:44` | Last writer wins, no coordination |
| Only one touches eBay | Refresh ends+recreates the live listing; Markdown approve is **DB-only** (never calls eBay) | DB price diverges from live eBay price |
| Aging defined twice | Refresh = eBay listing start date; Markdown = `listing_date \|\| purchase_date \|\| created_at` | A relist sets `listing_date=today`, silently resetting Markdown's clock |
| Different skip-guards | Refresh skips pending `negotiation_offers` + qty>1; Markdown skips `markdown_hold` + existing pending proposal | Engines disagree on what's off-limits; refresh can pre-empt a queued auction |
| Two rounding/fee conventions | Refresh: `roundUpToNearest99`, fee `0.1323` hardcoded; Markdown: `roundToNearestCharm`, fee from config (`0.18`/`0.1836`) | Inconsistent floors and final prices |

**Root cause:** the 90-day relist has its *own* pricing logic instead of consuming the suggestion engine's output. The fix is to make the relist a *mechanical* operation that re-lists at whatever the single engine recommends.

---

## 3. Architecture

```
                         ┌─────────────────────────────────────┐
                         │   Pricing Engine (single source)     │
                         │   computeTarget(item, signals, cfg)  │
                         │   → { action, targetPrice, reason }  │
                         └─────────────────────────────────────┘
                            ▲                         ▲
            market/engagement signals                │ same engine
                            │                         │
   ┌────────────────────────┴──────┐     ┌────────────┴───────────────────┐
   │ 30-DAY SUGGESTION (RECOMMEND)  │     │ 90-DAY eBay RELIST (AUTO)       │
   │ /api/cron/markdown (daily run, │     │ /api/cron/ebay-listing-refresh  │
   │  picks items due that day)     │     │ (daily run, age≥90, eBay only)  │
   │                                │     │                                 │
   │ • eBay + Amazon                │     │ • end + recreate listing        │
   │ • diagnose due items           │     │ • price = engine target         │
   │ • write PENDING proposals      │     │ • applied automatically         │
   │ • EMAIL digest (incl. auctions)│     │ • reset listing_date            │
   └────────────────────────────────┘     └─────────────────────────────────┘
            │                                          │
            └──────────► inventory_items (one writer policy) ◄──────────┘
                         markdown_proposals (audit for both)
```

Both cadences are thin orchestrators around **one** `computeTarget()`. Neither has private pricing logic.

---

## 4. The single pricing engine

`lib/pricing/engine.ts` (new) exposes one function used by both cadences:

```ts
type EngineAction = 'HOLD' | 'REPRICE' | 'RELIST' | 'AUCTION';

interface EngineInput {
  platform: 'amazon' | 'ebay';
  currentPrice: number;        // live price (eBay: Trading API; Amazon: listing_value)
  cost: number;
  condition: string | null;
  ageDays: number;             // unified clock — see §5
  marketPrice: number | null;  // Amazon: Keepa was_price_90d / buy box
  salesRank: number | null;
  views: number | null;        // eBay engagement
  watchers: number | null;
  config: MarkdownConfig;
}

interface EngineOutput {
  action: EngineAction;
  targetPrice: number | null;  // null for AUCTION
  diagnosis: 'OVERPRICED' | 'LOW_DEMAND' | 'HOLDING';
  reason: string;
  floor: number;
  markdownStep: number | null;
}
```

### 4.1 Floor & fee rates (decision #5 — canonical, documented values)

Floor = `roundToNearestCharm(breakeven)`, never priced below.

- **Amazon effective fee = 18.36%** — from `lib/arbitrage/calculations.ts:10-32`:
  `15% referral × 1.02 (DST 2%) × 1.20 (VAT 20%) = 0.1836`. (Already the `markdown_config` default — keep it.)
- **eBay effective fee = 15.66% + £0.30 fixed** — from `lib/purchase-evaluator/calculations.ts:16-38`:
  `12.8% final value + 0.36% regulatory + 2.5% payment processing = 0.1566`, plus a flat `£0.30` per order.
  - eBay floor = `(cost + 0.30) / (1 - 0.1566)`.
  - **Corrects** the refresh's hardcoded `0.1323` (too low → floors set below true breakeven) and the config's `0.18` (too high).

Engine reads both rates from `markdown_config` (`amazon_fee_rate`, `ebay_fee_rate`); migration sets `ebay_fee_rate = 0.1566`. The £0.30 fixed component is engine logic, not a config rate.

### 4.2 Rounding & guards
- `roundToNearestCharm` everywhere (retire `roundUpToNearest99`).
- **Never increase** price — a suggestion can only HOLD or lower.

### 4.3 Amazon pricing (market-driven, unchanged)
Step curve by `ageDays`: step1 match Keepa market → step2 undercut `amazon_step2_undercut_pct` → step3 undercut `amazon_step3_undercut_pct` → step4 floor. OVERPRICED when listing > market by `overpriced_threshold_pct`.

### 4.4 eBay pricing (as currently done — decision #3)
**No new market-data source.** Keep the current signals exactly:
- **Engagement tier** (HOT/WARM/COOL/COLD from views·watchers·age, per today's `refresh-pricing.ts`) sets how deeply to cut.
- **Aging-step reductions** off current price (`ebay_step{1,2}_reduction_pct`) per today's `markdown-engine.service.ts`.
- Diagnosis remains age/engagement-driven (eBay has no market comp; the current "0% vs market" display is cosmetic and retained as-is).
- Deep age (≥`ebay_step4_days`) or LOW_DEMAND → **AUCTION** *recommendation* (see §4.6).

> **Noted, not auto-changed:** today's engagement engine still applies the Used `+5%` cut to HOT items (proven on set 6251 → £39.99→£37.99). Because the 90-day relist is now **auto**, this cut would auto-apply. Kept "as currently done" per decision #3, but flagged for Chris to confirm or fix in a follow-up — it is the one behaviour that changes risk profile under auto-relist.

### 4.5 Action selection
- `ageDays < step1_days`, or `markdown_hold`, or no data → **HOLD**.
- eBay, `ageDays ≥ relist_age_days` (90) → **RELIST** at `targetPrice` (the only place that ends/recreates — auto cadence only).
- eBay deep-age / LOW_DEMAND + `auction_enabled` → **AUCTION** (recommendation only).
- Otherwise → **REPRICE** at `targetPrice` (in-place suggested price; recommend cadence).

### 4.6 Auctions (decision #4 — email only)
AUCTION proposals are **never executed**. They are written as PENDING proposals and surfaced in the 30-day email "Auction recommendations" section with a suggested staggered end date (existing `auction-scheduler.service.ts` still assigns the date for display). Converting to a real auction stays manual.

---

## 5. Unified aging clock

**`ageDays` = days since `inventory_items.listing_date`** (date the item went live on its *current* listing). Set when first listed; **reset to today on every relist**. Both cadences read this one field. `purchase_date`/`created_at` remain fallbacks only.

Consequences (all intended):
- A freshly relisted eBay item has `ageDays = 0` → next 30-day suggestion is 30 days out, next relist 90 days out. Clean, non-overlapping per item.
- The relist already applied the latest target price, so a fresh listing is price-optimal + Cassini-fresh.

---

## 6. Evaluation cadence (decision #2 — per-item, anchored to first listing)

**Not a global daily/weekly sweep.** Each item has its own clock:

- `next_eval_date = listing_date + suggest_interval_days` (default 30), rolling forward +30 each time it's evaluated.
- Because items were first listed on different days, due-dates are **naturally spread across all calendar days**.
- The 30-day cron runs daily but only touches items where `next_eval_date <= today` — typically a small handful, not the whole ~581 backlog at once.
- The suggestion **email is sent only on days that have due items**, containing just that day's batch. No fixed daily/weekly digest; no monthly mega-email.
- On relist (or first listing), `next_eval_date` is reset to `listing_date + 30`.

**Cadence vs curve** stay independent: the `*_step{1..4}_days`/`_pct` config defines *how deep* the price goes by age (the curve); `next_eval_date` defines *when the item is surfaced* (the cadence); `relist_age_days` (90) defines *when eBay auto-relists*.

---

## 7. Data model changes

**`inventory_items`** (add):
- `next_markdown_eval_at DATE` — per-item 30-day suggestion anchor (`listing_date + 30`, rolls forward). Indexed for the daily "due today" query.
- (already present: `markdown_hold`, `listing_date`, `is_refresh`, `ebay_listing_id`, `amazon_asin`.)

**`markdown_config`** (add / change):
- `suggest_interval_days INTEGER NOT NULL DEFAULT 30`
- `relist_age_days INTEGER NOT NULL DEFAULT 90`
- `min_change_pct NUMERIC(5,2) NOT NULL DEFAULT 3.0` — suppress trivial suggestions from the email.
- `report_email TEXT DEFAULT 'chris@hadleybricks.co.uk'`
- Set `ebay_fee_rate = 0.1566` (was `0.18`); keep `amazon_fee_rate = 0.1836`.
- `mode` is **retired as a global toggle** — cadence determines behaviour (30-day = always recommend, 90-day relist = always auto). Keep the column only if useful for an emergency "pause auto-relist" switch.

**`markdown_proposals`** (extend):
- `proposed_action` CHECK adds `'RELIST'`.
- `applied_at TIMESTAMPTZ`, `pushed_to_platform BOOLEAN DEFAULT false` — record whether a change actually reached eBay/Amazon.
- The 90-day auto-relist writes a `RELIST` proposal row (status `AUTO_APPLIED`, `pushed_to_platform=true`) for audit + inclusion in the email's "Relisted" section.

---

## 8. The two cron jobs (after unification)

### 8a. 30-day suggestion (recommend) — `/api/cron/markdown`
1. Load config; load LISTED items where `next_markdown_eval_at <= today` (paginated 500/page).
2. Enrich: Amazon → Keepa (`amazon_arbitrage_pricing`); eBay → engagement (views/watchers via Analytics). No new data sources.
3. `computeTarget()` per item.
4. Skip `markdown_hold`. If action ≠ HOLD and change ≥ `min_change_pct`, write a **PENDING** proposal (never auto-apply, never touch `listing_value`).
5. Roll `next_markdown_eval_at += suggest_interval_days`.
6. If any proposals were created today, send the unified email (§9). AUCTION proposals included as their own section.

### 8b. 90-day eBay relist (auto) — `/api/cron/ebay-listing-refresh`
1. Get eBay listings with `ageDays ≥ relist_age_days`; skip qty>1, pending `negotiation_offers`, **`markdown_hold`** (new guard), **and items with a PENDING manual proposal** (new guard — relist owns the price).
2. `computeTarget()` → use `targetPrice` as the recreate price (no separate engagement engine path; same engine).
3. End + recreate via Trading API (existing `executeRefresh`), set `listing_date=today`, `listing_value=targetPrice`, reset `next_markdown_eval_at`, write `RELIST` proposal (AUTO_APPLIED).
4. Relisted items feed the "Relisted (eBay)" section of the email.

---

## 9. Unified email report

Extend `emailService` with `sendMarkdownDigest` (mirroring `sendListingRefreshReport`, `email.service.ts:735`). Sent on any day with due items. Sections:

- **Summary tiles:** Suggestions (eBay / Amazon), Auctions recommended, Relisted (eBay, auto), Total proposed reduction £.
- **Suggested changes** (eBay + Amazon): Set # · Item · Platform · Current · Suggested · Δ · % · Diagnosis/Reason · Age · Floor · **Approve/Reject links** to `/inventory/markdown`.
- **Auction recommendations** (eBay): item, current price, age, suggested end date, reason — informational, manual action.
- **Relisted (eBay, auto):** old→new price, tier, views, watchers, new listing link, failures.
- **Failed items** (carried from the refresh email).

`%` derived from `(current - suggested)/current` (as `email.service.ts:747`).

---

## 10. `listing_value` writer policy (resolves the core collision)

The engine owns `listing_value`. Written in exactly two engine-driven places:
1. **Manual proposal approval** (30-day suggestions) — and pushed to the live platform (eBay `ReviseFixedPriceItem`, client exists at `ebay-listing-refresh/reprice/route.ts:189`; Amazon listing update). Sets `pushed_to_platform=true` or marks FAILED. No more DB-only eBay markdowns.
2. **90-day auto-relist** — written as the recreate price.

Because the relist consumes the same engine output and skips items with a pending proposal, the two cadences can never propose conflicting prices for the same item in the same window.

---

## 11. Scheduling (GCP Cloud Scheduler)

Cloud Scheduler hits `/api/cron/*` with `Authorization: Bearer $CRON_SECRET` (see `gcp/README.md`; `vercel.json` holds only two crons).

| Job | Schedule | Purpose |
|---|---|---|
| `markdown-suggest` | `0 7 * * *` daily | evaluate items **due that day** (`next_markdown_eval_at<=today`), write proposals, email if any |
| `ebay-relist` | `0 19 * * *` daily | 90-day auto-relist batch (existing job, repointed at unified engine) |

Both run daily but each only touches the small per-day due/eligible slice — no mass batch. No separate digest job (email is emitted by `markdown-suggest` when it has results).

---

## 12. Rollout (phased, each independently shippable)

1. **Phase 1 — one engine.** Extract `computeTarget()`; point the 90-day relist at it (delete `refresh-pricing.ts`'s separate path); standardise rounding; apply canonical fee rates (§4.1).
2. **Phase 2 — eBay actually updates + guards.** Manual approval calls `ReviseFixedPriceItem` and sets `pushed_to_platform`. Add relist guards (`markdown_hold`, pending proposals).
3. **Phase 3 — per-item cadence + email.** Add `next_markdown_eval_at` (backfill = `listing_date + 30`); convert the sweep to "due today"; build `sendMarkdownDigest` with the auction section.
4. **Phase 4 — consolidate UI.** Single `/inventory/markdown` shows both platforms + relist queue + report history; retire separate refresh surfaces.

(No auction-execution phase — decision #4 keeps auctions email-only.)

---

## 13. Resolved decisions

| # | Decision | Resolution |
|---|---|---|
| 1 | Auto vs recommend | 90-day eBay relist **auto**; 30-day suggestions **recommend** (both platforms) |
| 2 | Cadence | Per-item, **first-listing-date + 30 days**, rolling; daily cron picks due items; emails spread naturally |
| 3 | eBay market data | **As currently done** — engagement tiers + aging-step reductions; no new data source |
| 4 | Auctions | **Email recommendation only**, as a section in the 30-day email; never executed |
| 5 | Fee rates | **Amazon 18.36%** (`arbitrage/calculations.ts`), **eBay 15.66% + £0.30** (`purchase-evaluator/calculations.ts`) |

### Remaining item for Chris (not blocking the design)
- **HOT + Used auto-cut** (§4.4): under the new auto-relist, a high-demand Used item still gets the 5% Used reduction automatically. Kept as-is per decision #3; confirm whether to suppress it for HOT listings in a follow-up.
