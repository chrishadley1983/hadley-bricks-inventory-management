/**
 * Arbitrage Tracker React Hooks
 *
 * TanStack Query hooks for arbitrage data, exclusions, mappings, and sync.
 */

'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  ArbitrageItem,
  ArbitrageDataResponse,
  ArbitrageFilterOptions,
  ExcludedAsin,
  UnmappedAsin,
  ArbitrageSyncStatus,
  SyncJobType,
} from '@/lib/arbitrage/types';

// ============================================================================
// TYPES
// ============================================================================

interface SyncStatusResponse {
  syncStatus: Record<SyncJobType, ArbitrageSyncStatus | null>;
  stats: {
    totalItems: number;
    opportunities: number;
    unmapped: number;
    excluded: number;
  };
}

interface UnmappedResponse {
  items: UnmappedAsin[];
  count: number;
}

interface SummaryStats {
  totalItems: number;
  opportunities: number;
  ebayOpportunities: number;
  unmapped: number;
  excluded: number;
}

interface SyncResult {
  inventoryAsins?: { added: number; updated: number; total: number } | { error: string };
  asinMapping?: { mapped: number; failed: number; total: number } | { error: string };
  amazonPricing?: { updated: number; failed: number; total: number } | { error: string };
  bricklinkPricing?: { updated: number; failed: number; total: number } | { error: string };
}

// ============================================================================
// QUERY KEY FACTORY
// ============================================================================

export const arbitrageKeys = {
  all: ['arbitrage'] as const,
  lists: () => [...arbitrageKeys.all, 'list'] as const,
  list: (filters?: ArbitrageFilterOptions) => [...arbitrageKeys.lists(), filters] as const,
  items: () => [...arbitrageKeys.all, 'item'] as const,
  item: (asin: string) => [...arbitrageKeys.items(), asin] as const,
  excluded: () => [...arbitrageKeys.all, 'excluded'] as const,
  unmapped: () => [...arbitrageKeys.all, 'unmapped'] as const,
  syncStatus: () => [...arbitrageKeys.all, 'sync-status'] as const,
  summary: (minMargin?: number, maxCog?: number) =>
    [...arbitrageKeys.all, 'summary', minMargin, maxCog] as const,
  ebayExclusions: (setNumber?: string) =>
    [...arbitrageKeys.all, 'ebay-exclusions', setNumber] as const,
};

// ============================================================================
// FETCH FUNCTIONS
// ============================================================================

async function fetchArbitrageData(
  filters?: ArbitrageFilterOptions
): Promise<ArbitrageDataResponse> {
  const params = new URLSearchParams();

  if (filters?.minMargin !== undefined) params.set('minMargin', String(filters.minMargin));
  if (filters?.maxCog !== undefined) params.set('maxCog', String(filters.maxCog));
  if (filters?.show) params.set('show', filters.show);
  if (filters?.sortField) params.set('sortField', filters.sortField);
  if (filters?.sortDirection) params.set('sortDirection', filters.sortDirection);
  if (filters?.search) params.set('search', filters.search);
  if (filters?.page) params.set('page', String(filters.page));
  if (filters?.pageSize) params.set('pageSize', String(filters.pageSize));

  const response = await fetch(`/api/arbitrage?${params.toString()}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch arbitrage data');
  }

  const json = await response.json();
  return json.data;
}

async function fetchArbitrageItem(asin: string): Promise<ArbitrageItem> {
  const response = await fetch(`/api/arbitrage/${asin}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch item');
  }

  const json = await response.json();
  return json.data;
}

async function fetchExcludedAsins(): Promise<ExcludedAsin[]> {
  const response = await fetch('/api/arbitrage/excluded');

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch excluded ASINs');
  }

  const json = await response.json();
  return json.data;
}

async function fetchUnmappedAsins(): Promise<UnmappedResponse> {
  const response = await fetch('/api/arbitrage/unmapped');

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch unmapped ASINs');
  }

  const json = await response.json();
  return json.data;
}

async function fetchSyncStatus(): Promise<SyncStatusResponse> {
  const response = await fetch('/api/arbitrage/sync');

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch sync status');
  }

  const json = await response.json();
  return json.data;
}

async function fetchSummary(minMargin?: number, maxCog?: number): Promise<SummaryStats> {
  const params = new URLSearchParams();
  if (minMargin !== undefined) params.set('minMargin', String(minMargin));
  if (maxCog !== undefined) params.set('maxCog', String(maxCog));
  const queryString = params.toString();
  const response = await fetch(`/api/arbitrage/summary${queryString ? `?${queryString}` : ''}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch summary');
  }

  const json = await response.json();
  return json.data;
}

// ============================================================================
// MUTATION FUNCTIONS
// ============================================================================

async function excludeAsin(input: { asin: string; reason?: string }): Promise<void> {
  const response = await fetch(`/api/arbitrage/${input.asin}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'exclude', reason: input.reason }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to exclude ASIN');
  }
}

async function restoreAsin(asin: string): Promise<void> {
  const response = await fetch(`/api/arbitrage/${asin}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'restore' }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to restore ASIN');
  }
}

async function setBlPriceOverride(input: {
  asin: string;
  override: number | null;
}): Promise<{ minBlPriceOverride: number | null }> {
  const response = await fetch(`/api/arbitrage/${input.asin}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'setOverride', minBlPriceOverride: input.override }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to set BL price override');
  }

  const json = await response.json();
  return json.data;
}

async function createMapping(input: { asin: string; bricklinkSetNumber: string }): Promise<{
  asin: string;
  bricklinkSetNumber: string;
  setName?: string;
}> {
  const response = await fetch('/api/arbitrage/mapping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create mapping');
  }

  const json = await response.json();
  return json.data;
}

async function deleteMapping(asin: string): Promise<void> {
  const response = await fetch('/api/arbitrage/mapping', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ asin }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete mapping');
  }
}

async function triggerSync(jobType: SyncJobType | 'all'): Promise<SyncResult> {
  const response = await fetch('/api/arbitrage/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobType }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to trigger sync');
  }

  const json = await response.json();
  return json.data;
}

// ============================================================================
// QUERY HOOKS
// ============================================================================

/**
 * Fetch arbitrage data with filtering and pagination
 */
export function useArbitrageData(filters?: ArbitrageFilterOptions) {
  return useQuery({
    queryKey: arbitrageKeys.list(filters),
    queryFn: () => fetchArbitrageData(filters),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Fetch a single arbitrage item
 */
export function useArbitrageItem(asin: string | null) {
  return useQuery({
    queryKey: arbitrageKeys.item(asin ?? ''),
    queryFn: () => fetchArbitrageItem(asin!),
    enabled: !!asin,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch excluded ASINs
 */
export function useExcludedAsins() {
  return useQuery({
    queryKey: arbitrageKeys.excluded(),
    queryFn: fetchExcludedAsins,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch unmapped ASINs
 */
export function useUnmappedAsins() {
  return useQuery({
    queryKey: arbitrageKeys.unmapped(),
    queryFn: fetchUnmappedAsins,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch sync status and summary stats
 */
export function useSyncStatus() {
  return useQuery({
    queryKey: arbitrageKeys.syncStatus(),
    queryFn: fetchSyncStatus,
    staleTime: 30 * 1000, // 30 seconds
  });
}

/**
 * Fetch summary statistics
 */
export function useArbitrageSummary(minMargin?: number, maxCog?: number) {
  return useQuery({
    queryKey: arbitrageKeys.summary(minMargin, maxCog),
    queryFn: () => fetchSummary(minMargin, maxCog),
    staleTime: 5 * 60 * 1000,
  });
}

// ============================================================================
// MUTATION HOOKS
// ============================================================================

/**
 * Exclude an ASIN from tracking
 */
export function useExcludeAsin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: excludeAsin,
    onSuccess: () => {
      // Surgical invalidation - only invalidate lists, excluded, and summary
      queryClient.invalidateQueries({ queryKey: arbitrageKeys.lists() });
      queryClient.invalidateQueries({ queryKey: arbitrageKeys.excluded() });
      queryClient.invalidateQueries({ queryKey: arbitrageKeys.summary() });
    },
  });
}

/**
 * Restore an excluded ASIN
 */
export function useRestoreAsin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: restoreAsin,
    onSuccess: () => {
      // Surgical invalidation - only invalidate lists, excluded, and summary
      queryClient.invalidateQueries({ queryKey: arbitrageKeys.lists() });
      queryClient.invalidateQueries({ queryKey: arbitrageKeys.excluded() });
      queryClient.invalidateQueries({ queryKey: arbitrageKeys.summary() });
    },
  });
}

/**
 * Set or clear the minimum BrickLink price override for an ASIN
 * When set, COG% uses MAX(actual_bl_min, override) for calculations
 */
export function useSetBlPriceOverride() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: setBlPriceOverride,
    onSuccess: (_, variables) => {
      // Invalidate lists and the specific item
      queryClient.invalidateQueries({ queryKey: arbitrageKeys.lists() });
      queryClient.invalidateQueries({ queryKey: arbitrageKeys.item(variables.asin) });
      queryClient.invalidateQueries({ queryKey: arbitrageKeys.summary() });
    },
  });
}

/**
 * Create a manual ASIN to BrickLink mapping
 */
export function useCreateMapping() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createMapping,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: arbitrageKeys.unmapped() });
      queryClient.invalidateQueries({ queryKey: arbitrageKeys.list() });
      queryClient.invalidateQueries({ queryKey: arbitrageKeys.syncStatus() });
    },
  });
}

/**
 * Delete an ASIN mapping
 */
export function useDeleteMapping() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteMapping,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: arbitrageKeys.unmapped() });
      queryClient.invalidateQueries({ queryKey: arbitrageKeys.list() });
    },
  });
}

/**
 * Trigger a sync job
 */
export function useTriggerSync() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: triggerSync,
    onSuccess: () => {
      // Surgical invalidation - sync affects lists, summary, and sync status
      queryClient.invalidateQueries({ queryKey: arbitrageKeys.lists() });
      queryClient.invalidateQueries({ queryKey: arbitrageKeys.summary() });
      queryClient.invalidateQueries({ queryKey: arbitrageKeys.syncStatus() });
    },
  });
}

// ============================================================================
// STREAMING SYNC HOOKS
// ============================================================================

export interface SyncProgress {
  type: 'start' | 'progress' | 'complete' | 'error';
  message?: string;
  processed?: number;
  total?: number;
  percent?: number;
  result?: { updated?: number; failed?: number; total?: number; added?: number };
}

// Keep EbaySyncProgress as alias for backward compatibility
export type EbaySyncProgress = SyncProgress;

/**
 * Helper to create a streaming sync mutation
 */
function createStreamingSyncMutation(
  endpoint: string,
  _queryClient: ReturnType<typeof useQueryClient>
) {
  return async (onProgress: (progress: SyncProgress) => void): Promise<SyncProgress> => {
    const response = await fetch(endpoint, {
      method: 'POST',
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to start sync');
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let lastProgress: SyncProgress = { type: 'start' };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6)) as SyncProgress;
              lastProgress = data;
              onProgress(data);
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    } finally {
      // Always release the reader lock to prevent memory leaks
      reader.releaseLock();
    }

    return lastProgress;
  };
}

/**
 * Trigger eBay sync with streaming progress updates
 */
export function useEbaySyncWithProgress() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (onProgress: (progress: SyncProgress) => void) =>
      createStreamingSyncMutation('/api/arbitrage/sync/ebay', queryClient)(onProgress),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: arbitrageKeys.lists() });
      queryClient.invalidateQueries({ queryKey: arbitrageKeys.summary() });
      queryClient.invalidateQueries({ queryKey: arbitrageKeys.syncStatus() });
    },
  });
}

/**
 * Trigger Amazon Inventory sync with streaming progress updates
 */
export function useAmazonInventorySyncWithProgress() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (onProgress: (progress: SyncProgress) => void) =>
      createStreamingSyncMutation('/api/arbitrage/sync/amazon-inventory', queryClient)(onProgress),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: arbitrageKeys.lists() });
      queryClient.invalidateQueries({ queryKey: arbitrageKeys.summary() });
      queryClient.invalidateQueries({ queryKey: arbitrageKeys.syncStatus() });
    },
  });
}

/**
 * Trigger Amazon Pricing sync with streaming progress updates
 */
export function useAmazonPricingSyncWithProgress() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (onProgress: (progress: SyncProgress) => void) =>
      createStreamingSyncMutation('/api/arbitrage/sync/amazon-pricing', queryClient)(onProgress),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: arbitrageKeys.lists() });
      queryClient.invalidateQueries({ queryKey: arbitrageKeys.summary() });
      queryClient.invalidateQueries({ queryKey: arbitrageKeys.syncStatus() });
    },
  });
}

/**
 * Trigger BrickLink Pricing sync with streaming progress updates
 */
export function useBrickLinkSyncWithProgress() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (onProgress: (progress: SyncProgress) => void) =>
      createStreamingSyncMutation('/api/arbitrage/sync/bricklink', queryClient)(onProgress),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: arbitrageKeys.lists() });
      queryClient.invalidateQueries({ queryKey: arbitrageKeys.summary() });
      queryClient.invalidateQueries({ queryKey: arbitrageKeys.syncStatus() });
    },
  });
}

// ============================================================================
// EBAY LISTING EXCLUSION HOOKS
// ============================================================================

export interface ExcludedEbayListing {
  id: string;
  userId: string;
  ebayItemId: string;
  setNumber: string;
  title: string | null;
  reason: string | null;
  excludedAt: string;
}

/**
 * Fetch excluded eBay listings for a set
 */
export function useExcludedEbayListings(setNumber?: string) {
  return useQuery({
    queryKey: arbitrageKeys.ebayExclusions(setNumber),
    queryFn: async (): Promise<ExcludedEbayListing[]> => {
      const params = setNumber ? `?setNumber=${setNumber}` : '';
      const response = await fetch(`/api/arbitrage/ebay-exclusions${params}`);

      if (!response.ok) {
        throw new Error('Failed to fetch excluded listings');
      }

      const json = await response.json();
      return (json.data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id,
        userId: row.user_id,
        ebayItemId: row.ebay_item_id,
        setNumber: row.set_number,
        title: row.title,
        reason: row.reason,
        excludedAt: row.excluded_at,
      }));
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Exclude an eBay listing
 */
export function useExcludeEbayListing() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      ebayItemId: string;
      setNumber: string;
      title?: string;
      reason?: string;
    }) => {
      const response = await fetch('/api/arbitrage/ebay-exclusions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        throw new Error('Failed to exclude listing');
      }

      return response.json();
    },
    onSuccess: (_, variables) => {
      // Invalidate eBay exclusions, lists, and all item queries so modal refreshes
      queryClient.invalidateQueries({
        queryKey: arbitrageKeys.ebayExclusions(variables.setNumber),
      });
      queryClient.invalidateQueries({ queryKey: arbitrageKeys.lists() });
      queryClient.invalidateQueries({ queryKey: arbitrageKeys.items() });
    },
  });
}

/**
 * Restore an excluded eBay listing
 */
export function useRestoreEbayListing() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { ebayItemId: string; setNumber: string }) => {
      const response = await fetch('/api/arbitrage/ebay-exclusions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        throw new Error('Failed to restore listing');
      }

      return response.json();
    },
    onSuccess: (_, variables) => {
      // Invalidate eBay exclusions, lists, and all item queries so modal refreshes
      queryClient.invalidateQueries({
        queryKey: arbitrageKeys.ebayExclusions(variables.setNumber),
      });
      queryClient.invalidateQueries({ queryKey: arbitrageKeys.lists() });
      queryClient.invalidateQueries({ queryKey: arbitrageKeys.items() });
    },
  });
}
