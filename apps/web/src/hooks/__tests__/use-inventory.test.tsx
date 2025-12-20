import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  useInventoryList,
  useInventoryItem,
  useInventorySummary,
  useCreateInventory,
  inventoryKeys,
} from '../use-inventory';

// Mock the API functions
vi.mock('@/lib/api', () => ({
  fetchInventory: vi.fn(),
  fetchInventoryItem: vi.fn(),
  fetchInventorySummary: vi.fn(),
  createInventoryItem: vi.fn(),
  updateInventoryItem: vi.fn(),
  deleteInventoryItem: vi.fn(),
}));

import {
  fetchInventory,
  fetchInventoryItem,
  fetchInventorySummary,
  createInventoryItem,
} from '@/lib/api';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('inventoryKeys', () => {
  it('generates correct query keys', () => {
    expect(inventoryKeys.all).toEqual(['inventory']);
    expect(inventoryKeys.lists()).toEqual(['inventory', 'list']);
    expect(inventoryKeys.list({ status: 'IN STOCK' })).toEqual([
      'inventory',
      'list',
      { filters: { status: 'IN STOCK' }, pagination: undefined },
    ]);
    expect(inventoryKeys.details()).toEqual(['inventory', 'detail']);
    expect(inventoryKeys.detail('123')).toEqual(['inventory', 'detail', '123']);
    expect(inventoryKeys.summary()).toEqual(['inventory', 'summary']);
  });
});

describe('useInventoryList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches inventory list', async () => {
    const mockData = {
      data: [
        {
          id: '1',
          user_id: 'user-1',
          set_number: '75192',
          item_name: 'Millennium Falcon',
          condition: 'New' as const,
          status: 'IN STOCK',
          source: 'LEGO Store',
          purchase_date: '2024-01-01',
          cost: 650,
          listing_date: null,
          listing_value: null,
          storage_location: 'Shelf A',
          sku: 'HB-NEW-75192',
          linked_lot: null,
          amazon_asin: null,
          listing_platform: null,
          notes: null,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    };

    vi.mocked(fetchInventory).mockResolvedValue(mockData);

    const { result } = renderHook(() => useInventoryList(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(mockData);
    expect(fetchInventory).toHaveBeenCalledWith(undefined, undefined);
  });

  it('passes filters to API', async () => {
    vi.mocked(fetchInventory).mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 0,
    });

    const filters = { status: 'IN STOCK', condition: 'New' };
    const pagination = { page: 2, pageSize: 10 };

    const { result } = renderHook(() => useInventoryList(filters, pagination), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchInventory).toHaveBeenCalledWith(filters, pagination);
  });
});

describe('useInventoryItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches single inventory item', async () => {
    const mockItem = {
      id: '123',
      user_id: 'user-1',
      set_number: '75192',
      item_name: 'Millennium Falcon',
      condition: 'New' as const,
      status: 'IN STOCK',
      source: 'LEGO Store',
      purchase_date: '2024-01-01',
      cost: 650,
      listing_date: null,
      listing_value: null,
      storage_location: 'Shelf A',
      sku: 'HB-NEW-75192',
      linked_lot: null,
      amazon_asin: null,
      listing_platform: null,
      notes: null,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    };
    vi.mocked(fetchInventoryItem).mockResolvedValue(mockItem);

    const { result } = renderHook(() => useInventoryItem('123'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(mockItem);
    expect(fetchInventoryItem).toHaveBeenCalledWith('123');
  });

  it('does not fetch when id is undefined', () => {
    const { result } = renderHook(() => useInventoryItem(undefined), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(fetchInventoryItem).not.toHaveBeenCalled();
  });
});

describe('useInventorySummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches inventory summary', async () => {
    const mockSummary = {
      totalItems: 100,
      byStatus: { 'IN STOCK': 50, LISTED: 30, SOLD: 20 },
      totalCost: 5000,
      totalListingValue: 7500,
    };

    vi.mocked(fetchInventorySummary).mockResolvedValue(mockSummary);

    const { result } = renderHook(() => useInventorySummary(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(mockSummary);
  });
});

describe('useCreateInventory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates inventory item', async () => {
    const newItem = { set_number: '75192', item_name: 'Millennium Falcon' };
    const createdItem = {
      id: '123',
      user_id: 'user-1',
      set_number: '75192',
      item_name: 'Millennium Falcon',
      condition: 'New' as const,
      status: 'IN STOCK',
      source: null,
      purchase_date: null,
      cost: null,
      listing_date: null,
      listing_value: null,
      storage_location: null,
      sku: 'HB-NEW-75192',
      linked_lot: null,
      amazon_asin: null,
      listing_platform: null,
      notes: null,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    };

    vi.mocked(createInventoryItem).mockResolvedValue(createdItem);

    const { result } = renderHook(() => useCreateInventory(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync(newItem);

    expect(createInventoryItem).toHaveBeenCalledWith(newItem);
  });
});
