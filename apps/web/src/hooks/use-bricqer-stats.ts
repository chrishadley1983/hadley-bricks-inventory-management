'use client';

import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

interface BricqerStatsData {
  lotCount: number;
  pieceCount: number;
  inventoryValue: number;
  storageLocations: number;
  lastUpdated: string | null;
}

interface BricqerStatsResponse {
  data: BricqerStatsData;
}

export interface RefreshProgress {
  phase: 'init' | 'scanning' | 'rate-limited' | 'error' | 'saving' | 'complete';
  message: string;
  current?: number;
  total?: number;
  percent: number;
  lotCount?: number;
  pieceCount?: number;
}

export const bricqerStatsKeys = {
  all: ['bricqer-stats'] as const,
  inventory: () => [...bricqerStatsKeys.all, 'inventory'] as const,
};

/**
 * Fetch cached Bricqer inventory stats
 */
async function fetchBricqerStats(): Promise<BricqerStatsData> {
  const response = await fetch('/api/integrations/bricqer/inventory/stats-cached');
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch Bricqer stats');
  }
  const data: BricqerStatsResponse = await response.json();
  return data.data;
}

/**
 * Hook to fetch and refresh Bricqer inventory statistics with progress tracking
 */
export function useBricqerInventoryStats() {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [progress, setProgress] = useState<RefreshProgress | null>(null);
  const [refreshError, setRefreshError] = useState<Error | null>(null);

  const query = useQuery({
    queryKey: bricqerStatsKeys.inventory(),
    queryFn: fetchBricqerStats,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
  });

  const refetch = useCallback(async () => {
    if (isRefreshing) return;

    setIsRefreshing(true);
    setProgress({ phase: 'init', message: 'Starting...', percent: 0 });
    setRefreshError(null);

    try {
      const response = await fetch('/api/integrations/bricqer/inventory/stats-cached', {
        method: 'POST',
      });

      if (!response.ok || !response.body) {
        throw new Error('Failed to start refresh');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        let eventType = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7);
          } else if (line.startsWith('data: ') && eventType) {
            try {
              const data = JSON.parse(line.slice(6));

              if (eventType === 'progress') {
                setProgress(data as RefreshProgress);
              } else if (eventType === 'complete') {
                // Update the query cache with final results
                queryClient.setQueryData(bricqerStatsKeys.inventory(), data as BricqerStatsData);
                setProgress({ phase: 'complete', message: 'Complete!', percent: 100 });
              } else if (eventType === 'error') {
                throw new Error(data.error || 'Refresh failed');
              }
            } catch (parseError) {
              console.error('Failed to parse SSE data:', parseError);
            }
            eventType = '';
          }
        }
      }
    } catch (error) {
      console.error('Refresh error:', error);
      setRefreshError(error instanceof Error ? error : new Error('Refresh failed'));
      setProgress(null);
    } finally {
      setIsRefreshing(false);
      // Clear progress after a short delay
      setTimeout(() => setProgress(null), 2000);
    }
  }, [isRefreshing, queryClient]);

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error || refreshError,
    refetch,
    isRefetching: isRefreshing,
    progress,
  };
}
