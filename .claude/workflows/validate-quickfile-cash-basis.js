export const meta = {
  name: 'validate-quickfile-cash-basis',
  description:
    'E2E validation of the cash-basis MTD export + QuickFile Apr-Jun load: independent SQL recomputation, QuickFile ledger cross-check, code-audit refutation, PASS/FAIL synthesis',
  whenToUse:
    'After deploying the cash-basis MTD export (PRs #503/#504) and pushing a period to QuickFile, to independently confirm the pushed figures are correct before an HMRC submission.',
  phases: [
    { title: 'Recompute', detail: 'independent SQL recomputation of cash + accrual figures' },
    { title: 'Ledger', detail: 'QuickFile API cross-check of what was actually created' },
    { title: 'Refute', detail: 'adversarial audit of the known failure modes' },
    { title: 'Synthesis', detail: 'PASS/FAIL verdict' },
  ],
}

// The figures the export pushed to QuickFile on 2026-07-02 (cash basis).
const PUSHED = {
  sales: {
    '2026-04': { EBAY: 713.95, AMAZON: 1342.45, BRICKLINK: 1865.74, BRICKOWL: 296.29 },
    '2026-05': { EBAY: 996.88, AMAZON: 2236.1, BRICKLINK: 1980.65, BRICKOWL: 478.22 },
    '2026-06': { EBAY: 870.72, AMAZON: 1907.59, BRICKLINK: 2850.62, BRICKOWL: 409.02 },
  },
  counts: { invoices: 12, purchases: 19 },
}

const RECOMPUTE_SCHEMA = {
  type: 'object',
  properties: {
    months: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          month: { type: 'string' },
          platform: { type: 'string' },
          recomputed: { type: 'number' },
          pushed: { type: 'number' },
          match: { type: 'boolean' },
          note: { type: 'string' },
        },
        required: ['month', 'platform', 'recomputed', 'pushed', 'match'],
      },
    },
    allMatch: { type: 'boolean' },
    notes: { type: 'string' },
  },
  required: ['months', 'allMatch'],
}

const LEDGER_SCHEMA = {
  type: 'object',
  properties: {
    invoiceCount: { type: 'number' },
    purchaseCount: { type: 'number' },
    invoiceTotal: { type: 'number' },
    purchaseTotal: { type: 'number' },
    countsMatch: { type: 'boolean' },
    totalsMatch: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'string' } },
  },
  required: ['invoiceCount', 'purchaseCount', 'countsMatch', 'issues'],
}

const REFUTE_SCHEMA = {
  type: 'object',
  properties: {
    claim: { type: 'string' },
    refuted: { type: 'boolean' },
    evidence: { type: 'string' },
    severity: { type: 'string', enum: ['none', 'minor', 'material', 'critical'] },
  },
  required: ['claim', 'refuted', 'evidence', 'severity'],
}

const CWD = 'C:/Users/Chris Hadley/claude-projects/hadley-bricks-inventory-management/apps/web'

phase('Recompute')

const recomputePrompt = `You are validating figures that were pushed to QuickFile for an HMRC MTD submission. Independently recompute the CASH-BASIS income per platform per month for 2026-04, 2026-05, 2026-06 from Supabase (project modjoikyuhqzouxvieua) using the Supabase MCP execute_sql tool (load it via ToolSearch "select:mcp__plugin_supabase_supabase__execute_sql" first). Do NOT read the app's service code — derive from the data definitions below so your computation is independent:

- AMAZON cash income for month M = SUM(gross_sales_amount) of amazon_transactions where transaction_type='Shipment' AND transaction_status='RELEASED' AND posted_date in M, MINUS SUM(|total_amount|) of amazon_transactions where transaction_type IN ('Refund','GuaranteeClaimRefund') AND transaction_status='RELEASED' AND posted_date in M.
- BRICKLINK cash = SUM(gross_amount) of paypal_transactions where transaction_event_code='T0006' AND gross_amount>0 AND transaction_date in M AND (transaction_type IS NULL OR transaction_type NOT ILIKE 'Brick Owl Order%'), MINUS SUM(|gross_amount|) of paypal_transactions where transaction_event_code='T1107' AND gross_amount<0 AND transaction_date in M.
- BRICKOWL cash = SUM(gross_amount) of paypal_transactions where transaction_event_code='T0006' AND gross_amount>0 AND transaction_type ILIKE 'Brick Owl Order%' AND transaction_date in M.
- EBAY cash = SUM(gross_transaction_amount) of ebay_transactions where transaction_type='SALE' AND transaction_date in M AND ebay_order_id NOT IN (SELECT ebay_order_id FROM ebay_orders WHERE order_payment_status='FULLY_REFUNDED'), MINUS SUM(amount) of ebay_transactions where transaction_type='REFUND' AND booking_entry='DEBIT' AND transaction_date in M.
Use month windows [first-of-month, first-of-next-month). Round to 2dp.

Compare against the pushed values: ${JSON.stringify(PUSHED.sales)}.
A match means within £0.01. Report every platform-month with recomputed vs pushed. Return via StructuredOutput.`

const ledgerPrompt = `Validate what actually exists in the QuickFile ledger (account hadleybricks.quickfile.co.uk) after tonight's push. Write and run a small tsx script in ${CWD} (pattern: import CredentialsRepository from '@/lib/repositories' and QuickFileService from '@/lib/services/quickfile.service'; get credentials for user 4b6e94b4-661c-4462-9d14-b21df7d51e5b platform 'quickfile' using a service-role supabase client built from .env.local NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY; then call the QuickFile API invoice/search and purchase/search — mimic the auth/body mechanics in scripts/_quickfile-live-invoice-test.ts, using SearchParameters with ReturnCount '100', Offset '0', OrderResultsBy 'IssueDate' (invoices) / 'ReceiptDate' or similar for purchases, OrderDirection 'ASC'; if a parameter is rejected the API error names the allowed values — iterate). Count invoices and purchases and sum their totals. Expected: ${PUSHED.counts.invoices} invoices totalling 15948.23 and ${PUSHED.counts.purchases} purchases totalling 10789.04 (there may also be zero TEST invoices — two test records were created and deleted earlier; flag any leftover TEST-DELETE-ME records as an issue). Return via StructuredOutput.`

const [recompute, ledger] = await parallel([
  () => agent(recomputePrompt, { label: 'recompute:sql', phase: 'Recompute', schema: RECOMPUTE_SCHEMA }),
  () => agent(ledgerPrompt, { label: 'ledger:quickfile', phase: 'Ledger', schema: LEDGER_SCHEMA }),
])

phase('Refute')

const CLAIMS = [
  `CLAIM: Summing only transaction_status='RELEASED' Shipment rows in amazon_transactions neither double-counts nor misses any released order. Try to refute with SQL on project modjoikyuhqzouxvieua (load the Supabase MCP execute_sql tool via ToolSearch first): (a) find any amazon_order_id with >1 RELEASED Shipment row (same order counted twice); (b) find any order whose ONLY shipment rows are DEFERRED_RELEASED (would be missed by RELEASED-only); (c) find DEFERRED rows older than 60 days with no RELEASED sibling (stuck money that will never be counted).`,
  `CLAIM: The PayPal T0006/gross>0 receipt set equals BrickLink+BrickOwl order income and contains no non-sale contamination. Try to refute with SQL on project modjoikyuhqzouxvieua: (a) look for positive T0006 rows in Apr-Jun 2026 whose payer/description suggests NOT a BL/BO customer payment (eBay refunds, transfers, personal); (b) compare monthly T0006-positive totals to bricklink_transactions + brickowl_transactions order totals for the same months - a persistent gap >5% suggests missing/extra flows; (c) check whether any Brick Owl order was paid outside PayPal (brickowl_transactions total vs BO-labelled T0006 total).`,
  `CLAIM: In apps/web/src/lib/services/profit-loss-report.service.ts on main at commit c5d8d036 or later (run git log -1 --oneline first to confirm), the month-range bounds are exclusive (lt first-of-next-month) in EVERY dated query INCLUDING queryMonzoByCategory (previously had a duplicate lt: key that dropped the date bound — verify the fix holds and no other filter-options object in the file has a duplicate key that silently overwrites an earlier condition), home-cost rows are confined to [startMonth, endMonth] (previously bucketed one extra month via endDate.substring), and expense rows are computed identically for basis 'accrual' and 'cash'. Try to refute by reading the file carefully.`,
]

const refutations = await parallel(
  CLAIMS.map((c, i) => () =>
    agent(
      `You are an adversarial auditor for figures feeding an HMRC tax submission. ${c}\nWork in ${CWD.replace('/apps/web', '')}. Be rigorous; if you cannot refute, say so with the evidence you gathered. Return via StructuredOutput.`,
      { label: `refute:${i + 1}`, phase: 'Refute', schema: REFUTE_SCHEMA }
    )
  )
)

phase('Synthesis')

const verdict = await agent(
  `Synthesise a PASS/FAIL verdict for the cash-basis MTD export + QuickFile Apr-Jun 2026 load, which will back an HMRC submission.

Independent SQL recomputation vs pushed figures:
${JSON.stringify(recompute, null, 2)}

QuickFile ledger cross-check:
${JSON.stringify(ledger, null, 2)}

Adversarial refutations:
${JSON.stringify(refutations, null, 2)}

Rules: FAIL if any pushed figure differs from recomputation by more than £0.01, if the ledger counts/totals don't match, or if any refutation found a 'material' or 'critical' issue. Otherwise PASS (with notes for 'minor'). Give the verdict, a one-paragraph justification, and list any follow-ups. Return as plain text starting with the word PASS or FAIL.`,
  { label: 'synthesis', phase: 'Synthesis' }
)

return { verdict, recompute, ledger, refutations }
