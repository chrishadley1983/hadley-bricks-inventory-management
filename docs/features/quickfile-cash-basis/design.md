# QuickFile MTD Export — Cash Basis

**Created:** 2026-07-02 (overnight build)
**Branch:** `feature/quickfile-cash-basis`
**Purpose:** Add a cash-basis variant of the MTD export alongside the existing
accrual variant. Both bases run on the same underlying data and can be executed
at any time. Figures feed HMRC MTD ITSA submissions via QuickFile, so the
methodology below is the audit trail for how every number is derived.

## Basis definitions

**Accrual** (unchanged, the default): income recognised at sale/order date.
- eBay: `ebay_transactions` SALE by `transaction_date`, excluding fully
  refunded orders; refunds as a separate deduction row
- BrickLink / Brick Owl: `bricklink_transactions` / `brickowl_transactions`
  by `order_date`, excluding cancelled
- Amazon: `platform_orders` (Shipped/Paid) by `order_date`; refunds from
  `amazon_transactions` by `posted_date`

**Cash**: income recognised when the money is received, under the
**agent-receipt principle** — a marketplace collecting payment from the buyer
on our behalf counts as receipt by us (the platform is our collecting agent):

| Line | Source | Date | Notes |
|---|---|---|---|
| Amazon Sales | `amazon_transactions` Shipment **RELEASED**, `gross_sales_amount` | `posted_date` | posted_date on RELEASED rows IS the funds-release date (verified: deferred 22–24 Jun rows released 1–2 Jul carry the July date) |
| Amazon Refunds | Refund + GuaranteeClaimRefund **RELEASED** | `posted_date` | deduction |
| eBay Sales / Refunds | identical queries to accrual | `transaction_date` | eBay buyers pay eBay at the moment of sale, so receipt date ≡ sale date by construction |
| BrickLink Sales | `paypal_transactions` T0006, `gross_amount > 0`, not BO-labelled | `transaction_date` | buyer payment lands in the PayPal balance = received |
| Brick Owl Sales | `paypal_transactions` T0006, `transaction_type` matches `Brick Owl Order…` | `transaction_date` | label reconciles to BO order totals to the penny (Jun 2026: £409.02 both) |
| BL/BO Refunds | `paypal_transactions` T1107 (refunds we issue) | `transaction_date` | deduction; requires the PayPal-sync T1107 extension in this branch + a historical backfill |

**Expenses are identical in both bases** — every expense line is already
recognised on a payment date (Monzo transaction dates, Amazon fee events at
RELEASED `posted_date`, eBay fee transaction dates, PayPal `fee_amount` dates).

## Amazon status semantics (critical, verified 2026-07-02 on live data)

The Amazon financial-event sync APPENDS rows on status change rather than
updating in place:

- `DEFERRED` = Amazon has NOT yet released the funds (DD+7 policy). Excluded —
  not yet received.
- When released, a NEW row appears with status `RELEASED` and `posted_date` =
  the release date. The older DEFERRED / DEFERRED_RELEASED rows for the same
  order remain in the table.
- Every `DEFERRED_RELEASED` row has a `RELEASED` sibling (1,112/1,112 at time
  of writing). Therefore **summing RELEASED-only is complete and
  double-count-free**; summing any two status families double counts.

## Known approximations (documented, immaterial)

- Shopify sales (~£25/month) are out of scope in both bases, as in the
  existing P&L.
- BL/BO refunds are netted against the BrickLink sales bucket in the QuickFile
  ledger (the CSV builder's platform mapping); attribution between BL and BO is
  cosmetic — nominal code and totals are identical.
- Cash exports should be run ≥1 week after month end so short-lived processing
  states (eBay FUNDS_PROCESSING → PAYOUT, Amazon deferral releases) have
  settled into their terminal rows.

## Policy notes (from E2E validation, 2026-07-03)

- **Amazon deferral at FY cutoffs:** in-flight orders are recognised on the
  RELEASED row's `posted_date` (settlement basis). An order inside Amazon's
  ~7-day deferral window at a year-end books in the release period. Verified
  on live data: RELEASED amounts equal their deferred siblings for all 1,526
  paired orders; the only DEFERRED-only orders are 0–6 days old.
- **Paid-then-cancelled orders:** PayPal gross receipts include occasional
  paid-then-cancelled orders (£18.94 across Apr–Jun 2026, 0.2%); these are
  exactly netted by their paired T1107 refunds, so income is correct as long
  as the refunds row is present (it is, in the cash basis).

## Storage / audit

- `mtd_export_history.quickfile_response.basis` records the basis of every
  export (legacy rows without it read as `accrual`).
- CSV/ZIP filenames carry a `-cash` suffix on cash basis.
- QuickFile `ApplicationID` now comes from stored credentials (App ID GUID of
  the registered QuickFile app) — the previous hardcoded literal predates the
  app registration.

## Cross-checks used in tests / validation

June 2026 ground truth (independently verified in session 2026-07-02):
- PayPal T0006 receipts: 170 rows, £3,368.00 gross; BO-labelled 34 rows
  £409.02; PayPal fees £152.92
- Amazon June: RELEASED £1,947.82 / fees £351.90; DEFERRED (excluded) £3,329.04
- Accrual June income by platform: Amazon £3,169.78, BL £2,988.59, eBay
  £870.72, BO £409.02

## Submission periods — HMRC STANDARD quarters (decided 2026-07-25)

Chris elected the **standard** MTD quarterly periods (6th–5th), not calendar
quarters. Q1 2026/27 is therefore **6 Apr – 5 Jul 2026**, not 1 Apr – 30 Jun.

Consequences, all handled:

- The P&L service accepts exact bounds — `startDate` (inclusive) and
  `endDateExclusive` — which override `startMonth`/`endMonth`. Monthly columns
  still bucket by month, so the first and last months hold PART-month figures:
  read `total`, never the month cells, on a partial period.
- **The tax year must use the same convention.** FY2025/26 was originally
  prepared on 31-March equivalence (1 Apr 2025 – 31 Mar 2026: turnover
  £74,986.05, expenses £52,876.94, profit £22,109.11). With 2026/27 starting
  6 Apr 2026, FY2025/26 has to end **5 Apr 2026** or the 1–5 Apr 2026 sliver
  (turnover £728.85, expenses £408.14, profit £320.71) falls in no return at
  all. On the 6 Apr 2025 – 5 Apr 2026 basis: turnover **£73,303.14**, expenses
  **£52,271.23**, profit **£21,031.91**. Regenerate the FY bridging file on
  that basis before filing it (not due until Jan 2027).

### Quarterly routine

```
cd apps/web
npx tsx scripts/mtd-sa103-boxes.ts --start=2026-04-06 --end=2026-07-06 \
  --basis=cash --json --out=../../docs/features/quickfile-cash-basis/<period>-boxes.json
python scripts/make-mtd-sa103.py <period>-boxes.json <out>.xlsx
```

`mtd-sa103-boxes.ts` owns the row→box map and **throws on any unmapped expense
row**, so a newly-appearing P&L row can never be silently dropped from a return
(it caught `eBay Insertion Fees`, absent from Apr–Jun, on the first tax-quarter
run). `make-mtd-sa103.py` patches the template's raw sheet XML (formatting and
the column-B `£` labels preserved; values go in column C) and verifies every
cell by re-reading the saved workbook.

Q1 2026/27 filed figures — cash basis, 6 Apr – 5 Jul 2026:
box 15 £16,256.24 · 17 £5,519.37 · 20 £25.20 · 21 £445.44 · 23 £2,470.06 ·
24.1 £114.34 · 26 £386.28 · 30 £1,984.31 → expenses £10,945.00, profit
£5,311.24. File: `MTD_SA103_2026-27_Q1_6Apr-5Jul.xlsx`.

## Four source-column defects found by validation (2026-07-25) — FIXED

The `validate-mtd-standard-quarter` workflow FAILED the first Q1 file. Every
defect was a wrong SOURCE for money that reaches a return, and every one
understated tax. All four are fixed in `profit-loss-report.service.ts`.

**1. Amazon flat columns are not equivalent to the breakdowns tree.**
`gross_sales_amount` is NET of the DigitalServicesFee, and
`total_fees`/`referral_fee` carry Commission ONLY — so DSF vanished from both
sides of the P&L at once (£20.26 in Q1, £220.08 since Feb 2025). `other_fees` is
junk (£8,075 against £1,026 of real fees). Gross sales now come from the `Sales`
breakdown and fees from `Expenses`. The tree self-proves: `Sales + Expenses ==
total_amount` (the actual payout) to the penny across all 1,575 RELEASED rows,
100% of which carry breakdowns — so the source throws rather than falls back.

**2. Amazon refund events mix a fee credit into turnover.** `total_amount` on a
refund is `Refunded Sales` PLUS `Refunded Expenses` (fees given back, £17.52 in
Q1). Only Refunded Sales reduces turnover; the credit now reduces the fees row.
Profit-neutral, but it had turnover and fees each overstated by £17.52.

**3. The FULLY_REFUNDED exclusion double-deducts on cash basis.** Accrual
excludes those sales to match Seller Hub; on cash the refunds row already
deducts the money, so dropping the receipt too deducts it twice (order
25-14618-95530: took £28.75 on 15 May, refunded £24.87 on 18 May). Cash now uses
`queryEbayGrossSalesCash`; accrual is unchanged. Note a refund can also land in a
LATER period than its sale, so the exclusion silently rewrote periods already
filed.

**4. Fee reversals were swept into advertising.** `queryEbayAdFeesStandard`
subtracted EVERY `NON_SALE_CHARGE` CREDIT with no feeType filter, so a £0.48
`FINAL_VALUE_FEE_FIXED_PER_ORDER` credit reduced box 24.1 instead of box 30.
Credits are now matched to their own feeType on both the NON_SALE_CHARGE and
SALE-embedded fee paths, and the `Math.max(0, total)` monthly floor is gone (it
would have silently eaten a large mis-posted reversal).

**Plus a silent-drop path closed.** `generateReport` swallows a failed row's
query, the row totals £0, and the zero-row filter removes it — so one transient
error could have dropped £4,848 of stock from box 17 with only a console.error.
Failures are now returned as `ProfitLossReport.failedRows`, and
`mtd-sa103-boxes.ts` refuses to build a return when it is non-empty, as well as
reconciling the boxes against the report's own row totals.

### Corrected figures (all cash basis)

| Period | Turnover | Expenses | Profit | Was (profit) |
|---|---|---|---|---|
| **Q1 2026/27, 6 Apr – 5 Jul** | **16,287.73** | **10,947.74** | **5,339.99** | 5,311.24 |
| Q1 calendar, 1 Apr – 30 Jun | 15,995.08 | 10,793.42 | 5,201.66 | 5,159.19 |
| FY2025/26, 6 Apr 25 – 5 Apr 26 | 74,432.36 | 52,283.92 | 22,148.44 | 21,031.91 |
| FY2025/26, 1 Apr 25 – 31 Mar 26 | 76,108.14 | 52,896.27 | 23,211.87 | 22,109.11 |

Q1 boxes: 15 £16,287.73 · 17 £5,519.37 · 20 £25.20 · 21 £445.44 · 23 £2,470.06 ·
24.1 £114.82 · 26 £386.28 · 30 £1,986.57.

**Follow-up:** the QuickFile ledger still holds the pre-fix Apr–Jun push
(£15,948.23 income / £10,789.04 expenses from 2026-07-02). QuickFile is the books
only and the return goes via My Tax Digital bridging, so this is not a
double-filing risk, but the books are now £46.85 light on income and should be
re-pushed or adjusted.

## Round 2: source COMPLETENESS (validation re-run, 2026-07-25)

The re-run FAILED again — not on the four corrected sources, which all
reproduced to the penny, but on money in tables the pipeline never read. Fixing
a source is not the same as proving every source is read.

**1. PayPal receipts outside the checkout event code.** Income was
`transaction_event_code = 'T0006'` exactly, so £120.00 of T0011/T0000 customer
payments (Q1) reached no row while £4.09 of their fees WAS claimed in box 26.
All 11 such rows since Nov 2024 (£705.59) carry an individual payer name and a
commercial goods-and-services fee. Now an explicit allowlist
(`PAYPAL_CUSTOMER_PAYMENT_CODES`) with a **fail-loud guard** on any unclassified
money-in code, and a separate `Other PayPal Sales (cash received)` row so the
BrickLink figure stays reconcilable against `bricklink_transactions`.

**2. Amazon `Adjustment` costs.** The fee query hard-coded
`transaction_type='Shipment'`, so £9.98 of return postage (Q1; £113.59 all-time)
was in no box. Replaced with an explicit `AMAZON_TYPE_TREATMENT` registry plus a
guard, so an unread type now fails the run.

**⚠ The trap inside that fix — worth £4,945.88.** `Adjustment` is not one thing.
Eight `Reserve` rows carry `Sales +£6,263.55` AND `Expenses −£6,263.55` — Amazon's
balance-hold mechanic, netting to exactly £0. Adding Adjustment to the fee side
alone inflated FY2025/26 expenses by £4,945.88 (profit £4,597 light); adding both
sides would have inflated box 15 turnover by the same. `Reserve` is excluded
outright, with a second guard on unclassified Adjustment *descriptions* — the
level at which it hid. Q1 contains no Reserve rows, which is exactly why testing
only the quarter being filed would have shipped this.

**3. eBay fee credits inside REFUND rows.** A REFUND row's `amount` is NET of the
fees eBay credits back (`totalFeeBasisAmount − totalFeeAmount == amount`, exact on
every row), so £8.85 of credits sat inside income. Turnover now falls by the GROSS
refund and the credits are netted against their own fee rows. This is a fourth,
separate credit channel from the standalone NON_SALE_CHARGE credits — verified NOT
the same money, so netting both is correct.

**4. Accrual double-relief (a regression from round 1).** `queryAmazonFees` began
subtracting `Refunded Expenses` while accrual `queryAmazonRefunds` still used
`|total_amount|`, which already nets it — relieving the same credit twice (£17.52
in Q1). Accrual now reads `Refunded Sales` like cash.

**5. Shopify.** Documented as out of scope when the store earned nothing; it is now
trading income (£24.46 in Q1, £79.92 in three weeks of July) and is included on
both bases. NOTE: `platform_orders.fees` is null on every Shopify row, so no
Shopify processing fee is claimed anywhere — that needs a source.

**Guards added:** no expense box may be negative; and a SOURCE→report check that
goes back to the raw tables, because the existing report→boxes reconciliation
cannot see a row that is never queried — which is precisely how defects 1–3
survived two rounds.

### Figures after round 2 (cash basis)

| Period | Turnover | Expenses | Profit |
|---|---|---|---|
| **Q1 2026/27, 6 Apr – 5 Jul** | **16,423.34** | **10,948.87** | **5,474.47** |
| Q1 calendar, 1 Apr – 30 Jun | 16,128.35 | 10,795.56 | 5,332.79 |
| FY2025/26, 6 Apr 25 – 5 Apr 26 | 74,641.67 | 52,207.45 | 22,434.22 |
| FY2025/26, 1 Apr 25 – 31 Mar 26 | 76,319.48 | 52,818.48 | 23,501.00 |

Q1 boxes: 15 £16,423.34 · 17 £5,519.37 · 20 £25.20 · 21 £445.44 · 23 £2,470.06 ·
24.1 £114.82 · 26 £386.28 · 30 £1,987.70.

**Still open:** 4 FULLY_REFUNDED eBay orders (£252.23, all pre-6 Apr 2026) have no
REFUND transaction at all, so the cash rule books the receipt with nothing
deducted — must be resolved before FY2025/26 is filed. Amazon `DebtRecovery`
(+£30.00, Aug 2025) is classified `excluded` pending a decision, also pre-Q1.

## Round 4: the five follow-ups (2026-07-25)

**Q1 2026/27 cash figures are UNCHANGED by all of this** — turnover £16,423.34,
expenses £10,948.87, profit £5,474.47, and the .xlsx regenerated byte-identical.
Everything below affects the accrual view, prior years, or the QuickFile path.

**1 + 2. The `FULLY_REFUNDED` exclusion is gone from BOTH bases.** It existed to
match Seller Hub's "Total sales" headline and caused two defects:

- *Double deduction*: the eBay Refunds row already deducts the refund, so
  dropping the receipt too removed the same money twice — £1,136.95 across 35
  refunds all-time, on accrual.
- *The flag is not trustworthy*: four orders (£252.23) are marked
  `order_payment_status = FULLY_REFUNDED` while their own `payment_summary` says
  `refunds: []`, `paymentStatus: PAID`, `cancelState: NONE_REQUESTED` and a
  positive `totalDueSeller`. Paid, fulfilled, never refunded. The exclusion was
  deleting genuine income on one contradicted field.

Now every receipt counts and every refund deducts, so a genuinely refunded order
nets out through real transactions. `queryEbayGrossSalesCash` is deleted — the
two bases were identical once the exclusion went. Cost: accrual no longer matches
Seller Hub's headline, which was never what we file.

**3. BrickLink commission — NO fix needed; the earlier "gap" was wrong.**
BL commission IS captured, as Monzo merchant `Legobrickli` under Selling Fees.
Measured over 20 months: **£482.64 paid against £486.60 expected at 3% of order
value excluding postage — 99.2%.** The rate is right and no money is missing.
What looked like a £90/quarter shortfall was cash-basis timing: BL invoices are
paid irregularly (11 payments in 20 months), so a quarter contains whatever was
*paid* in it, which on a cash basis is exactly correct. `bricklink_transactions`
has no fee column and no BL commission is paid from the PayPal balance — both
checked.

**4. eBay now has a fail-loud registry** (`EBAY_TYPE_TREATMENT`), the last
platform without one. All 9,530 rows classified: SALE income, NON_SALE_CHARGE
fees, REFUND deduction+credits, **SHIPPING_LABEL postage (£185.79 all-time,
previously claimed NOWHERE — now its own `eBay Postage Labels` row in box 23)**,
and DISPUTE/CREDIT/TRANSFER/ADJUSTMENT excluded as balance movements (DISPUTE
£400.21 over 9 rows is offset one-for-one by CREDIT £400.21 over 9 rows — the
same shape as Amazon's `Reserve`). Also made standalone NON_SALE_CHARGE fee rows
symmetric: credits were netted but debits were not, so £5.59 of standalone
FINAL_VALUE_FEE / FVF_FIXED / REGULATORY_OPERATING_FEE charges reached no box.
Q1 exposure for every one of these: £0.00. FY2025/26: £8.46.

**5. `MtdExportService` hardened** — the second consumer of the same report,
which never received the round 1–3 fixes:

- `buildSalesRows` had an `if/else-if` chain with **no `else`**, silently dropping
  any income row not naming one of four platforms. `Shopify` and `Direct PayPal`
  are now mapped platforms (£144.46 that the ledger was missing), and an unmapped
  income row **throws**.
- `Math.abs` on expenses replaced with negation — a net-credit month was being
  pushed as an equal-sized charge.
- Added the `failedRows` refusal.

### Figures after round 4

| Period | Basis | Turnover | Expenses | Profit |
|---|---|---|---|---|
| **Q1 26/27, 6 Apr – 5 Jul** | **cash** | **16,423.34** | **10,948.87** | **5,474.47** |
| Q1 26/27, 6 Apr – 5 Jul | accrual | 17,334.81 | 10,948.87 | 6,385.94 |
| FY25/26, 6 Apr 25 – 5 Apr 26 | cash | 74,641.67 | 52,215.91 | 22,425.76 |
| FY25/26, 6 Apr 25 – 5 Apr 26 | accrual | 73,772.30 | 52,215.91 | 21,556.39 |

FY25/26 cash profit moves £22,434.22 → £22,425.76 (the £8.46 of eBay postage and
standalone fees now claimed).

## Monzo categories: what the P&L reads, and what Chris has ruled out

The P&L reads exactly **eight** Monzo `local_category` values — `Lego Stock`,
`Lego Parts`, `Postage`, `Packing Materials`, `Selling Fees`, `Office Space`,
`Services`, `Software`. Everything else is ignored, and three validation rounds
kept re-raising the same handful because nothing recorded the decisions. They are
recorded here. **Do not re-raise these.**

### Correctly excluded, permanently

| Category | Q1 26/27 | FY25/26 | All-time | Why |
|---|---|---|---|---|
| `Salary` | −£6,000.00 | −£25,000.00 | −£53,000.00 | **DRAWINGS, not wages.** £500/wk to "Chris Hadley". A sole trader cannot deduct their own pay — the profit *is* the income. SA103F box 19 is for STAFF. Putting Q1's £6,000 in box 19 would have filed a £525.53 LOSS instead of a £5,474.47 profit. (Would differ for a limited company: a director's salary IS deductible.) |
| `Income` | +£15,576.95 | +£62,572.92 | +£150,564.63 | Bank money-in. Income comes from the platform sources; reading both would double-count everything. |
| `Transfers` | −£63.66 | — | −£108.43 | `PAY*THRONE` — **confirmed PERSONAL by Chris, 2026-07-25.** |
| `General` | −£20.00 | — | −£112.00 | `PAYPAL *alayacontreras` — **confirmed PERSONAL by Chris, 2026-07-25.** |
| `Personal` | £0.00 | −£201.58 | −£201.58 | Booking.com, resolved as personal 2026-07-03. |
| `Entertainment` | £0.00 | £0.00 | −£114.39 | Business entertainment is disallowable regardless. |

### Retired categories — no longer in use

**Chris confirmed 2026-07-25: "don't use these any more".** All four are £0.00 in
both Q1 2026/27 and FY2025/26, so neither return is affected. They are historical
only and must not be wired into the P&L.

| Category | All-time |
|---|---|
| `Clothing Stock Purchase` | −£2,092.01 |
| `Bills` | −£167.98 |
| `Insurance` | −£69.96 (note: the P&L's Insurance row comes from `home_costs`, a different source entirely) |
| `Travel` | −£6.80 |

### The remaining gap

Monzo is now the only money source with **no fail-loud registry** — a brand-new
category would be silently ignored, which is the exact class of defect that hid
the Amazon `Adjustment` costs and the non-T0006 PayPal receipts. Every other
source (Amazon types + Adjustment descriptions, PayPal event codes, eBay types +
OTHER_FEES memos) now throws on anything unclassified. Worth closing before Q2.
