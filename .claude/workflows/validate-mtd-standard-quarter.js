export const meta = {
  name: 'validate-mtd-standard-quarter',
  description:
    'E2E validation of the Q1 2026/27 SA103F return on HMRC standard periods (6 Apr - 5 Jul): independent SQL recomputation of every box, byte-level check of the upload file, boundary/completeness refutation, deploy health, PASS/FAIL',
  whenToUse:
    'Before uploading a bridging spreadsheet to My Tax Digital, to independently confirm every box on the return is right and that the tax-period boundaries neither double-count nor drop anything.',
  phases: [
    { title: 'Recompute', detail: 'independent SQL re-derivation of turnover + every expense box' },
    { title: 'File', detail: 'read the actual .xlsx that will be uploaded and compare' },
    { title: 'Deploy', detail: 'merged main is live and produces the same figures' },
    { title: 'Refute', detail: 'adversarial audit of boundaries, completeness, gaps, timezone' },
    { title: 'Synthesis', detail: 'PASS/FAIL verdict' },
  ],
}

// What the generated return claims. Everything below is checked against this.
const RETURN = {
  period: { start: '2026-04-06', endExclusive: '2026-07-06' },
  basis: 'cash',
  boxes: {
    15: 16256.24,
    17: 5519.37,
    20: 25.2,
    21: 445.44,
    23: 2470.06,
    '24.1': 114.34,
    26: 386.28,
    30: 1984.31,
  },
  expenses: 10945.0,
  profit: 5311.24,
  incomeComponents: {
    ebayGross: 2700.26,
    ebayRefunds: -50.38,
    bricklink: 7206.54,
    brickowl: 1230.92,
    blboRefunds: -296.88,
    amazonReleased: 5566.92,
    amazonRefunds: -101.14,
  },
  // Expense P&L row -> box, as implemented in apps/web/scripts/mtd-sa103-boxes.ts
  rowToBox: {
    'Lego Stock Purchases': 17,
    'Lego Parts': 17,
    Mileage: 20,
    Office: 21,
    'Use of Home': 21,
    Insurance: 21,
    Postage: 23,
    'Packing Materials': 23,
    'Phone & Broadband': 23,
    'Website / Software': 23,
    'eBay Ad Fees - Standard': '24.1',
    'eBay Ad Fees - Advanced': '24.1',
    'PayPal Fees': 26,
    'Amazon Fees': 30,
    'eBay Fixed Fees': 30,
    'eBay Insertion Fees': 30,
    'eBay Variable Fees': 30,
    'eBay Regulatory Fees': 30,
    'eBay International Fees': 30,
    'eBay Shop Fee': 30,
    'BrickLink / Brick Owl / Bricqer Fees': 30,
    'Amazon Subscription': 30,
    'Banking Fees / Subscriptions': 30,
  },
}

const USER_ID = '4b6e94b4-661c-4462-9d14-b21df7d51e5b'
const PROJECT = 'modjoikyuhqzouxvieua'
// The primary checkout is shared with other concurrent sessions. Work ONLY in
// this worktree, and never switch its branch.
const WT = 'C:/Users/Chris Hadley/claude-projects/hb-dashboard-wt'
const WEB = `${WT}/apps/web`
const XLSX = `${WT}/docs/features/quickfile-cash-basis/MTD_SA103_2026-27_Q1_6Apr-5Jul.xlsx`

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
          deltaPence: { type: 'number' },
          match: { type: 'boolean' },
          sql: { type: 'string' },
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
          expected: { type: 'number' },
          match: { type: 'boolean' },
        },
        required: ['cell', 'box', 'value', 'match'],
      },
    },
    box31Empty: { type: 'boolean' },
    poundLabelsIntact: { type: 'boolean' },
    opensCleanly: { type: 'boolean' },
    strayValues: { type: 'array', items: { type: 'string' } },
    allMatch: { type: 'boolean' },
    notes: { type: 'string' },
  },
  required: ['cells', 'box31Empty', 'opensCleanly', 'allMatch'],
}

const DEPLOY_SCHEMA = {
  type: 'object',
  properties: {
    mergedToMain: { type: 'boolean' },
    mainCommit: { type: 'string' },
    vercelState: { type: 'string' },
    prodHealthy: { type: 'boolean' },
    figuresReproducedFromMain: { type: 'boolean' },
    reproducedTurnover: { type: 'number' },
    reproducedExpenses: { type: 'number' },
    monthPathUnchanged: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'string' } },
  },
  required: ['mergedToMain', 'prodHealthy', 'figuresReproducedFromMain', 'issues'],
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

const SQL_PREAMBLE = `Use the Supabase MCP execute_sql tool against project ${PROJECT} (load it first with ToolSearch "select:mcp__plugin_supabase_supabase__execute_sql"). user_id = '${USER_ID}'. The period is [${RETURN.period.start}, ${RETURN.period.endExclusive}) — start INCLUSIVE, end EXCLUSIVE. Do NOT read the application's service code; derive everything from the raw tables so your recomputation is independent. Round to 2dp and report the SQL you ran.`

phase('Recompute')

const turnoverPrompt = `You are independently verifying the TURNOVER (SA103F box 15) on a real HMRC quarterly submission. ${SQL_PREAMBLE}

Cash-basis income definitions (agent-receipt principle):
- AMAZON received = SUM(gross_sales_amount) from amazon_transactions where transaction_type='Shipment' AND transaction_status='RELEASED' AND posted_date in period. Claimed: ${RETURN.incomeComponents.amazonReleased}
- AMAZON refunds = SUM(|total_amount|) from amazon_transactions where transaction_type IN ('Refund','GuaranteeClaimRefund') AND transaction_status='RELEASED' AND posted_date in period. Claimed: ${Math.abs(RETURN.incomeComponents.amazonRefunds)}
- BRICKLINK = SUM(gross_amount) from paypal_transactions where transaction_event_code='T0006' AND gross_amount>0 AND transaction_date in period AND (transaction_type IS NULL OR transaction_type NOT ILIKE 'brick owl order%'). Claimed: ${RETURN.incomeComponents.bricklink}
- BRICK OWL = same but transaction_type ILIKE 'brick owl order%'. Claimed: ${RETURN.incomeComponents.brickowl}
- BL/BO refunds issued = SUM(|gross_amount|) from paypal_transactions where transaction_event_code='T1107' AND gross_amount<0 AND transaction_date in period. Claimed: ${Math.abs(RETURN.incomeComponents.blboRefunds)}
- EBAY gross = SUM(gross_transaction_amount) from ebay_transactions where transaction_type='SALE' AND transaction_date in period AND ebay_order_id NOT IN (SELECT ebay_order_id FROM ebay_orders WHERE user_id='${USER_ID}' AND order_payment_status='FULLY_REFUNDED'). Claimed: ${RETURN.incomeComponents.ebayGross}
- EBAY refunds = SUM(|amount|) from ebay_transactions where transaction_type='REFUND' AND transaction_date in period. Claimed: ${Math.abs(RETURN.incomeComponents.ebayRefunds)}

Then box 15 = Amazon − AmazonRefunds + BrickLink + BrickOwl − BLBORefunds + eBay − eBayRefunds. Claimed box 15 = ${RETURN.boxes[15]}.

Report one line per component plus one for box 15. match = within £0.01. Return via StructuredOutput.`

const expensesPrompt = `You are independently verifying the EXPENSE boxes on a real HMRC quarterly submission. ${SQL_PREAMBLE}

Expenses are recognised on payment date and are identical on cash and accrual basis. Work out each P&L expense row for the period from the raw tables, then aggregate into SA103F boxes using this map: ${JSON.stringify(RETURN.rowToBox)}.

Sources (discover the exact column/category names yourself — list the tables and their category values first, do not assume): Monzo-derived spend rows live in monzo_transactions bucketed by category (Lego Stock Purchases, Lego Parts, Postage, Packing Materials, Website / Software, Office, Amazon Subscription, Banking Fees / Subscriptions); mileage in mileage_tracking; Use of Home / Phone & Broadband / Insurance in home_costs; selling fees come from amazon_transactions fee fields, ebay_transactions fee rows, bricklink/brickowl/bricqer fee data and paypal_transactions fees. Refunds against stock purchases net off COGS.

Claimed boxes: 17=${RETURN.boxes[17]}, 20=${RETURN.boxes[20]}, 21=${RETURN.boxes[21]}, 23=${RETURN.boxes[23]}, 24.1=${RETURN.boxes['24.1']}, 26=${RETURN.boxes[26]}, 30=${RETURN.boxes[30]}, total expenses=${RETURN.expenses}.

Report one line per box plus a total line. Where a source is genuinely ambiguous, say so in notes rather than guessing a match. match = within £0.01. Return via StructuredOutput.`

const filePrompt = `Verify the ACTUAL FILE that will be uploaded to My Tax Digital: ${XLSX}

Read it with python (openpyxl is installed, or unzip and parse xl/worksheets/sheet1.xml). Check:
1. Each value cell equals the claimed box: C7=${RETURN.boxes[15]} (box 15), C19=${RETURN.boxes[17]} (17), C31=${RETURN.boxes[20]} (20), C35=${RETURN.boxes[21]} (21), C43=${RETURN.boxes[23]} (23), C47=${RETURN.boxes['24.1']} (24.1), C59=${RETURN.boxes[26]} (26), C75=${RETURN.boxes[30]} (30).
2. C77 (box 31, consolidated expenses) is EMPTY — filling both 31 and 17-30 is invalid.
3. The narrow column-B '£' label cells are still present (a previous attempt wrote values INTO column B and parsed as nothing).
4. The workbook opens cleanly and its zip entry list matches docs/features/quickfile-cash-basis/MTD_SA103_template.xlsx.
5. STRAY VALUES: list every other numeric cell in the sheet that holds a value, and judge whether any is a leftover from the template or a previous period that would be submitted by accident.

Return via StructuredOutput. allMatch=false if anything above fails.`

const [turnover, expenses, file] = await parallel([
  () => agent(turnoverPrompt, { label: 'recompute:turnover', phase: 'Recompute', schema: BOX_SCHEMA }),
  () => agent(expensesPrompt, { label: 'recompute:expenses', phase: 'Recompute', schema: BOX_SCHEMA }),
  () => agent(filePrompt, { label: 'file:xlsx', phase: 'File', schema: FILE_SCHEMA }),
])

phase('Deploy')

const deploy = await agent(
  `Confirm the MTD tax-period change is merged and live, and that the merged code reproduces the same figures.

1. In ${WT} run: git fetch origin main, then confirm PR #635 is merged and origin/main contains commits 404024b1 and 3e1dc76b (git branch -r --contains, or git log origin/main --oneline | head).
2. Vercel deploy health for that main commit: use \`gh run list\` / the Vercel deployment status via \`gh pr checks 635\`, and confirm https://hadley-bricks-inventory-management.vercel.app (or the production domain in vercel.json / the project settings) responds 200 on a cheap public route. Do NOT log in or mutate anything.
3. Re-derive the figures from the MERGED code: in ${WEB} run
   npx tsx scripts/mtd-sa103-boxes.ts --start=${RETURN.period.start} --end=${RETURN.period.endExclusive} --basis=cash
   and confirm box 15 = ${RETURN.boxes[15]} and total expenses = ${RETURN.expenses}.
4. Confirm the month-bounds path is UNCHANGED for existing consumers: run the same script with --start=2026-04-01 --end=2026-07-01 and confirm turnover is 15948.23 (the calendar-quarter figure the UI P&L and QuickFile push produced before this change), and run \`npx vitest run src/lib/services/__tests__/profit-loss-report.service.test.ts src/lib/services/__tests__/mtd-export.service.test.ts\` — all must pass.

NEVER run \`git checkout\`/\`switch\` in any checkout, and never run \`next dev\` (the .next bundle is shared with a live local service). Return via StructuredOutput.`,
  { label: 'deploy:health', phase: 'Deploy', schema: DEPLOY_SCHEMA }
)

phase('Refute')

const CLAIMS = [
  `CLAIM: The period boundaries are exact — nothing dated 1-5 Apr 2026 is included, everything dated 1-5 Jul 2026 IS included, and nothing on the boundary days themselves is dropped or double-counted. ${SQL_PREAMBLE} Refute by: (a) summing every income source for 2026-04-01..2026-04-06 and confirming those amounts are ABSENT from the box-15 claim of ${RETURN.boxes[15]} (the previously-computed sliver was £728.85 income / £408.14 expenses — verify independently); (b) summing 2026-07-01..2026-07-06 and confirming those amounts ARE included; (c) checking for rows dated exactly 2026-04-06 and 2026-07-05 and confirming each lands on the correct side.`,
  `CLAIM: Comparing date-only bounds against timestamptz columns cannot misplace a transaction across the 6th/5th boundary. This matters because HMRC cares about UK calendar dates while the bounds are evaluated in UTC — a sale at 00:30 BST on 6 Jul is 23:30 UTC on 5 Jul. ${SQL_PREAMBLE} Refute by: (a) finding any row in amazon_transactions/ebay_transactions/paypal_transactions/monzo_transactions within 1 hour either side of the two boundary instants (2026-04-06 00:00 and 2026-07-06 00:00 UTC) and stating which side UTC puts it on versus Europe/London; (b) quantifying the total £ that would move if the bounds were evaluated in Europe/London instead of UTC. Report the amount at risk even if it is zero.`,
  `CLAIM: Every expense the P&L knows about lands in exactly ONE SA103F box — none double-counted, none dropped. Refute by reading ${WEB}/scripts/mtd-sa103-boxes.ts and ${WEB}/src/lib/services/profit-loss-report.service.ts in the ${WT} worktree: (a) enumerate every transactionType in getRowDefinitions() and check each non-Income row appears exactly once in BOX_BY_ROW; (b) confirm Income rows cannot also be picked up as expenses and vice versa; (c) confirm the sum of the box values equals the claimed total expenses ${RETURN.expenses}; (d) check the rounding approach cannot make the boxes disagree with the total by more than a penny; (e) check whether any expense row is itself a NET figure that already includes refunds, such that netting happens twice.`,
  `CLAIM: Switching 2026/27 to HMRC standard periods leaves no unreported gap or double-counted overlap against the 2025/26 return. Context: FY2025/26 was prepared on 31-March equivalence (1 Apr 2025 - 31 Mar 2026, turnover £74,986.05), while Q1 2026/27 now starts 6 Apr 2026 — so 1-5 Apr 2026 falls in NEITHER. ${SQL_PREAMBLE} Refute or confirm by: (a) quantifying exactly what sits in 2026-04-01..2026-04-06 (income and expenses) and therefore what is currently unreported; (b) confirming the proposed fix — refiling FY2025/26 on 6 Apr 2025 - 5 Apr 2026 as turnover £73,303.14 / expenses £52,271.23 / profit £21,031.91 — closes the gap exactly with no overlap against Q1 2026/27; (c) checking the 6 Apr 2025 boundary at the other end for the same class of problem. Severity should reflect that the FY25/26 return is not due until Jan 2027 and has NOT been filed.`,
]

const refutations = await parallel(
  CLAIMS.map((c, i) => () =>
    agent(
      `You are an adversarial auditor for figures backing a real HMRC tax submission. Default to finding the problem: if you cannot refute the claim, say so and show the evidence you gathered. Do not accept a claim because the code looks tidy. ${c}\n\nWork in ${WT} (NEVER change branches in any checkout; never run \`next dev\`). Return via StructuredOutput.`,
      { label: `refute:${i + 1}`, phase: 'Refute', schema: REFUTE_SCHEMA }
    )
  )
)

phase('Synthesis')

const verdict = await agent(
  `Synthesise a PASS/FAIL verdict on the Q1 2026/27 SA103F return (cash basis, HMRC standard period 6 Apr - 5 Jul 2026) that Chris is about to upload to My Tax Digital. This backs a real tax filing, so be conservative.

Claimed return: ${JSON.stringify(RETURN.boxes)} → expenses ${RETURN.expenses}, profit ${RETURN.profit}.

Independent SQL recomputation — turnover:
${JSON.stringify(turnover, null, 2)}

Independent SQL recomputation — expenses:
${JSON.stringify(expenses, null, 2)}

The actual upload file:
${JSON.stringify(file, null, 2)}

Deploy + merged-code reproduction:
${JSON.stringify(deploy, null, 2)}

Adversarial refutations:
${JSON.stringify(refutations, null, 2)}

Rules:
- FAIL if any box differs from independent recomputation by more than £0.01, if the upload file's cells don't match, if box 31 is populated alongside 17-30, if the merged code does not reproduce the figures, if the month-bounds path regressed, or if any refutation is 'material' or 'critical'.
- PASS WITH NOTES for 'minor' issues or for known-but-accepted items (e.g. the FY2025/26 refiling that is not yet due).
- Where a recomputation agent reported an ambiguous source rather than a match, say plainly which boxes are independently confirmed and which are only self-consistent — do not launder uncertainty into a PASS.

Output: start with the single word PASS or FAIL, then a short justification, then a table of box-by-box confirmation status, then any follow-ups. Plain text.`,
  { label: 'synthesis', phase: 'Synthesis' }
)

return { verdict, turnover, expenses, file, deploy, refutations }
