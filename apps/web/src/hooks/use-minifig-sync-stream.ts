'use client';

import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { minifigSyncKeys } from '@/hooks/use-minifig-sync';
import type {
  SyncOperation,
  SyncStreamState,
  SyncProgressEvent,
} from '@/types/minifig-sync-stream';

const STREAM_URLS: Record<SyncOperation, string> = {
  'pull-inventory': '/api/minifigs/sync/pull-inventory/stream',
  research: '/api/minifigs/sync/research/stream',
  'create-listings': '/api/minifigs/sync/create-listings/stream',
};

const initialState: SyncStreamState = {
  status: 'idle',
  operation: null,
  stage: null,
  stageMessage: null,
  current: 0,
  total: 0,
  itemMessage: null,
  result: null,
  error: null,
};

/**
 * Hook for consuming SSE progress streams from minifig sync operations.
 * Returns stream state and a function to start a stream.
 */
export function useMinifigSyncStream() {
  const [state, setState] = useState<SyncStreamState>(initialState);
  const abortRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();

  const startStream = useCallback(
    async (operation: SyncOperation) => {
      // Abort any in-flight stream
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState({
        ...initialState,
        status: 'streaming',
        operation,
        stage: 'connecting',
        stageMessage: 'Connecting...',
      });

      try {
        const response = await fetch(STREAM_URLS[operation], {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error('Failed to connect to streaming endpoint');
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('No response body available');
        }

        const decoder = new TextDecoder();
        let buffer = '';

        let receivedTerminal = false;

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const event: SyncProgressEvent = JSON.parse(line.slice(6));

                  if (event.type === 'stage') {
                    setState((prev) => ({
                      ...prev,
                      stage: event.stage,
                      stageMessage: event.message,
                      // Reset progress counters on new stage
                      current: 0,
                      total: 0,
                      itemMessage: null,
                    }));
                  } else if (event.type === 'progress') {
                    setState((prev) => ({
                      ...prev,
                      current: event.current,
                      total: event.total,
                      itemMessage: event.message,
                    }));
                  } else if (event.type === 'complete') {
                    receivedTerminal = true;
                    setState((prev) => ({
                      ...prev,
                      status: 'complete',
                      result: event.data,
                    }));
                    // Invalidate queries so dashboard refreshes
                    queryClient.invalidateQueries({ queryKey: minifigSyncKeys.lists() });
                    queryClient.invalidateQueries({ queryKey: minifigSyncKeys.dashboard() });
                  } else if (event.type === 'error') {
                    receivedTerminal = true;
                    setState((prev) => ({
                      ...prev,
                      status: 'error',
                      error: event.error,
                    }));
                  }
                } catch {
                  // Skip malformed SSE lines
                }
              }
            }
          }
        } finally {
          reader.releaseLock();
        }

        // Handle unexpected stream end (e.g. Vercel timeout)
        if (!receivedTerminal) {
          setState((prev) => ({
            ...prev,
            status: 'error',
            error: 'Connection lost — the operation may still be running on the server.',
          }));
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: err instanceof Error ? err.message : 'Unknown error',
        }));
      }
    },
    [queryClient]
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState(initialState);
  }, []);

  return { ...state, startStream, reset };
}
