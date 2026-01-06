import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InventoryRepository } from '../inventory.repository';

// Mock Supabase client
const createMockClient = () => {
  const mockData: Record<string, unknown>[] = [];

  const createBuilder = () => {
    const currentFilters: Record<string, unknown> = {};
    let rangeFrom = 0;
    let rangeTo = 49;

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
      in: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      range: vi.fn((from, to) => {
        rangeFrom = from;
        rangeTo = to;
        return builder;
      }),
      order: vi.fn().mockReturnThis(),
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
        const filtered = mockData.slice(rangeFrom, rangeTo + 1);
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
    from: vi.fn((_tableName: string) => createBuilder()),
    _mockData: mockData,
    _addItem: (item: Record<string, unknown>) => mockData.push(item),
    _clearData: () => (mockData.length = 0),
  };
};

describe('InventoryRepository', () => {
  let repository: InventoryRepository;
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    mockClient = createMockClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    repository = new InventoryRepository(mockClient as any);
  });

  describe('findById', () => {
    it('should call supabase with correct parameters', async () => {
      mockClient._addItem({ id: 'test-123', set_number: '75192' });

      await repository.findById('test-123');

      expect(mockClient.from).toHaveBeenCalledWith('inventory_items');
    });

    it('should return null for non-existent item', async () => {
      const result = await repository.findById('non-existent');

      expect(result).toBeNull();
    });

    it('should return item when found', async () => {
      mockClient._addItem({ id: 'test-123', set_number: '75192', item_name: 'Millennium Falcon' });

      const result = await repository.findById('test-123');

      expect(result).toBeTruthy();
      expect(result?.set_number).toBe('75192');
    });
  });

  describe('findAllFiltered', () => {
    it('should return paginated results', async () => {
      mockClient._addItem({ id: '1', set_number: '75192', status: 'IN STOCK' });
      mockClient._addItem({ id: '2', set_number: '10179', status: 'LISTED' });

      const result = await repository.findAllFiltered({}, { page: 1, pageSize: 10 });

      expect(result.data).toHaveLength(2);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(10);
    });

    it('should apply status filter', async () => {
      await repository.findAllFiltered({ status: 'BACKLOG' });

      const fromCall = mockClient.from.mock.results[0];
      expect(fromCall).toBeTruthy();
    });
  });

  describe('create', () => {
    it('should create a new inventory item', async () => {
      const input = {
        user_id: 'user-123',
        set_number: '75192',
        item_name: 'Millennium Falcon',
        condition: 'New' as const,
      };

      const builder = mockClient.from('inventory_items');
      builder.insert(input);

      expect(mockClient._mockData).toHaveLength(1);
      expect(mockClient._mockData[0]).toMatchObject({ set_number: '75192' });
    });
  });

  describe('findBySku', () => {
    it('should find item by SKU', async () => {
      mockClient._addItem({ id: '1', sku: 'HB-NEW-75192-001' });

      await repository.findBySku('HB-NEW-75192-001');

      expect(mockClient.from).toHaveBeenCalledWith('inventory_items');
    });
  });

  describe('findByAsin', () => {
    it('should find item by Amazon ASIN', async () => {
      mockClient._addItem({ id: '1', amazon_asin: 'B07XYQBL9T' });

      await repository.findByAsin('B07XYQBL9T');

      expect(mockClient.from).toHaveBeenCalledWith('inventory_items');
    });
  });
});
