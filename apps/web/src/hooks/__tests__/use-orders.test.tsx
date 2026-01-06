import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';
import {
  useOrders,
  useOrder,
  useOrderStats,
  useBrickLinkSyncStatus,
  useBrickLinkSync,
  useBrickLinkCredentials,
} from '../use-orders';

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

describe('useOrders hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useOrders', () => {
    it('should fetch orders successfully', async () => {
      const mockOrders = {
        data: [
          { id: 'order-1', platform: 'bricklink', total: 100 },
          { id: 'order-2', platform: 'brickowl', total: 150 },
        ],
        pagination: { page: 1, pageSize: 50, total: 2, totalPages: 1 },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockOrders),
      });

      const { result } = renderHook(() => useOrders(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.data).toHaveLength(2);
      expect(result.current.data?.pagination.total).toBe(2);
    });

    it('should apply filters to query', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [],
            pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 },
          }),
      });

      const filters = {
        platform: 'bricklink',
        status: 'Paid',
        page: 2,
        pageSize: 20,
      };

      renderHook(() => useOrders(filters), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      expect(fetchUrl).toContain('platform=bricklink');
      expect(fetchUrl).toContain('status=Paid');
      expect(fetchUrl).toContain('page=2');
      expect(fetchUrl).toContain('pageSize=20');
    });

    it('should handle fetch error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const { result } = renderHook(() => useOrders(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error?.message).toContain('Failed to fetch orders');
    });

    it('should not include "all" platform filter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [],
            pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 },
          }),
      });

      renderHook(() => useOrders({ platform: 'all' }), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      expect(fetchUrl).not.toContain('platform=');
    });
  });

  describe('useOrder', () => {
    it('should fetch single order', async () => {
      const mockOrder = {
        data: {
          id: 'order-1',
          platform: 'bricklink',
          total: 100,
          items: [{ id: 'item-1', quantity: 1 }],
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockOrder),
      });

      const { result } = renderHook(() => useOrder('order-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.data.id).toBe('order-1');
      expect(result.current.data?.data.items).toHaveLength(1);
    });

    it('should not fetch when id is undefined', async () => {
      const { result } = renderHook(() => useOrder(undefined), {
        wrapper: createWrapper(),
      });

      expect(result.current.isPending).toBe(true);
      expect(result.current.fetchStatus).toBe('idle');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('useOrderStats', () => {
    it('should fetch order statistics', async () => {
      const mockStats = {
        data: {
          totalOrders: 50,
          totalRevenue: 5000,
          ordersByStatus: { Paid: 20, Shipped: 15, Completed: 15 },
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockStats),
      });

      const { result } = renderHook(() => useOrderStats(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.data.totalOrders).toBe(50);
      expect(result.current.data?.data.totalRevenue).toBe(5000);
    });

    it('should filter by platform', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: { totalOrders: 25, totalRevenue: 2500, ordersByStatus: {} },
          }),
      });

      renderHook(() => useOrderStats('bricklink'), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      expect(fetchUrl).toContain('platform=bricklink');
    });
  });

  describe('useBrickLinkSyncStatus', () => {
    it('should fetch sync status', async () => {
      const mockStatus = {
        data: {
          isConfigured: true,
          totalOrders: 100,
          lastSyncedAt: '2024-12-20T10:00:00Z',
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockStatus),
      });

      const { result } = renderHook(() => useBrickLinkSyncStatus(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.data.isConfigured).toBe(true);
      expect(result.current.data?.data.totalOrders).toBe(100);
    });
  });

  describe('useBrickLinkSync', () => {
    it('should trigger sync successfully', async () => {
      const mockResponse = {
        success: true,
        data: {
          ordersProcessed: 10,
          ordersCreated: 5,
          ordersUpdated: 5,
          errors: [],
          lastSyncedAt: '2024-12-20T11:00:00Z',
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const { result } = renderHook(() => useBrickLinkSync(), {
        wrapper: createWrapper(),
      });

      result.current.mutate({});

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.success).toBe(true);
      expect(result.current.data?.data.ordersProcessed).toBe(10);
    });

    it('should pass sync options', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            data: { ordersProcessed: 0, ordersCreated: 0, ordersUpdated: 0, errors: [] },
          }),
      });

      const { result } = renderHook(() => useBrickLinkSync(), {
        wrapper: createWrapper(),
      });

      result.current.mutate({ includeFiled: true, includeItems: true });

      await waitFor(() => expect(mockFetch).toHaveBeenCalled());

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.includeFiled).toBe(true);
      expect(body.includeItems).toBe(true);
    });
  });

  describe('useBrickLinkCredentials', () => {
    it('should check credentials status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ configured: true }),
      });

      const { result } = renderHook(() => useBrickLinkCredentials(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.configured).toBe(true);
    });

    it('should handle not configured', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ configured: false }),
      });

      const { result } = renderHook(() => useBrickLinkCredentials(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.configured).toBe(false);
    });
  });
});
