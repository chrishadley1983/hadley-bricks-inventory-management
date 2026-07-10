# Store Assessment — Extensions Backlog

Functionality extensions deferred from the 2026-07-09 audit (whose issue fixes and
design changes shipped as engine v2), plus three items Chris added. Pick up once the
v2 branch is merged. Ordered roughly by expected value.

---

## 1. Lot-overlap against our own inventory ("new unique lots" vs restock) — ✅ SHIPPED (engine v3, 2026-07-09)

Implemented as `bl-store-assessment/overlap.ts` + section 11 of the report:
NEW / RESTOCK_OUT / RESTOCK_THIN / DUPLICATE per lot (snapshot join BL-colour-normalised;
RESTOCK detection via our 6-mo BL+BO sales; sales matching is colour-NAME based since
order_items carry no colour id), rollup over buyable lots with `freshNetShare`,
`buyable_fresh_lots` column, Ours? badges in the drill-in, verdict reason. Remaining
idea from this item: feed freshNetShare into the verdict grade itself.

Original scope:

Every suggestion table (within-margin, high-STR, magnets) should say whether buying a
lot **creates a new unique lot in our store** or adds depth to something we already
stock. New-unique matters: it widens the catalogue and doesn't cannibalise existing
listings; restock matters differently (only worth it if we're sold out or thin).

- Join each suggested lot against Bricqer inventory by (BL item no, colour, condition)
  — reuse the two-colour-key join lessons from the store-quality feature (see memory:
  `store-quality-framework`, the join gotcha).
- Per lot, tag one of: `NEW` (we don't stock it), `RESTOCK-OUT` (we stock it, qty 0 /
  sold out), `RESTOCK-THIN` (qty below ~2 months of our own sell rate), `DUPLICATE`
  (we're already deep).
- Roll up per store: "62 buyable lots → 41 new unique, 9 restock-out, 12 duplicate" —
  a store that's mostly DUPLICATE is worth much less than its raw net suggests.
- Candidate verdict input later: share of buyable net that is NEW/RESTOCK-OUT.

## 2. Nightly-cron scale-out on the STR/pg_summary cache — *Chris priority*

**✅ SHIPPED (phase 2, 2026-07-10):** `store_assessment_watchlist` table (seeded from
assessed stores + arbitrage-purchase sellers via `--seed`), batch runner
`scripts/store-assessment-batch.ts` (stalest-first selection, never-assessed priority,
min-age skip, child-process isolation per store, jittered pacing), run-over-run delta
alerts (BUY verdict / net jump ≥£20 / price drop ≥10pts / promising first assessment)
to Discord #opportunities + a sweep summary to #sync-status, and a nightly 02:15
Task Scheduler job (`register-store-assessment-batch-task.ps1`). This also delivers
items 5 (batch sweep) and 7 (Discord hook). Remaining ideas below (trend UI columns,
alternative candidate feeds like BrickRadar lanes) stay open.

Original exploration notes:
- **Candidate feed:** where does the store list come from? Options: stores seen in
  bl-basket/store-quality history, sellers behind magnet/POV hits, BrickRadar lane
  discoveries, manual watchlist in a table.
- **Scrape budget:** the searchitems AJAX endpoint needs a logged-in CDP Chrome and
  polite pacing (3s/page). ~1,300-lot store ≈ 15 pages ≈ 1 min. A nightly window of
  1-2h on the local bot ≈ 60-100 stores/night. Respect
  `feedback_gentle_external_scraping` — jitter, no bursts, one store at a time.
- **Where it runs:** local bot (NSSM/Task Scheduler) like ebay-pricing/ebay-auctions —
  NOT Vercel (CPU budget) and NOT GCP (needs the logged-in Chrome).
- **Re-assess cadence:** inventory.json TTL 7d suggests weekly rotation per store, with
  the nightly slot picking the stalest N watchlist stores. Deltas since last run (value,
  buyable net, weighted-median ask) are the interesting output — "motivated seller just
  dropped prices" should raise a Discord alert.
- **Output:** the existing `store_assessments` table already keeps history; the list
  page dedupe was built for exactly this. Add a trend/delta column set + alert hooks.

## 3. UI review — non-AI-look improvements — *Chris priority*

The `/arbitrage/store-assessment` pages are functional shadcn defaults — card grid,
stat tiles, badges — i.e. they read as AI-generated. A design pass with the
`frontend-design` skill (and `challenge-hb-dashboard-design` as the adversarial
checklist) should target:
- A distinctive verdict header (grade dial or signal-bar cluster instead of a bare
  number), consistent with the business dashboard's visual language.
- Denser, scannable lot tables (the drill-in currently spends a full card per section;
  an operator wants the buyables above the fold).
- The signal breakdown (`verdict.signals`) is computed but never rendered — a small
  five-bar strip would explain WHY a store graded as it did.
- Real typography/spacing decisions rather than uniform `space-y-6` cards; dark-mode
  contrast check on the amber/emerald bars.

## 4. Bridge assess → buy (persist full buyable list)

Only the top 12 within-margin lots are persisted/rendered; Quaysretire had 75. Persist
the complete buyable list (or all scored lots above a floor) and give bl-basket a
`--from-assessment=<id>` flag so the buy lens can skip its own re-scoring and go
straight to cart-building from an assessment row. Alternatively export as a BL wanted
list upload. (JSONB size: ~75 lots ≈ trivial; even 1,000 scored lots ≈ ~300KB — cap or
strip nulls if persisting everything.)

## 5. Batch sweep CLI

`--store-slugs=a,b,c` (or `--from-file=watchlist.txt`) producing a league table at the
end — the stated workflow is "run light across many candidates" but the CLI is
single-store. This is also the building block for the nightly cron (item 2).

## 6. Postage sensitivity

`--inbound-per-unit` defaults to 0 (ex-postage). Show projected net at £0/£3/£5 inbound
in the verdict card, or scrape the store's terms page for min-buy and postage bands and
plug the real number in. Stops marginal stores flattering themselves.

## 7. Discord alert hook

Card on BUY verdicts or `buyable_net_gbp` above a threshold, matching the existing
sniper alert format (fits DiscordService + the local-bot cadence). Becomes the output
channel for the nightly sweep.

## 8. Non-UK support done properly

`--allow-non-uk` exists but the fee/postage model is UK-only. If ever used in anger:
add an inbound-postage floor by region (EU/US) and a customs/VAT line over £135.
Low priority — arbitrage is UK-only at our scale (see memory:
`feedback_bl_arbitrage_uk_only`).
