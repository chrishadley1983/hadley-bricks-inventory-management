/**
 * eBay Stock Hooks
 *
 * TanStack Query hooks for eBay stock management.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { PlatformListing, ListingImport, ComparisonSummary } from '@/lib/platform-stock/types';
import type {
  EbayStockComparison,
  EbayComparisonFilters,
  EbayListingFilters,
  SkuIssue,
} from '@/lib/platform-stock/ebay/types';

// ============================================================================
// Query Keys
// ============================================================================

export const ebayStockKeys = {
  all: ['ebay-stock'] as const,
  listings: (filters: EbayListingFilters, page: number, pageSize: number) =>
    [...ebayStockKeys.all, 'listings', filters, page, pageSize] as const,
  comparison: (filters: EbayComparisonFilters) =>
    [...ebayStockKeys.all, 'comparison', filters] as const,
  imports: () => [...ebayStockKeys.all, 'imports'] as const,
  skuIssues: () => [...ebayStockKeys.all, 'sku-issues'] as const,
};

// ============================================================================
// API Response Types
// ============================================================================

interface EbayListingsResponse {
  data: {
    listings: PlatformListing[];
    latestImport: ListingImport | null;
    pagination: {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    };
  };
}

interface EbayComparisonResponse {
  data: {
    comparisons: EbayStockComparison[];
    summary: ComparisonSummary;
  };
}

interface EbayImportsResponse {
  data: {
    imports: ListingImport[];
  };
}

interface EbayImportTriggerResponse {
  data: {
    import: ListingImport;
    message: string;
  };
}

interface SkuIssuesResponse {
  data: {
    issues: SkuIssue[];
    summary: {
      emptySkuCount: number;
      duplicateSkuCount: number;
      totalIssueCount: number;
    };
  };
}

// ============================================================================
// API Functions
// ============================================================================

async function fetchEbayListings(
  filters: EbayListingFilters,
  page: number,
  pageSize: number
): Promise<EbayListingsResponse['data']> {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));

  if (filters.search) params.set('search', filters.search);
  if (filters.listingStatus && filters.listingStatus !== 'all') {
    params.set('status', filters.listingStatus);
  }
  if (filters.hasQuantity) params.set('hasQuantity', 'true');
  if (filters.sort) {
    params.set('sortColumn', filters.sort.column);
    params.set('sortDirection', filters.sort.direction);
  }

  const response = await fetch(`/api/ebay-stock?${params.toString()}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch eBay listings');
  }

  const data: EbayListingsResponse = await response.json();
  return data.data;
}

async function fetchEbayComparison(
  filters: EbayComparisonFilters
): Promise<EbayComparisonResponse['data']> {
  const params = new URLSearchParams();

  if (filters.discrepancyType && filters.discrepancyType !== 'all') {
    params.set('discrepancyType', filters.discrepancyType);
  }
  if (filters.search) params.set('search', filters.search);
  if (filters.hideZeroQuantities) params.set('hideZeroQuantities', 'true');

  const response = await fetch(`/api/ebay-stock/comparison?${params.toString()}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch stock comparison');
  }

  const data: EbayComparisonResponse = await response.json();
  return data.data;
}

async function fetchEbayImports(limit = 10): Promise<ListingImport[]> {
  const response = await fetch(`/api/ebay-stock/import?limit=${limit}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch import history');
  }

  const data: EbayImportsResponse = await response.json();
  return data.data.imports;
}

async function triggerEbayImport(): Promise<EbayImportTriggerResponse['data']> {
  const response = await fetch('/api/ebay-stock/import', {
    method: 'POST',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to trigger import');
  }

  const data: EbayImportTriggerResponse = await response.json();
  return data.data;
}

async function fetchSkuIssues(): Promise<SkuIssuesResponse['data']> {
  const response = await fetch('/api/ebay-stock/sku-issues');

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch SKU issues');
  }

  const data: SkuIssuesResponse = await response.json();
  return data.data;
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Fetch eBay listings with pagination and filtering
 */
export function useEbayListings(filters: EbayListingFilters = {}, page = 1, pageSize = 50) {
  return useQuery({
    queryKey: ebayStockKeys.listings(filters, page, pageSize),
    queryFn: () => fetchEbayListings(filters, page, pageSize),
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

/**
 * Fetch eBay stock comparison
 */
export function useEbayStockComparison(filters: EbayComparisonFilters = {}) {
  return useQuery({
    queryKey: ebayStockKeys.comparison(filters),
    queryFn: () => fetchEbayComparison(filters),
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

/**
 * Fetch eBay import history
 */
export function useEbayImportHistory(limit = 10) {
  return useQuery({
    queryKey: ebayStockKeys.imports(),
    queryFn: () => fetchEbayImports(limit),
    staleTime: 30 * 1000, // 30 seconds
  });
}

/**
 * Fetch SKU issues (empty/duplicate SKUs)
 */
export function useEbaySkuIssues() {
  return useQuery({
    queryKey: ebayStockKeys.skuIssues(),
    queryFn: fetchSkuIssues,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

/**
 * Trigger eBay listing import
 */
export function useTriggerEbayImport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: triggerEbayImport,
    onSuccess: () => {
      // Invalidate all eBay stock queries
      queryClient.invalidateQueries({ queryKey: ebayStockKeys.all });
    },
  });
}

/**
 * Get the latest import from listings query
 */
export function useEbayLatestImport() {
  const { data } = useEbayListings({}, 1, 1);
  return data?.latestImport ?? null;
}

/**
 * Check if an import is currently in progress
 */
export function useEbayIsImporting() {
  const latestImport = useEbayLatestImport();
  return latestImport?.status === 'processing';
}

// ============================================================================
// Price Update Types and Functions
// ============================================================================

export interface UpdatePriceParams {
  itemId: string;
  newPrice: number;
  updateBestOffer?: boolean;
  autoAcceptPercent?: number;
  minOfferPercent?: number;
}

export interface UpdatePriceResult {
  success: boolean;
  itemId: string;
  newPrice: number;
  autoAcceptPrice: number | null;
  minOfferPrice: number | null;
  warnings?: string[];
}

async function updateEbayPrice(params: UpdatePriceParams): Promise<UpdatePriceResult> {
  const response = await fetch(`/api/ebay-stock/${params.itemId}/price`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      newPrice: params.newPrice,
      updateBestOffer: params.updateBestOffer ?? true,
      autoAcceptPercent: params.autoAcceptPercent ?? 90,
      minOfferPercent: params.minOfferPercent ?? 70,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.details || error.error || 'Failed to update price');
  }

  const data = await response.json();
  return data.data;
}

/**
 * Update eBay listing price with Best Offer thresholds
 */
export function useUpdateEbayPrice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateEbayPrice,
    onSuccess: () => {
      // Invalidate listings to refresh the table
      queryClient.invalidateQueries({ queryKey: ebayStockKeys.all });
    },
  });
}
