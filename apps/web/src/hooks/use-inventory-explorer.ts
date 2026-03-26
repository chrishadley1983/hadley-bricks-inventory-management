'use client';

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// ============================================
// Types
// ============================================

export interface ExplorerOverview {
  totalItems: number;
  totalLots: number;
  estimatedValue: number;
  averageSTR: number | null;
  conditionBreakdown: Array<{
    condition: string;
    items: number;
    value: number;
    percentage: number;
  }>;
  typeBreakdown: Array<{
    type: string;
    items: number;
    value: number;
    percentage: number;
  }>;
  top10: Array<{
    itemNumber: string;
    itemName: string;
    colorName: string | null;
    colorRgb: string | null;
    imageUrl: string | null;
    condition: string;
    quantity: number;
    avgPrice: number;
    value: number;
    str: number | null;
  }>;
}

export interface ExplorerItem {
  itemNumber: string;
  itemName: string;
  itemType: string;
  colorId: number | null;
  colorName: string | null;
  colorRgb: string | null;
  condition: string;
  quantity: number;
  price: number;
  value: number;
  imageUrl: string | null;
  blAvg: number | null;
  str: number | null;
  sold: number | null;
  forSale: number | null;
}

export interface ExplorerItemsResponse {
  items: ExplorerItem[];
  totalCount: number;
  totalLots: number;
  totalItems: number;
  totalValue: number;
  page: number;
  pageSize: number;
  totalPages: number;
  colors: string[];
}

export interface SyncStatus {
  syncStatus: 'idle' | 'running' | 'failed' | 'never';
  lastFullSync: string | null;
  totalItems: number;
  totalLots: number;
  syncCursor: number;
  syncError: string | null;
}

export type ItemType = 'Part' | 'Set' | 'Minifig';

export interface ItemsFilters {
  type: ItemType;
  search: string;
  condition: string;
  color: string;
  page: number;
  sort: string;
  dir: 'asc' | 'desc';
}

// ============================================
// Query Keys
// ============================================

export const explorerKeys = {
  all: ['inventory-explorer'] as const,
  overview: () => [...explorerKeys.all, 'overview'] as const,
  syncStatus: () => [...explorerKeys.all, 'sync-status'] as const,
  items: (filters: ItemsFilters) => [...explorerKeys.all, 'items', filters] as const,
};

// ============================================
// Fetchers
// ============================================

async function fetchOverview(): Promise<ExplorerOverview> {
  const res = await fetch('/api/inventory/explorer/overview');
  if (!res.ok) throw new Error('Failed to fetch overview');
  const json = await res.json();
  return json.data;
}

async function fetchSyncStatus(): Promise<SyncStatus> {
  const res = await fetch('/api/inventory/explorer/sync-status');
  if (!res.ok) throw new Error('Failed to fetch sync status');
  const json = await res.json();
  return json.data;
}

async function fetchItems(filters: ItemsFilters): Promise<ExplorerItemsResponse> {
  const params = new URLSearchParams({
    type: filters.type,
    page: String(filters.page),
    sort: filters.sort,
    dir: filters.dir,
  });
  if (filters.search) params.set('search', filters.search);
  if (filters.condition) params.set('condition', filters.condition);
  if (filters.color) params.set('color', filters.color);

  const res = await fetch(`/api/inventory/explorer/items?${params}`);
  if (!res.ok) throw new Error('Failed to fetch items');
  const json = await res.json();
  return json.data;
}

async function triggerEnrich(): Promise<{ newlyFetched: number; errors: number }> {
  const res = await fetch('/api/inventory/explorer/enrich', { method: 'POST' });
  if (!res.ok) {
    const json = await res.json();
    throw new Error(json.error || 'Enrichment failed');
  }
  const json = await res.json();
  return json.data;
}

async function triggerSync(): Promise<{ itemsSynced: number; complete: boolean }> {
  const res = await fetch('/api/inventory/explorer/sync', { method: 'POST' });
  if (!res.ok) {
    const json = await res.json();
    throw new Error(json.error || 'Sync failed');
  }
  const json = await res.json();
  return json.data;
}

// ============================================
// Hooks
// ============================================

export function useExplorerOverview() {
  return useQuery({
    queryKey: explorerKeys.overview(),
    queryFn: fetchOverview,
    staleTime: 5 * 60 * 1000,
  });
}

export function useExplorerSyncStatus() {
  return useQuery({
    queryKey: explorerKeys.syncStatus(),
    queryFn: fetchSyncStatus,
    staleTime: 10 * 1000,
  });
}

export function useExplorerItems(filters: ItemsFilters) {
  return useQuery({
    queryKey: explorerKeys.items(filters),
    queryFn: () => fetchItems(filters),
    staleTime: 5 * 60 * 1000,
  });
}

export function useExplorerEnrich() {
  const queryClient = useQueryClient();
  const [isEnriching, setIsEnriching] = useState(false);

  const mutation = useMutation({
    mutationFn: triggerEnrich,
    onMutate: () => setIsEnriching(true),
    onSettled: () => {
      setIsEnriching(false);
      queryClient.invalidateQueries({ queryKey: explorerKeys.all });
    },
  });

  const enrich = useCallback(() => {
    if (!isEnriching) {
      mutation.mutate();
    }
  }, [isEnriching, mutation]);

  return {
    enrich,
    isEnriching,
    error: mutation.error,
    data: mutation.data,
  };
}

export function useExplorerSync() {
  const queryClient = useQueryClient();
  const [isSyncing, setIsSyncing] = useState(false);

  const mutation = useMutation({
    mutationFn: triggerSync,
    onMutate: () => setIsSyncing(true),
    onSettled: () => {
      setIsSyncing(false);
      queryClient.invalidateQueries({ queryKey: explorerKeys.all });
    },
  });

  const sync = useCallback(() => {
    if (!isSyncing) {
      mutation.mutate();
    }
  }, [isSyncing, mutation]);

  return {
    sync,
    isSyncing,
    error: mutation.error,
    data: mutation.data,
  };
}
