/**
 * Cost Modelling Hooks
 * TanStack Query hooks for cost modelling data
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  CostModelScenario,
  CostModelScenarioFormData,
  ScenarioListItem,
} from '@/types/cost-modelling';

/**
 * Query keys for cost modelling
 */
export const costModellingKeys = {
  all: ['cost-modelling'] as const,
  scenarios: () => [...costModellingKeys.all, 'scenarios'] as const,
  scenario: (id: string) => [...costModellingKeys.scenarios(), id] as const,
  draft: (id: string) => [...costModellingKeys.scenario(id), 'draft'] as const,
};

/**
 * Fetch list of scenarios
 */
async function fetchScenarios(): Promise<ScenarioListItem[]> {
  const response = await fetch('/api/cost-modelling/scenarios');
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch scenarios');
  }
  const { data } = await response.json();
  return data;
}

/**
 * Fetch single scenario with package costs
 */
async function fetchScenario(
  id: string
): Promise<CostModelScenario & { formData: CostModelScenarioFormData }> {
  const response = await fetch(`/api/cost-modelling/scenarios/${id}`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch scenario');
  }
  const { data } = await response.json();
  return data;
}

/**
 * Create new scenario
 */
async function createScenario(data: {
  name: string;
  description?: string;
}): Promise<CostModelScenario> {
  const response = await fetch('/api/cost-modelling/scenarios', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create scenario');
  }
  const { data: scenario } = await response.json();
  return scenario;
}

/**
 * Update scenario
 */
async function updateScenario(params: {
  id: string;
  data: Partial<CostModelScenarioFormData> & { knownUpdatedAt?: string };
}): Promise<CostModelScenario> {
  const response = await fetch(`/api/cost-modelling/scenarios/${params.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params.data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update scenario');
  }
  const { data } = await response.json();
  return data;
}

/**
 * Delete scenario
 */
async function deleteScenario(id: string): Promise<void> {
  const response = await fetch(`/api/cost-modelling/scenarios/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete scenario');
  }
}

/**
 * Duplicate scenario
 */
async function duplicateScenario(id: string): Promise<CostModelScenario> {
  const response = await fetch(`/api/cost-modelling/scenarios/${id}/duplicate`, {
    method: 'POST',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to duplicate scenario');
  }
  const { data } = await response.json();
  return data;
}

/**
 * Save draft
 */
async function saveDraft(params: {
  id: string;
  data: CostModelScenarioFormData;
}): Promise<void> {
  const response = await fetch(`/api/cost-modelling/scenarios/${params.id}/draft`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params.data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to save draft');
  }
}

/**
 * Check for draft
 */
async function checkDraft(id: string): Promise<{
  hasDraft: boolean;
  draftData: CostModelScenarioFormData | null;
  draftUpdatedAt: string | null;
}> {
  const response = await fetch(`/api/cost-modelling/scenarios/${id}/draft`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to check draft');
  }
  return response.json();
}

/**
 * Clear draft
 */
async function clearDraft(id: string): Promise<void> {
  const response = await fetch(`/api/cost-modelling/scenarios/${id}/draft`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to clear draft');
  }
}

// ===== HOOKS =====

/**
 * Hook to fetch list of scenarios
 * P3: Should complete in under 500ms
 */
export function useCostScenarios() {
  return useQuery({
    queryKey: costModellingKeys.scenarios(),
    queryFn: fetchScenarios,
    staleTime: 30 * 1000, // 30 seconds
  });
}

/**
 * Hook to fetch single scenario
 */
export function useCostScenario(id: string | null) {
  return useQuery({
    queryKey: costModellingKeys.scenario(id!),
    queryFn: () => fetchScenario(id!),
    enabled: !!id,
    staleTime: 30 * 1000,
  });
}

/**
 * Hook to check for draft
 */
export function useDraftCheck(id: string | null) {
  return useQuery({
    queryKey: costModellingKeys.draft(id!),
    queryFn: () => checkDraft(id!),
    enabled: !!id,
    staleTime: 30 * 1000, // 30 seconds - matches auto-save interval
  });
}

/**
 * Hook to create scenario
 */
export function useCreateCostScenario() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createScenario,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: costModellingKeys.scenarios() });
    },
  });
}

/**
 * Hook to update scenario
 */
export function useUpdateCostScenario() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateScenario,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: costModellingKeys.scenario(variables.id),
      });
      queryClient.invalidateQueries({
        queryKey: costModellingKeys.scenarios(),
      });
    },
  });
}

/**
 * Hook to delete scenario
 */
export function useDeleteCostScenario() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteScenario,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: costModellingKeys.scenarios() });
    },
  });
}

/**
 * Hook to duplicate scenario
 */
export function useDuplicateCostScenario() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: duplicateScenario,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: costModellingKeys.scenarios() });
    },
  });
}

/**
 * Rename/update scenario metadata (name and description only)
 */
async function renameScenario(params: {
  id: string;
  name: string;
  description?: string;
}): Promise<CostModelScenario> {
  const response = await fetch(`/api/cost-modelling/scenarios/${params.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: params.name,
      description: params.description,
    }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to rename scenario');
  }
  const { data } = await response.json();
  return data;
}

/**
 * Hook to rename/update scenario metadata
 */
export function useRenameCostScenario() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: renameScenario,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: costModellingKeys.scenario(variables.id),
      });
      queryClient.invalidateQueries({
        queryKey: costModellingKeys.scenarios(),
      });
    },
  });
}

/**
 * Hook to save draft
 */
export function useSaveDraft() {
  return useMutation({
    mutationFn: saveDraft,
    // No invalidation needed - we just saved the draft, no need to refetch it
  });
}

/**
 * Hook to clear draft
 */
export function useClearDraft() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: clearDraft,
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({
        queryKey: costModellingKeys.draft(id),
      });
    },
  });
}
