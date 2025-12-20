'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download, Loader2, FileText, Car, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { StatCard, BarChart } from '@/components/charts';
import { useTaxSummaryReport, useExportReport } from '@/hooks/use-reports';

const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(amount);
}

// Get available financial years (current and past 5 years)
function getAvailableYears(): number[] {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();
  // UK financial year starts in April, so if before April, current FY started last year
  const currentFY = currentMonth >= 3 ? currentYear : currentYear - 1;
  return Array.from({ length: 6 }, (_, i) => currentFY - i);
}

export default function TaxSummaryReportPage() {
  const availableYears = getAvailableYears();
  const [financialYear, setFinancialYear] = useState<number>(availableYears[0]);

  const { data: report, isLoading, error } = useTaxSummaryReport(financialYear);
  const exportMutation = useExportReport();

  const handleExport = (format: 'csv' | 'json') => {
    exportMutation.mutate({
      reportType: 'tax-summary',
      format,
      financialYear,
    });
  };

  // Prepare quarterly chart data
  const quarterlyData = report?.quarterlyBreakdown.map((q) => ({
    name: q.quarterLabel,
    revenue: q.revenue,
    expenses: q.expenses,
    profit: q.profit,
  })) || [];

  return (
    <>
      <Header title="Tax Summary Report" />
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link href="/reports">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold">Tax Summary</h1>
              <p className="text-muted-foreground">
                UK financial year summary for HMRC reporting
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={String(financialYear)}
              onValueChange={(v: string) => setFinancialYear(Number(v))}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Financial Year" />
              </SelectTrigger>
              <SelectContent>
                {availableYears.map((year) => (
                  <SelectItem key={year} value={String(year)}>
                    {year}/{year + 1} Tax Year
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={() => handleExport('csv')}
              disabled={exportMutation.isPending}
            >
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          </div>
        </div>

        {/* Info Alert */}
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>UK Tax Year</AlertTitle>
          <AlertDescription>
            This report covers the UK financial year from 6 April {financialYear} to 5 April{' '}
            {financialYear + 1}. Mileage is calculated at the HMRC approved rate of 45p per mile.
          </AlertDescription>
        </Alert>

        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : error ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              Failed to load report. Please try again.
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Key Metrics */}
            <div className="grid gap-4 md:grid-cols-4">
              <StatCard
                title="Total Turnover"
                value={report?.summary.totalSalesRevenue || 0}
                format="currency"
                icon={<FileText className="h-4 w-4 text-muted-foreground" />}
              />
              <StatCard
                title="Total Expenses"
                value={report?.summary.allowableExpenses.total || 0}
                format="currency"
              />
              <StatCard
                title="Net Profit"
                value={report?.summary.netProfit || 0}
                format="currency"
                trend={(report?.summary.netProfit || 0) >= 0 ? 'up' : 'down'}
              />
              <StatCard
                title="Mileage Deduction"
                value={report?.totalMileageAllowance || 0}
                format="currency"
                description={`${report?.totalMiles || 0} miles @ 45p`}
                icon={<Car className="h-4 w-4 text-muted-foreground" />}
              />
            </div>

            {/* Quarterly Breakdown Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Quarterly Performance</CardTitle>
                <CardDescription>
                  Revenue, expenses, and profit by quarter
                </CardDescription>
              </CardHeader>
              <CardContent>
                <BarChart
                  data={quarterlyData}
                  xAxisKey="name"
                  bars={[
                    { dataKey: 'revenue', name: 'Revenue', color: '#3b82f6' },
                    { dataKey: 'expenses', name: 'Expenses', color: '#ef4444' },
                    { dataKey: 'profit', name: 'Profit', color: '#10b981' },
                  ]}
                  height={300}
                  formatYAxis={(v) => `£${(v / 1000).toFixed(0)}k`}
                  formatTooltip={(v) => formatCurrency(v)}
                />
              </CardContent>
            </Card>

            {/* Expense Breakdown */}
            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Expense Categories</CardTitle>
                  <CardDescription>Breakdown of all business expenses</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Category</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell>Cost of Goods Sold</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(report?.summary.costOfGoodsSold || 0)}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>Platform Fees</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(report?.summary.allowableExpenses.platformFees || 0)}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>Shipping Costs</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(report?.summary.allowableExpenses.shippingCosts || 0)}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>Mileage (Collection)</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(report?.summary.allowableExpenses.mileageAllowance || 0)}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>Other Expenses</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(report?.summary.allowableExpenses.otherCosts || 0)}
                        </TableCell>
                      </TableRow>
                      <TableRow className="border-t-2 font-bold">
                        <TableCell>Total Allowable Expenses</TableCell>
                        <TableCell className="text-right text-red-600">
                          {formatCurrency(report?.summary.allowableExpenses.total || 0)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Profit & Loss Summary</CardTitle>
                  <CardDescription>For HMRC Self Assessment</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-medium">Sales Revenue</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(report?.summary.totalSalesRevenue || 0)}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>Less: Cost of Sales</TableCell>
                        <TableCell className="text-right text-red-600">
                          ({formatCurrency(report?.summary.costOfGoodsSold || 0)})
                        </TableCell>
                      </TableRow>
                      <TableRow className="border-t">
                        <TableCell className="font-medium">Gross Profit</TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(report?.summary.grossProfit || 0)}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>Less: Allowable Expenses</TableCell>
                        <TableCell className="text-right text-red-600">
                          ({formatCurrency(report?.summary.allowableExpenses.total || 0)})
                        </TableCell>
                      </TableRow>
                      <TableRow className="border-t-2 font-bold text-lg">
                        <TableCell>Net Profit/(Loss)</TableCell>
                        <TableCell
                          className={`text-right ${
                            (report?.summary.netProfit || 0) >= 0 ? 'text-green-600' : 'text-red-600'
                          }`}
                        >
                          {formatCurrency(report?.summary.netProfit || 0)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>

            {/* Quarterly Detail Table */}
            <Card>
              <CardHeader>
                <CardTitle>Quarterly Breakdown</CardTitle>
                <CardDescription>Detailed figures by quarter</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Quarter</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                      <TableHead className="text-right">Expenses</TableHead>
                      <TableHead className="text-right">Profit</TableHead>
                      <TableHead className="text-right">Margin</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report?.quarterlyBreakdown.map((quarter) => (
                      <TableRow key={quarter.quarter}>
                        <TableCell className="font-medium">{quarter.quarterLabel}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(quarter.revenue)}
                        </TableCell>
                        <TableCell className="text-right text-red-600">
                          {formatCurrency(quarter.expenses)}
                        </TableCell>
                        <TableCell
                          className={`text-right font-medium ${
                            quarter.profit >= 0 ? 'text-green-600' : 'text-red-600'
                          }`}
                        >
                          {formatCurrency(quarter.profit)}
                        </TableCell>
                        <TableCell className="text-right">
                          {quarter.revenue > 0
                            ? ((quarter.profit / quarter.revenue) * 100).toFixed(1)
                            : 0}
                          %
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="border-t-2 font-bold">
                      <TableCell>Total</TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(report?.summary.totalSalesRevenue || 0)}
                      </TableCell>
                      <TableCell className="text-right text-red-600">
                        {formatCurrency(
                          (report?.summary.costOfGoodsSold || 0) +
                          (report?.summary.allowableExpenses.total || 0)
                        )}
                      </TableCell>
                      <TableCell
                        className={`text-right ${
                          (report?.summary.netProfit || 0) >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}
                      >
                        {formatCurrency(report?.summary.netProfit || 0)}
                      </TableCell>
                      <TableCell className="text-right">
                        {(report?.summary.totalSalesRevenue || 0) > 0
                          ? (((report?.summary.netProfit || 0) / (report?.summary.totalSalesRevenue || 1)) * 100).toFixed(1)
                          : 0}
                        %
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Mileage Log */}
            {report?.mileageLog && report.mileageLog.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Mileage Log</CardTitle>
                  <CardDescription>Collection journeys for tax deduction</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Miles</TableHead>
                        <TableHead className="text-right">Allowance (45p/mi)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.mileageLog.map((entry, idx) => (
                        <TableRow key={idx}>
                          <TableCell>{new Date(entry.date).toLocaleDateString('en-GB')}</TableCell>
                          <TableCell>{entry.description}</TableCell>
                          <TableCell className="text-right">{entry.mileage}</TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(entry.allowance)}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="border-t-2 font-bold">
                        <TableCell colSpan={2}>Total</TableCell>
                        <TableCell className="text-right">{report.totalMiles}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(report.totalMileageAllowance)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {/* VAT Note */}
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>VAT Registration</AlertTitle>
              <AlertDescription>
                If your taxable turnover exceeds £85,000 in a 12-month period, you must register
                for VAT. Your rolling 12-month turnover should be monitored separately.
              </AlertDescription>
            </Alert>
          </>
        )}
      </div>
    </>
  );
}
