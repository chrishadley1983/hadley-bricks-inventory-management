# Code Review Report

**Mode:** branch
**Branch:** `fix/mtd-amazon-dsf-ebay-refund` (7d8e75ee + review fix)
**Base:** `main` (227e1495)
**Reviewed:** 2026-07-25
**Files changed:** 6 (1 service, 1 test file, 1 script, 1 doc, 2 generated artefacts)
**Context:** corrects four sources feeding HMRC MTD returns. Reviewed against the
three questions posed: are the new sources right, can a fee credit now be
double-netted, and did accrual change when it shouldn't.

## Summary

| Category | Critical | Major | Minor | Nitpick |
|----------|----------|-------|-------|---------|
| Correctness | 0 | 1 | 1 | 0 |
| Performance | 0 | 0 | 1 | 0 |
| **Total** | **0** | **1** | **2** | **0** |

The Major was **introduced by this branch** and is fixed on it. Q1 figures are
unchanged by the fix (no net-credit month exists in the period), so the filed
numbers stand at turnover £16,287.73 / expenses £10,947.74 / profit £5,339.99.

### Static Analysis

| Check | Status |
|-------|--------|
| TypeScript | ✅ No errors |
| Vitest | ✅ 39 passed (8 new) |
| Python parse | ✅ unchanged this branch |

---

## Major (1) — introduced here, fixed here

### CR-001: `Math.abs()` would file a net fee credit as a charge

**File:** `apps/web/scripts/mtd-sa103-boxes.ts:95`
**Category:** Correctness

Removing the `Math.max(0, total)` monthly floor from the eBay fee queries was
correct — but it made a genuinely **negative** fee row reachable for the first
time (a period whose reversals exceed its charges). Expense rows carry
`signMultiplier: -1`, so:

- a normal charge arrives as `total = -10` → `Math.abs` → `+10` in the box ✅
- a **net credit** arrives as `total = +5` → `Math.abs` → `+5` in the box ❌

i.e. a £5 credit would be filed as a £5 **charge**, overstating expenses and
understating tax — the same direction of error this whole branch exists to fix.
Worse, the new reconciliation guard used `Math.abs` too, so it would have agreed
with the wrong figure instead of catching it.

Fixed by negating (`-row.total`) in both the box mapping and the reconciliation
sum. Not reachable in Q1 2026/27 (verified: no month's reversals approach its
charges), so no filed figure moves — but it was one mis-posted reversal away from
mattering.

---

## Minor (2)

### CR-002: the shop-fee path still cannot net a reversal

**File:** `apps/web/src/lib/services/profit-loss-report.service.ts` (`queryEbayShopFee`)

The removed floor was justified in comments by the shop-fee scenario ("a single
shop-fee reversal would silently vanish"), but `queryEbayShopFee` reads DEBITs
only, so an `OTHER_FEES` credit would still be ignored — the stated concern is
only half-addressed.

**No impact today, verified rather than assumed:** across all 223 all-time
`NON_SALE_CHARGE` credits the only feeTypes present are `AD_FEE` (205 rows,
£144.40), `FINAL_VALUE_FEE_FIXED_PER_ORDER` (13, £4.80) and `INSERTION_FEE`
(5, £0.54) — every one of which IS netted after this change. Left as-is
deliberately: the shop-fee query also filters on a date-range memo, and adding
credit handling without a real example to test against risks inventing the wrong
rule. Worth doing the day an `OTHER_FEES` credit first appears.

### CR-003: the reversal set is re-fetched four times

**File:** `apps/web/src/lib/services/profit-loss-report.service.ts` (`queryEbaySaleFeesByType`)

Each of the four sale-embedded fee rows now fetches the same
`NON_SALE_CHARGE`/`CREDIT` set to find its own feeType — four identical queries
per report. 223 rows all-time makes this immaterial, and hoisting it would mean
threading shared state through the `RowDefinition` contract, which is a worse
trade for now.

---

## Review questions answered

**(a) Are the four new sources correct and complete?**

Yes, and the Amazon one is self-proving: `Sales + Expenses == total_amount` (the
actual payout) to the penny across all 1,575 RELEASED rows since Feb 2025, 100%
of which carry breakdowns — so the new code throws on a missing tree rather than
falling back to the defective columns. The nested-restatement rule (don't descend
into a matched node) is the subtle part and is unit-tested against a verbatim
live event where DSF appears at three depths.

**(b) Can a fee credit be double-netted across the three paths?**

No. Each feeType is served by exactly one path, verified by enumerating callers:

| Path | feeTypes |
|---|---|
| `queryEbaySaleFeesByType` | FINAL_VALUE_FEE, FINAL_VALUE_FEE_FIXED_PER_ORDER, REGULATORY_OPERATING_FEE, INTERNATIONAL_FEE |
| `queryEbayFeesByType` | INSERTION_FEE, PREMIUM_AD_FEES |
| `queryEbayAdFeesStandard` | AD_FEE |
| `queryEbayShopFee` | OTHER_FEES + date-range memo |

No overlap, and every credit feeType that exists in the data is covered exactly
once (see CR-002 for the one uncovered-but-empty case).

**(c) Did accrual / the UI P&L change when it shouldn't?**

Accrual **turnover is untouched** — £16,463.56 for Apr–Jun both before and after
(accrual Amazon sales read `platform_orders`, and the eBay `FULLY_REFUNDED`
exclusion is preserved on accrual via the defaulted parameter, exercised by a
test asserting accrual excludes and cash includes the same order).

Accrual **expenses do change** (+£4.38 for Apr–Jun): fees are shared across both
bases, so the DSF and fee-credit corrections necessarily reach the UI P&L. That
was the explicitly approved scope ("items 1–3 change the live P&L numbers for
every period"), and the direction is right — the old figures were understating
costs.

## Verified good

- `failedRows` closes the silent-drop path, and the tax export refuses to build a
  return when it is non-empty — the guard is on the consumer that must not
  under-report, while the dashboard still renders.
- Reconciliation of boxes against the report's own row totals means a row lost
  between report and return can no longer pass unnoticed.
- Every defect is documented at its call site with the £ figure and the date it
  was found, so the next person cannot "simplify" back to `referral_fee`.
- No credentials, no schema change, no RLS surface, no API route changes.

## CLAUDE.md Health

Unchanged since this morning's review (198 lines, at the edge of the 200
threshold). No new inline code or feature docs added to it by this branch.

## Verdict

**Approved for merge** after CR-001, which is applied. The remaining two are
documented trade-offs with no current impact.
