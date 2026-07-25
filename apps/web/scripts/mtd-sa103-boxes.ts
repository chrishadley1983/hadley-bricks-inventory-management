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
import { createClient } from '@supabase/supabase-js';
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
  'Packing Materials': '23',
  'Phone & Broadband': '23',
  'Website / Software': '23',
  'eBay Ad Fees - Standard': '24.1',
  'eBay Ad Fees - Advanced': '24.1',
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
    // Expense rows arrive negative; SA103F boxes are positive amounts.
    const value = Math.abs(row.total);
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
  return { boxes, detail, turnover: boxes['15'] ?? 0, expenses, profit: r2((boxes['15'] ?? 0) - expenses) };
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
