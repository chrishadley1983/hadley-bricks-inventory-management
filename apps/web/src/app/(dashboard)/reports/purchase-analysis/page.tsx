'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download, Loader2, ShoppingBag, Car } from 'lucide-react';
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
import { usePurchaseAnalysisReport, useExportReport } from '@/hooks/use-reports';
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

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function getRoiBadgeVariant(roi: number): 'default' | 'secondary' | 'destructive' {
  if (roi >= 50) return 'default';
  if (roi >= 0) return 'secondary';
  return 'destructive';
}

export default function PurchaseAnalysisReportPage() {
  usePerfPage('PurchaseAnalysisReportPage');

  const [dateRange, setDateRange] = useState<{
    startDate: Date;
    endDate: Date;
    preset?: DateRangePreset;
  }>(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 1);
    const end = new Date(now.getFullYear(), 11, 31);
    return { startDate: start, endDate: end, preset: 'this_year' };
  });

  const { data: report, isLoading, error } = usePurchaseAnalysisReport(dateRange);
  const exportMutation = useExportReport();

  const handleDateChange = (start: Date, end: Date, preset?: DateRangePreset) => {
    setDateRange({ startDate: start, endDate: end, preset });
  };

  const handleExport = (format: 'csv' | 'json') => {
    exportMutation.mutate({
      reportType: 'purchase-analysis',
      format,
      dateRange,
    });
  };

  // Prepare chart data
  const roiChartData =
    report?.purchases.slice(0, 10).map((p) => ({
      name: p.description.substring(0, 15),
      roi: p.roi,
      profit: p.profit,
      color: p.roi >= 0 ? '#10b981' : '#ef4444',
    })) || [];

  const sourceData =
    report?.bySource?.map((s, i) => {
      const sourceColors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
      return {
        name: s.source,
        value: s.totalSpent,
        color: sourceColors[i % sourceColors.length],
      };
    }) || [];

  return (
    <>
      <Header title="Purchase Analysis Report" />
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
              <h1 className="text-2xl font-bold">Purchase Analysis</h1>
              <p className="text-muted-foreground">ROI tracking per purchase with mileage costs</p>
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
            <div className="grid gap-4 md:grid-cols-5">
              <StatCard
                title="Items Acquired"
                value={report?.summary.itemsAcquired || 0}
                format="number"
                icon={<ShoppingBag className="h-4 w-4 text-muted-foreground" />}
              />
              <StatCard
                title="Total Spent"
                value={report?.summary.totalSpent || 0}
                format="currency"
              />
              <StatCard
                title="Revenue (Sold)"
                value={report?.summary.revenueFromSold || 0}
                format="currency"
              />
              <StatCard
                title="Total Profit"
                value={report?.summary.totalProfit || 0}
                format="currency"
              />
              <StatCard
                title="Overall ROI"
                value={report?.summary.overallROI || 0}
                format="percent"
                trend={(report?.summary.overallROI || 0) >= 0 ? 'up' : 'down'}
              />
            </div>

            {/* Mileage Stats */}
            <div className="grid gap-4 md:grid-cols-3">
              <StatCard
                title="Total Mileage"
                value={`${report?.summary.totalMileage || 0} miles`}
                icon={<Car className="h-4 w-4 text-muted-foreground" />}
              />
              <StatCard
                title="Mileage Cost"
                value={report?.summary.totalMileageCost || 0}
                format="currency"
                description="At HMRC rate (45p/mile)"
              />
              <StatCard
                title="Items Sold"
                value={`${report?.summary.itemsSold || 0} / ${report?.summary.itemsAcquired || 0}`}
                description="Sold vs acquired"
              />
            </div>

            {/* Charts */}
            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>ROI by Purchase</CardTitle>
                  <CardDescription>Top 10 purchases by ROI</CardDescription>
                </CardHeader>
                <CardContent>
                  <BarChart
                    data={roiChartData}
                    xAxisKey="name"
                    bars={[{ dataKey: 'roi', name: 'ROI %', color: '#3b82f6' }]}
                    height={300}
                    formatYAxis={(v) => `${v}%`}
                    formatTooltip={(v) => `${v.toFixed(1)}%`}
                    colorByValue={(d) => d.color as string}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Investment by Source</CardTitle>
                  <CardDescription>Where purchases came from</CardDescription>
                </CardHeader>
                <CardContent>
                  <PieChart
                    data={sourceData}
                    height={300}
                    formatTooltip={(v) => formatCurrency(v)}
                  />
                </CardContent>
              </Card>
            </div>

            {/* Source Breakdown Table */}
            {report?.bySource && report.bySource.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Performance by Source</CardTitle>
                  <CardDescription>ROI breakdown by purchase source</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Source</TableHead>
                        <TableHead className="text-right">Purchases</TableHead>
                        <TableHead className="text-right">Spent</TableHead>
                        <TableHead className="text-right">Items</TableHead>
                        <TableHead className="text-right">Sold</TableHead>
                        <TableHead className="text-right">Revenue</TableHead>
                        <TableHead className="text-right">Profit</TableHead>
                        <TableHead className="text-right">ROI</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.bySource.map((source) => (
                        <TableRow key={source.source}>
                          <TableCell className="font-medium">{source.source}</TableCell>
                          <TableCell className="text-right">{source.purchaseCount}</TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(source.totalSpent)}
                          </TableCell>
                          <TableCell className="text-right">{source.itemsAcquired}</TableCell>
                          <TableCell className="text-right">{source.itemsSold}</TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(source.revenue)}
                          </TableCell>
                          <TableCell
                            className={`text-right ${
                              source.profit >= 0 ? 'text-green-600' : 'text-red-600'
                            }`}
                          >
                            {formatCurrency(source.profit)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge variant={getRoiBadgeVariant(source.roi)}>
                              {source.roi >= 0 ? '+' : ''}
                              {source.roi.toFixed(1)}%
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {/* Purchase Details Table */}
            <Card>
              <CardHeader>
                <CardTitle>Purchase Details</CardTitle>
                <CardDescription>Complete breakdown of all purchases with ROI</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="max-h-[500px] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead className="text-right">Cost</TableHead>
                        <TableHead className="text-right">Mileage</TableHead>
                        <TableHead className="text-right">Items</TableHead>
                        <TableHead className="text-right">Revenue</TableHead>
                        <TableHead className="text-right">Profit</TableHead>
                        <TableHead className="text-right">ROI</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report?.purchases.map((purchase) => (
                        <TableRow key={purchase.id}>
                          <TableCell className="font-medium">{formatDate(purchase.date)}</TableCell>
                          <TableCell className="max-w-[150px] truncate">
                            {purchase.description}
                          </TableCell>
                          <TableCell>{purchase.source}</TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(purchase.cost)}
                          </TableCell>
                          <TableCell className="text-right">
                            {purchase.mileage && purchase.mileage > 0 ? (
                              <span>
                                {purchase.mileage} mi
                                <span className="text-muted-foreground text-xs ml-1">
                                  ({formatCurrency(purchase.mileageCost)})
                                </span>
                              </span>
                            ) : (
                              '-'
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {purchase.soldCount}/{purchase.itemCount}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(purchase.revenue)}
                          </TableCell>
                          <TableCell
                            className={`text-right ${
                              purchase.profit >= 0 ? 'text-green-600' : 'text-red-600'
                            }`}
                          >
                            {formatCurrency(purchase.profit)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge variant={getRoiBadgeVariant(purchase.roi)}>
                              {purchase.roi >= 0 ? '+' : ''}
                              {purchase.roi.toFixed(1)}%
                            </Badge>
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
