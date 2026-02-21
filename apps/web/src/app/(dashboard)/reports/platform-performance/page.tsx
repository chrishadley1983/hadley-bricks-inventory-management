'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download, Loader2, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { DateRangePicker, StatCard, BarChart, PieChart } from '@/components/charts';
import { usePlatformPerformanceReport, useExportReport } from '@/hooks/use-reports';
import { usePerfPage } from '@/hooks/use-perf';
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

const PLATFORM_COLORS: Record<string, string> = {
  BrickLink: '#3b82f6',
  BrickOwl: '#f97316',
  eBay: '#eab308',
  Amazon: '#f59e0b',
  Manual: '#6b7280',
};

function getPlatformBadgeColor(platform: string): string {
  switch (platform.toLowerCase()) {
    case 'bricklink':
      return 'bg-blue-100 text-blue-800';
    case 'brickowl':
      return 'bg-orange-100 text-orange-800';
    case 'ebay':
      return 'bg-yellow-100 text-yellow-800';
    case 'amazon':
      return 'bg-amber-100 text-amber-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

export default function PlatformPerformanceReportPage() {
  usePerfPage('PlatformPerformanceReportPage');

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

  const { data: report, isLoading, error } = usePlatformPerformanceReport(dateRange);
  const exportMutation = useExportReport();

  const handleDateChange = (start: Date, end: Date, preset?: DateRangePreset) => {
    setDateRange({ startDate: start, endDate: end, preset });
  };

  const handleExport = (format: 'csv' | 'json') => {
    exportMutation.mutate({
      reportType: 'platform-performance',
      format,
      dateRange,
    });
  };

  // Prepare chart data
  const revenueChartData =
    report?.platforms.map((p) => ({
      name: p.platform,
      revenue: p.revenue,
      netRevenue: p.netRevenue,
      color: PLATFORM_COLORS[p.platform] || '#6b7280',
    })) || [];

  const salesPieData =
    report?.platforms.map((p) => ({
      name: p.platform,
      value: p.orderCount,
      color: PLATFORM_COLORS[p.platform] || '#6b7280',
    })) || [];

  const feesChartData =
    report?.platforms.map((p) => ({
      name: p.platform,
      fees: p.fees,
      feePercentage: p.revenue > 0 ? (p.fees / p.revenue) * 100 : 0,
      color: PLATFORM_COLORS[p.platform] || '#6b7280',
    })) || [];

  // Find best performing platform by net revenue
  const bestPlatform = report?.platforms.reduce(
    (best, p) => (p.netRevenue > (best?.netRevenue || 0) ? p : best),
    report.platforms[0]
  );

  return (
    <>
      <Header title="Platform Performance Report" />
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
              <h1 className="text-2xl font-bold">Platform Performance</h1>
              <p className="text-muted-foreground">
                Compare sales, profit, and fees across platforms
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
                title="Total Orders"
                value={report?.totals.totalOrders || 0}
                format="number"
                icon={<BarChart3 className="h-4 w-4 text-muted-foreground" />}
              />
              <StatCard
                title="Total Revenue"
                value={report?.totals.totalRevenue || 0}
                format="currency"
              />
              <StatCard
                title="Total Fees"
                value={report?.totals.totalFees || 0}
                format="currency"
              />
              <StatCard
                title="Best Platform"
                value={bestPlatform?.platform || 'N/A'}
                description={bestPlatform ? `${formatCurrency(bestPlatform.netRevenue)} net` : ''}
              />
            </div>

            {/* Charts */}
            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Revenue by Platform</CardTitle>
                  <CardDescription>Comparison of revenue and net revenue</CardDescription>
                </CardHeader>
                <CardContent>
                  <BarChart
                    data={revenueChartData}
                    xAxisKey="name"
                    bars={[
                      { dataKey: 'revenue', name: 'Revenue', color: '#3b82f6' },
                      { dataKey: 'netRevenue', name: 'Net Revenue', color: '#10b981' },
                    ]}
                    height={300}
                    formatYAxis={(v) => `£${(v / 1000).toFixed(0)}k`}
                    formatTooltip={(v) => formatCurrency(v)}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Order Distribution</CardTitle>
                  <CardDescription>Number of orders by platform</CardDescription>
                </CardHeader>
                <CardContent>
                  <PieChart data={salesPieData} height={300} formatTooltip={(v) => `${v} orders`} />
                </CardContent>
              </Card>
            </div>

            {/* Fees Comparison */}
            <Card>
              <CardHeader>
                <CardTitle>Platform Fees Comparison</CardTitle>
                <CardDescription>Fee amounts and percentages by platform</CardDescription>
              </CardHeader>
              <CardContent>
                <BarChart
                  data={feesChartData}
                  xAxisKey="name"
                  bars={[{ dataKey: 'fees', name: 'Total Fees', color: '#ef4444' }]}
                  height={250}
                  formatYAxis={(v) => `£${v.toFixed(0)}`}
                  formatTooltip={(v) => formatCurrency(v)}
                />
              </CardContent>
            </Card>

            {/* Platform Comparison Table */}
            <Card>
              <CardHeader>
                <CardTitle>Detailed Platform Comparison</CardTitle>
                <CardDescription>Complete metrics for each sales platform</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Platform</TableHead>
                      <TableHead className="text-right">Orders</TableHead>
                      <TableHead className="text-right">Items Sold</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                      <TableHead className="text-right">Fees</TableHead>
                      <TableHead className="text-right">Net Revenue</TableHead>
                      <TableHead className="text-right">Margin</TableHead>
                      <TableHead className="text-right">Avg Order</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report?.platforms.map((platform) => {
                      const feePercentage =
                        platform.revenue > 0 ? (platform.fees / platform.revenue) * 100 : 0;
                      return (
                        <TableRow key={platform.platform}>
                          <TableCell>
                            <Badge className={getPlatformBadgeColor(platform.platform)}>
                              {platform.platform}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">{platform.orderCount}</TableCell>
                          <TableCell className="text-right">{platform.itemsSold}</TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(platform.revenue)}
                          </TableCell>
                          <TableCell className="text-right text-red-600">
                            {formatCurrency(platform.fees)}
                            <span className="text-xs text-muted-foreground ml-1">
                              ({feePercentage.toFixed(1)}%)
                            </span>
                          </TableCell>
                          <TableCell
                            className={`text-right font-medium ${
                              platform.netRevenue >= 0 ? 'text-green-600' : 'text-red-600'
                            }`}
                          >
                            {formatCurrency(platform.netRevenue)}
                          </TableCell>
                          <TableCell className="text-right">
                            {platform.profitMargin.toFixed(1)}%
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(platform.avgOrderValue)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {/* Totals Row */}
                    <TableRow className="border-t-2 font-bold">
                      <TableCell>Total</TableCell>
                      <TableCell className="text-right">{report?.totals.totalOrders}</TableCell>
                      <TableCell className="text-right">-</TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(report?.totals.totalRevenue || 0)}
                      </TableCell>
                      <TableCell className="text-right text-red-600">
                        {formatCurrency(report?.totals.totalFees || 0)}
                      </TableCell>
                      <TableCell className="text-right text-green-600">
                        {formatCurrency(
                          (report?.totals.totalRevenue || 0) - (report?.totals.totalFees || 0)
                        )}
                      </TableCell>
                      <TableCell className="text-right">-</TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(report?.totals.avgOrderValue || 0)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
