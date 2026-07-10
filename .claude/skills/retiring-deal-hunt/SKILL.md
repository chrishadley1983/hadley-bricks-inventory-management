---
name: retiring-deal-hunt
description: >
  Hunt live buying opportunities for retiring/just-retired LEGO sets: take the
  top picks from the investment-model max-buy sheet, sweep live prices across
  UK retail (Amazon, Argos, Smyths, John Lewis, Very, LEGO.com), eBay new-BIN
  and BrickLink via the CDP Chrome, adjust for rewards (Nectar, LEGO Insiders
  points, gift-with-purchase resale value), and flag everything under the
  model's recommended max-buy price. Use when the user says "deal hunt", "run
  the deal hunt", "any retiring sets on offer", "sweep prices for the top
  picks", "check the max-buy list against retail", or "find sets below max
  buy".
---

# Retiring Deal Hunt

Connects the investment ML model's max-buy sheet to live sourcing. First run:
2026-07-03 (76443 found at £32.99 vs £34.12 max buy across Amazon/JL/Argos
during a coordinated ~27% promo).

## Phase 0 — Fresh max-buy sheet

The sheet is `analysis/investment-maxbuy-YYYY-MM-DD.csv`, produced by:

```powershell
cd apps/web; npx tsx scripts/_export-maxbuy-list.ts
```

Regenerate if it is missing, older than ~2 days, or a rescore has run since.
Key columns: `recommended_max_buy` (the ONE number to buy against — p50 sale
basis for HIGH tier, p38 for standard), `tier`, `pred_1yr_pct`, `risk_factors`.
Default scope: top 10 by score, or the specific sets the user names. Skip
anything the user already holds deep stock of (check inventory if in doubt).

## Phase 1 — Resolve product URLs

- **Amazon**: `https://www.amazon.co.uk/dp/<ASIN>` — ASIN from
  `brickset_sets.amazon_asin` (Supabase).
- **LEGO.com**: `https://www.lego.com/en-gb/product/<slug>` — find via web
  search "lego.com <set number>".
- **Argos / Smyths / John Lewis / Very**: web search "<retailer> lego <set number>"
  and take the product URL from results.
- **eBay**: `https://www.ebay.co.uk/sch/i.html?_nkw=lego+<setnum>&LH_BIN=1&LH_ItemCondition=1000&_sop=15`
  (new, BIN, price+postage ascending).
- **BrickLink**: `https://www.bricklink.com/catalogPG.asp?S=<setnum>-1`
  (price guide; the CDP Chrome is logged in).

## Phase 2 — CDP price sweep

Prerequisite: the dedicated CDP Chrome on port 9222 (see chrome-cdp-skill).
NEVER kill Chrome processes; only open/close tabs. Headless Playwright gets
bot-walled by Smyths/Argos/Very — the CDP real-profile connection does not.

Build a targets JSON (set, name, maxBuy, urls) in the session scratchpad, then:

```powershell
node .claude/skills/retiring-deal-hunt/scripts/sweep-prices.js <targets.json> <results.json>
```

The script paces itself (jittered 1.5-3.5s between pages). Keep bursts to ~6
sets per run; for the full top-10+ run it in two batches. Retailer results
come back as raw "prices seen" lists — YOU judge which is the product price
(cross-reference the RRP: the promo price is usually just below it; carousel
noise is usually far from it). Flag `[OOS hint]` rows as unverified.

Interpretation notes learned on the first run:
- Argos shows integer pricing (£33) with the was-price (£45) alongside.
- John Lewis price-matches Amazon within hours.
- eBay new-BIN results include parts-lot noise — match the set number in the
  title fragment.
- BrickLink "Current Items For Sale (New)" min price is WORLDWIDE; if it is
  meaningfully below retail, manually check the UK-filtered lots
  (catalogPG "▼ UK" or the item-for-sale page) before calling it a source.
  BL sellers dump sets still available at retail — routinely the cheapest
  source pre-retirement.

## Phase 3 — Rewards & GWP adjustment

Compute an **effective price** per source. Verify rates live — do not trust
cached numbers; these move:

- **LEGO.com — Insiders points**: check the current earn rate and reward-value
  on lego.com (historically ~5% back in points value). Points only matter if
  they'll actually be redeemed — treat as a discount only at ~their redemption
  value, not face value.
- **LEGO.com — GWP (gift with purchase)**: check https://www.lego.com/en-gb/offers-deals
  for active thresholds. A GWP has RESALE value (check eBay sold prices for
  the GWP set) — apportion it across the qualifying spend. GWPs can flip
  LEGO.com from worst price to best effective price on multi-unit buys.
- **Argos / Sainsbury's — Nectar**: standard 1pt/£1 ≈ 0.5% (worth little), but
  watch for bonus-points events (10x+ happens) which are material.
- **Smyths**: no loyalty scheme.
- **Amazon / eBay / Vinted**: no native rewards; card-level cashback applies
  everywhere — if a rewards business card is in use, add its rate as a flat
  adjustment column, noting it applies to ALL sources equally so it never
  changes the ranking between sources, only the absolute margin.

Effective price = shelf price − points value (at redemption value) − apportioned
GWP resale value (net of selling fees).

## Theme-trust adjustments (from stratified backtest, 2026-07-03 — re-measure quarterly)

The model's ranking skill is NOT uniform across themes. Measured pooled
walk-forward Spearman by theme (test n>=15): Friends 0.67, Disney 0.59,
Marvel 0.45, City 0.44, Ninjago 0.41 — trust these. **BrickHeadz 0.12 (below
its own theme-average baseline)** — the model cannot rank BrickHeadz; treat any
BrickHeadz prediction as theme-average-quality at best and require extra
manual judgment. High-base-rate themes (Gear, small Creator) appreciate almost
uniformly — the model adds little ranking value there, but the trade still
works. Sales-rank bands: the model's edge over baseline is largest on mid/cold
sets (25k-100k rank: MAE 41pp, top-decile 94%); on hot sets (<25k) the theme
prior alone already ranks well. Do NOT remove any stratum from training —
these adjust trust at the buy decision, not the data.

## Phase 4 — Verify buy boxes

Search/PDP text scans mix buy-box, other-offers and carousel prices. For every
candidate that looks under max-buy, do a targeted second pass on the Amazon PDP
extracting `#corePrice_feature_div .a-offscreen` (+ `#availability`) — see the
verify-buybox pattern from the 2026-07-03 run. Treat too-good prices with
suspicion: a 50%+ discount may be a WRONG ASIN MAPPING (known data issue) —
flag for manual confirmation, never auto-trust. eBay finds: open the actual
listing to confirm condition/price before calling it a BUY.

## Phase 5 — Report

Table per set: best source, shelf price, effective price, vs
`recommended_max_buy`, verdict (BUY NOW / VERIFY / WATCH / NO), plus any
GWP/bonus-event angle and the BL-UK cherry-pick note where relevant. Save the
sweep results JSON to `analysis/` alongside the max-buy CSV. Call out timing:
sets flagged `retiring_soon` have weeks, not months; note whether a current
promo window (coordinated multi-retailer discount) is live, since those
windows — not future clearances — are often the last good buy-in before
retirement. Recommend quantities only qualitatively (the user sizes buys);
remind of the pilot guardrails: max £300/set, model-driven buys ≤10% of
monthly stock budget until the prediction ledger proves out.

### PDF + email delivery (when asked, or on scheduled runs)

1. Write the report as a standalone HTML file in the scratchpad: header with
   date + model version + data-freshness line, then sections BUY NOW /
   VERIFY / WATCH / NO as tables (set, RRP, **expected sale price 1yr**
   [the `expected_sale_1yr` CSV column — the calibrated basis the max buy is
   derived from], max buy, best source, price, headroom, direct product
   links), footer with pilot guardrails and the "prices are point-in-time"
   caveat. Keep it print-clean: no dark backgrounds, tables that fit A4
   portrait.
2. Render to PDF with the repo's Playwright:
   `chromium.launch()` → `page.goto('file://...')` →
   `page.pdf({ path, format: 'A4', margin ~15mm, printBackground: true })`.
3. Email via the send-email helper (recipient comes from its config — never
   construct the address):
   `python "C:\Users\Chris Hadley\.skills\skills\amazon-delivery-performance\send_email.py" --subject "Deal Hunt — <date>" --html <body.html> --attach <report.pdf>`
   Body HTML = a short summary (counts + top 3 finds); the PDF is the full report.

## Guardrails

- Read-only on the world: no checkouts, no basket-building unless asked.
- Gentle scraping (jittered, small bursts) — see feedback_gentle_external_scraping.
- Never kill Chrome; reuse the port-9222 instance; close every tab you open.
- All prices are point-in-time — timestamp the report.
