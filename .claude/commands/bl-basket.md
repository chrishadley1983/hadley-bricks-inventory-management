---
name: bl-basket
description: >
  Build an arbitrage purchase basket from a BrickLink UK seller. Scrapes the
  store via Chrome CDP, cross-references each lot against BL 6-month UK sold
  averages (cached + API), applies the Bricqer pricing formula, computes net
  profit after BL/Bricqer/PayPal fees and proportional inbound postage, renders
  a terminal report for approval, then (on user confirm) uploads a wanted list
  to BL, selects the target store, and creates the cart. Records the basket in
  the `arbitrage_purchases` table. Use when the user says "bl basket", "find
  arbitrage in <store>", "basket from <store>", or pastes a store.bricklink.com URL.
---

# BrickLink Seller Arbitrage — Basket + Assessment

Two lenses on the **same** store scrape:

- **Buy lens (this doc):** build an arbitrage purchase basket — score every lot,
  build a staged cart, validate totals, persist to `arbitrage_purchases`.
- **Assess lens (`scripts/store-assessment.ts`):** a whole-store scorecard —
  size & value, pricing strategy, feedback & order rate, part mix, lots within
  buying margin, high-STR lots, and magnets (scarce + selling). Persists to
  `store_assessments`, rendered on `/arbitrage/store-assessment`.

Both share the scrape helper (`scripts/lib/store-scrape.ts`) and the cached
price-guide / STR / worldwide-supply layers, so a fresh
`tmp/stores/<slug>/inventory.json` from either is reused by the other.

## Standard decision report (MANDATORY output layer, 2026-07-19)

**Every store-review answer — from either lens OR a conversational question —
renders through `src/lib/bl-store-report` (`renderDecisionCli` / `renderDecisionMd`).
Never improvise a table in chat.** The module IS Chris's decision set: the
honesty ladder (raw → demand-capped → **LIQUID** = STR≥0.25, DUPs excluded,
capped, full standalone postage), the lot table (ask / bench with † provenance /
STR qty-basis / list / net / capped net / months-cover / overlap / magnet &
ceiling flags), and the gate ladder × overlap. Median STR first, always.

```bash
# Conversational queries over PERSISTED data — no Chrome, no API:
cd apps/web && npx tsx scripts/store-report.ts --slug=<name>            # full standard report
cd apps/web && npx tsx scripts/store-report.ts --slug=<name> --magnets  # "show me the magnets"
cd apps/web && npx tsx scripts/store-report.ts --slug=<name> --min-str=1 --no-dups
cd apps/web && npx tsx scripts/store-report.ts --slug=<name> --pricing-lens=grounded
```

It re-scores the stored scrape (`bl_store_scrapes`) with the current engine and
writes `tmp/stores/<slug>/store-report-<date>.md`. Both lens CLIs emit the same
report automatically; the Discord card leads with the LIQUID figure. Constants
(9.4% fee stack, STR gates, magnet def, liquid gate) live ONLY in
`src/lib/bricklink/fees.ts`.

## Assess lens (store scorecard)

```bash
# Light: scrape → caches only. Fast; reuses a fresh inventory.json.
cd apps/web && npx tsx scripts/store-assessment.ts --store-slug=<name>

# Full: scrape → live gap-fill UK price guides for top uncovered lots → richer scorecard.
cd apps/web && npx tsx scripts/store-assessment.ts --store-slug=<name> --mode=full
```

Key flags: `--min-margin` (0.20), `--min-str` (0.5), `--magnet-max-supply` (3),
`--inbound-per-unit` (0 = ex-postage), `--cache-ttl-days` (90),
`--gapfill-budget` (120, full only), `--json`, `--no-persist`, `--allow-non-uk`.
Typical flow: run the assess lens across candidate stores → run the **buy lens**
(`/bl-basket <slug>`) on the winners to build the cart.

Engine v2 notes (2026-07-09): the verdict is **cherry-pick-first** — buyable net +
ROI dominate; whole-store price posture is only a search-cost modifier, so a premium
store with a strong sub-basket grades REVIEW, not SKIP. Worldwide-fallback benchmarks
carry a +11% UK calibration (marked † in reports). If the report shows
**⚠ SCAN TRUNCATED**, re-run with a higher `--max-pages` — totals understate the store.

Engine v3 (2026-07-09): every P/M lot is overlap-tagged vs OUR store — NEW /
RESTOCK-OUT / RESTOCK-THIN / DUP (section [11], "Ours?" badges, `buyable_fresh_lots`).
Prioritise stores whose buyable net is mostly NEW + RESTOCK-OUT ("fresh demand").

## Nightly sweep (phase 2, 2026-07-10)

```bash
# Seed/refresh the watchlist from assessed stores + arbitrage-purchase sellers:
cd apps/web && npx tsx scripts/store-assessment-batch.ts --seed

# Tonight's selection without scraping:
cd apps/web && npx tsx scripts/store-assessment-batch.ts --dry-run

# Manual sweep (defaults: budget 25, min-age 5d, jittered 20-45s pacing):
cd apps/web && npx tsx scripts/store-assessment-batch.ts --budget=10
```

Runs nightly at 02:15 via the `HadleyBricks-Store-Assessment-Local` scheduled task
(`scripts/register-store-assessment-batch-task.ps1`). Needs the CDP Chrome on :9225.
Discord: BUY verdicts + material deltas (net jump ≥£20, price drop ≥10pts, promising
first assessment) → #opportunities; sweep summary → #sync-status. Manage candidates in
`store_assessment_watchlist` (enabled flag; unique per user+slug).

---

# BrickLink Seller Basket Builder (buy lens)

End-to-end arbitrage workflow for a single UK BrickLink seller. Produces a
terminal-based decision report, builds a staged cart on BL, validates totals,
and persists the basket for downstream velocity tracking.

**Usage:** `/bl-basket <store-slug>`

**Close-out mode** (when user completed BL checkout but didn't paste the order ID at phase 9, or wants to retroactively link a purchases row):

```bash
cd apps/web && npx tsx scripts/bl-basket.ts --close=<arbitrage_purchases.id>
```

Fetches the BL Order API for the arb row's `bl_order_id`, inserts the missing `purchases` row using the actual subtotal/shipping/grand-total, flips `arbitrage_purchases.status` to `purchased`, writes actual `inbound_postage_gbp`, and backlinks `purchases_id` into `arb.inputs`. Refuses to double-insert.

## Arguments

Parse the store URL or name for:
- **Store slug** (required): e.g. `Bruffty` from `https://store.bricklink.com/Bruffty#/shop`

## Interactive prompts the user will see

1. **Inbound shipping estimate** — defaults to £3.00 if user presses Enter
2. **Report approval** — after the report renders, user types `y` to build cart, anything else to abort
3. **Cart validation** — if the actual BL cart subtotal differs by more than 5% from the projection, confirm override
4. **BL order ID** — after user completes checkout manually, they paste the order ID (or press Enter to save as `cart_built` without an order)

## Configuration (CLI overrides)

All have sensible defaults; users can override per-run:

| Flag | Default | Purpose |
|---|---|---|
| `--shipping=<gbp>` | prompted | Inbound postage (allocated by list value across items) |
| `--min-ask=<gbp>` | `0.10` | Drop items where seller's ask is below this |
| `--min-str=<ratio>` | `0` | Sell-through gate (off by default — informational only) |
| `--min-margin=<pct>` | `0.20` | Drop items where net margin on list is below this |
| `--cache-ttl-days=<n>` | `90` | BL price cache freshness |
| `--max-pages=<n>` | `50` | AJAX pages per item-type |
| `--page-delay-ms=<n>` | `3000` (floor) | Between AJAX page requests |
| `--api-delay-ms=<n>` | `250` | Between BL price-guide API calls |
| `--reuse-scrape` | off | Reuse cached inventory if <24h old |
| `--skip-cart` | off | Stop after report (no cart/persist) |
| `--yes` | off | Auto-approve all prompts (for automation) |

## Fee model (fixed constants — update only if rates change)

```
BL_FEE       = 3.0%   (BrickLink seller commission)
BRICQER_FEE  = 3.5%   (Bricqer processing)
PAYPAL_PCT   = 2.9%   (payment processing — item price only)
             = 9.4% variable total
PAYPAL_FIXED = absorbed by shipping+packaging markup (buyer-paid)
```

Velocity baseline: **10% lot turnover per month** (midpoint of Oct 2025 peak
19.5% and current 1.2% ramp-up).

## Execution

Run from the project root (has node_modules with playwright + supabase-js):

```
cd apps/web
npx tsx scripts/bl-basket.ts --store-slug=<SLUG>
```

The script runs 10 phases autonomously:

1. **Preflight** — Chrome CDP 9225 check (aborts with clear error if not
   running), navigate to store, verify StoreFront.id + UK country (aborts on
   non-UK).
2. **Scrape** — AJAX inventory for parts/sets/minifigs, 3s between pages, 50
   pages max per type. Rejects items with damage notes in `invDescription`
   (negation-aware) or ask below `--min-ask`. Reuses cached scrape if <24h old
   (or `--reuse-scrape`).
3. **Enrich** — Cache-first lookup (`bricklink_part_price_cache` for P/M with
   `--cache-ttl-days` TTL; `brickset_sets` for S). For each uncached
   (type,item,colour,condition) tuple, fetches **UK sold + UK stock** price
   guides in one pair of calls (250ms delay). Upserts fresh data to cache
   so future scans benefit.
4. **Score** — List price = UK sold avg × Bricqer multiplier (based on UK
   sell-through). Allocates inbound postage proportionally by list value
   (high-£ items carry more). Net/unit = list × 0.906 − ask − postage share.
   Applies `--min-str` and `--min-margin` gates.
5. **Report** — Renders compact terminal report with: totals, costs, net,
   margin/ROI, top-3 concentration, time to 50%/80% profit capture, and a
   per-item grid with List/Ask/Net-per-unit/Margin%/Qty/Lot £/STR/Months.
   Saved to `tmp/stores/<slug>/report-YYYY-MM-DD.txt`.
6. **User approval** — Prompt y/N to proceed; abort on anything else.
7. **Cart build** — Generates wanted-list XML with `MAXPRICE = ask × 1.05`
   capped at break-even and `MINQTY = scraped qty`. Uploads to BL via CDP
   (React-aware form fill), discovers `wantedMoreID`, navigates to buy page,
   clicks Select on the target store row, Confirm Selection, Create carts.
8. **Validate** — Scrapes actual cart subtotal and compares to projection.
   Tolerance: **±5%**. Warns if out of tolerance and asks confirm.
9. **Checkout prompt** — User completes payment on BL manually. Script asks
   for the BL order ID (optional — skip to save as `cart_built` without order).
10. **Persist** — Inserts a row into `arbitrage_purchases` with inputs, per-lot
    items, cart validation, and the full report snapshot.

## Safety rules (copied from `bricklink-arbitrage` skill — DO NOT RELAX)

- **3-second minimum delay** between AJAX page requests
- **50 pages max per item-type** (~5000 items cap — if the store has more, run with `--max-pages=20` first)
- **Single instance only** (enforced via `tmp/stores/<slug>/scan.lock`)
- **Stop on first empty/error/CAPTCHA** — no retry loops
- **UK stores only** (preflight aborts otherwise; override with `--require-uk=false` only if user explicitly acknowledges the shipping-absorbed-by-markup model no longer holds)
- **Damage-note filter is on by default** — negation-aware so "no scratches" is kept but "a few scratches" is rejected

## Prerequisites

1. **Chrome CDP Chrome running on :9225** — `C:\chrome-cdp\launch-cdp-chrome.bat`.
   Alert user if not running: "Start `C:\chrome-cdp\launch-cdp-chrome.bat`, log in
   to BrickLink, then re-run."
2. **Logged in to BrickLink** in that CDP Chrome window (script detects login
   redirect and aborts cleanly).
3. **Supabase service role key** in `apps/web/.env.local` (for `bricklink_part_price_cache`
   read/write and `arbitrage_purchases` insert).
4. **BrickLink OAuth credentials** in `apps/web/.env.local` (for price-guide API).

## Outputs

```
tmp/stores/<slug>/
  inventory.json            # Raw scrape (reused if <24h old)
  enriched.json             # Scored + gated items
  report-YYYY-MM-DD.txt     # Terminal report
  scan.lock                 # Single-instance guard

Supabase:
  arbitrage_purchases       # New row with full basket detail
  bricklink_part_price_cache # Updated with fresh UK prices
```

## Error handling

| Error | Response |
|---|---|
| CDP not on :9225 | Print command to start, exit 1 |
| Not logged in to BL | "Log in to BrickLink in CDP Chrome first", exit 2 |
| Store country ≠ UK | Abort with country name in message |
| BL rate limit (429) | Stop scrape/enrich, preserve progress, return what we have |
| Cart validation >5% diff | Prompt user confirm before persist |
| Supabase insert fails | Print error; report text preserved in `tmp/` |

## Examples

```bash
# Full interactive run
cd apps/web && npx tsx scripts/bl-basket.ts --store-slug=Bruffty

# Automated with known shipping (no prompts)
cd apps/web && npx tsx scripts/bl-basket.ts --store-slug=Bruffty --shipping=2.20 --yes

# Report only (no cart build)
cd apps/web && npx tsx scripts/bl-basket.ts --store-slug=Bruffty --skip-cart

# Tighter gates
cd apps/web && npx tsx scripts/bl-basket.ts --store-slug=Bruffty --min-str=0.25 --min-margin=0.30
```
