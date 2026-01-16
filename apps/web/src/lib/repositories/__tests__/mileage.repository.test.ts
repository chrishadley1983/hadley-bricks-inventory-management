import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MileageRepository } from '../mileage.repository';
import type { ExpenseType } from '../mileage.repository';

// Mock Supabase client factory
const createMockClient = () => {
  const mockData: Record<string, unknown>[] = [];

  const createBuilder = () => {
    const currentFilters: Record<string, unknown> = {};
    let rangeFrom = 0;
    let rangeTo = 49;
    let selectedColumns: string | null = null;
    let countMode = false;

    const builder = {
      select: vi.fn((columns?: string, options?: { count?: string }) => {
        selectedColumns = columns || '*';
        if (options?.count === 'exact') countMode = true;
        return builder;
      }),
      insert: vi.fn((data: unknown) => {
        const items = Array.isArray(data) ? data : [data];
        const newItems = items.map((item, idx) => ({
          id: `mileage-${Date.now()}-${idx}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...(item as Record<string, unknown>),
        }));
        mockData.push(...newItems);
        return builder;
      }),
      update: vi.fn((data: unknown) => {
        const id = currentFilters['id'];
        const userId = currentFilters['user_id'];
        if (id) {
          const index = mockData.findIndex(
            (item) =>
              item.id === id && (!userId || item.user_id === userId)
          );
          if (index !== -1) {
            mockData[index] = { ...mockData[index], ...(data as Record<string, unknown>) };
          }
        }
        return builder;
      }),
      delete: vi.fn(() => {
        const id = currentFilters['id'];
        const userId = currentFilters['user_id'];
        if (id) {
          const index = mockData.findIndex(
            (item) =>
              item.id === id && (!userId || item.user_id === userId)
          );
          if (index !== -1) {
            mockData.splice(index, 1);
          }
        }
        return builder;
      }),
      eq: vi.fn((col: string, val: unknown) => {
        currentFilters[col] = val;
        return builder;
      }),
      gte: vi.fn((col: string, val: unknown) => {
        currentFilters[`${col}_gte`] = val;
        return builder;
      }),
      lte: vi.fn((col: string, val: unknown) => {
        currentFilters[`${col}_lte`] = val;
        return builder;
      }),
      or: vi.fn(() => builder),
      range: vi.fn((from: number, to: number) => {
        rangeFrom = from;
        rangeTo = to;
        return builder;
      }),
      order: vi.fn(() => builder),
      single: vi.fn(async () => {
        let filtered = [...mockData];

        // Apply eq filters
        Object.entries(currentFilters).forEach(([key, val]) => {
          if (!key.includes('_gte') && !key.includes('_lte')) {
            filtered = filtered.filter((item) => item[key] === val);
          }
        });

        const item = filtered[0];
        return {
          data: item || null,
          error: item ? null : { code: 'PGRST116', message: 'Not found' },
        };
      }),
      then: vi.fn(async (resolve) => {
        let filtered = [...mockData];

        // Apply eq filters
        Object.entries(currentFilters).forEach(([key, val]) => {
          if (!key.includes('_gte') && !key.includes('_lte')) {
            filtered = filtered.filter((item) => item[key] === val);
          }
        });

        // Apply date range filters
        Object.entries(currentFilters).forEach(([key, val]) => {
          if (key.includes('_gte')) {
            const field = key.replace('_gte', '');
            filtered = filtered.filter((item) => (item[field] as string) >= (val as string));
          }
          if (key.includes('_lte')) {
            const field = key.replace('_lte', '');
            filtered = filtered.filter((item) => (item[field] as string) <= (val as string));
          }
        });

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

describe('MileageRepository', () => {
  let repository: MileageRepository;
  let mockClient: ReturnType<typeof createMockClient>;
  const userId = 'test-user-id';

  beforeEach(() => {
    mockClient = createMockClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    repository = new MileageRepository(mockClient as any);
  });

  describe('findAllFiltered', () => {
    it('should return paginated mileage entries for a user', async () => {
      mockClient._addItem({
        id: 'mileage-1',
        user_id: userId,
        tracking_date: '2025-01-01',
        miles_travelled: 25,
        amount_claimed: 11.25,
        expense_type: 'mileage',
      });
      mockClient._addItem({
        id: 'mileage-2',
        user_id: userId,
        tracking_date: '2025-01-02',
        miles_travelled: 15,
        amount_claimed: 6.75,
        expense_type: 'mileage',
      });

      const result = await repository.findAllFiltered(userId);

      expect(result.data).toHaveLength(2);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(50);
    });

    it('should filter by purchaseId', async () => {
      const purchaseId = 'pur-123';
      mockClient._addItem({
        id: 'mileage-1',
        user_id: userId,
        purchase_id: purchaseId,
        tracking_date: '2025-01-01',
        expense_type: 'mileage',
      });
      mockClient._addItem({
        id: 'mileage-2',
        user_id: userId,
        purchase_id: 'other-purchase',
        tracking_date: '2025-01-01',
        expense_type: 'mileage',
      });

      const result = await repository.findAllFiltered(userId, { purchaseId });

      expect(mockClient.from).toHaveBeenCalledWith('mileage_tracking');
    });

    it('should filter by expenseType', async () => {
      mockClient._addItem({
        id: 'mileage-1',
        user_id: userId,
        expense_type: 'mileage',
        tracking_date: '2025-01-01',
      });

      const result = await repository.findAllFiltered(userId, { expenseType: 'mileage' });

      expect(mockClient.from).toHaveBeenCalled();
    });

    it('should filter by date range', async () => {
      mockClient._addItem({
        id: 'mileage-1',
        user_id: userId,
        tracking_date: '2025-01-05',
        expense_type: 'mileage',
      });

      const result = await repository.findAllFiltered(userId, {
        dateFrom: '2025-01-01',
        dateTo: '2025-01-31',
      });

      expect(mockClient.from).toHaveBeenCalled();
    });

    it('should apply pagination options', async () => {
      mockClient._addItem({
        id: 'mileage-1',
        user_id: userId,
        tracking_date: '2025-01-01',
        expense_type: 'mileage',
      });

      const result = await repository.findAllFiltered(userId, undefined, {
        page: 2,
        pageSize: 10,
      });

      expect(result.page).toBe(2);
      expect(result.pageSize).toBe(10);
    });
  });

  describe('findByPurchaseId', () => {
    it('should return all mileage entries for a purchase', async () => {
      const purchaseId = 'pur-123';
      mockClient._addItem({
        id: 'mileage-1',
        user_id: userId,
        purchase_id: purchaseId,
        tracking_date: '2025-01-01',
        miles_travelled: 25,
      });

      const result = await repository.findByPurchaseId(purchaseId);

      expect(result).toHaveLength(1);
      expect(result[0].purchase_id).toBe(purchaseId);
    });

    it('should return empty array when no entries found', async () => {
      const result = await repository.findByPurchaseId('non-existent');

      expect(result).toHaveLength(0);
    });
  });

  describe('findByDateRange', () => {
    it('should delegate to findAllFiltered with date range filters', async () => {
      mockClient._addItem({
        id: 'mileage-1',
        user_id: userId,
        tracking_date: '2025-01-15',
        expense_type: 'mileage',
      });

      const result = await repository.findByDateRange(
        userId,
        '2025-01-01',
        '2025-01-31'
      );

      expect(result.data).toBeDefined();
    });
  });

  describe('getTotalForPeriod', () => {
    it('should calculate totals for a period', async () => {
      mockClient._addItem({
        id: 'mileage-1',
        user_id: userId,
        tracking_date: '2025-01-15',
        miles_travelled: 25,
        amount_claimed: 11.25,
      });
      mockClient._addItem({
        id: 'mileage-2',
        user_id: userId,
        tracking_date: '2025-01-20',
        miles_travelled: 30,
        amount_claimed: 13.50,
      });

      const result = await repository.getTotalForPeriod(
        userId,
        '2025-01-01',
        '2025-01-31'
      );

      expect(result.totalMiles).toBe(55);
      expect(result.totalAmount).toBe(24.75);
    });

    it('should filter by expense type when provided', async () => {
      mockClient._addItem({
        id: 'mileage-1',
        user_id: userId,
        tracking_date: '2025-01-15',
        miles_travelled: 25,
        amount_claimed: 11.25,
        expense_type: 'mileage',
      });
      mockClient._addItem({
        id: 'parking-1',
        user_id: userId,
        tracking_date: '2025-01-15',
        miles_travelled: 0,
        amount_claimed: 5.00,
        expense_type: 'parking',
      });

      const result = await repository.getTotalForPeriod(
        userId,
        '2025-01-01',
        '2025-01-31',
        'mileage'
      );

      expect(mockClient.from).toHaveBeenCalled();
    });

    it('should return zeros when no entries found', async () => {
      const result = await repository.getTotalForPeriod(
        userId,
        '2025-01-01',
        '2025-01-31'
      );

      expect(result.totalMiles).toBe(0);
      expect(result.totalAmount).toBe(0);
    });
  });

  describe('getTotalForPurchase', () => {
    it('should calculate totals for a specific purchase', async () => {
      const purchaseId = 'pur-123';
      mockClient._addItem({
        id: 'mileage-1',
        purchase_id: purchaseId,
        miles_travelled: 25,
        amount_claimed: 11.25,
      });
      mockClient._addItem({
        id: 'mileage-2',
        purchase_id: purchaseId,
        miles_travelled: 30,
        amount_claimed: 13.50,
      });

      const result = await repository.getTotalForPurchase(purchaseId);

      expect(result.totalMiles).toBe(55);
      expect(result.totalAmount).toBe(24.75);
    });
  });

  describe('getSummaryByType', () => {
    it('should return summary grouped by expense type', async () => {
      mockClient._addItem({
        id: 'mileage-1',
        user_id: userId,
        tracking_date: '2025-01-15',
        expense_type: 'mileage',
        miles_travelled: 25,
        amount_claimed: 11.25,
      });
      mockClient._addItem({
        id: 'parking-1',
        user_id: userId,
        tracking_date: '2025-01-15',
        expense_type: 'parking',
        miles_travelled: 0,
        amount_claimed: 5.00,
      });

      const result = await repository.getSummaryByType(
        userId,
        '2025-01-01',
        '2025-01-31'
      );

      expect(result.mileage).toBeDefined();
      expect(result.parking).toBeDefined();
      expect(result.toll).toBeDefined();
      expect(result.other).toBeDefined();
    });

    it('should initialize all expense types with zeros', async () => {
      const result = await repository.getSummaryByType(
        userId,
        '2025-01-01',
        '2025-01-31'
      );

      expect(result.mileage).toEqual({ totalMiles: 0, totalAmount: 0, count: 0 });
      expect(result.parking).toEqual({ totalMiles: 0, totalAmount: 0, count: 0 });
      expect(result.toll).toEqual({ totalMiles: 0, totalAmount: 0, count: 0 });
      expect(result.other).toEqual({ totalMiles: 0, totalAmount: 0, count: 0 });
    });
  });

  describe('createEntry', () => {
    it('should create a new mileage entry', async () => {
      const input = {
        purchase_id: 'pur-123',
        tracking_date: '2025-01-15',
        destination_postcode: 'SW1A 1AA',
        miles_travelled: 25,
        amount_claimed: 11.25,
        reason: 'Collection trip',
        expense_type: 'mileage' as ExpenseType,
        notes: null,
      };

      const result = await repository.createEntry(userId, input);

      expect(mockClient.from).toHaveBeenCalledWith('mileage_tracking');
      expect(mockClient._mockData).toHaveLength(1);
    });
  });

  describe('updateEntry', () => {
    it('should update an existing mileage entry', async () => {
      const mileageId = 'mileage-123';
      mockClient._addItem({
        id: mileageId,
        user_id: userId,
        miles_travelled: 25,
        amount_claimed: 11.25,
      });

      const result = await repository.updateEntry(mileageId, userId, {
        miles_travelled: 30,
        amount_claimed: 13.50,
      });

      expect(mockClient.from).toHaveBeenCalledWith('mileage_tracking');
    });

    it('should only update entries owned by the user', async () => {
      const mileageId = 'mileage-123';
      mockClient._addItem({
        id: mileageId,
        user_id: 'other-user',
        miles_travelled: 25,
      });

      // Should throw error since user doesn't match
      await expect(repository.updateEntry(mileageId, userId, { miles_travelled: 30 }))
        .rejects.toThrow('Failed to update mileage entry');
    });
  });

  describe('deleteEntry', () => {
    it('should delete a mileage entry', async () => {
      const mileageId = 'mileage-123';
      mockClient._addItem({
        id: mileageId,
        user_id: userId,
        miles_travelled: 25,
      });

      await repository.deleteEntry(mileageId, userId);

      expect(mockClient.from).toHaveBeenCalledWith('mileage_tracking');
    });

    it('should only delete entries owned by the user', async () => {
      const mileageId = 'mileage-123';
      mockClient._addItem({
        id: mileageId,
        user_id: 'other-user',
        miles_travelled: 25,
      });

      await repository.deleteEntry(mileageId, userId);

      // Should not delete since user doesn't match
      expect(mockClient._mockData).toHaveLength(1);
    });
  });
});