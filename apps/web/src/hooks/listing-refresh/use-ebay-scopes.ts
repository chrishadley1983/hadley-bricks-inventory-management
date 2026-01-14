/**
 * Hook for checking eBay OAuth scopes
 */

import { useQuery } from '@tanstack/react-query';
import type { ScopeValidationResult } from '@/lib/ebay/listing-refresh.types';

interface ScopeCheckResponse {
  data: ScopeValidationResult;
  error?: string;
}

async function fetchEbayScopes(): Promise<ScopeValidationResult> {
  const response = await fetch('/api/ebay/connection/scopes');

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to check eBay scopes');
  }

  const data: ScopeCheckResponse = await response.json();
  return data.data;
}

/**
 * Query key factory for eBay scopes
 */
export const ebayScapeKeys = {
  all: ['ebay-scopes'] as const,
  check: () => [...ebayScapeKeys.all, 'check'] as const,
};

/**
 * Hook to check if user has required eBay OAuth scopes for listing management
 */
export function useEbayScopes() {
  return useQuery({
    queryKey: ebayScapeKeys.check(),
    queryFn: fetchEbayScopes,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes (formerly cacheTime)
    retry: 1,
  });
}
