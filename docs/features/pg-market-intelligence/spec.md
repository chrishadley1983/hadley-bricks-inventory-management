# BrickLink Market Intelligence Platform — Productionisation Specification

**Status:** Draft v2 · 2026-07-08
**Author:** Claude (session with Chris), from the 2026-07-07 POC
**Working name:** *BrickRadar* (placeholder)
**v2 changes:** refresh strategy rebuilt around measured lane throughput (D: ~1,400 pages/day demonstrated, not 250/night); lane A corrected to real ~1,500/day headroom (Bricqer consumes the rest); Hot/Warm/Cold weekly tiering replaced by a 28-day ranked rolling cycle with UK-grade detail on the active 60k; standing UK verification queue replaced by on-demand live checks; P3 rewritten to a central shared cache with **no tenant credentials**; new-release grace rule added to the ranking cut.

---

## 1. Vision

Turn the one-night POC — a 111k-tuple worldwide BrickLink price-guide cache with dual-cache store triage — into a durable, self-refreshing market-intelligence platform that:

1. **Runs Hadley Bricks daily** (store sourcing, part-out decisions, fig pricing, own-store audits), and
2. **Productises for other BL sellers** — a centrally maintained shared cache consumed by tenants, so one acquisition pipeline serves every user (see §2.3).

### What the POC proved (2026-07-07)

| Capability | Evidence |
|---|---|
| Full-catalog worldwide coverage is a hours-scale job | 111,790 tuples (92,938 part×colour + 18,852 minifigs = 99.3% of BL's fig catalog), £36.4M of 6-mo sales tracked, built in one evening |
| Store triage collapses from days to seconds | Jabbz (6,879 lots): 5s scoring vs ~14h of scraping; 140-lot buy list, £614 ask → £280 projected net |
| Worldwide data is safe for screening | UK/world price ratio median 1.11 on commons (worldwide is conservative); danger zone = new licensed printed parts (Messi −35%) |
| The "unfetchable" tail is plumbing, not market absence | 10/10 residual tuples had data via the lightweight endpoint (set `-1` suffix, alias part numbers) |
| Gap-fill flywheel works | Store scan → auto gap BSX → one BrickStore refresh → permanent layer growth |
| **Paced page-scrape throughput is ~1,400/day, not ~250** | 1,387 catalogPG pages in ~6h (Gibbo0o scan + Insider four-set STR check), 4–6s jitter on domham91; 403s at ~430/session, breather+resume recovered every time; cache = resume mechanism, blocks cost time not data |
| Gap-fill demand decays fast | Jabbz scan at day 1 of the cache: only 244/6,355 tuples (~4%) uncovered |

---

## 2. Architecture

### 2.1 Data layers

```
┌─────────────────────────────────────────────────────────────────┐
│ L1  WORLDWIDE SUMMARY  (bricklink_pg_summary_cache)             │
│     All quadrants (sold6m/stock × N/U), GBP, STR generated.     │
│     Universe: BL-native catalog (parts×colour codes + figs +    │
│     sets). Sources: batch API (BrickStore token) > summary      │
│     endpoint (anon curl) — per-row `source` provenance.         │
├─────────────────────────────────────────────────────────────────┤
│ L2  SNAPSHOT HISTORY  (bricklink_pg_snapshots)  [NEW]           │
│     Written on the 28-day refresh cycle → clean monthly deltas  │
│     per active tuple. Powers velocity/trend alerts.             │
│     Retention: 24 mo, then quarterly compaction.                │
├─────────────────────────────────────────────────────────────────┤
│ L3  UK DETAIL  (bricklink_price_guide_cache — exists, PR #514)  │
│     UK-seller-filtered 6MA + monthly buckets + median.          │
│     PRIMARY fill: lane D 28-day rolling cycle over the active   │
│     60k (this is the headline change from v1 — UK detail is    │
│     standard for active tuples, not an exception). Live checks  │
│     via lane A/D top it up at decision time.                    │
├─────────────────────────────────────────────────────────────────┤
│ L4  SET LAYER  (bricklink_part_out_value_cache — exists)        │
│     POV / sealed-set values. Join into all scorers.             │
└─────────────────────────────────────────────────────────────────┘
```

**Rule of use:** screening may run on any layer; **a buy decision gets a live check** (lane A official, or lane D page when velocity detail is wanted) regardless of cache age. Every report labels its price source and its age.

**Type beats freshness for triage (2026-07-08, Chris):** downstream consumers care about data TYPE (UK detail vs worldwide summary) and staleness — never the lane that produced a row. Stale-but-UK beats fresh-but-worldwide for pricing, so L3 reads use a **45-day window** (not a short TTL): the 28-day cycle keeps active tuples well inside it, and the mandatory buy-time live check absorbs residual staleness risk. If the digest's freshness ratio slips, the window inherits the problem — that ratio is the health metric to watch.

### 2.2 Acquisition lanes

| Lane | Auth | Measured/known budget | Role |
|---|---|---|---|
| **A. BL store API price guide** (`country_code=UK`) | Own store API creds | 5,000 calls/day nominal, **~1,500/day real headroom** — Bricqer consumes the rest (see `bricqer-bl-api-base-load`); ~2 calls/tuple | **Live checks** at buy/analysis time: official, instant, quota-cheap. NOT a bulk lane at Hadley scale |
| **B. Batch affiliate API via BrickStore token** | Per-user token, issued on a **secondary account** (never the selling account) | Batched; fastest bulk; fortnightly ~15-min manual harvest ritual | **Tail refresh**: ~45k low-activity tuples on a 90-day cycle ≈ ~7k tuples per fortnightly ritual. Hadley-internal only (§7.1). The manual step is an accepted design feature, documented so it isn't Chris-only |
| **C. `priceGuideSummary.asp` (anon curl)** | None — zero account risk | **Never actually blocked** (2026-07-08 correction): the 2026-07-07 "challenges" were a parser gap — BL omits condition rows with no activity and the POC parser misread those pages as blocks. Healthy rate ~8–10 req/min at 4–6s jitter; true ceiling still untested (keep small sessions + breathers until measured) | **Elastic insurance**: build-phase gap fills, new-release first fetch, Event-tier top-ups during scans, overflow if lane D misses. Keep identity discipline as precaution (separate exit IP from same-day lane D where practical). Steady-state usage decays to ~tens/day (§4.5) |
| **D. catalogPG page engine** (exists, PR #514) | domham91 (dedicated UK buyer acct, GBP display) via CDP Chrome | **~1,387 pages/6h demonstrated** (2026-07-07); 403s at ~430/session; design budget 350 pages/session + 20-min breathers, ~6 sessions/night ≈ 2,150 | **The primary refresh engine**: 28-day rolling cycle over the active 60k with UK-grade detail. Second VPN-routed lane (port 9223 profile — setup outstanding) held as headroom |
| **E. Catalog downloads** (`catalogDownload.asp`) | Any logged-in account | One POST per file; sanctioned | Universe definition + monthly new-release diff, run ~7th–10th to catch each month's release wave |

**Provenance is mandatory:** every L1/L3 row records `source`, fetch identity class, currency basis and (for converted rows) the FX rate used. Currency validation happens **at ingest** (the USD-blobs incident must be structurally impossible, not just fixed).

**Account separation:** the selling account appears in NO bulk lane. Lane B token on a secondary account; lane D on domham91; lane C anonymous. Blast radius of any BL objection is a disposable identity, never the store.

### 2.3 Multi-tenant shape (product phase) — central cache, no tenant credentials

- **One centrally maintained L1/L2/L3** operated by Hadley. Market data is not tenant-specific and its acquisition cost does not scale with users: the universe is ~111k tuples whether there is 1 customer or 50. Tenants bring **no BL credentials** — no BYO-creds onboarding, no per-tenant quota governor, no per-tenant ToS exposure. (v1's "tenants contribute idle quota" model is dropped: target customers' API quotas are consumed by their own tooling — Bricqer, BrickSync — exactly as ours is.)
- **What does scale with tenants:** Event-tier and live-check demand (every tenant store scan wants gap fills and buy-time checks). Lane C absorbs gap fills; live checks are rationed per tenant or routed through lane D page fetches.
- **Supply-chain framing:** with tenant credentials gone, Hadley's lanes ARE the product's data pipeline. The fortnightly ritual must be documented and transferable; the BrickStore token becomes an availability dependency; lane D block-rate telemetry becomes an SLA input. P3 must own this explicitly.
- **Tenant-scoped:** store scans, reports, watchlists, own-store audits, display currency/VAT basis.

---

## 3. Functionality (F-criteria)

### F1 — Coverage engine (promote POC scripts to a service)
- `pg-coverage` CLI/worker: universe build (E-lane downloads → ranked queue), delta detection, acquisition via lanes B/C/D with automatic fallback (batch API → curl for resolution failures — the `-1` suffix and alias-number fixes from the POC are in-code, not manual).
- BSX generator retained as the manual-assist path for the fortnightly lane B ritual.
- Idempotent, resumable, provenance-stamped. Target: rebuild-from-nothing ≤ 48h.

### F2 — Refresh engine
See §4. Ranked 28-day rolling cycle (lane D), tail rotation (lane B), snapshot writer, new-release grace rule.

### F3 — Store triage (`store-scan` v2)
- Inventory scrape (existing AJAX path; page cap raised, size pre-check via store front).
- Dual-cache scoring (L1+L3+L4 joins — sets included), Bricqer pricing, fee model per exit channel.
- Auto gap-fill: uncovered tuples → lane C immediately (≤300) or BSX/queued batch (larger).
- Output: triage report (§5.1) in ≤10 min for a 20k-lot store; buy candidates flagged for live check before basket build.

### F4 — Set intelligence
- `set-str-check` (exists as `_str-check-set-pg.ts`): promote; L3 is now the default data grade for active tuples, live check upgrades at decision time.
- Liquidity-adjusted POV: `realisable_pov = Σ qty × price × f(STR)` (capture-curve f calibrated from our own sales history) alongside gross POV, for every set in the hitlist. Feeds BIN watcher + set-buy-check verdicts.

### F5 — Sourcing screens (the "coverage dividend")
- **High-STR screen:** SQL views over L1/L3 (STR ≥ threshold × price ≥ floor × demand rank), refreshed nightly → buy-target lists for part sourcing.
- **Fig radar:** same over M-tuples; new/used spread flags (fig arbitrage: used fig price vs part-out of its components).
- **Trend alerts (needs L2):** MoM sold-qty deltas by part/theme/category; alert on >x% acceleration. The 28-day cycle produces clean monthly deltas by construction.

### F6 — Own-store audit
- Join tenant's live inventory (Bricqer export or BL store API) against L1/L3: flag overpriced-vs-velocity, underpriced-vs-UK, dead stock (months-of-stock vs our qty), missing high-STR restock candidates.

### F7 — Live check service (replaces v1's standing UK verification queue)
- On-demand fresh UK price for a tuple at buy/analysis time: lane A (official API, instant) by default; lane D page fetch when monthly velocity detail is wanted. Writes through to L3.
- Callers: bl-basket, store-scan buy candidates, set-buy-check, screens' "verify before acting" links. Budgeted well inside lane A's ~1,500/day headroom.

### F8 — Tenant management (product phase)
- No credential vault needed (§2.3). Tenant onboarding = account + billing + scan targets. Per-tenant live-check rationing. Data-sharing is one-way: tenants consume the shared cache; nothing store-identifying is ever published.

---

## 4. Production refresh strategy

### 4.1 The active cycle (headline design)

**Top ~60k tuples by activity get UK-grade detail (L3) on a 28-day rolling cycle via lane D.** Prices are stable at the weeks scale — 6-month averages barely move week to week — so v1's 7-day Hot tier was over-engineered churn. Staleness risk at the moment it matters is covered by the live check (F7), not by faster polling.

| Layer | Tuples | Cycle | Lane | Volume |
|---|---:|---|---|---:|
| **Active universe** (ranked top ~60k, UK-grade detail) | ~60k | 28d | D | ~15k pages/week ≈ 2,150/night |
| **Tail** (worldwide summary) | ~45k | ~90d | B | ~7k per fortnightly ritual |
| **Gap fill** (uncovered tuples a scan touches) | demand | immediate | C | build-phase heavy → decays to ~tens/day |
| **Live check** (buy decisions, analysis) | demand | at decision time | A (or D page) | inside A's ~1,500/day headroom |
| **Universe diff** (new parts/figs/colours/sets) | ~1–3k/mo | monthly, ~7th–10th | E | one POST per file |

**The ranking cut** (defines the active 60k, recomputed monthly from L1):
- Rank by 6-month sold value; take the top ~60k.
- **Floors that override rank:** any tuple on a watchlist/buy list; any tuple in our own inventory.
- **New-release grace rule:** tuples entering via the lane E diff join the active cycle automatically for their **first 6 months**, regardless of rank — they have no sales history yet, so value-ranking would systematically blind the platform to the highest-opportunity segment (new-set part-outs) for half a year. After two quarters they rank on their own data.
- New entries also get a **first fetch via lane C within days** of the diff (a release month is ~1–3k tuples — a couple of nights of curl), so they exist in L1 immediately rather than waiting for their first lane D slot.

### 4.2 Lane D throughput plan (evidence-based)

- **Demonstrated:** 1,387 pages in ~6h (2026-07-07) at 4–6s jitter, with 403s at ~430/session recovered by breather+resume.
- **Design:** ~6 sessions × 350 pages per night (00:00–07:00), 20-minute breathers between sessions ≈ 2,150 pages/night. The breather is scheduled at 350 — deliberately **below** the observed ~430 block point: BL's 403 must not be the pacemaker. Looking like a patient human costs ~15% throughput and is the price of multi-year sustainability.
- **Honest flag:** 15k/week is ~55% above the single-day demonstration. It fits the window's theoretical capacity (~8 sessions) but eats most of the headroom. Mitigations, in order: (1) block-rate telemetry watched from night one; (2) second VPN-routed domham91 Chrome profile (port 9223 — setup outstanding, see `bl-pg-page-scrape-uk-6ma`) graduates from reserve to active if week one shows strain; (3) fallback to 12k/week = 35-day cycle, which by the price-stability argument costs nothing.

### 4.3 Snapshots (L2)
- Write-on-refresh: each lane D pass writes the tuple's snapshot row → clean monthly deltas per active tuple by construction. Tail tuples snapshot on their ~90d lane B rotation. Compaction after 24 months → quarterly.

### 4.4 Failure & rate discipline
- Per-lane circuit breakers (the POC's 3-consecutive-failure abort, backoff, block-signal pause) centralised in one fetch wrapper.
- **Lane D specifics:** 403 → 30-min backoff, resume from cache. Two consecutive nights missing the cycle target → the top slice of the active set (watchlist/buy-list/own-inventory tuples) overflows to lanes C and A so decision-relevant data never goes silently stale.
- **Block-rate trend telemetry:** sessions-to-first-403 tracked nightly. One day of tolerance is proven; year two is not — if the trend tightens over weeks, throttle down proactively. This is the standing answer to "we measured one day, not one year".
- Golden-tuple canary set (~20 tuples incl. 3001/c11) fetched via every active lane daily; alert on divergence >5% between lanes (catches parse drift, FX drift, BL format changes — the defence against "BrickStore data can't be trusted" ever recurring silently).
- All jobs resumable via the cache; no job may hold >15 min of unflushed work (POC lesson: flush batches of ≤50).

### 4.5 Gap-fill decay (why lane C is insurance, not workload)
Event demand shrinks as coverage completes: Jabbz at cache day 1 was already only ~4% uncovered. Steady-state residue = the new-release window (closed within days by the E→C handoff), the oddball tail (alias numbers, old combos missing from the codes file — fetched once, cached forever), and `no_data` items (flagged on first fetch, never re-triggered). Expect a few dozen fetches per scan, not hundreds.

### 4.6 Scheduling (Hadley phase)
- **Nightly 00:00–07:00 (local bot, unattended):** lane D sessions → lane C event/residual queue → screens/report generation. Lane A live checks run on demand around the clock. **Prefer separate exit IPs for lanes C and D on the same day** — precautionary hygiene, downgraded from a hard rule (2026-07-08): the "per-IP challenge" evidence turned out to be a parser gap, not a block, so there is currently NO observed cross-lane IP contagion. Routing lane D through the VPN'd profile still keeps identities clean and is worth finishing.
- **Fortnightly (~15 min, the one manual step):** BrickStore ritual on the secondary-account token — harvest ~7k tail tuples. Documented well enough that it isn't Chris-only.
- **Monthly (~7th–10th):** lane E catalog grab + diff → new tuples to lane C first-fetch + active-cycle grace list.
- **Quarterly:** UK↔worldwide divergence re-run (one SQL query off L2/L3); first: 2026-10.

---

## 5. Output reporting

### 5.1 Store triage report (per scan; markdown + web)
Coverage split (UK/world/uncovered with source labels + data age) · buy candidates table (ask, list, STR, margin, profit, source, **live-checked flag**) · store quality metrics (velocity-weighted stock, underpricing index vs market) · basket summary (total ask, projected net, ROI) · one-click follow-ups (live-check shortlist, bl-basket handoff).

### 5.2 Set report (per set)
Gross POV vs **liquidity-adjusted POV** · per-lot STR table · quick-win lots (fig/print concentration) · UK vs worldwide gap flag · buy/skip verdict at a given price.

### 5.3 Weekly market digest (scheduled; email/Discord — reuse dashboard pipeline)
Top STR risers/fallers (from L2 monthly deltas) · theme-level trend chart · fig radar movers · own-store audit summary (top 10 reprices, dead-stock candidates) · coverage/freshness health (active-cycle position, lane budgets used, block-rate trend, canary status).

### 5.4 Ops telemetry (internal)
Per-lane request counts vs budget, sessions-to-first-403 trend, parse failures, snapshot completeness. Alert thresholds → Discord.

### 5.5 Product-phase surfaces
Same three reports as tenant-scoped web pages + JSON API; shared (anonymised) market screens as the headline product feature; pipeline-health page (freshness SLA against the central cache).

---

## 6. Phasing

| Phase | Scope | Exit criteria |
|---|---|---|
| **P0 — Harden** (now) | Promote POC scripts (coverage import, dual-cache scan, curl fill, BSX gen) into `apps/web/scripts/pg-*` proper; fix set `-1`/alias handling; POV join in scorer; provenance columns + ingest currency validation; canary job; finish the second-lane VPN Chrome profile | Jabbz-class store E2E ≤10 min with zero manual fixes; all POC `_tmp-*` scripts deleted |
| **P1 — Refresh engine** | Ranked active-cycle queue + scheduler (lane D sessions/breathers), snapshot table, lane B tail rotation import, universe-diff monthly job + new-release grace rule, live-check service (F7), block-rate telemetry | 30 unattended days with ≥95% of the active 60k inside the 28-day cycle; snapshot deltas queryable; block-rate trend flat |
| **P2 — Intelligence** | High-STR/fig screens, liquidity-adjusted POV across hitlist, own-store audit, weekly digest | Digest ships weekly; ≥1 sourcing decision/week made from screens |
| **P3 — Productise** | Multi-tenant schema (no credential vault — central cache model §2.3), tenant onboarding, live-check rationing, web reports, ritual/runbook documentation, pilot with 2–3 friendly BL sellers | Pilot tenants scan their own target stores + get digests with zero Hadley-side manual steps beyond the standing fortnightly ritual |

P0+P1 are ordinary repo feature work (branch → `/define-done` → `/build-feature` per criterion). P3 warrants a separate architectural review (likely its own service/schema, possibly its own repo) — this spec fixes its requirements, not its implementation.

---

## 7. Risks & positioning

1. **BL dependency & ToS.** Blast-radius containment over detection-avoidance: the selling account appears in no bulk lane (lane B token on a secondary account, lane D on domham91, lane C anonymous), so BL objecting to any lane costs a disposable identity, never the store. Gentle-rate discipline centralised; lane diversity (no single point of ban); **product phase requires a proper ToS review and ideally a conversation with BL** — lane B (BrickStore-issued tokens) stays Hadley-internal; product tenants bring no credentials, so they carry no ToS exposure at all.
2. **Tolerance drift.** We measured one day of ~1,400 pages, not a year of it. Block-rate trend telemetry (§4.4) is the tripwire; throttle-down is proactive, not reactive to a ban.
3. **Data drift.** BL page/API format changes break parsers silently → canary set + provenance + alerting (§4.4).
4. **Worldwide↔UK divergence.** Quantified (+11% median, licensed-print exception). Less exposure than v1: the active 60k carry UK-grade data as standard; the flagged category (licensed/printed < 12 mo) still requires a live check before buying. Re-run the divergence study quarterly.
5. **FX basis mixing.** USD-converted vs GBP-native rows coexist → per-row rate stamping validated at ingest; nightly FX refresh; canary cross-checks.
6. **Single-operator supply chain.** With tenant credentials dropped, Hadley's lanes are the whole pipeline: the fortnightly ritual and the domham91/token identities are availability dependencies. Mitigations: runbook documentation (transferable ritual), all state in Supabase (any machine resumes any job), second lane as identity redundancy.
7. **Competitive moat.** The data is reproducible by anyone with the same idea; the moat is the maintained central cache + the decision layer (Bricqer pricing integration, liquidity-adjusted POV, own-store audit) — prioritise those over raw coverage breadth.

---

## 8. Immediate next actions

1. `/define-done` for **P0** (§6 row 1 = its skeleton), branch `feature/pg-coverage-platform-p0`. Include the residual-fill service: resumable queue + curl→API lane rotation on challenge. (2026-07-08 note: the 2026-07-07 Jabbz fill's abort at 43/279 turned out to be a parser gap — omitted condition rows — not a Cloudflare challenge; fixed in the pg-summary parser. The rotation machinery stays: it's the right shape for genuine blocks.)
2. Migration: provenance/ranking columns on L1 + `bricklink_pg_snapshots` table.
3. Finish the second-lane setup: VPN-routed domham91 Chrome profile on CDP port 9223 (currently outstanding — see `bl-pg-page-scrape-uk-6ma`).
4. Start lane D at the design cadence (6 × 350/night) and watch sessions-to-first-403 for the first fortnight before trusting the 28-day cycle maths.
5. Define and materialise the ranking cut (top-60k view + floors + new-release grace list).
6. Live-check the Jabbz 140-lot shortlist = first live run of the F7 service design.
7. Book the quarterly divergence re-run (first: 2026-10).
8. **Scanner identity-ambiguity guard** (found 2026-07-08 Jabbz retro): store lots that are
   variant subsets (advent-day builds `75366-N`, colXX series figs) scrape as the BASE set
   number and inherit the full set's benchmark — 91 lots / £2.3k of phantom margin in one
   scan. Guard: when 2+ distinct lot names resolve to one S-tuple, mark the benchmark
   unusable ("identity ambiguous") instead of scoring; longer-term, recover the true
   variant ID from the store AJAX payload. Same failure family as POV's is_aggregate_listing.
