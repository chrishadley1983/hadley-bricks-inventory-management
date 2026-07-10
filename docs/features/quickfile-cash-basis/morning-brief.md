# Morning Brief — QuickFile MTD, 3 July 2026

## What happened overnight (all done, verified)

1. **Cash-basis MTD export built, tested, merged, deployed** (PRs #503 + #504).
   Both bases (accrual + cash) selectable in the P&L → "Export for MTD" dropdown,
   CSV or direct QuickFile push, on the same data at any time.
2. **QuickFile linked via API.** Your account `7131412142` + app "HB Import"
   (App ID `6e0bb58b-…`) authenticated live; credentials stored encrypted in
   `platform_credentials`. The API key from your screenshot was complete.
3. **April–June 2026 loaded into QuickFile on CASH basis**: 12 sales invoices
   (£15,948.23) + 19 purchases (£10,789.04), zero errors, logged to
   `mtd_export_history` with `basis: cash`. A "Marketplace Sales" client and
   "Marketplace & Sundry Suppliers" supplier were created as the ledger
   counterparties. Two £0.01 API test records were created and deleted.
4. **Three latent bugs from the January build fixed** (it had never been
   live-tested): nonexistent auth endpoint, wrong invoice/purchase schemas,
   and a DB constraint that blocked credential saves.
5. **A material pre-existing P&L bug fixed**: every report dropped
   transactions on the last day of its final month (inclusive-midnight date
   bound). Affected the UI P&L and any MTD export.
6. **E2E validation workflow** authored + run TWICE:
   `.claude/workflows/validate-quickfile-cash-basis.js` — independent SQL
   recomputation, QuickFile ledger cross-check, adversarial refutations.
   **First run: FAIL** — it caught two fresh defects in the P&L service (a
   duplicate-key filter that unbounded six Monzo expense rows, and home-cost
   rows bucketing one extra month). Fixed in **PR #505**, deployed, and
   confirmed the pushed QuickFile figures were never affected (the export
   reads only in-range months; post-fix export output is byte-identical).
   **Second run: PASS** — all 12 income figures penny-exact vs independent
   SQL, ledger counts/totals exact (12 invoices £15,948.23 / 19 purchases
   £10,789.04), zero refutations. Every future quarter should re-run this
   workflow before submitting.

## Cash-basis methodology (what the numbers mean)

Income = money received (agent-receipt principle), expenses = money paid:
- Amazon: funds released to seller balance (RELEASED events, by release date)
- BrickLink/Brick Owl: buyer payments landing in PayPal, minus refunds issued
- eBay: buyer pays at sale (receipt ≡ sale date)
Full audit trail: `docs/features/quickfile-cash-basis/design.md`

Pushed figures (income by month): Apr £4,218.43 · May £5,691.85 · Jun £6,037.95

## What YOU need to do (only you can — Government Gateway)

1. **Log in to QuickFile → Reports → HMRC** (or Account Settings → MTD):
   connect QuickFile to HMRC by signing in with your Government Gateway ID and
   granting MTD authorisation. ~5 minutes. I cannot do this step — it's your
   HMRC identity.
2. **Check you're signed up for MTD ITSA** with HMRC (if you haven't been
   auto-migrated: gov.uk "sign up for Making Tax Digital for Income Tax").
3. **Eyeball the ledger** (Sales → Invoices; Purchases): 12 invoices + 19
   purchases, references like `AMAZON-202606` / `FEES-202605`.
4. **Quarterly update, due 7 August** for Q1 (6 Apr – 5 Jul): QuickFile's MTD
   module submits from the ledger. Consider electing **calendar quarters**
   (Apr 1 – Jun 30) in HMRC settings so the ledger months align exactly;
   otherwise Q1 needs 1–5 Jul receipts too (they exist in the data — an
   `2026-07` export can be pushed when July closes).

## Decisions locked overnight (flag if you disagree)

- **Basis pushed: CASH** (your stated intent for HMRC submission). The accrual
  export remains available; if you ever want it in QuickFile instead, the
  cash entries would need deleting first (QuickFile → bulk delete, or I can
  do it via API).
- VAT = 0 on everything (below threshold, as per the original spec).
- Shopify (~£25/month) out of scope in both bases, as in the existing P&L.

## Going forward (monthly routine)

After each month closes (wait ~a week for Amazon releases/eBay processing to
settle): P&L → Export for MTD → *Cash basis* → Push to QuickFile for the
closed month. The duplicate-warning is per-month-per-basis, so re-pushing a
month warns first.
