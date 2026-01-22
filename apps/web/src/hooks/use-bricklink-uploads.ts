'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchBrickLinkUploads,
  fetchBrickLinkUpload,
  createBrickLinkUpload,
  updateBrickLinkUpload,
  deleteBrickLinkUpload,
  getBatchSyncStatus,
  triggerBatchSync,
  type BrickLinkUpload,
  type BrickLinkUploadInsert,
  type BrickLinkUploadUpdate,
  type BrickLinkUploadFilters,
  type BatchSyncOptions,
} from '@/lib/api/bricklink-uploads';
import type { PaginationParams } from '@/lib/api/inventory';

export type { BrickLinkUpload, BrickLinkUploadInsert, BrickLinkUploadUpdate, BrickLinkUploadFilters };

/**
 * Query key factory for upload queries
 */
export const uploadKeys = {
  all: ['bricklink-uploads'] as const,
  lists: () => [...uploadKeys.all, 'list'] as const,
  list: (filters?: BrickLinkUploadFilters, pagination?: PaginationParams) =>
    [...uploadKeys.lists(), { filters, pagination }] as const,
  details: () => [...uploadKeys.all, 'detail'] as const,
  detail: (id: string) => [...uploadKeys.details(), id] as const,
  byPurchase: (purchaseId: string) => [...uploadKeys.all, 'byPurchase', purchaseId] as const,
  unlinked: () => [...uploadKeys.all, 'unlinked'] as const,
  sync: () => [...uploadKeys.all, 'sync'] as const,
};

/**
 * Hook to fetch paginated upload list
 */
export function useBrickLinkUploadList(
  filters?: BrickLinkUploadFilters,
  pagination?: PaginationParams
) {
  return useQuery({
    queryKey: uploadKeys.list(filters, pagination),
    queryFn: () => fetchBrickLinkUploads(filters, pagination),
  });
}

/**
 * Hook to fetch a single upload
 */
export function useBrickLinkUpload(id: string | undefined) {
  return useQuery({
    queryKey: uploadKeys.detail(id!),
    queryFn: () => fetchBrickLinkUpload(id!),
    enabled: !!id,
  });
}

/**
 * Hook to fetch uploads linked to a specific purchase
 */
export function useBrickLinkUploadsByPurchase(purchaseId: string | undefined) {
  return useQuery({
    queryKey: uploadKeys.byPurchase(purchaseId!),
    queryFn: () => fetchBrickLinkUploads({ purchaseId: purchaseId! }, { page: 1, pageSize: 100 }),
    enabled: !!purchaseId,
  });
}

/**
 * Hook to fetch unlinked uploads (for linking dialog)
 */
export function useUnlinkedBrickLinkUploads(filters?: Omit<BrickLinkUploadFilters, 'unlinked'>, pagination?: PaginationParams) {
  return useQuery({
    queryKey: uploadKeys.list({ ...filters, unlinked: true }, pagination),
    queryFn: () => fetchBrickLinkUploads({ ...filters, unlinked: true }, pagination),
  });
}

/**
 * Hook to create a new upload
 */
export function useCreateBrickLinkUpload() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: BrickLinkUploadInsert) => createBrickLinkUpload(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: uploadKeys.all });
    },
  });
}

/**
 * Hook to update an upload
 */
export function useUpdateBrickLinkUpload() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: BrickLinkUploadUpdate }) =>
      updateBrickLinkUpload(id, data),
    onSuccess: (updatedUpload) => {
      queryClient.setQueryData(uploadKeys.detail(updatedUpload.id), updatedUpload);
      // Invalidate all upload queries including byPurchase queries
      // This ensures linked uploads appear on purchase detail pages
      queryClient.invalidateQueries({ queryKey: uploadKeys.all });
    },
  });
}

/**
 * Hook to delete an upload
 */
export function useDeleteBrickLinkUpload() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteBrickLinkUpload(id),
    onSuccess: (_, deletedId) => {
      queryClient.removeQueries({ queryKey: uploadKeys.detail(deletedId) });
      queryClient.invalidateQueries({ queryKey: uploadKeys.lists() });
    },
  });
}

/**
 * Hook to get batch sync status
 */
export function useBrickLinkUploadSyncStatus(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: uploadKeys.sync(),
    queryFn: () => getBatchSyncStatus(),
    enabled: options?.enabled ?? true,
    refetchInterval: 30000, // Refetch every 30 seconds
  });
}

/**
 * Hook to trigger batch sync
 */
export function useTriggerBatchSync() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (options?: BatchSyncOptions) => triggerBatchSync(options),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: uploadKeys.all });
    },
  });
}
