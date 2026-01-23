/**
 * MTD Export Service
 *
 * Transforms P&L report data into QuickFile-compatible formats for
 * MTD (Making Tax Digital) compliance. Supports CSV export and QuickFile API push.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { ProfitLossReportService, type ProfitLossReport } from './profit-loss-report.service';
import {
  type MtdSalesRow,
  type MtdExpenseRow,
  type MtdCsvData,
  type MtdExportHistoryEntry,
  type MtdExportPreview,
  QUICKFILE_NOMINAL_CODES,
  PLATFORM_REFERENCE_NAMES,
} from '@/types/mtd-export';

/**
 * Get the last day of a month
 */
function getLastDayOfMonth(month: string): string {
  const [year, monthNum] = month.split('-').map(Number);
  const lastDay = new Date(year, monthNum, 0).getDate();
  return `${month}-${String(lastDay).padStart(2, '0')}`;
}

/**
 * Format month for display (e.g., "January 2026")
 */
function formatMonthLabel(month: string): string {
  const [year, monthNum] = month.split('-').map(Number);
  const date = new Date(year, monthNum - 1);
  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

/**
 * Format period label for display
 */
function formatPeriodLabel(startMonth: string, endMonth: string): string {
  if (startMonth === endMonth) {
    return formatMonthLabel(startMonth);
  }
  return `${formatMonthLabel(startMonth)} to ${formatMonthLabel(endMonth)}`;
}

/**
 * Generate all months between start and end (inclusive)
 */
function getMonthsInRange(startMonth: string, endMonth: string): string[] {
  const months: string[] = [];
  const [startYear, startMonthNum] = startMonth.split('-').map(Number);
  const [endYear, endMonthNum] = endMonth.split('-').map(Number);

  let year = startYear;
  let monthNum = startMonthNum;

  while (year < endYear || (year === endYear && monthNum <= endMonthNum)) {
    months.push(`${year}-${String(monthNum).padStart(2, '0')}`);
    monthNum++;
    if (monthNum > 12) {
      monthNum = 1;
      year++;
    }
  }

  return months;
}

/**
 * Service for MTD (Making Tax Digital) exports
 */
export class MtdExportService {
  private profitLossService: ProfitLossReportService;

  constructor(private supabase: SupabaseClient<Database>) {
    this.profitLossService = new ProfitLossReportService(supabase);
  }

  /**
   * Generate CSV data for a period (start to end month inclusive)
   */
  async generateCsvData(userId: string, startMonth: string, endMonth?: string): Promise<MtdCsvData> {
    const effectiveEndMonth = endMonth || startMonth;

    // Get P&L data for the period
    const report = await this.profitLossService.generateReport(userId, {
      startMonth,
      endMonth: effectiveEndMonth,
    });

    const allSales: MtdSalesRow[] = [];
    const allExpenses: MtdExpenseRow[] = [];

    // Get all months in the range
    const months = getMonthsInRange(startMonth, effectiveEndMonth);

    // Build sales and expense rows for each month in the range
    for (const month of months) {
      const lastDayOfMonth = getLastDayOfMonth(month);
      const monthLabel = formatMonthLabel(month);

      const monthSales = this.buildSalesRows(report, month, lastDayOfMonth, monthLabel);
      const monthExpenses = this.buildExpenseRows(report, month, lastDayOfMonth, monthLabel);

      allSales.push(...monthSales);
      allExpenses.push(...monthExpenses);
    }

    return {
      sales: allSales,
      expenses: allExpenses,
      month: startMonth,
      lastDayOfMonth: getLastDayOfMonth(effectiveEndMonth),
    };
  }

  /**
   * Build sales rows from P&L income data
   */
  private buildSalesRows(
    report: ProfitLossReport,
    month: string,
    lastDay: string,
    monthLabel: string
  ): MtdSalesRow[] {
    const sales: MtdSalesRow[] = [];

    // Group income rows by platform
    const platformTotals: Record<string, number> = {
      ebay: 0,
      amazon: 0,
      bricklink: 0,
      brickowl: 0,
    };

    for (const row of report.rows) {
      if (row.category !== 'Income') continue;

      const value = row.monthlyValues[month] || 0;
      if (value === 0) continue;

      // Map transaction types to platforms
      if (row.transactionType.toLowerCase().includes('ebay')) {
        platformTotals.ebay += value;
      } else if (row.transactionType.toLowerCase().includes('amazon')) {
        platformTotals.amazon += value;
      } else if (row.transactionType.toLowerCase().includes('bricklink')) {
        platformTotals.bricklink += value;
      } else if (row.transactionType.toLowerCase().includes('brick owl') || row.transactionType.toLowerCase().includes('brickowl')) {
        platformTotals.brickowl += value;
      }
    }

    // Create sales rows for platforms with positive sales
    for (const [platform, amount] of Object.entries(platformTotals)) {
      if (amount <= 0) continue;

      const reference = PLATFORM_REFERENCE_NAMES[platform] || platform.toUpperCase();
      const displayName = this.getPlatformDisplayName(platform);

      sales.push({
        date: lastDay,
        reference: `${reference}-${month.replace('-', '')}`,
        description: `${displayName} Sales - ${monthLabel}`,
        netAmount: Math.round(amount * 100) / 100,
        vat: 0,
        grossAmount: Math.round(amount * 100) / 100,
        nominalCode: QUICKFILE_NOMINAL_CODES.SALES,
      });
    }

    return sales;
  }

  /**
   * Build expense rows from P&L expense categories
   */
  private buildExpenseRows(
    report: ProfitLossReport,
    month: string,
    lastDay: string,
    monthLabel: string
  ): MtdExpenseRow[] {
    const expenses: MtdExpenseRow[] = [];

    // Aggregate expenses by nominal code category
    const categoryAggregates: Record<string, { total: number; nominalCode: string; description: string; supplier: string }> = {
      stockPurchase: {
        total: 0,
        nominalCode: QUICKFILE_NOMINAL_CODES.COST_OF_GOODS_SOLD,
        description: `Stock Purchase - ${monthLabel}`,
        supplier: 'Various',
      },
      sellingFees: {
        total: 0,
        nominalCode: QUICKFILE_NOMINAL_CODES.SELLING_FEES,
        description: `Selling Fees - ${monthLabel}`,
        supplier: 'Various',
      },
      postage: {
        total: 0,
        nominalCode: QUICKFILE_NOMINAL_CODES.POSTAGE_CARRIAGE,
        description: `Packing & Postage - ${monthLabel}`,
        supplier: 'Various',
      },
      mileage: {
        total: 0,
        nominalCode: QUICKFILE_NOMINAL_CODES.TRAVEL_MOTOR,
        description: `Travel - Motor - ${monthLabel}`,
        supplier: 'HMRC',
      },
      homeCosts: {
        total: 0,
        nominalCode: QUICKFILE_NOMINAL_CODES.USE_OF_HOME,
        description: `Use of Home - ${monthLabel}`,
        supplier: 'HMRC',
      },
      software: {
        total: 0,
        nominalCode: QUICKFILE_NOMINAL_CODES.SOFTWARE_IT,
        description: `Software & IT - ${monthLabel}`,
        supplier: 'Various',
      },
      other: {
        total: 0,
        nominalCode: QUICKFILE_NOMINAL_CODES.SUNDRY_EXPENSES,
        description: `Sundry Expenses - ${monthLabel}`,
        supplier: 'Various',
      },
    };

    for (const row of report.rows) {
      const value = Math.abs(row.monthlyValues[month] || 0);
      if (value === 0) continue;

      // Map P&L categories to expense aggregates
      switch (row.category) {
        case 'Stock Purchase':
          categoryAggregates.stockPurchase.total += value;
          break;
        case 'Selling Fees':
          categoryAggregates.sellingFees.total += value;
          break;
        case 'Packing & Postage':
          categoryAggregates.postage.total += value;
          break;
        case 'Home Costs':
          categoryAggregates.homeCosts.total += value;
          break;
        case 'Bills':
          // Map Bills subcategories
          if (row.transactionType.toLowerCase().includes('mileage')) {
            categoryAggregates.mileage.total += value;
          } else if (
            row.transactionType.toLowerCase().includes('website') ||
            row.transactionType.toLowerCase().includes('software')
          ) {
            categoryAggregates.software.total += value;
          } else {
            // Amazon subscription, Banking fees go to sundry
            categoryAggregates.other.total += value;
          }
          break;
      }
    }

    // Create expense rows for categories with amounts
    const referenceMap: Record<string, string> = {
      stockPurchase: 'STOCK',
      sellingFees: 'FEES',
      postage: 'POSTAGE',
      mileage: 'MILEAGE',
      homeCosts: 'HOME',
      software: 'SOFTWARE',
      other: 'OTHER',
    };

    for (const [key, data] of Object.entries(categoryAggregates)) {
      if (data.total <= 0) continue;

      const roundedAmount = Math.round(data.total * 100) / 100;

      expenses.push({
        date: lastDay,
        reference: `${referenceMap[key]}-${month.replace('-', '')}`,
        supplier: data.supplier,
        description: data.description,
        netAmount: roundedAmount,
        vat: 0,
        grossAmount: roundedAmount,
        nominalCode: data.nominalCode,
      });
    }

    return expenses;
  }

  /**
   * Get platform display name
   */
  private getPlatformDisplayName(platform: string): string {
    const names: Record<string, string> = {
      ebay: 'eBay',
      amazon: 'Amazon',
      bricklink: 'BrickLink',
      brickowl: 'Brick Owl',
    };
    return names[platform] || platform;
  }

  /**
   * Generate CSV content for sales
   */
  generateSalesCsv(data: MtdCsvData): string {
    const headers = ['Date', 'Reference', 'Description', 'Net Amount', 'VAT', 'Gross Amount', 'Nominal Code'];
    const rows = data.sales.map((row) => [
      row.date,
      row.reference,
      row.description,
      row.netAmount.toFixed(2),
      row.vat.toFixed(2),
      row.grossAmount.toFixed(2),
      row.nominalCode,
    ]);

    return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
  }

  /**
   * Generate CSV content for expenses
   */
  generateExpensesCsv(data: MtdCsvData): string {
    const headers = ['Date', 'Reference', 'Supplier', 'Description', 'Net Amount', 'VAT', 'Gross Amount', 'Nominal Code'];
    const rows = data.expenses.map((row) => [
      row.date,
      row.reference,
      row.supplier,
      row.description,
      row.netAmount.toFixed(2),
      row.vat.toFixed(2),
      row.grossAmount.toFixed(2),
      row.nominalCode,
    ]);

    return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
  }

  /**
   * Generate export preview for confirmation dialog
   */
  async generateExportPreview(
    userId: string,
    startMonth: string,
    endMonth?: string
  ): Promise<MtdExportPreview> {
    const effectiveEndMonth = endMonth || startMonth;
    const csvData = await this.generateCsvData(userId, startMonth, effectiveEndMonth);

    // Check for previous QuickFile export (check start month as the key)
    const previousExport = await this.getQuickFileExportHistory(userId, startMonth);

    const salesTotal = csvData.sales.reduce((sum, row) => sum + row.netAmount, 0);
    const expensesTotal = csvData.expenses.reduce((sum, row) => sum + row.netAmount, 0);

    return {
      month: startMonth,
      monthLabel: formatPeriodLabel(startMonth, effectiveEndMonth),
      salesCount: csvData.sales.length,
      salesTotal: Math.round(salesTotal * 100) / 100,
      expensesCount: csvData.expenses.length,
      expensesTotal: Math.round(expensesTotal * 100) / 100,
      previousExport: previousExport.exported
        ? {
            exportedAt: previousExport.exportedAt!,
            exportType: 'quickfile',
          }
        : undefined,
    };
  }

  /**
   * Log an export to history
   */
  async logExport(
    userId: string,
    month: string,
    exportType: 'csv' | 'quickfile',
    entriesCount: number,
    quickfileResponse?: Record<string, unknown>
  ): Promise<void> {
    const { error } = await this.supabase.from('mtd_export_history').insert({
      user_id: userId,
      month,
      export_type: exportType,
      entries_count: entriesCount,
      quickfile_response: quickfileResponse as unknown as Record<string, never> | null,
    });

    if (error) {
      console.error('[MtdExportService] Failed to log export:', error);
      throw new Error(`Failed to log export: ${error.message}`);
    }
  }

  /**
   * Check if month was already exported to QuickFile
   */
  async getQuickFileExportHistory(
    userId: string,
    month: string
  ): Promise<{ exported: boolean; exportedAt?: string }> {
    const { data, error } = await this.supabase
      .from('mtd_export_history')
      .select('created_at')
      .eq('user_id', userId)
      .eq('month', month)
      .eq('export_type', 'quickfile')
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      console.error('[MtdExportService] Failed to get export history:', error);
      return { exported: false };
    }

    if (data && data.length > 0) {
      return {
        exported: true,
        exportedAt: data[0].created_at ?? undefined,
      };
    }

    return { exported: false };
  }

  /**
   * Get all export history for a user
   */
  async getExportHistory(userId: string, limit = 20): Promise<MtdExportHistoryEntry[]> {
    const { data, error } = await this.supabase
      .from('mtd_export_history')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[MtdExportService] Failed to get export history:', error);
      return [];
    }

    return (data || []).map((row) => ({
      id: row.id,
      userId: row.user_id,
      month: row.month,
      exportType: row.export_type as 'csv' | 'quickfile',
      entriesCount: row.entries_count,
      quickfileResponse: row.quickfile_response as Record<string, unknown> | undefined,
      createdAt: row.created_at ?? undefined,
    }));
  }
}
