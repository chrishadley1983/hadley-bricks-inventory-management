# Code Review Report

**Mode:** branch
**Branch:** `fix/mtd-followups-round4` (ce144226 + review fixes)
**Base:** `main` (6916eda4)
**Reviewed:** 2026-07-25
**Context:** the five follow-ups from validation round 3. Reviewed from the
`hb-dashboard-wt` worktree — the primary checkout was taken over mid-review by a
concurrent session (now on `fix/pg-sold-unavailable-session-brake`), which made
my first round of code greps read the wrong tree. Data findings were unaffected
(they query Supabase, not the working copy); the code findings were re-done.

## Summary

| Category | Critical | Major | Minor | Nitpick |
|----------|----------|-------|-------|---------|
| Correctness | 0 | 1 | 1 | 0 |
| Standards | 0 | 1 | 0 | 0 |
| **Total** | **0** | **2** | **1** | **0** |

Both Majors were introduced by this branch and are fixed on it. **Q1 2026/27 cash
figures never moved at any point** (£16,423.34 / £10,948.87 / £5,474.47).

### Static Analysis

| Check | Status |
|-------|--------|
| TypeScript | ✅ No errors |
| Vitest | ✅ 157 files / 3,572 tests |

---

## Major (2) — both introduced here, both fixed

### CR-001: `OTHER_FEES` rows failing the shop-fee memo test reached no box

**File:** `profit-loss-report.service.ts` (`queryEbayShopFee`)
**Category:** Correctness

`OTHER_FEES` is not just the shop subscription. `queryEbayShopFee` claims only
rows whose memo matches the `YYYY-MM-DD - YYYY-MM-DD` subscription pattern, and
**everything else silently fell through to no box at all**. Measured with
pagination: £1,460.64 claimed, **£26.12 unclaimed** — "Promoted Offsite fee",
spread over many sub-£1 charges from Dec 2024 to Mar 2025.

This is precisely the defect class the round-4 registry was meant to close, one
level below where the registry operates: the *type* was classified, the *memo*
wasn't. Fixed with a `queryEbayPromotedOffsite` row into box 24.1 (advertising,
not commission) plus a guard that throws on any OTHER_FEES memo matching neither
pattern. Verified it lands: FY2024/25 box 24.1 now £2,301.14 = ad fees £2,273.83
+ **Promoted Offsite £26.12** + advanced £1.19. £0.00 in Q1 2026/27 and
FY2025/26, so no filed figure moves.

### CR-002: `ADJUSTMENT` was classified as a balance movement without reading the rows

**File:** `profit-loss-report.service.ts` (`EBAY_TYPE_TREATMENT`)
**Category:** Standards / honesty of the record

The registry marked eBay `ADJUSTMENT` as `'excluded'` alongside DISPUTE/CREDIT/
TRANSFER, implying it nets out like Amazon's `Reserve`. It doesn't. The two rows
are real trading items:

| Date | Entry | Amount | Memo |
|---|---|---|---|
| 2024-08-07 | CREDIT | £26.12 | Store (Basic): Subscription Fee — a shop-fee refund |
| 2025-03-31 | DEBIT | £20.16 | Seller Co-funded Coupon Charge — a marketing cost |

This is the exact sin the `Reserve` investigation was supposed to teach against —
classifying for convenience without opening the rows. Both fall in FY2024/25, so
£0.00 in Q1 2026/27 *and* £0.00 in FY2025/26, and a dedicated row for £5.96 net
isn't worth it. Retreatment to `'unclaimed'` with the rows documented, so the
code states what is true: the £20.16 cost is forgone and the £26.12 credit
untaken, leaving £5.96 in HMRC's favour.

---

## Minor (1)

### CR-003: the DISPUTE exclusion is only safe while every dispute is won

Excluding `DISPUTE`/`CREDIT` is correct **today**, and I verified why rather than
assuming: all 9 DISPUTE debits carry an `ebay_order_id` and each has a matching
`CREDIT` for the identical amount on the same order (some same-day, some months
later — 2025-11-07 → 2026-03-07). Chris won every dispute; net effect £0.

But a **lost** dispute would be a DISPUTE debit with no matching CREDIT — a real
loss, and `'excluded'` would hide it. Not fixed: it needs a pairing assertion
across period boundaries (a dispute opened in Q1 can be credited in Q3), which is
a different shape from the in-period guards and shouldn't be bolted on hastily.
Worth doing before a dispute is ever lost.

---

## Review questions answered

**(a) Can a genuinely refunded order now be counted as income, or double-deducted?**

Neither, proven arithmetically on live data:

| | |
|---|---|
| Sales of orders **with** a refund row | £1,136.95 |
| Gross refunds deducted | £1,136.95 |
| **Net** | **£0.00** |
| Sales of the 4 orders with **no** refund row | £252.23 — correctly kept |

And the four are fully explained: they were **disputes Chris won**. Each has a
DISPUTE debit and a matching CREDIT on the same order id (£28.75, £28.75, £70.99,
£123.74 — exactly their sale values). eBay set `order_payment_status` to
FULLY_REFUNDED during the dispute and never cleared it. So keeping the £252.23 as
income and excluding DISPUTE/CREDIT are the *same* conclusion from the *same*
evidence.

**(b) Is every eBay type genuinely accounted for, and are the exclusions honest?**

All 9,530 rows are classified, and the exclusions were checked not assumed:
DISPUTE↔CREDIT pair one-for-one (above); TRANSFER is 8 CREDIT rows totalling
£109.72 of balance top-ups, not income. `ADJUSTMENT` was **not** honest — see
CR-002.

**(c) Can a fee be counted twice across the four channels?**

No. Each feeType has exactly one owner, and the newly-added standalone
NON_SALE_CHARGE **debits** in `queryEbaySaleFeesByType` cover feeTypes
(FINAL_VALUE_FEE, FVF_FIXED, REGULATORY_OPERATING_FEE, INTERNATIONAL_FEE) that no
other query reads — `queryEbayFeesByType` owns INSERTION_FEE/PREMIUM_AD_FEES,
`queryEbayAdFeesStandard` owns AD_FEE, `queryEbayShopFee` owns OTHER_FEES. The
credits on those same feeTypes were already netted, so reading the debits makes it
symmetric rather than double. £5.59 all-time, £0.00 in Q1.

**(d) Does the MtdExportService throw make the QuickFile push unusable? Is the negation right?**

No, because the two rows that would have tripped it are now mapped platforms
(`shopify`, `otherpaypal` → `SHOPIFY`, `PAYPAL` references). The throw is a
backstop for a genuinely new income row, which is the correct failure mode for a
ledger push. The negation is right for the same reason as
`mtd-sa103-boxes.ts:100`: expense rows arrive negative, and a net-credit month
arrives positive, which `Math.abs` would have pushed as an equal-sized charge.

**(e) Are Q1 2026/27 cash figures genuinely unmoved?**

Yes — verified at three separate points during this branch, including after both
review fixes: £16,423.34 / £10,948.87 / £5,474.47, and the regenerated `.xlsx` is
byte-identical to the committed one.

## Verified good

- The BrickLink conclusion is the most valuable thing here: the earlier
  "£90/quarter missing" was **wrong**, and this branch proves it — £482.64 paid
  vs £486.60 expected at 3% ex-postage over 20 months (99.2%), captured as Monzo
  merchant `Legobrickli`. Correcting a false finding is worth as much as fixing a
  real one.
- Deleting `queryEbayGrossSalesCash` because the two bases became identical is
  the right instinct — one code path, not two that must be kept in step.
- No credentials, no schema change, no RLS surface, no API routes.

## CLAUDE.md Health

Unchanged (198 lines). Standing recommendation from the previous review still
open: a pointer to `docs/features/quickfile-cash-basis/design.md` as the single
source for MTD figures, to be added when something else is trimmed.

## Verdict

**Approved for merge** after CR-001 and CR-002, both applied. CR-003 is a
documented follow-up with no current exposure.
