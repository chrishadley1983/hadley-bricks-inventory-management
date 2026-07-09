'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  useProfitLossReport,
  useDailyActivityReport,
  useReportSettings,
} from '@/hooks/use-reports';
import { formatCurrency, formatCurrencyWhole, cn } from '@/lib/utils';
import { BarSparkline } from './Sparkline';

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

function KpiSkeleton() {
  return (
    <div className="space-y-2">
      <div className="h-8 w-28 animate-pulse rounded bg-muted" />
      <div className="h-3 w-20 animate-pulse rounded bg-muted" />
    </div>
  );
}

function KpiCard({
  title,
  isLoading,
  children,
}: {
  title: string;
  isLoading: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{isLoading ? <KpiSkeleton /> : children}</CardContent>
    </Card>
  );
}

function TargetRow({ label, actual, target }: { label: string; actual: number; target: number }) {
  const pct = target > 0 ? (actual / target) * 100 : 0;
  const met = pct >= 100;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums">
          <span className={cn('font-semibold', met ? 'text-emerald-600' : 'text-foreground')}>
            {formatCurrency(actual)}
          </span>
          <span className="text-muted-foreground"> / {formatCurrencyWhole(target)}</span>
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-2 rounded-full', met ? 'bg-emerald-500' : 'bg-primary')}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Dashboard Summary Widget
 * Hero KPI band: annual turnover (with 12-month sparkline), month turnover
 * (with pace projection), month profit (with net margin), and listing value
 * added vs target.
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
  const { data: annualReport, isLoading: annualLoading } = useProfitLossReport(last12Months, false);

  // Fetch P&L report for current month
  const { data: monthReport, isLoading: monthLoading } = useProfitLossReport(currentMonth, false);

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

  // Monthly income series for the sparkline (ordered by report.months; the
  // final month is the in-progress one — labelled and rendered as provisional)
  const monthlyIncome = useMemo(() => {
    if (!annualReport?.months) return { values: [] as number[], labels: [] as string[] };
    const income = annualReport.categoryTotals?.Income ?? {};
    const last = annualReport.months.length - 1;
    return {
      values: annualReport.months.map((m) => income[m] ?? 0),
      labels: annualReport.months.map((m, i) => {
        const [y, mo] = m.split('-').map(Number);
        const name = new Date(y, mo - 1, 1).toLocaleString('en-GB', { month: 'short' });
        return `${name} ${y}: ${formatCurrency(income[m] ?? 0)}${i === last ? ' (month to date)' : ''}`;
      }),
    };
  }, [annualReport]);

  const annualTurnover = useMemo(
    () => monthlyIncome.values.reduce((sum, v) => sum + v, 0),
    [monthlyIncome]
  );

  // Calculate this month turnover
  const monthTurnover = useMemo(() => {
    if (!monthReport?.categoryTotals?.Income) return 0;
    return Object.values(monthReport.categoryTotals.Income).reduce((sum, val) => sum + val, 0);
  }, [monthReport]);

  // Calculate this month profit (grand total)
  const monthProfit = useMemo(() => {
    if (!monthReport?.grandTotal) return 0;
    return Object.values(monthReport.grandTotal).reduce((sum, val) => sum + val, 0);
  }, [monthReport]);

  // Month pace projection (grounded: actual ÷ elapsed days × days in month)
  const monthPace = useMemo(() => {
    const now = new Date();
    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return dayOfMonth > 0 ? (monthTurnover / dayOfMonth) * daysInMonth : 0;
  }, [monthTurnover]);

  const profitMargin = monthTurnover > 0 ? (monthProfit / monthTurnover) * 100 : null;

  const todayListingValue = todayActivity?.summary?.grandTotals?.totalListingValue || 0;
  const weekListingValue = weekActivity?.summary?.grandTotals?.totalListingValue || 0;

  // Number of days from Monday to today (inclusive), calendar-based (DST-safe)
  const daysInWeek = useMemo(() => {
    let count = 0;
    const d = new Date(monday);
    while (d <= today) {
      count++;
      d.setDate(d.getDate() + 1);
    }
    return count;
  }, [today, monday]);

  const monthLabel = new Date().toLocaleString('en-GB', { month: 'long', year: 'numeric' });

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {/* Annual turnover + 12-month trend */}
      <KpiCard title="Annual Turnover" isLoading={annualLoading}>
        <div className="text-3xl font-bold tracking-tight tabular-nums">
          {formatCurrencyWhole(annualTurnover)}
        </div>
        <p className="text-xs text-muted-foreground">Rolling 12 months · current month to date</p>
        <div className="mt-3">
          <BarSparkline
            values={monthlyIncome.values}
            labels={monthlyIncome.labels}
            emphasisColor="#0f172a"
          />
        </div>
      </KpiCard>

      {/* This month turnover + pace */}
      <KpiCard title="Turnover This Month" isLoading={monthLoading}>
        <div className="text-3xl font-bold tracking-tight tabular-nums">
          {formatCurrencyWhole(monthTurnover)}
        </div>
        <p className="text-xs text-muted-foreground">{monthLabel}</p>
        {monthPace > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            On pace for{' '}
            <span className="font-semibold text-foreground tabular-nums">
              {formatCurrencyWhole(monthPace)}
            </span>{' '}
            this month
          </p>
        )}
      </KpiCard>

      {/* This month profit + net margin */}
      <KpiCard title="Profit This Month" isLoading={monthLoading}>
        <div
          className={cn(
            'text-3xl font-bold tracking-tight tabular-nums',
            monthProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'
          )}
        >
          {formatCurrencyWhole(monthProfit)}
        </div>
        <p className="text-xs text-muted-foreground">Net profit after all costs</p>
        {profitMargin != null && (
          <p
            className={cn(
              'mt-3 text-xs tabular-nums',
              profitMargin >= 0 ? 'text-muted-foreground' : 'text-rose-600'
            )}
          >
            {profitMargin.toFixed(0)}% net margin
          </p>
        )}
      </KpiCard>

      {/* Listing value added vs target */}
      <KpiCard title="Listing Value Added" isLoading={todayLoading || weekLoading}>
        <div className="text-3xl font-bold tracking-tight tabular-nums">
          {formatCurrency(todayListingValue)}
        </div>
        <p className="text-xs text-muted-foreground">Value of stock listed today vs target</p>
        <div className="mt-3 space-y-2.5">
          <TargetRow label="Today" actual={todayListingValue} target={dailyTarget} />
          <TargetRow
            label="This Week"
            actual={weekListingValue}
            target={dailyTarget * daysInWeek}
          />
        </div>
      </KpiCard>
    </div>
  );
}
