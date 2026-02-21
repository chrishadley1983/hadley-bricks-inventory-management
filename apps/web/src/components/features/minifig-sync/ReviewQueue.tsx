'use client';

import { useState, useMemo } from 'react';
import { toast } from 'sonner';
import { useDebouncedCallback } from 'use-debounce';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Send, Search, Loader2 } from 'lucide-react';
import {
  useMinifigSyncItems,
  usePublishListing,
  useDismissListing,
  useForceRefresh,
  useUpdateSyncItem,
  useBulkPublish,
} from '@/hooks/use-minifig-sync';
import { ReviewCard } from './ReviewCard';

export function ReviewQueue() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const debouncedSetSearch = useDebouncedCallback((value: string) => {
    setDebouncedSearch(value);
  }, 300);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    debouncedSetSearch(value);
  };

  // Fetch staged items (F40)
  const { data: items, isLoading } = useMinifigSyncItems({
    listingStatus: 'STAGED',
    search: debouncedSearch || undefined,
  });

  const publishMutation = usePublishListing();
  const rejectMutation = useDismissListing();
  const refreshMutation = useForceRefresh();
  const updateMutation = useUpdateSyncItem();
  const bulkPublishMutation = useBulkPublish();

  // Track which item is being acted on
  const [activeItemId, setActiveItemId] = useState<string | null>(null);

  const handlePublish = async (id: string) => {
    setActiveItemId(id);
    try {
      await publishMutation.mutateAsync(id);
      toast.success('Listing published to eBay');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to publish');
    } finally {
      setActiveItemId(null);
    }
  };

  const handleReject = async (id: string) => {
    setActiveItemId(id);
    try {
      await rejectMutation.mutateAsync(id);
      toast.success('Listing rejected');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reject');
    } finally {
      setActiveItemId(null);
    }
  };

  const handleRefreshPricing = async (id: string) => {
    setActiveItemId(id);
    try {
      await refreshMutation.mutateAsync(id);
      toast.success('Pricing refreshed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to refresh pricing');
    } finally {
      setActiveItemId(null);
    }
  };

  const handleUpdate = async (
    id: string,
    data: { title?: string; description?: string; price?: number }
  ) => {
    setActiveItemId(id);
    try {
      const result = await updateMutation.mutateAsync({ id, data });
      if (result?.ebayWarnings?.length) {
        result.ebayWarnings.forEach((w) => toast.warning(w));
      } else {
        toast.success('Item updated');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setActiveItemId(null);
    }
  };

  const handleBulkPublish = async () => {
    try {
      const result = await bulkPublishMutation.mutateAsync();
      if (result.published > 0) {
        toast.success(`Published ${result.published} listing${result.published !== 1 ? 's' : ''}`);
      }
      if (result.skipped > 0) {
        toast.info(
          `${result.skipped} listing${result.skipped !== 1 ? 's' : ''} skipped (quality check)`
        );
      }
      if (result.errors.length > 0) {
        toast.error(
          `${result.errors.length} listing${result.errors.length !== 1 ? 's' : ''} failed`
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Bulk publish failed');
    }
  };

  const stagedCount = items?.length ?? 0;

  const filteredItems = useMemo(() => items ?? [], [items]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-80 rounded-lg border bg-muted/50 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Review Queue</h2>
          <Badge variant="secondary">{stagedCount}</Badge>
        </div>

        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search minifigs..."
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-8 h-9 w-[200px]"
            />
          </div>

          {/* Bulk Publish (F44) */}
          <Button
            onClick={handleBulkPublish}
            disabled={bulkPublishMutation.isPending || stagedCount === 0}
          >
            {bulkPublishMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            Publish All ({stagedCount})
          </Button>
        </div>
      </div>

      {/* Empty state */}
      {filteredItems.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="text-4xl mb-4">🎉</div>
          <h3 className="text-lg font-medium mb-1">No listings to review</h3>
          <p className="text-sm text-muted-foreground">
            {debouncedSearch
              ? 'No staged listings match your search'
              : 'All staged listings have been processed'}
          </p>
        </div>
      )}

      {/* Card grid */}
      <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {filteredItems.map((item) => (
          <ReviewCard
            key={item.id}
            item={item}
            onPublish={handlePublish}
            onReject={handleReject}
            onRefreshPricing={handleRefreshPricing}
            onUpdate={handleUpdate}
            isPublishing={publishMutation.isPending && activeItemId === item.id}
            isRejecting={rejectMutation.isPending && activeItemId === item.id}
            isRefreshing={refreshMutation.isPending && activeItemId === item.id}
            isUpdating={updateMutation.isPending && activeItemId === item.id}
          />
        ))}
      </div>
    </div>
  );
}
