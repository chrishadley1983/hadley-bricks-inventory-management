/**
 * Amazon Sync React Hooks
 *
 * TanStack Query hooks for managing the Amazon sync queue and feeds.
 */

'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  QueueItemWithDetails,
  AggregatedQueueItem,
  SyncFeed,
  SyncFeedWithDetails,
  AmazonSyncQueueRow,
  PriceConflict,
} from '@/lib/amazon/amazon-sync.types';

// Re-export types and constants
export { POLL_INTERVAL_MS } from '@/lib/amazon/amazon-sync.types';
export type { PriceConflict } from '@/lib/amazon/amazon-sync.types';

// ============================================================================
// TYPES
// ============================================================================

interface SyncQueueResponse {
  items: QueueItemWithDetails[];
  aggregated: AggregatedQueueItem[];
  summary: {
    totalItems: number;
    uniqueAsins: number;
    totalQuantity: number;
  };
}

interface AddToQueueResponse {
  item?: AmazonSyncQueueRow;
  priceConflict?: PriceConflict;
  added?: number;
  skipped?: number;
  errors?: string[];
  priceConflicts?: PriceConflict[];
  message: string;
}

interface SubmitFeedResponse {
  feed: SyncFeed;
  message: string;
}

interface PollFeedResponse {
  feed: SyncFeed;
  isComplete: boolean;
  message: string;
}

// ============================================================================
// QUERY KEY FACTORY
// ============================================================================

export const amazonSyncKeys = {
  all: ['amazon-sync'] as const,
  queue: () => [...amazonSyncKeys.all, 'queue'] as const,
  feeds: () => [...amazonSyncKeys.all, 'feeds'] as const,
  feed: (id: string) => [...amazonSyncKeys.all, 'feed', id] as const,
};

// ============================================================================
// FETCH FUNCTIONS
// ============================================================================

async function fetchQueue(): Promise<SyncQueueResponse> {
  const response = await fetch('/api/amazon/sync/queue');

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch queue');
  }

  const json = await response.json();
  return json.data;
}

async function addToQueue(
  input: { inventoryItemId?: string; inventoryItemIds?: string[] }
): Promise<AddToQueueResponse> {
  const response = await fetch('/api/amazon/sync/queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to add to queue');
  }

  const json = await response.json();
  return { ...json.data, message: json.message };
}

async function removeFromQueue(queueItemId: string): Promise<void> {
  const response = await fetch(`/api/amazon/sync/queue/${queueItemId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to remove from queue');
  }
}

async function clearQueue(): Promise<{ deleted: number }> {
  const response = await fetch('/api/amazon/sync/queue', {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to clear queue');
  }

  const json = await response.json();
  return json.data;
}

async function submitFeed(dryRun: boolean): Promise<SubmitFeedResponse> {
  const response = await fetch('/api/amazon/sync/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dryRun }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to submit feed');
  }

  const json = await response.json();
  return { feed: json.data.feed, message: json.message };
}

async function fetchFeedHistory(limit: number = 20): Promise<SyncFeed[]> {
  const response = await fetch(`/api/amazon/sync/feeds?limit=${limit}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch feed history');
  }

  const json = await response.json();
  return json.data.feeds;
}

async function fetchFeed(feedId: string): Promise<SyncFeedWithDetails> {
  const response = await fetch(`/api/amazon/sync/feeds/${feedId}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch feed');
  }

  const json = await response.json();
  return json.data.feed;
}

async function pollFeed(feedId: string): Promise<PollFeedResponse> {
  const response = await fetch(`/api/amazon/sync/feeds/${feedId}/poll`, {
    method: 'POST',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to poll feed');
  }

  const json = await response.json();
  return { ...json.data, message: json.message };
}

// ============================================================================
// QUERY HOOKS
// ============================================================================

/**
 * Fetch the sync queue with items and aggregated view
 */
export function useAmazonSyncQueue(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: amazonSyncKeys.queue(),
    queryFn: fetchQueue,
    staleTime: 30 * 1000, // 30 seconds
    enabled: options?.enabled !== false,
  });
}

/**
 * Fetch feed history
 */
export function useSyncFeedHistory(limit: number = 20, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: amazonSyncKeys.feeds(),
    queryFn: () => fetchFeedHistory(limit),
    staleTime: 60 * 1000, // 1 minute
    enabled: options?.enabled !== false,
  });
}

/**
 * Fetch a single feed with details
 * Auto-polls while feed is in progress
 */
export function useSyncFeed(
  feedId: string | undefined,
  options?: { enabled?: boolean; pollWhileProcessing?: boolean }
) {
  const pollWhileProcessing = options?.pollWhileProcessing ?? true;

  return useQuery({
    queryKey: amazonSyncKeys.feed(feedId!),
    queryFn: () => fetchFeed(feedId!),
    enabled: !!feedId && options?.enabled !== false,
    staleTime: 10 * 1000, // 10 seconds
    refetchInterval: (query) => {
      if (!pollWhileProcessing) return false;

      const status = query.state.data?.status;
      if (status === 'submitted' || status === 'processing') {
        return 30000; // 30 seconds
      }
      return false;
    },
  });
}

// ============================================================================
// MUTATION HOOKS
// ============================================================================

/**
 * Add item(s) to the sync queue
 */
export function useAddToSyncQueue() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { inventoryItemId?: string; inventoryItemIds?: string[] }) =>
      addToQueue(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: amazonSyncKeys.queue() });
    },
    onError: (error) => {
      console.error('[useAddToSyncQueue] Error:', error);
    },
  });
}

/**
 * Remove an item from the sync queue
 */
export function useRemoveFromSyncQueue() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (queueItemId: string) => removeFromQueue(queueItemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: amazonSyncKeys.queue() });
    },
    onError: (error) => {
      console.error('[useRemoveFromSyncQueue] Error:', error);
    },
  });
}

/**
 * Clear the entire sync queue
 */
export function useClearSyncQueue() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: clearQueue,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: amazonSyncKeys.queue() });
    },
    onError: (error) => {
      console.error('[useClearSyncQueue] Error:', error);
    },
  });
}

/**
 * Submit the queue to Amazon
 */
export function useSubmitSyncFeed() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dryRun: boolean) => submitFeed(dryRun),
    onSuccess: (data) => {
      // Invalidate queue (items may be cleared after successful submission)
      queryClient.invalidateQueries({ queryKey: amazonSyncKeys.queue() });
      // Invalidate feed history to include new feed
      queryClient.invalidateQueries({ queryKey: amazonSyncKeys.feeds() });
      // Set the new feed in cache
      if (data.feed) {
        queryClient.setQueryData(amazonSyncKeys.feed(data.feed.id), data.feed);
      }
    },
    onError: (error) => {
      console.error('[useSubmitSyncFeed] Error:', error);
    },
  });
}

/**
 * Manually poll a feed for status update
 */
export function usePollSyncFeed() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (feedId: string) => pollFeed(feedId),
    onSuccess: (data) => {
      // Update the feed in cache
      queryClient.setQueryData(amazonSyncKeys.feed(data.feed.id), data.feed);
      // Invalidate feed history to update status
      queryClient.invalidateQueries({ queryKey: amazonSyncKeys.feeds() });

      // If complete, also invalidate queue (items may have been cleared)
      if (data.isComplete) {
        queryClient.invalidateQueries({ queryKey: amazonSyncKeys.queue() });
      }
    },
    onError: (error) => {
      console.error('[usePollSyncFeed] Error:', error);
    },
  });
}

// ============================================================================
// DERIVED HOOKS
// ============================================================================

/**
 * Get the queue count
 */
export function useSyncQueueCount() {
  const { data } = useAmazonSyncQueue();
  return data?.summary.totalItems ?? 0;
}

/**
 * Check if a feed is currently processing
 */
export function useIsFeedProcessing(feedId: string | undefined) {
  const { data } = useSyncFeed(feedId);
  return data?.status === 'submitted' || data?.status === 'processing';
}

// ============================================================================
// TYPE RE-EXPORTS
// ============================================================================

export type {
  QueueItemWithDetails,
  AggregatedQueueItem,
  SyncFeed,
  SyncFeedWithDetails,
  SyncQueueResponse,
};
