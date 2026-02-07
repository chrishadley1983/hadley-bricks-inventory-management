'use client';

import { useQuery } from '@tanstack/react-query';
import {
  fetchInvestmentSets,
  type InvestmentFilters,
  type InvestmentPaginationParams,
} from '@/lib/api/investment';

/**
 * Query key factory for investment queries
 */
export const investmentKeys = {
  all: ['investment'] as const,
  lists: () => [...investmentKeys.all, 'list'] as const,
  list: (filters?: InvestmentFilters, pagination?: InvestmentPaginationParams) =>
    [...investmentKeys.lists(), { filters, pagination }] as const,
};

/**
 * Hook to fetch paginated investment sets
 */
export function useInvestmentSets(
  filters?: InvestmentFilters,
  pagination?: InvestmentPaginationParams
) {
  return useQuery({
    queryKey: investmentKeys.list(filters, pagination),
    queryFn: () => fetchInvestmentSets(filters, pagination),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
