# Fix: Monzo sync category guard + uncategorised counter

**Date:** 2026-08-02
**Branch:** `fix/monzo-sync-category-guard`
**Track:** Fix

## Problem

The Monzo sheets sync copied the sheet's Category column into `local_category`
verbatim on every new row (`existing?.local_category || row.Category || null`).
That column is Monzo's per-merchant auto-guess, and in early July 2026 Monzo
retroactively re-mapped the account's PayPal merchants (BrickLink sellers →
Entertainment/Services/General, Keepa/Proton/Bricqer → Bills). Result: 20 July
transactions (~£680 of costs and a £56.11 sale refund) were silently misfiled —
some into categories the P&L never reads (invisible), some into wrong-but-valid
P&L categories (misallocated between MTD boxes).

The designed safety net — the twice-weekly "Categorise Monzo transactions"
workflow task — never fired because:

1. Every synced row got *some* category, so nothing was ever "uncategorised".
2. Its count source read `category is null`; the sheets sync always writes
   `category = null` (Monzo's original category isn't in the export), so the
   badge counted all 4,662 transactions — permanent noise.

Q1 2026/27 (submitted) was verified clean: the DB's first-seen category
stickiness preserved the correct pre-July values even after Monzo rewrote the
sheet's history. July's data was corrected by hand on 2026-08-02.

## Fix

### `apps/web/src/lib/monzo/monzo-category-rules.ts` (new)

- `TRUSTED_LOCAL_CATEGORIES` — the P&L taxonomy (Lego Stock, Lego Parts,
  Postage, Packing Materials, Selling Fees, Services, Software, Office Space)
  plus deliberate buckets (Income, Salary, Personal, Transfers).
- `buildMerchantPrecedentMap()` — merchant → dominant trusted category from our
  own history (≥2 rows, strict majority).
- `resolveLocalCategory()` — resolution order for new rows:
  trusted sheet category → merchant precedent → PayPal-descriptor heuristic
  (`PAYPAL *…` → Lego Parts; every historic Lego Parts row is a PayPal BL-store
  payment) → NULL (queued for review).
- Existing rows keep their stored value **verbatim, including NULL** — the old
  `||` fallback would have let the sheet's auto-guess refill a row that was
  deliberately awaiting review.

### `apps/web/src/lib/monzo/monzo-sheets-sync.service.ts`

- Existing-row fetch now also selects `merchant_name` (feeds the precedent map).
- `transformSheetRow` delegates `local_category` to `resolveLocalCategory`.

### `apps/web/src/lib/services/workflow.service.ts`

- `transactions.uncategorised` count source now reads
  `local_category is null` (non-archived) instead of the always-null `category`.

## Verification

- `tsc --noEmit` clean.
- `vitest run src/lib/monzo src/lib/services/__tests__/profit-loss-cash-basis.test.ts`
  — 115 tests, 6 files, all passing (17 new tests for the rules module:
  trusted pass-through, NULL preservation, precedent majority/tie/threshold,
  PayPal heuristic, taxonomy membership).
- ESLint clean on all changed files.

## Notes / out of scope

- PayPal friends/family sends are invisible to `paypal_transactions` (sync
  stores only T0006 + T1107); a manually-sent buyer refund therefore bypasses
  the cash P&L refunds line. The 2026-07-31 £56.11 case was backfilled by hand
  with its real PayPal transaction ID. Making that durable (e.g. capturing
  T0400/T0011 sends) is a separate piece of work if wanted.
- The transactions page UI already supports editing `local_category`, so
  NULL rows are actionable as-is via the workflow deep link.
