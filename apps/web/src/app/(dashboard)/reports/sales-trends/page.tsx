'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download, Loader2, TrendingUp } from 'lucide-react';
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
import { DateRangePicker, StatCard, LineChart, AreaChart } from '@/components/charts';
import { useSalesTrendsReport, useExportReport } from '@/hooks/use-reports';
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

export default function SalesTrendsReportPage() {
  const [dateRange, setDateRange] = useState<{
    startDate: Date;
    endDate: Date;
    preset?: DateRangePreset;
  }>(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { startDate: start, endDate: end, preset: 'last_90_days' };
  });

  const [granularity, setGranularity] = useState<'daily' | 'weekly' | 'monthly'>('daily');

  const { data: report, isLoading, error } = useSalesTrendsReport(dateRange, granularity);
  const exportMutation = useExportReport();

  const handleDateChange = (start: Date, end: Date, preset?: DateRangePreset) => {
    setDateRange({ startDate: start, endDate: end, preset });
  };

  const handleExport = (format: 'csv' | 'json') => {
    exportMutation.mutate({
      reportType: 'sales-trends',
      format,
      dateRange,
    });
  };

  // Prepare chart data
  const chartData = report?.data.map((point) => ({
    period: point.label,
    sales: point.orderCount,
    revenue: point.revenue,
    profit: point.profit,
    margin: point.revenue > 0 ? (point.profit / point.revenue) * 100 : 0,
  })) || [];

  // Calculate trend direction
  const recentData = chartData.slice(-7);
  const olderData = chartData.slice(-14, -7);
  const recentAvgRevenue = recentData.length > 0
    ? recentData.reduce((sum, d) => sum + d.revenue, 0) / recentData.length
    : 0;
  const olderAvgRevenue = olderData.length > 0
    ? olderData.reduce((sum, d) => sum + d.revenue, 0) / olderData.length
    : 0;
  const trendDirection = recentAvgRevenue >= olderAvgRevenue ? 'up' : 'down';

  return (
    <>
      <Header title="Sales Trends Report" />
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
              <h1 className="text-2xl font-bold">Sales Trends</h1>
              <p className="text-muted-foreground">
                Time-series analysis of sales and revenue
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={granularity} onValueChange={(v: string) => setGranularity(v as typeof granularity)}>
              <SelectTrigger className="w-[120px]">
                <SelectValue placeholder="Granularity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
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
                value={report?.summary.totalOrders || 0}
                format="number"
                icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
              />
              <StatCard
                title="Total Revenue"
                value={report?.summary.totalRevenue || 0}
                format="currency"
              />
              <StatCard
                title="Total Profit"
                value={report?.summary.totalProfit || 0}
                format="currency"
              />
              <StatCard
                title="Trend"
                value={trendDirection === 'up' ? 'Increasing' : 'Decreasing'}
                trend={trendDirection}
                description="Based on recent activity"
              />
            </div>

            {/* Revenue Trend Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Revenue & Profit Trend</CardTitle>
                <CardDescription>
                  {granularity.charAt(0).toUpperCase() + granularity.slice(1)} revenue and profit over time
                </CardDescription>
              </CardHeader>
              <CardContent>
                <AreaChart
                  data={chartData}
                  xAxisKey="period"
                  areas={[
                    { dataKey: 'revenue', name: 'Revenue', color: '#3b82f6', fillOpacity: 0.3 },
                    { dataKey: 'profit', name: 'Profit', color: '#10b981', fillOpacity: 0.3 },
                  ]}
                  height={350}
                  formatYAxis={(v) => `£${(v / 1000).toFixed(0)}k`}
                  formatTooltip={(v) => formatCurrency(v)}
                />
              </CardContent>
            </Card>

            {/* Sales Count Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Sales Volume</CardTitle>
                <CardDescription>Number of sales over time</CardDescription>
              </CardHeader>
              <CardContent>
                <LineChart
                  data={chartData}
                  xAxisKey="period"
                  lines={[
                    { dataKey: 'sales', name: 'Sales', color: '#8b5cf6', strokeWidth: 2 },
                  ]}
                  height={250}
                  formatTooltip={(v) => `${v} sales`}
                />
              </CardContent>
            </Card>

            {/* Profit Margin Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Profit Margin Trend</CardTitle>
                <CardDescription>Profit margin percentage over time</CardDescription>
              </CardHeader>
              <CardContent>
                <LineChart
                  data={chartData}
                  xAxisKey="period"
                  lines={[
                    { dataKey: 'margin', name: 'Margin %', color: '#f59e0b', strokeWidth: 2 },
                  ]}
                  height={250}
                  formatYAxis={(v) => `${v.toFixed(0)}%`}
                  formatTooltip={(v) => `${v.toFixed(1)}%`}
                />
              </CardContent>
            </Card>

            {/* Data Table */}
            <Card>
              <CardHeader>
                <CardTitle>Trend Data</CardTitle>
                <CardDescription>
                  Detailed {granularity} breakdown
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="max-h-[400px] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Period</TableHead>
                        <TableHead className="text-right">Sales</TableHead>
                        <TableHead className="text-right">Revenue</TableHead>
                        <TableHead className="text-right">Profit</TableHead>
                        <TableHead className="text-right">Margin</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {chartData.map((point) => (
                        <TableRow key={point.period}>
                          <TableCell className="font-medium">{point.period}</TableCell>
                          <TableCell className="text-right">{point.sales}</TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(point.revenue)}
                          </TableCell>
                          <TableCell
                            className={`text-right ${
                              point.profit >= 0 ? 'text-green-600' : 'text-red-600'
                            }`}
                          >
                            {formatCurrency(point.profit)}
                          </TableCell>
                          <TableCell className="text-right">
                            {point.margin.toFixed(1)}%
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
