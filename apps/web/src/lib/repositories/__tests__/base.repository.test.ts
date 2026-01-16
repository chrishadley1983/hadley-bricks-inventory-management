import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BaseRepository, PaginationOptions, PaginatedResult } from '../base.repository';

// Concrete implementation for testing
class TestRepository extends BaseRepository<
  { id: string; name: string; created_at: string },
  { name: string },
  { name?: string }
> {
  constructor(supabase: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    super(supabase as any, 'test_table' as any);
  }
}

// Mock Supabase client factory
const createMockClient = () => {
  const mockData: Record<string, unknown>[] = [];

  const createBuilder = () => {
    const currentFilters: Record<string, unknown> = {};
    let rangeFrom = 0;
    let rangeTo = 49;
    let countMode = false;
    let headOnly = false;

    const builder = {
      select: vi.fn((columns?: string, options?: { count?: string; head?: boolean }) => {
        if (options?.count === 'exact') countMode = true;
        if (options?.head) headOnly = true;
        return builder;
      }),
      insert: vi.fn((data: unknown) => {
        const items = Array.isArray(data) ? data : [data];
        const newItems = items.map((item, idx) => ({
          id: `test-${Date.now()}-${idx}`,
          created_at: new Date().toISOString(),
          ...(item as Record<string, unknown>),
        }));
        mockData.push(...newItems);
        return builder;
      }),
      update: vi.fn((data: unknown) => {
        // Store the update data to apply when eq is called
        (builder as Record<string, unknown>)._pendingUpdate = data;
        return builder;
      }),
      delete: vi.fn(() => {
        // Return a builder-like object that handles eq chaining
        return {
          eq: vi.fn((col: string, val: unknown) => {
            if (col === 'id') {
              const index = mockData.findIndex((item) => item.id === val);
              if (index !== -1) {
                mockData.splice(index, 1);
              }
            }
            return Promise.resolve({ error: null });
          }),
        };
      }),
      eq: vi.fn((col: string, val: unknown) => {
        currentFilters[col] = val;
        // Check if there's a pending update to apply
        const pendingUpdate = (builder as Record<string, unknown>)._pendingUpdate;
        if (pendingUpdate && col === 'id') {
          const item = mockData.find((d) => d.id === val);
          if (item) {
            Object.assign(item, pendingUpdate);
          }
          // Clear pending update after applying
          (builder as Record<string, unknown>)._pendingUpdate = null;
        }
        return builder;
      }),
      range: vi.fn((from: number, to: number) => {
        rangeFrom = from;
        rangeTo = to;
        return builder;
      }),
      order: vi.fn(() => builder),
      single: vi.fn(async () => {
        let filtered = [...mockData];

        Object.entries(currentFilters).forEach(([key, val]) => {
          filtered = filtered.filter((item) => item[key] === val);
        });

        const item = filtered[0];
        return {
          data: item || null,
          error: item ? null : { code: 'PGRST116', message: 'Not found' },
        };
      }),
      then: vi.fn(async (resolve) => {
        let filtered = [...mockData];

        Object.entries(currentFilters).forEach(([key, val]) => {
          filtered = filtered.filter((item) => item[key] === val);
        });

        if (headOnly) {
          const result = { data: null, count: filtered.length, error: null };
          resolve(result);
          return result;
        }

        const paginated = filtered.slice(rangeFrom, rangeTo + 1);
        const result = {
          data: paginated,
          count: countMode ? filtered.length : null,
          error: null,
        };
        resolve(result);
        return result;
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

describe('BaseRepository', () => {
  let repository: TestRepository;
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    mockClient = createMockClient();
    repository = new TestRepository(mockClient);
  });

  describe('findById', () => {
    it('should find a record by ID', async () => {
      mockClient._addItem({
        id: 'item-123',
        name: 'Test Item',
        created_at: '2025-01-01T00:00:00Z',
      });

      const result = await repository.findById('item-123');

      expect(result).toBeTruthy();
      expect(result?.id).toBe('item-123');
      expect(result?.name).toBe('Test Item');
    });

    it('should return null when record not found', async () => {
      const result = await repository.findById('non-existent');

      expect(result).toBeNull();
    });

    it('should call supabase with correct table name', async () => {
      await repository.findById('item-123');

      expect(mockClient.from).toHaveBeenCalledWith('test_table');
    });
  });

  describe('findAll', () => {
    it('should return paginated results with default options', async () => {
      mockClient._addItem({ id: '1', name: 'Item 1', created_at: '2025-01-01T00:00:00Z' });
      mockClient._addItem({ id: '2', name: 'Item 2', created_at: '2025-01-02T00:00:00Z' });
      mockClient._addItem({ id: '3', name: 'Item 3', created_at: '2025-01-03T00:00:00Z' });

      const result = await repository.findAll();

      expect(result.data).toHaveLength(3);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(50);
    });

    it('should apply custom pagination options', async () => {
      for (let i = 1; i <= 25; i++) {
        mockClient._addItem({ id: `${i}`, name: `Item ${i}`, created_at: '2025-01-01T00:00:00Z' });
      }

      const result = await repository.findAll({ page: 2, pageSize: 10 });

      expect(result.page).toBe(2);
      expect(result.pageSize).toBe(10);
    });

    it('should calculate totalPages correctly', async () => {
      for (let i = 1; i <= 25; i++) {
        mockClient._addItem({ id: `${i}`, name: `Item ${i}`, created_at: '2025-01-01T00:00:00Z' });
      }

      const result = await repository.findAll({ pageSize: 10 });

      expect(result.totalPages).toBe(3); // 25 items / 10 per page = 3 pages
    });

    it('should return empty array when no records exist', async () => {
      const result = await repository.findAll();

      expect(result.data).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('create', () => {
    it('should create a new record', async () => {
      const input = { name: 'New Item' };

      const result = await repository.create(input);

      expect(result).toBeTruthy();
      expect(result.name).toBe('New Item');
      expect(result.id).toBeDefined();
    });

    it('should auto-generate id and created_at', async () => {
      const input = { name: 'New Item' };

      await repository.create(input);

      expect(mockClient._mockData).toHaveLength(1);
      expect(mockClient._mockData[0].id).toBeDefined();
      expect(mockClient._mockData[0].created_at).toBeDefined();
    });
  });

  describe('update', () => {
    it('should update an existing record', async () => {
      mockClient._addItem({
        id: 'item-123',
        name: 'Original Name',
        created_at: '2025-01-01T00:00:00Z',
      });

      await repository.update('item-123', { name: 'Updated Name' });

      const updatedItem = mockClient._mockData.find((d) => d.id === 'item-123');
      expect(updatedItem?.name).toBe('Updated Name');
    });

    it('should call supabase with correct parameters', async () => {
      mockClient._addItem({
        id: 'item-123',
        name: 'Original Name',
        created_at: '2025-01-01T00:00:00Z',
      });

      await repository.update('item-123', { name: 'Updated Name' });

      expect(mockClient.from).toHaveBeenCalledWith('test_table');
    });
  });

  describe('delete', () => {
    it('should delete a record by ID', async () => {
      mockClient._addItem({
        id: 'item-123',
        name: 'To Delete',
        created_at: '2025-01-01T00:00:00Z',
      });

      await repository.delete('item-123');

      expect(mockClient._mockData).toHaveLength(0);
    });

    it('should not affect other records', async () => {
      mockClient._addItem({ id: 'item-1', name: 'Item 1', created_at: '2025-01-01T00:00:00Z' });
      mockClient._addItem({ id: 'item-2', name: 'Item 2', created_at: '2025-01-01T00:00:00Z' });

      await repository.delete('item-1');

      expect(mockClient._mockData).toHaveLength(1);
      expect(mockClient._mockData[0].id).toBe('item-2');
    });
  });

  describe('exists', () => {
    it('should return true when record exists', async () => {
      mockClient._addItem({
        id: 'item-123',
        name: 'Existing Item',
        created_at: '2025-01-01T00:00:00Z',
      });

      const result = await repository.exists('item-123');

      expect(result).toBe(true);
    });

    it('should return false when record does not exist', async () => {
      const result = await repository.exists('non-existent');

      expect(result).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should handle database errors gracefully', async () => {
      const errorClient = {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn(() =>
            Promise.resolve({
              data: null,
              error: { code: 'PGRST500', message: 'Database error' },
            })
          ),
        })),
      };

      const errorRepo = new TestRepository(errorClient);

      await expect(errorRepo.findById('item-123')).rejects.toThrow(
        'Failed to find test_table by id'
      );
    });
  });

  describe('pagination edge cases', () => {
    it('should handle page 1 correctly', async () => {
      mockClient._addItem({ id: '1', name: 'Item 1', created_at: '2025-01-01T00:00:00Z' });

      const result = await repository.findAll({ page: 1, pageSize: 10 });

      expect(result.page).toBe(1);
    });

    it('should handle empty page beyond data range', async () => {
      mockClient._addItem({ id: '1', name: 'Item 1', created_at: '2025-01-01T00:00:00Z' });

      const result = await repository.findAll({ page: 100, pageSize: 10 });

      expect(result.data).toHaveLength(0);
      expect(result.page).toBe(100);
    });

    it('should handle pageSize of 1', async () => {
      mockClient._addItem({ id: '1', name: 'Item 1', created_at: '2025-01-01T00:00:00Z' });
      mockClient._addItem({ id: '2', name: 'Item 2', created_at: '2025-01-02T00:00:00Z' });

      const result = await repository.findAll({ page: 1, pageSize: 1 });

      expect(result.data).toHaveLength(1);
      expect(result.totalPages).toBe(2);
    });
  });
});
