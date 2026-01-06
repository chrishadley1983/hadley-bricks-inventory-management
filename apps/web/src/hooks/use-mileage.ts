'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchMileageForPurchase,
  fetchMileageList,
  fetchMileageEntry,
  createMileageEntry,
  updateMileageEntry,
  deleteMileageEntry,
  fetchHomeAddress,
  updateHomeAddress,
  type MileageFilters,
  type PaginationParams,
  type CreateMileageInput,
  type UpdateMileageInput,
} from '@/lib/api';

/**
 * Query key factory for mileage queries
 */
export const mileageKeys = {
  all: ['mileage'] as const,
  lists: () => [...mileageKeys.all, 'list'] as const,
  list: (filters?: MileageFilters, pagination?: PaginationParams) =>
    [...mileageKeys.lists(), { filters, pagination }] as const,
  details: () => [...mileageKeys.all, 'detail'] as const,
  detail: (id: string) => [...mileageKeys.details(), id] as const,
  forPurchase: (purchaseId: string) => [...mileageKeys.all, 'purchase', purchaseId] as const,
  homeAddress: () => ['homeAddress'] as const,
};

/**
 * Hook to fetch mileage summary for a specific purchase
 */
export function useMileageForPurchase(purchaseId: string | undefined) {
  return useQuery({
    queryKey: mileageKeys.forPurchase(purchaseId!),
    queryFn: () => fetchMileageForPurchase(purchaseId!),
    enabled: !!purchaseId,
  });
}

/**
 * Hook to fetch mileage list with filters
 */
export function useMileageList(filters?: MileageFilters, pagination?: PaginationParams) {
  return useQuery({
    queryKey: mileageKeys.list(filters, pagination),
    queryFn: () => fetchMileageList(filters, pagination),
  });
}

/**
 * Hook to fetch a single mileage entry
 */
export function useMileageEntry(id: string | undefined) {
  return useQuery({
    queryKey: mileageKeys.detail(id!),
    queryFn: () => fetchMileageEntry(id!),
    enabled: !!id,
  });
}

/**
 * Hook to create a mileage entry
 */
export function useCreateMileage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateMileageInput) => createMileageEntry(data),
    onSuccess: (newEntry) => {
      // Invalidate all mileage queries
      queryClient.invalidateQueries({ queryKey: mileageKeys.all });

      // If linked to a purchase, specifically invalidate that purchase's mileage
      if (newEntry.purchase_id) {
        queryClient.invalidateQueries({
          queryKey: mileageKeys.forPurchase(newEntry.purchase_id),
        });
      }
    },
  });
}

/**
 * Hook to update a mileage entry
 */
export function useUpdateMileage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateMileageInput }) =>
      updateMileageEntry(id, data),
    onSuccess: (updatedEntry) => {
      // Update the cache with the new data
      queryClient.setQueryData(mileageKeys.detail(updatedEntry.id), updatedEntry);

      // Invalidate lists
      queryClient.invalidateQueries({ queryKey: mileageKeys.lists() });

      // If linked to a purchase, invalidate that purchase's mileage
      if (updatedEntry.purchase_id) {
        queryClient.invalidateQueries({
          queryKey: mileageKeys.forPurchase(updatedEntry.purchase_id),
        });
      }
    },
  });
}

/**
 * Hook to delete a mileage entry
 */
export function useDeleteMileage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id }: { id: string; purchaseId?: string | null }) =>
      deleteMileageEntry(id),
    onSuccess: (_, { id, purchaseId }) => {
      // Remove from detail cache
      queryClient.removeQueries({ queryKey: mileageKeys.detail(id) });

      // Invalidate lists
      queryClient.invalidateQueries({ queryKey: mileageKeys.lists() });

      // If linked to a purchase, invalidate that purchase's mileage
      if (purchaseId) {
        queryClient.invalidateQueries({
          queryKey: mileageKeys.forPurchase(purchaseId),
        });
      }
    },
  });
}

/**
 * Hook to fetch the user's home address
 */
export function useHomeAddress() {
  return useQuery({
    queryKey: mileageKeys.homeAddress(),
    queryFn: fetchHomeAddress,
  });
}

/**
 * Hook to update the user's home address
 */
export function useUpdateHomeAddress() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (homeAddress: string) => updateHomeAddress(homeAddress),
    onSuccess: (newAddress) => {
      queryClient.setQueryData(mileageKeys.homeAddress(), newAddress);
    },
  });
}
