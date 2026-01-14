/**
 * Hook for managing refresh jobs
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  RefreshJob,
  EligibleListing,
  UpdateRefreshItemRequest,
} from '@/lib/ebay/listing-refresh.types';

interface RefreshJobResponse {
  data: RefreshJob;
  error?: string;
}

interface RefreshHistoryResponse {
  data: RefreshJob[];
  count: number;
  error?: string;
}

// ============================================================================
// API Functions
// ============================================================================

async function fetchRefreshJob(jobId: string): Promise<RefreshJob> {
  const response = await fetch(`/api/ebay/listing-refresh/${jobId}`);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to fetch refresh job');
  }

  const data: RefreshJobResponse = await response.json();
  return parseRefreshJob(data.data);
}

async function fetchRefreshHistory(limit = 20): Promise<RefreshJob[]> {
  const response = await fetch(`/api/ebay/listing-refresh?limit=${limit}`);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to fetch refresh history');
  }

  const data: RefreshHistoryResponse = await response.json();
  return data.data.map(parseRefreshJob);
}

async function createRefreshJob(
  listings: EligibleListing[],
  reviewMode: boolean
): Promise<RefreshJob> {
  const response = await fetch('/api/ebay/listing-refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      listings: listings.map((l) => ({
        ...l,
        listingStartDate: l.listingStartDate.toISOString(),
      })),
      reviewMode,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to create refresh job');
  }

  const data: RefreshJobResponse = await response.json();
  return parseRefreshJob(data.data);
}

async function cancelRefreshJob(jobId: string): Promise<void> {
  const response = await fetch(`/api/ebay/listing-refresh/${jobId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to cancel refresh job');
  }
}

async function approveItems(jobId: string, itemIds: string[]): Promise<void> {
  const response = await fetch(`/api/ebay/listing-refresh/${jobId}/items/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemIds }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to approve items');
  }
}

async function skipItems(jobId: string, itemIds: string[]): Promise<void> {
  const response = await fetch(`/api/ebay/listing-refresh/${jobId}/items/skip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemIds }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to skip items');
  }
}

async function updateRefreshItem(
  jobId: string,
  itemId: string,
  updates: UpdateRefreshItemRequest
): Promise<void> {
  const response = await fetch(`/api/ebay/listing-refresh/${jobId}/items/${itemId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to update item');
  }
}

// ============================================================================
// Helpers
// ============================================================================

function parseRefreshJob(job: RefreshJob): RefreshJob {
  return {
    ...job,
    startedAt: job.startedAt ? new Date(job.startedAt) : null,
    fetchPhaseCompletedAt: job.fetchPhaseCompletedAt ? new Date(job.fetchPhaseCompletedAt) : null,
    endPhaseCompletedAt: job.endPhaseCompletedAt ? new Date(job.endPhaseCompletedAt) : null,
    completedAt: job.completedAt ? new Date(job.completedAt) : null,
    createdAt: new Date(job.createdAt),
    updatedAt: new Date(job.updatedAt),
    items: job.items?.map((item) => ({
      ...item,
      originalListingStartDate: item.originalListingStartDate
        ? new Date(item.originalListingStartDate)
        : null,
      originalListingEndDate: item.originalListingEndDate
        ? new Date(item.originalListingEndDate)
        : null,
      newListingStartDate: item.newListingStartDate ? new Date(item.newListingStartDate) : null,
      fetchCompletedAt: item.fetchCompletedAt ? new Date(item.fetchCompletedAt) : null,
      endCompletedAt: item.endCompletedAt ? new Date(item.endCompletedAt) : null,
      createCompletedAt: item.createCompletedAt ? new Date(item.createCompletedAt) : null,
      createdAt: new Date(item.createdAt),
      updatedAt: new Date(item.updatedAt),
    })),
  };
}

// ============================================================================
// Query Keys
// ============================================================================

export const refreshJobKeys = {
  all: ['refresh-jobs'] as const,
  lists: () => [...refreshJobKeys.all, 'list'] as const,
  list: (limit?: number) => [...refreshJobKeys.lists(), { limit }] as const,
  details: () => [...refreshJobKeys.all, 'detail'] as const,
  detail: (id: string) => [...refreshJobKeys.details(), id] as const,
};

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to fetch a single refresh job
 */
export function useRefreshJob(jobId: string | undefined, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: refreshJobKeys.detail(jobId || ''),
    queryFn: () => fetchRefreshJob(jobId!),
    enabled: !!jobId && (options?.enabled !== false),
    staleTime: 10 * 1000, // 10 seconds
    refetchInterval: (query) => {
      // Poll while job is in progress
      const data = query.state.data;
      if (data && ['fetching', 'ending', 'creating'].includes(data.status)) {
        return 2000; // 2 seconds
      }
      return false;
    },
  });
}

/**
 * Hook to fetch refresh history
 */
export function useRefreshHistory(limit = 20) {
  return useQuery({
    queryKey: refreshJobKeys.list(limit),
    queryFn: () => fetchRefreshHistory(limit),
    staleTime: 30 * 1000, // 30 seconds
  });
}

/**
 * Hook to create a new refresh job
 */
export function useCreateRefreshJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ listings, reviewMode }: { listings: EligibleListing[]; reviewMode: boolean }) =>
      createRefreshJob(listings, reviewMode),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: refreshJobKeys.lists() });
    },
  });
}

/**
 * Hook to cancel a refresh job
 */
export function useCancelRefreshJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: cancelRefreshJob,
    onSuccess: (_, jobId) => {
      queryClient.invalidateQueries({ queryKey: refreshJobKeys.detail(jobId) });
      queryClient.invalidateQueries({ queryKey: refreshJobKeys.lists() });
    },
  });
}

/**
 * Hook to approve items
 */
export function useApproveItems() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ jobId, itemIds }: { jobId: string; itemIds: string[] }) =>
      approveItems(jobId, itemIds),
    onSuccess: (_, { jobId }) => {
      queryClient.invalidateQueries({ queryKey: refreshJobKeys.detail(jobId) });
    },
  });
}

/**
 * Hook to skip items
 */
export function useSkipItems() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ jobId, itemIds }: { jobId: string; itemIds: string[] }) =>
      skipItems(jobId, itemIds),
    onSuccess: (_, { jobId }) => {
      queryClient.invalidateQueries({ queryKey: refreshJobKeys.detail(jobId) });
    },
  });
}

/**
 * Hook to update an item before refresh
 */
export function useUpdateRefreshItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      jobId,
      itemId,
      updates,
    }: {
      jobId: string;
      itemId: string;
      updates: UpdateRefreshItemRequest;
    }) => updateRefreshItem(jobId, itemId, updates),
    onSuccess: (_, { jobId }) => {
      queryClient.invalidateQueries({ queryKey: refreshJobKeys.detail(jobId) });
    },
  });
}
