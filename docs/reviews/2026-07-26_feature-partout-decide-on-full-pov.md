# Code Review Report

**Mode:** branch
**Branch:** `feature/partout-decide-on-full-pov` (PR #646)
**Timestamp:** 2026-07-26
**Files changed:** 23 vs `origin/main` · **+1,117 / −1,100**
**Commits:** 13

Covers the whole dev-review cycle: the full-POV decision change, the UI pass, the magnet
rework, the Amazon ASIN/Buy Box fix and the eBay de-noising.

---

## Summary

| Category | Critical | Major | Minor |
|----------|----------|-------|-------|
| Correctness | 0 | 1 | 0 |
| Security | 0 | 0 | 0 |
| Standards | 0 | 0 | 1 |
| **Total** | **0** | **1** | **1** |

## Static analysis

| Check | Status |
|-------|--------|
| TypeScript | ✅ clean |
| ESLint | ✅ clean |
| Tests | ✅ 3,632 passing, 159 files |

---

## Major (1) — fixed

### CR-001: Removing the eBay price sort silently changed four other consumers

**File:** `src/lib/ebay/ebay-browse.client.ts`
**Category:** Correctness / blast radius

Dropping `sort: 'price'` was right for the pricing panel — sorting ascending and taking
`limit` returns the CHEAPEST n, which is the worst possible sample for an average
(71741: £3.99 min, £107 "average" on a £250–400 market).

But `searchLegoSet` / `searchLegoSetUsed` are shared, and the change reached:

| Consumer | Wants |
|---|---|
| `lib/arbitrage/ebay-sync.service.ts` (3 call sites) | **cheapest** — it is hunting buy opportunities |
| `lib/purchase-evaluator/evaluator.service.ts` | **cheapest** |
| `api/brickset/ebay-listings` (the listings modal) | cheapest-first browsing |
| `api/test/ebay-filter-debug` | n/a |

Removing the sort globally would have quietly degraded the arbitrage scanner — the exact
place where bottom-of-market ordering is the point — to find opportunities.

**Fix applied:** `sortByPrice` parameter, **defaulting to `true`** so every existing
caller is untouched. Only `/api/brickset/pricing` passes `false`.

Verified on live eBay: default returns £0.99–£3.84 first (cheap-first preserved), the
pricing path returns £567–£669 (real set prices).

---

## Minor (1)

### CR-002: `verifyAsinTitle` requires the set number, which will reject some real listings

**File:** `src/lib/amazon/asin-resolution.ts`

An Amazon title that omits the set number fails verification even when the ASIN is
correct. That is deliberate — it is what rejects the display-stand class of mismatch that
`title_fuzzy` seeding introduces (75192's seeded ASIN is "Millionspring Millennium Falcon
Vertical Display Stand", confidence 69) — and the fallback still uses the first catalogue
hit, flagged as `catalog-unverified` in the log rather than presented as a match.

Not changed. Recorded because a future "why is Amazon blank for this set" will land here.

---

## Reviewed and clean

| Area | Notes |
|------|-------|
| Decision path on full POV | `netPov` and `maxBuy` both from gross; the liquidity view is computed but provably out of the decision — covered by a test asserting two sets with identical gross and wildly different STR get identical net/max-buy while the FYI figure diverges |
| Verdict taxonomy | Priority verdict wins when a set price exists, even with a negative max buy; `NOT-VIABLE` only applies where there is no comparison to make. Test pins both orderings. |
| Magnet gate | Constants in `fees.ts` (`UK_MAGNET`), not re-derived. Per-type bounds, exclusive, quantity basis matching the STR it is paired with. |
| `flattenSubsets` merge | Dedupes part+colour and sums quantities. Verified on 71741: 1,141 rows / 1,141 distinct ids / 0 collisions, and Full POV unchanged at £513.81 — value was always right, only lot counts and React keys were wrong. |
| Amazon Buy Box | Now `getCompetitivePricing` + `CompetitivePriceId === '1'`, the same path `spapi-buybox-refresh` uses, so Set Lookup and Buy Box Gap agree. |
| eBay validator | `requireSetNumber` is **opt-in**; arbitrage keeps the old permissive behaviour. 14-case guard covers both directions including the plural-minifigures over-filter. |
| Deleted code | `OfficialPovCard`, `useOfficialPov`, `PartoutSummary` removed, not orphaned; no remaining importers. API route and the `bl-part-out-value` skill untouched. |
| Secrets | No credentials logged or returned. The pricing route surfaces only BrickLink's own error text. |
| Supabase 1,000-row cap | No new unpaginated reads. |

## Hadley Bricks checklist

| Check | Status |
|-------|--------|
| Credentials encrypted / not logged | ✅ |
| Adapter + service patterns | ✅ |
| BL price standard pattern (`readPriceGuide` / `ensurePriceGuide`) | ✅ unchanged |
| RLS / migrations | ✅ N/A — no schema changes |
| Tests added | ✅ 8 new across magnets, postage, verdicts, validator |

---

## Verdict

## ✅ READY FOR MERGE

One major issue found and fixed. No critical issues.

**Known residuals, deliberately not fixed:**

1. `bl-store-assessment` still uses the worldwide `MAGNET` gate, so the two surfaces no
   longer share a scarcity basis. Fixing it means re-scraping the ~60k pre-cutover
   `bricklink_pg_summary_cache` rows whose `stock_*` columns are UK-scoped.
2. One eBay minimum in 50 sets is still wrong (11372, "Birds x5 - Set 11372" at £16 vs a
   £97 median). Broadening the rule would over-filter genuine listings.
3. `docs/scheduled-jobs-audit.md` describes jobs as Vercel crons that cannot be running —
   `vercel.json` has no crons. Needs a rebuild against live GCP + Windows tasks.
