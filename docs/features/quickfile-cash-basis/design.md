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
