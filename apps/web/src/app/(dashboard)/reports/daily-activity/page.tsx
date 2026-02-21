'use client';

import dynamic from 'next/dynamic';
import { useState, Fragment } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download, Loader2, Calendar, BarChart3, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { DateRangePicker, StatCard } from '@/components/charts';
import { useDailyActivityReport, useUpdateStoreStatus, useExportReport } from '@/hooks/use-reports';
import { usePerfPage } from '@/hooks/use-perf';
import type {
  DateRangePreset,
  StoreStatus,
  ActivityPlatform,
  DailyActivityRow,
  MonthlyActivityRow,
} from '@/lib/services';

const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

type ColumnVisibility = {
  amazon: boolean;
  ebay: boolean;
  bricklink: boolean;
  total: boolean;
};

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(amount);
}

function formatPlatformName(platform: ActivityPlatform | 'total'): string {
  const names: Record<ActivityPlatform | 'total', string> = {
    amazon: 'Amazon',
    ebay: 'eBay',
    bricklink: 'BrickLink',
    total: 'TOTAL',
  };
  return names[platform];
}

function getStatusBadgeColor(status: StoreStatus | null): string {
  switch (status) {
    case 'O':
      return 'bg-green-100 text-green-800';
    case 'C':
      return 'bg-red-100 text-red-800';
    case 'H':
      return 'bg-yellow-100 text-yellow-800';
    default:
      return 'bg-gray-100 text-gray-500';
  }
}

function StoreStatusSelector({
  date,
  platform,
  currentStatus,
  onStatusChange,
  disabled,
}: {
  date: string;
  platform: ActivityPlatform;
  currentStatus: StoreStatus | null;
  onStatusChange: (date: string, platform: ActivityPlatform, status: StoreStatus) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      value={currentStatus || 'none'}
      onValueChange={(value: string) => {
        if (value !== 'none') {
          onStatusChange(date, platform, value as StoreStatus);
        }
      }}
      disabled={disabled}
    >
      <SelectTrigger className="w-[70px] h-7 text-xs">
        <SelectValue placeholder="-">
          {currentStatus ? (
            <Badge className={`${getStatusBadgeColor(currentStatus)} text-xs px-1.5 py-0`}>
              {currentStatus}
            </Badge>
          ) : (
            '-'
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none" className="text-muted-foreground">
          -
        </SelectItem>
        <SelectItem value="O">
          <Badge className={getStatusBadgeColor('O')}>O - Open</Badge>
        </SelectItem>
        <SelectItem value="C">
          <Badge className={getStatusBadgeColor('C')}>C - Closed</Badge>
        </SelectItem>
        <SelectItem value="H">
          <Badge className={getStatusBadgeColor('H')}>H - Holiday</Badge>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

export default function DailyActivityReportPage() {
  usePerfPage('DailyActivityReportPage');

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

  const [granularity, setGranularity] = useState<'daily' | 'monthly'>('daily');

  // Column visibility state - all visible by default
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibility>({
    amazon: true,
    ebay: true,
    bricklink: true,
    total: true,
  });

  const { data: report, isLoading, error } = useDailyActivityReport(dateRange, granularity);
  const updateStatusMutation = useUpdateStoreStatus();
  const exportMutation = useExportReport();

  const allPlatforms: ActivityPlatform[] = ['amazon', 'ebay', 'bricklink'];

  // Filter platforms based on visibility
  const visiblePlatforms = allPlatforms.filter((p) => columnVisibility[p]);

  const handleDateChange = (start: Date, end: Date, preset?: DateRangePreset) => {
    setDateRange({ startDate: start, endDate: end, preset });
  };

  const handleStatusChange = (date: string, platform: ActivityPlatform, status: StoreStatus) => {
    updateStatusMutation.mutate({ date, platform, status });
  };

  const handleExport = (format: 'csv' | 'json') => {
    exportMutation.mutate({
      reportType: 'daily-activity',
      format,
      dateRange,
    });
  };

  const toggleColumnVisibility = (column: keyof ColumnVisibility) => {
    setColumnVisibility((prev) => ({
      ...prev,
      [column]: !prev[column],
    }));
  };

  // Type guard for daily vs monthly rows
  const isDailyRow = (row: DailyActivityRow | MonthlyActivityRow): row is DailyActivityRow => {
    return 'date' in row;
  };

  // Calculate row totals
  const getRowTotals = (row: DailyActivityRow | MonthlyActivityRow) => {
    return {
      itemsListed: allPlatforms.reduce((sum, p) => sum + row.platforms[p].itemsListed, 0),
      listingValue: allPlatforms.reduce((sum, p) => sum + row.platforms[p].listingValue, 0),
      itemsSold: allPlatforms.reduce((sum, p) => sum + row.platforms[p].itemsSold, 0),
      soldValue: allPlatforms.reduce((sum, p) => sum + row.platforms[p].soldValue, 0),
    };
  };

  return (
    <>
      <Header title="Daily Activity Report" />
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
              <h1 className="text-2xl font-bold">Daily Activity Report</h1>
              <p className="text-muted-foreground">
                Track listings, sales, and store status by platform
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Column Visibility Toggle */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon">
                  <Settings2 className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Show Columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={columnVisibility.amazon}
                  onCheckedChange={() => toggleColumnVisibility('amazon')}
                >
                  Amazon
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={columnVisibility.ebay}
                  onCheckedChange={() => toggleColumnVisibility('ebay')}
                >
                  eBay
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={columnVisibility.bricklink}
                  onCheckedChange={() => toggleColumnVisibility('bricklink')}
                >
                  BrickLink
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={columnVisibility.total}
                  onCheckedChange={() => toggleColumnVisibility('total')}
                >
                  TOTAL
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Select
              value={granularity}
              onValueChange={(v: string) => setGranularity(v as typeof granularity)}
            >
              <SelectTrigger className="w-[120px]">
                <SelectValue placeholder="View" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
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
              Export
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
            {/* Summary Stats */}
            <div className="grid gap-4 md:grid-cols-4">
              <StatCard
                title="Total Listed"
                value={report?.summary.grandTotals.totalItemsListed || 0}
                format="number"
                icon={<BarChart3 className="h-4 w-4 text-muted-foreground" />}
              />
              <StatCard
                title="Listing Value"
                value={report?.summary.grandTotals.totalListingValue || 0}
                format="currency"
              />
              <StatCard
                title="Total Sold"
                value={report?.summary.grandTotals.totalItemsSold || 0}
                format="number"
                icon={<Calendar className="h-4 w-4 text-muted-foreground" />}
              />
              <StatCard
                title="Sold Value"
                value={report?.summary.grandTotals.totalSoldValue || 0}
                format="currency"
              />
            </div>

            {/* Main Data Table */}
            <Card>
              <CardHeader>
                <CardTitle>{granularity === 'daily' ? 'Daily' : 'Monthly'} Activity</CardTitle>
                <CardDescription>
                  Listings and sales per platform
                  {granularity === 'daily' && ' with store status tracking'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead
                          className="sticky left-0 bg-background z-10 min-w-[100px]"
                          rowSpan={2}
                        >
                          {granularity === 'daily' ? 'Date' : 'Month'}
                        </TableHead>
                        {visiblePlatforms.map((platform) => (
                          <TableHead
                            key={platform}
                            colSpan={granularity === 'daily' ? 5 : 4}
                            className="text-center border-l bg-muted/50"
                          >
                            {formatPlatformName(platform)}
                          </TableHead>
                        ))}
                        {columnVisibility.total && (
                          <TableHead
                            colSpan={4}
                            className="text-center border-l bg-blue-50 dark:bg-blue-950"
                          >
                            {formatPlatformName('total')}
                          </TableHead>
                        )}
                      </TableRow>
                      <TableRow>
                        {visiblePlatforms.map((platform) => (
                          <Fragment key={`${platform}-headers`}>
                            <TableHead className="text-right border-l text-xs w-[60px]">
                              Listed
                            </TableHead>
                            <TableHead className="text-right text-xs w-[80px]">Value</TableHead>
                            <TableHead className="text-right text-xs w-[60px]">Sold</TableHead>
                            <TableHead className="text-right text-xs w-[80px]">Value</TableHead>
                            {granularity === 'daily' && (
                              <TableHead className="text-center text-xs w-[70px]">Status</TableHead>
                            )}
                          </Fragment>
                        ))}
                        {columnVisibility.total && (
                          <>
                            <TableHead className="text-right border-l text-xs w-[60px] bg-blue-50/50 dark:bg-blue-950/50">
                              Listed
                            </TableHead>
                            <TableHead className="text-right text-xs w-[80px] bg-blue-50/50 dark:bg-blue-950/50">
                              Value
                            </TableHead>
                            <TableHead className="text-right text-xs w-[60px] bg-blue-50/50 dark:bg-blue-950/50">
                              Sold
                            </TableHead>
                            <TableHead className="text-right text-xs w-[80px] bg-blue-50/50 dark:bg-blue-950/50">
                              Value
                            </TableHead>
                          </>
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report?.data.map((row) => {
                        const rowTotals = getRowTotals(row);
                        return (
                          <TableRow key={isDailyRow(row) ? row.date : row.month}>
                            <TableCell className="sticky left-0 bg-background z-10 font-medium whitespace-nowrap">
                              {isDailyRow(row) ? row.dateLabel : row.monthLabel}
                            </TableCell>
                            {visiblePlatforms.map((platform) => {
                              const platformData = row.platforms[platform];
                              return (
                                <Fragment
                                  key={`${isDailyRow(row) ? row.date : row.month}-${platform}`}
                                >
                                  <TableCell className="text-right border-l tabular-nums">
                                    {platformData.itemsListed > 0 ? platformData.itemsListed : '-'}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">
                                    {platformData.listingValue > 0
                                      ? formatCurrency(platformData.listingValue)
                                      : '-'}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">
                                    {platformData.itemsSold > 0 ? platformData.itemsSold : '-'}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">
                                    {platformData.soldValue > 0
                                      ? formatCurrency(platformData.soldValue)
                                      : '-'}
                                  </TableCell>
                                  {granularity === 'daily' && isDailyRow(row) && (
                                    <TableCell className="text-center">
                                      <StoreStatusSelector
                                        date={row.date}
                                        platform={platform}
                                        currentStatus={
                                          'storeStatus' in platformData
                                            ? platformData.storeStatus
                                            : null
                                        }
                                        onStatusChange={handleStatusChange}
                                        disabled={updateStatusMutation.isPending}
                                      />
                                    </TableCell>
                                  )}
                                </Fragment>
                              );
                            })}
                            {columnVisibility.total && (
                              <>
                                <TableCell className="text-right border-l tabular-nums font-medium bg-blue-50/30 dark:bg-blue-950/30">
                                  {rowTotals.itemsListed > 0 ? rowTotals.itemsListed : '-'}
                                </TableCell>
                                <TableCell className="text-right tabular-nums font-medium bg-blue-50/30 dark:bg-blue-950/30">
                                  {rowTotals.listingValue > 0
                                    ? formatCurrency(rowTotals.listingValue)
                                    : '-'}
                                </TableCell>
                                <TableCell className="text-right tabular-nums font-medium bg-blue-50/30 dark:bg-blue-950/30">
                                  {rowTotals.itemsSold > 0 ? rowTotals.itemsSold : '-'}
                                </TableCell>
                                <TableCell className="text-right tabular-nums font-medium bg-blue-50/30 dark:bg-blue-950/30">
                                  {rowTotals.soldValue > 0
                                    ? formatCurrency(rowTotals.soldValue)
                                    : '-'}
                                </TableCell>
                              </>
                            )}
                          </TableRow>
                        );
                      })}
                      {/* Totals Row */}
                      <TableRow className="border-t-2 font-bold bg-muted/30">
                        <TableCell className="sticky left-0 bg-muted/30 z-10">Totals</TableCell>
                        {visiblePlatforms.map((platform) => {
                          const platformTotals = report?.summary.platforms[platform];
                          return (
                            <Fragment key={`totals-${platform}`}>
                              <TableCell className="text-right border-l tabular-nums">
                                {platformTotals?.totalItemsListed || 0}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatCurrency(platformTotals?.totalListingValue || 0)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {platformTotals?.totalItemsSold || 0}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatCurrency(platformTotals?.totalSoldValue || 0)}
                              </TableCell>
                              {granularity === 'daily' && <TableCell />}
                            </Fragment>
                          );
                        })}
                        {columnVisibility.total && (
                          <>
                            <TableCell className="text-right border-l tabular-nums bg-blue-100/50 dark:bg-blue-900/50">
                              {report?.summary.grandTotals.totalItemsListed || 0}
                            </TableCell>
                            <TableCell className="text-right tabular-nums bg-blue-100/50 dark:bg-blue-900/50">
                              {formatCurrency(report?.summary.grandTotals.totalListingValue || 0)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums bg-blue-100/50 dark:bg-blue-900/50">
                              {report?.summary.grandTotals.totalItemsSold || 0}
                            </TableCell>
                            <TableCell className="text-right tabular-nums bg-blue-100/50 dark:bg-blue-900/50">
                              {formatCurrency(report?.summary.grandTotals.totalSoldValue || 0)}
                            </TableCell>
                          </>
                        )}
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* Status Legend */}
            {granularity === 'daily' && (
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm">Store Status Legend</CardTitle>
                </CardHeader>
                <CardContent className="flex gap-6 py-2">
                  <div className="flex items-center gap-2">
                    <Badge className={getStatusBadgeColor('O')}>O</Badge>
                    <span className="text-sm">Open</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={getStatusBadgeColor('C')}>C</Badge>
                    <span className="text-sm">Closed</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={getStatusBadgeColor('H')}>H</Badge>
                    <span className="text-sm">Holiday</span>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </>
  );
}
