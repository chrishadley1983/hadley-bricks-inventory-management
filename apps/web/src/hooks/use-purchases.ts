'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { PurchaseInsert, PurchaseUpdate } from '@hadley-bricks/database';
import {
  fetchPurchases,
  fetchPurchase,
  fetchPurchaseProfitability,
  createPurchase,
  updatePurchase,
  deletePurchase,
  bulkUpdatePurchases,
  bulkDeletePurchases,
  parsePurchase,
  calculateMileage,
  type PurchaseFilters,
  type PaginationParams,
  type BulkUpdatePurchaseInput,
} from '@/lib/api';

/**
 * Query key factory for purchase queries
 */
export const purchaseKeys = {
  all: ['purchases'] as const,
  lists: () => [...purchaseKeys.all, 'list'] as const,
  list: (filters?: PurchaseFilters, pagination?: PaginationParams) =>
    [...purchaseKeys.lists(), { filters, pagination }] as const,
  details: () => [...purchaseKeys.all, 'detail'] as const,
  detail: (id: string) => [...purchaseKeys.details(), id] as const,
  profitability: (id: string) => [...purchaseKeys.all, 'profitability', id] as const,
};

/**
 * Hook to fetch paginated purchase list
 */
export function usePurchaseList(filters?: PurchaseFilters, pagination?: PaginationParams) {
  return useQuery({
    queryKey: purchaseKeys.list(filters, pagination),
    queryFn: () => fetchPurchases(filters, pagination),
  });
}

/**
 * Hook to fetch a single purchase
 */
export function usePurchase(id: string | undefined) {
  return useQuery({
    queryKey: purchaseKeys.detail(id!),
    queryFn: () => fetchPurchase(id!),
    enabled: !!id,
  });
}

/**
 * Hook to create a new purchase
 */
export function useCreatePurchase() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Omit<PurchaseInsert, 'user_id'>) => createPurchase(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: purchaseKeys.all });
    },
  });
}

/**
 * Hook to update a purchase
 */
export function useUpdatePurchase() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: PurchaseUpdate }) =>
      updatePurchase(id, data),
    onSuccess: (updatedPurchase) => {
      queryClient.setQueryData(purchaseKeys.detail(updatedPurchase.id), updatedPurchase);
      queryClient.invalidateQueries({ queryKey: purchaseKeys.lists() });
    },
  });
}

/**
 * Hook to delete a purchase
 */
export function useDeletePurchase() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deletePurchase(id),
    onSuccess: (_, deletedId) => {
      queryClient.removeQueries({ queryKey: purchaseKeys.detail(deletedId) });
      queryClient.invalidateQueries({ queryKey: purchaseKeys.lists() });
    },
  });
}

/**
 * Hook to bulk update multiple purchases
 */
export function useBulkUpdatePurchases() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: BulkUpdatePurchaseInput) => bulkUpdatePurchases(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: purchaseKeys.all });
    },
  });
}

/**
 * Hook to bulk delete multiple purchases
 */
export function useBulkDeletePurchases() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ids: string[]) => bulkDeletePurchases(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: purchaseKeys.all });
    },
  });
}

/**
 * Hook to parse a purchase from natural language
 */
export function useParsePurchase() {
  return useMutation({
    mutationFn: (text: string) => parsePurchase(text),
  });
}

/**
 * Hook to calculate mileage between postcodes
 */
export function useCalculateMileage() {
  return useMutation({
    mutationFn: ({ fromPostcode, toPostcode }: { fromPostcode: string; toPostcode: string }) =>
      calculateMileage(fromPostcode, toPostcode),
  });
}

/**
 * Hook to fetch profitability metrics for a purchase
 */
export function usePurchaseProfitability(purchaseId: string | undefined) {
  return useQuery({
    queryKey: purchaseKeys.profitability(purchaseId!),
    queryFn: () => fetchPurchaseProfitability(purchaseId!),
    enabled: !!purchaseId,
    staleTime: 60000, // 1 minute cache
  });
}
