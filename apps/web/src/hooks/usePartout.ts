/**
 * usePartout Hook
 *
 * React Query hook for fetching partout value data from the API.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { PartoutData, PartoutApiResponse, PartoutApiError } from '@/types/partout';

/**
 * Fetch partout data from the API
 */
async function fetchPartout(setNumber: string, forceRefresh: boolean = false): Promise<PartoutData> {
  const params = new URLSearchParams({ setNumber });
  if (forceRefresh) {
    params.set('forceRefresh', 'true');
  }
  const response = await fetch(`/api/bricklink/partout?${params}`);

  if (!response.ok) {
    const error: PartoutApiError = await response.json();
    throw new Error(error.error || 'Failed to fetch partout data');
  }

  const result: PartoutApiResponse = await response.json();
  return result.data;
}

/**
 * Query key factory for partout queries
 */
export const partoutKeys = {
  all: ['partout'] as const,
  detail: (setNumber: string) => [...partoutKeys.all, setNumber] as const,
};

/**
 * Hook to fetch partout value for a LEGO set
 *
 * @param setNumber The LEGO set number (e.g., "75192-1")
 * @param enabled Whether to enable the query (set to true when tab is active)
 * @returns Query result with partout data plus forceRefresh function
 */
export function usePartout(setNumber: string | null, enabled: boolean = true) {
  const queryClient = useQueryClient();
  const [isForceRefreshing, setIsForceRefreshing] = useState(false);

  const query = useQuery({
    queryKey: partoutKeys.detail(setNumber || ''),
    queryFn: () => {
      if (!setNumber) {
        throw new Error('Set number is required');
      }
      return fetchPartout(setNumber);
    },
    enabled: enabled && !!setNumber,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes (formerly cacheTime)
    retry: (failureCount, error) => {
      // Don't retry on 404 or rate limit errors
      const errorMessage = error instanceof Error ? error.message : '';
      if (errorMessage.includes('not found') || errorMessage.includes('rate limit')) {
        return false;
      }
      return failureCount < 2;
    },
  });

  /**
   * Force refresh the partout data, clearing the cache first
   * @returns Object with success status and optional error message
   */
  const forceRefresh = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    if (!setNumber) return { success: false, error: 'No set number' };

    setIsForceRefreshing(true);
    try {
      console.log(`[usePartout] Force refreshing partout data for ${setNumber}`);
      // Fetch with forceRefresh flag
      const freshData = await fetchPartout(setNumber, true);
      console.log(`[usePartout] Force refresh complete: ${freshData.parts.length} parts, ${freshData.cacheStats.fromApi} from API`);
      // Update the query cache with the fresh data
      queryClient.setQueryData(partoutKeys.detail(setNumber), freshData);
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[usePartout] Force refresh failed:`, error);
      return { success: false, error: errorMessage };
    } finally {
      setIsForceRefreshing(false);
    }
  }, [setNumber, queryClient]);

  return {
    ...query,
    forceRefresh,
    isForceRefreshing,
  };
}
