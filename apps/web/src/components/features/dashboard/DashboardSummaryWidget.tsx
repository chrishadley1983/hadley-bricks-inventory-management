'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Loader2, TrendingUp, Calendar, Target } from 'lucide-react';
import { useProfitLossReport, useDailyActivityReport, useReportSettings } from '@/hooks/use-reports';
import { formatCurrency, cn } from '@/lib/utils';

// Default target if settings haven't loaded yet
const DEFAULT_DAILY_TARGET = 200;

/**
 * Get the Monday of the current week (or today if today is Monday)
 */
function getMondayOfCurrentWeek(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, etc.
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(today);
  monday.setDate(today.getDate() - daysFromMonday);
  return monday;
}

/**
 * Get today's date at midnight
 */
function getToday(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

/**
 * Get the last 12 months date range
 */
function getLast12MonthsRange(): { startDate: Date; endDate: Date } {
  const today = new Date();
  const endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0); // End of current month
  const startDate = new Date(today.getFullYear() - 1, today.getMonth() + 1, 1); // Start of same month last year
  return { startDate, endDate };
}

/**
 * Get current month date range
 */
function getCurrentMonthRange(): { startDate: Date; endDate: Date } {
  const today = new Date();
  const startDate = new Date(today.getFullYear(), today.getMonth(), 1);
  const endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return { startDate, endDate };
}

interface ListingPerformanceRow {
  label: string;
  actual: number;
  target: number;
  diff: number;
  percentage: number;
}

/**
 * Dashboard Summary Widget
 * Shows Annual Revenue, This Month Revenue/Profit, and Listing Value Performance
 */
export function DashboardSummaryWidget() {
  // Date ranges
  const last12Months = useMemo(() => getLast12MonthsRange(), []);
  const currentMonth = useMemo(() => getCurrentMonthRange(), []);
  const today = useMemo(() => getToday(), []);
  const monday = useMemo(() => getMondayOfCurrentWeek(), []);

  // Fetch settings for daily target
  const { data: settings } = useReportSettings();
  const dailyTarget = settings?.dailyListingTarget || DEFAULT_DAILY_TARGET;

  // Fetch P&L report for last 12 months
  const { data: annualReport, isLoading: annualLoading } = useProfitLossReport(
    last12Months,
    false
  );

  // Fetch P&L report for current month
  const { data: monthReport, isLoading: monthLoading } = useProfitLossReport(
    currentMonth,
    false
  );

  // Fetch daily activity for today
  const { data: todayActivity, isLoading: todayLoading } = useDailyActivityReport(
    { startDate: today, endDate: today },
    'daily'
  );

  // Fetch daily activity for this week (Monday to today)
  const { data: weekActivity, isLoading: weekLoading } = useDailyActivityReport(
    { startDate: monday, endDate: today },
    'daily'
  );

  // Calculate annual turnover (sum of Income category across all months)
  const annualTurnover = useMemo(() => {
    if (!annualReport?.categoryTotals?.Income) return 0;
    return Object.values(annualReport.categoryTotals.Income).reduce(
      (sum, val) => sum + val,
      0
    );
  }, [annualReport]);

  // Calculate this month turnover
  const monthTurnover = useMemo(() => {
    if (!monthReport?.categoryTotals?.Income) return 0;
    return Object.values(monthReport.categoryTotals.Income).reduce(
      (sum, val) => sum + val,
      0
    );
  }, [monthReport]);

  // Calculate this month profit (grand total)
  const monthProfit = useMemo(() => {
    if (!monthReport?.grandTotal) return 0;
    return Object.values(monthReport.grandTotal).reduce((sum, val) => sum + val, 0);
  }, [monthReport]);

  // Calculate today's listing value
  const todayListingValue = useMemo(() => {
    return todayActivity?.summary?.grandTotals?.totalListingValue || 0;
  }, [todayActivity]);

  // Calculate this week's listing value
  const weekListingValue = useMemo(() => {
    return weekActivity?.summary?.grandTotals?.totalListingValue || 0;
  }, [weekActivity]);

  // Calculate number of days from Monday to today (inclusive)
  const daysInWeek = useMemo(() => {
    const diffTime = today.getTime() - monday.getTime();
    return Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;
  }, [today, monday]);

  // Build listing performance data
  const listingPerformance: ListingPerformanceRow[] = useMemo(() => {
    const todayTargetValue = dailyTarget;
    const weekTargetValue = dailyTarget * daysInWeek;

    return [
      {
        label: 'Today',
        actual: todayListingValue,
        target: todayTargetValue,
        diff: todayListingValue - todayTargetValue,
        percentage: todayTargetValue > 0 ? (todayListingValue / todayTargetValue) * 100 : 0,
      },
      {
        label: 'This Week',
        actual: weekListingValue,
        target: weekTargetValue,
        diff: weekListingValue - weekTargetValue,
        percentage: weekTargetValue > 0 ? (weekListingValue / weekTargetValue) * 100 : 0,
      },
    ];
  }, [todayListingValue, weekListingValue, daysInWeek, dailyTarget]);

  const isLoading = annualLoading || monthLoading || todayLoading || weekLoading;

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {/* Annual Revenue */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Annual Turnover</CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {annualLoading ? (
            <div className="flex items-center justify-center py-2">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="text-2xl font-bold">{formatCurrency(annualTurnover)}</div>
              <p className="text-xs text-muted-foreground">Rolling 12 Months</p>
            </>
          )}
        </CardContent>
      </Card>

      {/* This Month Revenue */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Turnover This Month</CardTitle>
          <Calendar className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {monthLoading ? (
            <div className="flex items-center justify-center py-2">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="text-2xl font-bold">{formatCurrency(monthTurnover)}</div>
              <p className="text-xs text-muted-foreground">
                {new Date().toLocaleString('en-GB', { month: 'long', year: 'numeric' })}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* This Month Profit */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Profit This Month</CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {monthLoading ? (
            <div className="flex items-center justify-center py-2">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div
                className={cn(
                  'text-2xl font-bold',
                  monthProfit >= 0 ? 'text-green-600' : 'text-red-600'
                )}
              >
                {formatCurrency(monthProfit)}
              </div>
              <p className="text-xs text-muted-foreground">Net profit after all costs</p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Listing Value Performance */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Listing Performance</CardTitle>
          <Target className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent className="px-2 pb-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-2">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-b-0">
                  <TableHead className="h-7 px-2 text-xs">Period</TableHead>
                  <TableHead className="h-7 px-2 text-xs text-right">Target</TableHead>
                  <TableHead className="h-7 px-2 text-xs text-right">Diff</TableHead>
                  <TableHead className="h-7 px-2 text-xs text-right">%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listingPerformance.map((row) => (
                  <TableRow key={row.label} className="border-b-0">
                    <TableCell className="py-1 px-2 text-xs font-medium">{row.label}</TableCell>
                    <TableCell className="py-1 px-2 text-xs text-right tabular-nums">
                      {formatCurrency(row.target)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'py-1 px-2 text-xs text-right tabular-nums',
                        row.diff >= 0 ? 'text-green-600' : 'text-red-600'
                      )}
                    >
                      {row.diff >= 0 ? '+' : ''}
                      {formatCurrency(row.diff)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'py-1 px-2 text-xs text-right tabular-nums',
                        row.percentage >= 100 ? 'text-green-600' : 'text-amber-600'
                      )}
                    >
                      {row.percentage.toFixed(0)}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
