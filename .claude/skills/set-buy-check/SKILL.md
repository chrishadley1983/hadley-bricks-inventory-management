---
name: set-buy-check
description: >
  Value a list of LEGO sets for sale (Facebook group post, Vinted/Marketplace
  lot, screenshot, pasted text, or photo) and return a Buy/Skip verdict per set
  with a max-buy price, best exit route, and the data behind it — plus an
  optional gotcha pass on too-good-to-be-true numbers and a whole-lot offer.
  Use when Chris says "buy check", "should I buy these", "value this lot",
  "run the buy check on this", or pastes/screenshots a multi-set sale post.
---

# Set Buy Check

Turn a messy "sets for sale" post into per-set BUY / SKIP verdicts with the
price at which each set becomes worth buying, using local data first and
external calls only where they earn their cost.

## Stage 1 — Parse the input

Input can be an image (screenshot of a FB/Vinted/Marketplace post, or a photo
of sets), pasted text, or both. Extract per line:

- **set number** (bare form, e.g. `80113`)
- **description** (seller's words)
- **asking price** (per unit if quantity given)
- **quantity** (`2 x 42692` → qty 2, per-unit £)
- **condition** — post-level statements apply to all items ("All sets used")
- **completeness caveats** — "box not perfect", "no instructions", "opened" —
  carry these into the verdict row verbatim

Parsing rules (non-negotiable):

1. **Bundles** (`40816+40808 easter bundle £15`) → value as the sum of
   components, one verdict row for the bundle.
2. **Un-numbered items** ("Duplo education trophy box") → attempt to identify
   from the description; if not confident, output `UNIDENTIFIED — need set
   number`. **Never guess a set number.**
3. **Price basis**: if the post says prices include fees/postage, treat ask as
   all-in. If silent, assume postage is on top, state the assumption in the
   output, and add £3 to the effective ask.
4. Exclusives with no RRP/ASIN (e.g. employee gifts like 4002022) are valued on
   eBay sold + POV only — expected, not an error.

## Stage 2 — Tier-0 data (free, local)

```powershell
cd apps\web
npx tsx scripts/buy-check-lookup.ts --json ..\..\analysis\buy-check-<date>-t0.json <set> <set> …
```

One call for the whole batch. Returns per set: POV New+Used (sold 6mo avg,
for-sale avg, multiple, lots, cache age), Amazon (ASIN, buy box, **180d median
buy box**, was-90d/180d, BSR, drops90, offer count), Brickset metadata (name,
year, theme, pieces, UK RRP, retirement status/dates), investment ML v2
prediction if scored. Aggregate-listing POV rows are already excluded.

## Stage 3 — eBay sold comps (CDP Chrome scrape)

The eBay Finding API is **dead** (decommissioned; returns 503 — verified
2026-07-07). Sold comps come from scraping ebay.co.uk sold/completed search
via the dedicated CDP Chrome on port 9225 (start it first if unreachable):

```powershell
npx tsx scripts/buy-check-ebay-sold.ts --condition used --json ..\..\analysis\buy-check-<date>-ebay.json <set> …
```

- Run for **used** sets always; for **new** sets only when there's no usable
  Amazon data (no ASIN, or no buy box AND no 180d median).
- Pacing is jittered 2.5–5s/set (built in). ~25 sets ≈ 2–3 min. Don't run the
  same list twice back-to-back.
- The script junk-filters (instructions-only, box-only, ranges, wrong set) and
  returns median/mean/n + samples. **Median is the headline** (standing rule);
  show n everywhere. If a result looks off, eyeball the sample titles —
  completeness mix drives used comps.

## Stage 3b — Tier-2 fallbacks (cost-gated)

- **Keepa** (~3 tokens/set): only for NEW sets missing from
  `seeded_asin_pricing`, cap 10 per run, and mention the spend in the output.
- **POV live scrape** (`npx tsx scripts/pov-fetch.ts <set>` — CDP, ~1 BL page
  each): only for sets with no POV cache row where part-out is plausibly the
  best route (used, big piece count, licensed). Cap ~5 per run.
- POV cache rows older than ~60d on close calls: refresh the specific set the
  same way, don't refresh the world.

## Stage 4 — Decision framework

Compute a **max-buy per exit route**; best route = highest max-buy; verdict =
ask vs best max-buy. All costs are all-in (Stage 1 rule 3).

**Constants** (state them in the output so they can be challenged):
- eBay fees 16%, Amazon fees 17% (platform-fee memory)
- Outbound postage: expected sale ≤£35 → £3.50 (small parcel); above → £5.50
- Required margin on resale routes: **30% net on all-in cost**

**Route A — eBay complete set** (used sets; new sets without Amazon data):
```
net_back = median_sold × (1 − 0.16) − postage
max_buy  = net_back / 1.30
```
n < 4 → mark LOW CONF. |median − mean| > 25% of median → outlier flag, check
the samples before trusting.

**Route B — Amazon** (new sets with ASIN):
```
expected_sale = 180d median buy box   (fallback: current buy box; never a
                buy box that is >20% above the 180d median — that's a spike)
max_buy       = 0.58 × expected_sale   (established formula, covers fees+margin)
```
Velocity gate: drops90 < 15 (or missing with BSR > 200k) → demote Route B to
context; it can't be the recommended route however good the margin looks.

**Route C — BL part-out** (signal, not a valuation). MANDATORY for every set,
new and used — compute and DISPLAY the POV multiple on every row, whatever the
recommended route; never omit it because another route "won":
- Multiple = `POV(condition) ÷ all-in cost`. Report it at BOTH raw ask and
  postage-adjusted cost when they straddle a threshold — don't let a £3
  postage share silently kill a 3.3× signal.
- `≥ 3×` → part-out is a recommended exit (≥4× = strong), mirroring the BIN
  watcher discipline.
- `2.5–3×` → **NEAR GATE**: flag explicitly; a small negotiation or combined
  postage usually clears it. Never report these as plain SKIP.
- Below 2.5× → context only.
- Part-out profile matters at the margin: Technic supercars / licensed
  minifig-rich sets part out better than GWP commons at the same multiple;
  Ideas/licensed POV is often fig-concentrated (fragile) — say so.

Gross POV sold-avg overstates realizable value (low-STR lots sit for months or
never clear) — for any set that clears the gate (≥2.5×) and is genuinely
load-bearing to the verdict, get the honest pound figure instead of leaving it
as a qualitative caveat:
```powershell
npx tsx scripts/pg/pg-set-check.ts --set=<set> --cond=<N|U> --no-cdp --price=<all-in cost>
```
Per-lot L1 (worldwide price-guide summary) join over `/subsets`, liquidity-
adjusted via the same `captureFraction(STR)` curve as the BIN watcher
(`src/lib/bricklink/liquidity-pov.ts`) — reports **Gross POV** (should track
Stage 2's BL POV as a cross-check) alongside **Realisable POV** (capture-rate
%) and, with `--price`, a BUY/MARGINAL/SKIP verdict net of fees. Use
**Realisable POV** as the Route C pound figure in the verdict row and detail
block from here on; gross POV × multiple stays as the quick first-pass screen
in Stage 2, but the realisable figure is what backs a BUY call once part-out
is the deciding route. `--no-cdp` keeps this in pure L1/cache mode (no BL page
scrape, ~1 BL API call/set for `/subsets`); only drop it for the Stage 5
gotcha pass, and confirm with Chris first per that stage's existing BL-call
budget rule.

**Route D — Hold 1yr** (context only, never a verdict driver): for NEW sets
that are `retiring_soon`/`retired`, surface `investment_predictions` (score,
predicted 1yr price) and, if present, the latest
`analysis/investment-maxbuy-*.csv` `recommended_max_buy` for the set.

**Verdicts**:
| Verdict | Rule |
|---|---|
| `BUY` | ask ≤ best max-buy |
| `BUY @ £X` | ask > max-buy but within 2× — X = max-buy, the negotiation number |
| `MARGINAL` | ask within 10% above max-buy |
| `SKIP` | everything else |
| `NO DATA` | no comps on any route (say which lookups came back empty) |
| `UNIDENTIFIED` | couldn't resolve a set number |

**Sub-£15 asks**: suppress LOW-CONF warnings and the Stage 5 machinery —
verdict quality there doesn't justify the spend — **except**: if Route B
(Amazon) is the recommended route and profitable, the BSR/velocity gate above
is still mandatory. A £8 set with a 900k BSR is not a BUY.

## Stage 5 — Gotcha pass (optional, on request: "check the big ones")

Runs on sets flagged 🔥 (POV multiple ≥ 4× ask, or margin ≥ 60%), default top
3 by £ upside. **Confirm with Chris before spending BL API calls** (~1 call
per lot in the set; shared ~1,500/day headroom).

- **Thin-demand X-ray / realisable POV**: `npx tsx scripts/pg/pg-set-check.ts
  --set=<set> --cond=<N|U> --top-l3=30` (drop `--no-cdp` here — this stage's
  BL-call budget covers the L3 scrape upgrade on the top-value lots) → gross
  vs. realisable POV, capture rate, and the per-lot STR breakdown needed to
  see whether POV is propped up by one rare/low-STR piece (fragile) or spread
  across genuinely liquid lots. Supersedes the older
  `scripts/_analyze-set-partout.ts <set>` (still usable as a lighter no-cache
  fallback: raw per-lot STR only, no capture-adjusted total).
- **POV integrity**: `sold_6mo_lots` low (<50), stale `fetched_at`,
  `no_data_reason` set.
- **Amazon reality-check**: buy box vs 180d median divergence >20%, offer
  count, drops90 ≈ 0, six-figure BSR.
- **eBay comp quality**: n, median-vs-mean divergence, completeness mismatch
  between the comps and this listing's caveats.
- **Age risk**: old `year_from` + used → completeness risk, note it.

## Stage 6 — Output

One table row per set, then detail, then the lot view. Always include the
seller's caveat text in the row it belongs to. **The POV column (POV-£,
multiple, sold-lot count) is mandatory on every row** — for new sets show
POV-N, used sets POV-U — alongside the route figures; a reader must be able
to see every applicable exit route per set without asking.

Routes shown per condition — never mix them:
- **Used rows: eBay sold + POV only.** No Amazon column — we don't sell used
  on Amazon, so an Amazon price on a used row reads as a route that doesn't
  exist. If the new-market price genuinely informs the call (e.g. used ask
  within ~20% of the Amazon new price), say it in prose as "new-market ref",
  never in the route columns.
- **New rows: Amazon + eBay new + POV.**

```
SET     NAME (YEAR)              ASK    VERDICT      MAX£   BEST EXIT   KEY DATA
80113   Family Reunion (2024)    £120   SKIP         £64    eBay used   eBay med £104 n=9 · POV-U £153 · Amazon £199 BSR 628k
40654   Beijing Postcard (2023)  £32    BUY 🔥       £41    eBay used   eBay med £67 n=6 · POV-N 2.1× · retired
????    Duplo trophy box         £15    UNIDENTIFIED — need set number
```

Detail block per set (at-a-glance data Chris asked for): BSR, drops90, year,
theme, pieces, RRP, retirement status, POV N+U with lots and age, eBay n +
date range, ML score if any.

**Lot summary** (multi-set posts):
- Cherry-pick: list of BUY rows, total ask vs total max-buy
- Whole-lot offer: `Σ max_buy(BUY/MARGINAL) + 0.5 × max_buy(SKIPs with any
  resale value)`, rounded **down** to a clean negotiation number, with one
  sentence of justification to send the seller

Save the full report to `analysis/buy-check-YYYY-MM-DD-<slug>.md`.

## Operational notes

- Scripts live in `apps/web/scripts/` and run from `apps/web` (they load
  `../.env.local`; Supabase via service role).
- Key forms: `brickset_sets`/`investment_predictions` use `NNNNN-1`, POV cache
  uses bare `NNNNN` — both scripts handle this, don't hand-query without it.
- CDP Chrome on port 9225 must be running for Stage 3 (and pov-fetch). If
  unreachable the scraper exits code 2 — start Chrome, don't fall back to
  WebFetch (eBay blocks it).
- Never kill Chrome processes broadly; CDP PIDs only (standing rule).
- Report totals with the caveat that used comps are completeness-sensitive;
  when a verdict is close, the sample titles matter more than the median.
