'use client';

import { useState } from 'react';
import { ShoppingCart, Package, TrendingUp, DollarSign, Target } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { MetricCard } from './MetricCard';
import { useWeeklyMetrics, formatCurrency } from '@/hooks/use-metrics';

type ViewMode = 'daily' | 'weekly';

interface WeeklyTargetsPanelProps {
  className?: string;
}

export function WeeklyTargetsPanel({ className }: WeeklyTargetsPanelProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('daily');
  const { data: metrics, isLoading, error } = useWeeklyMetrics();

  if (isLoading) {
    return <WeeklyTargetsPanelSkeleton />;
  }

  if (error || !metrics) {
    return (
      <Card className={className} data-testid="weekly-targets-panel">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="h-4 w-4" />
            Targets
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground">
            Unable to load metrics
          </div>
        </CardContent>
      </Card>
    );
  }

  // Calculate values based on view mode
  const isWeekly = viewMode === 'weekly';

  // For weekly view: sum the history (last 7 days) for listed/sold values
  // For daily view: use today's values
  const listedValue = isWeekly
    ? metrics.weekTotals.listedValue
    : metrics.dailyListedValue.current;
  const listedTarget = isWeekly
    ? metrics.targets.dailyListedValue * 7
    : metrics.targets.dailyListedValue;

  const soldValue = isWeekly
    ? metrics.weekTotals.soldValue
    : metrics.dailySoldValue.current;
  const soldTarget = isWeekly
    ? metrics.targets.dailySoldValue * 7
    : metrics.targets.dailySoldValue;

  // BrickLink is already a weekly metric - for daily we show average
  const bricklinkValue = isWeekly
    ? metrics.bricklinkWeeklyValue.current
    : Math.round(metrics.bricklinkWeeklyValue.current / 7);
  const bricklinkTarget = isWeekly
    ? metrics.bricklinkWeeklyValue.target
    : Math.round(metrics.bricklinkWeeklyValue.target / 7);

  // Listing counts - use daily or weekly counts based on view mode
  const ebayListingsCount = isWeekly
    ? metrics.listingCounts.ebay
    : (metrics.dailyListingCounts?.ebay ?? 0);
  const amazonListingsCount = isWeekly
    ? metrics.listingCounts.amazon
    : (metrics.dailyListingCounts?.amazon ?? 0);

  // Listing count targets - weekly targets divided by 7 for daily view
  const ebayListingsTarget = isWeekly
    ? metrics.targets.ebayListings
    : Math.round(metrics.targets.ebayListings / 7);
  const amazonListingsTarget = isWeekly
    ? metrics.targets.amazonListings
    : Math.round(metrics.targets.amazonListings / 7);

  return (
    <Card className={className} data-testid="weekly-targets-panel">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Target className="h-4 w-4" />
              {isWeekly ? 'Weekly' : 'Daily'} Targets
            </CardTitle>
            <ToggleGroup
              type="single"
              value={viewMode}
              onValueChange={(value: string) => value && setViewMode(value as ViewMode)}
              className="h-7"
            >
              <ToggleGroupItem value="daily" className="h-7 px-2 text-xs">
                Daily
              </ToggleGroupItem>
              <ToggleGroupItem value="weekly" className="h-7 px-2 text-xs">
                Weekly
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span>
              Week: {formatCurrency(metrics.weekTotals.listedValue)} listed •{' '}
              {formatCurrency(metrics.weekTotals.soldValue)} sold
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-5">
          {/* eBay Listed Value - value target scales with view mode */}
          <MetricCard
            label={isWeekly ? 'eBay Listed Value' : 'eBay Listed Value'}
            current={ebayListingsCount}
            target={ebayListingsTarget}
            isCurrency
            icon={<Package className="h-4 w-4" />}
          />

          {/* Amazon Listed Value - value target scales with view mode */}
          <MetricCard
            label={isWeekly ? 'Amazon Listed Value' : 'Amazon Listed Value'}
            current={amazonListingsCount}
            target={amazonListingsTarget}
            isCurrency
            icon={<Package className="h-4 w-4" />}
          />

          {/* BrickLink Value - weekly or daily average */}
          <MetricCard
            label={isWeekly ? 'BrickLink Weekly' : 'BrickLink Daily'}
            current={bricklinkValue}
            target={bricklinkTarget}
            history={metrics.bricklinkWeeklyValue.history}
            isCurrency
            icon={<TrendingUp className="h-4 w-4" />}
          />

          {/* Listed Value - daily or weekly */}
          <MetricCard
            label={isWeekly ? 'Week Listed' : 'Today Listed'}
            current={listedValue}
            target={listedTarget}
            history={metrics.dailyListedValue.history}
            isCurrency
            icon={<DollarSign className="h-4 w-4" />}
          />

          {/* Sold Value - daily or weekly */}
          <MetricCard
            label={isWeekly ? 'Week Sold' : 'Today Sold'}
            current={soldValue}
            target={soldTarget}
            history={metrics.dailySoldValue.history}
            isCurrency
            icon={<ShoppingCart className="h-4 w-4" />}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function WeeklyTargetsPanelSkeleton() {
  return (
    <Card data-testid="weekly-targets-panel">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-48" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-5">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="space-y-2">
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-5 w-16" />
              </div>
              <Skeleton className="h-8 w-32" />
              <Skeleton className="h-2 w-full" />
              <div className="flex justify-between">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-8" />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
