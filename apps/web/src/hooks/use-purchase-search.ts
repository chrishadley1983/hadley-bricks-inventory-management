'use client';

import { useQuery } from '@tanstack/react-query';
import { useDeferredValue, useState, useCallback } from 'react';
import { searchPurchases, type PurchaseSearchResult } from '@/lib/api';

/**
 * Query key factory for purchase search queries
 */
export const purchaseSearchKeys = {
  all: ['purchases', 'search'] as const,
  search: (query: string) => [...purchaseSearchKeys.all, query] as const,
};

/**
 * Hook to search purchases with debounced input
 * Uses React's useDeferredValue for debouncing
 */
export function usePurchaseSearch(searchTerm: string, enabled = true) {
  // Defer the search term to avoid excessive API calls
  const deferredSearch = useDeferredValue(searchTerm);

  return useQuery({
    queryKey: purchaseSearchKeys.search(deferredSearch),
    queryFn: () => searchPurchases(deferredSearch),
    enabled: enabled && deferredSearch.length >= 2,
    staleTime: 30000, // Cache results for 30 seconds
    gcTime: 60000, // Keep in cache for 1 minute
  });
}

/**
 * Hook that provides search state management and search results
 * Includes the search input state and results
 */
export function usePurchaseLookup() {
  const [searchTerm, setSearchTerm] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  const { data: results = [], isLoading, isFetching } = usePurchaseSearch(searchTerm, isOpen);

  const clearSearch = useCallback(() => {
    setSearchTerm('');
  }, []);

  const openDropdown = useCallback(() => {
    setIsOpen(true);
  }, []);

  const closeDropdown = useCallback(() => {
    setIsOpen(false);
  }, []);

  return {
    searchTerm,
    setSearchTerm,
    results,
    isLoading: isLoading || isFetching,
    isOpen,
    setIsOpen,
    openDropdown,
    closeDropdown,
    clearSearch,
  };
}

/**
 * Calculate suggested cost per item when linking to a purchase
 * Takes into account existing linked items
 */
export function calculateSuggestedCost(
  purchase: PurchaseSearchResult,
  additionalItems = 1
): number {
  const totalItems = purchase.items_linked + additionalItems;
  if (totalItems <= 0) return purchase.cost;
  return Math.round((purchase.cost / totalItems) * 100) / 100;
}
