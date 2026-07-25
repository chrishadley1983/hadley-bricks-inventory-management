/**
 * SA103F box totals for an MTD period, cash or accrual basis.
 *
 * Emits the box→value map the bridging-spreadsheet generator consumes
 * (scripts/make-mtd-sa103.py), so the quarterly routine is:
 *
 *   npx tsx scripts/mtd-sa103-boxes.ts --start=2026-04-06 --end=2026-07-06 --json --out=boxes.json
 *   python scripts/make-mtd-sa103.py boxes.json <out.xlsx>
 *
 * Dates are INCLUSIVE start / EXCLUSIVE end — an HMRC standard quarter ending
 * 5 Jul is --end=2026-07-06. Whole calendar months work too (--start=2026-04-01
 * --end=2026-07-01) for a calendar-quarter election.
 *
 * Box mapping agreed 2026-07-03 (docs/features/quickfile-cash-basis/design.md):
 *   15   turnover                       all Income rows, net of refunds
 *   17   cost of goods for resale       Lego Stock Purchases + Lego Parts
 *   20   car, van and travel            Mileage
 *   21   rent, rates, power, insurance  Office (unit rent) + Use of Home + Insurance
 *   23   phone, stationery, office      Postage + Packing + Phone & Broadband + Website/Software
 *   24.1 advertising                    eBay Ad Fees
 *   26   bank/financial charges         PayPal Fees
 *   30   other business expenses        marketplace commissions + Amazon sub + banking fees/subs
 * Boxes 17–30 are used INSTEAD OF the consolidated box 31.
 */
import { writeFileSync } from 'node:fs';
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  ProfitLossReportService,
  type ProfitLossReport,
  type ReportBasis,
} from '../src/lib/services/profit-loss-report.service';

const USER_ID = process.env.MTD_USER_ID ?? '4b6e94b4-661c-4462-9d14-b21df7d51e5b';

/** Expense row → SA103F box. Every non-Income row must appear here. */
const BOX_BY_ROW: Record<string, string> = {
  'Lego Stock Purchases': '17',
  'Lego Parts': '17',
  Mileage: '20',
  Office: '21',
  'Use of Home': '21',
  Insurance: '21',
  Postage: '23',
  'eBay Postage Labels': '23',
  'Packing Materials': '23',
  'Phone & Broadband': '23',
  'Website / Software': '23',
  'eBay Ad Fees - Standard': '24.1',
  'eBay Ad Fees - Advanced': '24.1',
  'eBay Promoted Offsite': '24.1',
  'PayPal Fees': '26',
  'Amazon Fees': '30',
  'eBay Fixed Fees': '30',
  'eBay Insertion Fees': '30', // listing fees are eBay non-ad selling fees, not advertising
  'eBay Variable Fees': '30',
  'eBay Regulatory Fees': '30',
  'eBay International Fees': '30',
  'eBay Shop Fee': '30',
  'BrickLink / Brick Owl / Bricqer Fees': '30',
  'Amazon Subscription': '30',
  'Banking Fees / Subscriptions': '30',
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const m = (n: number) => n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function boxesFromReport(report: ProfitLossReport) {
  // A row whose query threw is reported as £0 and then dropped by the zero-row
  // filter, so the unmapped-row guard below can never see it. Refuse to build a
  // return from a report that had ANY failure.
  if (report.failedRows?.length) {
    throw new Error(
      `Refusing to build a tax return: ${report.failedRows.length} P&L row(s) failed to query and ` +
        `would be filed as £0 — ` +
        report.failedRows.map((f) => `${f.transactionType} (${f.error})`).join('; ')
    );
  }

  const boxes: Record<string, number> = {};
  const detail: Record<string, { row: string; value: number }[]> = {};
  const unmapped: string[] = [];

  for (const row of report.rows) {
    if (row.category === 'Income') {
      boxes['15'] = r2((boxes['15'] ?? 0) + row.total);
      (detail['15'] ??= []).push({ row: row.transactionType, value: r2(row.total) });
      continue;
    }
    const box = BOX_BY_ROW[row.transactionType];
    if (!box) {
      if (Math.abs(row.total) >= 0.005) unmapped.push(row.transactionType);
      continue;
    }
    // Expense rows arrive NEGATIVE (signMultiplier -1), and SA103F boxes are
    // positive, so negate — do NOT use Math.abs. A fee row can legitimately be a
    // net CREDIT for a period (reversals exceeding charges), which arrives
    // POSITIVE; Math.abs would file that credit as an equal-sized CHARGE,
    // overstating expenses and understating tax. Reachable since the
    // Math.max(0, …) monthly floor was removed from the eBay fee queries.
    const value = -row.total;
    boxes[box] = r2((boxes[box] ?? 0) + value);
    (detail[box] ??= []).push({ row: row.transactionType, value: r2(value) });
  }

  if (unmapped.length > 0) {
    throw new Error(
      `Unmapped expense rows — add them to BOX_BY_ROW before filing: ${unmapped.join(', ')}`
    );
  }

  const expenses = r2(
    Object.entries(boxes)
      .filter(([b]) => b !== '15')
      .reduce((s, [, v]) => s + v, 0)
  );
  const turnover = boxes['15'] ?? 0;

  // Every pound in the report must land in exactly one box: independently
  // re-add the report's own rows and require the boxes to reconcile. This is
  // what catches a row silently dropped between report and return.
  const reportIncome = r2(
    report.rows.filter((r) => r.category === 'Income').reduce((s, r) => s + r.total, 0)
  );
  // Negate, not Math.abs — the check must not repeat the sign error it guards.
  const reportExpenses = r2(
    report.rows.filter((r) => r.category !== 'Income').reduce((s, r) => s - r.total, 0)
  );
  if (Math.abs(reportIncome - turnover) > 0.01) {
    throw new Error(
      `Box 15 (${turnover}) does not reconcile with the report's Income rows (${reportIncome})`
    );
  }
  if (Math.abs(reportExpenses - expenses) > 0.01) {
    throw new Error(
      `Expense boxes (${expenses}) do not reconcile with the report's expense rows (${reportExpenses})`
    );
  }

  // SA103F has no concept of a negative expense box. A net-credit period would
  // otherwise be filed as a negative figure and rejected (or worse, accepted).
  for (const [box, value] of Object.entries(boxes)) {
    if (box !== '15' && value < 0) {
      throw new Error(
        `Box ${box} is negative (${value}) — a period whose fee reversals exceed its charges ` +
          `cannot be filed as-is. Decide how to present the credit before submitting.`
      );
    }
  }

  return { boxes, detail, turnover, expenses, profit: r2(turnover - expenses) };
}

/**
 * SOURCE → report completeness check.
 *
 * The reconciliation above compares the boxes to the report's own rows, which
 * cannot catch a row that is never queried — and that is exactly how the Amazon
 * `Adjustment` costs and the non-T0006 PayPal receipts survived two validation
 * rounds. This goes back to the raw tables and asserts every money-bearing
 * source is represented by at least one non-zero row, so a whole stream going
 * missing fails the run instead of quietly shrinking the return.
 */
export async function assertSourcesRepresented(
  supabase: SupabaseClient,
  userId: string,
  startDate: string,
  endDateExclusive: string,
  report: ProfitLossReport,
  basis: ReportBasis
): Promise<string[]> {
  const notes: string[] = [];
  const rowTotal = (name: string) =>
    Math.abs(report.rows.find((r) => r.transactionType === name)?.total ?? 0);

  const checks: {
    label: string
    present: () => Promise<boolean>
    rows: string[]
    /** Rows that only exist on one basis — skip the check on the other. */
    onlyBasis?: ReportBasis
  }[] = [
    {
      label: 'Amazon Adjustment costs (return postage billed back)',
      rows: ['Amazon Fees'],
      present: async () => {
        const { data } = await supabase
          .from('amazon_transactions')
          .select('id')
          .eq('user_id', userId)
          .eq('transaction_type', 'Adjustment')
          .eq('transaction_status', 'RELEASED')
          .gte('posted_date', startDate)
          .lt('posted_date', endDateExclusive)
          .limit(1);
        return (data?.length ?? 0) > 0;
      },
    },
    {
      label: 'PayPal receipts outside the marketplace checkout code (T0011/T0000)',
      rows: ['Other PayPal Sales (cash received)'],
      // Accrual takes BL/BO income from the order tables, not PayPal receipts,
      // so this row legitimately does not exist there.
      onlyBasis: 'cash',
      present: async () => {
        const { data } = await supabase
          .from('paypal_transactions')
          .select('id')
          .eq('user_id', userId)
          .in('transaction_event_code', ['T0011', 'T0000'])
          .gt('gross_amount', 0)
          .gte('transaction_date', startDate)
          .lt('transaction_date', endDateExclusive)
          .limit(1);
        return (data?.length ?? 0) > 0;
      },
    },
    {
      label: 'Shopify orders',
      rows: ['Shopify Sales'],
      present: async () => {
        const { data } = await supabase
          .from('platform_orders')
          .select('id')
          .eq('user_id', userId)
          .eq('platform', 'shopify')
          .gte('order_date', startDate)
          .lt('order_date', endDateExclusive)
          .limit(1);
        return (data?.length ?? 0) > 0;
      },
    },
  ];

  for (const check of checks) {
    if (check.onlyBasis && check.onlyBasis !== basis) {
      notes.push(`${check.label}: not applicable on ${basis} basis`);
      continue;
    }
    const sourceHasRows = await check.present();
    const represented = check.rows.some((r) => rowTotal(r) > 0.005);
    if (sourceHasRows && !represented) {
      throw new Error(
        `${check.label}: the source has rows in this period but ${check.rows.join('/')} is £0 — ` +
          `a whole income/expense stream is missing from the return.`
      );
    }
    notes.push(
      `${check.label}: source ${sourceHasRows ? 'has rows' : 'empty'}, report ${
        represented ? 'represents it' : 'shows £0'
      }`
    );
  }

  return notes;
}

async function main() {
  const arg = (name: string) =>
    process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  const startDate = arg('start');
  const endDateExclusive = arg('end');
  const basis = (arg('basis') ?? 'cash') as ReportBasis;
  const asJson = process.argv.includes('--json');

  if (!startDate || !endDateExclusive) {
    console.error(
      'usage: mtd-sa103-boxes.ts --start=YYYY-MM-DD --end=YYYY-MM-DD(exclusive) [--basis=cash|accrual] [--json]'
    );
    process.exit(1);
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ) as never;

  const report = await new ProfitLossReportService(supabase).generateReport(USER_ID, {
    startDate,
    endDateExclusive,
    basis,
  });
  const result = boxesFromReport(report);

  // Completeness: prove every money-bearing source reached a row, not just that
  // the boxes add up to the rows we happened to query.
  const sourceNotes = await assertSourcesRepresented(
    supabase as unknown as SupabaseClient,
    USER_ID,
    startDate,
    endDateExclusive,
    report,
    basis
  );

  if (asJson) {
    const json = JSON.stringify(
      { period: { startDate, endDateExclusive }, basis, ...result },
      null,
      2
    );
    // The P&L service and dotenv both log to stdout, so `> file` would capture
    // their noise as well — always write the JSON to a real path.
    const out = arg('out');
    if (!out) {
      console.error('--json requires --out=<path> (stdout carries service logs)');
      process.exit(1);
    }
    writeFileSync(out, json, 'utf8');
    console.log(`\nWrote ${out}`);
    return;
  }

  console.log(`\nSA103F boxes — ${basis} basis, ${startDate} to <${endDateExclusive}`);
  console.log('='.repeat(72));
  for (const box of ['15', '17', '20', '21', '23', '24.1', '26', '30']) {
    if (result.boxes[box] == null) continue;
    console.log(`\nBox ${box.padEnd(5)} ${m(result.boxes[box]).padStart(11)}`);
    for (const d of result.detail[box] ?? [])
      console.log(`             ${d.row.padEnd(40)} ${m(d.value).padStart(10)}`);
  }
  console.log('\n' + '='.repeat(72));
  console.log(`Box 15 turnover      ${m(result.turnover).padStart(11)}`);
  console.log(`Boxes 17-30 expenses ${m(result.expenses).padStart(11)}`);
  console.log(`Net profit           ${m(result.profit).padStart(11)}`);
}

if (process.argv[1]?.includes('mtd-sa103-boxes')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
