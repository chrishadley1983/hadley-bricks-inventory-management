import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { ReportingService } from '@/lib/services';

const ExportParamsSchema = z.object({
  reportType: z.enum([
    'profit-loss',
    'inventory-valuation',
    'inventory-aging',
    'platform-performance',
    'sales-trends',
    'purchase-analysis',
    'tax-summary',
  ]),
  format: z.enum(['csv', 'json']),
  preset: z
    .enum([
      'this_month',
      'last_month',
      'this_quarter',
      'last_quarter',
      'this_year',
      'last_year',
      'last_30_days',
      'last_90_days',
      'custom',
    ])
    .optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  financialYear: z.coerce.number().optional(),
});

/**
 * GET /api/reports/export
 * Export a report in CSV or JSON format
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const parsed = ExportParamsSchema.safeParse(searchParams);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid parameters', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { reportType, format, preset, startDate, endDate, financialYear } = parsed.data;

    const reportingService = new ReportingService(supabase);

    // Get date range from preset or custom dates
    const dateRange = reportingService.getDateRangeFromPreset(
      preset || 'this_month',
      startDate && endDate
        ? { startDate: new Date(startDate), endDate: new Date(endDate) }
        : undefined
    );

    // Default financial year
    const now = new Date();
    const currentMonth = now.getMonth();
    const defaultFinancialYear = currentMonth >= 3 ? now.getFullYear() : now.getFullYear() - 1;

    // Fetch the report data based on type
    let reportData: unknown;
    let filename: string;

    switch (reportType) {
      case 'profit-loss':
        reportData = await reportingService.getProfitLossReport(user.id, dateRange, true);
        filename = `profit-loss-report-${new Date().toISOString().split('T')[0]}`;
        break;
      case 'inventory-valuation':
        reportData = await reportingService.getInventoryValuationReport(user.id);
        filename = `inventory-valuation-report-${new Date().toISOString().split('T')[0]}`;
        break;
      case 'inventory-aging':
        reportData = await reportingService.getInventoryAgingReport(user.id);
        filename = `inventory-aging-report-${new Date().toISOString().split('T')[0]}`;
        break;
      case 'platform-performance':
        reportData = await reportingService.getPlatformPerformanceReport(user.id, dateRange);
        filename = `platform-performance-report-${new Date().toISOString().split('T')[0]}`;
        break;
      case 'sales-trends':
        reportData = await reportingService.getSalesTrendsReport(user.id, dateRange);
        filename = `sales-trends-report-${new Date().toISOString().split('T')[0]}`;
        break;
      case 'purchase-analysis':
        reportData = await reportingService.getPurchaseAnalysisReport(user.id, dateRange);
        filename = `purchase-analysis-report-${new Date().toISOString().split('T')[0]}`;
        break;
      case 'tax-summary': {
        const year = financialYear ?? defaultFinancialYear;
        reportData = await reportingService.getTaxSummaryReport(user.id, year);
        filename = `tax-summary-report-${year}`;
        break;
      }
      default:
        return NextResponse.json({ error: 'Unknown report type' }, { status: 400 });
    }

    if (format === 'json') {
      return new NextResponse(JSON.stringify(reportData, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="${filename}.json"`,
        },
      });
    }

    // Convert to CSV
    const csv = convertToCSV(reportType, reportData);

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}.csv"`,
      },
    });
  } catch (error) {
    console.error('[GET /api/reports/export] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Convert report data to CSV format
 */
function convertToCSV(reportType: string, data: unknown): string {
  const rows: string[][] = [];

  switch (reportType) {
    case 'profit-loss': {
      const report = data as {
        currentPeriod: {
          totalRevenue: number;
          totalCostOfGoods: number;
          totalFees: number;
          totalShippingCosts: number;
          totalOtherCosts: number;
          grossProfit: number;
          profitMargin: number;
          totalSales: number;
        };
      };
      rows.push(['Metric', 'Value']);
      rows.push(['Total Revenue', report.currentPeriod.totalRevenue.toString()]);
      rows.push(['Cost of Goods', report.currentPeriod.totalCostOfGoods.toString()]);
      rows.push(['Platform Fees', report.currentPeriod.totalFees.toString()]);
      rows.push(['Shipping Costs', report.currentPeriod.totalShippingCosts.toString()]);
      rows.push(['Other Costs', report.currentPeriod.totalOtherCosts.toString()]);
      rows.push(['Gross Profit', report.currentPeriod.grossProfit.toString()]);
      rows.push(['Profit Margin %', report.currentPeriod.profitMargin.toFixed(2)]);
      rows.push(['Total Sales', report.currentPeriod.totalSales.toString()]);
      break;
    }
    case 'inventory-valuation': {
      const report = data as {
        items: Array<{
          itemNumber: string;
          itemName: string;
          condition: string;
          quantity: number;
          unitCost: number;
          totalCost: number;
          estimatedValue: number;
          potentialProfit: number;
        }>;
      };
      rows.push([
        'Item Number',
        'Item Name',
        'Condition',
        'Quantity',
        'Unit Cost',
        'Total Cost',
        'Est. Value',
        'Potential Profit',
      ]);
      for (const item of report.items) {
        rows.push([
          item.itemNumber,
          item.itemName,
          item.condition,
          item.quantity.toString(),
          item.unitCost.toFixed(2),
          item.totalCost.toFixed(2),
          item.estimatedValue.toFixed(2),
          item.potentialProfit.toFixed(2),
        ]);
      }
      break;
    }
    case 'inventory-aging': {
      const report = data as {
        ageBrackets: Array<{
          bracket: string;
          itemCount: number;
          totalValue: number;
          averageDaysInStock: number;
        }>;
      };
      rows.push(['Age Bracket', 'Item Count', 'Total Value', 'Avg Days in Stock']);
      for (const bracket of report.ageBrackets) {
        rows.push([
          bracket.bracket,
          bracket.itemCount.toString(),
          bracket.totalValue.toFixed(2),
          bracket.averageDaysInStock.toFixed(0),
        ]);
      }
      break;
    }
    case 'platform-performance': {
      const report = data as {
        platforms: Array<{
          platform: string;
          totalSales: number;
          totalRevenue: number;
          totalProfit: number;
          profitMargin: number;
          averageOrderValue: number;
          totalFees: number;
        }>;
      };
      rows.push([
        'Platform',
        'Total Sales',
        'Revenue',
        'Profit',
        'Margin %',
        'Avg Order Value',
        'Total Fees',
      ]);
      for (const platform of report.platforms) {
        rows.push([
          platform.platform,
          platform.totalSales.toString(),
          platform.totalRevenue.toFixed(2),
          platform.totalProfit.toFixed(2),
          platform.profitMargin.toFixed(2),
          platform.averageOrderValue.toFixed(2),
          platform.totalFees.toFixed(2),
        ]);
      }
      break;
    }
    case 'sales-trends': {
      const report = data as {
        trendData: Array<{
          period: string;
          sales: number;
          revenue: number;
          profit: number;
        }>;
      };
      rows.push(['Period', 'Sales', 'Revenue', 'Profit']);
      for (const point of report.trendData) {
        rows.push([
          point.period,
          point.sales.toString(),
          point.revenue.toFixed(2),
          point.profit.toFixed(2),
        ]);
      }
      break;
    }
    case 'purchase-analysis': {
      const report = data as {
        purchases: Array<{
          purchaseId: string;
          purchaseDate: string;
          source: string;
          totalCost: number;
          itemsSold: number;
          revenue: number;
          profit: number;
          roi: number;
        }>;
      };
      rows.push([
        'Purchase ID',
        'Date',
        'Source',
        'Total Cost',
        'Items Sold',
        'Revenue',
        'Profit',
        'ROI %',
      ]);
      for (const purchase of report.purchases) {
        rows.push([
          purchase.purchaseId,
          purchase.purchaseDate,
          purchase.source,
          purchase.totalCost.toFixed(2),
          purchase.itemsSold.toString(),
          purchase.revenue.toFixed(2),
          purchase.profit.toFixed(2),
          purchase.roi.toFixed(2),
        ]);
      }
      break;
    }
    case 'tax-summary': {
      const report = data as {
        financialYear: string;
        totalTurnover: number;
        totalExpenses: number;
        netProfit: number;
        mileageDeduction: number;
      };
      rows.push(['Metric', 'Value']);
      rows.push(['Financial Year', report.financialYear]);
      rows.push(['Total Turnover', report.totalTurnover.toFixed(2)]);
      rows.push(['Total Expenses', report.totalExpenses.toFixed(2)]);
      rows.push(['Net Profit', report.netProfit.toFixed(2)]);
      rows.push(['Mileage Deduction', report.mileageDeduction.toFixed(2)]);
      break;
    }
    default:
      rows.push(['Error', 'Unknown report type']);
  }

  // Convert rows to CSV string
  return rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
}
