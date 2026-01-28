'use client';

/**
 * Hook for creating eBay listings with SSE progress tracking
 */

import { useState, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  ListingCreationRequest,
  ListingCreationProgress,
  ListingCreationResult,
  ListingCreationError,
  ListingPreviewData,
  AIGeneratedListing,
} from '@/lib/ebay/listing-creation.types';
import { inventoryKeys } from './use-inventory';

/**
 * SSE event types
 */
type SSEEventType = 'progress' | 'complete' | 'error' | 'preview';

interface SSEEvent {
  type: SSEEventType;
  data: ListingCreationProgress | ListingCreationResult | ListingCreationError | ListingPreviewData | string;
}

/**
 * Hook state
 */
export interface UseCreateListingState {
  /** Current progress state */
  progress: ListingCreationProgress | null;
  /** Result on success */
  result: ListingCreationResult | null;
  /** Error on failure */
  error: ListingCreationError | string | null;
  /** Whether creation is in progress */
  isCreating: boolean;
  /** Preview data awaiting user confirmation */
  previewData: ListingPreviewData | null;
  /** Whether we're waiting for user to confirm preview */
  isAwaitingPreviewConfirmation: boolean;
}

/**
 * Hook return type
 */
export interface UseCreateListingReturn extends UseCreateListingState {
  /** Start listing creation */
  create: (request: ListingCreationRequest) => void;
  /** Reset state for a new attempt */
  reset: () => void;
  /** Cancel in-progress creation */
  cancel: () => void;
  /** Confirm the preview and continue with listing creation */
  confirmPreview: (editedListing: AIGeneratedListing) => void;
  /** Cancel the preview and abort listing creation */
  cancelPreview: () => void;
}

/**
 * Hook for creating eBay listings with progress tracking
 */
export function useCreateListing(): UseCreateListingReturn {
  const queryClient = useQueryClient();
  const abortControllerRef = useRef<AbortController | null>(null);
  const previewResolverRef = useRef<((confirmed: boolean, editedListing?: AIGeneratedListing) => void) | null>(null);

  const [state, setState] = useState<UseCreateListingState>({
    progress: null,
    result: null,
    error: null,
    isCreating: false,
    previewData: null,
    isAwaitingPreviewConfirmation: false,
  });

  /**
   * Start listing creation
   */
  const create = useCallback(async (request: ListingCreationRequest) => {
    // Reset state
    setState({
      progress: null,
      result: null,
      error: null,
      isCreating: true,
      previewData: null,
      isAwaitingPreviewConfirmation: false,
    });

    // Create abort controller for cancellation
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch('/api/ebay/listing', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const errorData = await response.json();
        // Include validation details if available
        let errorMessage = errorData.error || 'Failed to create listing';
        if (errorData.details) {
          const fieldErrors = errorData.details.fieldErrors;
          if (fieldErrors && Object.keys(fieldErrors).length > 0) {
            const errorFields = Object.entries(fieldErrors)
              .map(([field, errors]) => `${field}: ${(errors as string[]).join(', ')}`)
              .join('; ');
            errorMessage = `${errorMessage} - ${errorFields}`;
          }
        }
        console.error('[useCreateListing] Validation error:', errorData);
        setState((prev) => ({
          ...prev,
          error: errorMessage,
          isCreating: false,
        }));
        return;
      }

      // Handle SSE stream
      const reader = response.body?.getReader();
      if (!reader) {
        setState((prev) => ({
          ...prev,
          error: 'Failed to establish connection',
          isCreating: false,
        }));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete events from buffer
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6)) as SSEEvent;
              handleEvent(event);
            } catch {
              console.error('[useCreateListing] Failed to parse SSE event:', line);
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setState((prev) => ({
          ...prev,
          error: 'Listing creation cancelled',
          isCreating: false,
        }));
        return;
      }

      setState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Unknown error',
        isCreating: false,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleEvent is stable and defined below
  }, []);

  /**
   * Handle SSE event
   */
  const handleEvent = useCallback(
    (event: SSEEvent) => {
      switch (event.type) {
        case 'progress':
          setState((prev) => ({
            ...prev,
            progress: event.data as ListingCreationProgress,
          }));
          break;

        case 'preview':
          // Server is waiting for user confirmation
          const previewData = event.data as ListingPreviewData;
          setState((prev) => ({
            ...prev,
            progress: null, // Hide progress while showing preview
            previewData,
            isAwaitingPreviewConfirmation: true,
          }));
          break;

        case 'complete':
          const result = event.data as ListingCreationResult;
          setState((prev) => ({
            ...prev,
            progress: null,
            previewData: null,
            isAwaitingPreviewConfirmation: false,
            result,
            isCreating: false,
          }));
          // Invalidate inventory queries
          queryClient.invalidateQueries({ queryKey: inventoryKeys.lists() });
          queryClient.invalidateQueries({ queryKey: inventoryKeys.summary() });
          break;

        case 'error':
          setState((prev) => ({
            ...prev,
            previewData: null,
            isAwaitingPreviewConfirmation: false,
            error: event.data as ListingCreationError | string,
            isCreating: false,
          }));
          break;
      }
    },
    [queryClient]
  );

  /**
   * Reset state for a new attempt
   */
  const reset = useCallback(() => {
    setState({
      progress: null,
      result: null,
      error: null,
      isCreating: false,
      previewData: null,
      isAwaitingPreviewConfirmation: false,
    });
    previewResolverRef.current = null;
  }, []);

  /**
   * Cancel in-progress creation
   */
  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    previewResolverRef.current = null;
  }, []);

  /**
   * Confirm the preview and continue with listing creation
   */
  const confirmPreview = useCallback(async (editedListing: AIGeneratedListing) => {
    if (!state.previewData) return;

    setState((prev) => ({
      ...prev,
      isAwaitingPreviewConfirmation: false,
      previewData: null,
      isCreating: true,
    }));

    try {
      // Send confirmation to the server
      const response = await fetch('/api/ebay/listing/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: state.previewData.sessionId,
          editedListing,
          confirmed: true,
        }),
        signal: abortControllerRef.current?.signal,
      });

      if (!response.ok) {
        const errorData = await response.json();
        setState((prev) => ({
          ...prev,
          error: errorData.error || 'Failed to confirm listing',
          isCreating: false,
        }));
        return;
      }

      // Continue processing SSE stream from the response
      const reader = response.body?.getReader();
      if (!reader) {
        setState((prev) => ({
          ...prev,
          error: 'Failed to establish connection',
          isCreating: false,
        }));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete events from buffer
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6)) as SSEEvent;
              handleEvent(event);
            } catch {
              console.error('[useCreateListing] Failed to parse SSE event:', line);
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      setState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Unknown error',
        isCreating: false,
      }));
    }
  }, [state.previewData, handleEvent]);

  /**
   * Cancel the preview and abort listing creation
   */
  const cancelPreview = useCallback(async () => {
    if (!state.previewData) return;

    // Send cancellation to server
    try {
      await fetch('/api/ebay/listing/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: state.previewData.sessionId,
          confirmed: false,
        }),
      });
    } catch {
      // Ignore errors on cancel
    }

    setState((prev) => ({
      ...prev,
      previewData: null,
      isAwaitingPreviewConfirmation: false,
      isCreating: false,
      error: 'Listing creation cancelled',
    }));
  }, [state.previewData]);

  return {
    ...state,
    create,
    reset,
    cancel,
    confirmPreview,
    cancelPreview,
  };
}
