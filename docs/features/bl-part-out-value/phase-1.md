# BrickLink Part Out Value (POV) — Phase 1 spec

**Branch:** `feature/bl-part-out-value`
**Phase:** 1 of 4 — scrape engine + cache + CLI (New condition only)
**Status:** ready to build (nothing written yet)

---

## 1. Why

We want BrickLink's **authoritative** Part Out Value (POV) for a set — BL's own "Average of
last 6 months Sales" and "Current Items For Sale Average" — cheaply and cached, plus a
**Part-Out multiple** vs UK retail so we can spot sets worth buying to part out.

The app already has a *computed* part-out (`PartoutTab` / `usePartout()`) that sums every lot's
price via the **BL REST API** — 100+ API calls per set, burning our ~1,500/day budget. POV gives
the same headline number in **one HTTP page load** and costs **zero API budget** (it's HTML, not
the REST API). The two are complementary: POV = authoritative headline; computed = lot-level
breakdown.

## 2. Validated findings (live probes, set 77075)

Decoded endpoint (GET, server-rendered HTML, no separate API call):

```
https://www.bricklink.com/catalogPOV.asp
  ?itemType=S&itemNo=<SET>&itemSeq=1&itemQty=1
  &breakType=M        # M = parts + whole minifigs (the dropdown default); B = break figs to parts
  &itemCondition=N    # N = New, U = Used
  &incInstr=Y         # + &incBox=Y &incExtra=Y &incBreak=Y as needed
```

Probe results:
- **Logged-in, in-page `fetch({credentials:'include'})`** → HTTP 200, full HTML, **GBP** (account
  locale), all 3 columns incl. "My Inventory Average". Parsed: sold £25.65 / for-sale £30.77 /
  241 items / 126 lots. ✅
- **Logged-out, same XHR fetch (cookies omitted)** → **HTTP 202, empty body** (BL anti-bot path
  for credential-less AJAX). ❌ — do **not** use fetch for logged-out.
- **Logged-out, real page *navigation* (fresh incognito context)** → renders fine, **no login
  redirect**, `hasPOV:true`. Returns **USD** (`US $34.63` / `US $41.12`), 2 public columns (no
  "My Inventory"). ✅

**Consequences baked into the design:**
1. **Scrape via `Page.navigate` + read rendered text** — one code path that works logged-in *and*
   logged-out. (Do not rely on the XHR fetch.)
2. **Currency depends on session:** logged-in = GBP, logged-out = USD → store native currency +
   value **and** a GBP-converted value (reuse the USD→GBP derivation already in `scan-bl-store.ts`).
3. Logged-out has no "My Inventory" column — fine, we don't need it for valuation.

## 3. Locked decisions

| Decision | Choice |
|---|---|
| Scrape method | Page navigation + parse rendered text (works logged-in & logged-out) |
| On-demand run context (Phase 1 CLI) | Logged-in tab → GBP, instant |
| Bulk backfill (Phase 2) | **User-triggered**, logged-out **+ VPN**, incognito context → USD→GBP |
| Backfill order (Phase 2) | **Newest sets first** (most stock availability, less sealed-rarity distortion) |
| Condition | **New only** to begin with; Used deferred |
| Web "Fetch/Refresh" (Phase 3) | Live-fetch via **local dev server** (it can reach local Chrome); cache-only fallback elsewhere |
| Cadence | Conservative defaults in config, tuned per-run by conversation |
| Retail source | Brickset **UK RRP** (`LEGOCom.UK.price`, GBP), reusing the app's existing Brickset cache (API only on miss) |
| Part-Out multiple numerator | **6-month *sold* average** (realistic), in GBP |

## 4. Architecture (local writes, cloud reads)

```
 Local Windows (Chrome CDP :9225) ── pov-fetch.ts / skill (logged-in)   ┐ writes
                                      pov-backfill.ts (logged-out + VPN) ┘   ▼
                                                Supabase: pov_cache + pov_config
                                                                            ▲ reads / live-fetch
 Cloud (Vercel) / Local dev ── set-lookup "Official POV" card ── /api/bricklink/part-out-value
```
Vercel cannot reach local Chrome, so cloud **reads cache**; live scraping only happens where a
logged-in/-out Chrome on :9225 is reachable (local dev server, scripts, skill).

## 5. Phase 1 scope

**In:** DB tables + generated types · shared engine module · cache service · `pov-fetch.ts` CLI ·
Brickset RRP wiring + Part-Out multiple · gentle live test.
**Out (later phases):** backfill loop & VPN/logged-out batch (P2), Used condition, API routes &
web card (P3), conversational skill & Vinted hook (P4).

## 6. Data model

### `bricklink_part_out_value_cache` (per set + option-variant)
Mirror `bricklink_part_price_cache` conventions (UUID PK, `fetched_at`/`created_at`/`updated_at`,
RLS read+write for `authenticated`).

Columns:
- Keys: `set_number TEXT`, `item_seq INT DEFAULT 1`, `condition CHAR(1) DEFAULT 'N'`,
  `break_type CHAR(1) DEFAULT 'M'`, `inc_instructions BOOL DEFAULT true`,
  `inc_box BOOL DEFAULT false`, `inc_extra BOOL DEFAULT false`, `inc_break BOOL DEFAULT false`
- Identity: `set_name TEXT`
- Native scrape: `native_currency TEXT`, `sold_6mo_native NUMERIC`, `sold_6mo_items INT`,
  `sold_6mo_lots INT`, `for_sale_native NUMERIC`, `for_sale_items INT`, `for_sale_lots INT`,
  `my_inv_native NUMERIC NULL`, `my_inv_items INT NULL`, `my_inv_lots INT NULL`,
  `not_included_items INT`, `not_included_lots INT`
- GBP: `sold_6mo_avg_gbp NUMERIC`, `for_sale_avg_gbp NUMERIC`, `usd_to_gbp_rate NUMERIC NULL`
- Retail: `uk_retail_gbp NUMERIC NULL`, `retail_source TEXT NULL`, `retail_fetched_at TIMESTAMPTZ NULL`
- Derived: `partout_multiple NUMERIC GENERATED ALWAYS AS (sold_6mo_avg_gbp / NULLIF(uk_retail_gbp,0)) STORED`
- Timestamps: `fetched_at TIMESTAMPTZ DEFAULT now()`, `created_at`, `updated_at`
- `UNIQUE (set_number, item_seq, condition, break_type, inc_instructions, inc_box, inc_extra, inc_break)`
- Indexes: `(set_number)`, `(fetched_at)`, `(partout_multiple)` for ranking.

### `bricklink_pov_config` (single row — conversationally editable defaults)
`default_condition CHAR(1) DEFAULT 'N'`, `default_break_type CHAR(1) DEFAULT 'M'`,
`default_inc_instructions BOOL DEFAULT true`, `default_inc_box/extra/break BOOL DEFAULT false`,
`freshness_days INT DEFAULT 30`, `backfill_delay_ms INT DEFAULT 12000`,
`backfill_batch_size INT DEFAULT 25`, `usd_to_gbp_rate NUMERIC NULL` (fallback), `updated_at`.

Aliases added to `packages/database/src/index.ts`:
`BrickLinkPartOutValue`, `BrickLinkPartOutValueInsert`, `BrickLinkPartOutValueUpdate`, `BrickLinkPovConfig`.

## 7. Shared engine — `apps/web/src/lib/bricklink/part-out-value.ts`

- `buildPovUrl(opts): string` — opts `{ setNumber, itemSeq=1, condition='N', breakType='M', incInstructions=true, incBox=false, incExtra=false, incBreak=false }`.
- `parsePovHtml(text): PovParseResult` — strip tags, collapse whitespace, slice each label, capture
  value + items + lots + **currency token** (`GBP` or `US $`). Tolerates `my_inv` absent. Returns a
  null-shaped result (not a throw) on a non-POV page.
- `scrapePovByNavigation(opts, { cdpPort=9225, context })` — drive a tab (or fresh incognito context),
  one navigation, read `document.body.innerText`, parse. Throws typed `LoginRequiredError` /
  `CaptchaError` / `NotFoundError` when the page is not a valid POV result.
- `PartOutValueCacheService` — `getCached(setNumber, opts)`, `upsert(result)`, `getFreshnessDays()`
  (env `POV_CACHE_FRESHNESS_DAYS`, default from config / 30). Mirrors `PartPriceCacheService`
  (direct Supabase client, batch-safe upsert on the option-variant unique key).
- Retail: resolve UK RRP via the app's **existing** Brickset cache/service (API only on miss);
  convert to GBP; denormalise onto the row so `partout_multiple` computes.

## 8. CLI — `apps/web/scripts/pov-fetch.ts`

```
npx tsx scripts/pov-fetch.ts --set=<n> [--condition=N --break-type=M --[no-]instructions --force]
```
Cache-first (returns fresh without scraping); `--force` re-scrapes; upserts; Zod-validated args;
loads `.env.local`. Prints set name, both averages (value/items/lots), currency, UK RRP, **Part-Out
multiple**, and cache hit/miss + age.

## 9. Done criteria (F1–F8)

| # | Criterion | Measurement (pass test) |
|---|---|---|
| **F1** | Migration: `bricklink_part_out_value_cache` + `bricklink_pov_config` per part-cache conventions (UUID PK, timestamps, RLS read+write, unique on set+option-variant, generated `partout_multiple`). | `npm run db:push` ok; both tables in `list_tables`; unique + RLS present; generated column exists; `db:types` regenerates; aliases exported in `packages/database/src/index.ts`; `npm run typecheck` clean. |
| **F2** | `parsePovHtml(text)` extracts sold + for-sale (value/items/lots) and currency (`GBP` and `US $`); tolerates `my_inv` absent. | Unit tests on 2 fixtures: logged-in GBP £25.65/241/126 and logged-out USD $34.63/241/126 (set 77075) return exact values; non-POV fixture returns null-shaped (no throw). |
| **F3** | Engine `buildPovUrl` + `scrapePovByNavigation`: one navigation, parses; throws typed errors on login/captcha/not-found. | `buildPovUrl` unit matches known-good URL for defaults. Live: real set → populated result; bad set number → `NotFoundError`, no crash. |
| **F4** | `PartOutValueCacheService`: `getCached` / `upsert` / `getFreshnessDays`; upsert idempotent on the variant key. | upsert→getCached round-trips; second upsert updates (not duplicates) and bumps `fetched_at`; row older than freshness reported stale. |
| **F5** | CLI `pov-fetch.ts` cache-first with `--force`; clean printed result incl. currency + age. | First call scrapes+caches (miss); immediate second call returns from cache (hit, no navigation); `--force` re-scrapes; logged-in run reports GBP; output shows name, both averages, currency, age. |
| **F6** | Rate-limit discipline end-to-end. | Review confirms cache-first, single navigation per fetch, typed stop on login/captcha (no retry loop), uses existing logged-in tab. Test run touches BL ≤ distinct uncached sets requested. |
| **F7** | UK retail on the row: `uk_retail_gbp` + `retail_source` + `retail_fetched_at`, from existing Brickset cache (API only on miss); nullable when Brickset lacks RRP. | `pov-fetch --set=<n>` stores UK RRP; known-RRP set shows it; no-RRP set stores null (no crash); no duplicate Brickset API call when already cached. |
| **F8** | Part-Out multiple: generated `partout_multiple = sold_6mo_avg_gbp / NULLIF(uk_retail_gbp,0)`, null-safe; CLI prints e.g. `Part Out: 3.0× retail`. | Row sold=£30, retail=£10 → `3.0`; retail null/0 → null; refreshing POV recomputes automatically. |

### Non-functional gates
`npm run typecheck` + `npm run lint` clean · no credentials committed · Zod-validated CLI args ·
scratch probes (`_probe-pov*.mjs`) deleted once their logic lives in the module.

## 10. Verification demo (the "done" run)

```
npx tsx apps/web/scripts/pov-fetch.ts --set=77075          # scrape + cache (miss)
npx tsx apps/web/scripts/pov-fetch.ts --set=77075          # cache hit, no BL hit
npx tsx apps/web/scripts/pov-fetch.ts --set=77075 --force  # re-scrape
```
Expected (logged-in, GBP):
```
77075 Peely & Sparkplug's Camp
  Sold avg (6mo) : £25.65  (241 items / 126 lots)
  For-sale avg   : £30.77
  UK RRP (Brickset): £XX.XX
  Part Out       : N.N× retail
  cached: fetched 0m ago (miss → scraped)
```
Second call must demonstrably skip BL (cache hit).

## 11. Interpretation notes (so the multiple isn't misread)
1. RRP is the **launch** price — retired sets often trade above RRP, discounted below — so a high
   multiple vs RRP ≠ guaranteed margin vs what you'd *pay*. A later phase can add a second multiple
   vs actual acquisition cost (e.g. Vinted price) when that flows in.
2. Numerator is *sold* avg (realistic). A `partout_multiple_forsale` (optimistic) is a trivial add
   once F8's pattern exists.

## 12. Later phases (for context, not Phase 1)
- **P2 Backfill:** `pov-backfill.ts` — user-triggered, logged-out incognito + VPN, newest-first,
  New condition, skip-fresh, configurable delay/batch, lock file, stop on captcha/login, USD→GBP,
  optional Resend summary.
- **P3 Web:** `GET /api/bricklink/part-out-value` (cache+age), `POST …/fetch` (live via local dev
  server), `GET/PUT …/config`; set-lookup Partout "Official POV" card with age badge + multiple.
- **P4 Skill + Vinted:** `bl-part-out-value` conversational skill (live fetch, batch, edit config),
  reusing `scrapePovByNavigation` as the Vinted-scraper extension point.

## 12b. Implementation status — SHIPPED (all 4 phases, 2026-06-16)

Built on `feature/bl-part-out-value`; migration recorded as `20260616090152_create_bricklink_part_out_value`.

- **Phase 1 (engine)** — `part-out-value.ts` (URL/parser/`PovScraper` navigation/typed errors incl.
  `EmptyResponseError`), `part-out-value-cache.service.ts` (cache + config + `getUkRetailGbp` + the shared
  `getPovForSet` helper), `pov-fetch.ts` CLI. 12 unit tests pass; typecheck/lint/build clean.
- **Phase 2 (backfill)** — `pov-backfill.ts`: newest-first from `brickset_sets`, numeric 4–5 digit sets,
  `--require-rrp` default on, skip-fresh, lock file, stop-on-captcha/login/empty, logged-out+USD path.
- **Phase 3 (web)** — `GET/POST /api/bricklink/part-out-value` (+`/config`), `OfficialPovCard` mounted atop
  the Partout tab. POST live-scrapes via local CDP and **gracefully degrades to cache-only** off-box.
- **Phase 4 (skill+Vinted)** — `.claude/commands/bl-part-out-value.md`; Vinted hook = `getPovForSet`.

**POC seed (~100 newest RRP sets, logged-in/GBP):** 90 seeded + 10 pre-seeded = 104 cache rows, 101 with
computed multiples (avg 1.74×, max 3.23× = 77254 Ferrari), 0 errors. Top signals: Bugs Bunny 3.04×, FIFA
Trophy 2.95×, Iron Man Mk3 CE 2.48×.

**Key operational findings:**
- Logged-out scraping works only via **page navigation** (XHR returns HTTP 202/empty), returns **USD**, and
  gets **IP soft-blocked from a residential IP after a handful of hits** — i.e. production bulk backfill must
  run logged-out **behind a VPN** (exactly as specified). The POC therefore ran **logged-in/GBP** for
  reliability; this is the one deviation from the logged-out-bulk design, and it's account-gentle at 100 sets
  with 7s spacing.
- `brickset_sets` already holds `set_number`/`year_from`/`uk_retail_price`, so both the newest-set list and
  UK RRP come from one local query — **zero Brickset API calls**.

## 13. Reference files (mirror these)
- Cache table + service: `supabase/migrations/20260120160000_create_bricklink_part_price_cache.sql`,
  `apps/web/src/lib/bricklink/part-price-cache.service.ts`
- CDP scrape pattern: `apps/web/scripts/scan-bl-store.ts` (CDPClient, lock file, USD→GBP, captcha stop)
- Graceful-offline + Resend: `apps/web/scripts/bl-proactive-daily.ts`
- Brickset lookup/pricing: `apps/web/src/app/api/brickset/pricing/route.ts`, `apps/web/src/app/(dashboard)/set-lookup/`
- Generated types: `packages/database/src/types.ts`, aliases `packages/database/src/index.ts`
- Validated probe logic (delete after folding in): `apps/web/scripts/_probe-pov.mjs`, `_probe-pov-loggedout.mjs`
```
