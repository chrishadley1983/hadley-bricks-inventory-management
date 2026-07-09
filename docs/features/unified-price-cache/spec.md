# Unified Price Cache — consolidate all BL price data on `price_guide_cache`

**Status:** Draft v1 (2026-07-09) · Branch `feature/unified-price-cache` · pending review/build approval

## 1. Motivation

Our BrickLink price data is fragmented across three caches with inconsistent formats, colour
schemes and STR semantics. Every consumer re-implements its own lookup + STR maths, and API
calls are under-captured (the rich response is thrown away).

| Cache | Rows (2026-07-09) | Written by | Format |
|---|---|---|---|
| `bricklink_price_guide_cache` | 1,387 | catalogPG **page** scraper only | **Rich** (median, qty-avg, last-2mo, lots+qty split, min, jsonb detail+hist, sets) |
| `bricklink_part_price_cache` | 35,031 | **API** path, bl-basket, scans | **Thin** (avg, precomputed STR, stock count, ambiguous `times_sold`) |
| `bricklink_pg_summary_cache` | 112,981 | BrickStore harvest | **Worldwide** 6MA (screening layer — out of scope here, stays as L1) |

Two proven problems:
- **Wasted API calls.** The BL price API returns `min/max/avg/qty_avg`, `unit_quantity` (lots),
  `total_quantity` (qty) and the full `price_detail[]` (per-transaction `unit_price` + `date_ordered`).
  bl-basket keeps only `avg_price` + `total_quantity` (`bl-basket.ts:685-687`) and writes the thin
  table. Everything needed for median / recency / histogram / lots-qty split is discarded.
- **Colour-scheme chaos.** `price_guide_cache` is BL scheme. `part_price_cache` is **mixed** —
  verified 2026-07-09: for part 3001, named rows are BL (2=Tan, 86=Light Bluish Gray, 69=Dark Tan)
  but the top-volume unnamed rows don't match BL (colour 6 tops it; Black/11 — 3001's true #1 per
  pg_summary — is absent from the top 15). Bricqer-sourced readers (store-quality) join with Bricqer
  ids. There is no canonical BL↔Bricqer colour map.
- **Inconsistent STR.** `strLots = sold_lots/stock_lots` (house definition) vs
  `strQty = sold_qty/stock_qty` (Bricqer pricing formula) are computed ad-hoc per consumer; the
  legacy `times_sold`/`sell_through_rate` fields conflate lots and qty.

## 2. Goal (Chris, 2026-07-09)

Build **robust common functions** so data capture and consumption are consistent everywhere:

1. **One capture function** — all BL price data (API + catalogPG) flows through a single ingest that
   writes a rich, consistent `price_guide_cache` row **including the raw components needed to
   recompute STR** (both definitions), median, recency, histogram.
2. **One colour-map function** — canonical, bidirectional **BL ↔ Bricqer** mapping used by every
   writer and reader, so a lot resolves to the same tuple regardless of source.
3. **One read/consumption function** — all analysis reads `price_guide_cache` through a single
   normalised accessor with **consistent STR** (lots and qty) and price fields.

Then migrate every downstream writer/reader onto these three functions, deprecate
`part_price_cache`, and know we are capturing and consuming consistent data.

**Non-goals:** changing `pg_summary` (worldwide screening layer stays); changing the pricing formula
itself ([[bricqer-pricing-formula]]); changing BrickRadar UI behaviour (it already reads the rich
cache) beyond the read-function swap.

## 3. Target architecture — three common functions

```
                        ┌─────────────────────────────────────────────┐
  BL API (getPriceGuide) │                                             │
  catalogPG page scrape  ├──►  capturePriceGuide()  ──►  price_guide_cache
  (future: store API)    │      (§3.1, single writer)        (rich, BL-scheme keyed)
                        └─────────────────────────────────────────────┘
                                        ▲                     │
                        colourMap()  ───┘                     ▼
                        (§3.2, BL↔Bricqer)          readPriceGuide() (§3.3)
                                                     (single reader + STR)
                                                             │
        ┌──────────────┬──────────────┬───────────┬─────────┴──────────┐
     bl-basket    store-quality   POV/partout  inventory-explorer   analysis scripts
```

### 3.1 `capturePriceGuide()` — the single write path

**Module:** `src/lib/bricklink/price-guide/capture.ts`

```ts
// Normalised, source-agnostic input for one (item, colour) tuple.
interface PriceGuideCapture {
  item: { itemType: 'P'|'M'|'S'; itemNo: string; colourId: number /* canonical BL id */ };
  itemName?: string | null;
  quadrants: Partial<Record<'soldNew'|'soldUsed'|'stockNew'|'stockUsed', SideStats>>;
  scope: 'uk' | 'world';
  source: string;            // 'bl_api' | 'catalogpg' | 'store_api' | ...
  fetchedAt: string;
}
interface SideStats {        // everything needed to recompute STR + more
  lots: number; qty: number; avg: number|null; qtyAvg: number|null;
  median: number|null; min: number|null; max: number|null;
  last2moQty: number;        // recency
  transactions?: { unitPrice: number; qty: number; dateOrdered?: string }[]; // raw → hist/median
}

async function capturePriceGuide(cap: PriceGuideCapture): Promise<void>
```

Responsibilities:
- **Adapters in** (thin, per-source): `fromBlApi(sold, stock, condition, country)` computes
  `median`/`last2moQty`/`hist` from `price_detail[]`; `fromCatalogPg(PgScrapeResult)` (the existing
  `toPgCacheRow` path, refactored to feed this). Both emit `PriceGuideCapture`.
- **Canonical colour** via `colourMap()` (§3.2) — input colour ids normalised to **BL scheme**
  before write.
- **Coalescing upsert** — writes only the quadrants present, `COALESCE`-merging over the existing
  row so a used-only or sold-only call never clobbers other quadrants. Implemented as a Postgres
  RPC `upsert_price_guide(row jsonb)` (single round-trip, atomic) — **required**; naïve
  Supabase upsert clobbers.
- **Stores the raw components** so STR is always recomputable: `*_lots`, `*_qty` per quadrant,
  plus `uk_detail`/`world_detail` jsonb (min/max/byMonth/hist/transactions sample).
- UK calls fill `uk_*`; world calls fill `world_detail`. `parse_version` bumped.

### 3.2 `colourMap()` — canonical BL ↔ Bricqer mapping

**Module:** `src/lib/bricklink/colour-map.ts` + table `bricklink_colour_map`.

```
bricklink_colour_map(
  bl_colour_id int primary key,
  bl_colour_name text,
  bricqer_colour_id int,          -- nullable (not all BL colours exist in Bricqer)
  bricqer_colour_name text,
  rgb text
)
helpers:
  toBlColourId(id: number, scheme: 'bl'|'bricqer'): number
  toBricqerColourId(blId: number): number | null
  blColourName(blId: number): string
  normaliseColour(input, sourceScheme): { blId, name }
```

- **Built** (one-off + refreshable script) from the authoritative BL colour list
  (`getColorList` API / `catalogDownload viewType=5`) LEFT JOIN Bricqer colours (from
  `bricqer_inventory_snapshot.color_id`+`color_name`) on normalised name.
- **BL colour id is the canonical key** for `price_guide_cache` everywhere.
- Snapshot/Bricqer-sourced readers (store-quality) map Bricqer→BL at the boundary via this helper —
  replaces the ad-hoc 121-colour name map used in this session's one-offs.
- Minifigs/sets → colour 0 by convention (already the case).

### 3.3 `readPriceGuide()` — the single consumption path

**Module:** `src/lib/bricklink/price-guide/read.ts`

```ts
interface PriceGuideView {              // normalised, what analysis consumes
  item; itemName;
  used: SideView; new: SideView;        // per condition
}
interface SideView {
  soldAvg; soldMedian; soldQtyAvg; soldLots; soldQty; soldLast2moQty;
  stockLots; stockQty; stockMin;
  strLots;   // sold_lots / stock_lots   (house definition, ×1)
  strQty;    // sold_qty  / stock_qty    (Bricqer formula input)
  qtyShareAtOrAbove(price): number|null; // from hist (price-conditional STR)
  freshnessDays; coverage: 'uk' | 'world_fallback' | 'none';
}

async function readPriceGuide(items: ItemRef[], opts?: { ttlDays; allowWorldFallback }): Promise<Map<key, PriceGuideView>>
```

- **Single STR source of truth** — `strLots` and `strQty` computed here from stored components; no
  consumer computes STR by hand again. Aligns with [[feedback_str_definition]] (lead with lots-STR;
  qty-STR is the Bricqer/pricing input).
- Optional **world fallback** to `pg_summary` when no UK row exists (flagged in `coverage`), so
  consumers get a value + know its provenance.
- Colour ids accepted in either scheme (normalised via §3.2).

## 4. Downstream migration

### 4.1 Writers → `capturePriceGuide()`
- **Central hook:** `BrickLinkClient` is already constructed with a `supabase` handle
  (`new BrickLinkClient(creds, { supabase, caller })`). Add fire-and-forget capture inside
  `getPartPriceGuide`/`getSetPriceGuide` (opt-out flag) → **all ~15 API call sites** feed the rich
  cache with no per-caller change.
- Refactor `PriceGuideCacheService.upsert` (catalogPG) to call `capturePriceGuide` via `fromCatalogPg`.
- Remove `PartPriceCacheService.upsertPrices` writers (bl-basket, analyze-bl-store, `_str-sample`,
  `cleanup-bad-cache-rows`) — they get capture for free from the client hook.

### 4.2 Readers → `readPriceGuide()`
Production surface (9): `inventory-explorer/bricklink-lookup.ts` (`fetchBLCache`) + `enrichment.service.ts`,
`api/inventory/explorer/sync-status`, `bricklink/partout.service.ts` + `api/bricklink/partout/{route,stream}`,
`store-quality/engine.ts` + `pricing.ts`, `bricklink/live-check.service.ts`.
Scripts (~19): bl-basket, analyze-bl-store, reprice-*, scan-*, partout-bricqer-pricing, evaluate-job-lot,
find-piece, etc. (dead `_`-prefixed one-offs excluded — left to die with the table).

Each reader: swap the raw `.from('bricklink_part_price_cache')` for `readPriceGuide()`, replace
`sell_through_rate_*` with `strLots`/`strQty`, and drop any bespoke colour handling (now in §3.2).
**Dual-read** during transition: `readPriceGuide` tries `price_guide_cache`, falls back to the legacy
table until backfill completes, so nothing regresses.

## 5. Backfill (coverage 1,387 → 35,031)
Hybrid:
1. **Lossy migrate now** — map the 35k thin rows into `price_guide_cache` (avg + counts only,
   `parse_version=0`, null median/hist/recency), colour-normalised via §3.2, for immediate coverage.
2. **Rich re-fetch queue** — background job re-pulls tuples via the API (through `capturePriceGuide`)
   prioritised by our-inventory + demand rank, upgrading `parse_version=0` rows over time (~1,500
   calls/day headroom; every basket/scan run also upgrades on the fly).

## 6. Data model changes
- New table `bricklink_colour_map` (§3.2) + migration.
- Postgres RPC `upsert_price_guide(jsonb)` — coalescing upsert (§3.1).
- Possibly add `source` + `scope` columns to `price_guide_cache` if not already inferable from
  `uk_detail`/`world_detail` (confirm during build).
- No change to `pg_summary`.

## 7. Risks
| Risk | Mitigation |
|---|---|
| **Colour scheme** (mixed legacy, silent wrong joins) | Canonical map §3.2 built first + verified; BL id canonical; legacy `colour_id` never trusted for migration (re-key by name where needed) |
| **Coverage regression** on cutover | Dual-read + lossy backfill before removing fallback |
| **Coalescing upsert clobber** | Atomic RPC, unit-tested per-quadrant |
| **STR semantic drift** | Single `readPriceGuide` STR source; both definitions exposed + labelled |
| **Prod UI (explorer/POV/store-quality)** | Migrate behind dual-read; verify each against live before removing fallback |

## 8. Phasing → see `done-criteria.md`
Ship **F1–F4 (capture + colour map)** first as an independent, additive PR (the "no wasted calls"
win, low risk). Reader migration (F5+) follows behind dual-read.

## 9. Open decisions
1. Backfill: hybrid (recommended) vs rich-only vs lossy-only?
2. Reader scope: prod + active scripts only (recommended), dead one-offs left to the table drop?
3. Ship capture (F1–F4) independently first (recommended) vs one big PR?
4. Canonical colour scheme = **BL id** (recommended) — confirm.

Builds on [[bl-pg-summary-coverage]], [[bricqer-pricing-formula]], [[store-quality-framework]],
[[bl-store-comparison-str-pricing-study]] (three-cache map + colour hazard origin).
