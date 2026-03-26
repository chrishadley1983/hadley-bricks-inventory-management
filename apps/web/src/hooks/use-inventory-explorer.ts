'use client';

import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

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
  enrichedLots: number;
  staleLots: number;
}

export type ItemType = 'Part' | 'Set' | 'Minifig';

export interface ItemsFilters {
  type: ItemType;
  search: string;
  condition: string;
  color: string;
  enriched: string;
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
  if (filters.enriched) params.set('enriched', filters.enriched);

  const res = await fetch(`/api/inventory/explorer/items?${params}`);
  if (!res.ok) throw new Error('Failed to fetch items');
  const json = await res.json();
  return json.data;
}

export interface SyncProgress {
  page: number;
  totalPages: number;
  itemsFetched: number;
  totalItems: number;
  status: 'running' | 'completed' | 'failed';
}

export interface EnrichProgress {
  processed: number;
  total: number;
  fetched: number;
  errors: number;
  status: 'running' | 'completed' | 'failed';
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
  const [progress, setProgress] = useState<EnrichProgress | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [result, setResult] = useState<{ newlyFetched: number; errors: number } | null>(null);

  const enrich = useCallback(async () => {
    if (isEnriching) return;

    setIsEnriching(true);
    setProgress({ processed: 0, total: 0, fetched: 0, errors: 0, status: 'running' });
    setError(null);
    setResult(null);

    try {
      const response = await fetch('/api/inventory/explorer/enrich', { method: 'POST' });

      if (!response.ok || !response.body) {
        throw new Error('Failed to start enrichment');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let eventType = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7);
          } else if (line.startsWith('data: ') && eventType) {
            try {
              const data = JSON.parse(line.slice(6));
              if (eventType === 'progress') {
                setProgress(data as EnrichProgress);
              } else if (eventType === 'complete') {
                setResult(data);
                setProgress((prev) => prev ? { ...prev, status: 'completed' } : null);
              } else if (eventType === 'error') {
                throw new Error(data.error || 'Enrichment failed');
              }
            } catch (parseError) {
              if (parseError instanceof Error && parseError.message !== 'Enrichment failed') {
                console.error('Failed to parse SSE data:', parseError);
              } else {
                throw parseError;
              }
            }
            eventType = '';
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Enrichment failed'));
      setProgress((prev) => prev ? { ...prev, status: 'failed' } : null);
    } finally {
      setIsEnriching(false);
      queryClient.invalidateQueries({ queryKey: explorerKeys.all });
    }
  }, [isEnriching, queryClient]);

  return { enrich, isEnriching, progress, error, result };
}

export function useExplorerSync() {
  const queryClient = useQueryClient();
  const [isSyncing, setIsSyncing] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [result, setResult] = useState<{ itemsSynced: number; complete: boolean } | null>(null);

  const sync = useCallback(async () => {
    if (isSyncing) return;

    setIsSyncing(true);
    setProgress({ page: 0, totalPages: 0, itemsFetched: 0, totalItems: 0, status: 'running' });
    setError(null);
    setResult(null);

    try {
      const response = await fetch('/api/inventory/explorer/sync', { method: 'POST' });

      if (!response.ok || !response.body) {
        throw new Error('Failed to start sync');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let eventType = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7);
          } else if (line.startsWith('data: ') && eventType) {
            try {
              const data = JSON.parse(line.slice(6));
              if (eventType === 'progress') {
                setProgress(data as SyncProgress);
              } else if (eventType === 'complete') {
                setResult(data);
                setProgress((prev) => prev ? { ...prev, status: 'completed' } : null);
              } else if (eventType === 'error') {
                throw new Error(data.error || 'Sync failed');
              }
            } catch (parseError) {
              if (parseError instanceof Error && parseError.message !== 'Sync failed') {
                console.error('Failed to parse SSE data:', parseError);
              } else {
                throw parseError;
              }
            }
            eventType = '';
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Sync failed'));
      setProgress((prev) => prev ? { ...prev, status: 'failed' } : null);
    } finally {
      setIsSyncing(false);
      queryClient.invalidateQueries({ queryKey: explorerKeys.all });
    }
  }, [isSyncing, queryClient]);

  return { sync, isSyncing, progress, error, result };
}
