# Code Review Report — fix/pg-tier-recategorisation

**Mode:** branch
**Branch:** fix/pg-tier-recategorisation (PR #663)
**Timestamp:** 2026-08-06 07:15
**Files Changed:** 2 (+23 / -5)

## Summary

| Category | Critical | Major | Minor | Nitpick |
|----------|----------|-------|-------|---------|
| Correctness | 0 | 0 | 1 | 0 |
| Security | 0 | 0 | 0 | 0 |
| Performance | 0 | 0 | 0 | 0 |
| Standards | 0 | 0 | 1 | 0 |
| **Total** | **0** | **0** | **2** | **0** |

## Static Analysis

| Check | Status |
|-------|--------|
| TypeScript | ✅ No errors (needs `--max-old-space-size=6144`; default heap OOMs repo-wide, pre-existing) |
| ESLint | ✅ Pass on both files |
| Prettier | ⚠️ Both files fail `--check` — **pre-existing on main**, not introduced here |

## Review

### `pg-refresh-cycle.ts` — no-data demotes to tail

- `toNoDataQueueUpdate` gains `tier: 'tail'` unless the tuple is inside its
  new-release grace window. Grace check mirrors pg-rank's (`grace_until > now`). ✅
- Both no-data entry points route through this one function (true no-data page
  AND 2nd-consecutive sold-unavailable acceptance), so the policy is applied
  uniformly. ✅
- `flush()` applies queue updates as per-row UPDATEs (never upsert), so the
  heterogeneous payload (some rows now carry `tier`, block-unlock rows don't)
  is safe — the exact trap documented at `flush()` is avoided. ✅
- `rank_floor` deliberately untouched: provenance for pg-digest's
  growth-by-source split. Cross-checked `pg-digest.ts:loadQueueGrowth7d` —
  still correct. ✅
- Demoting a tuple that is already tail is a no-op write. Harmless. ✅

### `pg-rank.ts` — floors are bootstrap-only

- `floorActive` now requires `last_refreshed_at === null`. Grace pin unchanged.
  Scraped tuples compete on rank alone: top-60k active, else tail. ✅
- `last_refreshed_at` added to the interface and the select — the only new
  column dependency, and it exists on the table. ✅
- Tier-flip side effects unchanged and still correct: newly-active spread over
  28d, newly-tail keeps `next_due_at`; a data-bearing tuple demoted to tail
  moves onto the 90d cycle at its next scrape via `cycleDaysFor`. ✅

### Backfill (executed against prod pre-merge, one-off script local per `.gitignore:114`)

- 4,735 rows demoted — exactly `pg_coverage_report`'s `active/no_data_fresh`
  count. Post-check: active `no_data_fresh` = 0, tail `no_data_fresh` = 15,641
  (10,906 + 4,735). ✅

## Minor Issues

1. **CR-001 (Correctness, cosmetic):** `not_in_catalog` tuples never get
   `last_refreshed_at` (by design in `toNotFoundQueueUpdate`), so a floored
   not-in-catalog tuple stays pinned "active" forever. Harmless — `next_due_at`
   is parked 100y so it is never scraped — but the 40 such tuples slightly
   inflate active-tier counts. Fix opportunistically if it ever bothers
   reporting.
2. **CR-002 (Standards):** both scripts carry pre-existing Prettier debt.
   Reformatting them in this PR would bury the 2-line policy change; leave to a
   dedicated format pass.

## Hadley Bricks Checklist

| Check | Status | Notes |
|-------|--------|-------|
| Platform credentials encrypted? | N/A | No credential changes |
| Adapter/repository pattern? | N/A | Local scheduler scripts |
| RLS policies? | N/A | No schema changes |
| Tests added? | ⚠️ None | Consistent with existing scripts/pg convention (no unit harness for these); behaviour verified against prod data instead |

## CLAUDE.md Health

198 lines — under the 200 threshold. The two MANDATORY pattern sections are
generalised rules with origin context, not one-off incident warnings. No action.

## Verdict

## ✅ READY FOR MERGE

No critical or major issues. Two minor observations, neither blocking.
