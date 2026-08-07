/**
 * Profit & Loss Report Service
 *
 * Generates a configurable monthly P&L report aggregating financial data
 * across all platforms (eBay, BrickLink, Amazon) and expense categories.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { fetchAllRecords } from '@/lib/supabase/pagination';

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Report row categories
 */
export type ProfitLossCategory =
  | 'Income'
  | 'Selling Fees'
  | 'Stock Purchase'
  | 'Packing & Postage'
  | 'Bills'
  | 'Home Costs';

/**
 * Individual row in the P&L report
 */
export interface ProfitLossReportRow {
  category: ProfitLossCategory;
  transactionType: string;
  monthlyValues: Record<string, number>; // { '2024-01': 1234.56, ... }
  total: number;
}

/**
 * Complete P&L report structure
 */
export interface ProfitLossReport {
  generatedAt: string;
  dateRange: {
    startMonth: string; // 'YYYY-MM'
    endMonth: string; // 'YYYY-MM'
  };
  months: string[]; // Ordered list of months for column headers
  rows: ProfitLossReportRow[];
  categoryTotals: Record<ProfitLossCategory, Record<string, number>>;
  grandTotal: Record<string, number>;
  /**
   * Rows whose query threw. A failed row is reported as £0 so the dashboard
   * still renders, which means a transient Supabase error is indistinguishable
   * from a genuinely quiet month: the row totals zero, the zero-row filter drops
   * it, and it disappears from `rows` entirely. One failure on Lego Stock
   * Purchases would have removed £4,848 from SA103F box 17 with nothing but a
   * console.error to show for it.
   *
   * ANY consumer that must not under-report — every tax export — has to check
   * this is empty before trusting the numbers.
   */
  failedRows: { transactionType: string; error: string }[];
}

/**
 * Options for generating the report
 */
export interface ProfitLossReportOptions {
  startMonth?: string; // 'YYYY-MM', defaults to earliest data
  endMonth?: string; // 'YYYY-MM', defaults to current month
  includeZeroRows?: boolean; // Include rows with all zero values
  basis?: ReportBasis; // 'accrual' (default) or 'cash' — see getRowDefinitions
  /**
   * Exact date bounds — start INCLUSIVE, end EXCLUSIVE, both 'YYYY-MM-DD'.
   * When supplied these override the whole-month bounds derived from
   * startMonth/endMonth, so a report can cover an HMRC *standard* tax period
   * (e.g. Q1 = 6 Apr – 5 Jul → startDate '2026-04-06',
   * endDateExclusive '2026-07-06') rather than calendar months.
   *
   * The monthly columns still bucket by month, so the first and last months
   * legitimately hold PART-month figures — read `total`, not the month cells,
   * when the bounds are partial.
   */
  startDate?: string;
  endDateExclusive?: string;
}

/**
 * Reporting basis.
 *
 * 'accrual' — income recognised at sale/order date (the default P&L view).
 * 'cash'    — income recognised when the money is received, under the
 *             agent-receipt principle (a marketplace collecting from the buyer
 *             on our behalf counts as receipt by us):
 *               • Amazon: financial event released to seller balance
 *               • BrickLink / Brick Owl: buyer payment lands in PayPal
 *               • eBay: buyer pays eBay at sale (identical dates to accrual)
 *             Expense rows are identical in both bases — they are already
 *             recognised on payment dates (Monzo/fee-event dates).
 */
export type ReportBasis = 'accrual' | 'cash';

/**
 * Internal type for monthly aggregation query results
 */
interface MonthlyAggregation {
  month: string;
  total: number;
}

/**
 * Row definition for building queries
 */
interface RowDefinition {
  category: ProfitLossCategory;
  transactionType: string;
  queryFn: (
    supabase: SupabaseClient<Database>,
    userId: string,
    startDate: string,
    endDate: string
  ) => Promise<MonthlyAggregation[]>;
  signMultiplier: number; // 1 for positive, -1 for negative
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Format date to YYYY-MM string
 */
function formatMonth(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Get first day of month from YYYY-MM string
 */
function getMonthStartDate(month: string): string {
  return `${month}-01`;
}

/**
 * Last in-range month (YYYY-MM) given the EXCLUSIVE end-date bound used by all
 * range queries. endDateExclusive is the 1st of the month AFTER the range, so
 * naive substring(0,7) on it names a month outside the range.
 */
function getLastMonthFromExclusiveEnd(endDateExclusive: string): string {
  const [year, monthNum] = endDateExclusive.split('-').map(Number);
  const prevYear = monthNum === 1 ? year - 1 : year;
  const prevMonth = monthNum === 1 ? 12 : monthNum - 1;
  return `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
}

/**
 * Get the EXCLUSIVE upper bound for a month range: the first day of the month
 * after `month`. All range queries use `column < bound` — an inclusive bound
 * of 'YYYY-MM-<lastday>' reads as midnight on timestamp columns and silently
 * drops everything later that day (the bug this replaced).
 */
function getMonthEndExclusive(month: string): string {
  const [year, monthNum] = month.split('-').map(Number);
  const nextYear = monthNum === 12 ? year + 1 : year;
  const nextMonth = monthNum === 12 ? 1 : monthNum + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
}

/**
 * Last in-range month (YYYY-MM) for an arbitrary EXCLUSIVE end date, which may
 * fall mid-month (HMRC standard tax periods end on the 5th). Steps back one day
 * so 2026-07-06 → '2026-07' (1–5 Jul are in range) while 2026-07-01 → '2026-06'.
 */
function getLastMonthFromExclusiveEndDate(endDateExclusive: string): string {
  const dt = new Date(`${endDateExclusive}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() - 1);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * These bounds feed HMRC submissions, so a malformed date must never degrade
 * quietly into an empty or wrong period — reject it at the door.
 */
function assertValidDateBound(label: string, value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be 'YYYY-MM-DD', got '${value}'`);
  }
  const dt = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(dt.getTime()) || dt.toISOString().substring(0, 10) !== value) {
    throw new Error(`${label} is not a real calendar date: '${value}'`);
  }
}

/**
 * Generate array of months between start and end (inclusive)
 */
function generateMonthRange(startMonth: string, endMonth: string): string[] {
  const months: string[] = [];
  const [startYear, startMonthNum] = startMonth.split('-').map(Number);
  const [endYear, endMonthNum] = endMonth.split('-').map(Number);

  let currentYear = startYear;
  let currentMonth = startMonthNum;

  while (currentYear < endYear || (currentYear === endYear && currentMonth <= endMonthNum)) {
    months.push(`${currentYear}-${String(currentMonth).padStart(2, '0')}`);
    currentMonth++;
    if (currentMonth > 12) {
      currentMonth = 1;
      currentYear++;
    }
  }

  return months;
}

/**
 * Convert query results to monthly values map
 */
function toMonthlyValues(
  aggregations: MonthlyAggregation[],
  signMultiplier: number
): Record<string, number> {
  const values: Record<string, number> = {};
  for (const agg of aggregations) {
    values[agg.month] = agg.total * signMultiplier;
  }
  return values;
}

// =============================================================================
// AMAZON FINANCIAL-EVENT BREAKDOWNS
// =============================================================================

/**
 * One node of an Amazon financial-event `breakdowns` tree.
 *
 * A Shipment event has a top-level `Sales` node (gross, positive) and an
 * `Expenses` node (fees, negative); a Refund event has `Refunded Sales`
 * (negative) and `Refunded Expenses` (positive fee credits). Children RESTATE
 * their parent's amount, so a sum must not descend into a matched node.
 */
interface AmazonBreakdownNode {
  breakdownType?: string | null;
  breakdownAmount?: { currencyAmount?: number | null } | null;
  breakdowns?: AmazonBreakdownNode[] | null;
}

/**
 * Sum one breakdownType, WITHOUT descending into a matched node.
 *
 * The flat columns on `amazon_transactions` are NOT equivalent and must not be
 * used for money that reaches a tax return (verified 2026-07-25 over all 1,575
 * RELEASED Shipment rows since 2025-02, 100% of which carry breakdowns):
 *   • `gross_sales_amount` is NET of the DigitalServicesFee — £20.26 light in
 *     Q1 2026/27, £220.08 across all history.
 *   • `total_fees` and `referral_fee` are Commission ONLY — they drop the same
 *     DSF, so it vanished from both sides of the P&L at once.
 *   • `other_fees` is junk (£8,075 against £1,026 of real fees in Q1).
 * The tree self-proves: `Sales` + `Expenses` == `total_amount`, the actual
 * Amazon payout, to the penny across that whole history.
 */
export function sumAmazonBreakdown(
  nodes: AmazonBreakdownNode[] | null | undefined,
  wanted: RegExp
): number {
  let total = 0;
  for (const node of nodes ?? []) {
    if (node.breakdownType && wanted.test(node.breakdownType)) {
      total += Number(node.breakdownAmount?.currencyAmount ?? 0);
    } else {
      total += sumAmazonBreakdown(node.breakdowns, wanted);
    }
  }
  return total;
}

/** Rows whose breakdowns are missing entirely — never silently treat as zero. */
function countMissingBreakdowns(rows: { breakdowns: unknown }[]): number {
  return rows.filter((r) => !Array.isArray(r.breakdowns) || r.breakdowns.length === 0).length;
}

/**
 * Every Amazon `transaction_type` and what the P&L does with it.
 *
 * The fee query used to hard-code `transaction_type='Shipment'`, so
 * `Adjustment` rows (return postage billed back to us — £9.98 in Q1 2026/27,
 * £113.59 all-time) reached no box at all. An explicit registry plus the guard
 * below means a type can no longer be silently unread.
 */
const AMAZON_TYPE_TREATMENT: Record<string, 'sales-and-fees' | 'refund' | 'fees-only' | 'excluded'> =
  {
    // Gross sales + the fees deducted from them.
    Shipment: 'sales-and-fees',
    // Money returned to a buyer, plus the fees Amazon credits back.
    Refund: 'refund',
    GuaranteeClaimRefund: 'refund',
    // No sales value, only a cost charged to the account. NOTE: `Adjustment` is
    // not homogeneous — see AMAZON_ADJUSTMENT_BALANCE_MOVEMENTS.
    Adjustment: 'fees-only',
    // The payout of sales already counted — including it would double-count
    // everything (£47,510.44 all-time).
    Transfer: 'excluded',
    // Also a payout, not a cost: its one row is described 'InitiateDisbursement'
    // (−£0.01, Feb 2025). Same class of error as Reserve, just small — a
    // disbursement moves money we already counted rather than spending it.
    AdhocDisbursement: 'excluded',
    // The Amazon seller subscription, which has its own P&L row
    // (queryAmazonSubscription). Folding it in here would double-count £90/qtr.
    ServiceFee: 'excluded',
    // A £30.00 credit received 2025-08-18. Outside every quarter filed so far;
    // classify it before FY2025/26 is submitted.
    DebtRecovery: 'excluded',
  }

/**
 * Fail loud on an Amazon transaction_type nobody has classified, rather than
 * letting its money sit outside the report.
 */
function assertNoUnclassifiedAmazonTypes(rows: { transaction_type: string | null }[]): void {
  const unknown = new Set<string>();
  for (const row of rows) {
    const type = row.transaction_type ?? '(null)';
    if (!(type in AMAZON_TYPE_TREATMENT)) unknown.add(type);
  }
  if (unknown.size > 0) {
    throw new Error(
      `Unclassified Amazon transaction_type(s): ${[...unknown].join(', ')}. Add each to ` +
        `AMAZON_TYPE_TREATMENT — do not leave Amazon money outside the report.`
    );
  }
}

/** Types whose `Expenses` breakdown is a real business cost. */
const AMAZON_FEE_BEARING_TYPES = Object.entries(AMAZON_TYPE_TREATMENT)
  .filter(([, t]) => t === 'sales-and-fees' || t === 'fees-only')
  .map(([type]) => type)

/**
 * `Adjustment` rows are not one thing, and the difference is worth £6,263.55.
 *
 *   Reserve                8 rows  Sales +6,263.55  Expenses −6,263.55  net £0
 *   LabmanLabelReturn     27 rows  Sales      0.00  Expenses    −89.54
 *   LabmanLabelPurchase    8 rows  Sales      0.00  Expenses    −24.19
 *   LabmanLabelChargeBack  8 rows  Sales     +0.14  Expenses      0.00
 *
 * `Reserve` is Amazon's balance-hold mechanic (ReserveDebit/ReserveCredit) —
 * money withheld then released. It is neither income nor expense: both sides are
 * equal and opposite, and taking only the Expenses side inflated a full year's
 * costs by £4,945.88 (FY2025/26 profit would have come out £4,597 light). Taking
 * BOTH sides would instead inflate box 15 turnover by the same amount. It has to
 * be excluded outright.
 */
const AMAZON_ADJUSTMENT_BALANCE_MOVEMENTS = ['Reserve'] as const;

/** Adjustment descriptions that ARE real business costs/credits. */
const AMAZON_ADJUSTMENT_TRADING = [
  'LabmanLabelReturn',
  'LabmanLabelPurchase',
  'LabmanLabelChargeBack',
] as const;

/** True for rows that only move money between Amazon's own balances. */
function isAmazonBalanceMovement(description: string | null): boolean {
  return (AMAZON_ADJUSTMENT_BALANCE_MOVEMENTS as readonly string[]).includes(description ?? '');
}

/**
 * Fail loud on an Adjustment description nobody has classified — the same
 * structural protection as the type registry, one level deeper, because that is
 * the level at which Reserve hid.
 */
function assertKnownAmazonAdjustments(
  rows: { transaction_type: string | null; description: string | null }[]
): void {
  const unknown = new Set<string>();
  for (const row of rows) {
    if (row.transaction_type !== 'Adjustment') continue;
    const desc = row.description ?? '(null)';
    if (isAmazonBalanceMovement(desc)) continue;
    if ((AMAZON_ADJUSTMENT_TRADING as readonly string[]).includes(desc)) continue;
    unknown.add(desc);
  }
  if (unknown.size > 0) {
    throw new Error(
      `Unclassified Amazon Adjustment description(s): ${[...unknown].join(', ')}. Decide whether ` +
        `each is a real cost or a balance movement (like Reserve) before filing — the two differ ` +
        `by thousands of pounds.`
    );
  }
}

// =============================================================================
// QUERY FUNCTIONS
// =============================================================================

/**
 * Query eBay Gross Sales (from ebay_transactions by transaction_date)
 * Uses SALE transactions and excludes fully refunded orders to match eBay Seller Hub's
 * "Total sales" metric
 */
async function queryEbayGrossSales(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string
): Promise<MonthlyAggregation[]> {
  // NO exclusion of "fully refunded" orders, on EITHER basis. It used to drop
  // their sales to match Seller Hub's "Total sales" headline, and that caused
  // two separate defects:
  //
  //  1. Double deduction — the eBay Refunds row already deducts the refund, so
  //     dropping the receipt as well removed the same money twice (£1,136.95
  //     across 35 refunds all-time).
  //  2. `order_payment_status` is NOT TRUSTWORTHY. Four orders (£252.23) are
  //     flagged FULLY_REFUNDED while their own payment_summary says
  //     `refunds: []`, `paymentStatus: PAID`, `cancelState: NONE_REQUESTED`
  //     and a positive totalDueSeller — i.e. paid, fulfilled, never refunded.
  //     The exclusion silently removed £252.23 of genuine income on the
  //     strength of one contradicted field.
  //
  // Every receipt is now counted and every refund deducted, so a genuinely
  // refunded order nets out through real transactions rather than a status
  // flag. Cash figures are unchanged by this (cash never excluded); accrual
  // turnover rises by the £1,389.18 of sales it had been dropping.
  const allData = await fetchAllRecords(supabase, 'ebay_transactions', {
    select: 'transaction_date, gross_transaction_amount',
    eq: { user_id: userId, transaction_type: 'SALE' },
    gte: { transaction_date: startDate },
    lt: { transaction_date: endDate },
  });

  const monthMap = new Map<string, number>();
  for (const row of allData) {
    if (!row.transaction_date) continue;
    const month = row.transaction_date.substring(0, 7);
    monthMap.set(month, (monthMap.get(month) || 0) + Number(row.gross_transaction_amount || 0));
  }

  console.log(`[P&L] eBay Gross Sales: found ${allData.length} SALE receipts (none excluded)`);

  return Array.from(monthMap.entries()).map(([month, total]) => ({
    month,
    total,
  }));
}

/**
 * Query eBay Refunds
 */
async function queryEbayRefunds(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string
): Promise<MonthlyAggregation[]> {
  const allData = await fetchAllRecords(supabase, 'ebay_transactions', {
    select: 'transaction_date, amount, raw_response',
    eq: { user_id: userId, transaction_type: 'REFUND', booking_entry: 'DEBIT' },
    gte: { transaction_date: startDate },
    lt: { transaction_date: endDate },
  });

  const monthMap = new Map<string, number>();
  for (const row of allData) {
    const month = row.transaction_date.substring(0, 7);
    // `amount` is NET of the fees eBay credits back with the refund
    // (totalFeeBasisAmount − totalFeeAmount == amount, exact on every row), so
    // using it buries a fee credit inside income. Income must fall by the GROSS
    // refund; the fee credit is applied to the fee rows by
    // sumEbayRefundFeeCredits. £8.85 in Q1 2026/27.
    const gross = ebayRefundGrossAmount(row);
    monthMap.set(month, (monthMap.get(month) || 0) + gross);
  }

  return Array.from(monthMap.entries()).map(([month, total]) => ({
    month,
    total,
  }));
}

/** eBay REFUND row shape for the fields we read. */
interface EbayRefundRaw {
  totalFeeBasisAmount?: { value?: string } | null;
  totalFeeAmount?: { value?: string } | null;
  orderLineItems?: Array<{
    marketplaceFees?: Array<{ feeType?: string; amount?: { value?: string } }> | null;
  }> | null;
}

/**
 * The GROSS amount refunded to the buyer: `totalFeeBasisAmount` where present,
 * else `amount` plus the credited fees. Falls back to `amount` alone only if
 * neither is available (which would understate the refund, so it is last).
 */
function ebayRefundGrossAmount(row: { amount: number | null; raw_response: unknown }): number {
  const raw = row.raw_response as EbayRefundRaw | null;
  const basis = Number(raw?.totalFeeBasisAmount?.value ?? NaN);
  if (Number.isFinite(basis) && basis > 0) return basis;
  const net = Math.abs(Number(row.amount || 0));
  const credited = Number(raw?.totalFeeAmount?.value ?? 0);
  return net + (Number.isFinite(credited) ? Math.abs(credited) : 0);
}

/**
 * Fee credits carried INSIDE a REFUND row's own `marketplaceFees`, summed per
 * feeType per month.
 *
 * This is a fourth, separate channel from the standalone NON_SALE_CHARGE
 * credits. They are NOT the same money — verified on Q1 2026/27: the refund
 * row's identity (basis − totalFeeAmount == amount) closes to the penny, so its
 * credit is self-contained, and the standalone credits reference listing ids on
 * different dates. Netting both is therefore correct, not a double-count.
 */
async function sumEbayRefundFeeCredits(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string,
  feeType: string
): Promise<Map<string, number>> {
  const allData = await fetchAllRecords(supabase, 'ebay_transactions', {
    select: 'transaction_date, raw_response',
    eq: { user_id: userId, transaction_type: 'REFUND', booking_entry: 'DEBIT' },
    gte: { transaction_date: startDate },
    lt: { transaction_date: endDate },
  });

  const monthMap = new Map<string, number>();
  for (const row of allData) {
    const raw = row.raw_response as EbayRefundRaw | null;
    let credited = 0;
    for (const lineItem of raw?.orderLineItems ?? []) {
      for (const fee of lineItem.marketplaceFees ?? []) {
        if (fee.feeType === feeType) credited += Math.abs(Number(fee.amount?.value || 0));
      }
    }
    if (credited === 0) continue;
    const month = row.transaction_date.substring(0, 7);
    monthMap.set(month, (monthMap.get(month) || 0) + credited);
  }

  return monthMap;
}

/**
 * Query BrickLink Gross Sales
 */
async function queryBrickLinkGrossSales(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string
): Promise<MonthlyAggregation[]> {
  // BrickLink stores statuses in UPPERCASE. Count every order as gross sales
  // unless it's explicitly cancelled — switching from an inclusion list means
  // new/transient statuses (PENDING, PROCESSING, READY, PURGED, etc.) are
  // captured automatically rather than silently dropped.
  const excludedStatuses = ['CANCELLED'];

  const allData = await fetchAllRecords(supabase, 'bricklink_transactions', {
    select: 'order_date, base_grand_total',
    eq: { user_id: userId },
    notIn: { order_status: excludedStatuses },
    gte: { order_date: startDate },
    lt: { order_date: endDate },
  });

  console.log(`[P&L] BrickLink Gross Sales: found ${allData.length} orders`);

  const monthMap = new Map<string, number>();
  for (const row of allData) {
    const month = row.order_date.substring(0, 7);
    monthMap.set(month, (monthMap.get(month) || 0) + Number(row.base_grand_total || 0));
  }

  // Debug: Log Oct 2025 specifically
  if (monthMap.has('2025-10')) {
    console.log(`[P&L] BrickLink Gross Sales Oct 2025: £${monthMap.get('2025-10')?.toFixed(2)}`);
  }

  return Array.from(monthMap.entries()).map(([month, total]) => ({
    month,
    total,
  }));
}

/**
 * Query Brick Owl Gross Sales
 */
async function queryBrickOwlGrossSales(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string
): Promise<MonthlyAggregation[]> {
  // Brick Owl stores statuses in Title Case. Count every order as gross sales
  // unless it's explicitly cancelled — "Payment Received" and any other
  // pre-shipment statuses now count toward gross sales.
  const excludedStatuses = ['Cancelled'];

  const allData = await fetchAllRecords(supabase, 'brickowl_transactions', {
    select: 'order_date, base_grand_total',
    eq: { user_id: userId },
    notIn: { order_status: excludedStatuses },
    gte: { order_date: startDate },
    lt: { order_date: endDate },
  });

  console.log(`[P&L] BrickOwl Gross Sales: found ${allData.length} orders`);

  const monthMap = new Map<string, number>();
  for (const row of allData) {
    const month = row.order_date.substring(0, 7);
    monthMap.set(month, (monthMap.get(month) || 0) + Number(row.base_grand_total || 0));
  }

  // Debug: Log Oct 2025 specifically
  if (monthMap.has('2025-10')) {
    console.log(`[P&L] BrickOwl Gross Sales Oct 2025: £${monthMap.get('2025-10')?.toFixed(2)}`);
  }

  return Array.from(monthMap.entries()).map(([month, total]) => ({
    month,
    total,
  }));
}

/**
 * Query Amazon Sales (from platform_orders by order_date)
 * Includes both Shipped and Paid orders to match Amazon Seller Central's
 * "Ordered product sales" metric
 */
async function queryAmazonSales(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string
): Promise<MonthlyAggregation[]> {
  const allData = await fetchAllRecords(supabase, 'platform_orders', {
    select: 'order_date, total',
    eq: { user_id: userId, platform: 'amazon' },
    in: { status: ['Shipped', 'Paid'] },
    gte: { order_date: startDate },
    lt: { order_date: endDate },
  });

  console.log(`[P&L] Amazon Sales: found ${allData.length} orders`);

  const monthMap = new Map<string, number>();
  for (const row of allData) {
    if (!row.order_date) continue;
    const month = row.order_date.substring(0, 7);
    monthMap.set(month, (monthMap.get(month) || 0) + Number(row.total || 0));
  }

  // Debug: Log Oct 2025 specifically
  if (monthMap.has('2025-10')) {
    console.log(`[P&L] Amazon Sales Oct 2025: £${monthMap.get('2025-10')?.toFixed(2)}`);
  }

  return Array.from(monthMap.entries()).map(([month, total]) => ({
    month,
    total,
  }));
}

/**
 * Query Amazon Refunds
 */
async function queryAmazonRefunds(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string
): Promise<MonthlyAggregation[]> {
  const allData = await fetchAllRecords(supabase, 'amazon_transactions', {
    select: 'posted_date, total_amount, breakdowns',
    eq: { user_id: userId },
    in: { transaction_type: ['Refund', 'GuaranteeClaimRefund'] },
    gte: { posted_date: startDate },
    lt: { posted_date: endDate },
  });

  const monthMap = new Map<string, number>();
  for (const row of allData) {
    const month = row.posted_date.substring(0, 7);
    // `Refunded Sales` only — NOT total_amount, which is already net of
    // `Refunded Expenses` (the fees Amazon credits back). Since queryAmazonFees
    // now subtracts those credits from the fee row, using total_amount here
    // would relieve the same credit twice (£17.52 in Q1 2026/27).
    const refundedSales = sumAmazonBreakdown(
      row.breakdowns as AmazonBreakdownNode[],
      /^Refunded Sales$/i
    );
    // Older rows may predate breakdowns capture; fall back rather than drop the
    // refund entirely, since a missing refund overstates income.
    const value =
      Math.abs(refundedSales) > 0
        ? Math.abs(refundedSales)
        : Math.abs(Number(row.total_amount || 0));
    monthMap.set(month, (monthMap.get(month) || 0) + value);
  }

  return Array.from(monthMap.entries()).map(([month, total]) => ({
    month,
    total,
  }));
}

/**
 * Query PayPal Fees (fee_amount on paypal_transactions by transaction_date).
 * Covers the per-sale PayPal fees that get netted off Brick Owl / BrickLink
 * payouts and never show up in Monzo, so without this row they're missing
 * from the P&L entirely.
 */
async function queryPayPalFees(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string
): Promise<MonthlyAggregation[]> {
  const allData = await fetchAllRecords(supabase, 'paypal_transactions', {
    select: 'transaction_date, fee_amount',
    eq: { user_id: userId },
    gte: { transaction_date: startDate },
    lt: { transaction_date: endDate },
  });

  const monthMap = new Map<string, number>();
  for (const row of allData) {
    if (!row.transaction_date) continue;
    const month = row.transaction_date.substring(0, 7);
    monthMap.set(month, (monthMap.get(month) || 0) + Math.abs(Number(row.fee_amount || 0)));
  }

  return Array.from(monthMap.entries()).map(([month, total]) => ({
    month,
    total,
  }));
}

// =============================================================================
// CASH-BASIS INCOME QUERY FUNCTIONS
//
// Cash basis recognises income when the money is received (agent-receipt
// principle). These functions are only used when the report is generated with
// basis: 'cash'; the accrual functions above remain the default.
// =============================================================================

/**
 * Cash: Amazon sales = Shipment financial events with status RELEASED, by
 * posted_date (the date Amazon credited the funds to the seller balance).
 *
 * IMPORTANT status semantics (verified against live data 2026-07-02):
 * - DEFERRED rows are funds Amazon has NOT yet released — excluded until the
 *   release event arrives.
 * - When a deferred transaction releases, the sync inserts a NEW row with
 *   status RELEASED and posted_date = the release date; the older DEFERRED /
 *   DEFERRED_RELEASED rows for the same order remain. Every DEFERRED_RELEASED
 *   row has a RELEASED sibling, so summing RELEASED-only is both complete and
 *   double-count-free.
 */
async function queryAmazonSalesCash(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string
): Promise<MonthlyAggregation[]> {
  const allRows = await fetchAllRecords(supabase, 'amazon_transactions', {
    select: 'posted_date, breakdowns, transaction_type, description',
    eq: { user_id: userId, transaction_status: 'RELEASED' },
    in: { transaction_type: ['Shipment', 'Adjustment'] },
    gte: { posted_date: startDate },
    lt: { posted_date: endDate },
  });

  // Shipment sales, plus the small `Sales` side of trading Adjustments
  // (LabmanLabelChargeBack credits). `Reserve` adjustments are EXCLUDED: their
  // Sales side is a balance movement matched by an equal Expenses side, so
  // counting it would inflate turnover by £6,263.55 across the account.
  const allData = allRows.filter((r) => !isAmazonBalanceMovement(r.description));

  // Gross sales come from the `Sales` breakdown, NOT `gross_sales_amount`,
  // which is net of the DigitalServicesFee — see sumAmazonBreakdown.
  const missing = countMissingBreakdowns(allData);
  if (missing > 0) {
    throw new Error(
      `Amazon cash sales: ${missing} of ${allData.length} RELEASED Shipment rows have no breakdowns — ` +
        `cannot derive gross sales. Re-sync amazon_transactions rather than reporting a partial figure.`
    );
  }

  const monthMap = new Map<string, number>();
  for (const row of allData) {
    if (!row.posted_date) continue;
    const month = row.posted_date.substring(0, 7);
    const sales = sumAmazonBreakdown(row.breakdowns as AmazonBreakdownNode[], /^Sales$/i);
    monthMap.set(month, (monthMap.get(month) || 0) + sales);
  }

  return Array.from(monthMap.entries()).map(([month, total]) => ({ month, total }));
}

/**
 * Cash: Amazon refunds = Refund/GuaranteeClaimRefund events with status
 * RELEASED, by posted_date. RELEASED-only for the same dedup reason as sales.
 */
async function queryAmazonRefundsCash(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string
): Promise<MonthlyAggregation[]> {
  const allData = await fetchAllRecords(supabase, 'amazon_transactions', {
    select: 'posted_date, breakdowns',
    eq: { user_id: userId, transaction_status: 'RELEASED' },
    in: { transaction_type: ['Refund', 'GuaranteeClaimRefund'] },
    gte: { posted_date: startDate },
    lt: { posted_date: endDate },
  });

  // Only the `Refunded Sales` part reduces turnover. `total_amount` on a refund
  // event is Refunded Sales PLUS `Refunded Expenses` (fees Amazon gives back —
  // £17.52 in Q1 2026/27), and netting a fee credit against income overstates
  // turnover and overstates fees by the same amount. The credit is applied to
  // the Amazon Fees row instead, in queryAmazonFees.
  const missing = countMissingBreakdowns(allData);
  if (missing > 0) {
    throw new Error(
      `Amazon cash refunds: ${missing} of ${allData.length} RELEASED refund rows have no breakdowns — ` +
        `cannot separate refunded sales from refunded fees.`
    );
  }

  const monthMap = new Map<string, number>();
  for (const row of allData) {
    if (!row.posted_date) continue;
    const month = row.posted_date.substring(0, 7);
    const refundedSales = sumAmazonBreakdown(
      row.breakdowns as AmazonBreakdownNode[],
      /^Refunded Sales$/i
    );
    monthMap.set(month, (monthMap.get(month) || 0) + Math.abs(refundedSales));
  }

  return Array.from(monthMap.entries()).map(([month, total]) => ({ month, total }));
}

/**
 * Brick Owl order receipts are labelled by PayPal ("Brick Owl Order #123");
 * BrickLink buyers pay through PayPal without a marketplace label.
 */
function isBrickOwlPayPalReceipt(transactionType: string | null): boolean {
  return /^brick ?owl order/i.test(transactionType ?? '');
}

/**
 * PayPal event codes that represent a CUSTOMER PAYMENT to us.
 *
 * T0006 is the bulk (BrickLink + Brick Owl checkout). T0011 and T0000 are the
 * same thing arriving by a different PayPal flow — direct/off-platform sales.
 * All 11 such rows (2024-11 → 2026-05, £705.59) carry an individual payer name
 * and a commercial goods-and-services fee, which a friends-and-family transfer
 * would not.
 *
 * They were omitted from income for two validation rounds while £31.65 of their
 * fees WAS being claimed as an expense — claiming the fee and omitting the
 * receipt is defensible neither way (£120.00 of it inside Q1 2026/27 alone).
 */
const PAYPAL_CUSTOMER_PAYMENT_CODES = ['T0006', 'T0011', 'T0000'] as const;

/**
 * Event codes we have consciously decided are NOT income, so a genuinely new
 * code trips the guard below instead of silently sitting outside the return.
 *   T1107 positive = a refund we RECEIVED from a supplier. Already relieved
 *   inside the stock-purchase row, so counting it as income would double-count.
 */
const PAYPAL_KNOWN_NON_INCOME_CODES = [
  'T1107',
  // T0403 — withdrawal / bank transfer. A movement between our own balances,
  // never trading income, even when it arrives with a positive gross amount.
  // Listed one code at a time on purpose: a prefix rule (all T04xx) would let a
  // genuinely new code through the guard silently, which is the failure mode
  // this whole mechanism exists to prevent.
  'T0403',
] as const;

/**
 * Fail loud if money arrives under an event code nobody has classified.
 *
 * This is the structural fix for how the T0011/T0000 receipts hid: the income
 * query named ONE code, so anything else was invisible rather than wrong.
 */
function assertNoUnclassifiedPayPalReceipts(
  rows: { transaction_event_code: string | null; gross_amount: number | null }[]
): void {
  const unknown = new Map<string, number>();
  for (const row of rows) {
    if (Number(row.gross_amount ?? 0) <= 0) continue;
    const code = row.transaction_event_code ?? '(null)';
    if ((PAYPAL_CUSTOMER_PAYMENT_CODES as readonly string[]).includes(code)) continue;
    if ((PAYPAL_KNOWN_NON_INCOME_CODES as readonly string[]).includes(code)) continue;
    unknown.set(code, (unknown.get(code) ?? 0) + Number(row.gross_amount ?? 0));
  }
  if (unknown.size > 0) {
    const detail = [...unknown.entries()].map(([c, v]) => `${c} £${v.toFixed(2)}`).join(', ');
    throw new Error(
      `Unclassified PayPal money-in event code(s): ${detail}. Decide whether each is income ` +
        `and add it to PAYPAL_CUSTOMER_PAYMENT_CODES or PAYPAL_KNOWN_NON_INCOME_CODES — ` +
        `do not leave receipts outside the return.`
    );
  }
}

/**
 * Fetch PayPal customer payment receipts (money in).
 * These are the order payments landing in the PayPal balance — the cash receipt
 * event. The PayPal sync stores every fee-bearing transaction, which customer
 * payments always are.
 */
async function fetchPayPalCustomerReceipts(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string
) {
  // Read EVERY money-in row so the guard can see codes we don't yet handle,
  // then let each caller select the codes it is responsible for.
  const allReceipts = await fetchAllRecords(supabase, 'paypal_transactions', {
    select: 'transaction_date, gross_amount, transaction_type, transaction_event_code, paypal_transaction_id',
    eq: { user_id: userId },
    gt: { gross_amount: 0 },
    gte: { transaction_date: startDate },
    lt: { transaction_date: endDate },
  });

  assertNoUnclassifiedPayPalReceipts(allReceipts);

  // Shopify orders paid via the PayPal gateway land in the PayPal balance too,
  // but their revenue is already counted by the Shopify Sales row (order date
  // == receipt date on both bases). Drop them here — one choke point protects
  // every consumer (BrickLink cash / Brick Owl cash / Other PayPal) from
  // counting the same money twice or mis-bucketing it as marketplace income.
  // Matched via the PayPal capture id Shopify exposes on the order transaction.
  const shopifyPayPalRows = await fetchAllRecords(supabase, 'shopify_transactions', {
    select: 'payment_ref',
    eq: { user_id: userId, gateway: 'paypal' },
  });
  const shopifyPayPalRefs = new Set(
    shopifyPayPalRows.map((r) => r.payment_ref).filter((ref): ref is string => !!ref)
  );

  return allReceipts.filter(
    (r) =>
      (PAYPAL_CUSTOMER_PAYMENT_CODES as readonly string[]).includes(
        r.transaction_event_code ?? ''
      ) && !shopifyPayPalRefs.has(r.paypal_transaction_id ?? '')
  );
}

/**
 * Cash: BrickLink sales = unlabelled PayPal customer receipts by date received.
 */
async function queryBrickLinkSalesCash(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string
): Promise<MonthlyAggregation[]> {
  const allData = await fetchPayPalCustomerReceipts(supabase, userId, startDate, endDate);

  const monthMap = new Map<string, number>();
  for (const row of allData) {
    if (!row.transaction_date || isBrickOwlPayPalReceipt(row.transaction_type)) continue;
    // T0006 only: the BL figure must stay reconcilable against bricklink_transactions.
    // Direct/off-platform receipts get their own row — see queryOtherPayPalSalesCash.
    if (row.transaction_event_code !== 'T0006') continue;
    const month = row.transaction_date.substring(0, 7);
    monthMap.set(month, (monthMap.get(month) || 0) + Number(row.gross_amount || 0));
  }

  return Array.from(monthMap.entries()).map(([month, total]) => ({ month, total }));
}

/**
 * Shopify sales, by order date.
 *
 * The customer pays at checkout, so receipt date == order date and the same
 * query serves both bases. Previously out of scope in both (documented when the
 * store was making nothing); it is now real trading income — £24.46 in Q1
 * 2026/27 and £79.92 in the first three weeks of July, so leaving it out would
 * understate turnover by a growing amount.
 *
 * Refunds are NOT netted here — the Shopify Refunds row deducts them once,
 * from shopify_transactions. Processing fees are claimed by the Shopify Fees
 * row (same source table).
 */
async function queryShopifySales(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string
): Promise<MonthlyAggregation[]> {
  const allData = await fetchAllRecords(supabase, 'platform_orders', {
    select: 'order_date, total, status',
    eq: { user_id: userId, platform: 'shopify' },
    gte: { order_date: startDate },
    lt: { order_date: endDate },
  });

  const monthMap = new Map<string, number>();
  for (const row of allData) {
    if (!row.order_date) continue;
    if (String(row.status ?? '').toLowerCase() === 'cancelled') continue;
    const month = row.order_date.substring(0, 7);
    monthMap.set(month, (monthMap.get(month) || 0) + Number(row.total || 0));
  }

  return Array.from(monthMap.entries()).map(([month, total]) => ({ month, total }));
}

/**
 * Shopify refunds, by refund transaction date (when the money went back).
 * Same query on both bases for the same agent-receipt reason as sales.
 * Sourced from shopify_transactions (kind='refund', gross negative) — the
 * per-order payment record — not from raw order JSON.
 */
async function queryShopifyRefunds(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string
): Promise<MonthlyAggregation[]> {
  const allData = await fetchAllRecords(supabase, 'shopify_transactions', {
    select: 'transaction_date, gross_amount',
    eq: { user_id: userId, kind: 'refund', status: 'success' },
    gte: { transaction_date: startDate },
    lt: { transaction_date: endDate },
  });

  const monthMap = new Map<string, number>();
  for (const row of allData) {
    if (!row.transaction_date) continue;
    const month = row.transaction_date.substring(0, 7);
    monthMap.set(month, (monthMap.get(month) || 0) + Math.abs(Number(row.gross_amount || 0)));
  }

  return Array.from(monthMap.entries()).map(([month, total]) => ({ month, total }));
}

/**
 * Shopify Payments processing fees (fee_amount on shopify_transactions by
 * transaction_date). Like PayPal fees, these are netted off payouts and never
 * reach Monzo, so without this row no Shopify processing fee is claimed
 * anywhere. PayPal-gateway Shopify orders carry fee_amount = 0 here — their
 * fee is claimed by the PayPal Fees row (paypal_transactions is authoritative)
 * so nothing is double-counted.
 */
async function queryShopifyFees(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string
): Promise<MonthlyAggregation[]> {
  const allData = await fetchAllRecords(supabase, 'shopify_transactions', {
    select: 'transaction_date, fee_amount',
    eq: { user_id: userId },
    gte: { transaction_date: startDate },
    lt: { transaction_date: endDate },
  });

  const monthMap = new Map<string, number>();
  for (const row of allData) {
    if (!row.transaction_date) continue;
    const fee = Math.abs(Number(row.fee_amount || 0));
    if (fee === 0) continue;
    const month = row.transaction_date.substring(0, 7);
    monthMap.set(month, (monthMap.get(month) || 0) + fee);
  }

  return Array.from(monthMap.entries()).map(([month, total]) => ({ month, total }));
}

/**
 * Cash: direct / off-platform PayPal sales — customer payments arriving under an
 * event code other than the marketplace checkout one (T0011, T0000).
 *
 * Kept as its OWN row rather than folded into BrickLink so that (a) the
 * BrickLink figure stays reconcilable against bricklink_transactions, and
 * (b) this income is visible in the P&L instead of hiding inside a platform
 * total. £120.00 in Q1 2026/27; £705.59 since Nov 2024.
 */
async function queryOtherPayPalSalesCash(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string
): Promise<MonthlyAggregation[]> {
  const allData = await fetchPayPalCustomerReceipts(supabase, userId, startDate, endDate);

  const monthMap = new Map<string, number>();
  for (const row of allData) {
    if (!row.transaction_date) continue;
    if (row.transaction_event_code === 'T0006') continue;
    const month = row.transaction_date.substring(0, 7);
    monthMap.set(month, (monthMap.get(month) || 0) + Number(row.gross_amount || 0));
  }

  return Array.from(monthMap.entries()).map(([month, total]) => ({ month, total }));
}

/**
 * Cash: Brick Owl sales = "Brick Owl Order" PayPal receipts by date received.
 */
async function queryBrickOwlSalesCash(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string
): Promise<MonthlyAggregation[]> {
  const allData = await fetchPayPalCustomerReceipts(supabase, userId, startDate, endDate);

  const monthMap = new Map<string, number>();
  for (const row of allData) {
    if (!row.transaction_date || !isBrickOwlPayPalReceipt(row.transaction_type)) continue;
    const month = row.transaction_date.substring(0, 7);
    monthMap.set(month, (monthMap.get(month) || 0) + Number(row.gross_amount || 0));
  }

  return Array.from(monthMap.entries()).map(([month, total]) => ({ month, total }));
}

/**
 * Cash: refunds we issue to BrickLink/Brick Owl buyers leave the PayPal
 * balance as T1107 payment-refund events. Requires the PayPal sync to store
 * refund events (it stores fee-bearing rows plus T1107 refunds).
 */
async function queryPayPalRefundsIssuedCash(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string
): Promise<MonthlyAggregation[]> {
  const allData = await fetchAllRecords(supabase, 'paypal_transactions', {
    select: 'transaction_date, gross_amount',
    eq: { user_id: userId, transaction_event_code: 'T1107' },
    gte: { transaction_date: startDate },
    lt: { gross_amount: 0, transaction_date: endDate },
  });

  const monthMap = new Map<string, number>();
  for (const row of allData) {
    if (!row.transaction_date) continue;
    const month = row.transaction_date.substring(0, 7);
    monthMap.set(month, (monthMap.get(month) || 0) + Math.abs(Number(row.gross_amount || 0)));
  }

  return Array.from(monthMap.entries()).map(([month, total]) => ({ month, total }));
}

/**
 * Query Monzo transactions by local_category with pagination to handle >1000 rows
 */
async function queryMonzoByCategory(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string,
  localCategory: string,
  netRefunds = false
): Promise<MonthlyAggregation[]> {
  // For COGS categories (netRefunds) we sum ALL amounts so refunds/sales
  // (positive) net off the spending (negative). Other categories stay
  // spending-only (amount < 0). Both `lt` conditions live in ONE object —
  // a spread with a second `lt:` key silently overwrites the date bound
  // (that bug unbounded six expense rows; caught by the E2E validation).
  const allData = await fetchAllRecords(supabase, 'monzo_transactions', {
    select: 'created, amount',
    eq: { user_id: userId, local_category: localCategory },
    gte: { created: startDate },
    lt: netRefunds ? { created: endDate } : { created: endDate, amount: 0 },
  });

  // Debug logging for Postage
  if (localCategory === 'Postage') {
    console.log(
      `[P&L] Postage query: ${startDate} to ${endDate}, found ${allData.length} records`
    );
    if (allData.length > 0) {
      console.log(`[P&L] Sample Postage record:`, allData[0]);
    }
  }

  const monthMap = new Map<string, number>();
  for (const row of allData) {
    const month = row.created.substring(0, 7);
    // Convert pence -> pounds. When netting, use -amount so spending (negative)
    // becomes a positive cost and refunds/sales (positive) subtract from it;
    // otherwise take the spending magnitude as before.
    const amountPounds = netRefunds
      ? -Number(row.amount || 0) / 100
      : Math.abs(Number(row.amount || 0)) / 100;
    monthMap.set(month, (monthMap.get(month) || 0) + amountPounds);
  }

  return Array.from(monthMap.entries()).map(([month, total]) => ({
    month,
    total,
  }));
}

/**
 * Query BrickLink / Brick Owl / Bricqer Fees (from Monzo 'Selling Fees' category)
 * This includes platform subscription fees paid via Monzo for all three platforms
 */
async function queryBrickLinkFees(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string
): Promise<MonthlyAggregation[]> {
  // Use the generic Monzo category query with pagination
  return queryMonzoByCategory(supabase, userId, startDate, endDate, 'Selling Fees');
}

/**
 * Query Amazon Fees: the `Expenses` breakdown on RELEASED Shipment events, less
 * the `Refunded Expenses` credited back on RELEASED refund events.
 *
 * NOT `total_fees` (the previous source) — that column carries Commission only
 * and dropped every DigitalServicesFee: £20.26 in Q1 2026/27, £220.08 since
 * Feb 2025. See sumAmazonBreakdown for the column-by-column evidence.
 */
async function queryAmazonFees(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string
): Promise<MonthlyAggregation[]> {
  // Read EVERY RELEASED row so the guard sees any unclassified type, then take
  // fees from the types that actually bear them. Restricting the query itself to
  // 'Shipment' is what hid the Adjustment costs.
  const allReleased = await fetchAllRecords(supabase, 'amazon_transactions', {
    select: 'posted_date, breakdowns, transaction_type, description',
    eq: { user_id: userId, transaction_status: 'RELEASED' },
    gte: { posted_date: startDate },
    lt: { posted_date: endDate },
  });

  assertNoUnclassifiedAmazonTypes(allReleased);
  assertKnownAmazonAdjustments(allReleased);

  const charges = allReleased.filter(
    (r) =>
      AMAZON_FEE_BEARING_TYPES.includes(r.transaction_type ?? '') &&
      !isAmazonBalanceMovement(r.description)
  );
  const refunds = allReleased.filter(
    (r) => AMAZON_TYPE_TREATMENT[r.transaction_type ?? ''] === 'refund'
  );

  const missing = countMissingBreakdowns(charges) + countMissingBreakdowns(refunds);
  if (missing > 0) {
    throw new Error(
      `Amazon fees: ${missing} RELEASED rows have no breakdowns — cannot derive fees. ` +
        `Re-sync amazon_transactions rather than under-reporting the fee total.`
    );
  }

  const monthMap = new Map<string, number>();
  for (const row of charges) {
    if (!row.posted_date) continue;
    const month = row.posted_date.substring(0, 7);
    const fees = Math.abs(
      sumAmazonBreakdown(row.breakdowns as AmazonBreakdownNode[], /^Expenses$/i)
    );
    monthMap.set(month, (monthMap.get(month) || 0) + fees);
  }
  for (const row of refunds) {
    if (!row.posted_date) continue;
    const month = row.posted_date.substring(0, 7);
    const credited = Math.abs(
      sumAmazonBreakdown(row.breakdowns as AmazonBreakdownNode[], /^Refunded Expenses$/i)
    );
    monthMap.set(month, (monthMap.get(month) || 0) - credited);
  }

  return Array.from(monthMap.entries()).map(([month, total]) => ({
    month,
    total,
  }));
}

/**
 * Every eBay `transaction_type` and what the P&L does with it.
 *
 * eBay was the last platform without a registry, which is exactly where the next
 * Reserve-class surprise would have hidden. Measured over all 9,530 rows:
 *
 *   SALE             3303 rows  £81,499.38  income
 *   NON_SALE_CHARGE  5954 rows   £5,480.97  fees (by feeType)
 *   REFUND            197 rows   £3,035.00  income deduction + fee credits
 *   SHIPPING_LABEL     48 rows     £185.79  postage — was claimed NOWHERE
 *   DISPUTE             9 rows     £400.21  offset exactly by CREDIT below
 *   CREDIT              9 rows     £400.21  the matching credit, so net £0
 *   TRANSFER            8 rows     £109.72  payout to bank, a balance movement
 *   ADJUSTMENT          2 rows      £5.96p  net credit, immaterial, undecided
 */
const EBAY_TYPE_TREATMENT: Record<
  string,
  'income' | 'refund' | 'fees' | 'postage' | 'excluded' | 'unclaimed'
> = {
  SALE: 'income',
  REFUND: 'refund',
  NON_SALE_CHARGE: 'fees',
  // Real postage bought through eBay. £185.79 all-time and £0.00 in Q1 2026/27,
  // so no filed figure moves — but it is a deductible cost and belongs in the
  // Postage row rather than nowhere.
  SHIPPING_LABEL: 'postage',
  // DISPUTE debits (£400.21 over 9 rows) are matched one-for-one by CREDIT rows
  // of exactly £400.21 over 9 rows — equal and opposite, so including either
  // side alone would distort. Same shape as Amazon's `Reserve`.
  DISPUTE: 'excluded',
  CREDIT: 'excluded',
  // Payout to the bank: money already counted as income when the sale landed.
  TRANSFER: 'excluded',
  // NOT a balance movement — the first version of this registry said it was,
  // which was the exact sin the Reserve investigation warned about: classifying
  // for convenience without reading the rows. They are two real trading items:
  //   2024-08-07 CREDIT £26.12  "Store (Basic): Subscription Fee"  (shop-fee refund)
  //   2025-03-31 DEBIT  £20.16  "Seller Co-funded Coupon Charge"   (marketing cost)
  // Both fall in FY2024/25 — £0.00 in Q1 2026/27 AND £0.00 in FY2025/26 — so no
  // filed figure turns on them, and building a whole row for £5.96 net is not
  // worth it. Deliberately UNCLAIMED, not "excluded as a movement": the £20.16
  // cost is forgone and the £26.12 credit untaken, leaving us £5.96 in HMRC's
  // favour. Claim both properly if this type ever recurs materially.
  ADJUSTMENT: 'unclaimed',
}

/** Fail loud on an eBay transaction_type nobody has classified. */
function assertNoUnclassifiedEbayTypes(rows: { transaction_type: string | null }[]): void {
  const unknown = new Set<string>();
  for (const row of rows) {
    const type = row.transaction_type ?? '(null)';
    if (!(type in EBAY_TYPE_TREATMENT)) unknown.add(type);
  }
  if (unknown.size > 0) {
    throw new Error(
      `Unclassified eBay transaction_type(s): ${[...unknown].join(', ')}. Add each to ` +
        `EBAY_TYPE_TREATMENT — do not leave eBay money outside the report.`
    );
  }
}

/**
 * eBay postage bought via SHIPPING_LABEL rows.
 *
 * Separate from the Monzo-sourced Postage row (Royal Mail card payments) and
 * additive to it: this is postage paid out of the eBay balance, which never
 * touches the bank feed.
 */
async function queryEbayShippingLabels(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string
): Promise<MonthlyAggregation[]> {
  // Read every type in the window so the registry guard can see a new one.
  const allRows = await fetchAllRecords(supabase, 'ebay_transactions', {
    select: 'transaction_date, amount, transaction_type',
    eq: { user_id: userId },
    gte: { transaction_date: startDate },
    lt: { transaction_date: endDate },
  });

  assertNoUnclassifiedEbayTypes(allRows);

  const monthMap = new Map<string, number>();
  for (const row of allRows) {
    if (EBAY_TYPE_TREATMENT[row.transaction_type ?? ''] !== 'postage') continue;
    if (!row.transaction_date) continue;
    const month = row.transaction_date.substring(0, 7);
    monthMap.set(month, (monthMap.get(month) || 0) + Math.abs(Number(row.amount || 0)));
  }

  return Array.from(monthMap.entries()).map(([month, total]) => ({ month, total }));
}

/**
 * Query eBay fees by fee type from raw_response
 */
async function queryEbayFeesByType(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string,
  feeType: string
): Promise<MonthlyAggregation[]> {
  // DEBIT charges less CREDIT reversals OF THE SAME feeType. Matching feeType on
  // both sides is what keeps a reversal against the fee it actually reverses —
  // an unfiltered credit sweep put a £0.48 FINAL_VALUE_FEE_FIXED_PER_ORDER
  // credit against Promoted Listings in Q1 2026/27.
  const allData = await fetchAllRecords(supabase, 'ebay_transactions', {
    select: 'transaction_date, amount, booking_entry, raw_response',
    eq: { user_id: userId, transaction_type: 'NON_SALE_CHARGE' },
    in: { booking_entry: ['DEBIT', 'CREDIT'] },
    gte: { transaction_date: startDate },
    lt: { transaction_date: endDate },
  });

  const monthMap = new Map<string, number>();
  for (const row of allData) {
    const rawResponse = row.raw_response as { feeType?: string } | null;
    if (rawResponse?.feeType !== feeType) continue;
    const month = row.transaction_date.substring(0, 7);
    const signed =
      row.booking_entry === 'CREDIT'
        ? -Math.abs(Number(row.amount || 0))
        : Math.abs(Number(row.amount || 0));
    monthMap.set(month, (monthMap.get(month) || 0) + signed);
  }

  return Array.from(monthMap.entries()).map(([month, total]) => ({
    month,
    total,
  }));
}

/**
 * Helper to query eBay SALE transaction fees by fee type with pagination.
 *
 * Sale-embedded fees are charged inside the SALE row's `marketplaceFees`, but
 * eBay reverses them later as a standalone NON_SALE_CHARGE CREDIT carrying the
 * same feeType — so the reversal must be netted here, against the fee it
 * actually reverses. Q1 2026/27 had one: a £0.48
 * FINAL_VALUE_FEE_FIXED_PER_ORDER credit, which previously fell against
 * Promoted Listings and, once that was fixed, against nothing at all.
 *
 * No double-count risk: each feeType is served by exactly one of
 * queryEbaySaleFeesByType / queryEbayFeesByType / queryEbayAdFeesStandard.
 */
async function queryEbaySaleFeesByType(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string,
  feeType: string
): Promise<MonthlyAggregation[]> {
  const [allData, standalone] = await Promise.all([
    fetchAllRecords(supabase, 'ebay_transactions', {
      select: 'transaction_date, raw_response',
      eq: { user_id: userId, transaction_type: 'SALE', booking_entry: 'CREDIT' },
      gte: { transaction_date: startDate },
      lt: { transaction_date: endDate },
    }),
    // Standalone NON_SALE_CHARGE rows of this same feeType — BOTH directions.
    // Credits were already netted; debits were not, so £5.59 of standalone
    // FINAL_VALUE_FEE / FVF_FIXED / REGULATORY_OPERATING_FEE charges reached no
    // box at all (£0.00 in Q1 2026/27). Reading both keeps it symmetric.
    fetchAllRecords(supabase, 'ebay_transactions', {
      select: 'transaction_date, amount, booking_entry, raw_response',
      eq: { user_id: userId, transaction_type: 'NON_SALE_CHARGE' },
      in: { booking_entry: ['DEBIT', 'CREDIT'] },
      gte: { transaction_date: startDate },
      lt: { transaction_date: endDate },
    }),
  ]);

  const monthMap = new Map<string, number>();
  for (const row of allData) {
    const month = row.transaction_date.substring(0, 7);
    const rawResponse = row.raw_response as {
      orderLineItems?: Array<{
        marketplaceFees?: Array<{ feeType: string; amount: { value: string } }>;
      }>;
    } | null;

    let feeTotal = 0;
    if (rawResponse?.orderLineItems) {
      for (const lineItem of rawResponse.orderLineItems) {
        if (lineItem.marketplaceFees) {
          for (const fee of lineItem.marketplaceFees) {
            if (fee.feeType === feeType) {
              feeTotal += Number(fee.amount?.value || 0);
            }
          }
        }
      }
    }
    monthMap.set(month, (monthMap.get(month) || 0) + feeTotal);
  }

  // Standalone charges and reversals of this same feeType
  for (const row of standalone) {
    const rawResponse = row.raw_response as { feeType?: string } | null;
    if (rawResponse?.feeType !== feeType) continue;
    const month = row.transaction_date.substring(0, 7);
    const signed =
      row.booking_entry === 'CREDIT'
        ? -Math.abs(Number(row.amount || 0))
        : Math.abs(Number(row.amount || 0));
    monthMap.set(month, (monthMap.get(month) || 0) + signed);
  }

  // Net the fee credits carried inside REFUND rows — a separate channel that
  // previously landed in income instead of against fees.
  const refundCredits = await sumEbayRefundFeeCredits(
    supabase,
    userId,
    startDate,
    endDate,
    feeType
  );
  for (const [month, credited] of refundCredits) {
    monthMap.set(month, (monthMap.get(month) || 0) - credited);
  }

  return Array.from(monthMap.entries()).map(([month, total]) => ({
    month,
    total,
  }));
}

/**
 * Query eBay Variable Fees (FINAL_VALUE_FEE from SALE transactions)
 */
async function queryEbayVariableFees(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string
): Promise<MonthlyAggregation[]> {
  return queryEbaySaleFeesByType(supabase, userId, startDate, endDate, 'FINAL_VALUE_FEE');
}

/**
 * Query eBay Regulatory Fees (from SALE transactions)
 */
async function queryEbayRegulatoryFees(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string
): Promise<MonthlyAggregation[]> {
  return queryEbaySaleFeesByType(supabase, userId, startDate, endDate, 'REGULATORY_OPERATING_FEE');
}

/**
 * Query eBay International Fees (from SALE transactions)
 */
async function queryEbayInternationalFees(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string
): Promise<MonthlyAggregation[]> {
  return queryEbaySaleFeesByType(supabase, userId, startDate, endDate, 'INTERNATIONAL_FEE');
}

/**
 * Query eBay Ad Fees - Standard (AD_FEE minus fee refunds)
 */
async function queryEbayAdFeesStandard(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string
): Promise<MonthlyAggregation[]> {
  // Get AD_FEE charges
  const allCharges = await fetchAllRecords(supabase, 'ebay_transactions', {
    select: 'transaction_date, amount, raw_response',
    eq: { user_id: userId, transaction_type: 'NON_SALE_CHARGE', booking_entry: 'DEBIT' },
    gte: { transaction_date: startDate },
    lt: { transaction_date: endDate },
  });

  // Get AD_FEE reversals only. Sweeping up EVERY NON_SALE_CHARGE credit put
  // other fee types' reversals against advertising: a £0.48
  // FINAL_VALUE_FEE_FIXED_PER_ORDER credit landed in SA103F box 24.1
  // (advertising) instead of box 30 in Q1 2026/27.
  const allRefunds = await fetchAllRecords(supabase, 'ebay_transactions', {
    select: 'transaction_date, amount, raw_response',
    eq: { user_id: userId, transaction_type: 'NON_SALE_CHARGE', booking_entry: 'CREDIT' },
    gte: { transaction_date: startDate },
    lt: { transaction_date: endDate },
  });

  const monthMap = new Map<string, number>();

  // Add AD_FEE charges
  for (const row of allCharges) {
    const rawResponse = row.raw_response as { feeType?: string } | null;
    if (rawResponse?.feeType === 'AD_FEE') {
      const month = row.transaction_date.substring(0, 7);
      monthMap.set(month, (monthMap.get(month) || 0) + Math.abs(Number(row.amount || 0)));
    }
  }

  // Subtract AD_FEE refunds only
  for (const row of allRefunds) {
    const rawResponse = row.raw_response as { feeType?: string } | null;
    if (rawResponse?.feeType !== 'AD_FEE') continue;
    const month = row.transaction_date.substring(0, 7);
    monthMap.set(month, (monthMap.get(month) || 0) - Math.abs(Number(row.amount || 0)));
  }

  // No Math.max(0, …) floor: a month whose reversals genuinely exceed its
  // charges is a real credit and must show as one. The floor silently ate the
  // difference, so a large mis-posted reversal would have been invisible.
  return Array.from(monthMap.entries()).map(([month, total]) => ({
    month,
    total,
  }));
}

/**
 * Query eBay Fixed Fees (FINAL_VALUE_FEE_FIXED_PER_ORDER from SALE transactions)
 */
async function queryEbayFixedFees(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string
): Promise<MonthlyAggregation[]> {
  // Use the paginated helper for SALE transaction fees
  return queryEbaySaleFeesByType(
    supabase,
    userId,
    startDate,
    endDate,
    'FINAL_VALUE_FEE_FIXED_PER_ORDER'
  );
}

/**
 * Query eBay Shop Fee (monthly subscription - OTHER_FEES with date range memo)
 */
/**
 * eBay Promoted Offsite advertising fees — OTHER_FEES rows whose memo names
 * them, as opposed to the shop-subscription rows the memo-date test catches.
 *
 * £26.12 all-time across many sub-£1 charges (Dec 2024 – Mar 2025), so £0.00 in
 * both Q1 2026/27 and FY2025/26. It reached no box before, and it is advertising
 * rather than a marketplace commission, so it belongs with the ad fees in
 * box 24.1.
 */
async function queryEbayPromotedOffsite(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string
): Promise<MonthlyAggregation[]> {
  const allData = await fetchAllRecords(supabase, 'ebay_transactions', {
    select: 'transaction_date, amount, raw_response',
    eq: { user_id: userId, transaction_type: 'NON_SALE_CHARGE', booking_entry: 'DEBIT' },
    gte: { transaction_date: startDate },
    lt: { transaction_date: endDate },
  });

  const monthMap = new Map<string, number>();
  for (const row of allData) {
    const rawResponse = row.raw_response as { feeType?: string; transactionMemo?: string } | null;
    if (rawResponse?.feeType !== 'OTHER_FEES') continue;
    if (!/promoted|offsite/i.test(rawResponse?.transactionMemo ?? '')) continue;
    const month = row.transaction_date.substring(0, 7);
    monthMap.set(month, (monthMap.get(month) || 0) + Math.abs(Number(row.amount || 0)));
  }

  return Array.from(monthMap.entries()).map(([month, total]) => ({ month, total }));
}

async function queryEbayShopFee(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string
): Promise<MonthlyAggregation[]> {
  const allData = await fetchAllRecords(supabase, 'ebay_transactions', {
    select: 'transaction_date, amount, raw_response',
    eq: { user_id: userId, transaction_type: 'NON_SALE_CHARGE', booking_entry: 'DEBIT' },
    gte: { transaction_date: startDate },
    lt: { transaction_date: endDate },
  });

  // Date range pattern: YYYY-MM-DD - YYYY-MM-DD
  const dateRangePattern = /^\d{4}-\d{2}-\d{2} - \d{4}-\d{2}-\d{2}$/;

  // OTHER_FEES is not just the shop subscription. Any row failing the memo test
  // used to fall through to NO box at all — £26.12 of "Promoted Offsite fee"
  // (many sub-£1 rows, Dec 2024 – Mar 2025, so £0.00 in both Q1 2026/27 and
  // FY2025/26). Advertising memos are routed to the ad-fee row instead of being
  // dropped, and anything else trips the guard below rather than vanishing.
  const ADVERTISING_MEMOS = /promoted|offsite/i;

  const monthMap = new Map<string, number>();
  const unclassifiedMemos = new Map<string, number>();
  for (const row of allData) {
    const rawResponse = row.raw_response as { feeType?: string; transactionMemo?: string } | null;
    if (rawResponse?.feeType !== 'OTHER_FEES') continue;
    const memo = rawResponse?.transactionMemo ?? '';
    const value = Math.abs(Number(row.amount || 0));

    if (dateRangePattern.test(memo)) {
      const month = row.transaction_date.substring(0, 7);
      monthMap.set(month, (monthMap.get(month) || 0) + value);
    } else if (!ADVERTISING_MEMOS.test(memo)) {
      // Advertising is picked up by queryEbayPromotedOffsite; anything else is
      // money nobody has decided about.
      unclassifiedMemos.set(memo || '(no memo)', (unclassifiedMemos.get(memo || '(no memo)') ?? 0) + value);
    }
  }

  if (unclassifiedMemos.size > 0) {
    const detail = [...unclassifiedMemos.entries()]
      .map(([memo, v]) => `"${memo}" £${v.toFixed(2)}`)
      .join(', ');
    throw new Error(
      `Unclassified eBay OTHER_FEES memo(s): ${detail}. Decide which box each belongs in — ` +
        `OTHER_FEES covers the shop subscription AND other charges, so a memo that matches ` +
        `neither pattern reaches no box at all.`
    );
  }

  return Array.from(monthMap.entries()).map(([month, total]) => ({
    month,
    total,
  }));
}

/**
 * Query Lego Stock Purchases (from Monzo 'Lego Stock' category)
 */
async function queryLegoStockPurchases(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string
): Promise<MonthlyAggregation[]> {
  // Use the generic Monzo category query with pagination.
  // netRefunds: refunds/sales in this COGS category net off the purchase cost.
  return queryMonzoByCategory(supabase, userId, startDate, endDate, 'Lego Stock', true);
}

/**
 * Query Lego Parts Purchases (from Monzo 'Lego Parts' category)
 */
async function queryLegoPartsPurchases(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string
): Promise<MonthlyAggregation[]> {
  // Use the generic Monzo category query with pagination.
  // netRefunds: refunds/sales in this COGS category net off the parts cost.
  return queryMonzoByCategory(supabase, userId, startDate, endDate, 'Lego Parts', true);
}

/**
 * Query Amazon Subscription (ServiceFee)
 */
async function queryAmazonSubscription(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string
): Promise<MonthlyAggregation[]> {
  const allData = await fetchAllRecords(supabase, 'amazon_transactions', {
    select: 'posted_date, total_amount',
    eq: { user_id: userId, transaction_type: 'ServiceFee' },
    gte: { posted_date: startDate },
    lt: { posted_date: endDate },
  });

  const monthMap = new Map<string, number>();
  for (const row of allData) {
    const month = row.posted_date.substring(0, 7);
    monthMap.set(month, (monthMap.get(month) || 0) + Math.abs(Number(row.total_amount || 0)));
  }

  return Array.from(monthMap.entries()).map(([month, total]) => ({
    month,
    total,
  }));
}

/**
 * Query Mileage
 */
async function queryMileage(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string
): Promise<MonthlyAggregation[]> {
  const allData = await fetchAllRecords(supabase, 'mileage_tracking', {
    select: 'tracking_date, amount_claimed',
    eq: { user_id: userId },
    gte: { tracking_date: startDate },
    lt: { tracking_date: endDate },
  });

  const monthMap = new Map<string, number>();
  for (const row of allData) {
    const month = row.tracking_date.substring(0, 7);
    monthMap.set(month, (monthMap.get(month) || 0) + Number(row.amount_claimed || 0));
  }

  return Array.from(monthMap.entries()).map(([month, total]) => ({
    month,
    total,
  }));
}

/**
 * HMRC flat rates for Use of Home
 */
const HMRC_RATES: Record<string, number> = {
  '25-50': 10,
  '51-100': 18,
  '101+': 26,
};

/**
 * Check if a home cost entry is active in a given month
 */
function isHomeCostActiveInMonth(
  startDate: string,
  endDate: string | null,
  targetMonth: string
): boolean {
  const start = startDate.substring(0, 7);
  const end = endDate ? endDate.substring(0, 7) : null;

  if (targetMonth < start) return false;
  if (end && targetMonth > end) return false;
  return true;
}

/**
 * Query Home Costs - Use of Home
 * Returns monthly HMRC flat rate based on hours per month
 */
async function queryHomeCostsUseOfHome(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string
): Promise<MonthlyAggregation[]> {
  const { data, error } = await supabase
    .from('home_costs')
    .select('*')
    .eq('user_id', userId)
    .eq('cost_type', 'use_of_home');

  if (error) {
    console.error('[P&L] Error querying Use of Home:', error);
    return [];
  }

  const months = generateMonthRange(startDate.substring(0, 7), getLastMonthFromExclusiveEnd(endDate));

  const monthMap = new Map<string, number>();

  for (const month of months) {
    let total = 0;

    for (const cost of data || []) {
      if (!isHomeCostActiveInMonth(cost.start_date, cost.end_date, month)) continue;
      const rate = cost.hours_per_month ? HMRC_RATES[cost.hours_per_month] || 0 : 0;
      total += rate;
    }

    if (total > 0) {
      monthMap.set(month, total);
    }
  }

  return Array.from(monthMap.entries()).map(([month, total]) => ({
    month,
    total,
  }));
}

/**
 * Query Home Costs - Phone & Broadband
 * Returns monthly claimable amount (monthlyCost * businessPercent / 100)
 */
async function queryHomeCostsPhoneBroadband(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string
): Promise<MonthlyAggregation[]> {
  const { data, error } = await supabase
    .from('home_costs')
    .select('*')
    .eq('user_id', userId)
    .eq('cost_type', 'phone_broadband');

  if (error) {
    console.error('[P&L] Error querying Phone & Broadband:', error);
    return [];
  }

  const months = generateMonthRange(startDate.substring(0, 7), getLastMonthFromExclusiveEnd(endDate));

  const monthMap = new Map<string, number>();

  for (const month of months) {
    let total = 0;

    for (const cost of data || []) {
      if (!isHomeCostActiveInMonth(cost.start_date, cost.end_date, month)) continue;
      const claimable = (cost.monthly_cost || 0) * ((cost.business_percent || 0) / 100);
      total += claimable;
    }

    if (total > 0) {
      monthMap.set(month, total);
    }
  }

  return Array.from(monthMap.entries()).map(([month, total]) => ({
    month,
    total,
  }));
}

/**
 * Query Home Costs - Insurance
 * Returns monthly claimable (annualPremium * proportion / 12)
 */
async function queryHomeCostsInsurance(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string
): Promise<MonthlyAggregation[]> {
  const { data, error } = await supabase
    .from('home_costs')
    .select('*')
    .eq('user_id', userId)
    .eq('cost_type', 'insurance');

  if (error) {
    console.error('[P&L] Error querying Insurance:', error);
    return [];
  }

  const months = generateMonthRange(startDate.substring(0, 7), getLastMonthFromExclusiveEnd(endDate));

  const monthMap = new Map<string, number>();

  for (const month of months) {
    let total = 0;

    for (const cost of data || []) {
      if (!isHomeCostActiveInMonth(cost.start_date, cost.end_date, month)) continue;

      const annualPremium = cost.annual_premium || 0;
      const businessStockValue = cost.business_stock_value || 0;
      const totalContentsValue = cost.total_contents_value || 1; // Prevent divide by zero

      const proportion = businessStockValue / totalContentsValue;
      const annualClaimable = annualPremium * proportion;
      const monthlyClaimable = annualClaimable / 12;

      total += monthlyClaimable;
    }

    if (total > 0) {
      monthMap.set(month, total);
    }
  }

  return Array.from(monthMap.entries()).map(([month, total]) => ({
    month,
    total,
  }));
}

// =============================================================================
// ROW DEFINITIONS
// =============================================================================

/**
 * Income row definitions per basis. Expense rows are shared — they are already
 * recognised on payment dates in both bases.
 *
 * Cash-basis notes:
 * - eBay is IDENTICAL on both bases: buyers pay eBay (our collecting agent) at
 *   the moment of sale, so receipt date == sale date, and neither basis excludes
 *   a "fully refunded" order — the refunds row deducts the money once. See
 *   queryEbayGrossSales for why that flag is not trusted.
 * - The BL/BO refunds row only exists on cash basis; on accrual, cancelled
 *   orders are excluded from gross sales instead.
 */
function getIncomeRowDefinitions(basis: ReportBasis): RowDefinition[] {
  if (basis === 'cash') {
    return [
      {
        category: 'Income',
        transactionType: 'eBay Gross Sales',
        queryFn: queryEbayGrossSales,
        signMultiplier: 1,
      },
      {
        category: 'Income',
        transactionType: 'eBay Refunds',
        queryFn: queryEbayRefunds,
        signMultiplier: -1,
      },
      {
        category: 'Income',
        transactionType: 'BrickLink Sales (cash received)',
        queryFn: queryBrickLinkSalesCash,
        signMultiplier: 1,
      },
      {
        category: 'Income',
        transactionType: 'Brick Owl Sales (cash received)',
        queryFn: queryBrickOwlSalesCash,
        signMultiplier: 1,
      },
      {
        category: 'Income',
        transactionType: 'Other PayPal Sales (cash received)',
        queryFn: queryOtherPayPalSalesCash,
        signMultiplier: 1,
      },
      {
        category: 'Income',
        transactionType: 'Shopify Sales',
        queryFn: queryShopifySales,
        signMultiplier: 1,
      },
      {
        category: 'Income',
        transactionType: 'Shopify Refunds',
        queryFn: queryShopifyRefunds,
        signMultiplier: -1,
      },
      {
        category: 'Income',
        transactionType: 'BrickLink / Brick Owl Refunds (cash)',
        queryFn: queryPayPalRefundsIssuedCash,
        signMultiplier: -1,
      },
      {
        category: 'Income',
        transactionType: 'Amazon Sales (funds released)',
        queryFn: queryAmazonSalesCash,
        signMultiplier: 1,
      },
      {
        category: 'Income',
        transactionType: 'Amazon Refunds (funds released)',
        queryFn: queryAmazonRefundsCash,
        signMultiplier: -1,
      },
    ];
  }

  return [
    {
      category: 'Income',
      transactionType: 'eBay Gross Sales',
      queryFn: queryEbayGrossSales,
      signMultiplier: 1,
    },
    {
      category: 'Income',
      transactionType: 'eBay Refunds',
      queryFn: queryEbayRefunds,
      signMultiplier: -1,
    },
    {
      category: 'Income',
      transactionType: 'BrickLink Gross Sales',
      queryFn: queryBrickLinkGrossSales,
      signMultiplier: 1,
    },
    {
      category: 'Income',
      transactionType: 'Brick Owl Gross Sales',
      queryFn: queryBrickOwlGrossSales,
      signMultiplier: 1,
    },
    {
      category: 'Income',
      transactionType: 'Shopify Sales',
      queryFn: queryShopifySales,
      signMultiplier: 1,
    },
    {
      category: 'Income',
      transactionType: 'Shopify Refunds',
      queryFn: queryShopifyRefunds,
      signMultiplier: -1,
    },
    {
      category: 'Income',
      transactionType: 'Amazon Sales',
      queryFn: queryAmazonSales,
      signMultiplier: 1,
    },
    {
      category: 'Income',
      transactionType: 'Amazon Refunds',
      queryFn: queryAmazonRefunds,
      signMultiplier: -1,
    },
  ];
}

/**
 * All row definitions for the P&L report
 */
function getRowDefinitions(basis: ReportBasis = 'accrual'): RowDefinition[] {
  return [
    ...getIncomeRowDefinitions(basis),

    // SELLING FEES
    {
      category: 'Selling Fees',
      transactionType: 'BrickLink / Brick Owl / Bricqer Fees',
      queryFn: queryBrickLinkFees,
      signMultiplier: -1,
    },
    {
      category: 'Selling Fees',
      transactionType: 'Amazon Fees',
      queryFn: queryAmazonFees,
      signMultiplier: -1,
    },
    {
      category: 'Selling Fees',
      transactionType: 'PayPal Fees',
      queryFn: queryPayPalFees,
      signMultiplier: -1,
    },
    {
      category: 'Selling Fees',
      transactionType: 'Shopify Fees',
      queryFn: queryShopifyFees,
      signMultiplier: -1,
    },
    {
      category: 'Selling Fees',
      transactionType: 'eBay Insertion Fees',
      queryFn: (supabase, userId, startDate, endDate) =>
        queryEbayFeesByType(supabase, userId, startDate, endDate, 'INSERTION_FEE'),
      signMultiplier: -1,
    },
    {
      category: 'Selling Fees',
      transactionType: 'eBay Ad Fees - Standard',
      queryFn: queryEbayAdFeesStandard,
      signMultiplier: -1,
    },
    {
      // Promoted Offsite advertising, previously in no box at all.
      category: 'Selling Fees',
      transactionType: 'eBay Promoted Offsite',
      queryFn: queryEbayPromotedOffsite,
      signMultiplier: -1,
    },
    {
      category: 'Selling Fees',
      transactionType: 'eBay Ad Fees - Advanced',
      queryFn: (supabase, userId, startDate, endDate) =>
        queryEbayFeesByType(supabase, userId, startDate, endDate, 'PREMIUM_AD_FEES'),
      signMultiplier: -1,
    },
    {
      category: 'Selling Fees',
      transactionType: 'eBay Fixed Fees',
      queryFn: queryEbayFixedFees,
      signMultiplier: -1,
    },
    {
      category: 'Selling Fees',
      transactionType: 'eBay Variable Fees',
      queryFn: queryEbayVariableFees,
      signMultiplier: -1,
    },
    {
      category: 'Selling Fees',
      transactionType: 'eBay Regulatory Fees',
      queryFn: queryEbayRegulatoryFees,
      signMultiplier: -1,
    },
    {
      category: 'Selling Fees',
      transactionType: 'eBay Shop Fee',
      queryFn: queryEbayShopFee,
      signMultiplier: -1,
    },
    {
      category: 'Selling Fees',
      transactionType: 'eBay International Fees',
      queryFn: queryEbayInternationalFees,
      signMultiplier: -1,
    },

    // STOCK PURCHASE
    {
      category: 'Stock Purchase',
      transactionType: 'Lego Stock Purchases',
      queryFn: queryLegoStockPurchases,
      signMultiplier: -1,
    },
    {
      category: 'Stock Purchase',
      transactionType: 'Lego Parts',
      queryFn: queryLegoPartsPurchases,
      signMultiplier: -1,
    },

    // PACKING & POSTAGE
    {
      category: 'Packing & Postage',
      transactionType: 'Postage',
      queryFn: (supabase, userId, startDate, endDate) =>
        queryMonzoByCategory(supabase, userId, startDate, endDate, 'Postage'),
      signMultiplier: -1,
    },
    {
      // Postage bought out of the eBay balance, which never reaches the bank
      // feed — so it is additive to the Monzo Postage row above, not a
      // duplicate of it. £185.79 all-time; £0.00 in Q1 2026/27.
      category: 'Packing & Postage',
      transactionType: 'eBay Postage Labels',
      queryFn: queryEbayShippingLabels,
      signMultiplier: -1,
    },
    {
      category: 'Packing & Postage',
      transactionType: 'Packing Materials',
      queryFn: (supabase, userId, startDate, endDate) =>
        queryMonzoByCategory(supabase, userId, startDate, endDate, 'Packing Materials'),
      signMultiplier: -1,
    },

    // BILLS
    {
      category: 'Bills',
      transactionType: 'Amazon Subscription',
      queryFn: queryAmazonSubscription,
      signMultiplier: -1,
    },
    {
      category: 'Bills',
      transactionType: 'Banking Fees / Subscriptions',
      queryFn: (supabase, userId, startDate, endDate) =>
        queryMonzoByCategory(supabase, userId, startDate, endDate, 'Services'),
      signMultiplier: -1,
    },
    {
      category: 'Bills',
      transactionType: 'Website / Software',
      queryFn: (supabase, userId, startDate, endDate) =>
        queryMonzoByCategory(supabase, userId, startDate, endDate, 'Software'),
      signMultiplier: -1,
    },
    {
      category: 'Bills',
      transactionType: 'Office',
      queryFn: (supabase, userId, startDate, endDate) =>
        queryMonzoByCategory(supabase, userId, startDate, endDate, 'Office Space'),
      signMultiplier: -1,
    },
    {
      category: 'Bills',
      transactionType: 'Mileage',
      queryFn: queryMileage,
      signMultiplier: -1,
    },

    // HOME COSTS
    {
      category: 'Home Costs',
      transactionType: 'Use of Home',
      queryFn: queryHomeCostsUseOfHome,
      signMultiplier: -1,
    },
    {
      category: 'Home Costs',
      transactionType: 'Phone & Broadband',
      queryFn: queryHomeCostsPhoneBroadband,
      signMultiplier: -1,
    },
    {
      category: 'Home Costs',
      transactionType: 'Insurance',
      queryFn: queryHomeCostsInsurance,
      signMultiplier: -1,
    },
  ];
}

// =============================================================================
// MAIN SERVICE CLASS
// =============================================================================

export class ProfitLossReportService {
  constructor(private supabase: SupabaseClient<Database>) {}

  /**
   * Find the earliest date across all relevant tables
   */
  private async findEarliestDate(userId: string): Promise<string> {
    const dates: string[] = [];

    // Query each table separately to avoid type union issues
    const ebayResult = await this.supabase
      .from('ebay_transactions')
      .select('transaction_date')
      .eq('user_id', userId)
      .order('transaction_date', { ascending: true })
      .limit(1);
    if (ebayResult.data?.[0]?.transaction_date) {
      dates.push(ebayResult.data[0].transaction_date);
    }

    const bricklinkResult = await this.supabase
      .from('bricklink_transactions')
      .select('order_date')
      .eq('user_id', userId)
      .order('order_date', { ascending: true })
      .limit(1);
    if (bricklinkResult.data?.[0]?.order_date) {
      dates.push(bricklinkResult.data[0].order_date);
    }

    const amazonResult = await this.supabase
      .from('amazon_transactions')
      .select('posted_date')
      .eq('user_id', userId)
      .order('posted_date', { ascending: true })
      .limit(1);
    if (amazonResult.data?.[0]?.posted_date) {
      dates.push(amazonResult.data[0].posted_date);
    }

    const paypalResult = await this.supabase
      .from('paypal_transactions')
      .select('transaction_date')
      .eq('user_id', userId)
      .order('transaction_date', { ascending: true })
      .limit(1);
    if (paypalResult.data?.[0]?.transaction_date) {
      dates.push(paypalResult.data[0].transaction_date);
    }

    const monzoResult = await this.supabase
      .from('monzo_transactions')
      .select('created')
      .eq('user_id', userId)
      .order('created', { ascending: true })
      .limit(1);
    if (monzoResult.data?.[0]?.created) {
      dates.push(monzoResult.data[0].created);
    }

    const purchasesResult = await this.supabase
      .from('purchases')
      .select('purchase_date')
      .eq('user_id', userId)
      .order('purchase_date', { ascending: true })
      .limit(1);
    if (purchasesResult.data?.[0]?.purchase_date) {
      dates.push(purchasesResult.data[0].purchase_date);
    }

    const mileageResult = await this.supabase
      .from('mileage_tracking')
      .select('tracking_date')
      .eq('user_id', userId)
      .order('tracking_date', { ascending: true })
      .limit(1);
    if (mileageResult.data?.[0]?.tracking_date) {
      dates.push(mileageResult.data[0].tracking_date);
    }

    if (dates.length === 0) {
      // Default to current month if no data
      return formatMonth(new Date());
    }

    // Find earliest date
    const sortedDates = dates.sort();
    return sortedDates[0].substring(0, 7); // Return YYYY-MM
  }

  /**
   * Generate the P&L report
   */
  async generateReport(
    userId: string,
    options: ProfitLossReportOptions = {}
  ): Promise<ProfitLossReport> {
    // Determine date range
    const endMonth = options.endMonth || formatMonth(new Date());
    const startMonth = options.startMonth || (await this.findEarliestDate(userId));

    // Exact-date bounds win over month bounds when supplied (HMRC standard tax
    // periods run 6th–5th, not month-to-month).
    if (options.startDate) assertValidDateBound('startDate', options.startDate);
    if (options.endDateExclusive) {
      assertValidDateBound('endDateExclusive', options.endDateExclusive);
    }
    if (
      options.startDate &&
      options.endDateExclusive &&
      options.startDate >= options.endDateExclusive
    ) {
      throw new Error(
        `startDate '${options.startDate}' must be before endDateExclusive '${options.endDateExclusive}'`
      );
    }
    const startDate = options.startDate ?? getMonthStartDate(startMonth);
    // Exclusive upper bound (first day of the following month) — see
    // getMonthEndExclusive for why the inclusive last-day bound was wrong.
    const endDate = options.endDateExclusive ?? getMonthEndExclusive(endMonth);

    // Month columns must span whatever the effective bounds cover, so a partial
    // first/last month still gets a bucket.
    const effectiveStartMonth = options.startDate ? startDate.substring(0, 7) : startMonth;
    const effectiveEndMonth = options.endDateExclusive
      ? getLastMonthFromExclusiveEndDate(endDate)
      : endMonth;
    const months = generateMonthRange(effectiveStartMonth, effectiveEndMonth);

    const basis = options.basis ?? 'accrual';
    console.log(`[P&L] Generating report for user ${userId} (basis: ${basis})`);
    console.log(
      `[P&L] Date range: ${effectiveStartMonth} to ${effectiveEndMonth} (${startDate} to ${endDate})`
    );
    console.log(`[P&L] Months to include: ${months.length}`);

    // Get all row definitions
    const rowDefinitions = getRowDefinitions(basis);

    // Execute all queries in parallel
    const queryPromises = rowDefinitions.map(async (def) => {
      try {
        const aggregations = await def.queryFn(this.supabase, userId, startDate, endDate);
        return {
          definition: def,
          aggregations,
        };
      } catch (error) {
        console.error(`Error querying ${def.transactionType}:`, error);
        return {
          definition: def,
          aggregations: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });

    const queryResults = await Promise.all(queryPromises);

    // Surface swallowed failures instead of letting them read as £0 — see
    // ProfitLossReport.failedRows.
    const failedRows = queryResults
      .filter((r): r is typeof r & { error: string } => 'error' in r && r.error !== undefined)
      .map((r) => ({ transactionType: r.definition.transactionType, error: r.error }));
    if (failedRows.length > 0) {
      console.error(
        `[P&L] ${failedRows.length} row(s) FAILED and are reported as zero: ` +
          failedRows.map((f) => f.transactionType).join(', ')
      );
    }

    // Build report rows
    const rows: ProfitLossReportRow[] = [];
    const categoryTotals: Record<ProfitLossCategory, Record<string, number>> = {
      Income: {},
      'Selling Fees': {},
      'Stock Purchase': {},
      'Packing & Postage': {},
      Bills: {},
      'Home Costs': {},
    };

    // Initialize category totals for all months
    for (const category of Object.keys(categoryTotals) as ProfitLossCategory[]) {
      for (const month of months) {
        categoryTotals[category][month] = 0;
      }
    }

    for (const result of queryResults) {
      const monthlyValues = toMonthlyValues(result.aggregations, result.definition.signMultiplier);

      // Fill in zeros for missing months
      for (const month of months) {
        if (!(month in monthlyValues)) {
          monthlyValues[month] = 0;
        }
      }

      // Calculate total
      const total = Object.values(monthlyValues).reduce((sum, val) => sum + val, 0);

      // Skip zero rows if option is set
      if (
        !options.includeZeroRows &&
        total === 0 &&
        Object.values(monthlyValues).every((v) => v === 0)
      ) {
        continue;
      }

      rows.push({
        category: result.definition.category,
        transactionType: result.definition.transactionType,
        monthlyValues,
        total,
      });

      // Add to category totals
      for (const month of months) {
        categoryTotals[result.definition.category][month] += monthlyValues[month] || 0;
      }
    }

    // Calculate grand totals
    const grandTotal: Record<string, number> = {};
    for (const month of months) {
      grandTotal[month] = 0;
      for (const category of Object.keys(categoryTotals) as ProfitLossCategory[]) {
        grandTotal[month] += categoryTotals[category][month] || 0;
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      dateRange: {
        startMonth: effectiveStartMonth,
        endMonth: effectiveEndMonth,
      },
      months,
      rows,
      categoryTotals,
      grandTotal,
      failedRows,
    };
  }
}
