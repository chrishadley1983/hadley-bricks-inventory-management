import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EvaluationConversionService } from '../evaluation-conversion.service';

// Mock services - create before vi.mock calls
const mockPurchaseService = {
  create: vi.fn(),
};

const mockInventoryService = {
  createMany: vi.fn(),
};

// Mock the modules using class constructors
vi.mock('../purchase.service', () => {
  return {
    PurchaseService: class MockPurchaseService {
      create = mockPurchaseService.create;
    },
  };
});

vi.mock('../inventory.service', () => {
  return {
    InventoryService: class MockInventoryService {
      createMany = mockInventoryService.createMany;
    },
  };
});

describe('EvaluationConversionService', () => {
  let service: EvaluationConversionService;
  const userId = 'test-user-id';

  // Mock Supabase client
  const mockSupabase = {
    from: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new EvaluationConversionService(mockSupabase as any, userId);
  });

  describe('validateConversion', () => {
    it('should return NOT_FOUND when evaluation does not exist', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
      });

      const result = await service.validateConversion('non-existent');

      expect(result?.code).toBe('NOT_FOUND');
      expect(result?.message).toBe('Evaluation not found');
    });

    it('should return ALREADY_CONVERTED when status is converted', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'eval-1',
            user_id: userId,
            status: 'converted',
            converted_at: '2025-01-15T10:00:00Z',
            item_count: 5,
          },
          error: null,
        }),
      });

      const result = await service.validateConversion('eval-1');

      expect(result?.code).toBe('ALREADY_CONVERTED');
    });

    it('should return ALREADY_CONVERTED when converted_at is set', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'eval-1',
            user_id: userId,
            status: 'completed',
            converted_at: '2025-01-15T10:00:00Z',
            item_count: 5,
          },
          error: null,
        }),
      });

      const result = await service.validateConversion('eval-1');

      expect(result?.code).toBe('ALREADY_CONVERTED');
    });

    it('should return INVALID_STATUS when not completed or saved', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'eval-1',
            user_id: userId,
            status: 'draft',
            item_count: 5,
          },
          error: null,
        }),
      });

      const result = await service.validateConversion('eval-1');

      expect(result?.code).toBe('INVALID_STATUS');
    });

    it('should return INVALID_STATUS for in_progress evaluations', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'eval-1',
            user_id: userId,
            status: 'in_progress',
            item_count: 5,
          },
          error: null,
        }),
      });

      const result = await service.validateConversion('eval-1');

      expect(result?.code).toBe('INVALID_STATUS');
    });

    it('should return NO_ITEMS when item_count is 0', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'eval-1',
            user_id: userId,
            status: 'completed',
            item_count: 0,
          },
          error: null,
        }),
      });

      const result = await service.validateConversion('eval-1');

      expect(result?.code).toBe('NO_ITEMS');
    });

    it('should return NO_ITEMS when item_count is null', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'eval-1',
            user_id: userId,
            status: 'completed',
            item_count: null,
          },
          error: null,
        }),
      });

      const result = await service.validateConversion('eval-1');

      expect(result?.code).toBe('NO_ITEMS');
    });

    it('should return null when evaluation is valid for conversion', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'eval-1',
            user_id: userId,
            status: 'completed',
            item_count: 5,
            converted_at: null,
          },
          error: null,
        }),
      });

      const result = await service.validateConversion('eval-1');

      expect(result).toBeNull();
    });

    it('should allow conversion of saved evaluations', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'eval-1',
            user_id: userId,
            status: 'saved',
            item_count: 3,
            converted_at: null,
          },
          error: null,
        }),
      });

      const result = await service.validateConversion('eval-1');

      expect(result).toBeNull();
    });
  });

  describe('convert', () => {
    it('should throw error when validation fails', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
      });

      await expect(
        service.convert('non-existent', {
          purchase: {
            purchase_date: '2025-01-15',
            short_description: 'Test purchase',
            cost: 100,
            source: null,
            payment_method: null,
            reference: null,
            description: null,
          },
          inventoryItems: [],
        })
      ).rejects.toThrow('Evaluation not found');
    });

    it('should create purchase and inventory items on successful conversion', async () => {
      // First call for validation
      const validationMock = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'eval-1',
            user_id: userId,
            status: 'completed',
            item_count: 2,
            converted_at: null,
          },
          error: null,
        }),
      };

      // Update call
      const updateMock = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'eval-1',
            status: 'converted',
            converted_at: '2025-01-15T10:00:00Z',
            converted_purchase_id: 'pur-new',
          },
          error: null,
        }),
      };

      let callCount = 0;
      mockSupabase.from.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return validationMock;
        return updateMock;
      });

      const mockPurchase = {
        id: 'pur-new',
        short_description: 'Test purchase',
        cost: 100,
        purchase_date: '2025-01-15',
      };
      mockPurchaseService.create.mockResolvedValue(mockPurchase);

      const mockInventoryItems = [
        { id: 'inv-1', set_number: '75192', purchase_id: 'pur-new' },
        { id: 'inv-2', set_number: '76139', purchase_id: 'pur-new' },
      ];
      mockInventoryService.createMany.mockResolvedValue(mockInventoryItems);

      const result = await service.convert('eval-1', {
        purchase: {
          purchase_date: '2025-01-15',
          short_description: 'Test purchase',
          cost: 100,
          source: 'Car Boot Sale',
          payment_method: 'cash',
          reference: null,
          description: null,
        },
        inventoryItems: [
          { set_number: '75192', item_name: 'Millennium Falcon', condition: 'New', status: 'NOT YET RECEIVED', source: 'Car Boot Sale', cost: 50, listing_value: 100, listing_platform: '', storage_location: '', amazon_asin: '', sku: '', notes: '' },
          { set_number: '76139', item_name: 'Batman Tumbler', condition: 'Used', status: 'NOT YET RECEIVED', source: 'Car Boot Sale', cost: 50, listing_value: 80, listing_platform: '', storage_location: '', amazon_asin: '', sku: '', notes: '' },
        ],
      });

      expect(mockPurchaseService.create).toHaveBeenCalledWith({
        purchase_date: '2025-01-15',
        short_description: 'Test purchase',
        cost: 100,
        source: 'Car Boot Sale',
        payment_method: 'cash',
        reference: undefined,
        description: undefined,
      });

      expect(mockInventoryService.createMany).toHaveBeenCalledWith([
        expect.objectContaining({
          set_number: '75192',
          condition: 'New',
          cost: 50,
          purchase_id: 'pur-new',
        }),
        expect.objectContaining({
          set_number: '76139',
          condition: 'Used',
          cost: 50,
          purchase_id: 'pur-new',
        }),
      ]);

      expect(result.purchase.id).toBe('pur-new');
      expect(result.inventoryItemCount).toBe(2);
    });

    it('should set default status for inventory items', async () => {
      const validationMock = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'eval-1',
            user_id: userId,
            status: 'completed',
            item_count: 1,
            converted_at: null,
          },
          error: null,
        }),
      };

      const updateMock = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: 'eval-1' }, error: null }),
      };

      let callCount = 0;
      mockSupabase.from.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return validationMock;
        return updateMock;
      });

      mockPurchaseService.create.mockResolvedValue({
        id: 'pur-new',
        short_description: 'Test',
        cost: 100,
        purchase_date: '2025-01-15',
      });
      mockInventoryService.createMany.mockResolvedValue([{ id: 'inv-1' }]);

      await service.convert('eval-1', {
        purchase: {
          purchase_date: '2025-01-15',
          short_description: 'Test',
          cost: 100,
          source: null,
          payment_method: null,
          reference: null,
          description: null,
        },
        inventoryItems: [
          { set_number: '75192', item_name: 'Test Set', condition: 'New', status: 'NOT YET RECEIVED', source: '', cost: 100, listing_value: 200, listing_platform: '', storage_location: '', amazon_asin: '', sku: '', notes: '' },
        ],
      });

      expect(mockInventoryService.createMany).toHaveBeenCalledWith([
        expect.objectContaining({
          status: 'NOT YET RECEIVED',
        }),
      ]);
    });

    it('should update evaluation status to converted', async () => {
      const validationMock = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'eval-1',
            user_id: userId,
            status: 'completed',
            item_count: 1,
            converted_at: null,
          },
          error: null,
        }),
      };

      const updateMock = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'eval-1',
            status: 'converted',
            converted_at: '2025-01-15T10:00:00Z',
            converted_purchase_id: 'pur-new',
          },
          error: null,
        }),
      };

      let callCount = 0;
      mockSupabase.from.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return validationMock;
        return updateMock;
      });

      mockPurchaseService.create.mockResolvedValue({
        id: 'pur-new',
        short_description: 'Test',
        cost: 100,
        purchase_date: '2025-01-15',
      });
      mockInventoryService.createMany.mockResolvedValue([{ id: 'inv-1' }]);

      const result = await service.convert('eval-1', {
        purchase: {
          purchase_date: '2025-01-15',
          short_description: 'Test',
          cost: 100,
          source: null,
          payment_method: null,
          reference: null,
          description: null,
        },
        inventoryItems: [
          { set_number: '75192', item_name: 'Test Set', condition: 'New', status: 'NOT YET RECEIVED', source: '', cost: 100, listing_value: 200, listing_platform: '', storage_location: '', amazon_asin: '', sku: '', notes: '' },
        ],
      });

      expect(updateMock.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'converted',
        })
      );
      expect(result.evaluation.status).toBe('converted');
    });

    it('should handle update failure gracefully', async () => {
      const validationMock = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'eval-1',
            user_id: userId,
            status: 'completed',
            item_count: 1,
            converted_at: null,
          },
          error: null,
        }),
      };

      const updateMock = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn()
          .mockResolvedValueOnce({ data: null, error: { message: 'Update failed' } })
          .mockResolvedValueOnce({
            data: { id: 'eval-1', status: 'completed' },
            error: null,
          }),
      };

      let callCount = 0;
      mockSupabase.from.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return validationMock;
        return updateMock;
      });

      mockPurchaseService.create.mockResolvedValue({
        id: 'pur-new',
        short_description: 'Test',
        cost: 100,
        purchase_date: '2025-01-15',
      });
      mockInventoryService.createMany.mockResolvedValue([{ id: 'inv-1' }]);

      // Should not throw even if update fails - conversion succeeded
      const result = await service.convert('eval-1', {
        purchase: {
          purchase_date: '2025-01-15',
          short_description: 'Test',
          cost: 100,
          source: null,
          payment_method: null,
          reference: null,
          description: null,
        },
        inventoryItems: [
          { set_number: '75192', item_name: 'Test Set', condition: 'New', status: 'NOT YET RECEIVED', source: '', cost: 100, listing_value: 200, listing_platform: '', storage_location: '', amazon_asin: '', sku: '', notes: '' },
        ],
      });

      expect(result.purchase.id).toBe('pur-new');
      expect(result.inventoryItemCount).toBe(1);
    });

    it('should pass optional fields to inventory items', async () => {
      const validationMock = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'eval-1',
            user_id: userId,
            status: 'completed',
            item_count: 1,
            converted_at: null,
          },
          error: null,
        }),
      };

      const updateMock = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: 'eval-1' }, error: null }),
      };

      let callCount = 0;
      mockSupabase.from.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return validationMock;
        return updateMock;
      });

      mockPurchaseService.create.mockResolvedValue({
        id: 'pur-new',
        short_description: 'Test',
        cost: 100,
        purchase_date: '2025-01-15',
      });
      mockInventoryService.createMany.mockResolvedValue([{ id: 'inv-1' }]);

      await service.convert('eval-1', {
        purchase: {
          purchase_date: '2025-01-15',
          short_description: 'Test',
          cost: 100,
          source: null,
          payment_method: null,
          reference: null,
          description: null,
        },
        inventoryItems: [
          {
            set_number: '75192',
            item_name: 'Millennium Falcon',
            condition: 'New',
            status: 'NOT YET RECEIVED',
            source: 'Car Boot Sale',
            cost: 100,
            listing_value: 200,
            listing_platform: 'amazon',
            storage_location: 'Shelf A1',
            amazon_asin: 'B01MUANC80',
            sku: 'MF-001',
            notes: 'Sealed box',
          },
        ],
      });

      expect(mockInventoryService.createMany).toHaveBeenCalledWith([
        expect.objectContaining({
          item_name: 'Millennium Falcon',
          listing_platform: 'amazon',
          storage_location: 'Shelf A1',
          amazon_asin: 'B01MUANC80',
          sku: 'MF-001',
          notes: 'Sealed box',
        }),
      ]);
    });
  });
});
