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
