/**
 * Platform Stock React Hooks
 *
 * TanStack Query hooks for fetching and managing platform stock data.
 */

'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  PlatformListing,
  ListingImport,
  StockComparison,
  ComparisonSummary,
  ListingFilters,
  ComparisonFilters,
  PlatformStockListingsResponse,
  PlatformStockComparisonResponse,
} from '@/lib/platform-stock';

// ============================================================================
// QUERY KEY FACTORY
// ============================================================================

export const platformStockKeys = {
  all: ['platform-stock'] as const,
  listings: (platform: string, filters: ListingFilters, page: number, pageSize: number) =>
    [...platformStockKeys.all, 'listings', platform, filters, page, pageSize] as const,
  comparison: (platform: string, filters: ComparisonFilters) =>
    [...platformStockKeys.all, 'comparison', platform, filters] as const,
  imports: (platform: string) =>
    [...platformStockKeys.all, 'imports', platform] as const,
};

// ============================================================================
// FETCH FUNCTIONS
// ============================================================================

async function fetchListings(
  platform: string,
  filters: ListingFilters,
  page: number,
  pageSize: number
): Promise<PlatformStockListingsResponse> {
  const params = new URLSearchParams({
    platform,
    page: String(page),
    pageSize: String(pageSize),
  });

  if (filters.search) params.set('search', filters.search);
  if (filters.listingStatus && filters.listingStatus !== 'all') {
    params.set('status', filters.listingStatus);
  }
  if (filters.fulfillmentChannel && filters.fulfillmentChannel !== 'all') {
    params.set('channel', filters.fulfillmentChannel);
  }
  if (filters.hasQuantity) params.set('hasQuantity', 'true');

  const response = await fetch(`/api/platform-stock?${params}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch listings');
  }

  const json = await response.json();
  return json.data;
}

async function fetchComparison(
  platform: string,
  filters: ComparisonFilters
): Promise<PlatformStockComparisonResponse> {
  const params = new URLSearchParams({ platform });

  if (filters.discrepancyType && filters.discrepancyType !== 'all') {
    params.set('discrepancyType', filters.discrepancyType);
  }
  if (filters.search) params.set('search', filters.search);

  const response = await fetch(`/api/platform-stock/comparison?${params}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch comparison');
  }

  const json = await response.json();
  return json.data;
}

async function triggerImport(platform: string): Promise<{
  import: ListingImport;
  message: string;
}> {
  const response = await fetch(`/api/platform-stock/${platform}/import`, {
    method: 'POST',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || error.details || 'Import failed');
  }

  const json = await response.json();
  return json.data;
}

async function fetchImportHistory(
  platform: string,
  limit: number = 10
): Promise<ListingImport[]> {
  const params = new URLSearchParams({
    limit: String(limit),
  });

  const response = await fetch(`/api/platform-stock/${platform}/import?${params}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch import history');
  }

  const json = await response.json();
  return json.data.imports;
}

// ============================================================================
// QUERY HOOKS
// ============================================================================

/**
 * Fetch platform listings with pagination and filters
 */
export function usePlatformListings(
  platform: string,
  filters: ListingFilters = {},
  page: number = 1,
  pageSize: number = 50,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: platformStockKeys.listings(platform, filters, page, pageSize),
    queryFn: () => fetchListings(platform, filters, page, pageSize),
    staleTime: 2 * 60 * 1000, // 2 minutes
    enabled: options?.enabled !== false,
  });
}

/**
 * Fetch stock comparison between platform and inventory
 */
export function useStockComparison(
  platform: string,
  filters: ComparisonFilters = {},
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: platformStockKeys.comparison(platform, filters),
    queryFn: () => fetchComparison(platform, filters),
    staleTime: 2 * 60 * 1000, // 2 minutes
    enabled: options?.enabled !== false,
  });
}

/**
 * Fetch import history
 */
export function useImportHistory(
  platform: string,
  limit: number = 10,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: platformStockKeys.imports(platform),
    queryFn: () => fetchImportHistory(platform, limit),
    staleTime: 30 * 1000, // 30 seconds
    enabled: options?.enabled !== false,
  });
}

// ============================================================================
// MUTATION HOOKS
// ============================================================================

/**
 * Trigger a new import from the platform
 */
export function useTriggerImport(platform: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => triggerImport(platform),
    onSuccess: () => {
      // Invalidate all platform stock queries for this platform
      queryClient.invalidateQueries({
        queryKey: platformStockKeys.all,
      });
    },
    onError: (error) => {
      console.error('[useTriggerImport] Error:', error);
    },
  });
}

// ============================================================================
// DERIVED HOOKS
// ============================================================================

/**
 * Get the latest import status for a platform
 */
export function useLatestImport(platform: string) {
  const { data, ...rest } = usePlatformListings(platform, {}, 1, 1);

  return {
    ...rest,
    latestImport: data?.latestImport || null,
  };
}

/**
 * Check if an import is currently in progress
 */
export function useIsImporting(platform: string) {
  const { data } = usePlatformListings(platform, {}, 1, 1);

  return data?.latestImport?.status === 'processing';
}

// ============================================================================
// TYPES RE-EXPORT
// ============================================================================

export type {
  PlatformListing,
  ListingImport,
  StockComparison,
  ComparisonSummary,
  ListingFilters,
  ComparisonFilters,
};
