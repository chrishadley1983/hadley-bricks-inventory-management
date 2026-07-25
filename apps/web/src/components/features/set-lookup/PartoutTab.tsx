'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePartout } from '@/hooks/usePartout';
import { PartoutSummary } from './PartoutSummary';
import { PartoutTable, type PartoutCondition } from './PartoutTable';
import { PartoutProgress } from './PartoutProgress';
import { OfficialPovCard } from './OfficialPovCard';
import { PartoutAssessmentPanel } from './PartoutAssessmentPanel';

interface PartoutTabProps {
  setNumber: string | null;
  enabled: boolean;
}

/**
 * Loading skeleton for the partout tab
 */
function PartoutSkeleton() {
  return (
    <div className="space-y-6">
      {/* Summary skeleton */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border p-4 space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>

      {/* Recommendation and cache skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-lg border p-4 space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-6 w-32" />
        </div>
        <div className="rounded-lg border p-4 space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-6 w-40" />
        </div>
      </div>

      {/* Table skeleton */}
      <div className="rounded-lg border">
        <div className="p-4">
          <Skeleton className="h-8 w-64 mb-4" />
        </div>
        <div className="space-y-2 p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Empty state when no set is selected
 */
function EmptyState() {
  return (
    <div className="text-center py-12 text-muted-foreground">
      <p>Look up a set to see partout value</p>
    </div>
  );
}

/**
 * Empty state when set has no parts data
 */
function NoPartsState() {
  return (
    <div className="text-center py-12 text-muted-foreground">
      <p>No partout data available for this set</p>
      <p className="text-sm mt-2">The set may not have parts data on BrickLink</p>
    </div>
  );
}

/**
 * PartoutTab Component
 *
 * Container for the partout value analysis. Handles loading, error states,
 * and orchestrates the summary and table components.
 * Uses streaming for initial load and force refresh to show progress.
 */
export function PartoutTab({ setNumber, enabled }: PartoutTabProps) {
  const [condition, setCondition] = useState<PartoutCondition>('new');
  const [hasTriggeredInitialLoad, setHasTriggeredInitialLoad] = useState(false);
  // NOTE: usePartout still exposes forceRefresh / isForceRefreshing and the API route
  // still honours forceRefresh — the UI control was removed, not the capability.
  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
    isStreaming,
    streamProgress,
    streamError,
    fetchWithProgress,
  } = usePartout(setNumber, enabled);

  // Trigger streaming fetch for initial load when no cached data
  useEffect(() => {
    if (
      enabled &&
      setNumber &&
      !data &&
      !isLoading &&
      !isFetching &&
      !isStreaming &&
      !hasTriggeredInitialLoad &&
      !error
    ) {
      setHasTriggeredInitialLoad(true);
      fetchWithProgress(false);
    }
  }, [
    enabled,
    setNumber,
    data,
    isLoading,
    isFetching,
    isStreaming,
    hasTriggeredInitialLoad,
    error,
    fetchWithProgress,
  ]);

  // Reset initial load flag when set number changes
  useEffect(() => {
    setHasTriggeredInitialLoad(false);
  }, [setNumber]);

  const handleRetry = () => {
    fetchWithProgress(false);
  };

  // Not enabled or no set selected
  if (!enabled || !setNumber) {
    return <EmptyState />;
  }

  // OUR view leads: the computed assessment renders first, through its own state machine.
  // BrickLink's published POV follows as a cross-check — it sits OUTSIDE that state machine
  // so it still shows when the computed partout is loading or has failed, but it never
  // occupies the headline. The reconciliation between the two lives on that card.
  const computed = renderComputedPartout();

  return (
    <div className="space-y-6" data-testid="partout-tab">
      {computed}
      <OfficialPovCard
        setNumber={setNumber}
        enabled={enabled}
        condition={condition}
        assessment={data?.assessment?.[condition] ?? null}
      />
    </div>
  );

  function renderComputedPartout() {
    // Show streaming progress during initial load or force refresh
    if (isStreaming && streamProgress) {
      return (
        <PartoutProgress
          fetched={streamProgress.fetched}
          total={streamProgress.total}
          cached={streamProgress.cached}
        />
      );
    }

    // Error state from streaming
    if (streamError) {
      return (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Failed to load partout data</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>{streamError}</span>
            <Button variant="outline" size="sm" onClick={handleRetry}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      );
    }

    // Loading state (React Query initial load - fallback)
    if (isLoading) {
      return <PartoutSkeleton />;
    }

    // Error state (React Query)
    if (error) {
      return (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Failed to load partout data</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>{error instanceof Error ? error.message : 'An error occurred'}</span>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? (
                <RefreshCw className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-1" />
              )}
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      );
    }

    // No data or empty parts
    if (!data || data.parts.length === 0) {
      return <NoPartsState />;
    }

    // Success - render assessment, summary and table
    return (
      <div className="space-y-6">
        {/* Cache provenance only — the force-refresh control was removed at Chris's
            request; prices refresh on their own TTL. */}
        <div className="text-sm text-muted-foreground">
          {isFetching ? (
            <span className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Refreshing...
            </span>
          ) : (
            data.cacheStats.fromCache > 0 && (
              <span>
                {data.cacheStats.fromCache} of {data.cacheStats.total} parts from cache
              </span>
            )
          )}
        </div>

        {/*
          The condition toggle drives the assessment AND the parts table, so it sits
          above both — the verdict, ladder, bands and magnets are all condition-specific.
        */}
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Part-Out Assessment</h3>
          <Tabs
            value={condition}
            onValueChange={(v: string) => setCondition(v as PartoutCondition)}
          >
            <TabsList>
              <TabsTrigger value="new">New</TabsTrigger>
              <TabsTrigger value="used">Used</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Canonical assessment for the selected condition */}
        {data.assessment ? (
          <PartoutAssessmentPanel assessment={data.assessment[condition]} />
        ) : (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Assessment unavailable</AlertTitle>
            <AlertDescription>
              No parts data was returned for this set, so the part-out gate can&apos;t be applied.
            </AlertDescription>
          </Alert>
        )}

        {/* Raw POV figures for both conditions, plus data-quality context */}
        <PartoutSummary data={data} />

        {/* Parts table */}
        <h3 className="text-lg font-semibold">Parts Breakdown</h3>
        <PartoutTable parts={data.parts} condition={condition} />
      </div>
    );
  }
}
