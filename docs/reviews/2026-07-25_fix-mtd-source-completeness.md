# Code Review Report

**Mode:** branch
**Branch:** `fix/mtd-source-completeness` (7cc2734f + review fix)
**Base:** `main` (135c8bce)
**Reviewed:** 2026-07-25
**Context:** completeness fixes for HMRC MTD figures, after validation round 2
found money in tables the pipeline never read.

## Summary

| Category | Critical | Major | Minor | Nitpick |
|----------|----------|-------|-------|---------|
| Correctness | 0 | 1 | 0 | 0 |
| Robustness | 0 | 0 | 2 | 0 |
| **Total** | **0** | **1** | **2** | **0** |

The Major was found by asking the review's own question (a) rather than trusting
the fix. Q1 and FY figures are unchanged by it.

### Static Analysis

| Check | Status |
|-------|--------|
| TypeScript | ✅ No errors |
| Vitest (P&L files) | ✅ 47 passed (12 new) |
| Full suite before review fix | ✅ 157 files / 3,568 tests |

---

## Major (1) — found by the review, fixed

### CR-001: `AdhocDisbursement` classified as a cost when it is a payout

**File:** `apps/web/src/lib/services/profit-loss-report.service.ts` (`AMAZON_TYPE_TREATMENT`)

Enumerating every `transaction_type`/`description` pair on RELEASED rows to
answer question (a) surfaced a third balance movement beyond `Reserve` and
`Transfer`:

| type / status | description | rows |
|---|---|---|
| Adjustment / RELEASED | `Reserve` | 8 — excluded ✅ |
| Transfer / RELEASED | `Disbursement` | 35 — excluded by type ✅ |
| **AdhocDisbursement / RELEASED** | **`InitiateDisbursement`** | **1 — was `fees-only`** ❌ |

A disbursement moves money already counted; it is not spending. It was set to
`fees-only`, so its `Expenses` leaf would be claimed as a business cost — the
same reasoning error as `Reserve`, differing only in scale (−£0.01, Feb 2025,
outside every period filed so far). Reclassified `excluded`.

Materially £0.01. Conceptually it matters: the registry is meant to encode
*reasoning*, and one entry encoded the wrong reasoning.

---

## Minor (2)

### CR-002: a guard trip silently zeroes a row on the dashboard

`generateReport` catches a query error, reports the row as £0 and records it in
`failedRows`. The new guards throw inside query functions, so tripping one
converts "slightly wrong figure" into "silently zero" for any consumer that does
not read `failedRows`.

The tax path is safe — `mtd-sa103-boxes.ts` refuses to build a return when
`failedRows` is non-empty, which is the whole point. But the **UI P&L does not
check it**, so a future unclassified event code would show £0 for BrickLink Sales
on the dashboard with only a `console.error`.

Blast radius is worth knowing: one unclassified £42 receipt zeroes *three* income
rows (BrickLink + Brick Owl + Other PayPal ≈ £8.4k in Q1), because they share
`fetchPayPalCustomerReceipts`. Correct direction for a tax return, alarming on a
dashboard. Recommend surfacing `failedRows` in the P&L UI as a banner.

### CR-003: one-code-at-a-time classification will keep tripping

`PAYPAL_KNOWN_NON_INCOME_CODES` lists `T0403` individually rather than treating
the T04xx withdrawal family as movements. That is deliberate — a prefix rule
would let a genuinely new code through silently, which is the failure mode the
guard exists to prevent — but it does mean each new PayPal code produces a hard
failure until someone classifies it. Acceptable given how these defects arose;
noted so the behaviour is not mistaken for a bug.

---

## Review questions answered

**(a) Is the Reserve exclusion complete — can another balance movement leak in?**

Now yes, after CR-001. Verified by enumerating every description on RELEASED
rows: `DebtPayment, Disbursement, InitiateDisbursement, LabmanLabelChargeBack,
LabmanLabelPurchase, LabmanLabelReturn, Order Payment, Refund, Reserve,
Subscription`. `Reserve` appears **only** under Adjustment (8 rows), and the
exclusion is applied on both the sales and fee paths. The refund queries cannot
reach it (they filter to Refund/GuaranteeClaimRefund types).

**(b) Can a fee credit be double-netted across the four channels?**

No, and no channel is orphaned either. Each feeType has exactly one owner:

| Channel | feeTypes |
|---|---|
| `queryEbaySaleFeesByType` (SALE fees + NON_SALE credits + REFUND credits) | FINAL_VALUE_FEE, FINAL_VALUE_FEE_FIXED_PER_ORDER, REGULATORY_OPERATING_FEE, INTERNATIONAL_FEE |
| `queryEbayFeesByType` | INSERTION_FEE, PREMIUM_AD_FEES |
| `queryEbayAdFeesStandard` | AD_FEE |
| `queryEbayShopFee` | OTHER_FEES + memo |

Verified against all 197 all-time REFUND rows: every one is `booking_entry =
DEBIT` (so none is missed by the query), and their embedded credits carry **only**
the four feeTypes the SALE path owns — £518.42 all-time, all netted, no AD_FEE or
INSERTION_FEE among them. The standalone NON_SALE_CHARGE credits are separate
rows, so summing both cannot touch the same money.

**(c) Do the guards fail in the right direction?**

For the tax path, yes — they refuse to produce a return rather than produce a
light one, and the MTD script checks `failedRows` before building. See CR-002 for
the dashboard caveat, which is the one place the direction is arguably wrong.

**(d) Did accrual change beyond the intended refund fix?**

No. Row-by-row diff against the pre-branch accrual figures (calendar Apr–Jun
2026) accounts for every penny of the −£13.25 turnover change:

| Row | Before | Now | Δ | Intended? |
|---|---|---|---|---|
| eBay Gross Sales | 2,643.32 | 2,643.32 | 0.00 | — |
| eBay Refunds | −61.77 | −72.96 | −11.19 | yes, gross refund |
| BrickLink Gross Sales | 6,966.67 | 6,966.67 | 0.00 | — |
| Brick Owl Gross Sales | 1,174.63 | 1,174.63 | 0.00 | — |
| Shopify Sales | — | 24.46 | +24.46 | yes, newly included |
| Amazon Sales | 5,893.81 | 5,893.81 | 0.00 | — |
| Amazon Refunds | −153.10 | −179.62 | −26.52 | yes, Refunded Sales |

`failedRows` empty. No unexplained movement.

## Verified good

- The `Reserve` discovery is itself the strongest argument for the registry
  pattern: the guard on Adjustment *descriptions* operates at exactly the level
  the £4,945.88 error hid, and a test pins it.
- Tests cover all four guards plus the Reserve exclusion, using breakdown shapes
  taken verbatim from live rows.
- Q1 figures are stable across the review (£16,423.34 / £10,948.87 / £5,474.47)
  and FY too — so nothing in this review moved a filed number.
- No credentials, no schema change, no RLS surface, no API routes.

## CLAUDE.md Health

Unchanged (198 lines). Given three rounds of tax-figure defects, the
"BL Price Data" and "BL Store Review" MANDATORY sections now have a natural
sibling: a short pointer to `docs/features/quickfile-cash-basis/design.md` as the
single source for MTD figures. Worth adding when something else is trimmed —
flagged rather than done, to keep the file under 200 lines.

## Verdict

**Approved for merge** after CR-001, which is applied. CR-002 is a real follow-up
(surface `failedRows` in the UI) but does not affect the return.
