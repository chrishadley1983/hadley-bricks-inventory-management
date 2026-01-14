/**
 * Listings Hooks
 *
 * React Query hooks for managing generated listings.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  GeneratedListing,
  CreateListingInput,
  UpdateListingInput,
  ListingStatus,
} from '@/lib/listing-assistant/types';

// ============================================
// Query Keys
// ============================================

export const listingKeys = {
  all: ['generated-listings'] as const,
  lists: () => [...listingKeys.all, 'list'] as const,
  list: (filters?: ListingFilters) => [...listingKeys.lists(), filters] as const,
  details: () => [...listingKeys.all, 'detail'] as const,
  detail: (id: string) => [...listingKeys.details(), id] as const,
  counts: () => [...listingKeys.all, 'counts'] as const,
};

// ============================================
// Types
// ============================================

interface ListingFilters {
  status?: ListingStatus;
  inventoryItemId?: string;
  limit?: number;
  offset?: number;
}

interface ListingsResponse {
  data: GeneratedListing[];
  total: number;
  counts?: Record<string, number>;
}

// ============================================
// API Functions
// ============================================

async function fetchListings(
  filters?: ListingFilters,
  includeCounts?: boolean
): Promise<ListingsResponse> {
  const params = new URLSearchParams();

  if (filters?.status) params.set('status', filters.status);
  if (filters?.inventoryItemId) params.set('inventoryItemId', filters.inventoryItemId);
  if (filters?.limit) params.set('limit', String(filters.limit));
  if (filters?.offset) params.set('offset', String(filters.offset));
  if (includeCounts) params.set('includeCounts', 'true');

  const url = `/api/listing-assistant/listings${params.toString() ? `?${params}` : ''}`;
  const response = await fetch(url);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch listings');
  }

  return response.json();
}

async function fetchListing(id: string): Promise<GeneratedListing> {
  const response = await fetch(`/api/listing-assistant/listings/${id}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch listing');
  }

  const { data } = await response.json();
  return data;
}

async function createListing(input: CreateListingInput): Promise<GeneratedListing> {
  const response = await fetch('/api/listing-assistant/listings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to save listing');
  }

  const { data } = await response.json();
  return data;
}

async function updateListing({
  id,
  ...input
}: UpdateListingInput & { id: string }): Promise<GeneratedListing> {
  const response = await fetch(`/api/listing-assistant/listings/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update listing');
  }

  const { data } = await response.json();
  return data;
}

async function deleteListing(id: string): Promise<void> {
  const response = await fetch(`/api/listing-assistant/listings/${id}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete listing');
  }
}

// ============================================
// Hooks
// ============================================

/**
 * Hook to fetch listings with optional filters
 */
export function useListings(filters?: ListingFilters, includeCounts = false) {
  return useQuery({
    queryKey: listingKeys.list(filters),
    queryFn: () => fetchListings(filters, includeCounts),
    staleTime: 1 * 60 * 1000, // 1 minute
  });
}

/**
 * Hook to fetch a single listing
 */
export function useListing(id: string | null) {
  return useQuery({
    queryKey: listingKeys.detail(id || ''),
    queryFn: () => fetchListing(id!),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Hook to fetch listing counts by status
 */
export function useListingCounts() {
  return useQuery({
    queryKey: listingKeys.counts(),
    queryFn: async () => {
      const { counts } = await fetchListings(undefined, true);
      return counts || { draft: 0, ready: 0, listed: 0, sold: 0, total: 0 };
    },
    staleTime: 1 * 60 * 1000,
  });
}

/**
 * Hook to save a new listing
 */
export function useCreateListing() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createListing,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: listingKeys.lists() });
      queryClient.invalidateQueries({ queryKey: listingKeys.counts() });
    },
  });
}

/**
 * Hook to update a listing
 */
export function useUpdateListing() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateListing,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: listingKeys.lists() });
      queryClient.invalidateQueries({ queryKey: listingKeys.counts() });
      queryClient.setQueryData(listingKeys.detail(data.id), data);
    },
  });
}

/**
 * Hook to delete a listing
 */
export function useDeleteListing() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteListing,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: listingKeys.lists() });
      queryClient.invalidateQueries({ queryKey: listingKeys.counts() });
    },
  });
}
