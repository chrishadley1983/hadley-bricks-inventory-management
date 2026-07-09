'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, TrendingUp, CalendarDays, PiggyBank, Target } from 'lucide-react';
import {
  useProfitLossReport,
  useDailyActivityReport,
  useReportSettings,
} from '@/hooks/use-reports';
import { formatCurrency, cn } from '@/lib/utils';
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

function KpiCard({
  title,
  icon,
  iconClass,
  isLoading,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  iconClass: string;
  isLoading: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </CardTitle>
        <div className={cn('flex h-7 w-7 items-center justify-center rounded-md', iconClass)}>
          {icon}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-3">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          children
        )}
      </CardContent>
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
          <span className="text-muted-foreground"> / {formatCurrency(target)}</span>
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-2 rounded-full', met ? 'bg-emerald-500' : 'bg-amber-500')}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <div className="text-right text-[11px] tabular-nums text-muted-foreground">
        {pct.toFixed(0)}% of target
      </div>
    </div>
  );
}

/**
 * Dashboard Summary Widget
 * Hero KPI band: annual turnover (with 12-month sparkline), month turnover
 * (with pace projection), month profit (with margin), and listing performance
 * vs target (actuals shown, not just diffs).
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

  // Monthly income series for the sparkline (ordered by report.months)
  const monthlyIncome = useMemo(() => {
    if (!annualReport?.months) return { values: [] as number[], labels: [] as string[] };
    const income = annualReport.categoryTotals?.Income ?? {};
    return {
      values: annualReport.months.map((m) => income[m] ?? 0),
      labels: annualReport.months.map((m) => {
        const [y, mo] = m.split('-').map(Number);
        const name = new Date(y, mo - 1, 1).toLocaleString('en-GB', { month: 'short' });
        return `${name} ${y}: ${formatCurrency(income[m] ?? 0)}`;
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
      <KpiCard
        title="Annual Turnover"
        icon={<TrendingUp className="h-4 w-4 text-teal-700" />}
        iconClass="bg-teal-100"
        isLoading={annualLoading}
      >
        <div className="text-3xl font-bold tracking-tight tabular-nums">
          {formatCurrency(annualTurnover)}
        </div>
        <p className="text-xs text-muted-foreground">Rolling 12 months</p>
        <div className="mt-3">
          <BarSparkline values={monthlyIncome.values} labels={monthlyIncome.labels} />
        </div>
      </KpiCard>

      {/* This month turnover + pace */}
      <KpiCard
        title="Turnover This Month"
        icon={<CalendarDays className="h-4 w-4 text-blue-700" />}
        iconClass="bg-blue-100"
        isLoading={monthLoading}
      >
        <div className="text-3xl font-bold tracking-tight tabular-nums">
          {formatCurrency(monthTurnover)}
        </div>
        <p className="text-xs text-muted-foreground">{monthLabel}</p>
        {monthPace > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            On pace for{' '}
            <span className="font-semibold text-foreground tabular-nums">
              £{Math.round(monthPace).toLocaleString()}
            </span>{' '}
            this month
          </p>
        )}
      </KpiCard>

      {/* This month profit + margin */}
      <KpiCard
        title="Profit This Month"
        icon={<PiggyBank className="h-4 w-4 text-emerald-700" />}
        iconClass="bg-emerald-100"
        isLoading={monthLoading}
      >
        <div
          className={cn(
            'text-3xl font-bold tracking-tight tabular-nums',
            monthProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'
          )}
        >
          {formatCurrency(monthProfit)}
        </div>
        <p className="text-xs text-muted-foreground">Net profit after all costs</p>
        {profitMargin != null && (
          <span
            className={cn(
              'mt-3 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums',
              profitMargin >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
            )}
          >
            {profitMargin.toFixed(0)}% margin
          </span>
        )}
      </KpiCard>

      {/* Listing performance vs target */}
      <KpiCard
        title="Listing Performance"
        icon={<Target className="h-4 w-4 text-amber-700" />}
        iconClass="bg-amber-100"
        isLoading={todayLoading || weekLoading}
      >
        <div className="space-y-3">
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
