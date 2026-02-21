'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Plus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  useTimeSummary,
  formatDuration,
  getCategoryColor,
  type TimeCategory,
} from '@/hooks/use-time-tracking';
import { TimeEntryDialog } from './TimeEntryDialog';

interface TimeBreakdownSectionProps {
  className?: string;
}

const CATEGORIES: TimeCategory[] = [
  'Development',
  'Listing',
  'Shipping',
  'Sourcing',
  'Admin',
  'Other',
];

export function TimeBreakdownSection({ className }: TimeBreakdownSectionProps) {
  const { data: summary, isLoading, isError } = useTimeSummary();
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  if (isLoading) {
    return (
      <Card className={className} data-testid="time-breakdown">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Time Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="h-8 animate-pulse rounded bg-muted" />
            <div className="h-8 animate-pulse rounded bg-muted" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isError || !summary) {
    return (
      <Card className={className} data-testid="time-breakdown">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Time Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Unable to load time data</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className} data-testid="time-breakdown">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Time Breakdown</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Today */}
        <div>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium">Today</span>
            <span className="text-muted-foreground">{formatDuration(summary.today.total)}</span>
          </div>
          <TimeBar data={summary.today.byCategory} total={summary.today.total} />
        </div>

        {/* This Week */}
        <div>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium">This Week</span>
            <span className="text-muted-foreground">{formatDuration(summary.week.total)}</span>
          </div>
          <TimeBar data={summary.week.byCategory} total={summary.week.total} />
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-3 pt-2">
          {CATEGORIES.map((category) => {
            const weekSeconds = summary.week.byCategory[category] || 0;
            if (weekSeconds === 0) return null;

            return (
              <div key={category} className="flex items-center gap-1.5 text-xs">
                <div
                  className="h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: getCategoryColor(category) }}
                />
                <span className="text-muted-foreground">
                  {category} ({formatDuration(weekSeconds)})
                </span>
              </div>
            );
          })}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-2">
          <Link
            href="/time-tracking"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            View full log
            <ArrowRight className="h-3 w-3" />
          </Link>
          <Button variant="outline" size="sm" onClick={() => setAddDialogOpen(true)}>
            <Plus className="mr-1 h-3 w-3" />
            Add Entry
          </Button>
        </div>
      </CardContent>

      {/* Add Manual Entry Dialog */}
      <TimeEntryDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        mode="add"
        entry={null}
      />
    </Card>
  );
}

interface TimeBarProps {
  data: Record<TimeCategory, number>;
  total: number;
}

function TimeBar({ data, total }: TimeBarProps) {
  if (total === 0) {
    return (
      <div className="h-6 rounded bg-muted">
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          No time tracked
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-6 overflow-hidden rounded">
      {CATEGORIES.map((category) => {
        const seconds = data[category] || 0;
        if (seconds === 0) return null;

        const percentage = (seconds / total) * 100;

        return (
          <div
            key={category}
            className="flex items-center justify-center text-xs font-medium text-white transition-all"
            style={{
              backgroundColor: getCategoryColor(category),
              width: `${percentage}%`,
              minWidth: percentage > 5 ? '24px' : '0',
            }}
            title={`${category}: ${formatDuration(seconds)} (${Math.round(percentage)}%)`}
          >
            {percentage > 10 && <span className="truncate px-1">{category.slice(0, 3)}</span>}
          </div>
        );
      })}
    </div>
  );
}
