# Code Review Report — feature/vinted-pov-modes

**Mode:** branch
**Branch:** feature/vinted-pov-modes (aa67915f) vs main (ca42bdd4)
**Timestamp:** 2026-07-02
**Files Changed:** 8 (+656 / −124)
**Prior validation:** adversarial multi-agent workflow 2026-06-22 → SHIP-WITH-FIXES; all 5 LOW findings fixed on-branch. This review is a fresh pass now that main has advanced 17 commits (no overlap: `git merge-tree` clean, none of the branch's files touched on main since the merge-base).

## Summary

| Category | Critical | Major | Minor | Nitpick |
|----------|----------|-------|-------|---------|
| Correctness | 0 | 0 | 3 | 0 |
| Security | 0 | 0 | 0 | 0 |
| Performance | 0 | 0 | 0 | 0 |
| Standards | 0 | 0 | 1 | 1 |
| **Total** | **0** | **0** | **4** | **1** |

## Static Analysis

| Check | Status |
|-------|--------|
| TypeScript | ✅ No errors |
| ESLint | ✅ Pass (one pre-existing warning in TimeTrackingPanel.tsx, unrelated) |
| Secrets scan on diff | ✅ Clean |

## Minor Issues

### CR-001: `sales_rank_too_high` filter reason no longer emitted
`ebay-auction-scanner.service.ts` — `evaluateSingleOpportunities` folds the sales-rank check into `salesRankOk`; when it blocks the Amazon leg the evaluation now reports `below_min_margin` or `below_pov_multiple` instead of `sales_rank_too_high`. Debug/audit visibility only — alert behaviour is correct (a rank-blocked auction can still legitimately alert on POV, which is the point). Consider restoring the specific reason when neither signal fires and rank was the blocker.

### CR-002: POV batch pagination ordering not fully deterministic
`lookupPovBatch` orders by `set_number, item_seq` but rows are unique per (set_number, item_seq, condition, option-variant) — equal-key rows could in theory straddle a `.range()` page boundary and skip/duplicate. Requires >1,000 rows in a 100-set chunk to matter (~10+ variant rows/set average); practically negligible. Adding `.order('condition')` would make it airtight.

### CR-003: Used-scan evaluation lookup could collide with new-scan itemId
`scanUsedPov` locates its evaluation via `evaluations.find(e => e.itemId === ...)` on the shared array; if eBay ever returned the same item in both NEW and USED searches the find would hit the new-scan record. eBay condition filters are disjoint so this is theoretical.

### CR-004: No tests added
The ebay-auctions module has no existing test coverage and the branch adds none. Consistent with the module's current state; POV signal logic was covered by the 2026-06-22 adversarial validation workflow instead.

## Nitpick
- `round2` helper duplicated in two methods; could hoist to module scope.

## Hadley Bricks Checklist

| Check | Status | Notes |
|-------|--------|-------|
| Platform credentials encrypted? | ✅ N/A | No credential handling in diff |
| Adapter/repository patterns | ✅ Pass | Scanner service extends existing structure |
| Dual-write | ✅ N/A | No inventory writes |
| RLS / anon exposure | ✅ Pass | `get_pov_public` is SECURITY DEFINER with pinned search_path, returns only public POV columns (my_inv_* withheld, aggregate rows excluded), EXECUTE granted explicitly; migration already applied to prod (verified 2026-07-02) |
| API route security | ✅ Pass | Config PUT extends existing Zod schema with bounded numerics; cron/scan auth unchanged |
| Supabase 1,000-row limit | ✅ Pass | POV batch read is chunked AND range-paginated |

## CLAUDE.md Health
149 lines, no inline code blocks >5 lines, feature docs correctly in `docs/` — healthy.

## Verdict

**✅ READY FOR MERGE** — no critical or major issues. Minor items are audit-labelling and theoretical edge cases; fine as follow-ups.
