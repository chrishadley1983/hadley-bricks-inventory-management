import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';
import {
  useProfitLossReport,
  useInventoryValuationReport,
  useInventoryAgingReport,
  usePlatformPerformanceReport,
  useSalesTrendsReport,
  usePurchaseAnalysisReport,
  useTaxSummaryReport,
  useReportSettings,
  useUpdateReportSettings,
  useExportReport,
} from '../use-reports';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  const TestWrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  TestWrapper.displayName = 'TestWrapper';
  return TestWrapper;
}

describe('Report hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useProfitLossReport', () => {
    const mockReport = {
      data: {
        period: { startDate: '2024-01-01', endDate: '2024-12-31' },
        totalRevenue: 10000,
        grossProfit: 5000,
        netProfit: 3000,
        profitMargin: 30,
        platformBreakdown: [],
        monthlyBreakdown: [],
      },
    };

    it('should fetch profit/loss report successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockReport),
      });

      const { result } = renderHook(() => useProfitLossReport(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.totalRevenue).toBe(10000);
      expect(result.current.data?.netProfit).toBe(3000);
    });

    it('should pass date range parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockReport),
      });

      const dateRange = {
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
        preset: 'this_year' as const,
      };

      renderHook(() => useProfitLossReport(dateRange, true), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      expect(fetchUrl).toContain('startDate=2024-01-01');
      expect(fetchUrl).toContain('endDate=2024-12-31');
      expect(fetchUrl).toContain('preset=this_year');
      expect(fetchUrl).toContain('compareWithPrevious=true');
    });

    it('should handle fetch error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const { result } = renderHook(() => useProfitLossReport(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error?.message).toContain('Failed to fetch');
    });
  });

  describe('useInventoryValuationReport', () => {
    const mockReport = {
      data: {
        summary: {
          totalItems: 100,
          totalCostValue: 5000,
          estimatedSaleValue: 8000,
          potentialProfit: 3000,
          potentialMargin: 37.5,
        },
        byCondition: [],
        byStatus: [],
        topValueItems: [],
      },
    };

    it('should fetch inventory valuation report', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockReport),
      });

      const { result } = renderHook(() => useInventoryValuationReport(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.summary.totalItems).toBe(100);
      expect(result.current.data?.summary.potentialProfit).toBe(3000);
    });
  });

  describe('useInventoryAgingReport', () => {
    const mockReport = {
      data: {
        brackets: [],
        totalItems: 50,
        totalValue: 2500,
        averageDaysInStock: 45,
        itemsOver180Days: 5,
        valueOver180Days: 500,
      },
    };

    it('should fetch inventory aging report', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockReport),
      });

      const { result } = renderHook(() => useInventoryAgingReport(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.averageDaysInStock).toBe(45);
      expect(result.current.data?.itemsOver180Days).toBe(5);
    });
  });

  describe('usePlatformPerformanceReport', () => {
    const mockReport = {
      data: {
        period: { startDate: '2024-01-01', endDate: '2024-12-31' },
        platforms: [
          { platform: 'bricklink', orderCount: 50, revenue: 5000 },
          { platform: 'brickowl', orderCount: 30, revenue: 3000 },
        ],
        trends: [],
        totals: { totalOrders: 80, totalRevenue: 8000, totalFees: 400 },
      },
    };

    it('should fetch platform performance report', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockReport),
      });

      const { result } = renderHook(() => usePlatformPerformanceReport(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.platforms).toHaveLength(2);
      expect(result.current.data?.totals.totalRevenue).toBe(8000);
    });

    it('should pass date range parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockReport),
      });

      const dateRange = {
        startDate: new Date('2024-06-01'),
        endDate: new Date('2024-06-30'),
      };

      renderHook(() => usePlatformPerformanceReport(dateRange), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      expect(fetchUrl).toContain('startDate=2024-06-01');
      expect(fetchUrl).toContain('endDate=2024-06-30');
    });
  });

  describe('useSalesTrendsReport', () => {
    const mockReport = {
      data: {
        period: { startDate: '2024-01-01', endDate: '2024-12-31' },
        granularity: 'monthly',
        data: [],
        summary: {
          totalRevenue: 10000,
          totalProfit: 3000,
          totalOrders: 100,
          peakDay: '2024-12-15',
          peakRevenue: 500,
          avgDailyRevenue: 27.4,
        },
      },
    };

    it('should fetch sales trends report with granularity', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockReport),
      });

      renderHook(() => useSalesTrendsReport(undefined, 'monthly'), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      expect(fetchUrl).toContain('granularity=monthly');
    });

    it('should default to daily granularity', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockReport),
      });

      renderHook(() => useSalesTrendsReport(), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      expect(fetchUrl).toContain('granularity=daily');
    });
  });

  describe('usePurchaseAnalysisReport', () => {
    const mockReport = {
      data: {
        period: { startDate: '2024-01-01', endDate: '2024-12-31' },
        summary: {
          totalSpent: 5000,
          itemsAcquired: 100,
          avgCostPerItem: 50,
          itemsSold: 60,
          revenueFromSold: 6000,
          totalProfit: 1000,
          overallROI: 20,
          totalMileage: 500,
          totalMileageCost: 225,
        },
        bySource: [],
        purchases: [],
      },
    };

    it('should fetch purchase analysis report', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockReport),
      });

      const { result } = renderHook(() => usePurchaseAnalysisReport(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.summary.totalSpent).toBe(5000);
      expect(result.current.data?.summary.overallROI).toBe(20);
    });
  });

  describe('useTaxSummaryReport', () => {
    const mockReport = {
      data: {
        financialYear: 2024,
        yearStart: '2024-04-01',
        yearEnd: '2025-03-31',
        summary: {
          totalSalesRevenue: 15000,
          costOfGoodsSold: 5000,
          grossProfit: 10000,
          allowableExpenses: {
            platformFees: 500,
            shippingCosts: 300,
            mileageAllowance: 225,
            otherCosts: 100,
            total: 1125,
          },
          netProfit: 8875,
        },
        quarterlyBreakdown: [],
        mileageLog: [],
        totalMiles: 500,
        totalMileageAllowance: 225,
      },
    };

    it('should fetch tax summary for financial year', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockReport),
      });

      const { result } = renderHook(() => useTaxSummaryReport(2024), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.financialYear).toBe(2024);
      expect(result.current.data?.summary.netProfit).toBe(8875);
    });

    it('should pass financial year parameter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockReport),
      });

      renderHook(() => useTaxSummaryReport(2024), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      expect(fetchUrl).toContain('financialYear=2024');
    });
  });

  describe('useReportSettings', () => {
    const mockSettings = {
      data: {
        financialYearStartMonth: 4,
        defaultCurrency: 'GBP',
        mileageRate: 0.45,
        businessName: 'Hadley Bricks',
        businessAddress: null,
        showPreviousPeriodComparison: true,
      },
    };

    it('should fetch report settings', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSettings),
      });

      const { result } = renderHook(() => useReportSettings(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.defaultCurrency).toBe('GBP');
      expect(result.current.data?.mileageRate).toBe(0.45);
    });
  });

  describe('useUpdateReportSettings', () => {
    it('should update report settings', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      const { result } = renderHook(() => useUpdateReportSettings(), { wrapper: createWrapper() });

      result.current.mutate({ mileageRate: 0.50, businessName: 'New Name' });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockFetch).toHaveBeenCalledWith('/api/reports/settings', expect.objectContaining({
        method: 'PUT',
      }));
    });

    it('should handle update error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const { result } = renderHook(() => useUpdateReportSettings(), { wrapper: createWrapper() });

      result.current.mutate({ mileageRate: 0.50 });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error?.message).toBe('Failed to update settings');
    });
  });

  describe('useExportReport', () => {
    // Note: These tests verify the fetch call is made correctly.
    // Full download behavior requires jsdom environment setup with proper DOM mocking.

    it('should make fetch call with correct parameters', async () => {
      const mockBlob = new Blob(['csv,data'], { type: 'text/csv' });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
        headers: {
          get: () => 'attachment; filename="report.csv"',
        },
      });

      // Mock DOM methods needed for the download
      const originalCreateObjectURL = global.URL.createObjectURL;
      const originalRevokeObjectURL = global.URL.revokeObjectURL;
      global.URL.createObjectURL = vi.fn(() => 'blob:test-url');
      global.URL.revokeObjectURL = vi.fn();

      const mockLink = document.createElement('a');
      vi.spyOn(document, 'createElement').mockReturnValue(mockLink);
      vi.spyOn(document.body, 'appendChild').mockImplementation(() => mockLink);
      vi.spyOn(document.body, 'removeChild').mockImplementation(() => mockLink);
      vi.spyOn(mockLink, 'click').mockImplementation(() => {});

      const { result } = renderHook(() => useExportReport(), { wrapper: createWrapper() });

      result.current.mutate({ reportType: 'profit-loss', format: 'csv' });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockFetch).toHaveBeenCalled();
      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      expect(fetchUrl).toContain('reportType=profit-loss');
      expect(fetchUrl).toContain('format=csv');

      // Cleanup
      global.URL.createObjectURL = originalCreateObjectURL;
      global.URL.revokeObjectURL = originalRevokeObjectURL;
    });

    it('should pass export parameters including date range and financial year', async () => {
      const mockBlob = new Blob(['{}'], { type: 'application/json' });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
        headers: {
          get: () => 'attachment; filename="report.json"',
        },
      });

      // Mock DOM methods
      const originalCreateObjectURL = global.URL.createObjectURL;
      const originalRevokeObjectURL = global.URL.revokeObjectURL;
      global.URL.createObjectURL = vi.fn(() => 'blob:test');
      global.URL.revokeObjectURL = vi.fn();

      const mockLink = document.createElement('a');
      vi.spyOn(document, 'createElement').mockReturnValue(mockLink);
      vi.spyOn(document.body, 'appendChild').mockImplementation(() => mockLink);
      vi.spyOn(document.body, 'removeChild').mockImplementation(() => mockLink);
      vi.spyOn(mockLink, 'click').mockImplementation(() => {});

      const { result } = renderHook(() => useExportReport(), { wrapper: createWrapper() });

      result.current.mutate({
        reportType: 'tax-summary',
        format: 'json',
        financialYear: 2024,
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      expect(fetchUrl).toContain('reportType=tax-summary');
      expect(fetchUrl).toContain('format=json');
      expect(fetchUrl).toContain('financialYear=2024');

      // Cleanup
      global.URL.createObjectURL = originalCreateObjectURL;
      global.URL.revokeObjectURL = originalRevokeObjectURL;
    });

    it('should handle export error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const { result } = renderHook(() => useExportReport(), { wrapper: createWrapper() });

      result.current.mutate({ reportType: 'profit-loss', format: 'csv' });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error?.message).toBe('Failed to export report');
    });
  });
});
