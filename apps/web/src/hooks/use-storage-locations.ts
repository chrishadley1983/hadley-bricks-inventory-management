/**
 * Hook for fetching storage locations for autocomplete
 */

import { useQuery } from '@tanstack/react-query';

interface StorageLocationsResponse {
  locations: string[];
}

async function fetchStorageLocations(): Promise<string[]> {
  const response = await fetch('/api/inventory/storage-locations');
  if (!response.ok) {
    throw new Error('Failed to fetch storage locations');
  }
  const data: StorageLocationsResponse = await response.json();
  return data.locations;
}

/**
 * Hook to fetch distinct storage locations for autocomplete
 */
export function useStorageLocations() {
  return useQuery({
    queryKey: ['storage-locations'],
    queryFn: fetchStorageLocations,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
