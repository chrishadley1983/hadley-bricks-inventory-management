/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MileageService, DEFAULT_MILEAGE_RATE } from '../mileage.service';
import type { ExpenseType } from '../../repositories';

// Mock the repository
const mockMileageRepo = {
  findById: vi.fn(),
  findAllFiltered: vi.fn(),
  findByPurchaseId: vi.fn(),
  findByDateRange: vi.fn(),
  getTotalForPeriod: vi.fn(),
  getTotalForPurchase: vi.fn(),
  getSummaryByType: vi.fn(),
  createEntry: vi.fn(),
  updateEntry: vi.fn(),
  deleteEntry: vi.fn(),
};

vi.mock('../../repositories', () => ({
  MileageRepository: function MockMileageRepository() {
    return mockMileageRepo;
  },
}));

describe('MileageService', () => {
  let service: MileageService;
  const userId = 'test-user-id';

  // Mock Supabase client
  const mockSupabase = {
    from: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new MileageService(mockSupabase as any);
  });

  describe('calculateMileageCost', () => {
    it('should calculate mileage cost with default rate', () => {
      const result = service.calculateMileageCost(25);
      expect(result).toBe(11.25); // 25 * 0.45 = 11.25
    });

    it('should calculate mileage cost with custom rate', () => {
      const result = service.calculateMileageCost(25, 0.5);
      expect(result).toBe(12.5);
    });

    it('should round to 2 decimal places', () => {
      const result = service.calculateMileageCost(33);
      // 33 * 0.45 = 14.85
      expect(result).toBe(14.85);
    });

    it('should handle zero miles', () => {
      const result = service.calculateMileageCost(0);
      expect(result).toBe(0);
    });
  });

  describe('getHomeAddress', () => {
    it('should return home address when found', async () => {
      const homeAddress = 'SW1A 1AA';
      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { home_address: homeAddress },
          error: null,
        }),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      const result = await service.getHomeAddress(userId);

      expect(result).toBe(homeAddress);
      expect(mockSupabase.from).toHaveBeenCalledWith('profiles');
    });

    it('should return null when profile not found', async () => {
      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { code: 'PGRST116', message: 'Not found' },
        }),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      const result = await service.getHomeAddress(userId);

      expect(result).toBeNull();
    });

    it('should throw error on database error', async () => {
      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { code: 'SOME_ERROR', message: 'Database error' },
        }),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      await expect(service.getHomeAddress(userId)).rejects.toThrow(
        'Failed to get home address: Database error'
      );
    });
  });

  describe('updateHomeAddress', () => {
    it('should update home address', async () => {
      const mockBuilder = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      await service.updateHomeAddress(userId, 'SW1A 2AA');

      expect(mockSupabase.from).toHaveBeenCalledWith('profiles');
      expect(mockBuilder.update).toHaveBeenCalledWith({ home_address: 'SW1A 2AA' });
    });

    it('should throw error on failure', async () => {
      const mockBuilder = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: { message: 'Update failed' } }),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      await expect(service.updateHomeAddress(userId, 'SW1A 2AA')).rejects.toThrow(
        'Failed to update home address: Update failed'
      );
    });
  });

  describe('createMileageEntry', () => {
    it('should create a mileage entry with auto-calculated amount', async () => {
      const input = {
        purchaseId: 'pur-123',
        trackingDate: '2025-01-15',
        destinationPostcode: 'SW1A 1AA',
        milesTravelled: 25,
        reason: 'Collection trip',
        expenseType: 'mileage' as ExpenseType,
      };

      const mockEntry = {
        id: 'mileage-123',
        user_id: userId,
        miles_travelled: 25,
        amount_claimed: 11.25,
      };
      mockMileageRepo.createEntry.mockResolvedValue(mockEntry);

      const result = await service.createMileageEntry(userId, input);

      expect(mockMileageRepo.createEntry).toHaveBeenCalledWith(userId, {
        purchase_id: 'pur-123',
        tracking_date: '2025-01-15',
        destination_postcode: 'SW1A 1AA',
        miles_travelled: 25,
        amount_claimed: 11.25,
        reason: 'Collection trip',
        expense_type: 'mileage',
        notes: null,
      });
    });

    it('should use provided amount when specified', async () => {
      const input = {
        purchaseId: 'pur-123',
        trackingDate: '2025-01-15',
        destinationPostcode: 'SW1A 1AA',
        milesTravelled: 25,
        amountClaimed: 15.0,
        reason: 'Collection trip',
        expenseType: 'mileage' as ExpenseType,
      };

      const mockEntry = {
        id: 'mileage-123',
        miles_travelled: 25,
        amount_claimed: 15.0,
      };
      mockMileageRepo.createEntry.mockResolvedValue(mockEntry);

      await service.createMileageEntry(userId, input);

      expect(mockMileageRepo.createEntry).toHaveBeenCalledWith(userId, {
        purchase_id: 'pur-123',
        tracking_date: '2025-01-15',
        destination_postcode: 'SW1A 1AA',
        miles_travelled: 25,
        amount_claimed: 15.0,
        reason: 'Collection trip',
        expense_type: 'mileage',
        notes: null,
      });
    });

    it('should not auto-calculate for non-mileage expense types', async () => {
      const input = {
        trackingDate: '2025-01-15',
        destinationPostcode: 'SW1A 1AA',
        milesTravelled: 0,
        reason: 'Parking fee',
        expenseType: 'parking' as ExpenseType,
      };

      const mockEntry = { id: 'parking-123', amount_claimed: 0 };
      mockMileageRepo.createEntry.mockResolvedValue(mockEntry);

      await service.createMileageEntry(userId, input);

      expect(mockMileageRepo.createEntry).toHaveBeenCalledWith(userId, {
        purchase_id: null,
        tracking_date: '2025-01-15',
        destination_postcode: 'SW1A 1AA',
        miles_travelled: 0,
        amount_claimed: 0,
        reason: 'Parking fee',
        expense_type: 'parking',
        notes: null,
      });
    });

    it('should use custom mileage rate when provided', async () => {
      const input = {
        trackingDate: '2025-01-15',
        destinationPostcode: 'SW1A 1AA',
        milesTravelled: 100,
        reason: 'Long trip',
        expenseType: 'mileage' as ExpenseType,
      };

      const mockEntry = { id: 'mileage-123', amount_claimed: 50.0 };
      mockMileageRepo.createEntry.mockResolvedValue(mockEntry);

      await service.createMileageEntry(userId, input, 0.5);

      expect(mockMileageRepo.createEntry).toHaveBeenCalledWith(userId, {
        purchase_id: null,
        tracking_date: '2025-01-15',
        destination_postcode: 'SW1A 1AA',
        miles_travelled: 100,
        amount_claimed: 50.0,
        reason: 'Long trip',
        expense_type: 'mileage',
        notes: null,
      });
    });
  });

  describe('updateMileageEntry', () => {
    it('should update mileage entry', async () => {
      const mockEntry = { id: 'mileage-123', miles_travelled: 30 };
      mockMileageRepo.updateEntry.mockResolvedValue(mockEntry);

      const result = await service.updateMileageEntry('mileage-123', userId, {
        milesTravelled: 30,
      });

      expect(mockMileageRepo.updateEntry).toHaveBeenCalled();
      expect(result.miles_travelled).toBe(30);
    });

    it('should recalculate amount when miles changed for mileage type', async () => {
      const mockEntry = { id: 'mileage-123', miles_travelled: 30, amount_claimed: 13.5 };
      mockMileageRepo.updateEntry.mockResolvedValue(mockEntry);

      await service.updateMileageEntry('mileage-123', userId, {
        milesTravelled: 30,
        expenseType: 'mileage',
      });

      expect(mockMileageRepo.updateEntry).toHaveBeenCalledWith('mileage-123', userId, {
        miles_travelled: 30,
        expense_type: 'mileage',
        amount_claimed: 13.5,
      });
    });

    it('should not recalculate when amount is explicitly provided', async () => {
      const mockEntry = { id: 'mileage-123', amount_claimed: 20.0 };
      mockMileageRepo.updateEntry.mockResolvedValue(mockEntry);

      await service.updateMileageEntry('mileage-123', userId, {
        milesTravelled: 30,
        amountClaimed: 20.0,
      });

      expect(mockMileageRepo.updateEntry).toHaveBeenCalledWith('mileage-123', userId, {
        miles_travelled: 30,
        amount_claimed: 20.0,
      });
    });
  });

  describe('deleteMileageEntry', () => {
    it('should delegate to repository', async () => {
      mockMileageRepo.deleteEntry.mockResolvedValue(undefined);

      await service.deleteMileageEntry('mileage-123', userId);

      expect(mockMileageRepo.deleteEntry).toHaveBeenCalledWith('mileage-123', userId);
    });
  });

  describe('getMileageEntry', () => {
    it('should return entry by ID', async () => {
      const mockEntry = { id: 'mileage-123', miles_travelled: 25 };
      mockMileageRepo.findById.mockResolvedValue(mockEntry);

      const result = await service.getMileageEntry('mileage-123');

      expect(result).toEqual(mockEntry);
      expect(mockMileageRepo.findById).toHaveBeenCalledWith('mileage-123');
    });
  });

  describe('getMileageForPurchase', () => {
    it('should return entries with summary', async () => {
      const entries = [
        { id: '1', expense_type: 'mileage', miles_travelled: 25, amount_claimed: 11.25 },
        { id: '2', expense_type: 'parking', miles_travelled: 0, amount_claimed: 5.0 },
      ];
      mockMileageRepo.findByPurchaseId.mockResolvedValue(entries);

      const result = await service.getMileageForPurchase('pur-123');

      expect(result.entries).toHaveLength(2);
      expect(result.totalMiles).toBe(25);
      expect(result.totalMileageCost).toBe(11.25);
      expect(result.totalOtherCosts).toBe(5.0);
      expect(result.totalCost).toBe(16.25);
    });

    it('should return zeros when no entries', async () => {
      mockMileageRepo.findByPurchaseId.mockResolvedValue([]);

      const result = await service.getMileageForPurchase('pur-123');

      expect(result.entries).toHaveLength(0);
      expect(result.totalMiles).toBe(0);
      expect(result.totalMileageCost).toBe(0);
      expect(result.totalOtherCosts).toBe(0);
      expect(result.totalCost).toBe(0);
    });
  });

  describe('getMileageForPeriod', () => {
    it('should delegate to repository', async () => {
      const mockResult = {
        data: [],
        total: 0,
        page: 1,
        pageSize: 50,
        totalPages: 0,
      };
      mockMileageRepo.findByDateRange.mockResolvedValue(mockResult);

      await service.getMileageForPeriod(userId, '2025-01-01', '2025-01-31');

      expect(mockMileageRepo.findByDateRange).toHaveBeenCalledWith(
        userId,
        '2025-01-01',
        '2025-01-31',
        { page: undefined, pageSize: undefined }
      );
    });
  });

  describe('getTotalsForPeriod', () => {
    it('should delegate to repository', async () => {
      const mockResult = { totalMiles: 100, totalAmount: 45.0 };
      mockMileageRepo.getTotalForPeriod.mockResolvedValue(mockResult);

      const result = await service.getTotalsForPeriod(userId, '2025-01-01', '2025-01-31');

      expect(result).toEqual(mockResult);
    });
  });

  describe('getSummaryByType', () => {
    it('should delegate to repository', async () => {
      const mockResult = {
        mileage: { totalMiles: 100, totalAmount: 45.0, count: 4 },
        parking: { totalMiles: 0, totalAmount: 15.0, count: 3 },
        toll: { totalMiles: 0, totalAmount: 0, count: 0 },
        other: { totalMiles: 0, totalAmount: 10.0, count: 2 },
      };
      mockMileageRepo.getSummaryByType.mockResolvedValue(mockResult);

      const result = await service.getSummaryByType(userId, '2025-01-01', '2025-01-31');

      expect(result).toEqual(mockResult);
    });
  });

  describe('getUserMileageRate', () => {
    it('should return configured rate from user settings', async () => {
      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { report_settings: { mileageRate: 0.5 } },
          error: null,
        }),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      const result = await service.getUserMileageRate(userId);

      expect(result).toBe(0.5);
    });

    it('should return default rate when no settings found', async () => {
      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'Not found' },
        }),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      const result = await service.getUserMileageRate(userId);

      expect(result).toBe(DEFAULT_MILEAGE_RATE);
    });

    it('should return default rate when mileageRate not in settings', async () => {
      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { report_settings: { otherSetting: true } },
          error: null,
        }),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      const result = await service.getUserMileageRate(userId);

      expect(result).toBe(DEFAULT_MILEAGE_RATE);
    });
  });
});
