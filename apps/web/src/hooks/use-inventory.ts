'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { InventoryItemInsert, InventoryItemUpdate } from '@hadley-bricks/database';
import {
  fetchInventory,
  fetchInventoryItem,
  fetchInventorySummary,
  fetchPlatforms,
  createInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
  bulkUpdateInventoryItems,
  type InventoryFilters,
  type PaginationParams,
  type BulkUpdateInput,
} from '@/lib/api';

/**
 * Query key factory for inventory queries
 */
export const inventoryKeys = {
  all: ['inventory'] as const,
  lists: () => [...inventoryKeys.all, 'list'] as const,
  list: (filters?: InventoryFilters, pagination?: PaginationParams) =>
    [...inventoryKeys.lists(), { filters, pagination }] as const,
  details: () => [...inventoryKeys.all, 'detail'] as const,
  detail: (id: string) => [...inventoryKeys.details(), id] as const,
  summary: () => [...inventoryKeys.all, 'summary'] as const,
  platforms: () => [...inventoryKeys.all, 'platforms'] as const,
};

/**
 * Hook to fetch paginated inventory list
 */
export function useInventoryList(filters?: InventoryFilters, pagination?: PaginationParams) {
  return useQuery({
    queryKey: inventoryKeys.list(filters, pagination),
    queryFn: () => fetchInventory(filters, pagination),
  });
}

/**
 * Hook to fetch a single inventory item
 */
export function useInventoryItem(id: string | undefined) {
  return useQuery({
    queryKey: inventoryKeys.detail(id!),
    queryFn: () => fetchInventoryItem(id!),
    enabled: !!id,
  });
}

/**
 * Hook to fetch inventory summary statistics
 */
export function useInventorySummary(options?: { excludeSold?: boolean; platform?: string | null }) {
  return useQuery({
    queryKey: [...inventoryKeys.summary(), { excludeSold: options?.excludeSold, platform: options?.platform }],
    queryFn: () => fetchInventorySummary({
      excludeSold: options?.excludeSold,
      platform: options?.platform || undefined,
    }),
  });
}

/**
 * Hook to fetch distinct listing platforms
 */
export function usePlatforms() {
  return useQuery({
    queryKey: inventoryKeys.platforms(),
    queryFn: () => fetchPlatforms(),
    staleTime: 5 * 60 * 1000, // 5 minutes - platforms don't change often
  });
}

/**
 * Hook to create a new inventory item
 */
export function useCreateInventory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Omit<InventoryItemInsert, 'user_id'>) => createInventoryItem(data),
    onSuccess: () => {
      // Invalidate all inventory queries to refetch
      queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
    },
  });
}

/**
 * Hook to update an inventory item
 */
export function useUpdateInventory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: InventoryItemUpdate }) =>
      updateInventoryItem(id, data),
    onSuccess: (updatedItem) => {
      // Update the specific item in cache
      queryClient.setQueryData(inventoryKeys.detail(updatedItem.id), updatedItem);
      // Invalidate list queries
      queryClient.invalidateQueries({ queryKey: inventoryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.summary() });
    },
  });
}

/**
 * Hook to delete an inventory item
 */
export function useDeleteInventory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteInventoryItem(id),
    onSuccess: (_, deletedId) => {
      // Remove from cache
      queryClient.removeQueries({ queryKey: inventoryKeys.detail(deletedId) });
      // Invalidate list queries
      queryClient.invalidateQueries({ queryKey: inventoryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.summary() });
    },
  });
}

/**
 * Hook to bulk update multiple inventory items
 */
export function useBulkUpdateInventory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: BulkUpdateInput) => bulkUpdateInventoryItems(input),
    onSuccess: (result) => {
      // Update cached items
      result.data.forEach((item) => {
        queryClient.setQueryData(inventoryKeys.detail(item.id), item);
      });
      // Invalidate list queries to refetch with updated data
      queryClient.invalidateQueries({ queryKey: inventoryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.summary() });
    },
  });
}
