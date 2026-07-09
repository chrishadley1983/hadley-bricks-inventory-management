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

### 3.1 `ensurePriceGuide()` + `capturePriceGuide()` — the single write path

**Module:** `src/lib/bricklink/price-guide/capture.ts`

**Decision (Chris, 2026-07-09): always grab ALL four quadrants and write a complete row.** The BL
API is one quadrant per call (`new_or_used` × `guide_type`), so a complete tuple = **4 calls**
(UK: soldNew, soldUsed, stockNew, stockUsed). Fetching all four means every write is a **complete
row** → a plain upsert, **no coalescing RPC**, and we capture New even on used-focused scans and
never re-fetch a missing condition. Cost: 4 calls per fresh tuple (vs 2 for a used-only scan today),
offset by the 90-day TTL + "never re-fetch". World scope (`country_code` omitted) is a separate
optional 4-call pass into `world_detail`; default is UK-only.

```ts
interface SideStats {        // everything needed to recompute STR + more
  lots: number; qty: number; avg: number|null; qtyAvg: number|null;
  median: number|null; min: number|null; max: number|null;
  last2moQty: number;        // recency
  transactions?: { unitPrice: number; qty: number; dateOrdered?: string }[]; // raw → hist/median
}
interface PriceGuideCapture {           // a COMPLETE tuple (all 4 quadrants present)
  item: { itemType: 'P'|'M'|'S'; itemNo: string; colourId: number /* canonical BL id */ };
  itemName?: string | null;
  scope: 'uk' | 'world';
  soldNew: SideStats; soldUsed: SideStats; stockNew: SideStats; stockUsed: SideStats;
  source: string; fetchedAt: string;
}

// Orchestrator + primary entry point for consumers. Cache-first; on miss/stale, fetches all 4
// quadrants, captures a complete row, returns the read view (§3.3).
async function ensurePriceGuide(client, item, colourId, opts?: { ttlDays; scope }): Promise<PriceGuideView>
// Low-level writer (plain upsert on item_type,item_no,colour_id). Used by ensurePriceGuide + fromCatalogPg.
async function capturePriceGuide(cap: PriceGuideCapture): Promise<void>
```

Responsibilities:
- **`ensurePriceGuide`** is what consumers call instead of raw `getPartPriceGuide` pairs. Cache-check
  via `readPriceGuide`; if fresh → return it; if stale → 4 API calls → `capturePriceGuide` → return.
- **Adapters in** (per-source): `fromBlApi(sold*, stock*)` computes `median`/`last2moQty`/`hist` from
  `price_detail[]`; `fromCatalogPg(PgScrapeResult)` (the existing `toPgCacheRow`, refactored) — both
  emit a complete `PriceGuideCapture`.
- **Canonical colour** via `colourMap()` (§3.2) — colour ids normalised to **BL scheme** before write.
- **Plain upsert** on `(item_type, item_no, colour_id)` — rows are always complete, so no merge logic.
- **Stores the raw components** so STR is always recomputable: `*_lots`, `*_qty` per quadrant, plus
  `uk_detail`/`world_detail` jsonb (min/max/byMonth/hist/transactions sample). `parse_version` bumped.

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

### 4.1 Writers → `ensurePriceGuide()` / `capturePriceGuide()`
- **Consumers stop calling raw `getPartPriceGuide` pairs** and call `ensurePriceGuide(item, colour)`
  which fetches all 4 quadrants (if stale) and returns the read view — one call replaces the
  sold+stock pair per condition, and captures the complete row as a side effect.
- Refactor `PriceGuideCacheService.upsert` (catalogPG) to call `capturePriceGuide` via `fromCatalogPg`.
- Retire `PartPriceCacheService.upsertPrices` writers (bl-basket, analyze-bl-store, `_str-sample`,
  `cleanup-bad-cache-rows`) — they now write the rich cache via `ensurePriceGuide`.
- Raw `getPartPriceGuide`/`getSetPriceGuide` remain for low-level/edge use but are no longer the
  standard price path.

### 4.2 Readers → `readPriceGuide()`
Production surface (9): `inventory-explorer/bricklink-lookup.ts` (`fetchBLCache`) + `enrichment.service.ts`,
`api/inventory/explorer/sync-status`, `bricklink/partout.service.ts` + `api/bricklink/partout/{route,stream}`,
`store-quality/engine.ts` + `pricing.ts`, `bricklink/live-check.service.ts`.
Scripts (~19): bl-basket, analyze-bl-store, reprice-*, scan-*, partout-bricqer-pricing, evaluate-job-lot,
find-piece, etc. Dead `_`-prefixed one-offs are **excluded but must be marked** (Chris, 2026-07-09):
add a header comment `// DEPRECATED: reads bricklink_part_price_cache (dropped). Do not use as a
pattern.` so they are not copied later. They break when the table drops — that's intended.

Each reader: swap the raw `.from('bricklink_part_price_cache')` for `readPriceGuide()`, replace
`sell_through_rate_*` with `strLots`/`strQty`, and drop any bespoke colour handling (now in §3.2).
**No legacy dual-read** — coverage gaps are covered by `readPriceGuide`'s worldwide `pg_summary`
fallback (§5), so readers cut straight over.

## 5. Coverage rebuild — **drop, don't migrate** (Chris, 2026-07-09)

Better to have thinner, *accurate* data than a large inconsistent cache. So the 35k thin/mixed-colour
rows are **not migrated**:
- **No lossy migration.** Legacy `part_price_cache` is dropped (§F9); its rows are not carried over.
  This also removes the colour-scheme migration risk entirely — we never re-key legacy `colour_id`.
- **Coverage rebuilds via real fetches:** `ensurePriceGuide` fills any tuple on first access (4 calls,
  cached 90d), plus a **prioritised re-fetch queue** pre-warms our-inventory + high-demand tuples so
  prod surfaces (Inventory Explorer, POV, store-quality) are populated around cutover.
- **No coverage cliff:** `readPriceGuide` falls back to worldwide `pg_summary` (flagged
  `coverage:'world_fallback'`) for any not-yet-fetched tuple — a usable number with honest provenance
  that upgrades to UK-accurate as the queue fills. This is why **no legacy dual-read is needed**.

## 6. Data model changes
- New table `bricklink_colour_map` (§3.2) + migration.
- **No coalescing RPC** — rows are always complete (§3.1), so a plain upsert on
  `(item_type, item_no, colour_id)` suffices.
- Add `source` + `scope` columns to `price_guide_cache` if not inferable from `uk_detail`/`world_detail`
  (confirm during build).
- Drop `bricklink_part_price_cache` at §F9 (rename-then-drop). No change to `pg_summary`.

## 7. Risks
| Risk | Mitigation |
|---|---|
| **Colour scheme** (mixed legacy, silent wrong joins) | Canonical map §3.2 built + verified first; BL id canonical; legacy `colour_id` never migrated (table dropped, not carried over) |
| **Coverage regression** on cutover | `pg_summary` world-fallback in `readPriceGuide` + pre-warm queue; accepted "thinner-but-accurate" per §5 |
| **4-calls-per-tuple cost** | 90-day TTL + never-re-fetch; pre-warm queue paced within ~1,500/day headroom |
| **STR semantic drift** | Single `readPriceGuide` STR source; both definitions exposed + labelled |
| **Prod UI (explorer/POV/store-quality)** | `/verify-done` each reader against live before merge; world-fallback prevents blank UI |

## 8. Build shape (Chris, 2026-07-09: **do it all in one feature**)
Single feature build, F1–F9 in order (see `done-criteria.md`) — not split into separate PRs. F1–F5
(colour map + capture + read) land the common functions; F6–F9 migrate consumers and drop the legacy
table. Chris triggers the build via a goal.

## 9. Decisions (locked 2026-07-09)
1. **Drop, don't migrate** — no lossy backfill; rebuild via real fetches + `pg_summary` fallback.
2. **Reader scope:** prod app + active scripts; dead `_`-prefixed one-offs **excluded but marked** with
   a deprecation header comment.
3. **One feature build** (F1–F9), not split PRs.
4. **Canonical colour = BL colour id.**
5. **Capture always grabs all 4 quadrants** → complete rows → plain upsert (no coalescing RPC).

Builds on [[bl-pg-summary-coverage]], [[bricqer-pricing-formula]], [[store-quality-framework]],
[[bl-store-comparison-str-pricing-study]] (three-cache map + colour hazard origin).
