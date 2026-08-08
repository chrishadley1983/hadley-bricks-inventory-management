# Part-First Arbitrage — Done Criteria

Chris (2026-08-08): "now that we have almost 100% UK price coverage it would be good
to have a process where we proactively search for good STR parts and then find a
concentrated basket in that store … Same principles of value as the nightly store
scrape but more proactively part based rather than store based."

Refinements agreed in the same conversation:
- Use the cache's stock-price **histogram depth** ("Part X is for sale 8 times, holds
  the 8 prices") to count units cheap enough to hit margin.
- **No sold-value floor** — a 50p part sold 10 times is still of value; gate on
  demand frequency (soldQty), not value.
- **Two-stage grounding**: initial pass presents findings from cached data; before
  building any wanted-list XML the store's actual lots are re-scraped live.
- Option to **just push to a wanted XML** (manual buy-everything-from-store flow),
  alongside the full bl-basket cart handoff.

## Criteria

| # | Criterion | Verification |
|---|-----------|--------------|
| F1 | `bl_store_lots` flattened index over `bl_store_scrapes.lots` with per-store refresh (`refresh_bl_store_lots`), freshness view, RLS; backfill row count exactly matches scrape lot totals | Backfilled 2026-08-08: 2,473,421 rows = Σ lot_count |
| F2 | `readPriceGuide` SideView exposes the CURRENT-STOCK histogram (`stockHist`) | Unit-tested; existing consumers unaffected (tsc clean) |
| F3 | Anchor screen: STRlots ≥ 1 (tunable), soldQty ≥ 10/6mo (tunable, **no value floor**), ≥ 1 unit in the stock histogram priced within [minAsk, list×(1−9.4%−margin)] — all constants from `fees.ts`/`bricqer-pricing.ts` | 21 unit tests in `src/lib/bl-part-arb/__tests__` |
| F4 | Store nomination joins anchors to `bl_store_lots` on (type, no, colour, condition) with per-anchor ask ceiling | Unit tests + live run: 4,793 anchors → 477 stores |
| F5 | Nominated stores scored through the common `bl-store-report` module (demand cap, gate ladder, LIQUID headline, standalone postage) — no improvised report | League + per-store md rendered via `buildBasketDecisionReport`/`renderDecisionMd` |
| F6 | Findings persisted to `part_arb_candidates` (anchors jsonb + DecisionSummary figures + inputs) | Live run persisted top 10; spot-check vs source tables passed |
| F7 | Ground stage: live CDP re-scrape → re-score → `--xml-only` (wanted XML via the canonical `wanted-list.ts` builder) or `--cart` (bl-basket handoff reusing the fresh inventory.json, CDP port forwarded) | Code-reviewed; XML path unit-tested at the mapping seam |
| F8 | Nightly sweep keeps the flattened index fresh (post-scrape RPC hook in `store-assessment.ts`) | Hook + incremental `bl_store_lots_freshness` check in discover |

## Out of scope (deliberate)

- No UI page — CLI + persisted table first; UI can read `part_arb_candidates` later.
- Phase 2 (persist catalogPG `stock_offers` for anchor-eligible P/M tuples to see
  sellers beyond the 624 scraped stores) — separate follow-up.
