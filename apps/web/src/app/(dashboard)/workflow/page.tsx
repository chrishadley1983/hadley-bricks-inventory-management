'use client';

import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { usePerfPage } from '@/hooks/use-perf';
import {
  TaskQueue,
  AddTaskDropdown,
  CompletedTodaySection,
  CriticalActionsPanel,
  TimeTrackingPanel,
  TimeBreakdownSection,
  PomodoroPanel,
  WeeklyTargetsPanel,
  PickupCalendarPanel,
  WeeklyInsightsPanel,
  WorkflowSettingsPanel,
} from '@/components/features/workflow';

function TaskQueueSkeleton() {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-9 w-24" />
      </div>
      {[1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}

function CriticalActionsSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-6 w-40" />
      <div className="grid gap-4 md:grid-cols-3">
        <div className="md:col-span-2">
          <Skeleton className="h-[300px] w-full" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    </div>
  );
}

function TimeTrackingPanelSkeleton() {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-6 w-20" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-9" />
          <Skeleton className="h-9 w-9" />
          <Skeleton className="h-9 w-28" />
        </div>
      </div>
    </div>
  );
}

function TimeBreakdownSkeleton() {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-4 flex items-center justify-between">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="space-y-3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}

function PomodoroPanelSkeleton() {
  return (
    <div className="rounded-lg border bg-card px-3 py-1.5">
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-4" />
        <Skeleton className="h-7 w-[120px]" />
        <Skeleton className="h-7 w-7" />
        <Skeleton className="h-4 w-px" />
        <Skeleton className="h-4 w-12" />
      </div>
    </div>
  );
}

function PickupCalendarSkeleton() {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="grid grid-cols-2 gap-2 mb-4">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
      <Skeleton className="h-[280px]" />
    </div>
  );
}

export default function WorkflowPage() {
  usePerfPage('WorkflowPage');
  return (
    <div className="space-y-8">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Workflow</h1>
          <p className="text-muted-foreground">
            Your daily operations hub - manage tasks and monitor critical actions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <WorkflowSettingsPanel />
          <AddTaskDropdown />
        </div>
      </div>

      {/* Timer Panels Row */}
      <div className="flex flex-wrap items-center gap-3">
        <Suspense fallback={<TimeTrackingPanelSkeleton />}>
          <TimeTrackingPanel />
        </Suspense>
        <Suspense fallback={<PomodoroPanelSkeleton />}>
          <PomodoroPanel />
        </Suspense>
      </div>

      {/* Weekly Targets Panel */}
      <WeeklyTargetsPanel />

      {/* Critical Actions Panel */}
      <Suspense fallback={<CriticalActionsSkeleton />}>
        <CriticalActionsPanel />
      </Suspense>

      {/* Main content grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Task Queue - takes 2 columns */}
        <div className="lg:col-span-2">
          <Suspense fallback={<TaskQueueSkeleton />}>
            <TaskQueue />
          </Suspense>
        </div>

        {/* Right sidebar - Completed Today & Pickups */}
        <div className="space-y-6">
          <Suspense fallback={<Skeleton className="h-40 w-full" />}>
            <CompletedTodaySection />
          </Suspense>
          <Suspense fallback={<PickupCalendarSkeleton />}>
            <PickupCalendarPanel />
          </Suspense>
        </div>
      </div>

      {/* Time Breakdown Section */}
      <Suspense fallback={<TimeBreakdownSkeleton />}>
        <TimeBreakdownSection />
      </Suspense>

      {/* Weekly Insights Panel */}
      <Suspense fallback={<Skeleton className="h-[400px] w-full" />}>
        <WeeklyInsightsPanel />
      </Suspense>
    </div>
  );
}
