/**
 * Settings Hooks
 *
 * React Query hooks for listing assistant settings.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ListingAssistantSettings, UpdateSettingsInput } from '@/lib/listing-assistant/types';

// ============================================
// Query Keys
// ============================================

export const settingsKeys = {
  all: ['listing-assistant-settings'] as const,
  detail: () => [...settingsKeys.all, 'detail'] as const,
};

// ============================================
// API Functions
// ============================================

async function fetchSettings(): Promise<ListingAssistantSettings> {
  const response = await fetch('/api/listing-assistant/settings');

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch settings');
  }

  const { data } = await response.json();
  return data;
}

async function updateSettings(input: UpdateSettingsInput): Promise<ListingAssistantSettings> {
  const response = await fetch('/api/listing-assistant/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update settings');
  }

  const { data } = await response.json();
  return data;
}

// ============================================
// Hooks
// ============================================

/**
 * Hook to fetch user settings
 */
export function useSettings() {
  return useQuery({
    queryKey: settingsKeys.detail(),
    queryFn: fetchSettings,
    staleTime: 10 * 60 * 1000, // 10 minutes
  });
}

/**
 * Hook to update user settings
 */
export function useUpdateSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateSettings,
    onSuccess: (data) => {
      queryClient.setQueryData(settingsKeys.detail(), data);
    },
  });
}
