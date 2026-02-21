'use client';

import { useQuery } from '@tanstack/react-query';
import type {
  ListingAuditData,
  ListingAuditResponse,
} from '@/app/api/ebay/listing/by-inventory/[inventoryId]/route';

/**
 * Query key factory for listing audit queries
 */
export const listingAuditKeys = {
  all: ['listing-audit'] as const,
  byInventory: (inventoryId: string) =>
    [...listingAuditKeys.all, 'by-inventory', inventoryId] as const,
};

/**
 * Fetch listing audit data for an inventory item
 */
async function fetchListingAudit(inventoryId: string): Promise<ListingAuditData | null> {
  const response = await fetch(`/api/ebay/listing/by-inventory/${inventoryId}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to fetch listing audit' }));
    throw new Error(error.error || 'Failed to fetch listing audit');
  }

  const data: ListingAuditResponse = await response.json();
  return data.audit;
}

/**
 * Hook to fetch the listing audit for an inventory item
 * Returns the most recent completed audit with generated content and quality review
 */
export function useListingAudit(inventoryId: string | undefined) {
  return useQuery({
    queryKey: listingAuditKeys.byInventory(inventoryId!),
    queryFn: () => fetchListingAudit(inventoryId!),
    enabled: !!inventoryId,
    staleTime: 5 * 60 * 1000, // 5 minutes - audit data doesn't change often
  });
}

export type { ListingAuditData };
