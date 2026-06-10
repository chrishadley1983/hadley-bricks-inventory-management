# Remaining work: §1.1 Supabase pagination + test-suite stabilisation

_Last updated: 2026-06-10_

Tracks the open work spun out of the deprecation/dead-code audit
(`docs/deprecation-audit-2026-06-04.md`). Two threads: finishing the §1.1
pagination consolidation, and stabilising the flaky test suite that the
pagination work exposed.

---

## 1. §1.1 — adopt the shared pagination helper (`lib/supabase/pagination.ts`)

Replace hand-rolled `while (hasMore) { …range(page*size, …) }` fetch-all loops
with `fetchAllRecords` (and single-page UI queries with `fetchPaginated` where it
fits). The helper supports `eq/neq/gt/gte/lt/lte/in/notIn/or/isNull/isNotNull/
orderBy`. **Equivalence rule:** PostgREST builder-call order is irrelevant, so
`fetchAllRecords` (filters chained after `.range()`) sends an identical request to
the old loop.

### Done
- **PR #418** — `profit-loss-report.service.ts`: all 16 loops migrated; helper
  extended with `in`/`notIn` + unit tests. Shipped + prod-verified.
- **PR #419** (this PR) — `order` / `purchase` / `inventory` repositories: 6
  fetch-all loops (`getStats`, `getOrderStatusTimestamps`, `getMonthlyTotal`,
  `getRolling12MonthTotal`, `getTotalsBySource`, `getCountByStatus`).

### Remaining (~74 hand-rolled `.range(` loops)
Migrate file-by-file, each as its own small PR, verifying query equivalence.
High-value clusters the audit named:

- `lib/services/` — `reporting.service.ts`, `order-status.service.ts`,
  `amazon-backfill.service.ts`, `amazon-fee-reconciliation.service.ts`,
  `bricklink-upload.service.ts`, `cost-allocation.service.ts`.
- `lib/keepa/keepa-import.service.ts` (×4), `lib/keepa/keepa-discovery.service.ts`.
- `lib/investment/*` (asin-linkage, classification, historical-appreciation,
  scoring, ml/feature-engineering).
- `lib/arbitrage/*`, `lib/minifig-sync/*`, `lib/inventory-explorer/*`,
  `lib/monzo/monzo-sheets-sync.service.ts`, `lib/shopify/sync.service.ts`,
  `lib/ebay/*`, `lib/retirement/*`, `lib/repricing/*`, `lib/platform-stock/*`.
- Several `app/api/**` routes and `app/api/cron/**` routes.

**Out of scope** (do NOT fold into pagination work): single-page dynamic-filter
UI list queries (`inventory.repository` `findAllFiltered`, `order`/`purchase`
`findAll*`) — these are not duplication and are riskier to touch.

Enumerate with: `grep -rlE "\.range\(" apps/web/src --include=*.ts | grep -v supabase/pagination.ts`
then within each, the fetch-all loops are the `while (hasMore)` ones (not the
single `.range(from,to)` UI queries).

---

## 2. Test-suite stabilisation (blocks clean CI for the above)

### The problem
The `apps/web` vitest suite (`npm run test` = `vitest run`; CI step
"Typecheck, Lint & Test") is **non-deterministically flaky**. ~24 tests across 10
files **fail deterministically in isolation** but pass in the full forks-pool run
via cross-worker state bleed (e.g. a file that leaves `vi.useFakeTimers()` on
rescues another file's real-timer sleeps; mock/global state bleed). Config:
`pool: forks, maxWorkers: 2, isolate: true`; the CI Test step has **no retry /
continue-on-error**, so it goes green only under "lucky" file orderings. Any PR
that shifts file sizes/ordering (e.g. the pagination work) reshuffles into a
different failing subset — which is why correct PRs intermittently fail CI.

### The fix
Make each failing test pass **in isolation** — that guarantees ordering-
independence:

```
cd apps/web
npx vitest run --pool=threads <path/to/file.test.ts>
```

Each failure is **test-vs-source drift** (the service/route was refactored, the
mock/assertion wasn't updated). Fix the test (or the source where it's a genuine
bug), not the ordering.

### Progress — branch `chore/stabilise-flaky-tests` (24 / 24 done ✅ 2026-06-10)
| File | Tests | Status | Cause / fix |
|---|---|---|---|
| `bricklink/__tests__/adapter.test.ts` | 1 | ✅ | stale assertion — shipping omitted now falls back to `total-subtotal` |
| `utils/__tests__/set-number-extraction.test.ts` | 1 | ✅ | **real source bug** — `(\d{4,5})` matched `'10000'` from `'LEGO 100000'`; added `(?!\d)` + explicit 6-digit regression tests |
| `arbitrage/__tests__/arbitrage.service.test.ts` | 4 | ✅ | service moved to RPCs (`get_excluded_ebay_listing_ids`, `get_arbitrage_summary_stats`) + `profit_margin_percent`; added `.rpc` mock, dropped obsolete from-mocks, rewrote summary test |
| `bricqer/__tests__/client.test.ts` | 5 | ✅ | mocked `sleep` from `@/lib/utils` (waits instant); `getOrderItems` tests realigned to `batchSet[].itemSet[]` flattening (the `/items/` endpoint never existed) |
| `app/api/__tests__/orders.test.ts` | 5 | ✅ | DELETE route Zod-validates id as UUID (400) before auth — tests now use a valid UUID; added explicit 400 case |
| `platform-stock/__tests__/platform-stock.service.test.ts` | 3 | ✅ | helper's `.range()` made terminal (service awaits after `.order().range()`); dropped 7 redundant per-test overrides |
| `platform-stock/ebay/__tests__/ebay-trading.client.test.ts` | 2 | ✅ | auth errors (931/932) abort without retry (expect 1 call); `conditionDescription` maps `ConditionDescription`, not `ConditionDisplayName` |
| `platform-stock/amazon/__tests__/amazon-stock.service.test.ts` | 1 | ✅ | mock chain swapped to `.order().range()` terminal |
| `repositories/__tests__/order.repository.test.ts` | 1 | ✅ | spy `getOrderItems` (link-preserve read); inserts stamped with `inventory_item_id` |
| `app/api/__tests__/arbitrage.test.ts` | 1 | ✅ | defaults are now `minMargin: 0` + `maxCog: 100` (filters off by default) |

All 10 files verified isolation-green post-fix (306 tests). Branch rebased onto
origin/main (post-#419) before the remaining fixes.

### After all 24 are isolation-green
1. ~~Push `chore/stabilise-flaky-tests`, open PR, **merge** (CI now stable).~~ ← in progress
2. Future pagination/other PRs go green reliably.
3. (Recommended, not yet done) Harden the config so ordering can't re-break things:
   `restoreMocks: true` and/or per-file timer hygiene (`afterEach(vi.useRealTimers)`
   in offending files); consider `maxWorkers: 1` for determinism if needed.

> Note: PR #419 (pagination repos) was **admin-merged despite the red flaky check**
> after verifying it independently (typecheck + build + all repo/ebay tests green
> in isolation), because the red is the unrelated pre-existing flaky suite.
