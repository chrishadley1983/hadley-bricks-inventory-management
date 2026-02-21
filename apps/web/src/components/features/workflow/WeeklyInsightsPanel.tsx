'use client';

import { useState } from 'react';
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Clock,
  Package,
  Truck,
  Zap,
  Target,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { InsightCard } from './InsightCard';
import {
  useWeeklyInsights,
  formatDuration,
  getProductivityLabel,
  getProductivityColor,
} from '@/hooks/use-workflow-config';
import { cn } from '@/lib/utils';

export function WeeklyInsightsPanel() {
  const [weekOffset, setWeekOffset] = useState(0);
  const { data: insights, isLoading } = useWeeklyInsights(weekOffset);

  // Calculate week dates for display
  const getWeekLabel = () => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayOfWeek = today.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() + mondayOffset - weekOffset * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);

    if (weekOffset === 0) return 'This Week';
    if (weekOffset === 1) return 'Last Week';

    return `${weekStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} - ${weekEnd.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
  };

  const formatCurrency = (value: number): string => {
    return `£${value.toLocaleString('en-GB', { minimumFractionDigits: 0 })}`;
  };

  const formatHour = (hour: number): string => {
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    return `${hour12}${ampm}`;
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!insights) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <BarChart3 className="h-4 w-4" />
          Weekly Insights
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => setWeekOffset((w) => w + 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium min-w-[100px] text-center">{getWeekLabel()}</span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setWeekOffset((w) => Math.max(0, w - 1))}
            disabled={weekOffset === 0}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Main metrics grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <InsightCard
            title="Time Tracked"
            value={formatDuration(insights.timeTracked.total)}
            trend={insights.timeTracked.trend}
            icon={<Clock className="h-4 w-4" />}
          />
          <InsightCard
            title="Pomodoros"
            value={`${insights.pomodoro.completed}/${insights.pomodoro.target}`}
            subtitle={`${insights.pomodoro.streak} day streak`}
            icon={<Target className="h-4 w-4" />}
          />
          <InsightCard
            title="Listed Value"
            value={formatCurrency(insights.listings.listedValue)}
            subtitle={`${insights.listings.created} items`}
            icon={<Package className="h-4 w-4" />}
          />
          <InsightCard
            title="Sold Value"
            value={formatCurrency(insights.listings.soldValue)}
            subtitle={`${insights.listings.sold} sales`}
            icon={<Package className="h-4 w-4" />}
          />
        </div>

        {/* Time breakdown and productivity */}
        <div className="grid md:grid-cols-2 gap-4">
          {/* Time by category */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium">Time by Category</h4>
            {insights.timeTracked.byCategory.length > 0 ? (
              <div className="space-y-2">
                {insights.timeTracked.byCategory.map((cat) => {
                  const percentage =
                    insights.timeTracked.total > 0
                      ? Math.round((cat.minutes / insights.timeTracked.total) * 100)
                      : 0;
                  return (
                    <div key={cat.name} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <div
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: cat.color }}
                          />
                          <span className="capitalize">{cat.name}</span>
                        </div>
                        <span className="text-muted-foreground">
                          {formatDuration(cat.minutes)} ({percentage}%)
                        </span>
                      </div>
                      <Progress
                        value={percentage}
                        className="h-1.5"
                        style={
                          {
                            '--progress-background': cat.color,
                          } as React.CSSProperties
                        }
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No time tracked this week</p>
            )}
          </div>

          {/* Productivity insights */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium">Productivity</h4>
            <div className="rounded-lg border p-4 space-y-3">
              {/* Score */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-amber-500" />
                  <span className="text-sm">Productivity Score</span>
                </div>
                <div className="text-right">
                  <span
                    className={cn(
                      'text-lg font-bold',
                      getProductivityColor(insights.productivity.score)
                    )}
                  >
                    {insights.productivity.score}
                  </span>
                  <span className="text-xs text-muted-foreground ml-1">/ 100</span>
                  <p className="text-xs text-muted-foreground">
                    {getProductivityLabel(insights.productivity.score)}
                  </p>
                </div>
              </div>

              {/* Best day */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Best Day</span>
                <span className="font-medium">{insights.productivity.bestDay}</span>
              </div>

              {/* Most productive hour */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Peak Hour</span>
                <span className="font-medium">
                  {formatHour(insights.productivity.mostProductiveHour)}
                </span>
              </div>

              {/* Pomodoro average */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Daily Pomodoros (avg)</span>
                <span className="font-medium">{insights.pomodoro.averagePerDay.toFixed(1)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Pickups row */}
        {insights.pickups.completed > 0 && (
          <div className="rounded-lg border p-4">
            <div className="flex items-center gap-2 mb-3">
              <Truck className="h-4 w-4" />
              <h4 className="text-sm font-medium">Stock Pickups</h4>
            </div>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold">{insights.pickups.completed}</p>
                <p className="text-xs text-muted-foreground">Completed</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{formatCurrency(insights.pickups.totalSpent)}</p>
                <p className="text-xs text-muted-foreground">Spent</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{insights.pickups.mileage}</p>
                <p className="text-xs text-muted-foreground">Miles</p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
