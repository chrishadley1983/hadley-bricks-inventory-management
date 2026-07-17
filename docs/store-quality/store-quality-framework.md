# Hadley Bricks — BrickLink Store Quality Framework

> **Status:** Implemented on branch `feature/store-quality` (pending review/merge). This doc
> defines the *reusable* approach; the engine + CLIs below implement it.
>
> **Commands (run from `apps/web`):**
> - `npm run store-quality` — the scorecard (cached-only; `--segment`, `--top`, `--window`, `--json`, `--no-persist`)
> - `npm run source-demand-gaps` — reorder list from our sales (`--min-units`, `--csv`)
> - `npm run evaluate-job-lot -- --csv=lot.csv --asking=25` — score a prospective lot
> - `npm run store-quality:refresh` — one-off Bricqer snapshot refresh (the only routine Bricqer-API call)
> - `npm run store-quality:enrich` — size the BL STR-fill blind shortlist; add `--run --max=N` to fill (opt-in)
>
> Engine: `apps/web/src/lib/store-quality/` · Run history: `store_quality_runs` table ·
> Validation: `.claude/workflows/validate-store-quality.js`.
>
> **Scope (locked):** Parts + Minifigs. Sets excluded (£222 / 1.4% of value, not auto-priced).
> **Data stance (locked):** Cached-only by default — **zero external BrickLink / Brick Owl /
> Bricqer API calls** without explicit approval. A separate, approval-gated *enrichment* step
> (§6) is the only thing that touches those APIs.
> **Output (locked):** A committed CLI scorecard (terminal report). Dashboard / weekly email
> can layer on the same engine later.
>
> Calibrated against live Supabase reads on **2026-06-13** (see §9 baseline).

---

## 0. The one-paragraph version

Stock quality = **how much money turns over, per unit of picking effort, at a healthy price,
without dead weight or blind spots.** We score the store on six cached-computable dimensions
(Velocity, Margin/price position, Picking efficiency, Ageing, Coverage, and Data freshness),
roll them into a single 0–100 **Store Quality Score**, and—crucially—emit **per-lot action
lists** so the score is never just a number. Sourcing is driven off the same engine: we already
hold our own sold line-items, so we can target **proven demand we're out of** and **score a
prospective job-lot before buying it**.

---

## 1. Data sources, freshness, and the gotchas

| Source table | What it gives | Freshness (2026-06-13) | Notes / gotchas |
|---|---|---|---|
| `bricqer_inventory_snapshot` | Current stock: lot, qty, `bricqer_price`, condition, `color_name`, `storage_location` | **STALE — last `synced_at` 2026-05-02 (42 days)** | Refresh = Bricqer API job (§6). **Always filter `quantity > 0`** — it retains zero-qty lots. Colour ids are Bricqer/BrickOwl scheme, **not** BL. |
| `bricklink_part_price_cache` | BL 6-month avg price + market STR, per `(part_number, colour_id)` × condition | **FRESH — newest `fetched_at` 2026-06-10**, 35,997 rows | STR is stored as `times_sold/stock_available × 100` (Bricqer-style ratio, **max seen 1,100**, median 34.5). `price_*` / `str_*` columns store **`0` for "no data"** — treat `0` and `NULL` distinctly (see below). Only `_new`/`_used` columns exist (no generic `times_sold`). |
| `minifig_price_cache` | Terapeak avg sold, STR, sold/active counts, per `bricklink_id` | TTL'd (6mo) | Minifig velocity + price source. |
| `order_items` + `platform_orders` | **Our own** sold line-items (BL 7,088 / BO 791 / Amazon sets) | **FRESH — to today** | The realized-velocity goldmine. **Gotchas:** `item_type` casing varies by platform (`PART` vs `Part`) → always `upper(item_type)`. Colour ids are **BL scheme** for the bricklink platform. |
| `bricklink_transactions` / `brickowl_transactions` | Order headers (totals, lots, dates) | Incremental sync | Order-level economics; line items live in `order_items`. |
| `sales` / `sale_items` | Realised gross profit (has `cost_of_goods`, `gross_profit` generated cols) | — | Only place with realised margin; part-level COG is otherwise absent (see §2 Margin). |
| `inventory_weekly_snapshots` | Weekly cohort STR / value / velocity per platform | Cron | Trend backbone for reporting (§7). |

### 1.1 The canonical join keys (validated, anchored on the snapshot)

Part numbers are the **same BrickLink catalog scheme** in all three tables. Colour ids are **not**
uniform, so the engine anchors on the snapshot and uses a *different* colour key per join:

> **snapshot → BL cache: `(part_number, color_id)`.** The `bricklink_part_price_cache.colour_id`
> shares the snapshot's Bricqer/BrickOwl colour scheme (its `colour_name` column is sparsely
> populated — only ~81 distinct names). Validation: colour-**id** join matched **16,013 lots /
> £12,296**; colour-**name** join only **3,366 / £5,273**. So here, colour-**id** wins.
>
> **snapshot → our sales (`order_items`): `(item_number, lower(trim(color_name)), condition)`.**
> `order_items` (bricklink) uses BL colour ids (Black = 11) which differ from the snapshot's
> (Black = 3), but both carry BL's American colour **names**. Validation: colour-**name** join
> matched **1,798/2,181 (82%)** sold combos vs **80** by colour-id. So here, colour-**name** wins.

The mistake to avoid is assuming one key works for both. The `order_items.item_type` casing also
varies by platform (`PART` vs `Part`) — always `upper(item_type)`. (For the job-lot evaluator,
which gets BL colour ids from a BSX, we bridge BL-id → name (from our BL `order_items`) → Bricqer-id
(from the snapshot) → cache.)

### 1.2 The `0` vs `NULL` rule for the cache

- `str_used = NULL` → **never fetched** → *unknown velocity* (candidate for enrichment).
- `str_used = 0` → fetched, **0 market sales in 6 months** → *real "dead/commodity-glut" signal*.
- `str_used > 0` → usable market velocity.

Never collapse `NULL` and `0` — one is a blind spot, the other is a finding.

---

## 2. The Store Quality Score — six dimensions

Each dimension produces a **0–100 sub-score** from cached data, plus **per-lot flags** that feed
the action lists (§4). The composite is a weighted blend. Weights below are the recommended
starting point (tune after the first run).

| # | Dimension | Weight | Core question | Cached signal |
|---|---|---:|---|---|
| 1 | **Velocity** | 30% | Is stock actually selling? | Realized sales (`order_items`, primary) + market STR (cache, secondary) |
| 2 | **Margin / price position** | 20% | Are we priced to make money, not just to move? | `bricqer_price` ÷ 6-month avg; realized `gross_profit` |
| 3 | **Picking efficiency** | 25% | How much value per pick / per location? | Lot-value distribution, sub-floor tail, lots-per-location, grind-order exposure |
| 4 | **Ageing** | 10% | Are we sitting on dead weight? | Realized "last sold" recency per part; never-sold-and-old |
| 5 | **Coverage** | 10% | How much of the store can we even measure? | % lots/value with a usable price + velocity reading |
| 6 | **Data freshness** | 5% | Is the snapshot recent enough to trust? | `max(synced_at)` age gate |

### 2.1 Velocity (30%) — realized first, market second

Picking effort and "quality of sales" both hinge on velocity, so it carries the most weight.

- **Primary — our realized velocity** (no API): from `order_items` (BL+BO, `upper(item_type)='PART'`),
  compute per `(item_number, color_name, condition)`:
  - `units_180d`, `orders_180d`, `last_sold_at`.
  - **Realized sell-through** = `units_180d ÷ current_qty` (join to snapshot by name key).
  - **Days-of-cover** = `current_qty ÷ (units_180d / 180)`.
- **Secondary — market STR** (cache): the Bricqer-style ratio. Use Bricqer's own brackets so the
  score agrees with how the store is auto-priced: `≥1.0 hot`, `0.5–1.0 good`, `0.25–0.5 slow`,
  `<0.25 dead`, `0 = glut`, `NULL = unknown`.
- **Lot velocity class** (drives actions):
  - `MOVER` — sold by us in 180d, healthy days-of-cover.
  - `OVERSTOCK` — sold, but days-of-cover > 365 (too many of a slow part).
  - `MARKET-ONLY` — never sold by us, but market STR ≥ 0.5 (should sell — check price/visibility).
  - `DEAD` — never sold by us **and** market STR = 0 (or very low).
  - `BLIND` — never sold by us **and** market STR NULL (enrichment candidate).

> Sub-score = value-weighted share of stock in `MOVER`/good-market classes, penalised by
> `OVERSTOCK` + `DEAD` value share.

### 2.2 Margin / price position (20%)

On BrickLink our structural margin is already high (financial model: BL variable margin ≈ 70%,
COG ≤ 15%) because parts come from cheap job-lots — so the lever is **not** margin-% per lot but
**where we sit vs the market** and **realised order economics**.

- **Price position** = `bricqer_price ÷ 6-month-avg` (cache, condition-matched, `avg > 0` only):
  - `<0.70` under-market (leaving money on the table — likely the auto-pricer's low-STR ×0.90 band),
  - `0.70–0.95` keen, `0.95–1.15` at-market, `1.15–1.50` premium, `>1.50` over-priced (won't sell).
- **Realised margin** (where available): `sales.gross_profit / sale_amount` for BL/BO, as a
  store-level reality check.
- **Known gap:** the Bricqer snapshot carries **no per-lot COG** (cost lives in `inventory_items`/
  `purchases`, populated from job-lot allocations). Per-lot margin% is therefore *not* cached-computable
  today. The framework uses **price-position as the margin proxy** and reports realised margin at
  store level. Wiring per-lot COG is a future enhancement (link snapshot → purchases), not a blocker.

> Sub-score = value-weighted share priced `0.85–1.30` of market (healthy), penalised by `>1.5`
> (stuck-high) and `<0.7` (under-priced) tails.

### 2.3 Picking efficiency (25%) — the "lower picking effort" goal

This is where £-per-pick lives. Same weight class as velocity because it's an explicit goal.

- **Avg value per lot** (= list value ÷ lots) — higher is fewer picks per £.
- **Sub-floor tail share** — % of **lots** priced below the live 4p floor (£0.0399, v4 2026-07-17) and in the 4–10p band.
  These are the picks that cost as much effort as a £2 lot for a fraction of the money.
- **Lots-per-location** — `lots ÷ distinct storage_location`; a picking-density proxy.
- **Grind-order exposure** — from order history, % of picks consumed by `<£10`, `≥10-lot` orders
  (baseline: 14.2% of picks for 3.9% of revenue — see `bl-price-floor` memory).
- **Effort-weighted velocity** — flag `LOW-YIELD PICK` lots: `bricqer_price < 10p` **and**
  `velocity = MOVER` (selling, but each sale is a near-free pick) → candidates for combine/bulk-lot
  re-listing rather than culling (culling damages the auto-buy coverage moat — see §4).

> Sub-score = blend of avg-value-per-lot (vs target), inverse sub-floor share, and inverse
> grind-pick share.

### 2.4 Ageing (10%)

- **Recency** = days since `last_sold_at` for the part (from `order_items`), bucketed
  (`<30 / 30–90 / 90–180 / 180–365 / never`).
- **Stale-and-dead** = never sold by us **and** in stock since before a cutoff. (True lot age needs
  `purchase_id`→`purchases.purchase_date`; the snapshot lacks a per-lot added-date. Until linked,
  use "never sold by us + market STR ≤ 0" as the dead-weight proxy.)

> Sub-score = inverse value-share of `stale-and-dead`.

### 2.5 Coverage (10%) — honesty dimension

Because the data stance is cached-only, the score **must** state what it cannot see.

- **Price coverage** = value-share of lots with a usable (>0) condition-matched 6-month avg.
- **Velocity coverage** = value-share with *either* a realized sale *or* a non-NULL market STR.
- The report prints both, and lists the **biggest blind lots** (high `qty×price`, NULL STR, no
  realized sale) as the enrichment shortlist (§6).

> Sub-score = min(price-coverage, velocity-coverage). You can't claim quality on stock you can't measure.

### 2.6 Data freshness (5%)

- `age = now − max(synced_at)`. Linear penalty: 100 at ≤7 days → 0 at ≥45 days.
- **Hard gate:** if `age > 30 days`, the report prints a red banner and labels every absolute
  figure "as of <date>, STALE — refresh recommended (§6)". (Today it would fire: 42 days.)

---

## 3. The CLI scorecard — `store-quality.ts` (build spec)

A single committed script (sits with the other analysis scripts, but *committed* and documented,
not a `_`-prefixed throwaway). Cached-only; **makes zero external API calls.**

```
npm run store-quality            # full scorecard, parts + minifigs
  --segment parts|minifigs|all   # default all
  --top 25                       # rows per action list
  --json out.json                # machine-readable dump (for dashboard/email reuse)
  --max-age-days 30              # freshness gate (default 30)
```

**Output sections:**

1. **Header** — snapshot date + age banner; lots / pieces / list value in scope.
2. **Store Quality Score** — composite 0–100 + the six sub-scores as a bar list.
3. **Velocity profile** — value distribution across `MOVER / OVERSTOCK / MARKET-ONLY / DEAD / BLIND`.
4. **Price-position profile** — value distribution across the market-ratio bands.
5. **Picking profile** — avg £/lot, sub-floor tail %, lots/location, grind-pick %.
6. **Coverage** — price & velocity coverage %, and the top blind lots.
7. **Action lists** (the point of the whole thing — see §4), each capped at `--top`.
8. **One-line deltas** vs the previous run (persist each run's summary to `store_quality_runs`
   so trend + email/dashboard reuse comes free).

The composite, sub-scores, and per-lot flags are computed in a **reusable module**
(`lib/store-quality/`) so the dashboard page and weekly email (later) call the same engine.

---

## 4. The action playbook — what each flag triggers

The score is a thermostat; these are the actions. Each is a line in a `--top N` list with the
lots named, so it's directly workable.

| Flag | Meaning | Action |
|---|---|---|
| `STUCK-HIGH` | price ÷ 6mo-avg > 1.5, not sold in 180d | Re-price toward market (or comment-lock if deliberately held). |
| `UNDER-PRICED` | price ÷ 6mo-avg < 0.7, market STR ≥ 0.5 | Nudge up — auto-pricer's low-STR band is underselling a part that moves. |
| `OVERSTOCK` | days-of-cover > 365 | Stop re-sourcing it; consider bulk-lot/relist; lower priority for shelf space. |
| `DEAD` | never sold by us + market STR ≤ 0 | Quarantine list — don't re-source; bundle into mixed bulk lots. **Do not mass-cull cheap lots** (kills auto-buy coverage moat — `bl-price-floor` decision). |
| `LOW-YIELD PICK` | < 10p + MOVER | Combine into multi-qty lots / bulk packs to cut picks-per-order; the 4p floor already lifts these. |
| `BLIND-HIGH-VALUE` | NULL STR, high `qty×price` | Top of the §6 enrichment shortlist. |
| `DEMAND-GAP` | sold ≥ N times in 180d, now 0 stock | Feed the §5 sourcing target list. |

Each action list is **idempotent and re-runnable**, so this becomes a weekly hygiene loop, not a
one-off.

---

## 5. Sourcing (semi-automated) — the two chosen channels

### 5.1 Demand-gap buyer (`source-demand-gaps.ts`)

Turn our own sales history into a shopping list of **proven demand we're out of**.

- **Input:** `order_items` BL+BO parts/minifigs over a window (default 180d), joined to current
  snapshot by the name key (§1.1).
- **Signal:** combos with `units_sold ≥ threshold` **and** `current_qty = 0` (or below a
  reorder point). Today: **645** part+colour combos sold in 180d are at zero stock.
- **Enrich (cached):** attach 6-month avg price + market STR from cache so each target carries an
  expected resale value and liquidity.
- **Output:** a ranked **wanted-list seed** (CSV / BrickLink-wanted-list XML) — "re-source these,
  in priority order, up to this price." Semi-automated: you review, then it can hand off to the
  existing `bl-basket` flow or a BrickLink wanted list.
- **Calibration note:** part demand is long-tailed — `orders ≥ 3 in 180d` returned **0**, so the
  reorder trigger should be **units-based** (e.g. `units_sold ≥ 2`) or value-weighted, not
  "≥3 separate orders".
- **Caveat:** "zero stock" is as-of the snapshot date — sharpen with a §6 refresh before acting.

### 5.2 Job-lot evaluator (`evaluate-job-lot.ts`)

Score a prospective bulk lot (Vinted / eBay / BL) for part-out quality **before buying**, cached-only.

- **Input:** a parts manifest — ideally a BrickStore `.bsx` / wanted-list export, or a set number
  whose inventory we expand (the existing `_analyze-bsx-listing-value.ts` already values a `.bsx`
  via the Bricqer formula; this generalises and reuses it).
- **Per-part (cached):** 6-month avg price + market STR + our realized velocity for that part.
- **Lot-level outputs:**
  - **Expected list value** (Bricqer multiplier × 6mo-avg, the canonical formula).
  - **Liquidity mix** — % of value in `MOVER`/good-STR vs `DEAD`/`BLIND` parts → how much is
    *sellable* vs shelf-filler.
  - **Picking drag** — projected lot count, % sub-10p lots, est. picks per £.
  - **Margin headroom** — expected list value ÷ asking price → buy / pass threshold.
- **Verdict line:** `BUY @ ≤ £X / PASS`, with the liquidity + picking-drag caveats spelled out, so
  the long-tail "looks valuable but is unsellable filler" lot gets caught.

Both tools are **cached-only**; live BL price-guide top-ups for unknown parts are an *opt-in*
enrichment (§6), never automatic.

---

## 6. Opt-in enrichment protocol (the only thing that hits external APIs)

Two distinct jobs, each **only run on your explicit approval, with a quota estimate first.**

1. **Snapshot refresh (Bricqer).** The inventory side is 42 days stale. Refresh re-syncs
   `bricqer_inventory_snapshot`. Cost: ~260 pages @ ~100 req/min ≈ **3 min of Bricqer API time**
   (well within limits). Trigger: the existing Bricqer sync path. *Recommended before any sourcing
   action.*
2. **STR / price fill (BrickLink).** Populate the velocity blind spots — the `BLIND-HIGH-VALUE`
   shortlist from §2.5/§4. Reuses `enrichment.service.ts` (already rate-limited to BL's 5,000/day,
   and the `bricqer-bl-api-base-load` memory says assume **~1,500/day usable headroom** after
   Bricqer's own load). The scorecard prints the shortlist **with a call-count estimate** ("fill
   the top 400 blind lots ≈ 400 calls ≈ ~27% of daily headroom") so you approve a bounded batch.

Rule: the scorecard and sourcing tools **never** call these themselves. They print the shortlist +
the estimate and stop. You say go.

---

## 7. Reporting cadence

- **On-demand:** `npm run store-quality` whenever (the CLI is the primary deliverable).
- **Weekly trend:** persist each run to `store_quality_runs`; `inventory_weekly_snapshots` already
  tracks cohort STR/value so the weekly delta is cheap. (Optional later: the chosen-but-deferred
  weekly email digest reuses the `--json` output + the existing `send-email` path.)
- **Pre-sourcing:** run a snapshot refresh (§6.1) → scorecard → demand-gap list, as a standard
  buying-prep ritual.

---

## 8. Data-quality cookbook (carry into every query)

1. Join parts on `(item_number, lower(trim(color_name)), condition)` — **never `color_id`**.
2. Always `quantity > 0` on the snapshot (zero-qty ghosts present).
3. `upper(item_type) = 'PART'` / `'MINIFIG'` — platform casing is inconsistent (`PART` vs `Part`).
4. Cache `price_*`/`str_*`: `0` = "no data", `NULL` = "never fetched" — keep them separate.
5. Market STR is `times_sold/stock_available × 100` (ratio scale, can exceed 100), and is
   **market-wide**, not store-specific — treat as liquidity, not our velocity.
6. Surface the snapshot date on every absolute figure; gate at 30 days.

---

## 9. Calibration baseline (2026-06-13, cached reads)

**In-scope composition (`quantity > 0`):**
- Parts: **21,225 lots / 49,990 pieces / £13,340** list value (82%).
- Minifigs: **914 lots / £2,668** list value (16%). (Sets £222 excluded.)

**Picking-effort tail (parts):**
- Sub-10p: **7,850 lots (37% of part lots)** but only **£1,168 (8.8% of value)** — the pick drag.
- £2+: **613 lots (2.9%)** hold **£4,384 (33% of value)** — the value core.
- Storage: ~859 distinct locations, **0 lots missing a location**.

**Coverage:**
- 6-month avg price: usable (>0) for the mid/high-value bands (≈90%+ of lots in 25p+ bands);
  sparse in the sub-10p tail (~50%).
- Market STR: only **2,344 cache rows** have a *positive* used STR; 6,071 are real zeros (dead),
  27,582 NULL (unfetched) → market velocity is the genuine blind spot.

**Our realized velocity (no API, 180d, BL+BO parts):**
- **2,181** part+colour combos sold, **6,266 units**; **1,798 (82%) matched** to stock by name key.
- **1,536** still in stock; **645** at zero stock = demand-gap re-source candidates.

**Freshness:** snapshot **42 days stale** (2026-05-02); BL price cache fresh (2026-06-10).

---

## 10. Build roadmap

| Phase | Deliverable | Status |
|---|---|---|
| P0 | `lib/store-quality/` engine: join model, six sub-scores, per-lot flags | ✅ shipped (`engine.ts`, `pricing.ts`, `types.ts`, `format.ts`) |
| P1 | `store-quality.ts` CLI (§3) | ✅ shipped — cached-only headline deliverable |
| P2 | `store_quality_runs` persistence + run-over-run deltas | ✅ shipped (migration `20260614120000`) |
| P3 | `source-demand-gaps.ts` (§5.1) | ✅ shipped — ranks by realized value, CSV seed |
| P4 | `evaluate-job-lot.ts` (§5.2) | ✅ shipped — BSX/CSV, colour bridge, BUY/PASS |
| P5 (opt-in) | `refresh-bricqer-snapshot.ts` + `enrich-store-quality.ts` (§6) | ✅ shipped — refresh run once; STR-fill is estimate-then-`--run` |
| later | Dashboard page / weekly email reusing the engine | deferred per scope (engine is reusable) |

**Snapshot refresh done (2026-06-14):** the 42-day-stale snapshot was refreshed before validating,
so P3/P4 run on current stock. Post-refresh, in-scope stock is **20,628 lots / £15,919** (19,929
parts, 699 minifigs). Corrected headline figures: **composite 46.4/100**, velocity coverage **71%**,
price coverage **13%**, and — the load-bearing signal — **DEAD + OVERSTOCK stock is ~60% of list
value** (DEAD alone 55%). The cheap sub-10p tail is 37% of lots / 8% of value.

**Validation (workflow `validate-store-quality.js`):** five independent agents re-derived the
scorecard from live SQL. They caught a real bug — `loadBLCache` fetched the price cache with
`.in(part_numbers)` batches but no `.range()`, so a part's many colour rows overflowed Supabase's
1,000-row cap and ~6,500 cache rows were dropped, mis-binning genuinely-DEAD stock as BLIND and
flattering the score (composite read 49.9, velocity coverage 49%). After paginating both cache
loaders, a re-verification reproduced every corrected figure to 6 d.p. **All six dimensions PASS.**
The fix legitimately *lowered* the score because it surfaced the real dead-stock weight — the §6.2
STR-fill remains the lever for the 29%-of-value still BLIND (genuinely never-enriched stock).
</content>
</invoke>
