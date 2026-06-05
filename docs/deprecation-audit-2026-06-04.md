# Deprecation & Dead-Code Audit — Hadley Bricks

**Date:** 2026-06-04
**Scope:** `apps/web/src/**`, `apps/web/scripts/`, `scripts/`, `packages/**`, `supabase/migrations/**`. Excluded: `node_modules`, `.next`, `docs/`, generated types (`packages/database/src/types.ts`), test fixtures.
**Mode:** Report only — **no code was modified, deleted, or committed.**

**Method:** `knip` static analysis (unused files / exports / dependencies) + four targeted reference-graph audits (scripts, superseded/legacy, duplication, API routes), each verifying the negative (grep for importers/callers) before flagging. External entry points were explicitly accounted for: `app/api/cron/**` is triggered by **Google Cloud Scheduler** (`gcp/setup.ps1`) and GitHub Actions curl (`.github/workflows/*-cron.yml`) — the GitHub schedules are disabled ("moved to Google Cloud Scheduler"); `app/api/service/**` and `app/api/webhooks/**` are external callers; Next.js route/page conventions and barrel `index.ts` re-exports were treated as live unless proven otherwise.

> **Note on `supabase/functions/**`:** this directory does not exist in the repo — there are no Supabase Edge Functions, only 171 SQL migrations. Migrations are append-only history and are **out of scope for removal** (none flagged).

---

## Implementation Status (updated 2026-06-05)

Branch: `refactor/deprecation-audit-cleanup` (pushed to origin).

**Done & committed — all typecheck-green; 90 targeted tests pass:**
- `0025353` — Phases 1–5: removed 2 unused deps (`@google/generative-ai`, `@reduxjs/toolkit`); ~20 dead src files + dead barrels; 5 dead/debug API routes; 4 superseded symbols (`allocateCostsProportionally`, `getUnfulfilledOrders`, `getAuctionCountForDate`, gmail private `getClient`) + their tests; ~31 obsolete one-off scripts / stray root files.
- `cd17099` — Phase 6 (partial): `parseCurrencyValue` consolidated into `lib/utils/currency.ts` (§1.5, proven behavior-equivalent across all 5 sites); added shared `sleep()` to `lib/utils.ts` and `verifyCronAuth()` in `lib/api/cron-auth.ts`.

**Decision (2026-06-05):** scope this change set to **behavior-neutral consolidations only**; take the truly high-blast-radius refactors as separate, individually-tested PRs.

**Remaining for this branch (safe consolidations):**
- Adopt `sleep` across ~30 platform-client sites.
- Adopt `verifyCronAuth` across ~43 `app/api/cron/**` routes (preserving per-route warn logs).
- Adopt `formatCurrency` only at provably-equivalent inline sites (skip any with custom fraction digits / differing null handling).
- Verify: `typecheck` + `lint` + `test:batched` + `build`; then code review → merge → Vercel production deploy (run `npm run db:push` if the `20260603000001_unified_markdown.sql` migration is unapplied) → smoke test.

**Deferred to separate follow-up PRs (high blast radius — do incrementally behind tests):**
- §1.1 Supabase pagination adoption onto `fetchAllRecords`/`fetchPaginated` (~60 sites, incl. ~17 copies in `profit-loss-report.service.ts`).
- §1.2 `withAuth` / `validateAuth` HOF across ~327 route handlers (auth-critical).
- §1.6 `formatCurrency` adoption at the `src/lib` sites needing per-site equivalence review.
- §1.7–§1.10 generic `fetchWithRetry`, `BaseTransactionSyncService`, shared `OAuthTokenManager`, shared `TransactionRow` base type (financial/security paths).

---

## Summary

| Category | Findings | High conf. | Headline |
|---|---|---|---|
| 1. Duplicated logic | 11 patterns | 6 | Shared helpers exist but are **unused** while 60+ sites hand-roll the same code |
| 2. Dead / unreferenced code | ~25 files + clusters | ~18 | knip: 30 dead **src** files (excl. scripts), 2 dead route/feature clusters |
| 3. Superseded code | 6 | 6 | markdown-engine refactor is clean; small dead barrels + `@deprecated` leftovers |
| 4. Stale code (scripts) | ~45 scripts | ~20 | Large one-off/debug graveyard in `apps/web/scripts/` & `scripts/` |
| 5. Unused dependencies | 2 | 2 | `@google/generative-ai` (superseded), `@reduxjs/toolkit` |

**Biggest wins:** (1) adopt the already-written Supabase pagination helper to collapse ~60 duplicated loops; (2) delete ~30 confirmed-dead src files; (3) prune ~20 obsolete one-off scripts; (4) drop 2 unused deps.

---

## 1. Duplicated Logic

Ordered by impact. All verified by reading the actual code.

### 1.1 Supabase 1000-row pagination — reimplemented 60+ times (HIGH, highest impact)
A correct shared helper **already exists and is used by nobody**: `apps/web/src/lib/supabase/pagination.ts` (`fetchAllRecords`, `fetchPaginated`, `getAccurateCount`) — knip confirms zero importers. Meanwhile the `while (hasMore) { ...range(page*size, …) }` loop is hand-rolled in 60+ places, including **~17 copies in one file** (`lib/services/profit-loss-report.service.ts`), plus `lib/keepa/keepa-import.service.ts` (×4), `lib/investment/*`, `lib/repositories/{inventory,order,purchase}.repository.ts`, `lib/minifig-sync/*` (×7), `lib/arbitrage/*`, `lib/monzo/monzo-sheets-sync.service.ts`, `lib/shopify/sync.service.ts`, and several cron routes.
- **Action:** consolidate onto `fetchAllRecords`/`fetchPaginated`. **Blast radius:** large file count but low risk (helper is typed and battle-shaped); migrate file-by-file.

### 1.2 User-auth block inlined in ~327 route files (HIGH)
`const supabase = await createClient(); const { data:{user} } = await supabase.auth.getUser(); if (!user) return 401;` appears in 327 route files (451 occurrences). A `validateAuth()` helper exists (`lib/api/validate-auth.ts`) but is used in only ~36 (<10%) — and it also adds x-api-key support, so adopting it is a security/consistency win too.
- **Action:** introduce `withAuth(handler)` HOF / standardize on `validateAuth`. **Blast radius:** very large but mechanical; migrate opportunistically.

### 1.3 `CRON_SECRET` bearer check copy-pasted in 44 cron routes (HIGH)
Identical bearer-token check in every `app/api/cron/**/route.ts`; no shared helper.
- **Action:** add `verifyCronSecret(request)` / `withCron(handler)` to `lib/api-utils.ts`. **Blast radius:** 44 files, mechanical, security-positive (one place to harden).

### 1.4 `sleep(ms)` reimplemented ~30+ times (HIGH)
`private sleep(ms){ return new Promise(r => setTimeout(r, ms)); }` duplicated across every platform client/service (amazon ×7, bricqer, shopify, monzo, paypal, ebay, …; `amazon-finances.client.ts` defines it twice).
- **Action:** one exported `sleep`/`delay` in `lib/utils.ts`. **Blast radius:** many files, zero behaviour change.

### 1.5 `parseCurrencyValue` defined 5× (HIGH)
Identical bodies in `bricklink/bricklink-transaction.types.ts:200`, `brickowl/brickowl-transaction.types.ts:196`, `bricqer/bricqer-batch-sync.types.ts:155`, `bricklink/adapter.ts:44`, `brickowl/adapter.ts:47`.
- **Action:** extract one into `lib/utils.ts`; delete the other 4. **Blast radius:** small (5 sites, pure fn).

### 1.6 Inline GBP currency formatting reinvented ~34× (HIGH)
Canonical `formatCurrency()` exists at `lib/utils.ts:11`, yet `new Intl.NumberFormat('en-GB', {style:'currency',currency:'GBP'})` is re-written inline in ~34 components/services (e.g. `charts/stat-card.tsx`, `hooks/use-metrics.ts`, `features/buy-box-gap/*` ×3, `features/workflow/MetricCard.tsx`, `transactions/page.tsx`, `lib/arbitrage/calculations.ts`, `lib/notifications/discord.service.ts`).
- **Action:** import `formatCurrency`; add a shared `formatSalesRank` for the `#NumberFormat` variant. **Blast radius:** large count, trivial per file.

### 1.7 `fetchWithRetry` / 429-backoff reimplemented per client (MED)
Same retry+exponential-backoff control flow in `rebrickable/rebrickable-api.ts:63`, `keepa/keepa-client.ts:480`, `google/sheets-client.ts:101` (`withRetry`), and inline in several `amazon/*.client.ts`. Differ only by auth header / error class.
- **Action:** generic `fetchWithRetry(url, {headers, maxRetries, onError})`. **Blast radius:** medium; care around per-API error types.

### 1.8 Transaction-sync services are parallel reimplementations (MED)
`{bricklink,brickowl,amazon,ebay,paypal}-transaction-sync.service.ts` share the same scaffold (`BATCH_SIZE=100` upsert batching, sync-log lifecycle, `getConnectionStatus` — the latter appears in 23 files). Headers literally say "Follows the BrickLink/PayPal pattern".
- **Action:** `BaseTransactionSyncService`; subclasses supply fetch + row mapping. **Blast radius:** high (financial data) — do incrementally behind existing tests.

### 1.9 OAuth token-refresh services parallel across platforms (MED)
`{paypal,monzo,ebay,google-calendar}-auth.service.ts` share the `getAccessToken` expiry-check → token endpoint → re-encrypt → persist skeleton (refresh buffers differ: paypal 5min, ebay 10min).
- **Action:** shared `OAuthTokenManager` parameterized by token-fetch strategy + table mapping. **Blast radius:** medium-high, security-sensitive — careful refactor. *(Credential encrypt/decrypt itself is already centralized — good.)*

### 1.10 Per-platform `TransactionRow` interfaces overlap (MED, type-only)
`{bricklink,brickowl,amazon,ebay,paypal}` sync services each redeclare a near-identical financial-row interface.
- **Action:** shared base type, ideally derived from `@hadley-bricks/database` generated types. **Blast radius:** low (type-only).

> **Already well-factored (no action):** `crypto`/`CredentialsRepository`, `components/ui/data-table`, `SyncStatusBadge`, the `formatCurrency`/`formatDate` definitions. The problem above is *non-adoption*, not absence.

---

## 2. Dead / Unreferenced Code

### 2.1 Confirmed-dead `src` files (knip + grep-verified, 0 importers) — HIGH
The following have **zero importers** outside themselves (spot-verified by grep):

| File | Note |
|---|---|
| `src/components/features/inventory/PushToEbayButton.tsx` | 0 refs |
| `src/components/ui/platform-select.tsx` | 0 refs |
| `src/hooks/use-listing-drafts.ts` | 0 refs |
| `src/hooks/use-monzo-auto-sync.ts` | 0 refs |
| `src/lib/api-utils.ts` + `src/lib/rate-limit.ts` | **Dead pair** — `api-utils` imports `rate-limit`, nothing imports `api-utils`. (Active limiter is the separate `@/lib/middleware/rate-limit`.) |
| `src/lib/middleware/vinted-api-auth.ts` | 0 refs |
| `src/lib/services/asin-matching.service.ts` | 0 refs |
| `src/lib/utils/file-reader.ts` | 0 refs |
| `src/lib/schemas/inventory.schema.ts`, `src/lib/schemas/platform.schema.ts` | 0 refs |
| `src/lib/supabase/pagination.ts` | dead **only because** §1.1 isn't adopted — **keep & adopt**, don't delete |

**Dead `minifig-sync` sub-feature cluster (HIGH):** `src/components/features/minifig-sync/{index.ts,ReviewCard.tsx,ReviewQueue.tsx}` + `src/lib/minifig-sync/{image-processor.ts,image-sourcer.ts}` only reference each other — no live consumer.

**Loose dead files at `apps/web/` root (HIGH):** `check-amazon-order.mjs`, `check-bricqer.ts`, `check-price.ts`, `check-rate-limit.ts`, `process-step.ts`, `playwright-quick.config.ts` — stray scratch files, 0 refs.

- **Action:** remove (except `supabase/pagination.ts`, which should be *adopted* per §1.1). **Blast radius:** none (no importers). *Caveat:* knip can miss dynamic `import()`; a typecheck + build after removal confirms.

### 2.2 Dead barrels / barrel-only exports — HIGH
- `src/lib/markdown/index.ts` — barrel with **0 importers** (the cron route imports service files directly). Re-exports `getAuctionCountForDate` (`auction-scheduler.service.ts:96`) which is otherwise **never called**.
- Also flagged unused barrels: `src/lib/listing-assistant/index.ts`, `src/lib/supabase/index.ts`, `src/lib/sync/index.ts` — verify before removing (barrels are sometimes kept as intentional public API).

### 2.3 Dead / debug API routes — HIGH
| Route | Reason |
|---|---|
| `api/test/brickset` | not wired into the dev-test console (unlike the other 8 `test/*`); 0 callers |
| `api/debug/discord-test` | 0 callers; manual browser debug |
| `api/debug/inventory-item` | 0 callers; manual browser debug |
| `api/integrations/ebay/debug` | 0 callers; also echoes partial `EBAY_CLIENT_ID`/env (minor security upside to removing) |
| `api/integrations/bricqer/inventory/stats` (non-cached) | superseded by `stats-cached`; only `use-bricqer-stats.ts` calls `stats-cached` |

*Kept (reachable):* the other 8 `test/*` routes (dev-test console), `integrations/{ebay,paypal}/test` (settings page), `auth/dev-signin` (e2e test).

### 2.4 No in-app caller — investigate (MED/LOW)
- `api/reports/inventory-health/backfill` — 0 callers, likely one-off backfill (MED → confirm then remove).
- `api/integrations/ebay/signing-keys` — 0 in-app callers but may be operationally required for eBay Digital Signatures (LOW — investigate, likely keep).
- `api/health` — 0 in-app callers; standard external uptime probe (LOW — keep).

### 2.5 Unused exports / exported types — LOW confidence, bulk
knip reports **449 unused exports** and **635 unused exported types**, but these are **dominated by barrel `index.ts` re-exports and shadcn/ui primitives** (e.g. `DialogPortal`, `SelectGroup`) that are intentionally part of the component API. Treat as a **curation backlog, not a removal list.** Highest-signal genuine items already surfaced under §2.1/§2.2/§3. Full list: see knip output (`Unused exports` / `Unused exported types` sections). Recommend re-running knip with a tuned config (mark `components/ui/**` and public barrels as entry points) to cut the noise before acting.

---

## 3. Superseded Code

| Item | Evidence | Conf. | Action |
|---|---|---|---|
| markdown-engine → pricing/engine refactor | **Clean** — zero `markdown-engine`/`MarkdownEngine` references remain; new `lib/pricing/engine.ts` + `lib/markdown/apply.service.ts` in place | HIGH | None (verified complete) |
| `lib/markdown/index.ts` dead barrel + `getAuctionCountForDate` | 0 importers / 0 callers (see §2.2) | HIGH | Remove |
| `allocateCostsProportionally` (`purchase-evaluator/calculations.ts:288`) | `@deprecated Use allocateCostsByBuyBox`; only its own test references it | HIGH | Remove fn + test + barrel line |
| `getUnfulfilledOrders` (`services/order-fulfilment.service.ts:155`) | `@deprecated Use getOrdersReadyForConfirmation`; test-only | HIGH | Remove method + tests |
| `getClient` (private, `services/order-issue-gmail-adapter.service.ts:129`) | `@deprecated … kept for backwards compat`; no caller | HIGH | Remove |
| `lib/arbitrage/ebay-listing-validator.ts:22-45` | commented-out regex left `EXCLUDE_PATTERNS` empty → two `for` loops (lines 81, 113) are dead branches | HIGH | Re-enable or remove dead loops + commented blocks |

- **No** `*-old`/`*-legacy`/`*-v1`/`*.bak` files exist (all "legacy" grep hits are legitimate eBay/Bricqer API field names).
- **No** dead feature-flag branches: `ENABLE_SHEETS_WRITE`, `INVENTORY_ENRICH_CRON_ENABLED` are legitimate runtime env toggles.
- `lib/migration/*` *sounds* transitional but is **live** (used by `inventory.repository.ts` + admin migration route) — keep.

---

## 4. Stale Code — One-off / Debug Scripts

`apps/web/scripts/` (~105 files) and `scripts/` (~62 files) hold a large graveyard. **Nothing in app code, CI, or launchers imports the items below — blast radius ≈ zero.** Staleness dates from `git log`.

### 4.1 Remove — HIGH (junk / completed one-off for a fixed past event)
`apps/web/scripts/google-debug.png` (committed screenshot) · `backfill-purchase-31431976.ts` (hard-coded order id) · `zackharvey22-bulk-deal.ts` (hard-coded store/id) · `dedupe-pearl-dark-gray.ts` + `export-pearl-dark-gray.ts` (+ the one-off CSV) · `velocity-sep-oct.ts` · `check-nov-data.ts` · `check-amazon-fees.ts` + `check-amazon-fees-new.ts` + `check-ebay-fees.ts` + `check-ebay-fees-updated.ts` (all "November 2025" fee probes) · `migrate-petrol-tracker.ts` (completed migration).

### 4.2 Remove obsolete variant, keep newest — HIGH/MED
- `scripts/monitor-import.ps1` vs `monitor-import2.ps1` → both removable (Keepa one-offs).
- `scripts/check-discovery.ps1` / `check-discovery2.ps1` / `check-discovery3.ps1` → remove all three.
- `scripts/test-discovery.ps1` / `test-discovery-real.ps1` → remove both.
- `check-duplicates.ts` / `check-inventory-duplicates.ts` / `count-duplicates.ts` → keep at most one.
- `cleanup-duplicates.ts` vs `cleanup-inventory-duplicates.ts` (+ `verify-cleanup.ts`) → keep one.

### 4.3 Investigate then likely remove — MED
Bricqer onboarding-era cluster (`check-bricqer-*`, `debug-bricqer-data.ts`, `investigate-bricqer-counts.ts`, `test-bricqer-stats.ts`) · Amazon one-offs (`sync-historical-amazon.ts`, `resync-amazon-transactions.ts`, `update-amazon-marketplace.ts`) · `migrate-encrypt-credentials.ts`, `migrate-store-status.ts` (completed migrations) · `create-sample-listings.ts` · ad-hoc `debug-*`/`check-*`/`test-*` (`debug-ebay-api.ts`, `check-item.ts`, `check-str.ts`, `test-terapeak-*`, `explore-monzo-sheet.ts`, etc.) · PS1 debug helpers (`check-summary/recent/linked/latest-snapshots.ps1`, `count-price-sets.ps1`). *Lower confidence because each could be re-run manually.*

### 4.4 KEEP (referenced)
Anything in `package.json` scripts (`migrate:*`, `validate:*`, `sheets:test`, `terapeak:login`, `bricklink:login`, `setup:shopify`, `validate:fp`, `test:gmail-coverage`, `sync:bl-messages`, `auth:hb-gmail`, `test:batched`) · Task-Scheduler launchers (`bl-proactive-daily.bat`→`bl-proactive-batch.ts`, `sync-bl-messages-cron.ps1`, `register-vercel-scraper-task.ps1`→`vercel-usage-scraper.py`) · skills (`bl-basket.ts`, `find-piece.ts`) · the active BL arbitrage toolchain (`_bl-client.ts`, `scan-bl-store.ts`, `analyze-bl-*.ts`, `bl-store-queue*.ts`) · live API runners (`run-keepa-*.ps1`, `run-asin-linkage.ps1`, `run-investment-sync.ps1`) · standalone subsystems (`scripts/ml/*`, `scripts/energy/*`, `scripts/school/*` — note: unrelated to the LEGO app; candidates to **relocate**, not delete).

> Recent backfills/cleanups (`backfill-bl-orders-since-reopen.ts`, `cleanup-bad-cache-rows.ts`, `delete-stale-bricqer-rows.ts`, `verify-bricqer-cost-sync.ts`, 2026-04/05) — **keep**, plausibly re-runnable ops tooling (LOW confidence to remove).

---

## 5. Unused Dependencies

| Package | Evidence | Conf. | Action |
|---|---|---|---|
| `@google/generative-ai` (`apps/web/package.json:36`) | **0 imports** in `src`; **superseded** by `@google/genai` (the new SDK, 4 import sites) | HIGH | Remove |
| `@reduxjs/toolkit` (`apps/web/package.json:59`) | **0 imports**; state is Zustand (`zustand` is used), no `configureStore`/`createSlice`/`react-redux` anywhere | HIGH | Remove |

*Unlisted-but-used (knip "unlisted") — not deprecation, just hygiene:* `playwright` (used by scrapers/scripts), `ws`, `uuid`, `@radix-ui/react-toggle`, `postcss-load-config` are imported but not declared as direct deps — consider adding them explicitly.

---

## Shortlist — Safest High-Value Removals First

1. **Drop 2 unused deps:** `@google/generative-ai`, `@reduxjs/toolkit`. (1 line each; instant.)
2. **Delete ~30 confirmed-dead `src` files** (§2.1, §2.2) — the minifig-sync cluster, the `api-utils`/`rate-limit` pair, stray `apps/web/` root scratch files, dead barrels. *Run `npm run typecheck` + `npm run build` after to catch any dynamic-import edge case.*
3. **Delete 5 dead/debug API routes** (§2.3) — `test/brickset`, `debug/discord-test`, `debug/inventory-item`, `integrations/ebay/debug`, `integrations/bricqer/inventory/stats`.
4. **Remove §4.1 + §4.2 one-off scripts** (~20 files) — zero blast radius.
5. **Remove 4 superseded symbols** (§3) — `markdown/index.ts` barrel + `getAuctionCountForDate`, `allocateCostsProportionally`, `getUnfulfilledOrders`, gmail `getClient`.
6. **Then the big consolidations** (§1.1 pagination → §1.4 `sleep` → §1.5 `parseCurrencyValue` → §1.6 currency formatting → §1.3 cron-secret), highest LOC-reduction for lowest risk; §1.2 auth and §1.8/1.9 base-classes are larger, incremental efforts behind tests.

## Caveats
- **knip** can miss dynamic `import()` and string-based references; every "dead file" removal should be followed by `npm run typecheck` + `npm run build`.
- The **449 unused exports / 635 unused types** are inflated by barrels and `ui/` primitives — treat as a tuning/curation task, not a delete list.
- Scripts marked MED/LOW in §4.3/§4.4 may still be run manually; confirm with the owner before deleting.
- Migrations (`supabase/migrations/**`) are append-only history — not touched.
