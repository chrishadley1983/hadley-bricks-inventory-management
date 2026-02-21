import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InventoryService } from '../inventory.service';
import { testInventoryItems } from '@/test/fixtures';
import type { InventoryStatus } from '@hadley-bricks/database';

// Mock the repository
const mockInventoryRepo = {
  findById: vi.fn(),
  findAllFiltered: vi.fn(),
  create: vi.fn(),
  createMany: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  updateStatusBulk: vi.fn(),
  findByStatus: vi.fn(),
  getCountByStatus: vi.fn(),
  getTotalValue: vi.fn(),
  getValueByStatus: vi.fn(),
  findBySku: vi.fn(),
  findByAsin: vi.fn(),
  findByLinkedLot: vi.fn(),
};

vi.mock('../../repositories', () => ({
  InventoryRepository: function MockInventoryRepository() {
    return mockInventoryRepo;
  },
}));

describe('InventoryService', () => {
  let service: InventoryService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockSupabase: any = {};
  const userId = 'test-user-id';

  beforeEach(() => {
    vi.clearAllMocks();
    service = new InventoryService(mockSupabase, userId);
  });

  describe('getById', () => {
    it('should return inventory item by ID', async () => {
      const item = testInventoryItems.newMillenniumFalcon;
      mockInventoryRepo.findById.mockResolvedValue(item);

      const result = await service.getById(item.id);

      expect(result).toEqual(item);
      expect(mockInventoryRepo.findById).toHaveBeenCalledWith(item.id);
    });

    it('should return null when not found', async () => {
      mockInventoryRepo.findById.mockResolvedValue(null);

      const result = await service.getById('invalid-id');

      expect(result).toBeNull();
    });
  });

  describe('getAll', () => {
    it('should return all items with pagination', async () => {
      const items = Object.values(testInventoryItems);
      mockInventoryRepo.findAllFiltered.mockResolvedValue({
        data: items,
        total: items.length,
        page: 1,
        pageSize: 50,
        totalPages: 1,
      });

      const result = await service.getAll();

      expect(result.data).toEqual(items);
      expect(result.total).toBe(items.length);
    });

    it('should apply filters', async () => {
      mockInventoryRepo.findAllFiltered.mockResolvedValue({
        data: [testInventoryItems.newMillenniumFalcon],
        total: 1,
        page: 1,
        pageSize: 50,
        totalPages: 1,
      });

      const filters = { status: 'IN STOCK' as InventoryStatus, condition: 'New' as const };
      await service.getAll(filters);

      expect(mockInventoryRepo.findAllFiltered).toHaveBeenCalledWith(filters, undefined);
    });

    it('should apply pagination options', async () => {
      mockInventoryRepo.findAllFiltered.mockResolvedValue({
        data: [],
        total: 100,
        page: 2,
        pageSize: 20,
        totalPages: 5,
      });

      const pagination = { page: 2, pageSize: 20 };
      await service.getAll(undefined, pagination);

      expect(mockInventoryRepo.findAllFiltered).toHaveBeenCalledWith(undefined, pagination);
    });
  });

  describe('create', () => {
    it('should create item with user ID', async () => {
      const input = {
        set_number: '75192',
        item_name: 'Millennium Falcon',
        condition: 'New' as const,
        status: 'IN STOCK' as InventoryStatus,
        purchase_cost: 649.99,
      };

      const createdItem = {
        id: 'new-id',
        user_id: userId,
        ...input,
        sku: 'HB-NEW-75192-ABC123',
        created_at: '2024-12-20T10:00:00Z',
        updated_at: '2024-12-20T10:00:00Z',
      };

      mockInventoryRepo.create.mockResolvedValue(createdItem);

      const result = await service.create(input);

      expect(result).toEqual(createdItem);
      expect(mockInventoryRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ...input,
          user_id: userId,
          sku: expect.any(String),
        })
      );
    });

    it('should generate SKU for new items', async () => {
      const input = {
        set_number: '75192',
        item_name: 'Millennium Falcon',
        condition: 'New' as const,
      };

      mockInventoryRepo.create.mockImplementation((data) =>
        Promise.resolve({ id: 'new-id', ...data })
      );

      await service.create(input);

      expect(mockInventoryRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          sku: expect.stringMatching(/^HB-NEW-75192-/),
        })
      );
    });

    it('should generate different SKU prefix for used items', async () => {
      const input = {
        set_number: '76139',
        item_name: 'Batmobile',
        condition: 'Used' as const,
      };

      mockInventoryRepo.create.mockImplementation((data) =>
        Promise.resolve({ id: 'new-id', ...data })
      );

      await service.create(input);

      expect(mockInventoryRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          sku: expect.stringMatching(/^HB-USED-76139-/),
        })
      );
    });

    it('should use provided SKU if given', async () => {
      const input = {
        set_number: '75192',
        item_name: 'Millennium Falcon',
        condition: 'New' as const,
        sku: 'CUSTOM-SKU-001',
      };

      mockInventoryRepo.create.mockImplementation((data) =>
        Promise.resolve({ id: 'new-id', ...data })
      );

      await service.create(input);

      expect(mockInventoryRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          sku: 'CUSTOM-SKU-001',
        })
      );
    });
  });

  describe('createMany', () => {
    it('should create multiple items with user IDs and SKUs', async () => {
      const inputs = [
        { set_number: '75192', item_name: 'Millennium Falcon', condition: 'New' as const },
        { set_number: '76139', item_name: 'Batmobile', condition: 'Used' as const },
      ];

      mockInventoryRepo.createMany.mockImplementation((data) =>
        Promise.resolve(
          data.map((item: { set_number: string }, i: number) => ({ id: `id-${i}`, ...item }))
        )
      );

      const result = await service.createMany(inputs);

      expect(result).toHaveLength(2);
      expect(mockInventoryRepo.createMany).toHaveBeenCalledWith([
        expect.objectContaining({
          user_id: userId,
          set_number: '75192',
          sku: expect.stringMatching(/^HB-NEW-75192-.*-001$/),
        }),
        expect.objectContaining({
          user_id: userId,
          set_number: '76139',
          sku: expect.stringMatching(/^HB-USED-76139-.*-002$/),
        }),
      ]);
    });
  });

  describe('update', () => {
    it('should update item', async () => {
      const id = 'inv-001';
      const updateData = { status: 'LISTED' as InventoryStatus, listing_value: 899.99 };
      const updatedItem = { ...testInventoryItems.newMillenniumFalcon, ...updateData };

      mockInventoryRepo.update.mockResolvedValue(updatedItem);

      const result = await service.update(id, updateData);

      expect(result).toEqual(updatedItem);
      expect(mockInventoryRepo.update).toHaveBeenCalledWith(id, updateData);
    });
  });

  describe('delete', () => {
    it('should delete item', async () => {
      mockInventoryRepo.delete.mockResolvedValue(undefined);

      await service.delete('inv-001');

      expect(mockInventoryRepo.delete).toHaveBeenCalledWith('inv-001');
    });
  });

  describe('updateStatus', () => {
    it('should update single item status', async () => {
      const updatedItem = { ...testInventoryItems.newMillenniumFalcon, status: 'LISTED' };
      mockInventoryRepo.update.mockResolvedValue(updatedItem);

      const result = await service.updateStatus('inv-001', 'LISTED');

      expect(result.status).toBe('LISTED');
      expect(mockInventoryRepo.update).toHaveBeenCalledWith('inv-001', { status: 'LISTED' });
    });
  });

  describe('updateStatusBulk', () => {
    it('should update multiple items status', async () => {
      mockInventoryRepo.updateStatusBulk.mockResolvedValue(undefined);

      await service.updateStatusBulk(['inv-001', 'inv-002', 'inv-003'], 'SOLD');

      expect(mockInventoryRepo.updateStatusBulk).toHaveBeenCalledWith(
        ['inv-001', 'inv-002', 'inv-003'],
        'SOLD'
      );
    });
  });

  describe('getByStatus', () => {
    it('should return items by single status', async () => {
      const inStockItems = [testInventoryItems.newMillenniumFalcon];
      mockInventoryRepo.findByStatus.mockResolvedValue({
        data: inStockItems,
        total: 1,
        page: 1,
        pageSize: 50,
        totalPages: 1,
      });

      const result = await service.getByStatus('BACKLOG');

      expect(result.data).toEqual(inStockItems);
      expect(mockInventoryRepo.findByStatus).toHaveBeenCalledWith('BACKLOG', undefined);
    });

    it('should return items by multiple statuses', async () => {
      const items = Object.values(testInventoryItems);
      mockInventoryRepo.findByStatus.mockResolvedValue({
        data: items,
        total: items.length,
        page: 1,
        pageSize: 50,
        totalPages: 1,
      });

      await service.getByStatus(['BACKLOG', 'LISTED']);

      expect(mockInventoryRepo.findByStatus).toHaveBeenCalledWith(['BACKLOG', 'LISTED'], undefined);
    });
  });

  describe('getBacklog', () => {
    it('should return backlog items', async () => {
      const backlogItems = [testInventoryItems.newMillenniumFalcon];
      mockInventoryRepo.findByStatus.mockResolvedValue({
        data: backlogItems,
        total: 1,
        page: 1,
        pageSize: 50,
        totalPages: 1,
      });

      const result = await service.getBacklog();

      expect(result.data).toEqual(backlogItems);
      expect(mockInventoryRepo.findByStatus).toHaveBeenCalledWith('BACKLOG', undefined);
    });
  });

  describe('getSummary', () => {
    it('should return complete inventory summary', async () => {
      const countByStatus = {
        BACKLOG: 10,
        LISTED: 5,
        SOLD: 20,
      };
      const values = {
        cost: 5000.0,
        listingValue: 8000.0,
      };
      const valueByStatus = {
        BACKLOG: { cost: 2000.0, listingValue: 3000.0, count: 10 },
        LISTED: { cost: 1500.0, listingValue: 2500.0, count: 5 },
        SOLD: { cost: 1500.0, listingValue: 2500.0, count: 20 },
      };

      mockInventoryRepo.getCountByStatus.mockResolvedValue(countByStatus);
      mockInventoryRepo.getTotalValue.mockResolvedValue(values);
      mockInventoryRepo.getValueByStatus.mockResolvedValue(valueByStatus);

      const result = await service.getSummary();

      expect(result.totalItems).toBe(35);
      expect(result.byStatus).toEqual(countByStatus);
      expect(result.totalCost).toBe(5000.0);
      expect(result.totalListingValue).toBe(8000.0);
      expect(result.valueByStatus).toEqual(valueByStatus);
    });

    it('should handle empty inventory', async () => {
      mockInventoryRepo.getCountByStatus.mockResolvedValue({});
      mockInventoryRepo.getTotalValue.mockResolvedValue({ cost: 0, listingValue: 0 });
      mockInventoryRepo.getValueByStatus.mockResolvedValue({});

      const result = await service.getSummary();

      expect(result.totalItems).toBe(0);
      expect(result.totalCost).toBe(0);
      expect(result.totalListingValue).toBe(0);
      expect(result.valueByStatus).toEqual({});
    });
  });

  describe('findBySku', () => {
    it('should find item by SKU', async () => {
      const item = testInventoryItems.newMillenniumFalcon;
      mockInventoryRepo.findBySku.mockResolvedValue(item);

      const result = await service.findBySku('HB-NEW-75192-ABC123');

      expect(result).toEqual(item);
      expect(mockInventoryRepo.findBySku).toHaveBeenCalledWith('HB-NEW-75192-ABC123');
    });

    it('should return null when SKU not found', async () => {
      mockInventoryRepo.findBySku.mockResolvedValue(null);

      const result = await service.findBySku('INVALID-SKU');

      expect(result).toBeNull();
    });
  });

  describe('findByAsin', () => {
    it('should find item by Amazon ASIN', async () => {
      const item = { ...testInventoryItems.newMillenniumFalcon, amazon_asin: 'B075SDMMMV' };
      mockInventoryRepo.findByAsin.mockResolvedValue(item);

      const result = await service.findByAsin('B075SDMMMV');

      expect(result).toEqual(item);
    });
  });

  describe('getLinkedLotItems', () => {
    it('should return items in a linked lot', async () => {
      const items = Object.values(testInventoryItems);
      mockInventoryRepo.findByLinkedLot.mockResolvedValue(items);

      const result = await service.getLinkedLotItems('LOT-2024-001');

      expect(result).toEqual(items);
      expect(mockInventoryRepo.findByLinkedLot).toHaveBeenCalledWith('LOT-2024-001');
    });

    it('should return empty array when no items in lot', async () => {
      mockInventoryRepo.findByLinkedLot.mockResolvedValue([]);

      const result = await service.getLinkedLotItems('EMPTY-LOT');

      expect(result).toEqual([]);
    });
  });
});
