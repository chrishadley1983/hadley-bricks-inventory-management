'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, Play, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePartout } from '@/hooks/usePartout';
import { usePartoutEstimate, type PartoutEstimate } from '@/hooks/usePartoutEstimate';
import { PartoutTable, type PartoutCondition } from './PartoutTable';
import { PartoutProgress } from './PartoutProgress';
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
 * The run gate.
 *
 * Part-out used to live behind a tab, so opening it WAS the consent. On the single screen
 * it would otherwise fire on every lookup, and an uncached set is four BrickLink calls per
 * lot (1,141 lots on 71741). So the run is a button, and the button states the bill.
 */
function PartoutGate({
  estimate,
  isEstimating,
  estimateError,
  onRun,
}: {
  estimate: PartoutEstimate | undefined;
  isEstimating: boolean;
  estimateError: Error | null;
  onRun: () => void;
}) {
  if (isEstimating) {
    return (
      <div className="rounded-lg border p-6 space-y-3">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
    );
  }

  // If we can't cost it, still offer the run — just say the cost is unknown rather than
  // blocking on a failed estimate.
  const unknownCost = !!estimateError || !estimate;

  return (
    <div className="rounded-lg border p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div className="space-y-1">
        <h3 className="text-lg font-semibold">Part-out assessment</h3>
        {unknownCost ? (
          <p className="text-sm text-muted-foreground">
            Couldn&apos;t check the cache first
            {estimateError ? ` (${estimateError.message})` : ''} — the run may need live
            BrickLink prices.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {estimate.totalLots.toLocaleString()} lots · {estimate.cachedLots.toLocaleString()}{' '}
            already priced ·{' '}
            <span className={estimate.uncachedLots > 0 ? 'text-amber-700 font-medium' : ''}>
              {estimate.uncachedLots.toLocaleString()}{' '}
              {estimate.uncachedLots === 1 ? 'needs' : 'need'} a live price
            </span>
            {estimate.uncachedLots > 0 && (
              <> — about {estimate.estimatedApiCalls.toLocaleString()} BrickLink API calls</>
            )}
          </p>
        )}
      </div>
      <Button onClick={onRun} className="shrink-0">
        <Play className="h-4 w-4 mr-1" />
        Run part-out
      </Button>
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
  const [runRequested, setRunRequested] = useState(false);
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

  // Costing the run costs one BrickLink call (getSubsets), so it runs on lookup while the
  // expensive part waits for a click.
  const {
    data: estimate,
    isFetching: isEstimating,
    error: estimateError,
  } = usePartoutEstimate(setNumber, enabled);

  // A fully-cached set costs BrickLink nothing, so asking permission for it is pure
  // friction — those run themselves. Only a set with uncached lots waits for the button.
  useEffect(() => {
    if (!enabled || !setNumber || runRequested || data || isStreaming) return;
    if (estimate && estimate.totalLots > 0 && estimate.uncachedLots === 0) {
      setRunRequested(true);
      fetchWithProgress(false);
    }
  }, [enabled, setNumber, runRequested, data, isStreaming, estimate, fetchWithProgress]);

  // Reset the gate when the set changes
  useEffect(() => {
    setRunRequested(false);
  }, [setNumber]);

  const handleRetry = () => {
    fetchWithProgress(false);
  };

  const handleRun = () => {
    setRunRequested(true);
    fetchWithProgress(false);
  };

  // Not enabled or no set selected
  if (!enabled || !setNumber) {
    return <EmptyState />;
  }

  // BrickLink's own published POV used to render underneath as a cross-check. Removed at
  // Chris's request — our assessment IS the answer, and a second POV figure alongside it
  // invited exactly the reconciliation confusion it was meant to resolve. The scrape,
  // its cache and /api/bricklink/part-out-value remain for the bl-part-out-value skill.
  return (
    <div className="space-y-6" data-testid="partout-tab">
      {renderComputedPartout()}
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

    // Not run yet — show the cost and wait for the click
    if (!data && !runRequested) {
      return (
        <PartoutGate
          estimate={estimate}
          isEstimating={isEstimating}
          estimateError={estimateError as Error | null}
          onRun={handleRun}
        />
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

    const missing = {
      new: data.parts.filter((p) => p.priceNew === null).length,
      used: data.parts.filter((p) => p.priceUsed === null).length,
    };

    // Success - render the assessment and the parts table
    return (
      <div className="space-y-6">
        {/*
          Data provenance. The old PartoutSummary block was removed as duplication — its
          POV/ratio cards repeated the ladder and the verdict's multiple, and its set
          prices now live in the max-buy tooltip. The two facts it carried that were NOT
          on screen anywhere else were cache coverage and the per-condition missing-price
          counts, so they land here. (The amber banner covers only the selected condition;
          this shows both, which is what tells you a set is thin in Used but fine in New.)
        */}
        <div className="text-sm text-muted-foreground">
          {isFetching ? (
            <span className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Refreshing...
            </span>
          ) : (
            <span>
              {data.cacheStats.fromCache} of {data.cacheStats.total} parts from cache
              {missing.new + missing.used > 0 && (
                <>
                  {' · '}
                  <span className="text-amber-700">
                    no UK price: {missing.new} New / {missing.used} Used
                  </span>
                </>
              )}
            </span>
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

        {/* Parts table */}
        <h3 className="text-lg font-semibold">Parts Breakdown</h3>
        <PartoutTable parts={data.parts} condition={condition} />
      </div>
    );
  }
}
