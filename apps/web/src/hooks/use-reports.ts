'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  DateRangePreset,
  ProfitLossReport,
  InventoryValuationReport,
  InventoryAgingReport,
  PlatformPerformanceReport,
  PurchaseAnalysisReport,
  TaxSummaryReport,
  ReportSettings,
  DailyActivityReport,
  StoreStatusRecord,
  UpdateStoreStatusInput,
} from '@/lib/services';

interface DateRangeParams {
  startDate: Date;
  endDate: Date;
  preset?: DateRangePreset;
}

async function fetchReport<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`/api/reports/${endpoint}`, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.set(key, value);
      }
    });
  }

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Failed to fetch ${endpoint} report`);
  }
  const json = await response.json();
  return json.data;
}

/**
 * Hook for fetching profit/loss report
 */
export function useProfitLossReport(dateRange?: DateRangeParams, compareWithPrevious = true) {
  return useQuery<ProfitLossReport>({
    queryKey: ['reports', 'profit-loss', dateRange, compareWithPrevious],
    queryFn: () =>
      fetchReport<ProfitLossReport>('profit-loss', {
        ...(dateRange && {
          startDate: dateRange.startDate.toISOString().split('T')[0],
          endDate: dateRange.endDate.toISOString().split('T')[0],
          preset: dateRange.preset,
        }),
        compareWithPrevious: String(compareWithPrevious),
      }),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook for fetching inventory valuation report
 */
export function useInventoryValuationReport() {
  return useQuery<InventoryValuationReport>({
    queryKey: ['reports', 'inventory-valuation'],
    queryFn: () => fetchReport<InventoryValuationReport>('inventory-valuation'),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Hook for fetching inventory aging report
 */
export function useInventoryAgingReport() {
  return useQuery<InventoryAgingReport>({
    queryKey: ['reports', 'inventory-aging'],
    queryFn: () => fetchReport<InventoryAgingReport>('inventory-aging'),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Hook for fetching platform performance report
 */
export function usePlatformPerformanceReport(dateRange?: DateRangeParams) {
  return useQuery<PlatformPerformanceReport>({
    queryKey: ['reports', 'platform-performance', dateRange],
    queryFn: () =>
      fetchReport<PlatformPerformanceReport>('platform-performance', {
        ...(dateRange && {
          startDate: dateRange.startDate.toISOString().split('T')[0],
          endDate: dateRange.endDate.toISOString().split('T')[0],
          preset: dateRange.preset,
        }),
      }),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Hook for fetching purchase analysis report
 */
export function usePurchaseAnalysisReport(dateRange?: DateRangeParams) {
  return useQuery<PurchaseAnalysisReport>({
    queryKey: ['reports', 'purchase-analysis', dateRange],
    queryFn: () =>
      fetchReport<PurchaseAnalysisReport>('purchase-analysis', {
        ...(dateRange && {
          startDate: dateRange.startDate.toISOString().split('T')[0],
          endDate: dateRange.endDate.toISOString().split('T')[0],
          preset: dateRange.preset,
        }),
      }),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Hook for fetching tax summary report
 */
export function useTaxSummaryReport(financialYear?: number) {
  return useQuery<TaxSummaryReport>({
    queryKey: ['reports', 'tax-summary', financialYear],
    queryFn: () =>
      fetchReport<TaxSummaryReport>('tax-summary', {
        ...(financialYear && { financialYear: String(financialYear) }),
      }),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Hook for fetching report settings
 */
export function useReportSettings() {
  return useQuery<ReportSettings>({
    queryKey: ['reports', 'settings'],
    queryFn: () => fetchReport<ReportSettings>('settings'),
    staleTime: 10 * 60 * 1000, // 10 minutes
  });
}

/**
 * Hook for updating report settings
 */
export function useUpdateReportSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (settings: Partial<ReportSettings>) => {
      const response = await fetch('/api/reports/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!response.ok) {
        throw new Error('Failed to update settings');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reports', 'settings'] });
    },
  });
}

/**
 * Hook for exporting reports
 */
export function useExportReport() {
  return useMutation({
    mutationFn: async ({
      reportType,
      format,
      dateRange,
      financialYear,
    }: {
      reportType: string;
      format: 'csv' | 'json';
      dateRange?: DateRangeParams;
      financialYear?: number;
    }) => {
      const url = new URL('/api/reports/export', window.location.origin);
      url.searchParams.set('reportType', reportType);
      url.searchParams.set('format', format);

      if (dateRange) {
        url.searchParams.set('startDate', dateRange.startDate.toISOString().split('T')[0]);
        url.searchParams.set('endDate', dateRange.endDate.toISOString().split('T')[0]);
        if (dateRange.preset) {
          url.searchParams.set('preset', dateRange.preset);
        }
      }

      if (financialYear) {
        url.searchParams.set('financialYear', String(financialYear));
      }

      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error('Failed to export report');
      }

      // Get the blob and trigger download
      const blob = await response.blob();
      const contentDisposition = response.headers.get('Content-Disposition');
      const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
      const filename = filenameMatch ? filenameMatch[1] : `report.${format}`;

      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);

      return { success: true };
    },
  });
}

/**
 * Hook for fetching daily activity report
 */
export function useDailyActivityReport(
  dateRange?: DateRangeParams,
  granularity: 'daily' | 'monthly' = 'daily'
) {
  return useQuery<DailyActivityReport>({
    queryKey: ['reports', 'daily-activity', dateRange, granularity],
    queryFn: () =>
      fetchReport<DailyActivityReport>('daily-activity', {
        ...(dateRange && {
          startDate: dateRange.startDate.toISOString().split('T')[0],
          endDate: dateRange.endDate.toISOString().split('T')[0],
          preset: dateRange.preset,
        }),
        granularity,
      }),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook for fetching store statuses
 */
export function useStoreStatuses(dateRange?: DateRangeParams) {
  return useQuery<StoreStatusRecord[]>({
    queryKey: ['store-status', dateRange],
    queryFn: async () => {
      if (!dateRange) return [];

      const url = new URL('/api/store-status', window.location.origin);
      url.searchParams.set('startDate', dateRange.startDate.toISOString().split('T')[0]);
      url.searchParams.set('endDate', dateRange.endDate.toISOString().split('T')[0]);

      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error('Failed to fetch store statuses');
      }
      const json = await response.json();
      return json.data;
    },
    enabled: !!dateRange,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Hook for updating a single store status
 */
export function useUpdateStoreStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdateStoreStatusInput) => {
      const response = await fetch('/api/store-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw new Error('Failed to update store status');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['store-status'] });
      queryClient.invalidateQueries({ queryKey: ['reports', 'daily-activity'] });
    },
  });
}

/**
 * Hook for batch updating store statuses
 */
export function useBatchUpdateStoreStatuses() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (statuses: UpdateStoreStatusInput[]) => {
      const response = await fetch('/api/store-status', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statuses }),
      });
      if (!response.ok) {
        throw new Error('Failed to batch update store statuses');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['store-status'] });
      queryClient.invalidateQueries({ queryKey: ['reports', 'daily-activity'] });
    },
  });
}
