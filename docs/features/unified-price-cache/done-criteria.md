# Done Criteria — Unified Price Cache

Feature branch: `feature/unified-price-cache` · Spec: `./spec.md`

**Single feature build, F1–F9 in order** (Chris, 2026-07-09 — not split into separate PRs). F1–F5
build the three common functions; F6–F9 migrate consumers and drop the legacy table. Each criterion
is complete only when its verification passes.

Locked decisions: drop-don't-migrate · reader scope = prod + active scripts (dead one-offs marked,
not migrated) · canonical colour = BL id · capture grabs all 4 quadrants (plain upsert, no coalescing).

---

### F1: Canonical BL↔Bricqer colour map
- Table `bricklink_colour_map` (migration) + build/refresh script from BL colour list (`getColorList`
  / catalogDownload) LEFT JOIN Bricqer colours (snapshot) on normalised name.
- `src/lib/bricklink/colour-map.ts`: `toBlColourId`, `toBricqerColourId`, `blColourName`, `normaliseColour`.
- **Verify:** every colour in `bricqer_inventory_snapshot` maps to a BL id (0 unmapped for the
  mainstream palette; residuals logged). `toBricqer(toBl(x))==x` on the mapped set. Spot-check 3001:
  BL 11=Black, 1=White, 5=Red, 86=Light Bluish Gray resolve correctly.

### F2: `capturePriceGuide()` + `ensurePriceGuide()` (all 4 quadrants, plain upsert)
- `src/lib/bricklink/price-guide/capture.ts`: `fromBlApi()` (median/last2mo/hist from `price_detail[]`),
  colour-normalised via F1, UK vs world routing. `ensurePriceGuide()` orchestrator = cache-check →
  4 quadrant fetches on miss/stale → `capturePriceGuide` (plain upsert on `item_type,item_no,colour_id`)
  → returns the read view.
- **Verify:** unit tests — (a) `ensurePriceGuide` on a fresh tuple writes ONE complete row with all 4
  quadrants populated (soldNew/soldUsed/stockNew/stockUsed) in 4 calls; (b) median/last2mo computed
  correctly from a fixture `price_detail[]`; (c) a Bricqer-scheme colour input lands under the correct
  BL id; (d) a second call within TTL makes 0 API calls (cache hit).

### F3: Consumers use `ensurePriceGuide` (rich capture as side effect)
- Standard price path becomes `ensurePriceGuide`; raw `getPartPriceGuide`/`getSetPriceGuide` remain
  low-level only. Sets (`getSetPriceGuide`) captured too.
- **Verify:** run bl-basket enrichment (via `ensurePriceGuide`) on a small store; the fetched tuples
  appear in `price_guide_cache` with `parse_version = current`, non-null median + lots/qty split for
  all 4 quadrants, and captured UK `price_detail`. No duplicate rows.

### F4: catalogPG writer routes through capture
- `PriceGuideCacheService.upsert` refactored to emit via `fromCatalogPg()` → `capturePriceGuide`.
- **Verify:** a `bl-pg-store-scan` run populates `price_guide_cache` identically pre/post refactor
  (diff a sample — byte-equivalent on the rich fields).

### F5: `readPriceGuide()` + single STR source + world fallback
- `src/lib/bricklink/price-guide/read.ts`: normalised `PriceGuideView` with `strLots`, `strQty`,
  `qtyShareAtOrAbove`, colour-scheme-agnostic input, and `coverage: 'uk'|'world_fallback'|'none'`
  (falls back to `pg_summary` when no UK row).
- **Verify:** `strLots`/`strQty` from `readPriceGuide` equal hand-computed values from the raw columns;
  a tuple with no UK row returns `coverage:'world_fallback'` with a `pg_summary`-derived value; a UK row
  returns `coverage:'uk'`.

### F6: Coverage rebuild — drop, don't migrate
- **No lossy migration.** Build the prioritised re-fetch queue (our-inventory + demand rank) that calls
  `ensurePriceGuide`; run it to pre-warm the prod surface tuples.
- **Verify:** re-fetch queue upgrades a sample of our-inventory tuples to `parse_version=current` with
  populated median/hist; `readPriceGuide` returns `coverage:'uk'` for warmed tuples and
  `world_fallback` (not blank) for cold ones. No dependency on `part_price_cache` remains for coverage.

### F7: Migrate production readers (straight cutover, world-fallback safety net)
- `fetchBLCache`+explorer routes, `partout.service`+routes, `store-quality/{engine,pricing}`,
  `live-check.service` → `readPriceGuide()`; STR via `strLots`/`strQty`; bespoke colour handling removed.
- **Verify (per reader):** live output (Explorer STR column, POV, store-quality scorecard) matches
  pre-migration within tolerance on a fixed sample; store-quality colour join correct (no repeat of the
  0.35× value-weighted anomaly). `/verify-done` per reader. `npm run build` + `typecheck` clean.

### F8: Migrate active scripts; mark dead one-offs
- bl-basket, analyze-bl-store, reprice-*, scan-*, partout-bricqer-pricing, evaluate-job-lot, find-piece
  → `ensurePriceGuide`/`readPriceGuide`.
- Dead `_`-prefixed one-offs: add header comment `// DEPRECATED: reads bricklink_part_price_cache
  (dropped). Do not use as a pattern.` — not migrated.
- **Verify:** bl-basket end-to-end on a store produces an equivalent basket (net within tolerance) off
  the unified cache; grep confirms every excluded one-off carries the deprecation comment.

### F9: Cutover & drop
- Delete `PartPriceCacheService`, `fetchBLCache`, `writeThroughPartPriceCache`; rename then drop
  `bricklink_part_price_cache` (migration).
- **Verify:** grep shows zero live (non-deprecated-marked) references to `bricklink_part_price_cache`;
  full app build + targeted E2E (explorer, POV, store-quality, bl-basket) green.

---

## Global verification
- `npm run typecheck` + `npm run lint` + `npm test` green.
- One STR implementation: grep shows no ad-hoc `sold/stock` STR maths outside `read.ts` /
  `bricqer-pricing.ts`.
- One price write path: grep shows no `.from('bricklink_part_price_cache').upsert` outside the
  deprecated-marked one-offs (which are dropped anyway).
