export const meta = {
  name: 'validate-mtd-standard-quarter-round3',
  description:
    'Re-validation of Q1 2026/27 after the four source fixes (PR #637): independent SQL recomputation of every box from the Amazon breakdowns tree, the upload file, and adversarial re-audit of the four defects + the sign trap',
  whenToUse:
    'After merging fix/mtd-amazon-dsf-ebay-refund, to confirm the corrected return is right before uploading to My Tax Digital.',
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
const REPO = 'C:/Users/Chris Hadley/claude-projects/hadley-bricks-inventory-management'
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
  `CLAIM: All four defects found on 2026-07-25 are genuinely fixed in the merged code, not just in the numbers. Read ${WEB}/src/lib/services/profit-loss-report.service.ts on main (git log -1 --oneline should show 135c8bce or later) and verify: (a) queryAmazonSalesCash reads the Sales breakdown and queryAmazonFees reads Expenses less Refunded Expenses — no remaining use of gross_sales_amount/total_fees/referral_fee for cash figures; (b) sumAmazonBreakdown does NOT descend into a matched node (prove it double-counts DSF if it did); (c) cash uses queryEbayGrossSalesCash which does NOT exclude FULLY_REFUNDED orders, while accrual still DOES; (d) fee credits are matched by feeType in all three fee paths and no feeType is netted twice. Try hard to refute each.`,
  `CLAIM: The corrected figures are right and the remaining sign handling is safe. ${DATA} (a) Re-derive box 15 and total expenses completely independently and compare to ${RETURN.boxes[15]} / ${RETURN.expenses}. (b) The expense boxes negate row totals rather than Math.abs, because a fee row can now be a NET CREDIT for a period — check whether ANY month in the period has a fee row whose reversals exceed its charges (which would previously have been floored to zero or sign-flipped), and quantify the £ at risk. (c) Check no expense row is double counted between the Monzo category buckets and the platform fee rows (e.g. a marketplace fee also appearing as a Monzo 'Selling Fees' row).`,
  `CLAIM: Turnover and expenses are now COMPLETE — there is no money in any table that reaches no row. This is the third attempt at this return; the previous two both failed on completeness, not arithmetic. ${DATA} Sweep for anything unread: (a) PayPal — every distinct transaction_event_code with a positive gross in the period, and state for each whether it lands in an income row (T0006 -> BL/BO, T0011/T0000 -> Other PayPal Sales, T1107 positive -> deliberately excluded as a supplier refund already relieved in box 17); (b) Amazon — every distinct transaction_type AND, for Adjustment, every distinct description, stating where each lands and confirming 'Reserve' (Sales +6,263.55 / Expenses -6,263.55) reaches NEITHER side and Transfer/ServiceFee/AdhocDisbursement are excluded for the right reason; (c) eBay — every distinct transaction_type and, for NON_SALE_CHARGE and REFUND rows, every distinct feeType, confirming each fee and each credit lands in exactly one box and none is netted twice; (d) any OTHER table holding period money the report never reads at all (platform_orders non-shopify/amazon platforms, bricqer, shopify_*, monzo categories not mapped to a box). Quantify anything you find.`,
  `CLAIM: The guards cannot hide money. The report catches a per-row query error, reports the row as £0, and the zero-row filter then deletes it — so a guard that THROWS makes money disappear from the report, and only the failedRows field prevents a return being built from it. Try to refute that the tax path is safe: (a) confirm mtd-sa103-boxes.ts refuses to build when failedRows is non-empty AND that boxesFromReport is not reachable by any path that skips that check; (b) check the blast radius — one unclassified PayPal code fails THREE income rows that share fetchPayPalCustomerReceipts (~£8.4k in Q1); confirm that produces a hard failure rather than a quiet £0 return; (c) verify the new source-to-report check (assertSourcesRepresented) actually fires — prove it by reasoning about what happens if the Shopify row were removed; (d) confirm no expense box can be negative and that the non-negativity guard cannot itself mask a legitimate credit.`,
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
