# Code Review Report — chore/stabilise-flaky-tests

**Mode:** branch
**Branch:** chore/stabilise-flaky-tests (vs origin/main)
**Date:** 2026-06-10
**Commits reviewed:** 2 (`39dfb5df`, `8bb2be20`)
**Files changed:** 3 (+31 / −94)

> Note: diffing against *local* main shows 173 files — local main is stale.
> Against origin/main the branch is exactly these 3 files.

## Summary

| Category | Critical | Major | Minor | Nitpick |
|----------|----------|-------|-------|---------|
| Correctness | 0 | 0 | 0 | 0 |
| Security | 0 | 0 | 0 | 0 |
| Performance | 0 | 0 | 0 | 0 |
| Standards | 0 | 0 | 1 | 1 |
| **Total** | **0** | **0** | **1** | **1** |

## Verification performed

All three changed files were cross-checked against the source they test, and all
tests were run **in isolation** (the branch's acceptance criterion) at the branch
tip via detached checkout in the main repo (worktree vitest is unreliable locally):

| Test file | Result |
|-----------|--------|
| `set-number-extraction.test.ts` | ✅ 25/25 |
| `bricklink/__tests__/adapter.test.ts` | ✅ 43/43 |
| `arbitrage/__tests__/arbitrage.service.test.ts` | ✅ 15/15 |

Consumer suites of the changed regex (`gemini-client`, `mapping.service`,
`bricklink-url`, `photo-analysis`) also pass. `ebay-inventory-linking.service.test.ts`
fails 7 tests at the branch tip **but identically at the merge-base** (5560ba08)
and passes 62/62 on origin/main — inherited from the stale base, fixed by #419,
not caused by this branch.

## Per-fix assessment

### 1. BrickLink shipping-fallback assertion (`adapter.test.ts`) — ✅ correct
`normalizeOrder` (adapter.ts:85-88) intentionally falls back to
`max(0, total − subtotal)` when `cost.shipping` is omitted (BL list endpoint).
The old assertion (`shipping = 0`) tested pre-fallback behaviour; new assertion
(`50`) matches the source, with a comment explaining why.

### 2. Set-number 6-digit extraction (`set-number-extraction.ts`) — ✅ real production bug fix
`/lego[:\s-]*(\d{4,5})/` greedily matched `10000` out of `LEGO 100000`, which
passed range validation and returned a wrong set number. The `(?!\d)` lookahead
(with backtracking suppressed for the 4-digit retry too) correctly rejects 6+ digit
runs; the standalone `\b(\d{4,5})\b` fallback already rejects them via word
boundaries. Validated by the existing test
`extractSetNumber('LEGO 100000') → null` (test line 77). No regression for
suffixed numbers (`75192-1`: `-` is not a digit, still matches).

### 3. Arbitrage service mocks realigned to RPC refactor — ✅ matches source
- Excluded eBay listings: service now calls `rpc('get_excluded_ebay_listing_ids')`
  (arbitrage.service.ts:700) — mock `.rpc` added, obsolete `.from` mocks removed.
- Summary stats: single `rpc('get_arbitrage_summary_stats')` in `Promise.all`
  with the excluded count (arbitrage.service.ts:655-662) — summary test rewritten
  to match, including the unmapped-count chain.
- Filter column: `gte('profit_margin_percent', …)` (arbitrage.service.ts:78) —
  assertion updated from the old `margin_percent`.

## Issues

### Minor — no explicit regression test for the regex fix
**File:** `apps/web/src/lib/utils/__tests__/set-number-extraction.test.ts`
The fix is only pinned by `'LEGO 100000' → null`, which conflates "out of range"
with "6-digit run". An explicit case would lock the behaviour for all three
prefixed patterns, e.g.:
```typescript
it('should not extract a 5-digit prefix from longer digit runs', () => {
  expect(extractSetNumber('LEGO 123456')).toBeNull();
  expect(extractSetNumber('Set 7519212')).toBeNull();
  expect(extractSetNumber('#423991')).toBeNull();
});
```
Suggested, not blocking.

### Nitpick — pre-existing fallback looseness (out of scope)
When a prefixed pattern is rejected, `\b(\d{4,5})\b` scans the whole title and can
match piece counts/years (e.g. `"Set 123456 — 2500 pieces"` → `2500`). Pre-existing
behaviour, unchanged by this branch; noting for any future hardening pass.

## Static analysis

Targeted test runs only; lint/typecheck deferred to CI (changes are two test files
and a 3-character-per-line regex edit — no type surface changed).

## CLAUDE.md Health

✅ No issues — project CLAUDE.md is under 200 lines, no long inline code blocks,
feature detail correctly delegated to `docs/conventions/`.

## Hadley Bricks Checklist

| Check | Status |
|-------|--------|
| Platform credentials encrypted? | N/A — no credential code touched |
| Adapter / repository pattern? | ✅ unchanged |
| RLS for new tables? | N/A — no schema changes |
| Tests added for new code? | ⚠️ regex fix relies on an existing test (see Minor) |

## Recommendations

1. **Rebase onto origin/main before continuing** the remaining 18 fixes — the base
   predates #419/#420+; origin/main fixes the `ebay-inventory-linking` isolation
   failures and none of #419's changes touch this branch's 3 files (clean rebase).
2. Add the explicit 6-digit regression test (1 minute, locks the source fix).
3. Continue per-file isolation verification as done so far — approach is sound.

## Verdict

## ✅ APPROVED — sound incremental progress

All 6 fixes are correct, match current source behaviour, and are isolation-green.
One is a genuine production bug fix (set-number extraction). Not yet a PR
(18/24 remaining per `docs/refactors/pagination-and-flaky-tests-remaining.md` on
origin/main); nothing here needs rework before resuming.
