'use client';

import { useState, useCallback, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Send, Search, Loader2 } from 'lucide-react';
import { useDebouncedCallback } from 'use-debounce';
import { toast } from 'sonner';
import {
  useMinifigSyncItems,
  usePublishListing,
  useDismissListing,
  useForceRefresh,
  useUpdateSyncItem,
  useBulkPublish,
} from '@/hooks/use-minifig-sync';
import type { SyncItemUpdateData } from '@/lib/api/minifig-sync';
import { ListingReviewDetail } from './review/ListingReviewDetail';

export function SingleListingReview() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [search, setSearch] = useState<string | undefined>();

  const { data: items, isLoading } = useMinifigSyncItems({
    listingStatus: 'STAGED',
    search,
  });

  const publishMutation = usePublishListing();
  const rejectMutation = useDismissListing();
  const refreshMutation = useForceRefresh();
  const updateMutation = useUpdateSyncItem();
  const bulkPublishMutation = useBulkPublish();

  const debouncedSearch = useDebouncedCallback((value: string) => {
    setSearch(value || undefined);
    setCurrentIndex(0);
  }, 300);

  const currentItem = items?.[currentIndex];

  const handlePublish = useCallback(
    async (id: string) => {
      try {
        await publishMutation.mutateAsync(id);
        toast.success('Listing published to eBay');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to publish');
      }
    },
    [publishMutation]
  );

  const handleReject = useCallback(
    async (id: string) => {
      try {
        await rejectMutation.mutateAsync(id);
        toast.success('Listing rejected');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to reject');
      }
    },
    [rejectMutation]
  );

  const handleRefreshPricing = useCallback(
    async (id: string) => {
      try {
        await refreshMutation.mutateAsync(id);
        toast.success('Pricing refreshed');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to refresh pricing');
      }
    },
    [refreshMutation]
  );

  const handleUpdate = useCallback(
    async (id: string, data: SyncItemUpdateData) => {
      try {
        await updateMutation.mutateAsync({ id, data });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to update');
      }
    },
    [updateMutation]
  );

  const handlePrev = useCallback(() => {
    setCurrentIndex((i) => Math.max(0, i - 1));
  }, []);

  const handleNext = useCallback(() => {
    if (items) {
      setCurrentIndex((i) => Math.min(items.length - 1, i + 1));
    }
  }, [items]);

  // Clamp index if items change
  useEffect(() => {
    if (items && currentIndex >= items.length && items.length > 0) {
      setCurrentIndex(items.length - 1);
    }
  }, [items, currentIndex]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-9 w-32" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search staged listings..."
            className="pl-9"
            onChange={(e) => debouncedSearch(e.target.value)}
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => bulkPublishMutation.mutate()}
          disabled={bulkPublishMutation.isPending || !items?.length}
        >
          {bulkPublishMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          ) : (
            <Send className="h-4 w-4 mr-1" />
          )}
          Publish All ({items?.length ?? 0})
        </Button>
      </div>

      {/* Content */}
      {!items?.length ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-lg font-medium text-muted-foreground">No staged listings</p>
          <p className="text-sm text-muted-foreground mt-1">
            Create listings from the Dashboard tab to see them here for review.
          </p>
        </div>
      ) : currentItem ? (
        <ListingReviewDetail
          item={currentItem}
          currentIndex={currentIndex}
          totalCount={items.length}
          onPrev={handlePrev}
          onNext={handleNext}
          onPublish={handlePublish}
          onReject={handleReject}
          onRefreshPricing={handleRefreshPricing}
          onUpdate={handleUpdate}
          isPublishing={publishMutation.isPending}
          isRejecting={rejectMutation.isPending}
          isRefreshing={refreshMutation.isPending}
          isUpdating={updateMutation.isPending}
        />
      ) : null}
    </div>
  );
}
