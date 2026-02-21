/**
 * React Query hook for QuickFile credentials management
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { QuickFileCredentials } from '@/types/mtd-export';

interface CredentialsStatus {
  configured: boolean;
}

interface SaveCredentialsResponse {
  success: boolean;
  message: string;
}

/**
 * Query key factory for QuickFile credentials
 */
export const quickFileCredentialsKeys = {
  all: ['quickfile-credentials'] as const,
  status: () => [...quickFileCredentialsKeys.all, 'status'] as const,
};

/**
 * Fetch QuickFile credentials status
 */
async function fetchCredentialsStatus(): Promise<CredentialsStatus> {
  const response = await fetch('/api/integrations/quickfile/credentials');

  if (!response.ok) {
    throw new Error('Failed to fetch credentials status');
  }

  return response.json();
}

/**
 * Save QuickFile credentials
 */
async function saveCredentials(
  credentials: QuickFileCredentials
): Promise<SaveCredentialsResponse> {
  const response = await fetch('/api/integrations/quickfile/credentials', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(credentials),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Failed to save credentials');
  }

  return data;
}

/**
 * Delete QuickFile credentials
 */
async function deleteCredentials(): Promise<void> {
  const response = await fetch('/api/integrations/quickfile/credentials', {
    method: 'DELETE',
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Failed to delete credentials');
  }
}

/**
 * Hook to check if QuickFile credentials are configured
 */
export function useQuickFileCredentials() {
  return useQuery({
    queryKey: quickFileCredentialsKeys.status(),
    queryFn: fetchCredentialsStatus,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to save QuickFile credentials
 */
export function useSaveQuickFileCredentials() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: saveCredentials,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: quickFileCredentialsKeys.all });
    },
  });
}

/**
 * Hook to delete QuickFile credentials
 */
export function useDeleteQuickFileCredentials() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteCredentials,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: quickFileCredentialsKeys.all });
    },
  });
}
