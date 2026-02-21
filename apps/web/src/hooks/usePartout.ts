/**
 * usePartout Hook
 *
 * React Query hook for fetching partout value data from the API.
 * Supports streaming progress updates via SSE.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type {
  PartoutData,
  PartoutApiResponse,
  PartoutApiError,
  PartoutStreamEvent,
  StreamProgress,
} from '@/types/partout';

/**
 * Fetch partout data from the API (non-streaming)
 */
async function fetchPartout(
  setNumber: string,
  forceRefresh: boolean = false
): Promise<PartoutData> {
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
 * Fetch partout data with streaming progress updates
 */
async function fetchWithStreaming(
  setNumber: string,
  forceRefresh: boolean,
  onProgress: (progress: StreamProgress) => void
): Promise<PartoutData> {
  const params = new URLSearchParams({ setNumber });
  if (forceRefresh) {
    params.set('forceRefresh', 'true');
  }

  const response = await fetch(`/api/bricklink/partout/stream?${params}`);

  if (!response.ok) {
    throw new Error('Failed to connect to streaming endpoint');
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body available');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let result: PartoutData | null = null;
  let streamError: string | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      // Append new data to buffer
      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE messages from buffer
      const lines = buffer.split('\n');
      // Keep incomplete line in buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const event: PartoutStreamEvent = JSON.parse(line.slice(6));

            if (event.type === 'start') {
              // Initialize with zero progress
              onProgress({ fetched: 0, total: 0, cached: 0 });
            } else if (event.type === 'progress') {
              // Progress events now include cached count from the service
              onProgress({
                fetched: event.fetched ?? 0,
                total: event.total ?? 0,
                cached: event.cached ?? 0,
              });
            } else if (event.type === 'complete') {
              result = event.data!;
            } else if (event.type === 'error') {
              streamError = event.error ?? 'Unknown streaming error';
            }
          } catch (parseError) {
            console.warn('[usePartout] Failed to parse SSE event:', line, parseError);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (streamError) {
    throw new Error(streamError);
  }

  if (!result) {
    throw new Error('Stream ended without data');
  }

  return result;
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
 * @returns Query result with partout data plus streaming support
 */
export function usePartout(setNumber: string | null, enabled: boolean = true) {
  const queryClient = useQueryClient();
  const [streamProgress, setStreamProgress] = useState<StreamProgress | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);

  // Check if we have cached data - if so, use React Query normally
  // If not, we'll trigger streaming fetch instead
  const cachedData = setNumber
    ? queryClient.getQueryData<PartoutData>(partoutKeys.detail(setNumber))
    : undefined;

  const query = useQuery({
    queryKey: partoutKeys.detail(setNumber || ''),
    queryFn: () => {
      if (!setNumber) {
        throw new Error('Set number is required');
      }
      return fetchPartout(setNumber);
    },
    // Only enable auto-fetch if we already have cached data (for revalidation)
    // For initial loads, we use streaming fetch instead
    enabled: enabled && !!setNumber && !!cachedData,
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
   * Fetch with streaming progress updates
   * @param forceRefresh Whether to force refresh from BrickLink API
   * @returns Object with success status and optional error message
   */
  const fetchWithProgress = useCallback(
    async (forceRefresh: boolean = false): Promise<{ success: boolean; error?: string }> => {
      if (!setNumber) return { success: false, error: 'No set number' };

      setIsStreaming(true);
      setStreamError(null);
      setStreamProgress({ fetched: 0, total: 0, cached: 0 });

      try {
        console.log(
          `[usePartout] ${forceRefresh ? 'Force refreshing' : 'Fetching'} with streaming for ${setNumber}`
        );

        const data = await fetchWithStreaming(setNumber, forceRefresh, setStreamProgress);

        console.log(
          `[usePartout] Stream complete: ${data.parts.length} parts, ${data.cacheStats.fromApi} from API, ${data.cacheStats.fromCache} from cache`
        );

        // Update the query cache with the fresh data
        queryClient.setQueryData(partoutKeys.detail(setNumber), data);
        return { success: true };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[usePartout] Stream failed:`, error);
        setStreamError(errorMessage);
        return { success: false, error: errorMessage };
      } finally {
        setIsStreaming(false);
        setStreamProgress(null);
      }
    },
    [setNumber, queryClient]
  );

  /**
   * Force refresh the partout data using streaming
   * @returns Object with success status and optional error message
   */
  const forceRefresh = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    return fetchWithProgress(true);
  }, [fetchWithProgress]);

  return {
    ...query,
    forceRefresh,
    isForceRefreshing: isStreaming,
    streamProgress,
    isStreaming,
    streamError,
    fetchWithProgress,
  };
}
