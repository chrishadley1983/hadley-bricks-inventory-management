/**
 * Hook for Listing Optimiser functionality
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  OptimiserListing,
  ListingOptimiserSummary,
  OptimiserFilters,
  FullAnalysisResult,
  ListingSuggestion,
} from '@/components/features/listing-optimiser/types';

/**
 * Query key factory for listing optimiser
 */
export const listingOptimiserKeys = {
  all: ['listing-optimiser'] as const,
  listings: (filters?: OptimiserFilters) =>
    [...listingOptimiserKeys.all, 'listings', filters] as const,
  analysis: (itemId: string) => [...listingOptimiserKeys.all, 'analysis', itemId] as const,
};

/**
 * API response type
 */
interface ListingsResponse {
  data: {
    listings: OptimiserListing[];
    summary: ListingOptimiserSummary;
  };
}

interface AnalyseResponse {
  data: {
    results: FullAnalysisResult[];
    errors: Array<{ itemId: string; error: string }>;
    summary: { total: number; successful: number; failed: number };
  };
}

interface ApplyResponse {
  data: {
    success: boolean;
    itemId: string;
    message: string;
  };
}

/**
 * Fetch listings
 */
async function fetchListings(filters?: OptimiserFilters): Promise<ListingsResponse['data']> {
  const params = new URLSearchParams();

  if (filters?.search) params.set('search', filters.search);
  if (filters?.minAge !== undefined) params.set('minAge', String(filters.minAge));
  if (filters?.minViews !== undefined) params.set('minViews', String(filters.minViews));
  if (filters?.maxViews !== undefined) params.set('maxViews', String(filters.maxViews));
  if (filters?.hasWatchers !== undefined) params.set('hasWatchers', String(filters.hasWatchers));
  if (filters?.qualityGrade && filters.qualityGrade !== 'all') {
    params.set('qualityGrade', filters.qualityGrade);
  }
  if (filters?.reviewedStatus && filters.reviewedStatus !== 'all') {
    params.set('reviewedStatus', filters.reviewedStatus);
  }

  const response = await fetch(`/api/listing-optimiser?${params.toString()}`);
  const json = await response.json();

  if (!response.ok) {
    throw new Error(json.error || 'Failed to fetch listings');
  }

  return json.data;
}

/**
 * Analyse listings
 */
async function analyseListings(itemIds: string[]): Promise<AnalyseResponse['data']> {
  const response = await fetch('/api/listing-optimiser/analyse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemIds }),
  });

  const json = await response.json();

  if (!response.ok) {
    throw new Error(json.error || 'Failed to analyse listings');
  }

  return json.data;
}

/**
 * Apply a suggestion
 */
async function applySuggestion(
  itemId: string,
  suggestion: ListingSuggestion
): Promise<ApplyResponse['data']> {
  const response = await fetch('/api/listing-optimiser/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId, suggestion }),
  });

  const json = await response.json();

  if (!response.ok) {
    throw new Error(json.error || 'Failed to apply change');
  }

  return json.data;
}

/**
 * Hook for listing optimiser listings
 */
export function useListingOptimiserListings(filters?: OptimiserFilters) {
  return useQuery({
    queryKey: listingOptimiserKeys.listings(filters),
    queryFn: () => fetchListings(filters),
  });
}

/**
 * Hook for analysing listings
 */
export function useAnalyseListings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (itemIds: string[]) => analyseListings(itemIds),
    onSuccess: () => {
      // Invalidate listings to refresh scores
      queryClient.invalidateQueries({ queryKey: listingOptimiserKeys.all });
    },
  });
}

/**
 * Hook for applying suggestions
 */
export function useApplySuggestion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ itemId, suggestion }: { itemId: string; suggestion: ListingSuggestion }) =>
      applySuggestion(itemId, suggestion),
    onSuccess: () => {
      // Invalidate to refresh data
      queryClient.invalidateQueries({ queryKey: listingOptimiserKeys.all });
    },
  });
}
