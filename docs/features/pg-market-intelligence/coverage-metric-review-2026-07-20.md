# PG UK Price Coverage — "Stale" Investigation & Metric Review

**Date:** 2026-07-20
**Trigger:** After ~2 weeks of scraping, the refresh planner reported ~28,572 tuples "due,"
including ~10.6k flagged as "scraped-then-expired." Chris: with only a couple of weeks of
history and a 60/90-day cycle, nothing should be genuinely stale yet — why is it?

**Verdict:** Correct. **Nothing is genuinely stale.** The "stale/expired" count is an
artifact of the seed pre-stamping `last_refreshed_at`. The queue field is a seed timestamp,
not a coverage signal — and every freshness/coverage metric reading it overstates reality
by ~3×.

---

## Root cause: seed pre-stamping

On **2026-07-08**, `apps/web/scripts/pg/pg-universe.ts` (seed-from-cache mode, lines
113–119) created `bl_pg_refresh_queue` rows for every tuple present in **L1** (the
`bricklink_pg_summary_cache` worldwide summary) and, for each:

- stamped `last_refreshed_at = now()`
- set `next_due_at` to a **random point across the next 90 days**

It did this for **all 130,065 L1 tuples**, regardless of whether they'd ever been through
the real UK price-guide scrape (L3, `bricklink_price_guide_cache`). Per the in-code comment,
the stamp exists so `pg-residual-fill.ts` (which selects `last_refreshed_at IS NULL`) skips
them. That one field is now doing double duty — "don't gap-fill" **and** "UK price is
fresh" — and the second meaning is false.

---

## Evidence

| Signal | Value | Meaning |
|---|---|---|
| L1 worldwide-summary rows | 130,065 | what got `last_refreshed_at` stamped |
| L3 real UK price rows | 44,593 | what has *actually* been UK-scraped |
| The gap | 85,472 | L1 tuples never UK-scraped, but marked "refreshed" |
| Real UK scraping began | 2026-07-07 | 12 days before this review |
| Rows stamped in seed's first 3 days | 87,656 | the mass seed event (2026-07-08+) |
| "Expired/stale" rows with `attempts = 0` | **10,587 / 10,587** | **100% never actually scraped** |
| "Expired/stale" rows that are real retries (`attempts ≥ 1`) | **0** | none |

**The clincher:** every "stale" tuple has `attempts = 0` — never fetched by the lane-D
scraper. They are seed placeholders whose random `next_due_at` happened to land within the
first 12 days. Zero are failed-scrape retries; zero are aged-out real data. Genuine
60/90-day expiry is impossible this early and none has occurred.

### Queue composition (2026-07-20)

- **Total queue:** 151,457 rows — `active` 60,000 + `tail` 91,457 (90-day background fill).
- **"Due" (planner definition, `next_due_at <= now`, all tiers):** ~28,428
  - ~17,741 never-scraped (`last_refreshed_at IS NULL`, mostly tail) — first-touch work
  - ~10,687 seed placeholders coming due (`attempts = 0`) — **not** stale data
- **Genuinely due active-tier refreshes:** ~4,128 (and only 1 active row never scraped).

---

## What this means

1. **`last_refreshed_at` is a seed timestamp, not a coverage signal.** Real UK coverage is
   **44,593 rows**, not the ~126k the queue implies. Any metric keyed off `last_refreshed_at`
   overstates coverage/freshness by ~3×.
2. **The pg-digest "within-cycle %" is currently meaningless.** It counts
   `last_refreshed_at >= cutoff`, which for almost every row just means "seeded on
   2026-07-08," so it reads ~100% fresh regardless of actual scraping progress.
3. **"Due" ≠ "refresh needed."** The ~28k due is really first-touch work (never-scraped +
   seed placeholders). The genuine refresh backlog is ≈ 0, which is correct 12 days in.

---

## Recommended fix

The real defect is the overloaded field. Do both:

- **Reporting correction (non-schema, low-risk — do first):** change all coverage/freshness
  reporting (`pg-digest.ts`, any BrickRadar UI) to key off **L3 presence + `fetched_at`** in
  `bricklink_price_guide_cache`, not the queue's `last_refreshed_at`.
- **Column fix (schema — propose separately):** add a `seeded_at` / `covered_source` column
  so `pg-residual-fill` can skip L1-seeded rows without `last_refreshed_at` lying about UK
  freshness. Reserve `last_refreshed_at` for actual lane-D scrapes (`attempts > 0` / L3 write).

**Open follow-up:** run the queue↔cache join for the true **active-tier** UK coverage number
(the 44,593 L3 rows span both tiers, so active-specific coverage is lower than 60k).

---

## Reproduction

All figures from read-only counts against cloud Supabase (`modjoikyuhqzouxvieua`) on
2026-07-20, tables `bl_pg_refresh_queue`, `bricklink_pg_summary_cache`,
`bricklink_price_guide_cache`. Key checks:

- L1 vs L3 row counts; L3 `fetched_at` min/max (real scraping window).
- Queue `last_refreshed_at` min/max and seed-window clustering.
- "Due" split: `next_due_at <= now` × (`last_refreshed_at IS NULL` vs not) × `attempts`.

Seed logic: `apps/web/scripts/pg/pg-universe.ts:113-119`.
Planner "due" definition (all tiers, not active-only): `apps/web/scripts/pg/pg-refresh-cycle.ts:270-290`.

---

## Resolution (2026-07-20, same day — branch `fix/pg-coverage-truth`)

Full audit confirmed the verdict and shipped the fix. Corrected numbers (per-row join,
deterministically ordered — an earlier unordered client-side pagination pass under-counted
by ~13k, itself an argument for the server-side view): **active tier 45.1% covered
(27,047/60,000), ~41% with UK-native sold data; 78,138 fake-fresh seed stamps; 0 genuinely
stale.** The open follow-up (active-tier true coverage) is answered above.

Shipped (migration `20260720150000_pg_coverage_truth.sql` + code):

1. **`seeded_at` column** — the seed stamp got its own field; `last_refreshed_at` now means
   "actually scraped" only. All seed/enqueue paths write `seeded_at`; gap-fill selects both
   NULL. The 78k fake stamps were moved over.
2. **No-data = scraped** — a confirmed empty price guide writes a zero L1 row
   (`no_data=true`), stamps the queue, re-checks at 90d, and never climbs the failure
   ladder (nightly + page-sweep; the 731 historical rows backfilled). `PgNotFoundError`
   is parked permanently (was recycling every 90d).
3. **Cycle constants centralised** in `src/lib/bricklink/pg-cycle-policy.ts` (60/28/90);
   residual-fill (was 28d active) and page-sweep (was flat 28d) aligned.
4. **Ad-hoc scrapes tell the queue** — store-scan enrich and page-sweep stamp + push
   `next_due_at` tier-correctly; lane-A live-checks stamp `last_refreshed_at` only (the
   richer page scrape stays scheduled). 1.9k orphan L3 tuples adopted into the queue.
5. **First-touch acceleration** — never-scraped active tuples made due now (~16 nights to
   full active first-touch at cadence, vs trickling to ~October behind random seed dates).
6. **`pg_coverage_report` view** — THE canonical coverage/staleness/yield statement.
   The daily question is now exactly:
   `SELECT * FROM pg_coverage_report ORDER BY tier, tuples DESC;`
   pg-digest's coverage section reads it; never improvise a coverage query again.
