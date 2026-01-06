import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PurchaseService } from '../purchase.service';
import { testPurchases } from '@/test/fixtures';

// Mock the repository
const mockPurchaseRepo = {
  findById: vi.fn(),
  findAllFiltered: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getRecent: vi.fn(),
  findByDateRange: vi.fn(),
  getMonthlyTotal: vi.fn(),
  getRolling12MonthTotal: vi.fn(),
  getTotalsBySource: vi.fn(),
};

vi.mock('../../repositories', () => ({
  PurchaseRepository: function MockPurchaseRepository() {
    return mockPurchaseRepo;
  },
}));

describe('PurchaseService', () => {
  let service: PurchaseService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockSupabase: any = {};
  const userId = 'test-user-id';

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PurchaseService(mockSupabase, userId);
  });

  describe('getById', () => {
    it('should return purchase by ID', async () => {
      const purchase = testPurchases.cashPurchase;
      mockPurchaseRepo.findById.mockResolvedValue(purchase);

      const result = await service.getById(purchase.id);

      expect(result).toEqual(purchase);
      expect(mockPurchaseRepo.findById).toHaveBeenCalledWith(purchase.id);
    });

    it('should return null when not found', async () => {
      mockPurchaseRepo.findById.mockResolvedValue(null);

      const result = await service.getById('invalid-id');

      expect(result).toBeNull();
    });
  });

  describe('getAll', () => {
    it('should return all purchases with pagination', async () => {
      const purchases = Object.values(testPurchases);
      mockPurchaseRepo.findAllFiltered.mockResolvedValue({
        data: purchases,
        total: purchases.length,
        page: 1,
        pageSize: 50,
        totalPages: 1,
      });

      const result = await service.getAll();

      expect(result.data).toEqual(purchases);
      expect(result.total).toBe(purchases.length);
    });

    it('should apply filters', async () => {
      mockPurchaseRepo.findAllFiltered.mockResolvedValue({
        data: [testPurchases.onlinePurchase],
        total: 1,
        page: 1,
        pageSize: 50,
        totalPages: 1,
      });

      const filters = { source: 'eBay', paymentMethod: 'paypal' };
      await service.getAll(filters);

      expect(mockPurchaseRepo.findAllFiltered).toHaveBeenCalledWith(
        filters,
        undefined
      );
    });

    it('should apply pagination options', async () => {
      mockPurchaseRepo.findAllFiltered.mockResolvedValue({
        data: [],
        total: 100,
        page: 2,
        pageSize: 20,
        totalPages: 5,
      });

      const pagination = { page: 2, pageSize: 20 };
      await service.getAll(undefined, pagination);

      expect(mockPurchaseRepo.findAllFiltered).toHaveBeenCalledWith(
        undefined,
        pagination
      );
    });
  });

  describe('create', () => {
    it('should create purchase with user ID', async () => {
      const input = {
        purchase_date: '2024-12-20',
        short_description: 'Test Purchase',
        cost: 100.0,
        source: 'eBay',
        payment_method: 'paypal',
      };

      const createdPurchase = {
        id: 'new-id',
        user_id: userId,
        ...input,
        created_at: '2024-12-20T10:00:00Z',
        updated_at: '2024-12-20T10:00:00Z',
      };

      mockPurchaseRepo.create.mockResolvedValue(createdPurchase);

      const result = await service.create(input);

      expect(result).toEqual(createdPurchase);
      expect(mockPurchaseRepo.create).toHaveBeenCalledWith({
        ...input,
        user_id: userId,
      });
    });

    it('should add user_id to purchase data', async () => {
      const input = {
        purchase_date: '2024-12-20',
        short_description: 'Test',
        cost: 50.0,
      };

      mockPurchaseRepo.create.mockResolvedValue({ id: 'new-id', ...input, user_id: userId });

      await service.create(input);

      expect(mockPurchaseRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: userId })
      );
    });
  });

  describe('update', () => {
    it('should update purchase', async () => {
      const id = 'pur-001';
      const updateData = {
        short_description: 'Updated Description',
        cost: 200.0,
      };

      const updatedPurchase = {
        ...testPurchases.cashPurchase,
        ...updateData,
        id, // id after spread to avoid duplicate
      };

      mockPurchaseRepo.update.mockResolvedValue(updatedPurchase);

      const result = await service.update(id, updateData);

      expect(result).toEqual(updatedPurchase);
      expect(mockPurchaseRepo.update).toHaveBeenCalledWith(id, updateData);
    });
  });

  describe('delete', () => {
    it('should delete purchase', async () => {
      mockPurchaseRepo.delete.mockResolvedValue(undefined);

      await service.delete('pur-001');

      expect(mockPurchaseRepo.delete).toHaveBeenCalledWith('pur-001');
    });
  });

  describe('getRecent', () => {
    it('should return recent purchases with default limit', async () => {
      const recentPurchases = Object.values(testPurchases).slice(0, 3);
      mockPurchaseRepo.getRecent.mockResolvedValue(recentPurchases);

      const result = await service.getRecent();

      expect(result).toEqual(recentPurchases);
      expect(mockPurchaseRepo.getRecent).toHaveBeenCalledWith(10);
    });

    it('should return recent purchases with custom limit', async () => {
      mockPurchaseRepo.getRecent.mockResolvedValue([testPurchases.cashPurchase]);

      const result = await service.getRecent(1);

      expect(result).toHaveLength(1);
      expect(mockPurchaseRepo.getRecent).toHaveBeenCalledWith(1);
    });
  });

  describe('getByDateRange', () => {
    it('should return purchases within date range', async () => {
      const purchases = Object.values(testPurchases);
      mockPurchaseRepo.findByDateRange.mockResolvedValue({
        data: purchases,
        total: purchases.length,
        page: 1,
        pageSize: 50,
        totalPages: 1,
      });

      const result = await service.getByDateRange('2024-01-01', '2024-12-31');

      expect(result.data).toEqual(purchases);
      expect(mockPurchaseRepo.findByDateRange).toHaveBeenCalledWith(
        '2024-01-01',
        '2024-12-31',
        undefined
      );
    });

    it('should apply pagination to date range query', async () => {
      mockPurchaseRepo.findByDateRange.mockResolvedValue({
        data: [],
        total: 50,
        page: 2,
        pageSize: 10,
        totalPages: 5,
      });

      await service.getByDateRange('2024-01-01', '2024-12-31', { page: 2, pageSize: 10 });

      expect(mockPurchaseRepo.findByDateRange).toHaveBeenCalledWith(
        '2024-01-01',
        '2024-12-31',
        { page: 2, pageSize: 10 }
      );
    });
  });

  describe('getCurrentMonthTotal', () => {
    it('should return current month total', async () => {
      mockPurchaseRepo.getMonthlyTotal.mockResolvedValue(500.0);

      const result = await service.getCurrentMonthTotal();

      expect(result).toBe(500.0);
      const now = new Date();
      expect(mockPurchaseRepo.getMonthlyTotal).toHaveBeenCalledWith(
        now.getFullYear(),
        now.getMonth() + 1
      );
    });
  });

  describe('getMonthlyTotal', () => {
    it('should return monthly total for specific month', async () => {
      mockPurchaseRepo.getMonthlyTotal.mockResolvedValue(750.0);

      const result = await service.getMonthlyTotal(2024, 6);

      expect(result).toBe(750.0);
      expect(mockPurchaseRepo.getMonthlyTotal).toHaveBeenCalledWith(2024, 6);
    });
  });

  describe('getRolling12MonthTotal', () => {
    it('should return rolling 12 month total', async () => {
      mockPurchaseRepo.getRolling12MonthTotal.mockResolvedValue(5000.0);

      const result = await service.getRolling12MonthTotal();

      expect(result).toBe(5000.0);
      expect(mockPurchaseRepo.getRolling12MonthTotal).toHaveBeenCalled();
    });
  });

  describe('getTotalsBySource', () => {
    it('should return totals grouped by source', async () => {
      const bySource = {
        'eBay': 1500.0,
        'Car Boot Sale': 800.0,
        'LEGO Store': 2000.0,
      };
      mockPurchaseRepo.getTotalsBySource.mockResolvedValue(bySource);

      const result = await service.getTotalsBySource();

      expect(result).toEqual(bySource);
    });
  });

  describe('getSummary', () => {
    it('should return complete purchase summary', async () => {
      const currentMonthTotal = 500.0;
      const rolling12MonthTotal = 5000.0;
      const bySource = { 'eBay': 1500.0, 'LEGO Store': 2000.0 };
      const recentPurchases = Object.values(testPurchases).slice(0, 5);

      mockPurchaseRepo.getMonthlyTotal.mockResolvedValue(currentMonthTotal);
      mockPurchaseRepo.getRolling12MonthTotal.mockResolvedValue(rolling12MonthTotal);
      mockPurchaseRepo.getTotalsBySource.mockResolvedValue(bySource);
      mockPurchaseRepo.getRecent.mockResolvedValue(recentPurchases);

      const result = await service.getSummary();

      expect(result.currentMonthTotal).toBe(currentMonthTotal);
      expect(result.rolling12MonthTotal).toBe(rolling12MonthTotal);
      expect(result.bySource).toEqual(bySource);
      expect(result.recentPurchases).toEqual(recentPurchases);
    });

    it('should fetch all summary data in parallel', async () => {
      mockPurchaseRepo.getMonthlyTotal.mockResolvedValue(0);
      mockPurchaseRepo.getRolling12MonthTotal.mockResolvedValue(0);
      mockPurchaseRepo.getTotalsBySource.mockResolvedValue({});
      mockPurchaseRepo.getRecent.mockResolvedValue([]);

      await service.getSummary();

      // All methods should be called
      expect(mockPurchaseRepo.getMonthlyTotal).toHaveBeenCalled();
      expect(mockPurchaseRepo.getRolling12MonthTotal).toHaveBeenCalled();
      expect(mockPurchaseRepo.getTotalsBySource).toHaveBeenCalled();
      expect(mockPurchaseRepo.getRecent).toHaveBeenCalledWith(5);
    });
  });
});
