# Store Assessment — Build Report

**Feature:** Store Assessment scorecard — the "assess" lens of the BL Arbitrage skill
**PR:** #540 · **Commit:** `df42b804` on `main` · **Date:** 2026-07-09
**Status:** Shipped, deployed to production, e2e-validated (PASS on all dimensions)

---

## 1. What this is

A whole-store scorecard that assesses an **external BrickLink seller** as an arbitrage target. It's the second lens of the BL Arbitrage skill — bl-basket already had the *buy* lens (build a purchase cart); this adds the *assess* lens (judge whether a store is worth your time at all). Both share the same store scrape and the same cached price/STR/supply data underneath.

The design principle: **one scrape in, one scorecard out.** The only step that must hit the network live is the initial store scrape — everything used to *judge* the lots (UK price guide, worldwide STR, part-out values, the Bricqer pricing formula) is already cached in Supabase.

---

## 2. The report — sections delivered

All 7 requested, plus 3 extras and a verdict:

| # | Section | What it shows | Data source |
|---|---------|---------------|-------------|
| 0 | **Verdict** | 0–100 Arbitrage Attractiveness grade → BUY / REVIEW / SKIP + headline | composite of below |
| 1 | **Store size & value** | lots, pieces, value; split by Parts/Sets/Minifigs | raw scrape |
| 2 | **Pricing strategy** | value-weighted ask ÷ 6-mo market avg, bucketed UNDER→OVER | scrape × `readPriceGuide` |
| 3 | **Feedback & order rate** | feedback score, positive %, member-since, orders/mo proxy | `StoreFront` + `feedback.asp` |
| 4 | **Part mix** | type × condition matrix, New/Used split, damage-note %, set completeness | raw scrape |
| 5 | **Lots within margin** | buyable lots, outlay, projected net, margin, ROI | Bricqer resale − fees |
| 6 | **High-STR lots** | fast movers (STR ≥ 0.5, lots basis) | scrape × cached STR |
| 7 | **Magnets** | very low supply (≤3 sellers worldwide) **+** decent STR | scrape × `pg_summary` supply |
| 8 | **Data confidence** | % of value with UK data vs world-fallback vs none | coverage flags |
| 9 | **Ageing / motivated-seller** | months-of-cover distribution; flags >50% overstock | scrape × market sold rate |
| 10 | **Concentration** | top-10 lots' share of value; distinct items | raw scrape |

**Magnets** are defined exactly as specified — *very low supply + at least decent STR*: worldwide seller-lots ≤ 3 (from `bricklink_pg_summary_cache`) AND strLots ≥ 0.5, excluding penny junk and damaged lots. The logic: low competition means we can price at/above market and it'll still move.

---

## 3. Architecture

**Combined skill, two lenses, one scrape.** Rather than a bolt-on screen, this rolls into the BL Arbitrage skill:

- **Light mode** (`--light`): scrape → join **caches only**. Seconds. Reuses a fresh `tmp/stores/<slug>/inventory.json` from a prior bl-basket run, so re-assessing a store is instant.
- **Full mode** (`--full`): scrape → live gap-fill UK price guides for the top uncovered high-value lots → richer scorecard.

Typical flow: run light across many candidate stores → run full (or the bl-basket *buy* lens) on the winners.

### Files

| Layer | Path |
|-------|------|
| Migration | `supabase/migrations/20260709120000_store_assessments.sql` |
| Engine (pure) | `apps/web/src/lib/bl-store-assessment/{types,engine,format}.ts` |
| Scrape helper | `apps/web/scripts/lib/store-scrape.ts` |
| CLI | `apps/web/scripts/store-assessment.ts` |
| UI page + drill-in | `apps/web/src/app/(dashboard)/arbitrage/store-assessment/{page,[slug]/page}.tsx` |
| UI component | `apps/web/src/components/features/store-assessment/AssessmentView.tsx` |
| Skill doc | `.claude/commands/bl-basket.md` (assess-lens section) |
| E2E validator | `.claude/workflows/validate-store-assessment.js` |

### Data model

New `store_assessments` table (sibling to `store_quality_runs`, which assesses *our own* store) — headline metrics promoted to columns for list/sort, full section detail in an `assessment` JSONB, rendered report in `report_md`. RLS by `user_id`. Written by the CLI via service-role; the dashboard reads with the logged-in session.

### Engine design

A pure `assembleAssessment()` seam (mirrors store-quality's `assembleResult`) sits between the two Supabase cache reads and all the scoring/section math — which made it unit-testable without mocking the whole query chain. STR follows the house convention throughout: high-STR/magnet gates use `strLots` (sold÷stock lots); resale pricing uses `strQty` (Bricqer's quantity basis).

---

## 4. How it was verified

Every stage checked before moving on:

- **Typecheck** — clean (engine, scripts, UI) at each step
- **Lint** — clean
- **Unit tests** — 8 cases against `assembleAssessment` (size totals, within-margin, position buckets, high-STR/magnet detection, coverage honesty, verdict, set completeness) — all pass
- **Real end-to-end run** — light assessment against a live UK store (**Quaysretire**, 1,305 lots) via the CDP Chrome; report rendered, row persisted. This also surfaced and let me fix three issues before merge: ageing lot-counts, the feedback/order-rate parsing (inspected the real `StoreFront` object and `feedback.asp` structure), and honest "market avg" wording where coverage is world-fallback.
- **Production build** — green; both routes compiled
- **CI** (Typecheck/Lint/Test + Vercel) — SUCCESS
- **Deploy** — Vercel production success; `/arbitrage/store-assessment` returns HTTP 200; regression pages (`/workflow`, sibling arbitrage route) 200
- **Schema smoke test** — 28 columns, RLS enabled, 3 policies, rows persisting
- **E2E validation workflow** — 4 adversarial dimensions (schema, data integrity, engine audit, deploy), each finding independently refutation-checked → **overall PASS, zero upheld blocker/major issues**. Data-integrity independently re-derived Quaysretire's totals from the raw 1,305-lot scrape and matched to the penny.

**Live result (Quaysretire):** a PREMIUM-priced store (135% of market) but with **75 buyable minifig lots @ £55.92 net / 98% ROI** — the report cleanly isolates the "premium on common parts, underpriced minifigs" arbitrage signal a human would want to catch.

---

## 5. Known caveats / follow-ups

1. **Verdict weighting.** The grade weights pricing at 0.40, so a premium store with a good buyable sub-basket scores **SKIP** (Quaysretire → grade 22.5 → SKIP) even though there's £56 of net to cherry-pick. Buyable lots are always shown regardless of verdict. If it should read **REVIEW** instead, it's a one-line re-weight.
2. **Coverage.** With only ~1.5k rich UK price-guide rows vs 113k worldwide, most parts fall back to the worldwide `pg_summary` benchmark. The pricing figure is therefore "% of 6-mo market avg (UK where available)", and the Data-confidence section discloses the UK/world/none split honestly. Full mode narrows this by live-filling the top uncovered lots.
3. **Local server not rebuilt.** The change adds a new table/page/CLI but touches no cron/pick-list/WhatsApp runtime path, and the CLI runs via `tsx` (not the built bundle), so a stale local bundle is harmless here — the multi-minute service rebuild was skipped. Available on request.

---

## 6. Usage

**UI:** sidebar → Arbitrage Tracker → **Store Assessment** (`/arbitrage/store-assessment`), then click a store for the full drill-in.

**CLI:**
```bash
# Light: scrape → caches only. Fast; reuses a fresh inventory.json.
cd apps/web && npx tsx scripts/store-assessment.ts --store-slug=<name>

# Full: scrape → live gap-fill top uncovered lots → richer scorecard.
cd apps/web && npx tsx scripts/store-assessment.ts --store-slug=<name> --mode=full
```
Key flags: `--min-margin` (0.20), `--min-str` (0.5), `--magnet-max-supply` (3), `--inbound-per-unit` (0 = ex-postage), `--cache-ttl-days` (90), `--gapfill-budget` (120, full only), `--json`, `--no-persist`, `--allow-non-uk`.

---

## 7. Rollback

`git revert df42b804 && git push` — safe: a new table, a new route, and a CLI, with no changes to existing flows.

---

## 8. v2 addendum (2026-07-09, audit fixes)

A same-day audit of this build produced engine v2 (branch `feature/store-assessment-audit-fixes`). Changes:

**Issue fixes**
1. **Scan truncation is now detected and surfaced** — `scrapeStoreInventory` returns `{lots, truncated}`; the flag flows into the assessment (`scanTruncated`), the report header (⚠ banner), verdict reasons, and a `scan_truncated` column. An all-duplicates page (inventory shifting mid-scan) also flags truncation.
2. **Ageing no longer conflates "no data" with "dead"** — no-benchmark lots get their own bucket; the motivated-seller ratio is computed over benchmarked value only, and doesn't fire when <30% of value is benchmarked.
3. **Feedback scrape can't hit the wrong member** — the `feedback.asp` fallback via store display name was removed; only the StoreFront username is used, and the page is verified to mention it before parsing.
4. **`--cache-ttl-days` defaults to 90 everywhere** (code previously null/45; docs already said 90).
5. **One price scale** — per-lot buckets, the store label, and the verdict's price signal all use the shared `PRICE_BANDS` (0.70/0.95/1.15/1.50).
6. **No hardcoded user UUID** — flag → `STORE_ASSESSMENT_USER_ID` env → sole `profiles` row.
7. Small: CDP closed in `finally`; list page paginates run history (5k cap) before latest-per-store dedupe; a light rerun no longer hides a full assessment (mode link on the drill-in); assorted cleanups.

**Design changes**
1. **Cherry-pick-first verdict** — value (buyable net + breadth) 0.45, efficiency (ROI) 0.15, magnets 0.15, coverage 0.15, price posture only 0.10 as a search-cost modifier. Quaysretire-shaped stores (premium posture, strong sub-basket) now grade REVIEW, not SKIP. Constants named in `VERDICT`.
2. **World-fallback calibration** — worldwide benchmarks uplifted ×1.11 to UK level (`WORLD_TO_UK_UPLIFT`, from the 2026-07-07 UK+11% gap study), applied to both ask-vs-market and resale projections; marked † with provenance in report + UI.
3. **Honest naming** — `ukSoldAvg`→`benchmarkAvg`, `askVsUk`→`askVsMarket`, DB column `median_ask_vs_uk`→`median_ask_vs_market` (migration `20260709210000`).
4. **Versioned rows** — `engineVersion` in the JSONB + `engine_version` column; v1 rows render through `normalize.ts`.
5. **Data-quality caveats in the verdict** — truncation and >30% no-benchmark warnings appear as verdict reasons.

Deferred functionality extensions live in `extensions-backlog.md`.
