'use client';

import { useQuery } from '@tanstack/react-query';
import {
  fetchInvestmentSets,
  fetchInvestmentSetDetail,
  fetchPriceHistory,
  fetchInvestmentThemes,
  fetchModelStatus,
  fetchPatterns,
  fetchRetirementRadar,
  fetchPredictions,
  type InvestmentFilters,
  type InvestmentPaginationParams,
  type PredictionsFilters,
} from '@/lib/api/investment';

/**
 * Query key factory for investment queries
 */
export const investmentKeys = {
  all: ['investment'] as const,
  lists: () => [...investmentKeys.all, 'list'] as const,
  list: (filters?: InvestmentFilters, pagination?: InvestmentPaginationParams) =>
    [...investmentKeys.lists(), { filters, pagination }] as const,
  detail: (setNumber: string) => [...investmentKeys.all, 'detail', setNumber] as const,
  priceHistory: (setNumber: string) => [...investmentKeys.all, 'priceHistory', setNumber] as const,
  themes: () => [...investmentKeys.all, 'themes'] as const,
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

/**
 * Hook to fetch a single investment set detail
 */
export function useInvestmentSetDetail(setNumber: string) {
  return useQuery({
    queryKey: investmentKeys.detail(setNumber),
    queryFn: () => fetchInvestmentSetDetail(setNumber),
    staleTime: 5 * 60 * 1000,
    enabled: !!setNumber,
  });
}

/**
 * Hook to fetch price history for a set
 */
export function usePriceHistory(setNumber: string) {
  return useQuery({
    queryKey: investmentKeys.priceHistory(setNumber),
    queryFn: () => fetchPriceHistory(setNumber),
    staleTime: 5 * 60 * 1000,
    enabled: !!setNumber,
  });
}

/**
 * Hook to fetch distinct themes for the filter dropdown
 */
export function useInvestmentThemes() {
  return useQuery({
    queryKey: investmentKeys.themes(),
    queryFn: fetchInvestmentThemes,
    staleTime: 10 * 60 * 1000, // 10 minutes - themes rarely change
  });
}

/**
 * Hook to fetch ML model status for the dashboard strip
 */
export function useModelStatus() {
  return useQuery({
    queryKey: [...investmentKeys.all, 'model-status'] as const,
    queryFn: fetchModelStatus,
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * Hook to fetch appreciation patterns (theme/year/RRP/licence aggregates)
 */
export function useInvestmentPatterns() {
  return useQuery({
    queryKey: [...investmentKeys.all, 'patterns'] as const,
    queryFn: fetchPatterns,
    staleTime: 30 * 60 * 1000, // labels change only when the pipeline reruns
  });
}

/**
 * Hook to fetch the retirement radar (retiring next N months + recently retired)
 */
export function useRetirementRadar(params?: { window?: number; limit?: number }) {
  return useQuery({
    queryKey: [...investmentKeys.all, 'retirement-radar', params] as const,
    queryFn: () => fetchRetirementRadar(params),
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * Hook to fetch scored predictions (top picks / deal sheet)
 */
export function usePredictions(filters?: PredictionsFilters) {
  return useQuery({
    queryKey: [...investmentKeys.all, 'predictions', filters] as const,
    queryFn: () => fetchPredictions(filters),
    staleTime: 10 * 60 * 1000,
  });
}
