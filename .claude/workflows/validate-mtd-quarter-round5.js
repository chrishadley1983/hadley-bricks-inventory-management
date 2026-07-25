export const meta = {
  name: 'validate-mtd-quarter-round5',
  description:
    'Round-5 validation of Q1 2026/27 after the round-4 follow-ups (PR #642): independent SQL recomputation of every box from the Amazon breakdowns tree, the upload file, and adversarial re-audit of the four defects + the sign trap',
  whenToUse:
    'After merging PR #642, to confirm the return still holds and the QuickFile path that failed round 3 is genuinely fixed.',
  phases: [
    { title: 'Recompute', detail: 'independent re-derivation of turnover + every expense box' },
    { title: 'File', detail: 'the actual .xlsx that will be uploaded' },
    { title: 'Refute', detail: 'are the four defects actually fixed, and nothing new broken' },
    { title: 'Synthesis', detail: 'PASS/FAIL' },
  ],
}

const RETURN = {
  period: { start: '2026-04-06', endExclusive: '2026-07-06' },
  boxes: { 15: 16423.34, 17: 5519.37, 20: 25.2, 21: 445.44, 23: 2470.06, '24.1': 114.82, 26: 386.28, 30: 1987.70 },
  expenses: 10948.87,
  profit: 5474.47,
  components: {
    amazonSalesLeaf: 5587.18,
    amazonRefundedSales: 118.66,
    amazonFeesNet: 1018.82,
    ebayGrossInclRefundedOrders: 2729.01,
    ebayRefundsGross: 59.23,
    otherPayPalReceipts: 120.0,
    shopifySales: 24.46,
    bricklink: 7206.54,
    brickowl: 1230.92,
    blboRefunds: 296.88,
    ebayAdFees: 114.82,
    ebayFixedFees: 40.68,
  },
}

const USER_ID = '4b6e94b4-661c-4462-9d14-b21df7d51e5b'
const PROJECT = 'modjoikyuhqzouxvieua'
const REPO = 'C:/Users/Chris Hadley/claude-projects/hb-dashboard-wt'
const WEB = `${REPO}/apps/web`
const XLSX = `${REPO}/docs/features/quickfile-cash-basis/MTD_SA103_2026-27_Q1_6Apr-5Jul.xlsx`

const BOX_SCHEMA = {
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          recomputed: { type: 'number' },
          claimed: { type: 'number' },
          match: { type: 'boolean' },
          method: { type: 'string' },
        },
        required: ['label', 'recomputed', 'claimed', 'match'],
      },
    },
    allMatch: { type: 'boolean' },
    notes: { type: 'string' },
  },
  required: ['lines', 'allMatch'],
}

const FILE_SCHEMA = {
  type: 'object',
  properties: {
    cells: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          cell: { type: 'string' },
          box: { type: 'string' },
          value: { type: 'string' },
          match: { type: 'boolean' },
        },
        required: ['cell', 'box', 'value', 'match'],
      },
    },
    box31Empty: { type: 'boolean' },
    strayValues: { type: 'array', items: { type: 'string' } },
    allMatch: { type: 'boolean' },
    notes: { type: 'string' },
  },
  required: ['cells', 'box31Empty', 'allMatch'],
}

const REFUTE_SCHEMA = {
  type: 'object',
  properties: {
    claim: { type: 'string' },
    refuted: { type: 'boolean' },
    evidence: { type: 'string' },
    amountAtRiskGBP: { type: 'number' },
    severity: { type: 'string', enum: ['none', 'minor', 'material', 'critical'] },
  },
  required: ['claim', 'refuted', 'evidence', 'severity'],
}

const DATA = `Query Supabase project ${PROJECT} for user_id '${USER_ID}'. Prefer the Supabase MCP execute_sql tool (load via ToolSearch "select:mcp__plugin_supabase_supabase__execute_sql"); if it is unauthenticated, fall back to PostgREST via @supabase/supabase-js with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from ${WEB}/.env.local, writing a throwaway script named scripts/_tmp-<purpose>-2026-07-25.ts in ${WEB} (that prefix is gitignored) — and PAGINATE past the 1,000-row cap. Say which method you used. Period: [${RETURN.period.start}, ${RETURN.period.endExclusive}). Derive from raw tables; do NOT read the application service code for the figures.`

phase('Recompute')

const turnoverPrompt = `Independently verify TURNOVER (SA103F box 15) on a corrected HMRC return. ${DATA}

CRITICAL — the Amazon flat columns are DEFECTIVE and must not be used: \`gross_sales_amount\` is NET of the DigitalServicesFee and \`total_fees\`/\`referral_fee\` are Commission only. Amazon money must come from the \`breakdowns\` JSONB tree, where each node is {breakdownType, breakdownAmount:{currencyAmount}, breakdowns:[...]} and CHILDREN RESTATE THEIR PARENT — so when summing a type you must NOT descend into a matched node, or you will double count.

Components to verify (cash basis):
- Amazon gross = SUM of the top-level \`Sales\` node over Shipment/RELEASED rows. Claimed ${RETURN.components.amazonSalesLeaf}
- Amazon refunded sales = SUM of \`Refunded Sales\` (absolute) over Refund+GuaranteeClaimRefund/RELEASED. Claimed ${RETURN.components.amazonRefundedSales}. NOTE: it must be Refunded Sales ONLY, not total_amount, which also contains \`Refunded Expenses\` (a fee credit).
- eBay gross = SUM(gross_transaction_amount) of ebay_transactions transaction_type='SALE' in period, INCLUDING orders whose ebay_orders.order_payment_status='FULLY_REFUNDED' (on cash the refund row deducts them, so excluding the receipt would double-deduct). Claimed ${RETURN.components.ebayGrossInclRefundedOrders}
- eBay refunds = the GROSS refund, i.e. raw_response.totalFeeBasisAmount (NOT the \`amount\` column, which is already net of the fees eBay credits back — verify basis minus totalFeeAmount equals amount on every row). Claimed ${RETURN.components.ebayRefundsGross}
- Other PayPal receipts = positive rows with transaction_event_code IN ('T0011','T0000'). Claimed ${RETURN.components.otherPayPalReceipts}
- Shopify = SUM(total) of platform_orders platform='shopify', excluding cancelled. Claimed ${RETURN.components.shopifySales}
- BrickLink = T0006 paypal receipts >0 not ILIKE 'brick owl order%'. Claimed ${RETURN.components.bricklink}
- Brick Owl = same, ILIKE 'brick owl order%'. Claimed ${RETURN.components.brickowl}
- BL/BO refunds = T1107 with gross_amount<0, absolute. Claimed ${RETURN.components.blboRefunds}

Box 15 = AmazonGross − AmazonRefundedSales + BL + BO + OtherPayPal + Shopify − BLBORefunds + eBayGross − eBayRefundsGross. Claimed ${RETURN.boxes[15]}.
CRITICAL: Amazon Adjustment rows described 'Reserve' must be EXCLUDED from BOTH Sales and Expenses (8 rows carry Sales +6,263.55 and Expenses −6,263.55, a balance movement netting to zero). Confirm none of that £6,263.55 has reached either side.
Sanity identity you should also check and report: for Shipment/RELEASED rows, Sales + Expenses == total_amount (the real payout). Report one line per component plus box 15; match = within £0.01. Return via StructuredOutput.`

const expensesPrompt = `Independently verify the EXPENSE boxes on a corrected HMRC return. ${DATA}

Box mapping: 17 = Lego Stock Purchases + Lego Parts (Monzo); 20 = mileage; 21 = Office/unit rent + Use of Home + Insurance; 23 = Postage + Packing + Phone & Broadband + Website/Software; 24.1 = eBay ad fees; 26 = PayPal fees; 30 = marketplace commissions + Amazon subscription + banking fees.

Verify these in particular, they are the corrected ones:
- Amazon fees = SUM of the top-level \`Expenses\` node (absolute) over RELEASED rows of type Shipment AND Adjustment (return postage — 'LabmanLabelReturn'/'LabmanLabelPurchase'), EXCLUDING description='Reserve' and EXCLUDING types Transfer/ServiceFee/AdhocDisbursement/DebtRecovery, LESS SUM of \`Refunded Expenses\` on RELEASED refund rows. Do NOT use total_fees/referral_fee (Commission only). Claimed ${RETURN.components.amazonFeesNet}
- eBay ad fees = AD_FEE debits less AD_FEE credits ONLY (raw_response->>'feeType'), from NON_SALE_CHARGE rows. Credits of other feeTypes must NOT reduce ad fees. Claimed ${RETURN.components.ebayAdFees}
- eBay fixed fees = FINAL_VALUE_FEE_FIXED_PER_ORDER inside SALE rows' marketplaceFees, LESS standalone NON_SALE_CHARGE CREDITs of that feeType, LESS the same feeType's credits carried inside REFUND rows' own marketplaceFees. Claimed ${RETURN.components.ebayFixedFees}
  (eBay fixed fees claimed 40.20, variable 348.82, regulatory 11.21 after the refund-credit netting.)

Claimed boxes: 17=${RETURN.boxes[17]}, 20=${RETURN.boxes[20]}, 21=${RETURN.boxes[21]}, 23=${RETURN.boxes[23]}, 24.1=${RETURN.boxes['24.1']}, 26=${RETURN.boxes[26]}, 30=${RETURN.boxes[30]}, total=${RETURN.expenses}.
Report a line per box plus a total. Where a source is ambiguous say so in notes rather than claiming a match. Return via StructuredOutput.`

const filePrompt = `Verify the actual upload file: ${XLSX}
Read with python (openpyxl, or unzip xl/worksheets/sheet1.xml). Check C7=${RETURN.boxes[15]}, C19=${RETURN.boxes[17]}, C31=${RETURN.boxes[20]}, C35=${RETURN.boxes[21]}, C43=${RETURN.boxes[23]}, C47=${RETURN.boxes['24.1']}, C59=${RETURN.boxes[26]}, C75=${RETURN.boxes[30]}; that C77 (box 31 consolidated) is EMPTY; that the column-B '£' labels survive; and list any other numeric cell holding a value that could be submitted by accident. Also confirm the boxes sum: expenses ${RETURN.expenses}, and turnover − expenses = ${RETURN.profit}. Return via StructuredOutput.`

const [turnover, expenses, file] = await parallel([
  () => agent(turnoverPrompt, { label: 'recompute:turnover', phase: 'Recompute', schema: BOX_SCHEMA }),
  () => agent(expensesPrompt, { label: 'recompute:expenses', phase: 'Recompute', schema: BOX_SCHEMA }),
  () => agent(filePrompt, { label: 'file:xlsx', phase: 'File', schema: FILE_SCHEMA }),
])

phase('Refute')

const CLAIMS = [
  `CLAIM: Removing the FULLY_REFUNDED exclusion cannot double-count or double-deduct. ${DATA} Prove or refute on live data: (a) for eBay orders flagged order_payment_status='FULLY_REFUNDED', sum the SALE receipts of those that HAVE a REFUND row and sum the gross refunds (raw_response.totalFeeBasisAmount) — they should net to ~£0.00; (b) confirm the 4 orders with NO refund row (21-14025-43784, 23-13662-26960, 27-13328-52513, 06-13156-57194, £252.23) each have a DISPUTE debit AND a matching CREDIT on the same ebay_order_id, i.e. they were disputes WON and the income is genuine; (c) check no DISPUTE debit anywhere lacks a matching CREDIT — an unmatched one is a LOST dispute, a real loss that the 'excluded' treatment would hide; (d) confirm a partially-refunded order is not distorted.`,
  `CLAIM: eBay money is now completely accounted for. ${DATA} Sweep every one of the ~9,530 ebay_transactions rows: (a) list every distinct transaction_type and state which P&L row it reaches (SALE income, NON_SALE_CHARGE fees by feeType, REFUND deduction+credits, SHIPPING_LABEL the new eBay Postage Labels row, DISPUTE/CREDIT/TRANSFER excluded as movements, ADJUSTMENT deliberately unclaimed); (b) list every distinct raw_response.feeType AND, for OTHER_FEES, every distinct transactionMemo, confirming each reaches exactly one box — the shop-subscription memo pattern goes to box 30 and 'Promoted Offsite' to box 24.1, and NOTHING falls between them; (c) quantify anything still unread, for Q1 2026/27 and FY2025/26 separately. PAGINATE — the table exceeds the 1,000-row cap and an unpaginated query already produced a false negative once in this investigation.`,
  `CLAIM: The QuickFile export path — which FAILED round-3 validation — is genuinely fixed. Read ${WEB}/src/lib/services/mtd-export.service.ts on main (git log -1 should show 59d18367 or later) and refute: (a) does buildSalesRows still have a silent fall-through, or does every income row now either map to a platform or THROW? Confirm 'Other PayPal Sales (cash received)' and 'Shopify Sales' map to real platforms with references, and compute what the Apr-Jun income total would now be versus the £16,128.35 the report shows and the £144.46 gap previously measured; (b) is Math.abs gone from the expense path, and does negation handle a net-credit month correctly? (c) is the failedRows refusal present and unavoidable? (d) is there any OTHER consumer of ProfitLossReport anywhere in the codebase that still lacks these guards — grep for generateReport callers and check each.`,
  `CLAIM: Q1 2026/27 is unchanged and the upload file still matches. ${DATA} (a) Re-derive box 15 and total expenses completely independently from raw tables and compare to ${RETURN.boxes[15]} / ${RETURN.expenses} / profit ${RETURN.profit}. (b) Read ${XLSX} and confirm all 8 cells match, C77 (box 31) is empty, and no stray numeric cell exists. (c) Confirm the round-4 changes (eBay Postage Labels, Promoted Offsite, ADJUSTMENT, FULLY_REFUNDED removal) genuinely contribute £0.00 in this period — if any is non-zero, the file is stale and must be regenerated.`,
]

const refutations = await parallel(
  CLAIMS.map((c, i) => () =>
    agent(
      `You are an adversarial auditor for a real HMRC submission that has ALREADY been found wrong once. Default to finding the next problem; if you cannot refute, say so and show your evidence. Do not accept a figure because the code reads tidily. ${c}\n\nWork in ${REPO}. Never run \`git checkout\`/\`switch\`, and never run \`next dev\`. Return via StructuredOutput.`,
      { label: `refute:${i + 1}`, phase: 'Refute', schema: REFUTE_SCHEMA }
    )
  )
)

phase('Synthesis')

const verdict = await agent(
  `Synthesise PASS/FAIL on the CORRECTED Q1 2026/27 SA103F return (cash basis, 6 Apr – 5 Jul 2026) that Chris is about to upload to My Tax Digital. The previous version of this return FAILED validation with four source defects; this is the re-check. Be conservative — this is a real tax filing.

Claimed: ${JSON.stringify(RETURN.boxes)} → expenses ${RETURN.expenses}, profit ${RETURN.profit}.

Turnover recomputation:
${JSON.stringify(turnover, null, 2)}

Expenses recomputation:
${JSON.stringify(expenses, null, 2)}

Upload file:
${JSON.stringify(file, null, 2)}

Adversarial refutations:
${JSON.stringify(refutations, null, 2)}

Rules: FAIL if any box differs from independent recomputation by more than £0.01, if the file's cells don't match, if box 31 is populated alongside 17–30, or if any refutation is 'material' or 'critical'. PASS WITH NOTES for 'minor' or for known-and-accepted items. State plainly which boxes are INDEPENDENTLY CONFIRMED versus only self-consistent — do not launder uncertainty into a PASS.

Output: the single word PASS or FAIL, then a short justification, then a box-by-box table with confirmation status, then follow-ups. Plain text.`,
  { label: 'synthesis', phase: 'Synthesis' }
)

return { verdict, turnover, expenses, file, refutations }
