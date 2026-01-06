import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';
import {
  purchaseKeys,
  usePurchaseList,
  usePurchase,
  useCreatePurchase,
  useUpdatePurchase,
  useDeletePurchase,
  useParsePurchase,
  useCalculateMileage,
} from '../use-purchases';

// Mock the API functions
vi.mock('@/lib/api', () => ({
  fetchPurchases: vi.fn(),
  fetchPurchase: vi.fn(),
  createPurchase: vi.fn(),
  updatePurchase: vi.fn(),
  deletePurchase: vi.fn(),
  parsePurchase: vi.fn(),
  calculateMileage: vi.fn(),
}));

import {
  fetchPurchases,
  fetchPurchase,
  createPurchase,
  updatePurchase,
  deletePurchase,
  parsePurchase,
  calculateMileage,
} from '@/lib/api';

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

describe('Purchase hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('purchaseKeys', () => {
    it('should generate correct all key', () => {
      expect(purchaseKeys.all).toEqual(['purchases']);
    });

    it('should generate correct lists key', () => {
      expect(purchaseKeys.lists()).toEqual(['purchases', 'list']);
    });

    it('should generate correct list key with filters', () => {
      const filters = { source: 'eBay' };
      const pagination = { page: 1, pageSize: 20 };
      expect(purchaseKeys.list(filters, pagination)).toEqual([
        'purchases',
        'list',
        { filters, pagination },
      ]);
    });

    it('should generate correct details key', () => {
      expect(purchaseKeys.details()).toEqual(['purchases', 'detail']);
    });

    it('should generate correct detail key', () => {
      expect(purchaseKeys.detail('purchase-123')).toEqual(['purchases', 'detail', 'purchase-123']);
    });
  });

  describe('usePurchaseList', () => {
    const mockPurchases = {
      data: [
        {
          id: 'p-1',
          user_id: 'user-1',
          short_description: 'eBay Haul',
          cost: 100,
          purchase_date: '2024-12-20',
          created_at: '2024-12-20T10:00:00Z',
          updated_at: '2024-12-20T10:00:00Z',
          description: null,
          image_url: null,
          payment_method: null,
          reference: null,
          sheets_id: null,
          sheets_synced_at: null,
          source: null,
        },
        {
          id: 'p-2',
          user_id: 'user-1',
          short_description: 'Car Boot Sale',
          cost: 50,
          purchase_date: '2024-12-19',
          created_at: '2024-12-19T10:00:00Z',
          updated_at: '2024-12-19T10:00:00Z',
          description: null,
          image_url: null,
          payment_method: null,
          reference: null,
          sheets_id: null,
          sheets_synced_at: null,
          source: null,
        },
      ],
      total: 2,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    };

    it('should fetch purchases successfully', async () => {
      vi.mocked(fetchPurchases).mockResolvedValue(mockPurchases);

      const { result } = renderHook(() => usePurchaseList(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual(mockPurchases);
      expect(fetchPurchases).toHaveBeenCalledWith(undefined, undefined);
    });

    it('should pass filters and pagination', async () => {
      vi.mocked(fetchPurchases).mockResolvedValue(mockPurchases);

      const filters = { source: 'eBay' };
      const pagination = { page: 2, pageSize: 20 };

      renderHook(() => usePurchaseList(filters, pagination), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(fetchPurchases).toHaveBeenCalledWith(filters, pagination);
      });
    });

    it('should handle fetch error', async () => {
      vi.mocked(fetchPurchases).mockRejectedValue(new Error('Fetch failed'));

      const { result } = renderHook(() => usePurchaseList(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error?.message).toBe('Fetch failed');
    });
  });

  describe('usePurchase', () => {
    const mockPurchase = {
      id: 'purchase-1',
      user_id: 'user-1',
      short_description: 'Test Purchase',
      cost: 150,
      source: 'LEGO Store',
      purchase_date: '2024-12-20',
      created_at: '2024-12-20T10:00:00Z',
      updated_at: '2024-12-20T10:00:00Z',
      description: null,
      image_url: null,
      payment_method: null,
      reference: null,
      sheets_id: null,
      sheets_synced_at: null,
    };

    it('should fetch single purchase', async () => {
      vi.mocked(fetchPurchase).mockResolvedValue(mockPurchase);

      const { result } = renderHook(() => usePurchase('purchase-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual(mockPurchase);
      expect(fetchPurchase).toHaveBeenCalledWith('purchase-1');
    });

    it('should not fetch when id is undefined', async () => {
      const { result } = renderHook(() => usePurchase(undefined), {
        wrapper: createWrapper(),
      });

      expect(result.current.isPending).toBe(true);
      expect(result.current.fetchStatus).toBe('idle');
      expect(fetchPurchase).not.toHaveBeenCalled();
    });
  });

  describe('useCreatePurchase', () => {
    it('should create purchase successfully', async () => {
      const newPurchase = {
        purchase_date: '2024-12-20',
        short_description: 'New Purchase',
        cost: 200,
      };
      const createdPurchase = {
        ...newPurchase,
        id: 'new-id',
        user_id: 'user-1',
        created_at: '2024-12-20T10:00:00Z',
        updated_at: '2024-12-20T10:00:00Z',
        description: null,
        image_url: null,
        payment_method: null,
        reference: null,
        sheets_id: null,
        sheets_synced_at: null,
        source: null,
      };

      vi.mocked(createPurchase).mockResolvedValue(createdPurchase);

      const { result } = renderHook(() => useCreatePurchase(), { wrapper: createWrapper() });

      result.current.mutate(newPurchase);

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual(createdPurchase);
      expect(createPurchase).toHaveBeenCalledWith(newPurchase);
    });

    it('should handle create error', async () => {
      vi.mocked(createPurchase).mockRejectedValue(new Error('Create failed'));

      const { result } = renderHook(() => useCreatePurchase(), { wrapper: createWrapper() });

      result.current.mutate({
        purchase_date: '2024-12-20',
        short_description: 'Test',
        cost: 100,
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error?.message).toBe('Create failed');
    });
  });

  describe('useUpdatePurchase', () => {
    it('should update purchase successfully', async () => {
      const updatedPurchase = {
        id: 'purchase-1',
        user_id: 'user-1',
        short_description: 'Updated Purchase',
        cost: 300,
        purchase_date: '2024-12-20',
        created_at: '2024-12-20T10:00:00Z',
        updated_at: '2024-12-20T12:00:00Z',
        description: null,
        image_url: null,
        payment_method: null,
        reference: null,
        sheets_id: null,
        sheets_synced_at: null,
        source: null,
      };

      vi.mocked(updatePurchase).mockResolvedValue(updatedPurchase);

      const { result } = renderHook(() => useUpdatePurchase(), { wrapper: createWrapper() });

      result.current.mutate({
        id: 'purchase-1',
        data: { short_description: 'Updated Purchase', cost: 300 },
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual(updatedPurchase);
      expect(updatePurchase).toHaveBeenCalledWith('purchase-1', {
        short_description: 'Updated Purchase',
        cost: 300,
      });
    });
  });

  describe('useDeletePurchase', () => {
    it('should delete purchase successfully', async () => {
      vi.mocked(deletePurchase).mockResolvedValue(undefined);

      const { result } = renderHook(() => useDeletePurchase(), { wrapper: createWrapper() });

      result.current.mutate('purchase-1');

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(deletePurchase).toHaveBeenCalledWith('purchase-1');
    });
  });

  describe('useParsePurchase', () => {
    it('should parse purchase from natural language', async () => {
      const parsedResult = {
        purchase_date: '2024-12-20',
        short_description: 'LEGO Star Wars Set',
        cost: 149.99,
        source: 'LEGO Store',
        items: [{ set_number: '75192', quantity: 1 }],
        confidence: 0.95,
      };

      vi.mocked(parsePurchase).mockResolvedValue(parsedResult);

      const { result } = renderHook(() => useParsePurchase(), { wrapper: createWrapper() });

      result.current.mutate('Bought LEGO Millennium Falcon from LEGO Store for £149.99');

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual(parsedResult);
      expect(parsePurchase).toHaveBeenCalledWith(
        'Bought LEGO Millennium Falcon from LEGO Store for £149.99'
      );
    });

    it('should handle parse error', async () => {
      vi.mocked(parsePurchase).mockRejectedValue(new Error('Could not parse'));

      const { result } = renderHook(() => useParsePurchase(), { wrapper: createWrapper() });

      result.current.mutate('Invalid text');

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error?.message).toBe('Could not parse');
    });
  });

  describe('useCalculateMileage', () => {
    it('should calculate mileage between postcodes', async () => {
      const mileageResult = {
        distance: 25.5,
        roundTrip: 51.0,
      };

      vi.mocked(calculateMileage).mockResolvedValue(mileageResult);

      const { result } = renderHook(() => useCalculateMileage(), { wrapper: createWrapper() });

      result.current.mutate({ fromPostcode: 'SW1A 1AA', toPostcode: 'EC1A 1BB' });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual(mileageResult);
      expect(calculateMileage).toHaveBeenCalledWith('SW1A 1AA', 'EC1A 1BB');
    });

    it('should handle mileage calculation error', async () => {
      vi.mocked(calculateMileage).mockRejectedValue(new Error('Invalid postcode'));

      const { result } = renderHook(() => useCalculateMileage(), { wrapper: createWrapper() });

      result.current.mutate({ fromPostcode: 'INVALID', toPostcode: 'INVALID' });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error?.message).toBe('Invalid postcode');
    });
  });
});
