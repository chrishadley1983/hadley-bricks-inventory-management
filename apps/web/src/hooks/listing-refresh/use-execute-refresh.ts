/**
 * Hook for executing a refresh job with SSE streaming
 */

import { useState, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { RefreshProgressEvent, RefreshResult } from '@/lib/ebay/listing-refresh.types';
import { refreshJobKeys } from './use-refresh-job';

interface UseExecuteRefreshReturn {
  progress: RefreshProgressEvent | null;
  result: RefreshResult | null;
  error: string | null;
  isExecuting: boolean;
  execute: () => void;
  reset: () => void;
}

/**
 * Hook to execute a refresh job with real-time progress updates via SSE
 */
export function useExecuteRefresh(jobId: string): UseExecuteRefreshReturn {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<RefreshProgressEvent | null>(null);
  const [result, setResult] = useState<RefreshResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const execute = useCallback(() => {
    if (isExecuting) return;

    setIsExecuting(true);
    setProgress(null);
    setResult(null);
    setError(null);

    // Create abort controller for cleanup
    abortControllerRef.current = new AbortController();

    // Start SSE connection
    fetch(`/api/ebay/listing-refresh/${jobId}/execute`, {
      method: 'POST',
      signal: abortControllerRef.current.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || 'Failed to execute refresh');
        }

        if (!response.body) {
          throw new Error('No response body');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();

          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Process complete SSE events
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const eventData = JSON.parse(line.slice(6));

                switch (eventData.type) {
                  case 'progress':
                    setProgress(eventData.data as RefreshProgressEvent);
                    break;
                  case 'complete':
                    setResult(eventData.data as RefreshResult);
                    setIsExecuting(false);
                    // Invalidate queries to refresh data
                    queryClient.invalidateQueries({ queryKey: refreshJobKeys.detail(jobId) });
                    queryClient.invalidateQueries({ queryKey: refreshJobKeys.lists() });
                    break;
                  case 'error':
                    setError(eventData.data as string);
                    setIsExecuting(false);
                    queryClient.invalidateQueries({ queryKey: refreshJobKeys.detail(jobId) });
                    break;
                }
              } catch (e) {
                console.error('Failed to parse SSE event:', e);
              }
            }
          }
        }
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setError(err.message || 'Unknown error');
          setIsExecuting(false);
        }
      });
  }, [jobId, isExecuting, queryClient]);

  const reset = useCallback(() => {
    // Abort any ongoing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    setProgress(null);
    setResult(null);
    setError(null);
    setIsExecuting(false);
  }, []);

  return {
    progress,
    result,
    error,
    isExecuting,
    execute,
    reset,
  };
}
