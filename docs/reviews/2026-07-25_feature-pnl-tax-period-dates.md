# Code Review Report

**Mode:** branch
**Branch:** `feature/pnl-tax-period-dates` (404024b1 + review fixes)
**Base:** `main` (25bf8c5b at branch point; main since advanced to f6384584)
**Reviewed:** 2026-07-25
**Files changed:** 7 (2 new scripts, 1 service, 1 test file, 1 doc, 2 generated artefacts)
**Context:** feeds HMRC MTD quarterly submissions — correctness of date boundaries
and the SA103F box mapping was the priority. Reviewed from the `hb-dashboard-wt`
worktree because the main checkout was occupied by a concurrent session.

## Summary

| Category | Critical | Major | Minor | Nitpick |
|----------|----------|-------|-------|---------|
| Correctness | 0 | 1 | 2 | 0 |
| Security | 0 | 0 | 0 | 0 |
| Performance | 0 | 0 | 0 | 0 |
| Standards | 0 | 0 | 1 | 1 |
| **Total** | **0** | **1** | **3** | **1** |

All findings were fixed on the branch before merge. Figures re-derived after the
fixes are byte-identical to those generated before them (boxes dict compared
programmatically), so no submitted number moved as a result of this review.

### Static Analysis

| Check | Status |
|-------|--------|
| TypeScript (`tsc --noEmit`) | ✅ No errors |
| ESLint (changed files) | ✅ Clean |
| Vitest (`profit-loss-report.service`) | ✅ 21 passed (15 pre-existing + 6 new) |
| Prettier | ⚠️ Reports the touched files — CRLF-vs-LF only; `main`'s copy of the same service file fails identically. Pre-existing, not introduced. |
| Python parse (`make-mtd-sa103.py`) | ✅ OK |

---

## Major (1)

### CR-001: `eBay Ad Fees - Advanced` absent from the box map — FIXED

**File:** `apps/web/scripts/mtd-sa103-boxes.ts`
**Category:** Correctness

Enumerating every `transactionType` in `getRowDefinitions()` against `BOX_BY_ROW`
found one expense row with no box: `eBay Ad Fees - Advanced`. It was £0 in this
period so the return is unaffected, but the first period with an Advanced
promoted-listings campaign would have aborted the quarterly routine.

The `unmapped` guard means this fails loud rather than silently dropping the cost
from a return — the right failure mode, and the reason this was Major rather than
Critical. Mapped to box 24.1 (advertising) alongside `- Standard`.

---

## Minor (3)

### CR-002: No validation of the new exact-date bounds — FIXED

**File:** `apps/web/src/lib/services/profit-loss-report.service.ts`
**Category:** Correctness

`startDate` / `endDateExclusive` went straight into query filters and
`new Date(...)`. A malformed value (`'06/04/2026'`) or an impossible one
(`'2026-02-30'`) produced `NaN` month arithmetic, an empty month range, and a
silently zeroed report — indistinguishable from a genuinely quiet quarter, on the
path that generates tax figures.

Added `assertValidDateBound()` (shape + real-calendar-date check) plus a
start-before-end assertion, all throwing. Three regression tests cover them.

### CR-003: Generator left an unpatched template at the return's filename on failure — FIXED

**File:** `apps/web/scripts/make-mtd-sa103.py`
**Category:** Correctness

`shutil.copyfile(TEMPLATE, out)` ran *before* `patch_sheet()`. Any later
`SystemExit` (unknown box, cell not found) left a file named like a real return
containing the template's empty boxes — exactly the artefact someone could then
upload. Removed the copy; the output is now written only after patching succeeds,
and every written cell is still verified by re-reading the saved workbook.

### CR-004: Unverified cell for box 16 — FIXED

**File:** `apps/web/scripts/make-mtd-sa103.py`
**Category:** Standards

`CELL_BY_BOX["16"] = "I7"` was carried over from session notes and never
confirmed against the template (we don't file box 16). A guessed cell reference
in a tax generator is worse than a missing one: absent, the script raises "No
template cell known for box 16"; present-but-wrong, it writes silently to the
wrong place. Entry removed with a comment explaining what to do if box 16 is ever
needed.

---

## Nitpick (1)

### CR-005: Month-boundary helper duplicates `getLastMonthFromExclusiveEnd`

`getLastMonthFromExclusiveEndDate` supersedes the existing month-only helper for
every case, but the original is still used on the month-bounds path. Consolidating
is safe and obvious; left alone deliberately so this branch touches nothing the
existing P&L UI depends on. Worth folding in next time that file is edited.

---

## Verified good

- **Fail-loud unmapped-row guard** — a new P&L row can never be silently omitted
  from a return; it stops the run. This is the single most valuable property in
  the change, and it earned its keep on the first use (CR-001).
- **Read-back verification** — every cell written is re-read from the saved
  workbook and compared, so a silently mis-parsed patch cannot ship.
- **Expense-sum assertion** and **box 31 / boxes 17–30 mutual exclusion** both
  enforced before a file is produced.
- **Partial-month bucketing** is documented in the option's JSDoc *and* asserted
  in tests, including the year-boundary case (`2027-01-06` keeps January,
  `2027-01-01` does not) — the class of bug that produced PR #505 and #548.
- **Backwards compatibility**: with neither date supplied, bounds and month range
  are exactly as before; a test pins the `2026-04-01`/`2026-07-01` bounds on the
  month path.
- No credentials, no new tables (no RLS surface), no API routes, no React changes.
  The service change is additive and optional.

## Note, not a finding

`git diff main..HEAD` shows `supabase/migrations/20260725090000_drop_keepa_backup_table.sql`
as deleted. That is only because main advanced past this branch's base (PRs #632,
#633) — the branch never touched the file, so a merge cannot revert it. `main` was
merged into the branch before opening the PR so the pushed state matches what CI
and prod will see.

## CLAUDE.md Health

| Check | Result |
|-------|--------|
| Length | 198 lines — under the 200 threshold but at the edge; the next mandatory-pattern section should displace something rather than append |
| Inline code | The project-structure tree (~25 lines) and command blocks exceed 5 lines. Tolerable as orientation material, but the structure tree is the kind of thing that rots silently — consider linking `docs/conventions/` instead |
| Feature docs | None inline — correctly delegated to `docs/conventions/` and `docs/features/` |
| Incident rules | The two MANDATORY sections (BL price quadrants, BL store reporting) are incident-derived but generalised into standing patterns with origins cited — appropriate |
| Duplication vs global | None found |

## Verdict

**Approved for merge** after the four fixes above, which are applied on the
branch. The change is narrow, additive, well-tested, and the tax-critical paths
now fail loudly instead of quietly.
