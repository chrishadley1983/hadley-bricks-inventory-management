'use client';

/**
 * Hook for fetching and managing eBay business policies
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { BusinessPoliciesResponse } from '@/lib/ebay/listing-creation.types';

/**
 * Query key factory for business policies
 */
export const businessPoliciesKeys = {
  all: ['ebay', 'business-policies'] as const,
};

/**
 * Fetch business policies from the API
 */
async function fetchBusinessPolicies(): Promise<BusinessPoliciesResponse> {
  const response = await fetch('/api/ebay/business-policies');

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch business policies');
  }

  const data = await response.json();
  return data.data;
}

/**
 * Refresh business policies from eBay
 */
async function refreshBusinessPolicies(): Promise<BusinessPoliciesResponse> {
  const response = await fetch('/api/ebay/business-policies', {
    method: 'POST',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to refresh business policies');
  }

  const data = await response.json();
  return data.data;
}

/**
 * Clear business policies cache
 */
async function clearPoliciesCache(): Promise<void> {
  const response = await fetch('/api/ebay/business-policies', {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to clear cache');
  }
}

/**
 * Hook to fetch eBay business policies
 *
 * Policies are cached for 24 hours on the server.
 * Use the `refresh` function to force a fetch from eBay.
 */
export function useBusinessPolicies() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: businessPoliciesKeys.all,
    queryFn: fetchBusinessPolicies,
    staleTime: 5 * 60 * 1000, // 5 minutes client-side
    gcTime: 30 * 60 * 1000, // 30 minutes
    retry: 1,
  });

  const refreshMutation = useMutation({
    mutationFn: refreshBusinessPolicies,
    onSuccess: (data) => {
      queryClient.setQueryData(businessPoliciesKeys.all, data);
    },
  });

  const clearCacheMutation = useMutation({
    mutationFn: clearPoliciesCache,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: businessPoliciesKeys.all });
    },
  });

  return {
    ...query,
    refresh: refreshMutation.mutate,
    isRefreshing: refreshMutation.isPending,
    refreshError: refreshMutation.error,
    clearCache: clearCacheMutation.mutate,
    isClearingCache: clearCacheMutation.isPending,
  };
}

/**
 * Hook to get only the default policies
 */
export function useDefaultPolicies() {
  const { data: policies, isLoading, error } = useBusinessPolicies();

  return {
    defaults: policies?.defaults ?? null,
    isLoading,
    error,
  };
}
