# Code Review Report

**Mode:** branch
**Branch:** `feature/set-lookup-single-screen`
**Timestamp:** 2026-07-26
**Files changed:** 14 vs `origin/main` · **+1,141 / −91**
**Commits:** 2

Covers the single-screen Set Lookup, the cost-warned part-out gate, the two verdict
warnings, and Amazon entering the sell-complete comparison.

---

## Summary

| Category | Critical | Major | Minor |
|----------|----------|-------|-------|
| Correctness | 0 | 1 | 1 |
| Security | 0 | 0 | 0 |
| Performance | 0 | 0 | 1 |
| Standards | 0 | 0 | 0 |
| **Total** | **0** | **1** | **2** |

## Static analysis

| Check | Status |
|-------|--------|
| TypeScript | ✅ clean |
| ESLint | ✅ clean (one warning in `TimeTrackingPanel.tsx`, untouched by this branch) |
| Tests | ✅ 3,649 passing, 161 files |
| Secrets scan | ✅ nothing added |

---

## Major (1) — fixed

### CR-001: "Fully cached = free" ignored the set's own price row

**File:** `src/lib/bricklink/partout.service.ts` (`estimatePartoutCost`)
**Category:** Correctness

The estimate costed every part lot but not the SET. It is not a lot, it never appears in
the parts table — and it is priced exactly like any other item, four quadrants at a time,
via `getSetView` → `ensurePriceGuide`.

Two consequences, both in the direction that matters:

1. A set with every part cached but a stale set row was reported as a **1-call** run when
   it was really a **5-call** one.
2. The UI auto-runs without asking when it believes the run is free. That decision was
   being made on a number that could be wrong by four calls.

Small in absolute terms, but the entire point of the gate is that the number on the button
is trustworthy — a cost estimate that quietly omits a cost is the one bug this feature
cannot have.

**Fix applied:** the set's `S` row joins the same `readPriceGuide` batch, `setPriceCached`
is returned, and the arithmetic is now `1 + uncached × 4 + (setPriceCached ? 0 : 4)` with
`QUADRANTS_PER_FETCH` named rather than inlined. Auto-run additionally requires
`setPriceCached`. Covered by a new test asserting the 5-call case specifically.

---

## Minor (2)

### CR-002: Every lookup now spends one BrickLink call

**File:** `src/hooks/usePartoutEstimate.ts`

`usePartoutEstimate` fires on every successful lookup, and the estimate costs one
`getSubsets`. Previously nothing hit BrickLink until the part-out tab was opened.

Not changed — this is the cost of the feature, and it is the right trade: one call to
avoid an accidental 4,564-call run on a set like 71741. Against ~1,500/day of usable BL
headroom (Bricqer takes the rest) this is noise even at heavy usage. Recorded because
"why did BL calls go up?" will land here.

### CR-003: The Amazon figure on the assessment can differ from the one above it

**File:** `src/lib/bricklink/partout.service.ts` (`readAmazonOfferSafely`)

The details card fetches the Buy Box live from SP-API; the assessment reads the
`amazon_arbitrage_pricing` snapshot. Within a refresh window they can differ by pennies —
40756 showed £19.75 live against £19.90 snapshotted.

Deliberate. The part-out path should not depend on a live Amazon call, and
`spapi-buybox-refresh` keeps the table current every 30 minutes. The snapshot date and
ASIN are both in the provenance tooltip, so the figure is never presented as live.

---

## Reviewed and clean

| Area | Notes |
|------|-------|
| New API route | `requireUser()` gate, Zod-validated query, `mapPartoutError` for status mapping, BL credentials required before any work. Matches the sibling partout routes. |
| RLS | Amazon reads go through the request-scoped Supabase client, not service-role — RLS applies and was confirmed working live (40756 resolved `channel: 'amazon'`). |
| Supabase 1,000-row cap | `readPriceGuide` batches at 300; the estimate adds one item to an existing batched read. No new unpaginated queries. |
| Constants | `AMAZON_FEE_PCT` aliases `MAX_BUY_FEE` rather than re-declaring 0.17, following the intl-set-arb precedent. `PARTOUT_WARN` thresholds live in `fees.ts`; no component or service re-derives a cutoff. `max-buy.ts` has no imports, so the new `fees.ts` import introduces no cycle. |
| Fee normalisation | Amazon enters the gate as `buyBox × (1−0.17) ÷ (1−0.094)`. A raw comparison would have given Amazon an ~8-point phantom edge and biased sets toward SELL-COMPLETE; test pins that 40756's £19.75 wins by under 5%, not 11%. |
| New-only scope | `assessPartoutBoth` drops `amazon` for the used lens rather than reusing it; test asserts the used verdict is decided against £10 and `setPriceBasis.amazon` is null. |
| Warnings are advisory | A test asserts a warned set and a liquid set with the same value profile receive the same verdict. No warning path writes to `verdict` or `maxBuy`. |
| Warning evidence | Both warnings quantify rather than assert, and SLOW-COMPLETE-SALE says "no BSR on record" instead of implying the BSR leg passed — `sales_rank` is populated on 8,047 of 12,565 rows and is null for 40756's own ASIN. |
| Gate degradation | A failed estimate still offers the run, labelled unknown-cost, rather than blocking. A zero-lot set skips the gate entirely instead of offering a button that can only return "no parts data". |
| Deleted code | `SellCompletePanel`, `OfficialPovCard`, `useOfficialPov`, `PartoutSummary` all removed with no remaining importers. `assessPartoutBoth` has exactly one caller. |

## Hadley Bricks checklist

| Check | Status |
|-------|--------|
| Credentials encrypted / not logged | ✅ |
| Service + repository patterns | ✅ |
| BL price standard pattern (`readPriceGuide` / `ensurePriceGuide`) | ✅ estimate reads only, never fetches |
| RLS / migrations | ✅ N/A — no schema changes |
| Tests added | ✅ 17 new (4 estimate, 13 warnings/basis) |

## CLAUDE.md health

| Check | Status |
|-------|--------|
| Length | ✅ 198 lines (under 200) |
| Inline code | ⚠️ two blocks over 5 lines — the project-structure tree (23) and the cache-clearing snippet (8). Both are reference material rather than duplicated source; left alone. |
| Feature docs / incident rules / duplication | ✅ none found |

---

## Verdict

## ✅ READY FOR MERGE

One major issue found and fixed. No critical issues.

**Known residuals, deliberately not fixed:**

1. A part BrickLink holds no UK data for is re-fetched on every run (4 calls), because
   `readPriceGuide` can never return `uk` for it. 71741 carries one. Pre-existing; the fix
   is to record "no UK data" as a cached negative, which is its own change.
2. §4.3 CAPTURE_CURVE remains uncalibrated — the liquidity figure stays an explained FYI
   and still moves no money. Revisit ~late October when more purchases have matured.
3. `PARTOUT_WARN` thresholds (25% liquid share, 0.1 median STR, 150k BSR) are first cuts.
   Worth re-checking after a few weeks of real lookups.
