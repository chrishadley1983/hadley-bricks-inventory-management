'use client';

import { useState, useEffect, useMemo } from 'react';
import { RefreshCw, Loader2, AlertCircle, Play, History as HistoryIcon, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useEbayScopes } from '@/hooks/listing-refresh/use-ebay-scopes';
import { useEligibleListings } from '@/hooks/listing-refresh/use-eligible-listings';
import {
  useRefreshHistory,
  useRefreshJob,
  useCreateRefreshJob,
  useUpdateRefreshItem,
  useApproveItems,
  useSkipItems,
} from '@/hooks/listing-refresh/use-refresh-job';
import { useExecuteRefresh } from '@/hooks/listing-refresh/use-execute-refresh';
import { useEnrichViews } from '@/hooks/listing-refresh/use-enrich-views';
import {
  ScopeUpgradePrompt,
  RefreshModeToggle,
  EligibleListingsTable,
  RefreshItemEditModal,
  RefreshJobProgress,
  RefreshResultsSummary,
  RefreshHistoryList,
  ViewsEnrichmentProgress,
} from '../refresh';
import type { RefreshJobItem, EligibleListing } from '@/lib/ebay/listing-refresh.types';

type TabView = 'select' | 'review' | 'progress' | 'history';

/**
 * Main Refresh Tab component for the Listing Assistant
 */
export function RefreshTab() {
  const { toast } = useToast();

  // State
  const [activeView, setActiveView] = useState<TabView>('select');
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [reviewMode, setReviewMode] = useState(true);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<RefreshJobItem | null>(null);
  const [enrichedListings, setEnrichedListings] = useState<EligibleListing[] | null>(null);

  // Queries
  const { data: scopeData, isLoading: scopesLoading } = useEbayScopes();
  const { data: eligibleListings, isLoading: listingsLoading, refetch: refetchListings } = useEligibleListings();

  // Views enrichment hook
  const {
    progress: viewsProgress,
    isEnriching: isEnrichingViews,
    error: viewsError,
    enrich: enrichWithViews,
  } = useEnrichViews();
  const { data: refreshHistory, isLoading: historyLoading } = useRefreshHistory();
  const { data: currentJob, refetch: refetchJob } = useRefreshJob(currentJobId || '');

  // Mutations
  const createJobMutation = useCreateRefreshJob();
  const updateItemMutation = useUpdateRefreshItem();
  const approveItemsMutation = useApproveItems();
  const skipItemsMutation = useSkipItems();

  // Use enriched listings if available, otherwise use original
  const displayListings = enrichedListings || eligibleListings;

  // Get selected listing objects from IDs
  const selectedListings = useMemo(() => {
    if (!displayListings) return [];
    return displayListings.filter((listing) => selectedItemIds.includes(listing.itemId));
  }, [displayListings, selectedItemIds]);

  // Check if we have views data (listings have been enriched)
  const hasViewsData = useMemo(() => {
    if (!displayListings || displayListings.length === 0) return false;
    return displayListings.some((listing) => listing.views !== null);
  }, [displayListings]);

  // Execute refresh hook
  const { progress, result, error: executeError, isExecuting, execute, reset } = useExecuteRefresh(currentJobId || '');

  // Determine if we should show scope upgrade prompt
  const needsScopeUpgrade = scopeData && (!scopeData.isConnected || !scopeData.hasScopes);

  // Get items pending review
  const pendingReviewItems = useMemo(() => {
    return currentJob?.items?.filter((item) => item.status === 'pending_review') || [];
  }, [currentJob?.items]);

  // Auto-advance to next review item
  useEffect(() => {
    if (activeView === 'review' && pendingReviewItems.length > 0 && !editingItem) {
      setEditingItem(pendingReviewItems[0]);
    }
  }, [activeView, pendingReviewItems, editingItem]);

  // Handle result display
  useEffect(() => {
    if (result) {
      setActiveView('select');
      setCurrentJobId(null);
      setEnrichedListings(null); // Reset enriched listings
      refetchListings();
    }
  }, [result, refetchListings]);

  // Auto-fetch views when eligible listings load
  useEffect(() => {
    // Reset enriched listings when original listings change
    setEnrichedListings(null);

    // Auto-enrich with views if we have listings and aren't already enriching
    if (eligibleListings && eligibleListings.length > 0 && !isEnrichingViews) {
      enrichWithViews(eligibleListings)
        .then((result) => {
          setEnrichedListings(result);
        })
        .catch((error) => {
          // Silent fail - views are optional, user can retry manually
          console.warn('[RefreshTab] Auto-enrich views failed:', error);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligibleListings]);

  // Handlers
  const handleStartRefresh = async () => {
    if (selectedListings.length === 0) {
      toast({
        title: 'No listings selected',
        description: 'Please select at least one listing to refresh.',
        variant: 'destructive',
      });
      return;
    }

    try {
      const job = await createJobMutation.mutateAsync({
        listings: selectedListings,
        reviewMode,
      });

      setCurrentJobId(job.id);
      setSelectedItemIds([]);

      if (reviewMode) {
        setActiveView('review');
      } else {
        setActiveView('progress');
        // Auto-execute in immediate mode after a short delay
        setTimeout(() => execute(), 500);
      }
    } catch (error) {
      toast({
        title: 'Failed to create refresh job',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const handleSaveItem = async (
    itemId: string,
    updates: { title?: string; price?: number; quantity?: number }
  ) => {
    if (!currentJobId) return;
    await updateItemMutation.mutateAsync({ jobId: currentJobId, itemId, updates });
  };

  const handleApproveItem = async (itemId: string) => {
    if (!currentJobId) return;
    await approveItemsMutation.mutateAsync({ jobId: currentJobId, itemIds: [itemId] });
    await refetchJob();
    setEditingItem(null);
  };

  const handleSkipItem = async (itemId: string) => {
    if (!currentJobId) return;
    await skipItemsMutation.mutateAsync({ jobId: currentJobId, itemIds: [itemId] });
    await refetchJob();
    setEditingItem(null);
  };

  const handleApproveAll = async () => {
    if (pendingReviewItems.length === 0 || !currentJobId) return;
    await approveItemsMutation.mutateAsync({
      jobId: currentJobId,
      itemIds: pendingReviewItems.map((item) => item.id),
    });
    await refetchJob();
  };

  const handleStartExecution = () => {
    setActiveView('progress');
    execute();
  };

  const handleDismissResult = () => {
    reset();
    setActiveView('select');
    setCurrentJobId(null);
  };

  const handleViewJobDetails = (jobId: string) => {
    setCurrentJobId(jobId);
    // For now just show the job, could expand to show details modal
  };

  const handleFetchViews = async () => {
    if (!eligibleListings || eligibleListings.length === 0) return;

    try {
      const result = await enrichWithViews(eligibleListings);
      setEnrichedListings(result);
      toast({
        title: 'Views data loaded',
        description: `Fetched views for ${result.length} listings.`,
      });
    } catch (error) {
      toast({
        title: 'Failed to fetch views',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  // Loading state
  if (scopesLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // Scope upgrade required
  if (needsScopeUpgrade) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            Refresh Listings
          </h2>
          <p className="text-sm text-muted-foreground">
            Boost your listing visibility by ending and recreating older listings.
          </p>
        </div>
        <ScopeUpgradePrompt missingScopes={scopeData?.missingScopes || []} />
      </div>
    );
  }

  // Show result if available
  if (result) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            Refresh Listings
          </h2>
        </div>
        <RefreshResultsSummary result={result} onDismiss={handleDismissResult} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            Refresh Listings
          </h2>
          <p className="text-sm text-muted-foreground">
            Boost your listing visibility by ending and recreating older listings.
          </p>
        </div>
        {activeView === 'select' && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setActiveView('history')}
          >
            <HistoryIcon className="mr-2 h-4 w-4" />
            History
          </Button>
        )}
        {activeView === 'history' && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setActiveView('select')}
          >
            Back to Listings
          </Button>
        )}
      </div>

      {/* Error Display */}
      {executeError && (
        <Card className="border-red-200">
          <CardContent className="py-4">
            <div className="flex items-center gap-2 text-red-600">
              <AlertCircle className="h-4 w-4" />
              <span>{executeError}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Content */}
      {activeView === 'select' && (
        <div className="space-y-4">
          {/* Mode Toggle */}
          <RefreshModeToggle
            reviewMode={reviewMode}
            onReviewModeChange={setReviewMode}
            disabled={createJobMutation.isPending}
          />

          {/* Eligible Listings */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Eligible Listings</CardTitle>
                  <CardDescription>
                    Listings older than 90 days that can be refreshed. Select the ones you want to
                    process.
                  </CardDescription>
                </div>
                {eligibleListings && eligibleListings.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleFetchViews}
                    disabled={isEnrichingViews}
                  >
                    {isEnrichingViews ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      <>
                        <Eye className="mr-2 h-4 w-4" />
                        {hasViewsData ? 'Refresh Views' : 'Load Views'}
                      </>
                    )}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {/* Views enrichment progress */}
              {isEnrichingViews && (
                <ViewsEnrichmentProgress progress={viewsProgress} isEnriching={isEnrichingViews} />
              )}

              {/* Views error */}
              {viewsError && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <div className="flex items-center gap-2 text-red-600 text-sm">
                    <AlertCircle className="h-4 w-4" />
                    <span>{viewsError}</span>
                  </div>
                </div>
              )}

              {listingsLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : displayListings && displayListings.length > 0 ? (
                <EligibleListingsTable
                  listings={displayListings}
                  selectedIds={selectedItemIds}
                  onSelectionChange={setSelectedItemIds}
                />
              ) : (
                <div className="text-center py-8">
                  <RefreshCw className="mx-auto h-12 w-12 text-muted-foreground" />
                  <h3 className="mt-4 text-lg font-semibold">No eligible listings</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    All your listings are less than 90 days old. Check back later!
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Action Button */}
          {selectedListings.length > 0 && (
            <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
              <span className="text-sm">
                {selectedListings.length} listing{selectedListings.length !== 1 ? 's' : ''} selected
              </span>
              <Button onClick={handleStartRefresh} disabled={createJobMutation.isPending}>
                {createJobMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating Job...
                  </>
                ) : (
                  <>
                    <Play className="mr-2 h-4 w-4" />
                    {reviewMode ? 'Start Review' : 'Start Refresh'}
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
      )}

      {activeView === 'review' && currentJob && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Review Listings</CardTitle>
              <CardDescription>
                Review each listing before processing. You can edit the title, price, or quantity.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">
                    {pendingReviewItems.length} listing{pendingReviewItems.length !== 1 ? 's' : ''}{' '}
                    pending review
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={handleApproveAll}
                    disabled={pendingReviewItems.length === 0 || approveItemsMutation.isPending}
                  >
                    Approve All
                  </Button>
                  <Button
                    onClick={handleStartExecution}
                    disabled={pendingReviewItems.length > 0}
                  >
                    <Play className="mr-2 h-4 w-4" />
                    Start Processing
                  </Button>
                </div>
              </div>

              {/* List of items with their status */}
              <div className="mt-4 space-y-2">
                {currentJob.items?.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      {item.originalGalleryUrl && (
                        <img
                          src={item.originalGalleryUrl}
                          alt={item.originalTitle}
                          className="w-10 h-10 object-cover rounded"
                        />
                      )}
                      <div>
                        <p className="font-medium text-sm truncate max-w-md">
                          {item.modifiedTitle || item.originalTitle}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          £{item.modifiedPrice ?? item.originalPrice}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {item.status === 'pending_review' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingItem(item)}
                        >
                          Review
                        </Button>
                      ) : item.status === 'approved' ? (
                        <span className="text-sm text-green-600">Approved</span>
                      ) : item.status === 'skipped' ? (
                        <span className="text-sm text-muted-foreground">Skipped</span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {activeView === 'progress' && (
        <RefreshJobProgress progress={progress} isExecuting={isExecuting} />
      )}

      {activeView === 'history' && (
        <RefreshHistoryList
          jobs={refreshHistory || []}
          isLoading={historyLoading}
          onViewDetails={handleViewJobDetails}
        />
      )}

      {/* Edit Modal */}
      <RefreshItemEditModal
        item={editingItem}
        open={!!editingItem}
        onOpenChange={(open) => !open && setEditingItem(null)}
        onSave={handleSaveItem}
        onApprove={handleApproveItem}
        onSkip={handleSkipItem}
        isSaving={updateItemMutation.isPending || approveItemsMutation.isPending || skipItemsMutation.isPending}
      />
    </div>
  );
}
