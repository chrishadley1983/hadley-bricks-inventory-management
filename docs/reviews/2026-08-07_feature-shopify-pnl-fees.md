# Code Review — feature/shopify-pnl-fees (PR #665)

**Mode:** branch · **Date:** 2026-08-07 · **Files:** 11 changed

## Static Analysis

| Check | Status |
|-------|--------|
| TypeScript | ✅ No errors |
| ESLint | ✅ Clean on changed files (incl. pre-existing unused-var fix in mtd-sa103-boxes) |
| Tests | ✅ 88 pass across shopify + P&L + MTD suites (5 new) |
| Migrations | ✅ Applied to cloud (20260807100000, RLS + indexes) |

## Summary

| Category | Critical | Major | Minor | Nitpick |
|----------|----------|-------|-------|---------|
| Correctness | 0 | 0 | 1 | 0 |
| Security | 0 | 0 | 0 | 0 |
| Performance | 0 | 0 | 1 | 0 |

**Found and fixed during review:** the new `Shopify Fees` P&L row had no `BOX_BY_ROW`
entry in `mtd-sa103-boxes.ts` — the unmapped-row guard would have thrown at the next
quarterly run. Mapped to box 26 (bank/financial charges, alongside PayPal Fees) and
proven end-to-end: Jun–Jul boxes build clean, box 26 = PayPal £242.39 + Shopify £4.72.

### Minor

**CR-001 — `platform_orders.fees` is 0.00 for PayPal-gateway Shopify orders**
The actual fee (£5.87 on #1009, visible in `raw_response.receipt.seller_receivable_breakdown`)
is deliberately NOT recorded in shopify_transactions/platform_orders — PayPal Fees row
(paypal_transactions) is authoritative, preventing a double claim. Any future consumer
reading `platform_orders.fees` directly for Shopify per-order profitability will
understate PayPal-paid orders. Documented in the service; revisit only if a consumer
appears.

**CR-002 — Guard query runs per cash queryFn**
`fetchPayPalCustomerReceipts` fetches shopify_transactions payment_refs on each of its
three cash-basis callers (3 small extra queries per report). Trivial at current volume;
memoise if the table grows.

## Live verification (done pre-merge)

- Backfill: 11 transactions, gross £390.31, fees £6.36, all SP rows payout-linked;
  fee-per-charge verified as exactly 2% + 25p.
- Refund path: #1007's £6.99 partial refund captured (was invisible under the old
  `financial_status: 'paid'` fetch) → Shopify Refunds row −£6.99.
- Dedup guard proven on live data: after triggering the PayPal sync, capture
  `78138313C9736984C` (£191.99, T0006) entered paypal_transactions and the cash-basis
  BrickLink row correctly shows £0.00 for Aug while PayPal Fees picked up the £5.87.

## Security checklist

- New table has RLS (user-scoped ALL policy), no public read ✅
- No credentials in code; Shopify creds via existing shopify_config ✅
- Cron path unchanged (Bearer CRON_SECRET) ✅

## Verdict

**✅ READY FOR MERGE** — no critical or major issues; the one genuine defect
(missing box mapping) was fixed in-branch and verified against live data.
