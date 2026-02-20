'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchMinifigSyncItems,
  fetchMinifigSyncItem,
  triggerInventoryPull,
  triggerResearch,
  triggerForceRefresh,
  triggerCreateListings,
  publishListing,
  dismissListing,
  approveRemoval,
  dismissRemoval,
  updateSyncItem,
  bulkPublishListings,
  fetchRemovals,
  bulkApproveRemovals,
  fetchMinifigDashboard,
} from '@/lib/api/minifig-sync';
import type { MinifigSyncFilters } from '@/lib/api/minifig-sync';

// ── Query Key Factory ──────────────────────────────────

export const minifigSyncKeys = {
  all: ['minifig-sync'] as const,
  lists: () => [...minifigSyncKeys.all, 'list'] as const,
  list: (filters?: MinifigSyncFilters) =>
    [...minifigSyncKeys.lists(), filters] as const,
  items: () => [...minifigSyncKeys.all, 'item'] as const,
  item: (id: string) => [...minifigSyncKeys.items(), id] as const,
  removals: () => [...minifigSyncKeys.all, 'removals'] as const,
  dashboard: () => [...minifigSyncKeys.all, 'dashboard'] as const,
};

// ── Query Hooks ────────────────────────────────────────

export function useMinifigSyncItems(filters?: MinifigSyncFilters) {
  return useQuery({
    queryKey: minifigSyncKeys.list(filters),
    queryFn: () => fetchMinifigSyncItems(filters),
    staleTime: 2 * 60 * 1000,
  });
}

export function useMinifigSyncItem(id: string | null) {
  return useQuery({
    queryKey: minifigSyncKeys.item(id ?? ''),
    queryFn: () => fetchMinifigSyncItem(id!),
    enabled: !!id,
    staleTime: 2 * 60 * 1000,
  });
}

export function useMinifigDashboard() {
  return useQuery({
    queryKey: minifigSyncKeys.dashboard(),
    queryFn: fetchMinifigDashboard,
    staleTime: 60 * 1000,
  });
}

export function useMinifigRemovals() {
  return useQuery({
    queryKey: minifigSyncKeys.removals(),
    queryFn: fetchRemovals,
    staleTime: 30 * 1000,
  });
}

// ── Mutation Hooks ─────────────────────────────────────

export function useInventoryPull() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: triggerInventoryPull,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: minifigSyncKeys.lists() });

      queryClient.invalidateQueries({ queryKey: minifigSyncKeys.dashboard() });
    },
  });
}

export function useResearch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemIds?: string[]) => triggerResearch(itemIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: minifigSyncKeys.lists() });

      queryClient.invalidateQueries({ queryKey: minifigSyncKeys.dashboard() });
    },
  });
}

export function useForceRefresh() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: triggerForceRefresh,
    onSuccess: (_data, itemId) => {
      queryClient.invalidateQueries({ queryKey: minifigSyncKeys.item(itemId) });
      queryClient.invalidateQueries({ queryKey: minifigSyncKeys.lists() });
    },
  });
}

export function useCreateListings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemIds?: string[]) => triggerCreateListings(itemIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: minifigSyncKeys.lists() });

      queryClient.invalidateQueries({ queryKey: minifigSyncKeys.dashboard() });
    },
  });
}

export function usePublishListing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: publishListing,
    onSuccess: (_data, itemId) => {
      queryClient.invalidateQueries({ queryKey: minifigSyncKeys.item(itemId) });
      queryClient.invalidateQueries({ queryKey: minifigSyncKeys.lists() });
      queryClient.invalidateQueries({ queryKey: minifigSyncKeys.dashboard() });
    },
  });
}

export function useDismissListing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: dismissListing,
    onSuccess: (_data, itemId) => {
      queryClient.invalidateQueries({ queryKey: minifigSyncKeys.item(itemId) });
      queryClient.invalidateQueries({ queryKey: minifigSyncKeys.lists() });
      queryClient.invalidateQueries({ queryKey: minifigSyncKeys.dashboard() });
    },
  });
}

export function useApproveRemoval() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: approveRemoval,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: minifigSyncKeys.removals() });
      queryClient.invalidateQueries({ queryKey: minifigSyncKeys.lists() });
      queryClient.invalidateQueries({ queryKey: minifigSyncKeys.dashboard() });
    },
  });
}

export function useDismissRemoval() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: dismissRemoval,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: minifigSyncKeys.removals() });
      queryClient.invalidateQueries({ queryKey: minifigSyncKeys.lists() });
    },
  });
}

export function useBulkApproveRemovals() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: bulkApproveRemovals,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: minifigSyncKeys.removals() });
      queryClient.invalidateQueries({ queryKey: minifigSyncKeys.lists() });
      queryClient.invalidateQueries({ queryKey: minifigSyncKeys.dashboard() });
    },
  });
}

export function useUpdateSyncItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: { title?: string; description?: string; price?: number };
    }) => updateSyncItem(id, data),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: minifigSyncKeys.item(id) });
      queryClient.invalidateQueries({ queryKey: minifigSyncKeys.lists() });
    },
  });
}

export function useBulkPublish() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: bulkPublishListings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: minifigSyncKeys.lists() });
      queryClient.invalidateQueries({ queryKey: minifigSyncKeys.dashboard() });
    },
  });
}
