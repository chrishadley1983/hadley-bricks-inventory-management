# Unified Price Cache — remaining work (F7‑tail → F8 → F9)

**Status 2026-07-09 (evening): COMPLETE.** F7‑tail + F8 + F9 all shipped on
`feature/price-cache-cutover`. Every reader below is on `readPriceGuide()`, every writer on
`ensurePriceGuide()`/`capturePriceGuide()`; `writeThroughPartPriceCache` deleted;
`PartPriceCacheService` deleted; `bricklink_part_price_cache` renamed to
`bricklink_part_price_cache_deprecated` (migration 20260710000000). Documented exceptions:
live-check lane (partial upsert of fetched quadrants — see its header), arbitrage
bricklink-sync.service (stock-snapshot + seller price_detail lane, capture would poison
freshness — see its header), pg-canary (drift detector, must stay cache-independent),
pg-residual-fill lane-A rotation (feeds the worldwide pg_summary layer), analyze-bl-order's
GLOBAL-fallback + non-P/M/S catalogue-type calls. `fetchBLCache` kept as a thin adapter over
readPriceGuide (bricqer-scheme keying for the Explorer). Historical checklist below.

**Status 2026-07-09 (morning):** F1–F6 foundation shipped (PR #534) + deployed + E2E‑validated PASS.
F7 **store‑quality reader migrated** (PR pending, cut from fresh branch off main). This doc is the
precise pick‑up checklist for the rest. Common functions to use everywhere:
`readPriceGuide()` (read), `ensurePriceGuide()`/`capturePriceGuide()` (write), `loadColourMap()`
(colour). All in `apps/web/src/lib/bricklink/`.

## Migration recipe (applies to every reader)
Replace `.from('bricklink_part_price_cache').select(...)` with `readPriceGuide(supabase, refs, {allowWorldFallback:true})`:
- Build `refs`: `{ itemType:'P'|'M', itemNo, colourId, scheme:'bricqer'|'bl' }`. **Snapshot/inventory
  colours are Bricqer scheme → pass `scheme:'bricqer'`.** BL‑API‑sourced colours are `'bl'`.
- Key results with `pgKey('P', itemNo, cmap.toBl(colourId, scheme))` (import `loadColourMap` + `pgKey`).
- Map fields: `price_used`→`view.used.soldAvg`; `price_new`→`view.new.soldAvg`;
  `sell_through_rate_used` (was ×100) → `view.used.strQty * 100` if a consumer still divides by 100,
  else use `view.used.strQty` / `view.used.strLots` directly (prefer strQty for Bricqer pricing,
  strLots for the house "sold lots ÷ stock lots" STR).
- Pattern reference: **`store-quality/engine.ts loadBLCache`** (already migrated — copy its shape).

## F7‑tail — production readers still on `part_price_cache`

| File | Usage | Notes / risk |
|---|---|---|
| `inventory-explorer/bricklink-lookup.ts` (`fetchBLCache`) | reads price_new/used, sell_through_rate_*, stock_available_*, times_sold_* keyed `part|colour`; helpers getSTR/getSold/getForSale/getBLAvg | **User‑facing (Explorer STR column).** Callers: `api/inventory/explorer/items/route.ts`, `.../overview/route.ts`. Callers currently pass part numbers + look up by `part|colour` (Bricqer). Migrate `fetchBLCache` internals to readPriceGuide (keep helper signatures) OR change callers to pass tuples. Diff Explorer STR column live before/after. |
| `inventory-explorer/enrichment.service.ts` | part_price_cache read | check exact usage; same recipe |
| `api/inventory/explorer/sync-status/route.ts` | part_price_cache read (freshness/count) | may just count rows — repoint to price_guide_cache or drop the check |
| `bricklink/partout.service.ts` + `api/bricklink/partout/{route,stream}` | POV part valuation | **User‑facing (POV).** E2E note flagged POV STR as a separate subsystem — audit whether it needs 6MA avg (migrate) or its own thing (leave). |
| `bricklink/live-check.service.ts` | already reads BOTH price_guide_cache + part_price_cache (dual) | drop the part_price_cache leg; rely on readPriceGuide. Has a test: `__tests__/live-check.service.test.ts` — update it. |

## F8 — scripts

**Active (migrate to readPriceGuide / ensurePriceGuide):** `bl-basket.ts` (reads+writes
part_price_cache — biggest; its enrichment should become `ensurePriceGuide`), `analyze-bl-store.ts`,
`reprice-cold-as-used.ts`, `reprice-at-uk-min.ts`, `scan-bl-store.ts`, `scan-ninjago-arbitrage.ts`,
`partout-bricqer-pricing.ts`, `evaluate-job-lot.ts` (uses `strRatioFromCache`), `find-piece.ts`,
`apply-bricqer-pricing.ts`, `check-str.ts`, `analyze-bl-order.ts`.

**Write‑through to retire:** `PriceGuideCacheService.writeThroughPartPriceCache` + its 3 callers
(`bl-pg-store-scan.ts:444`, `pg/pg-refresh-cycle.ts:406`, `pg/pg-set-check.ts:303`). Direct
part_price_cache writers to remove: `bl-basket.ts`, `analyze-bl-store.ts`, `_str-sample.ts`,
`cleanup-bad-cache-rows.ts`.

**Dead `_`‑prefixed one‑offs — MARK, do not migrate** (add header comment
`// DEPRECATED: reads bricklink_part_price_cache (dropped). Do not use as a pattern.`):
`_analyze-bl-pricing-vs-6ma.ts`, `_cache-view-set.ts`, `_check-nougat-torsos.ts`,
`_estimate-bricqer-pricing-delta.ts`, `_fetch-nougat-torso-prices.ts`, `_price-nougat-torsos.ts`,
`_spotcheck-str.ts`, `_str-sample.ts`, `_str-set.ts`, `_terry-bricqer-reprice.ts`,
`_terry-bricqer-reprice-api.ts`, `_terry-decompose.ts`, `check-cache-973pb0898c01.ts`,
`cleanup-bad-cache-rows.ts`.

Enumerate current refs before starting: `grep -rl "bricklink_part_price_cache\|part-price-cache" apps/web/{scripts,src}`.

## F9 — drop legacy
1. Confirm **zero live (non‑deprecated‑marked) refs** to `bricklink_part_price_cache`.
2. Delete `PartPriceCacheService` (`src/lib/bricklink/part-price-cache.service.ts`), `fetchBLCache`
   (`inventory-explorer/bricklink-lookup.ts`), and `writeThroughPartPriceCache`.
3. Migration: **rename** `bricklink_part_price_cache` → `bricklink_part_price_cache_deprecated`
   first (reversible); after a healthy prod cycle, drop it.
4. Regenerate types (`npm run db:types`), typecheck/lint/test/build green.

## Coverage note
Before/around F7‑tail cutover, run `scripts/pg/warm-price-guide.ts` to warm UK coverage over our
inventory so readers aren't leaning on world‑fallback (currently ~1.4k UK rows; store‑quality showed
83% coverage via fallback, which is acceptable but UK‑exact is better). ~11k tuples × 4 calls, paced
within ~1,500/day BL headroom.

## Branch hygiene
`feature/unified-price-cache` diverged from main after #534 squash‑merge — **cut every follow‑up PR
from a fresh branch off latest main.** Re‑run `.claude/workflows/validate-unified-price-cache.js`
after each reader-migration PR.
