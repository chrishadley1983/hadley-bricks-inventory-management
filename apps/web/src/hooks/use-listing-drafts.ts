'use client';

/**
 * Hook for managing eBay listing drafts
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

/**
 * Query key factory for listing drafts
 */
export const listingDraftsKeys = {
  all: ['ebay', 'listing-drafts'] as const,
  list: () => [...listingDraftsKeys.all, 'list'] as const,
  detail: (id: string) => [...listingDraftsKeys.all, 'detail', id] as const,
  byInventoryItem: (inventoryItemId: string) =>
    [...listingDraftsKeys.all, 'inventory-item', inventoryItemId] as const,
};

/**
 * Draft list item from API
 */
export interface ListingDraftListItem {
  id: string;
  inventory_item_id: string;
  draft_data: Record<string, unknown>;
  error_context?: {
    error: string;
    failedStep: string;
    timestamp: string;
  };
  created_at: string;
  updated_at: string;
  inventory_items?: {
    set_number: string;
    item_name: string | null;
    condition: string | null;
  };
}

/**
 * Draft detail from API
 */
export interface ListingDraftDetail extends Omit<ListingDraftListItem, 'inventory_items'> {
  inventory_items?: {
    id: string;
    set_number: string;
    item_name: string | null;
    condition: string | null;
    notes: string | null;
  };
}

/**
 * Fetch all drafts
 */
async function fetchDrafts(): Promise<ListingDraftListItem[]> {
  const response = await fetch('/api/ebay/listing/draft');

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch drafts');
  }

  const data = await response.json();
  return data.data;
}

/**
 * Fetch a specific draft
 */
async function fetchDraft(id: string): Promise<ListingDraftDetail> {
  const response = await fetch(`/api/ebay/listing/draft/${id}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch draft');
  }

  const data = await response.json();
  return data.data;
}

/**
 * Save a draft
 */
async function saveDraft(input: {
  inventoryItemId: string;
  draftData: Record<string, unknown>;
}): Promise<{ id: string; created?: boolean; updated?: boolean }> {
  const response = await fetch('/api/ebay/listing/draft', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to save draft');
  }

  const data = await response.json();
  return data.data;
}

/**
 * Delete a draft
 */
async function deleteDraft(id: string): Promise<void> {
  const response = await fetch(`/api/ebay/listing/draft/${id}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete draft');
  }
}

/**
 * Hook to fetch all listing drafts
 */
export function useListingDrafts() {
  return useQuery({
    queryKey: listingDraftsKeys.list(),
    queryFn: fetchDrafts,
  });
}

/**
 * Hook to fetch a specific draft
 */
export function useListingDraft(id: string | undefined) {
  return useQuery({
    queryKey: listingDraftsKeys.detail(id!),
    queryFn: () => fetchDraft(id!),
    enabled: !!id,
  });
}

/**
 * Hook to save a draft
 */
export function useSaveDraft() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: saveDraft,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: listingDraftsKeys.list() });
    },
  });
}

/**
 * Hook to delete a draft
 */
export function useDeleteDraft() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteDraft,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: listingDraftsKeys.list() });
    },
  });
}

/**
 * Hook for managing a draft for a specific inventory item
 */
export function useInventoryItemDraft(inventoryItemId: string | undefined) {
  const { data: drafts } = useListingDrafts();
  const saveMutation = useSaveDraft();
  const deleteMutation = useDeleteDraft();

  // Find draft for this inventory item
  const draft = drafts?.find((d) => d.inventory_item_id === inventoryItemId);

  return {
    draft,
    hasDraft: !!draft,
    save: (draftData: Record<string, unknown>) => {
      if (!inventoryItemId) return;
      saveMutation.mutate({ inventoryItemId, draftData });
    },
    delete: () => {
      if (draft) {
        deleteMutation.mutate(draft.id);
      }
    },
    isSaving: saveMutation.isPending,
    isDeleting: deleteMutation.isPending,
    saveError: saveMutation.error,
    deleteError: deleteMutation.error,
  };
}
