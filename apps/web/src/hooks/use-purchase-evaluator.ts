/**
 * Purchase Evaluator React Hooks
 *
 * TanStack Query hooks for the purchase evaluation feature.
 */

'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useCallback } from 'react';
import type {
  PurchaseEvaluation,
  EvaluationItem,
  CreateEvaluationRequest,
  UpdateEvaluationRequest,
  UpdateItemRequest,
  LookupProgress,
  ConvertEvaluationRequest,
  ConversionResult,
} from '@/lib/purchase-evaluator';

// ============================================
// Query Keys Factory
// ============================================

export const evaluatorKeys = {
  all: ['purchase-evaluator'] as const,
  lists: () => [...evaluatorKeys.all, 'list'] as const,
  list: () => [...evaluatorKeys.lists()] as const,
  details: () => [...evaluatorKeys.all, 'detail'] as const,
  detail: (id: string) => [...evaluatorKeys.details(), id] as const,
};

// ============================================
// API Fetch Functions
// ============================================

async function fetchEvaluations(): Promise<PurchaseEvaluation[]> {
  const response = await fetch('/api/purchase-evaluator');
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch evaluations');
  }
  const result = await response.json();
  return result.data;
}

async function fetchEvaluation(id: string): Promise<PurchaseEvaluation> {
  const response = await fetch(`/api/purchase-evaluator/${id}`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch evaluation');
  }
  const result = await response.json();
  return result.data;
}

async function createEvaluation(request: CreateEvaluationRequest): Promise<PurchaseEvaluation> {
  const response = await fetch('/api/purchase-evaluator', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create evaluation');
  }
  const result = await response.json();
  return result.data;
}

async function updateEvaluation(
  id: string,
  request: UpdateEvaluationRequest
): Promise<PurchaseEvaluation> {
  const response = await fetch(`/api/purchase-evaluator/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update evaluation');
  }
  const result = await response.json();
  return result.data;
}

async function deleteEvaluation(id: string): Promise<void> {
  const response = await fetch(`/api/purchase-evaluator/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete evaluation');
  }
}

async function updateItems(
  evaluationId: string,
  items: Array<UpdateItemRequest & { id: string }>
): Promise<EvaluationItem[]> {
  const response = await fetch(`/api/purchase-evaluator/${evaluationId}/items`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update items');
  }
  const result = await response.json();
  return result.data;
}

// ============================================
// Query Hooks
// ============================================

/**
 * Hook to fetch all evaluations
 */
export function useEvaluations() {
  return useQuery({
    queryKey: evaluatorKeys.list(),
    queryFn: fetchEvaluations,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to fetch a single evaluation with items
 */
export function useEvaluation(id: string | null) {
  return useQuery({
    queryKey: evaluatorKeys.detail(id || ''),
    queryFn: () => fetchEvaluation(id!),
    enabled: !!id,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

// ============================================
// Mutation Hooks
// ============================================

/**
 * Hook to create a new evaluation
 */
export function useCreateEvaluation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createEvaluation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: evaluatorKeys.lists() });
    },
  });
}

/**
 * Hook to update an evaluation
 */
export function useUpdateEvaluation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...request }: UpdateEvaluationRequest & { id: string }) =>
      updateEvaluation(id, request),
    onSuccess: (data) => {
      queryClient.setQueryData(evaluatorKeys.detail(data.id), data);
      queryClient.invalidateQueries({ queryKey: evaluatorKeys.lists() });
    },
  });
}

/**
 * Hook to delete an evaluation
 */
export function useDeleteEvaluation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteEvaluation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: evaluatorKeys.lists() });
    },
  });
}

/**
 * Hook to update items in batch
 */
export function useUpdateItems() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      evaluationId,
      items,
    }: {
      evaluationId: string;
      items: Array<UpdateItemRequest & { id: string }>;
    }) => updateItems(evaluationId, items),
    onSuccess: (_, { evaluationId }) => {
      queryClient.invalidateQueries({ queryKey: evaluatorKeys.detail(evaluationId) });
    },
  });
}

// ============================================
// Lookup Hook with Streaming Progress
// ============================================

export interface UseLookupResult {
  isRunning: boolean;
  progress: LookupProgress | null;
  error: string | null;
  startLookup: (evaluationId: string) => Promise<void>;
  reset: () => void;
}

/**
 * Hook to run lookups with streaming progress
 */
export function useLookupWithProgress(): UseLookupResult {
  const queryClient = useQueryClient();
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<LookupProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startLookup = useCallback(async (evaluationId: string) => {
    setIsRunning(true);
    setProgress(null);
    setError(null);

    try {
      const response = await fetch('/api/purchase-evaluator/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ evaluationId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Lookup failed');
      }

      // Handle Server-Sent Events
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('No response body');
      }

      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE messages
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === 'done') {
                // Lookup complete
                setIsRunning(false);
                queryClient.invalidateQueries({ queryKey: evaluatorKeys.detail(evaluationId) });
                queryClient.invalidateQueries({ queryKey: evaluatorKeys.lists() });
                return;
              }

              if (data.type === 'error') {
                throw new Error(data.error);
              }

              setProgress(data as LookupProgress);
            } catch (parseError) {
              console.error('Failed to parse SSE data:', parseError);
            }
          }
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      setIsRunning(false);
    }
  }, [queryClient]);

  const reset = useCallback(() => {
    setIsRunning(false);
    setProgress(null);
    setError(null);
  }, []);

  return {
    isRunning,
    progress,
    error,
    startLookup,
    reset,
  };
}

// ============================================
// Utility Hooks
// ============================================

/**
 * Hook to get items needing review
 */
export function useItemsNeedingReview(evaluation: PurchaseEvaluation | null) {
  if (!evaluation?.items) return [];
  return evaluation.items.filter((item) => item.needsReview);
}

// ============================================
// Conversion Hook
// ============================================

/**
 * API function to convert evaluation to purchase
 */
async function convertEvaluation(
  evaluationId: string,
  request: ConvertEvaluationRequest
): Promise<ConversionResult> {
  const response = await fetch(`/api/purchase-evaluator/${evaluationId}/convert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to convert evaluation');
  }

  const result = await response.json();
  return result.data;
}

/**
 * Hook to convert an evaluation to a purchase and inventory items
 */
export function useConvertEvaluation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      evaluationId,
      request,
    }: {
      evaluationId: string;
      request: ConvertEvaluationRequest;
    }) => convertEvaluation(evaluationId, request),
    onSuccess: (result, { evaluationId }) => {
      // Invalidate evaluation queries
      queryClient.invalidateQueries({ queryKey: evaluatorKeys.detail(evaluationId) });
      queryClient.invalidateQueries({ queryKey: evaluatorKeys.lists() });
      // Note: Purchase and inventory queries will be invalidated in the component
      // when it receives the success response
    },
  });
}
