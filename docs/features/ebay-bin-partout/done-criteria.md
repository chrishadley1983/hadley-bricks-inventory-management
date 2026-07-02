# eBay BIN Part-Out Watcher — Done Criteria

**Goal:** exploit the used part-out data advantage — scan used FIXED-PRICE eBay listings for
sets whose BrickLink used part-out value (POV) far exceeds the asking price, using our
21k-row POV cache as a private pricing layer. Derived from the 2026-07-02 Ninjago discovery
test (`scripts/_discover-bin-partout-ninjago.ts` + probes).

## R1 — Hit list (the target universe)
- `ebay_bin_hitlist` table refreshed from `bricklink_part_out_value_cache` + `brickset_sets`
  via a SECURITY DEFINER function; ranked by used-POV(capped-at-New) ÷ RRP (bootstrap
  denominator; the learned eBay used floor is stored per set for future re-ranking).
- Defaults: ratio ≥ 2.0, used POV ≥ £40, released ≥ 2 years ago (thin-history exclusion at
  watchlist level), aggregates excluded. Expected size ~200 sets (293 at 2.0×, 212 with £40 floor).
- Learned columns (`ebay_floor_gbp`, `fig_share_pct`) survive refreshes.
- Scan self-refreshes the hit list when older than 24h (no second scheduled task).

## R2 — Newly-listed watcher (local, API-frugal)
- One broad Browse search per cycle (`lego`, USED conditions, FIXED_PRICE, UK, LEGO category,
  `sort=newlyListed`), cursor on listing creation so only new listings are processed.
  Budget ≤ ~250 eBay calls/day incl. getItem; **zero BrickLink calls** at scan time.
- Title regex must yield a hit-list set; multi-set joblot titles sum member POVs.
- Runs every 15 min via Windows task (S4U-with-fallback pattern), localhost route
  `/api/cron/ebay-bin-partout` gated by CRON_SECRET; quiet hours respected; one-line run log.

## R3 — Confidence + flags (flag-don't-suppress; discovery-proven)
For candidates over the buy bar (capped used POV ≥ min_multiple × price+postage), one
`getItem` and assemble flags — alert regardless, flags prominent:
- `Type` aspect ≠ "Complete Set" (or absent) → incomplete/undeclared flag
- Pieces aspect vs Brickset count mismatch beyond ±2% → "declares N/M pieces"
- `LEGO Character` aspect + price < price_floor_pct(15%) × POV → probable fig/part listing
- Title caveat patterns (spares, incomplete, parts only, build(s) only, no figs, from set,
  mini …) → pattern flag; part-language listings under the price floor still alert but flagged
- New-seller flag (feedback score < 10)
- Price-drop re-alert: a previously alerted item re-alerts if its price fell ≥ 15%.

## R4 — Discord explicitness (applies to ALL Vinted + eBay alert cards)
Every card must answer at a glance: WHAT is this play, WHERE is the value, WHAT do I do now.
- BIN part-out card: play line ("PART-OUT BUY — used BIN"), value line ("parts sold ~£X on
  BL over 6mo vs £Y all-in = N×"), action line ("Buy now £Y" / "Offer £Z → 3.0×" when Best
  Offer), flags line, ratio-to-RRP + fig-share when known.
- eBay auction cards: play framing (Amazon-resale vs used-part-out), time-left urgency,
  max-bid guidance.
- Vinted extension cards: mode meaning spelled out ("Amazon resale: net margin X%" /
  "Part-out: BL parts ≈ £X = N× your £Y") — decisions at sniping speed.

## R5 — Ship + verify
- Typecheck/lint/full suite green; unit tests for rejector/flag pure logic; code review;
  PR; CI; merge; Vercel deploy verified; local server rebuilt; task registered; first two
  scheduled cycles observed healthy; required refreshes flagged to Chris (extension reload).
- E2E validation workflow `.claude/workflows/validate-ebay-bin-partout.js` written and run.

## Out of scope (v2 backlog)
Gemini photo-sanity gate on flag-tier alerts; fig-share BL backfill job (column ships now,
manual script exists); POV÷eBay-floor re-ranking switch; minifig-lot scanning; seller mining;
multi-niche config UI; eBay offer automation.
