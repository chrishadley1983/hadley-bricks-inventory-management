'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { usePartout } from '@/hooks/usePartout';
import { PartoutSummary } from './PartoutSummary';
import { PartoutTable, type PartoutCondition } from './PartoutTable';
import { PartoutProgress } from './PartoutProgress';

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
  const { toast } = useToast();
  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
    forceRefresh,
    isForceRefreshing,
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
  }, [enabled, setNumber, data, isLoading, isFetching, isStreaming, hasTriggeredInitialLoad, error, fetchWithProgress]);

  // Reset initial load flag when set number changes
  useEffect(() => {
    setHasTriggeredInitialLoad(false);
  }, [setNumber]);

  const handleForceRefresh = async () => {
    const result = await forceRefresh();
    if (result.success) {
      toast({
        title: 'Prices refreshed',
        description: 'All part prices have been updated from BrickLink.',
      });
    } else {
      toast({
        title: 'Refresh failed',
        description: result.error || 'Failed to refresh prices. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const handleRetry = () => {
    fetchWithProgress(false);
  };

  // Not enabled or no set selected
  if (!enabled || !setNumber) {
    return <EmptyState />;
  }

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
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
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

  // Success - render summary and table
  return (
    <div className="space-y-6" data-testid="partout-tab">
      {/* Refresh indicator and force refresh button */}
      <div className="flex items-center justify-between">
        {isFetching || isForceRefreshing ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin" />
            {isForceRefreshing ? 'Refreshing all prices from BrickLink...' : 'Refreshing...'}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">
            {data.cacheStats.fromCache > 0 && (
              <span>
                {data.cacheStats.fromCache} of {data.cacheStats.total} parts from cache
              </span>
            )}
          </div>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={handleForceRefresh}
          disabled={isFetching || isForceRefreshing}
        >
          <RefreshCw className={`h-4 w-4 mr-1 ${isForceRefreshing ? 'animate-spin' : ''}`} />
          Force Refresh
        </Button>
      </div>

      {/* Summary cards */}
      <PartoutSummary data={data} />

      {/* Condition toggle */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Parts Breakdown</h3>
        <Tabs value={condition} onValueChange={(v: string) => setCondition(v as PartoutCondition)}>
          <TabsList>
            <TabsTrigger value="new">New</TabsTrigger>
            <TabsTrigger value="used">Used</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Parts table */}
      <PartoutTable parts={data.parts} condition={condition} />
    </div>
  );
}
