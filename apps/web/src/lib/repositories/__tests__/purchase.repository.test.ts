import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PurchaseRepository } from '../purchase.repository';

// Mock Supabase client
const createMockClient = () => {
  const mockData: Record<string, unknown>[] = [];

  const createBuilder = () => {
    const currentFilters: Record<string, unknown> = {};
    let rangeFrom = 0;
    let rangeTo = 49;
    let limitCount: number | null = null;

    const builder = {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn((data) => {
        const items = Array.isArray(data) ? data : [data];
        const newItems = items.map((item, idx) => ({
          id: `test-${Date.now()}-${idx}`,
          created_at: new Date().toISOString(),
          ...item,
        }));
        mockData.push(...newItems);
        return builder;
      }),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn((col, val) => {
        currentFilters[col] = val;
        return builder;
      }),
      gte: vi.fn((col, val) => {
        currentFilters[`${col}_gte`] = val;
        return builder;
      }),
      lte: vi.fn((col, val) => {
        currentFilters[`${col}_lte`] = val;
        return builder;
      }),
      or: vi.fn().mockReturnThis(),
      range: vi.fn((from, to) => {
        rangeFrom = from;
        rangeTo = to;
        return builder;
      }),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn((count) => {
        limitCount = count;
        return builder;
      }),
      single: vi.fn(() => {
        const item = mockData.find((d: Record<string, unknown>) => {
          if (currentFilters['id']) return d.id === currentFilters['id'];
          return true;
        });
        return Promise.resolve({
          data: item || null,
          error: item ? null : { code: 'PGRST116', message: 'Not found' },
        });
      }),
      then: vi.fn((resolve) => {
        let filtered = [...mockData];
        if (limitCount) {
          filtered = filtered.slice(0, limitCount);
        } else {
          filtered = filtered.slice(rangeFrom, rangeTo + 1);
        }
        const result = {
          data: filtered,
          count: mockData.length,
          error: null,
        };
        resolve(result);
        return Promise.resolve(result);
      }),
    };

    return builder;
  };

  return {
    from: vi.fn(() => createBuilder()),
    _mockData: mockData,
    _addItem: (item: Record<string, unknown>) => mockData.push(item),
    _clearData: () => (mockData.length = 0),
  };
};

describe('PurchaseRepository', () => {
  let repository: PurchaseRepository;
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    mockClient = createMockClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    repository = new PurchaseRepository(mockClient as any);
  });

  describe('findById', () => {
    it('should call supabase with correct parameters', async () => {
      mockClient._addItem({ id: 'test-123', short_description: 'Test purchase' });

      await repository.findById('test-123');

      expect(mockClient.from).toHaveBeenCalledWith('purchases');
    });

    it('should return null for non-existent purchase', async () => {
      const result = await repository.findById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('findAllFiltered', () => {
    it('should return paginated results', async () => {
      mockClient._addItem({ id: '1', short_description: 'Purchase 1', cost: 100 });
      mockClient._addItem({ id: '2', short_description: 'Purchase 2', cost: 200 });

      const result = await repository.findAllFiltered({}, { page: 1, pageSize: 10 });

      expect(result.data).toHaveLength(2);
      expect(result.page).toBe(1);
    });

    it('should apply source filter', async () => {
      await repository.findAllFiltered({ source: 'eBay' });

      expect(mockClient.from).toHaveBeenCalledWith('purchases');
    });

    it('should apply date range filters', async () => {
      await repository.findAllFiltered({ dateFrom: '2024-01-01', dateTo: '2024-12-31' });

      const builder = mockClient.from.mock.results[0].value;
      expect(builder.gte).toHaveBeenCalled();
      expect(builder.lte).toHaveBeenCalled();
    });
  });

  describe('getRecent', () => {
    it('should return limited results', async () => {
      mockClient._addItem({ id: '1', short_description: 'Purchase 1' });
      mockClient._addItem({ id: '2', short_description: 'Purchase 2' });
      mockClient._addItem({ id: '3', short_description: 'Purchase 3' });

      const result = await repository.getRecent(2);

      expect(result).toHaveLength(2);
    });
  });

  describe('getMonthlyTotal', () => {
    it('should calculate total for month', async () => {
      mockClient._addItem({
        id: '1',
        cost: 100,
        purchase_date: '2024-06-15',
      });
      mockClient._addItem({
        id: '2',
        cost: 200,
        purchase_date: '2024-06-20',
      });

      const total = await repository.getMonthlyTotal(2024, 6);

      // Mock returns all data, so we expect sum of both
      expect(total).toBe(300);
    });
  });

  describe('getTotalsBySource', () => {
    it('should group totals by source', async () => {
      mockClient._addItem({ id: '1', source: 'eBay', cost: 100 });
      mockClient._addItem({ id: '2', source: 'eBay', cost: 150 });
      mockClient._addItem({ id: '3', source: 'Amazon', cost: 200 });

      const totals = await repository.getTotalsBySource();

      expect(totals['eBay']).toBe(250);
      expect(totals['Amazon']).toBe(200);
    });
  });
});
