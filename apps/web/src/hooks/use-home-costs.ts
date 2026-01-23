/**
 * Home Costs Hooks
 * TanStack Query hooks for home costs data
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  HomeCostsResponse,
  HomeCost,
  CreateHomeCostRequest,
  UpdateHomeCostRequest,
  UpdateSettingsRequest,
} from '@/types/home-costs';

/**
 * Query keys for home costs
 */
export const homeCostsKeys = {
  all: ['home-costs'] as const,
  list: () => [...homeCostsKeys.all, 'list'] as const,
  cost: (id: string) => [...homeCostsKeys.all, 'cost', id] as const,
  settings: () => [...homeCostsKeys.all, 'settings'] as const,
};

/**
 * Fetch all home costs and settings
 */
async function fetchHomeCosts(): Promise<HomeCostsResponse> {
  const response = await fetch('/api/home-costs');
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch home costs');
  }
  return response.json();
}

/**
 * Create home cost
 */
async function createHomeCost(data: CreateHomeCostRequest): Promise<HomeCost> {
  const response = await fetch('/api/home-costs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create home cost');
  }
  const { data: cost } = await response.json();
  return cost;
}

/**
 * Update home cost
 */
async function updateHomeCost(params: {
  id: string;
  data: UpdateHomeCostRequest;
}): Promise<HomeCost> {
  const response = await fetch(`/api/home-costs/${params.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params.data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update home cost');
  }
  const { data: cost } = await response.json();
  return cost;
}

/**
 * Delete home cost
 */
async function deleteHomeCost(id: string): Promise<void> {
  const response = await fetch(`/api/home-costs/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete home cost');
  }
}

/**
 * Update settings
 */
async function updateSettings(data: UpdateSettingsRequest): Promise<{ displayMode: string }> {
  const response = await fetch('/api/home-costs/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update settings');
  }
  const { data: settings } = await response.json();
  return settings;
}

/**
 * Hook to fetch all home costs and settings
 */
export function useHomeCosts() {
  return useQuery({
    queryKey: homeCostsKeys.list(),
    queryFn: fetchHomeCosts,
  });
}

/**
 * Hook to create a home cost
 */
export function useCreateHomeCost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createHomeCost,
    onSuccess: () => {
      // Invalidate home costs list
      queryClient.invalidateQueries({ queryKey: homeCostsKeys.list() });
      // Invalidate P&L report to refresh calculations
      queryClient.invalidateQueries({ queryKey: ['reports', 'profit-loss'] });
    },
  });
}

/**
 * Hook to update a home cost
 */
export function useUpdateHomeCost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateHomeCost,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: homeCostsKeys.list() });
      queryClient.invalidateQueries({ queryKey: ['reports', 'profit-loss'] });
    },
  });
}

/**
 * Hook to delete a home cost
 */
export function useDeleteHomeCost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteHomeCost,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: homeCostsKeys.list() });
      queryClient.invalidateQueries({ queryKey: ['reports', 'profit-loss'] });
    },
  });
}

/**
 * Hook to update settings
 */
export function useUpdateHomeCostsSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: homeCostsKeys.list() });
      queryClient.invalidateQueries({ queryKey: ['reports', 'profit-loss'] });
    },
  });
}
