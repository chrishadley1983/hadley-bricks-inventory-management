/**
 * Hook for fetching eligible listings for refresh
 */

import { useQuery } from '@tanstack/react-query';
import type { EligibleListing, EligibleListingFilters } from '@/lib/ebay/listing-refresh.types';

interface EligibleListingsResponse {
  data: EligibleListing[];
  count: number;
  error?: string;
}

async function fetchEligibleListings(filters?: EligibleListingFilters): Promise<EligibleListing[]> {
  const params = new URLSearchParams();

  if (filters?.minAge !== undefined) {
    params.set('minAge', String(filters.minAge));
  }
  if (filters?.maxPrice !== undefined) {
    params.set('maxPrice', String(filters.maxPrice));
  }
  if (filters?.minPrice !== undefined) {
    params.set('minPrice', String(filters.minPrice));
  }
  if (filters?.condition) {
    params.set('condition', filters.condition);
  }
  if (filters?.hasWatchers) {
    params.set('hasWatchers', 'true');
  }
  if (filters?.minWatchers !== undefined) {
    params.set('minWatchers', String(filters.minWatchers));
  }
  if (filters?.search) {
    params.set('search', filters.search);
  }

  const url = `/api/ebay/listing-refresh/eligible${params.toString() ? `?${params}` : ''}`;
  const response = await fetch(url);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to fetch eligible listings');
  }

  const data: EligibleListingsResponse = await response.json();

  // Convert dates
  return data.data.map((listing) => ({
    ...listing,
    listingStartDate: new Date(listing.listingStartDate),
  }));
}

/**
 * Query key factory for eligible listings
 */
export const eligibleListingsKeys = {
  all: ['eligible-listings'] as const,
  list: (filters?: EligibleListingFilters) =>
    [...eligibleListingsKeys.all, 'list', filters || {}] as const,
};

/**
 * Hook to fetch listings eligible for refresh
 */
export function useEligibleListings(filters?: EligibleListingFilters, enabled = true) {
  return useQuery({
    queryKey: eligibleListingsKeys.list(filters),
    queryFn: () => fetchEligibleListings(filters),
    enabled,
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 5 * 60 * 1000, // 5 minutes
  });
}
