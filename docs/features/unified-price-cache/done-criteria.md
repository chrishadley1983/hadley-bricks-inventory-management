# Done Criteria — Unified Price Cache

Feature branch: `feature/unified-price-cache` · Spec: `./spec.md`

Each criterion is complete only when its verification passes. **PR-A = F1–F5** (additive capture +
colour map + read fn, no reader cutover, low risk, ship first). **PR-B = F6–F9** (backfill + reader
migration + cleanup, behind dual-read).

---

## PR-A — common functions (additive, ship first)

### F1: Canonical BL↔Bricqer colour map
- Table `bricklink_colour_map` (migration) + build/refresh script from BL colour list (`getColorList`
  / catalogDownload) LEFT JOIN Bricqer colours (snapshot) on normalised name.
- `src/lib/bricklink/colour-map.ts`: `toBlColourId`, `toBricqerColourId`, `blColourName`,
  `normaliseColour`.
- **Verify:** every colour present in `bricqer_inventory_snapshot` maps to a BL id (0 unmapped for
  the mainstream palette; residuals logged). Round-trip `toBricqer(toBl(x))==x` on the mapped set.
  Spot-check 3001: BL 11=Black, 1=White, 5=Red, 86=Light Bluish Gray resolve correctly.

### F2: `capturePriceGuide()` + coalescing upsert
- Postgres RPC `upsert_price_guide(jsonb)` — COALESCE-merges present quadrants over existing row.
- `src/lib/bricklink/price-guide/capture.ts` with `fromBlApi()` adapter (median/last2mo/hist from
  `price_detail[]`), colour normalisation via F1, UK vs world routing.
- **Verify:** unit tests — (a) sold-only used call then stock-only used call yields a row with BOTH
  quadrants (no clobber); (b) median/last2mo computed correctly from a fixture `price_detail[]`;
  (c) a Bricqer-scheme colour input lands under the correct BL id.

### F3: Client auto-capture hook
- `BrickLinkClient.getPartPriceGuide`/`getSetPriceGuide` fire-and-forget `capturePriceGuide` when a
  `supabase` handle is present (opt-out flag `persist:false`). No behaviour change to return value.
- **Verify:** run bl-basket enrichment on a small store; confirm the fetched tuples appear in
  `price_guide_cache` with `parse_version = current`, non-null median + lots/qty split, and
  UK `price_detail` captured. Confirm no duplicate/clobbered rows.

### F4: catalogPG writer routes through capture
- `PriceGuideCacheService.upsert` refactored to emit via `fromCatalogPg()` → `capturePriceGuide`
  (single write path). `writeThroughPartPriceCache` retained only until F9.
- **Verify:** a `bl-pg-store-scan` run still populates `price_guide_cache` identically (diff a
  sample of rows pre/post refactor — byte-equivalent on the rich fields).

### F5: `readPriceGuide()` + single STR source
- `src/lib/bricklink/price-guide/read.ts`: normalised `PriceGuideView` with `strLots`, `strQty`,
  `qtyShareAtOrAbove`, world fallback + `coverage` flag; colour-scheme agnostic input.
- **Verify:** for a set of tuples, `strLots`/`strQty` from `readPriceGuide` equal hand-computed
  values from the raw columns; world fallback returns `coverage:'world_fallback'` when no UK row.

---

## PR-B — migration & cleanup (behind dual-read)

### F6: Backfill
- Lossy-migrate 35k `part_price_cache` rows → `price_guide_cache` (parse_version=0, colour-normalised
  via F1). Rich re-fetch queue job (demand+inventory prioritised) upgrades parse_version=0 rows.
- **Verify:** `price_guide_cache` coverage ≥ prior `part_price_cache` distinct (item,BL-colour);
  no row lost; re-fetch job upgrades a sample from v0 → current with populated median/hist.

### F7: Migrate production readers (dual-read)
- `fetchBLCache`+explorer routes, `partout.service`+routes, `store-quality/{engine,pricing}`,
  `live-check.service` → `readPriceGuide()`; STR via `strLots`/`strQty`; colour handling removed.
- **Verify (per reader):** live output (Inventory Explorer STR column, POV, store-quality scorecard)
  matches pre-migration within tolerance on a fixed sample; store-quality colour join now correct
  (no repeat of the 0.35× value-weighted anomaly). `npm run build` + `npm run typecheck` clean.

### F8: Migrate active scripts
- bl-basket, analyze-bl-store, reprice-*, scan-*, partout-bricqer-pricing, evaluate-job-lot,
  find-piece → `readPriceGuide()`/`capturePriceGuide()`. Dead `_`-prefixed one-offs excluded.
- **Verify:** bl-basket end-to-end on a store produces an equivalent basket (net within tolerance)
  reading the unified cache.

### F9: Cutover & deprecation
- Remove legacy fallback in `readPriceGuide`; delete `PartPriceCacheService`, `fetchBLCache`,
  `writeThroughPartPriceCache`; archive/drop `bricklink_part_price_cache` (rename first, drop later).
- **Verify:** grep shows zero live references to `bricklink_part_price_cache` outside archive;
  full app build + targeted E2E (explorer, POV, store-quality, bl-basket) green; a `/verify-done`
  pass on F7 readers against production.

---

## Global verification
- `npm run typecheck` + `npm run lint` + `npm test` green at each PR boundary.
- No net loss of tuple coverage vs 2026-07-09 baseline (35,031 part_price_cache distinct).
- One STR implementation in the codebase (grep: no ad-hoc `sold/stock` STR maths outside
  `read.ts`/`bricqer-pricing.ts`).
