/**
 * Repricing React Hooks
 *
 * TanStack Query hooks for repricing data fetching and price updates.
 * Supports 3-hour caching with manual sync capability.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { RepricingFilters, RepricingDataResponse, PushPriceResponse } from '@/lib/repricing';

// ============================================================================
// API FUNCTIONS
// ============================================================================

/**
 * Fetch repricing data from API
 */
async function fetchRepricingData(
  filters: RepricingFilters,
  page: number,
  pageSize: number,
  forceSync: boolean = false
): Promise<RepricingDataResponse> {
  const params = new URLSearchParams();
  params.set('page', page.toString());
  params.set('pageSize', pageSize.toString());

  if (filters.search) {
    params.set('search', filters.search);
  }
  if (filters.showOnlyWithCost) {
    params.set('showOnlyWithCost', 'true');
  }
  if (filters.showOnlyBuyBoxLost) {
    params.set('showOnlyBuyBoxLost', 'true');
  }
  if (filters.minQuantity !== undefined) {
    params.set('minQuantity', filters.minQuantity.toString());
  }
  if (forceSync) {
    params.set('forceSync', 'true');
  }

  const response = await fetch(`/api/repricing?${params.toString()}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch repricing data');
  }

  const result = await response.json();
  return result.data;
}

/**
 * Trigger a manual sync (clears cache)
 */
async function triggerSync(): Promise<{ success: boolean; message: string }> {
  const response = await fetch('/api/repricing', {
    method: 'POST',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to sync pricing data');
  }

  const result = await response.json();
  return result.data;
}

/**
 * Push price update to Amazon
 */
async function pushPriceUpdate(
  sku: string,
  newPrice: number,
  productType?: string
): Promise<PushPriceResponse> {
  const response = await fetch(`/api/repricing/${encodeURIComponent(sku)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ newPrice, productType }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    // Include validation issues in error message if present
    let errorMessage = errorData.error || 'Failed to push price update';
    if (errorData.data?.validationIssues?.length > 0) {
      const issues = errorData.data.validationIssues
        .map((issue: { message: string }) => issue.message)
        .join('; ');
      errorMessage = `${errorMessage}: ${issues}`;
    }
    throw new Error(errorMessage);
  }

  const result = await response.json();
  return result.data;
}

// ============================================================================
// QUERY KEYS
// ============================================================================

export const repricingKeys = {
  all: ['repricing'] as const,
  list: (filters: RepricingFilters, page: number, pageSize: number) =>
    [...repricingKeys.all, 'list', { filters, page, pageSize }] as const,
};

// ============================================================================
// HOOKS
// ============================================================================

/**
 * Hook to fetch repricing data
 *
 * Uses cached data by default (3-hour cache).
 * Use syncPricing mutation to force a fresh fetch.
 *
 * @param filters - Filter options
 * @param page - Page number (1-indexed)
 * @param pageSize - Items per page
 * @param options - Additional query options
 */
export function useRepricingData(
  filters: RepricingFilters = {},
  page: number = 1,
  pageSize: number = 50,
  options?: {
    enabled?: boolean;
  }
) {
  return useQuery({
    queryKey: repricingKeys.list(filters, page, pageSize),
    queryFn: () => fetchRepricingData(filters, page, pageSize, false),
    // Use long staleTime since we have server-side caching (3 hours)
    // This prevents unnecessary refetches on tab switches
    staleTime: 3 * 60 * 60 * 1000, // 3 hours - match server cache duration
    gcTime: 4 * 60 * 60 * 1000, // 4 hours garbage collection
    refetchOnWindowFocus: false,
    refetchOnMount: false, // Don't refetch when component mounts if data exists
    refetchOnReconnect: false, // Don't refetch on network reconnect
    enabled: options?.enabled ?? true,
  });
}

/**
 * Hook to manually sync pricing data from Amazon
 *
 * This clears the server-side cache and triggers a fresh fetch.
 * Use this when user clicks "Sync Prices" button.
 */
export function useSyncPricing() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      // First clear the cache on server
      await triggerSync();
      // Then fetch fresh data with forceSync flag
      // This fetches ALL listings, so use page 1 with large pageSize
      return fetchRepricingData({}, 1, 50, true);
    },
    onSuccess: (data) => {
      // Directly update all matching queries with the fresh data
      // This avoids triggering any additional fetches
      queryClient.setQueriesData<RepricingDataResponse>({ queryKey: repricingKeys.all }, (old) => {
        // If old data exists, update with fresh data
        // Keep the structure but update items and summary
        if (old) {
          return {
            ...data,
            pagination: old.pagination, // Keep current pagination state
          };
        }
        return data;
      });
    },
  });
}

/**
 * Hook to push price update to Amazon
 */
export function usePushPrice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      sku,
      newPrice,
      productType,
    }: {
      sku: string;
      newPrice: number;
      productType?: string;
    }) => pushPriceUpdate(sku, newPrice, productType),
    onSuccess: (data, variables) => {
      // Optimistically update the item in cache
      queryClient.setQueriesData<RepricingDataResponse>({ queryKey: repricingKeys.all }, (old) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.map((item) =>
            item.sku === variables.sku ? { ...item, yourPrice: variables.newPrice } : item
          ),
        };
      });
    },
  });
}

/**
 * Hook to invalidate repricing data (force refresh)
 */
export function useInvalidateRepricing() {
  const queryClient = useQueryClient();

  return () => {
    queryClient.invalidateQueries({ queryKey: repricingKeys.all });
  };
}
