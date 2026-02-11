'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchReviewQueue,
  approveReviewItem,
  dismissReviewItem,
  bulkDismissReviewItems,
  type ApproveReviewInput,
} from '@/lib/api';

/**
 * Query key factory for review queue queries
 */
export const reviewQueueKeys = {
  all: ['review-queue'] as const,
  lists: () => [...reviewQueueKeys.all, 'list'] as const,
  list: (page?: number, pageSize?: number) =>
    [...reviewQueueKeys.lists(), { page, pageSize }] as const,
  count: () => [...reviewQueueKeys.all, 'count'] as const,
};

/**
 * Hook to fetch review queue items
 */
export function useReviewQueue(page = 1, pageSize = 50) {
  return useQuery({
    queryKey: reviewQueueKeys.list(page, pageSize),
    queryFn: () => fetchReviewQueue(page, pageSize),
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

/**
 * Hook to fetch just the count of review queue items (for badge)
 */
export function useReviewQueueCount() {
  return useQuery({
    queryKey: reviewQueueKeys.count(),
    queryFn: async () => {
      const result = await fetchReviewQueue(1, 1);
      return result.total;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to approve a review item with a set number
 */
export function useApproveReviewItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ApproveReviewInput }) =>
      approveReviewItem(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reviewQueueKeys.lists() });
      queryClient.invalidateQueries({ queryKey: reviewQueueKeys.count() });
    },
  });
}

/**
 * Hook to dismiss a single review item
 */
export function useDismissReviewItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => dismissReviewItem(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reviewQueueKeys.lists() });
      queryClient.invalidateQueries({ queryKey: reviewQueueKeys.count() });
    },
  });
}

/**
 * Hook to bulk dismiss multiple review items
 */
export function useBulkDismissReviewItems() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ids: string[]) => bulkDismissReviewItems(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reviewQueueKeys.lists() });
      queryClient.invalidateQueries({ queryKey: reviewQueueKeys.count() });
    },
  });
}
