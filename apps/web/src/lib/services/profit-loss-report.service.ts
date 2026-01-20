/**
 * Profit & Loss Report Service
 *
 * Generates a configurable monthly P&L report aggregating financial data
 * across all platforms (eBay, BrickLink, Amazon) and expense categories.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';

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
  | 'Bills';

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
}

/**
 * Options for generating the report
 */
export interface ProfitLossReportOptions {
  startMonth?: string; // 'YYYY-MM', defaults to earliest data
  endMonth?: string; // 'YYYY-MM', defaults to current month
  includeZeroRows?: boolean; // Include rows with all zero values
}

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
 * Get last day of month from YYYY-MM string
 */
function getMonthEndDate(month: string): string {
  const [year, monthNum] = month.split('-').map(Number);
  const lastDay = new Date(year, monthNum, 0).getDate();
  return `${month}-${String(lastDay).padStart(2, '0')}`;
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

  while (
    currentYear < endYear ||
    (currentYear === endYear && currentMonth <= endMonthNum)
  ) {
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
// QUERY FUNCTIONS
// =============================================================================

/**
 * Query eBay Gross Sales (from ebay_orders by creation_date, fulfilled orders only)
 */
async function queryEbayGrossSales(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string
): Promise<MonthlyAggregation[]> {
  // Paginate to handle Supabase's 1000 row limit
  const pageSize = 1000;
  let page = 0;
  let hasMore = true;
  const allData: { creation_date: string | null; total_fee_basis_amount: number | null }[] = [];

  while (hasMore) {
    const { data, error } = await supabase
      .from('ebay_orders')
      .select('creation_date, total_fee_basis_amount')
      .eq('user_id', userId)
      .eq('order_fulfilment_status', 'FULFILLED')
      .in('order_payment_status', ['PAID', 'PARTIALLY_REFUNDED'])
      .gte('creation_date', startDate)
      .lte('creation_date', endDate)
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) throw error;

    allData.push(...(data || []));
    hasMore = (data?.length || 0) === pageSize;
    page++;
  }

  console.log(`[P&L] eBay Gross Sales: found ${allData.length} orders (${page} pages)`);

  // Aggregate in memory
  const monthMap = new Map<string, number>();
  for (const row of allData) {
    if (!row.creation_date) continue;
    const month = row.creation_date.substring(0, 7);
    monthMap.set(month, (monthMap.get(month) || 0) + Number(row.total_fee_basis_amount || 0));
  }

  // Debug: Log Oct 2025 specifically
  if (monthMap.has('2025-10')) {
    console.log(`[P&L] eBay Gross Sales Oct 2025: £${monthMap.get('2025-10')?.toFixed(2)}`);
  }

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
  // Paginate to handle Supabase's 1000 row limit
  const pageSize = 1000;
  let page = 0;
  let hasMore = true;
  const allData: { transaction_date: string; amount: number | null }[] = [];

  while (hasMore) {
    const { data, error } = await supabase
      .from('ebay_transactions')
      .select('transaction_date, amount')
      .eq('user_id', userId)
      .eq('transaction_type', 'REFUND')
      .eq('booking_entry', 'DEBIT')
      .gte('transaction_date', startDate)
      .lte('transaction_date', endDate)
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) throw error;

    allData.push(...(data || []));
    hasMore = (data?.length || 0) === pageSize;
    page++;
  }

  const monthMap = new Map<string, number>();
  for (const row of allData) {
    const month = row.transaction_date.substring(0, 7);
    monthMap.set(month, (monthMap.get(month) || 0) + Number(row.amount || 0));
  }

  return Array.from(monthMap.entries()).map(([month, total]) => ({
    month,
    total,
  }));
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
  // BrickLink stores statuses in UPPERCASE
  // PURGED = orders older than 6 months that have been archived by BrickLink
  const completedStatuses = ['COMPLETED', 'RECEIVED', 'SHIPPED', 'PACKED', 'READY', 'PAID', 'PURGED'];

  // Paginate to handle Supabase's 1000 row limit
  const pageSize = 1000;
  let page = 0;
  let hasMore = true;
  const allData: { order_date: string; base_grand_total: number | null }[] = [];

  while (hasMore) {
    const { data, error } = await supabase
      .from('bricklink_transactions')
      .select('order_date, base_grand_total')
      .eq('user_id', userId)
      .in('order_status', completedStatuses)
      .gte('order_date', startDate)
      .lte('order_date', endDate)
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) throw error;

    allData.push(...(data || []));
    hasMore = (data?.length || 0) === pageSize;
    page++;
  }

  console.log(`[P&L] BrickLink Gross Sales: found ${allData.length} orders (${page} pages)`);

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
  // Brick Owl stores statuses in Title Case
  const completedStatuses = ['Shipped', 'Received', 'Completed'];

  // Paginate to handle Supabase's 1000 row limit
  const pageSize = 1000;
  let page = 0;
  let hasMore = true;
  const allData: { order_date: string; base_grand_total: number | null }[] = [];

  while (hasMore) {
    const { data, error } = await supabase
      .from('brickowl_transactions')
      .select('order_date, base_grand_total')
      .eq('user_id', userId)
      .in('order_status', completedStatuses)
      .gte('order_date', startDate)
      .lte('order_date', endDate)
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) throw error;

    allData.push(...(data || []));
    hasMore = (data?.length || 0) === pageSize;
    page++;
  }

  console.log(`[P&L] BrickOwl Gross Sales: found ${allData.length} orders (${page} pages)`);

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
 * Query Amazon Sales (from platform_orders by order_date, shipped only)
 */
async function queryAmazonSales(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string
): Promise<MonthlyAggregation[]> {
  // Paginate to handle Supabase's 1000 row limit
  const pageSize = 1000;
  let page = 0;
  let hasMore = true;
  const allData: { order_date: string | null; total: number | null }[] = [];

  while (hasMore) {
    const { data, error } = await supabase
      .from('platform_orders')
      .select('order_date, total')
      .eq('user_id', userId)
      .eq('platform', 'amazon')
      .eq('status', 'Shipped')
      .gte('order_date', startDate)
      .lte('order_date', endDate)
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) throw error;

    allData.push(...(data || []));
    hasMore = (data?.length || 0) === pageSize;
    page++;
  }

  console.log(`[P&L] Amazon Sales: found ${allData.length} orders (${page} pages)`);

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
  // Paginate to handle Supabase's 1000 row limit
  const pageSize = 1000;
  let page = 0;
  let hasMore = true;
  const allData: { posted_date: string; total_amount: number | null }[] = [];

  while (hasMore) {
    const { data, error } = await supabase
      .from('amazon_transactions')
      .select('posted_date, total_amount')
      .eq('user_id', userId)
      .in('transaction_type', ['Refund', 'GuaranteeClaimRefund'])
      .gte('posted_date', startDate)
      .lte('posted_date', endDate)
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) throw error;

    allData.push(...(data || []));
    hasMore = (data?.length || 0) === pageSize;
    page++;
  }

  const monthMap = new Map<string, number>();
  for (const row of allData) {
    const month = row.posted_date.substring(0, 7);
    // Amazon refunds are already negative in the database
    monthMap.set(month, (monthMap.get(month) || 0) + Math.abs(Number(row.total_amount || 0)));
  }

  return Array.from(monthMap.entries()).map(([month, total]) => ({
    month,
    total,
  }));
}

/**
 * Query Monzo transactions by local_category with pagination to handle >1000 rows
 */
async function queryMonzoByCategory(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string,
  localCategory: string
): Promise<MonthlyAggregation[]> {
  // Paginate to handle Supabase's 1000 row limit
  const pageSize = 1000;
  let page = 0;
  let hasMore = true;
  const allData: { created: string; amount: number }[] = [];

  while (hasMore) {
    const { data, error } = await supabase
      .from('monzo_transactions')
      .select('created, amount')
      .eq('user_id', userId)
      .eq('local_category', localCategory)
      .lt('amount', 0) // Only spending (negative amounts)
      .gte('created', startDate)
      .lte('created', endDate)
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) throw error;

    allData.push(...(data || []));
    hasMore = (data?.length || 0) === pageSize;
    page++;
  }

  // Debug logging for Postage
  if (localCategory === 'Postage') {
    console.log(`[P&L] Postage query: ${startDate} to ${endDate}, found ${allData.length} records (${page} pages)`);
    if (allData.length > 0) {
      console.log(`[P&L] Sample Postage record:`, allData[0]);
    }
  }

  const monthMap = new Map<string, number>();
  for (const row of allData) {
    const month = row.created.substring(0, 7);
    // Convert from pence to pounds and make positive
    const amountPounds = Math.abs(Number(row.amount || 0)) / 100;
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
 * Query Amazon Fees (total_fees for RELEASED Shipment transactions)
 */
async function queryAmazonFees(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string
): Promise<MonthlyAggregation[]> {
  // Paginate to handle Supabase's 1000 row limit
  const pageSize = 1000;
  let page = 0;
  let hasMore = true;
  const allData: { posted_date: string | null; total_fees: number | null }[] = [];

  while (hasMore) {
    const { data, error } = await supabase
      .from('amazon_transactions')
      .select('posted_date, total_fees')
      .eq('user_id', userId)
      .eq('transaction_type', 'Shipment')
      .eq('transaction_status', 'RELEASED')
      .gte('posted_date', startDate)
      .lte('posted_date', endDate)
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) throw error;

    allData.push(...(data || []));
    hasMore = (data?.length || 0) === pageSize;
    page++;
  }

  const monthMap = new Map<string, number>();
  for (const row of allData) {
    if (!row.posted_date) continue;
    const month = row.posted_date.substring(0, 7);
    monthMap.set(month, (monthMap.get(month) || 0) + Math.abs(Number(row.total_fees || 0)));
  }

  return Array.from(monthMap.entries()).map(([month, total]) => ({
    month,
    total,
  }));
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
  // Paginate to handle Supabase's 1000 row limit
  const pageSize = 1000;
  let page = 0;
  let hasMore = true;
  type EbayFeeRow = { transaction_date: string; amount: number | null; raw_response: unknown };
  const allData: EbayFeeRow[] = [];

  while (hasMore) {
    const { data, error } = await supabase
      .from('ebay_transactions')
      .select('transaction_date, amount, raw_response')
      .eq('user_id', userId)
      .eq('transaction_type', 'NON_SALE_CHARGE')
      .eq('booking_entry', 'DEBIT')
      .gte('transaction_date', startDate)
      .lte('transaction_date', endDate)
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) throw error;

    allData.push(...(data || []));
    hasMore = (data?.length || 0) === pageSize;
    page++;
  }

  const monthMap = new Map<string, number>();
  for (const row of allData) {
    const rawResponse = row.raw_response as { feeType?: string } | null;
    if (rawResponse?.feeType === feeType) {
      const month = row.transaction_date.substring(0, 7);
      monthMap.set(month, (monthMap.get(month) || 0) + Math.abs(Number(row.amount || 0)));
    }
  }

  return Array.from(monthMap.entries()).map(([month, total]) => ({
    month,
    total,
  }));
}

/**
 * Helper to query eBay SALE transaction fees by fee type with pagination
 */
async function queryEbaySaleFeesByType(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string,
  feeType: string
): Promise<MonthlyAggregation[]> {
  // Paginate to handle Supabase's 1000 row limit
  const pageSize = 1000;
  let page = 0;
  let hasMore = true;
  type EbaySaleRow = { transaction_date: string; raw_response: unknown };
  const allData: EbaySaleRow[] = [];

  while (hasMore) {
    const { data, error } = await supabase
      .from('ebay_transactions')
      .select('transaction_date, raw_response')
      .eq('user_id', userId)
      .eq('transaction_type', 'SALE')
      .eq('booking_entry', 'CREDIT')
      .gte('transaction_date', startDate)
      .lte('transaction_date', endDate)
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) throw error;

    allData.push(...(data || []));
    hasMore = (data?.length || 0) === pageSize;
    page++;
  }

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
  const pageSize = 1000;

  // Get AD_FEE charges with pagination
  type ChargeRow = { transaction_date: string; amount: number | null; raw_response: unknown };
  let chargePage = 0;
  let chargeHasMore = true;
  const allCharges: ChargeRow[] = [];

  while (chargeHasMore) {
    const { data, error } = await supabase
      .from('ebay_transactions')
      .select('transaction_date, amount, raw_response')
      .eq('user_id', userId)
      .eq('transaction_type', 'NON_SALE_CHARGE')
      .eq('booking_entry', 'DEBIT')
      .gte('transaction_date', startDate)
      .lte('transaction_date', endDate)
      .range(chargePage * pageSize, (chargePage + 1) * pageSize - 1);

    if (error) throw error;
    allCharges.push(...(data || []));
    chargeHasMore = (data?.length || 0) === pageSize;
    chargePage++;
  }

  // Get fee refunds (CREDIT entries) with pagination
  type RefundRow = { transaction_date: string; amount: number | null };
  let refundPage = 0;
  let refundHasMore = true;
  const allRefunds: RefundRow[] = [];

  while (refundHasMore) {
    const { data, error } = await supabase
      .from('ebay_transactions')
      .select('transaction_date, amount')
      .eq('user_id', userId)
      .eq('transaction_type', 'NON_SALE_CHARGE')
      .eq('booking_entry', 'CREDIT')
      .gte('transaction_date', startDate)
      .lte('transaction_date', endDate)
      .range(refundPage * pageSize, (refundPage + 1) * pageSize - 1);

    if (error) throw error;
    allRefunds.push(...(data || []));
    refundHasMore = (data?.length || 0) === pageSize;
    refundPage++;
  }

  const monthMap = new Map<string, number>();

  // Add AD_FEE charges
  for (const row of allCharges) {
    const rawResponse = row.raw_response as { feeType?: string } | null;
    if (rawResponse?.feeType === 'AD_FEE') {
      const month = row.transaction_date.substring(0, 7);
      monthMap.set(month, (monthMap.get(month) || 0) + Math.abs(Number(row.amount || 0)));
    }
  }

  // Subtract fee refunds
  for (const row of allRefunds) {
    const month = row.transaction_date.substring(0, 7);
    monthMap.set(month, (monthMap.get(month) || 0) - Math.abs(Number(row.amount || 0)));
  }

  return Array.from(monthMap.entries()).map(([month, total]) => ({
    month,
    total: Math.max(0, total), // Ensure non-negative
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
  return queryEbaySaleFeesByType(supabase, userId, startDate, endDate, 'FINAL_VALUE_FEE_FIXED_PER_ORDER');
}

/**
 * Query eBay Shop Fee (monthly subscription - OTHER_FEES with date range memo)
 */
async function queryEbayShopFee(
  supabase: SupabaseClient<Database>,
  userId: string,
  startDate: string,
  endDate: string
): Promise<MonthlyAggregation[]> {
  const pageSize = 1000;
  let page = 0;
  let hasMore = true;
  type ShopFeeRow = { transaction_date: string; amount: number | null; raw_response: unknown };
  const allData: ShopFeeRow[] = [];

  while (hasMore) {
    const { data, error } = await supabase
      .from('ebay_transactions')
      .select('transaction_date, amount, raw_response')
      .eq('user_id', userId)
      .eq('transaction_type', 'NON_SALE_CHARGE')
      .eq('booking_entry', 'DEBIT')
      .gte('transaction_date', startDate)
      .lte('transaction_date', endDate)
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) throw error;
    allData.push(...(data || []));
    hasMore = (data?.length || 0) === pageSize;
    page++;
  }

  // Date range pattern: YYYY-MM-DD - YYYY-MM-DD
  const dateRangePattern = /^\d{4}-\d{2}-\d{2} - \d{4}-\d{2}-\d{2}$/;

  const monthMap = new Map<string, number>();
  for (const row of allData) {
    const rawResponse = row.raw_response as { feeType?: string; transactionMemo?: string } | null;
    if (
      rawResponse?.feeType === 'OTHER_FEES' &&
      rawResponse?.transactionMemo &&
      dateRangePattern.test(rawResponse.transactionMemo)
    ) {
      const month = row.transaction_date.substring(0, 7);
      monthMap.set(month, (monthMap.get(month) || 0) + Math.abs(Number(row.amount || 0)));
    }
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
  // Use the generic Monzo category query with pagination
  return queryMonzoByCategory(supabase, userId, startDate, endDate, 'Lego Stock');
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
  // Use the generic Monzo category query with pagination
  return queryMonzoByCategory(supabase, userId, startDate, endDate, 'Lego Parts');
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
  const pageSize = 1000;
  let page = 0;
  let hasMore = true;
  type AmazonSubRow = { posted_date: string; total_amount: number | null };
  const allData: AmazonSubRow[] = [];

  while (hasMore) {
    const { data, error } = await supabase
      .from('amazon_transactions')
      .select('posted_date, total_amount')
      .eq('user_id', userId)
      .eq('transaction_type', 'ServiceFee')
      .gte('posted_date', startDate)
      .lte('posted_date', endDate)
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) throw error;
    allData.push(...(data || []));
    hasMore = (data?.length || 0) === pageSize;
    page++;
  }

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
  const pageSize = 1000;
  let page = 0;
  let hasMore = true;
  type MileageRow = { tracking_date: string; amount_claimed: number | null };
  const allData: MileageRow[] = [];

  while (hasMore) {
    const { data, error } = await supabase
      .from('mileage_tracking')
      .select('tracking_date, amount_claimed')
      .eq('user_id', userId)
      .gte('tracking_date', startDate)
      .lte('tracking_date', endDate)
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) throw error;
    allData.push(...(data || []));
    hasMore = (data?.length || 0) === pageSize;
    page++;
  }

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

// =============================================================================
// ROW DEFINITIONS
// =============================================================================

/**
 * All row definitions for the P&L report
 */
function getRowDefinitions(): RowDefinition[] {
  return [
    // INCOME
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
      transactionType: 'Website',
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

    const startDate = getMonthStartDate(startMonth);
    const endDate = getMonthEndDate(endMonth);
    const months = generateMonthRange(startMonth, endMonth);

    console.log(`[P&L] Generating report for user ${userId}`);
    console.log(`[P&L] Date range: ${startMonth} to ${endMonth} (${startDate} to ${endDate})`);
    console.log(`[P&L] Months to include: ${months.length}`);

    // Get all row definitions
    const rowDefinitions = getRowDefinitions();

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
        };
      }
    });

    const queryResults = await Promise.all(queryPromises);

    // Build report rows
    const rows: ProfitLossReportRow[] = [];
    const categoryTotals: Record<ProfitLossCategory, Record<string, number>> = {
      Income: {},
      'Selling Fees': {},
      'Stock Purchase': {},
      'Packing & Postage': {},
      Bills: {},
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
      if (!options.includeZeroRows && total === 0 && Object.values(monthlyValues).every((v) => v === 0)) {
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
        startMonth,
        endMonth,
      },
      months,
      rows,
      categoryTotals,
      grandTotal,
    };
  }
}
