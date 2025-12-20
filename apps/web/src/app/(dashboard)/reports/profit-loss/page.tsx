'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download, Loader2, TrendingUp, TrendingDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DateRangePicker, StatCard, BarChart } from '@/components/charts';
import { useProfitLossReport, useExportReport } from '@/hooks/use-reports';
import type { DateRangePreset } from '@/lib/services';

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

export default function ProfitLossReportPage() {
  const [dateRange, setDateRange] = useState<{
    startDate: Date;
    endDate: Date;
    preset?: DateRangePreset;
  }>(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { startDate: start, endDate: end, preset: 'this_month' };
  });

  const { data: report, isLoading, error } = useProfitLossReport(dateRange, true);
  const exportMutation = useExportReport();

  const handleDateChange = (start: Date, end: Date, preset?: DateRangePreset) => {
    setDateRange({ startDate: start, endDate: end, preset });
  };

  const handleExport = (format: 'csv' | 'json') => {
    exportMutation.mutate({
      reportType: 'profit-loss',
      format,
      dateRange,
    });
  };

  // Calculate total costs
  const totalCosts = (report?.costOfGoodsSold || 0) +
    (report?.platformFees || 0) +
    (report?.shippingCosts || 0) +
    (report?.otherCosts || 0);

  // Prepare chart data
  const chartData = report
    ? [
        { name: 'Revenue', value: report.totalRevenue, color: '#3b82f6' },
        { name: 'COGS', value: report.costOfGoodsSold, color: '#ef4444' },
        { name: 'Fees', value: report.platformFees, color: '#f59e0b' },
        { name: 'Shipping', value: report.shippingCosts, color: '#8b5cf6' },
        { name: 'Other', value: report.otherCosts, color: '#6b7280' },
      ]
    : [];

  return (
    <>
      <Header title="Profit & Loss Report" />
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
              <h1 className="text-2xl font-bold">Profit & Loss</h1>
              <p className="text-muted-foreground">
                Revenue, costs, and profit analysis
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <DateRangePicker
              startDate={dateRange.startDate}
              endDate={dateRange.endDate}
              preset={dateRange.preset}
              onDateChange={handleDateChange}
            />
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
                title="Total Revenue"
                value={report?.totalRevenue || 0}
                previousValue={report?.previousRevenue}
                changePercent={report?.revenueChange}
                format="currency"
              />
              <StatCard
                title="Total Costs"
                value={totalCosts}
                format="currency"
              />
              <StatCard
                title="Net Profit"
                value={report?.netProfit || 0}
                previousValue={report?.previousProfit}
                changePercent={report?.profitChange}
                format="currency"
                icon={
                  (report?.netProfit || 0) >= 0 ? (
                    <TrendingUp className="h-4 w-4 text-green-600" />
                  ) : (
                    <TrendingDown className="h-4 w-4 text-red-600" />
                  )
                }
              />
              <StatCard
                title="Profit Margin"
                value={report?.profitMargin || 0}
                previousValue={report?.previousMargin}
                changePercent={report?.marginChange}
                format="percent"
              />
            </div>

            {/* Cost Breakdown Chart */}
            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Revenue & Costs Breakdown</CardTitle>
                  <CardDescription>
                    Visual comparison of revenue vs all cost categories
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <BarChart
                    data={chartData}
                    xAxisKey="name"
                    bars={[{ dataKey: 'value', name: 'Amount', color: '#3b82f6' }]}
                    height={300}
                    formatYAxis={(v) => `£${(v / 1000).toFixed(0)}k`}
                    formatTooltip={(v) => formatCurrency(v)}
                    colorByValue={(d) => d.color as string}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Period Summary</CardTitle>
                  <CardDescription>
                    Detailed breakdown for selected period
                  </CardDescription>
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
                        <TableCell className="font-medium">Revenue</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(report?.totalRevenue || 0)}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>Shipping Income</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(report?.shippingIncome || 0)}
                        </TableCell>
                      </TableRow>
                      <TableRow className="border-t">
                        <TableCell className="font-medium">Gross Revenue</TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(report?.grossRevenue || 0)}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>Cost of Goods Sold</TableCell>
                        <TableCell className="text-right text-red-600">
                          -{formatCurrency(report?.costOfGoodsSold || 0)}
                        </TableCell>
                      </TableRow>
                      <TableRow className="border-t">
                        <TableCell className="font-medium">Gross Profit</TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(report?.grossProfit || 0)}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>Platform Fees</TableCell>
                        <TableCell className="text-right text-red-600">
                          -{formatCurrency(report?.platformFees || 0)}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>Shipping Costs</TableCell>
                        <TableCell className="text-right text-red-600">
                          -{formatCurrency(report?.shippingCosts || 0)}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>Other Costs</TableCell>
                        <TableCell className="text-right text-red-600">
                          -{formatCurrency(report?.otherCosts || 0)}
                        </TableCell>
                      </TableRow>
                      <TableRow className="border-t-2">
                        <TableCell className="font-bold">Net Profit</TableCell>
                        <TableCell
                          className={`text-right font-bold ${
                            (report?.netProfit || 0) >= 0
                              ? 'text-green-600'
                              : 'text-red-600'
                          }`}
                        >
                          {formatCurrency(report?.netProfit || 0)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>

            {/* Platform Breakdown */}
            {report?.platformBreakdown && report.platformBreakdown.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Platform Breakdown</CardTitle>
                  <CardDescription>
                    Performance by sales platform
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Platform</TableHead>
                        <TableHead className="text-right">Orders</TableHead>
                        <TableHead className="text-right">Revenue</TableHead>
                        <TableHead className="text-right">Fees</TableHead>
                        <TableHead className="text-right">Profit</TableHead>
                        <TableHead className="text-right">Margin</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.platformBreakdown.map((platform) => (
                        <TableRow key={platform.platform}>
                          <TableCell className="font-medium">{platform.platform}</TableCell>
                          <TableCell className="text-right">{platform.orderCount}</TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(platform.revenue)}
                          </TableCell>
                          <TableCell className="text-right text-red-600">
                            {formatCurrency(platform.fees)}
                          </TableCell>
                          <TableCell
                            className={`text-right ${
                              platform.profit >= 0 ? 'text-green-600' : 'text-red-600'
                            }`}
                          >
                            {formatCurrency(platform.profit)}
                          </TableCell>
                          <TableCell className="text-right">
                            {platform.margin.toFixed(1)}%
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {/* Monthly Breakdown */}
            {report?.monthlyBreakdown && report.monthlyBreakdown.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Monthly Breakdown</CardTitle>
                  <CardDescription>
                    Performance trend over time
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Month</TableHead>
                        <TableHead className="text-right">Orders</TableHead>
                        <TableHead className="text-right">Revenue</TableHead>
                        <TableHead className="text-right">Profit</TableHead>
                        <TableHead className="text-right">Margin</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.monthlyBreakdown.map((month) => (
                        <TableRow key={month.month}>
                          <TableCell className="font-medium">{month.month}</TableCell>
                          <TableCell className="text-right">{month.orderCount}</TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(month.revenue)}
                          </TableCell>
                          <TableCell
                            className={`text-right ${
                              month.profit >= 0 ? 'text-green-600' : 'text-red-600'
                            }`}
                          >
                            {formatCurrency(month.profit)}
                          </TableCell>
                          <TableCell className="text-right">
                            {month.margin.toFixed(1)}%
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </>
  );
}
