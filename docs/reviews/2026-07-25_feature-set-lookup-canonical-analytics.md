# Code Review Report

**Mode:** branch
**Branch:** `feature/set-lookup-canonical-analytics` (PR #639)
**Timestamp:** 2026-07-25
**Files changed:** 33 (vs `origin/main`)
**Lines added:** ~3,403 · **removed:** ~543

Covers the whole branch, including the laptop commit `33726ae6` (the assessment engine),
which had never been reviewed.

---

## Summary

| Category | Critical | Major | Minor | Nitpick |
|----------|----------|-------|-------|---------|
| Correctness | 0 | 1 | 1 | 0 |
| Security | 0 | 0 | 1 | 0 |
| Performance | 0 | 0 | 0 | 0 |
| Standards | 0 | 0 | 0 | 0 |
| **Total** | **0** | **1** | **2** | **0** |

All three were fixed in this review pass.

## Static analysis

| Check | Status |
|-------|--------|
| TypeScript | ✅ No errors |
| ESLint | ✅ Clean (pre-existing warnings only, in unrelated workflow components) |
| Tests | ✅ 3,602 → 3,605 passing, 159 files |
| CI (`Typecheck, Lint & Test`) | ✅ green on re-run — see the flake note below |

**CI flake:** run `30157787655` failed on `2c427faa`. The commit carrying *all* the code
(`4316d8e0`) passed, and the only diff between them is one markdown file (+67/−8). Logs had
already expired (`BlobNotFound`), so no root cause; the re-run passed. Consistent with the
OOM flakiness previously seen in this suite. Not treated as a code defect — but if it
recurs on a docs-only commit it is worth a proper look.

---

## Major (1)

### CR-001: "No magnets" asserted from missing evidence

**File:** `src/lib/bricklink/partout-assessment.ts` (via `partout.service.ts:readSupplySafely`)
**Category:** Correctness / honesty

`readSupplySafely` deliberately swallows a failed worldwide-supply read and returns an
empty `Map`. Every lot then gets `worldSupplyLots = null`, every lot fails the scarcity
leg, and `magnets` comes back `[]`. The panel rendered:

> No magnet lots in this set — nothing clears both the scarcity and sell-through tests.

That is a **positive claim built on absent evidence**. A `bricklink_pg_summary_cache`
outage, a thin cache, or a transient Supabase error was indistinguishable on screen from a
set genuinely containing no scarce lots — and magnets are a buy signal that stands
independently of the verdict, so suppressing them silently changes decisions.

The codebase already handles this correctly elsewhere — `buildOverlap` returns `null` and
the panel says *"Nothing here is claimed either way"*; `part-out-value.ts` carries the same
positive-evidence `no_data` discipline. Magnets was the gap.

**Fix applied:** `PartoutAssessment` now carries
`magnetCoverage: { withSupplyData, total }`, and `MagnetsCard` distinguishes three states:

- zero coverage → *"supply data unavailable for every lot… this is **not** a finding of 'no magnets'"*
- partial coverage → *"Checked against N of M lots; the rest have no supply data"*
- full coverage, no hits → the original wording, which is now honest

Note `worldSupplyLots = 0` counts as *data present* (it fails the scarcity leg by the
existing `> 0` guard) rather than as a failed read. Three tests added.

---

## Minor (2)

### CR-002: Raw error text returned to the client

**File:** `src/app/api/brickset/pricing/route.ts`
**Category:** Security (information disclosure)

The new BrickLink panel `status` work returned `error.message` verbatim:

```typescript
return empty('error', error instanceof Error ? error.message : '…');
```

`fetchBricklinkPricing` wraps a Supabase read, the credentials repository and the BL
client, so that message could carry internal detail (query/constraint text, network
internals) into the browser. Low severity — the route is authenticated — but it is
needless surface, and `mapPartoutError` on the partout routes already set the right
precedent.

**Fix applied:** a `blClientMessage` helper surfaces only BrickLink's own error text
(`BrickLinkApiError` / `RateLimitError`) and falls back to *"BrickLink price lookup
failed. See the server log for detail."*. Full detail still goes to `console.error`.
`bricklinkPanelError()` likewise no longer echoes the rejection reason.

### CR-003: STR band gate-0 count can exceed `pricedLots`

**File:** `src/lib/bricklink/partout-assessment.ts`
**Category:** Correctness (cosmetic)

`buildStrBands` admits a lot when `price != null && Number.isFinite(price)`; `pricedLots`
additionally requires `price > 0`. A lot priced at exactly £0 therefore lands in the gate-0
band but not in `pricedLots`, and `StrBandsCard` renders `{band.lots} / {pricedLots}` —
which could read `685 / 684`.

Not fixed: a £0 UK price does not occur in practice (`readPriceGuide` returns `null` for
no data), the two counts answer subtly different questions, and changing either risks
moving figures that reconcile today. Recorded so the next person doesn't chase it as a
data bug.

---

## Reviewed and clean

| Area | Notes |
|------|-------|
| `partout-assessment.ts` | Pure, no I/O, declares no thresholds of its own — everything from `fees.ts` / `liquidity-pov.ts`, as its header claims. Verified: no re-derived constants. `maxBuy` is guarded with `Math.max(0, …)`; `lotsToHalfPov` terminates at `grossPov = 0`. |
| Gate semantics | `povMultiple`/`gapGbp` computed on **gross** so the verdict matches `bl-store-assessment` SETS; `maxBuy` back-solved from **realisable**. Deliberate and commented. |
| `world-supply.ts` | Batched 300 item-nos, paginated within each batch — correctly avoids the 1,000-row cap that would have read as "no supply" and silenced magnets wholesale. |
| API routes | `partout` uses `requireUser()`; `brickset/pricing` uses `validateAuth`; both Zod-validate input. No credentials logged. |
| `snapshot-sync.service.ts` | `maxPages` is additive with an unchanged default, so the Vercel path is untouched. The correctness constraint on `removeStaleItems` is now documented on the constant. |
| PowerShell runners | Carry the `ErrorActionPreference` npx-stderr trap; the self-update is guarded to `hb-*-wt` so it can never hard-reset the main checkout. |
| `useOfficialPov` | Single query-cache key shared by card and reconciliation; no duplicate fetch. |
| Tests | 13 new (10 error/normalisation, 3 magnet coverage) on top of the existing 30. |

---

## Hadley Bricks checklist

| Check | Status | Notes |
|-------|--------|-------|
| Platform credentials encrypted? | ✅ N/A | Read through `CredentialsRepository`; none logged or returned |
| Adapter pattern followed? | ✅ Pass | BL access via `BrickLinkClient` |
| Repository/service pattern? | ✅ Pass | `PartoutService`, `SnapshotSyncService`, `CredentialsRepository` |
| BL price standard pattern? | ✅ Pass | All reads via `readPriceGuide` / `ensurePriceGuide`; 4-quadrant write-through preserved |
| Supabase 1,000-row cap handled? | ✅ Pass | `readWorldSupply` and `loadOwnStockIndex` both paginate |
| RLS policies added? | ✅ N/A | No new tables |
| Tests added? | ✅ Pass | 13 new |

## CLAUDE.md health

| Check | Status |
|-------|--------|
| Length | ⚠️ 198 lines — under the 200 threshold but close; the two "Standard Pattern (MANDATORY)" blocks are the growth |
| Inline code blocks >5 lines | ✅ None |
| Feature-specific docs | ✅ Points at `docs/conventions/` rather than inlining |
| Incident-specific rules | ⚠️ The BL price-data and store-report blocks both carry origin incidents. They are load-bearing (each encodes a repeated, costly mistake), so keep — but they are the first candidates to move to `docs/conventions/` if the file grows further |
| Duplication with global CLAUDE.md | ✅ None |

No action required this PR.

---

## Verdict

## ✅ READY FOR MERGE

No critical issues. The one major finding (CR-001) is fixed and covered by tests; CR-002 is
fixed; CR-003 is documented and deliberately left.

**Follow-ups (not blocking, tracked in `docs/features/set-lookup-canonical-analytics/open-items.md`):**

1. Target-margin control on the max-buy card — `assessPartout` already accepts it (§4.2)
2. `CAPTURE_CURVE` is uncalibrated; everything from the realisable rung down inherits that (§4.3)
3. Inventory Explorer counts `quantity = 0` lots in `totalLots` — 31% of the snapshot
4. No mobile layout in the dashboard shell — pre-existing, affects every page
5. No e2e coverage for set-lookup or partout
