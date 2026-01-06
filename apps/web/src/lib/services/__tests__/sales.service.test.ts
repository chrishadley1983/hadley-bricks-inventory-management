import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SalesService } from '../sales.service';

// Mock repositories
const mockSalesRepo = {
  findByOrderId: vi.fn(),
  createWithItems: vi.fn(),
  getSaleItems: vi.fn(),
  findByUser: vi.fn(),
  findByIdWithItems: vi.fn(),
  getStats: vi.fn(),
  getMonthlySummary: vi.fn(),
  deleteSaleItems: vi.fn(),
  delete: vi.fn(),
};

const mockOrderRepo = {
  findByIdWithItems: vi.fn(),
};

vi.mock('../../repositories/sales.repository', () => ({
  SalesRepository: function MockSalesRepository() {
    return mockSalesRepo;
  },
}));

vi.mock('../../repositories/order.repository', () => ({
  OrderRepository: function MockOrderRepository() {
    return mockOrderRepo;
  },
}));

describe('SalesService', () => {
  let service: SalesService;
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>;
  };

  const testUserId = 'test-user-id';

  beforeEach(() => {
    vi.clearAllMocks();

    mockSupabase = {
      from: vi.fn(),
    };

    service = new SalesService(mockSupabase as never);
  });

  describe('createFromOrder', () => {
    const mockOrder = {
      id: 'order-1',
      platform: 'bricklink',
      platform_order_id: 'BL-12345',
      order_date: '2024-12-20',
      buyer_name: 'John Doe',
      buyer_email: 'john@example.com',
      subtotal: 100,
      shipping: 10,
      fees: 5,
      total: 115,
      currency: 'GBP',
      items: [
        {
          id: 'item-1',
          item_number: '75192',
          item_name: 'Millennium Falcon',
          quantity: 1,
          unit_price: 100,
          total_price: 100,
          inventory_item_id: 'inv-1',
        },
      ],
    };

    it('should create sale from order successfully', async () => {
      mockOrderRepo.findByIdWithItems.mockResolvedValue(mockOrder);
      mockSalesRepo.findByOrderId.mockResolvedValue(null);
      mockSalesRepo.createWithItems.mockResolvedValue({
        ...mockOrder,
        id: 'sale-1', // id after spread to avoid duplicate
      });

      // Mock inventory cost lookup
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { cost: 50 }, error: null }),
          }),
        }),
      });

      const result = await service.createFromOrder(testUserId, { orderId: 'order-1' });

      expect(result.success).toBe(true);
      expect(result.sale).toBeDefined();
      expect(mockSalesRepo.createWithItems).toHaveBeenCalled();
    });

    it('should return error when order not found', async () => {
      mockOrderRepo.findByIdWithItems.mockResolvedValue(null);

      const result = await service.createFromOrder(testUserId, { orderId: 'invalid-order' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Order not found');
    });

    it('should return error when sale already exists', async () => {
      mockOrderRepo.findByIdWithItems.mockResolvedValue(mockOrder);
      mockSalesRepo.findByOrderId.mockResolvedValue({ id: 'existing-sale' });

      const result = await service.createFromOrder(testUserId, { orderId: 'order-1' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Sale already exists for this order');
    });

    it('should use provided fees and costs', async () => {
      mockOrderRepo.findByIdWithItems.mockResolvedValue(mockOrder);
      mockSalesRepo.findByOrderId.mockResolvedValue(null);
      mockSalesRepo.createWithItems.mockResolvedValue({ id: 'sale-1' });

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { cost: 50 }, error: null }),
          }),
        }),
      });

      await service.createFromOrder(testUserId, {
        orderId: 'order-1',
        platformFees: 8,
        shippingCost: 4,
        otherCosts: 2,
        notes: 'Test note',
      });

      expect(mockSalesRepo.createWithItems).toHaveBeenCalledWith(
        expect.objectContaining({
          platform_fees: 8,
          shipping_cost: 4,
          other_costs: 2,
          notes: 'Test note',
        }),
        expect.any(Array)
      );
    });

    it('should handle error during creation', async () => {
      mockOrderRepo.findByIdWithItems.mockResolvedValue(mockOrder);
      mockSalesRepo.findByOrderId.mockResolvedValue(null);
      mockSalesRepo.createWithItems.mockRejectedValue(new Error('Database error'));

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { cost: 50 }, error: null }),
          }),
        }),
      });

      const result = await service.createFromOrder(testUserId, { orderId: 'order-1' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database error');
    });
  });

  describe('createManualSale', () => {
    it('should create manual sale successfully', async () => {
      mockSalesRepo.createWithItems.mockResolvedValue({
        id: 'sale-1',
        sale_date: '2024-12-20',
        platform: 'direct',
        sale_amount: 200,
      });

      const result = await service.createManualSale(testUserId, {
        saleDate: '2024-12-20',
        platform: 'direct',
        saleAmount: 200,
        shippingCharged: 10,
        buyerName: 'Jane Doe',
      });

      expect(result.success).toBe(true);
      expect(result.sale).toBeDefined();
    });

    it('should calculate cost of goods from items', async () => {
      mockSalesRepo.createWithItems.mockResolvedValue({ id: 'sale-1' });

      await service.createManualSale(testUserId, {
        saleDate: '2024-12-20',
        platform: 'direct',
        saleAmount: 200,
        items: [
          {
            itemNumber: '75192',
            itemName: 'Millennium Falcon',
            quantity: 1,
            unitPrice: 200,
            unitCost: 100,
          },
          {
            itemNumber: '76139',
            itemName: 'Batmobile',
            quantity: 2,
            unitPrice: 50,
            unitCost: 30,
          },
        ],
      });

      expect(mockSalesRepo.createWithItems).toHaveBeenCalledWith(
        expect.objectContaining({
          cost_of_goods: 160, // 100 + (30 * 2)
        }),
        expect.any(Array)
      );
    });

    it('should use provided cost of goods over calculated', async () => {
      mockSalesRepo.createWithItems.mockResolvedValue({ id: 'sale-1' });

      await service.createManualSale(testUserId, {
        saleDate: '2024-12-20',
        platform: 'direct',
        saleAmount: 200,
        costOfGoods: 80, // Explicitly provided
        items: [
          {
            itemNumber: '75192',
            quantity: 1,
            unitPrice: 200,
            unitCost: 100,
          },
        ],
      });

      expect(mockSalesRepo.createWithItems).toHaveBeenCalledWith(
        expect.objectContaining({
          cost_of_goods: 80, // Should use provided value
        }),
        expect.any(Array)
      );
    });

    it('should default currency to GBP', async () => {
      mockSalesRepo.createWithItems.mockResolvedValue({ id: 'sale-1' });

      await service.createManualSale(testUserId, {
        saleDate: '2024-12-20',
        platform: 'direct',
        saleAmount: 100,
      });

      expect(mockSalesRepo.createWithItems).toHaveBeenCalledWith(
        expect.objectContaining({
          currency: 'GBP',
        }),
        expect.any(Array)
      );
    });

    it('should handle error during creation', async () => {
      mockSalesRepo.createWithItems.mockRejectedValue(new Error('Creation failed'));

      const result = await service.createManualSale(testUserId, {
        saleDate: '2024-12-20',
        platform: 'direct',
        saleAmount: 100,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Creation failed');
    });
  });

  describe('updateInventoryStatus', () => {
    it('should update linked inventory items to SOLD', async () => {
      mockSalesRepo.getSaleItems.mockResolvedValue([
        { id: 'item-1', inventory_item_id: 'inv-1' },
        { id: 'item-2', inventory_item_id: 'inv-2' },
        { id: 'item-3', inventory_item_id: null },
      ]);

      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });
      mockSupabase.from.mockReturnValue({ update: mockUpdate });

      await service.updateInventoryStatus('sale-1');

      expect(mockUpdate).toHaveBeenCalledWith({ status: 'SOLD' });
      expect(mockSupabase.from).toHaveBeenCalledTimes(2); // Only for items with inventory_item_id
    });
  });

  describe('getSales', () => {
    it('should call repository with options', async () => {
      mockSalesRepo.findByUser.mockResolvedValue({
        data: [],
        total: 0,
        page: 1,
        pageSize: 50,
        totalPages: 0,
      });

      await service.getSales(testUserId, {
        platform: 'bricklink',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
        page: 2,
        pageSize: 20,
      });

      expect(mockSalesRepo.findByUser).toHaveBeenCalledWith(
        testUserId,
        {
          platform: 'bricklink',
          startDate: expect.any(Date),
          endDate: expect.any(Date),
        },
        {
          page: 2,
          pageSize: 20,
        }
      );
    });
  });

  describe('getSaleWithItems', () => {
    it('should return sale with items', async () => {
      const mockSale = {
        id: 'sale-1',
        sale_amount: 100,
        items: [{ id: 'item-1', item_number: '75192' }],
      };
      mockSalesRepo.findByIdWithItems.mockResolvedValue(mockSale);

      const result = await service.getSaleWithItems('sale-1');

      expect(result).toEqual(mockSale);
    });

    it('should return null when not found', async () => {
      mockSalesRepo.findByIdWithItems.mockResolvedValue(null);

      const result = await service.getSaleWithItems('invalid-id');

      expect(result).toBeNull();
    });
  });

  describe('getStats', () => {
    it('should call repository with filters', async () => {
      mockSalesRepo.getStats.mockResolvedValue({
        totalSales: 10,
        totalRevenue: 1000,
        totalProfit: 500,
      });

      await service.getStats(testUserId, {
        platform: 'bricklink',
        startDate: new Date('2024-01-01'),
      });

      expect(mockSalesRepo.getStats).toHaveBeenCalledWith(testUserId, {
        platform: 'bricklink',
        startDate: expect.any(Date),
      });
    });
  });

  describe('getMonthlySummary', () => {
    it('should call repository with year', async () => {
      mockSalesRepo.getMonthlySummary.mockResolvedValue([]);

      await service.getMonthlySummary(testUserId, 2024);

      expect(mockSalesRepo.getMonthlySummary).toHaveBeenCalledWith(testUserId, 2024);
    });
  });

  describe('deleteSale', () => {
    it('should delete sale and its items', async () => {
      mockSalesRepo.deleteSaleItems.mockResolvedValue(undefined);
      mockSalesRepo.delete.mockResolvedValue(undefined);

      const result = await service.deleteSale('sale-1');

      expect(result).toBe(true);
      expect(mockSalesRepo.deleteSaleItems).toHaveBeenCalledWith('sale-1');
      expect(mockSalesRepo.delete).toHaveBeenCalledWith('sale-1');
    });

    it('should return false on error', async () => {
      mockSalesRepo.deleteSaleItems.mockRejectedValue(new Error('Delete failed'));

      const result = await service.deleteSale('sale-1');

      expect(result).toBe(false);
    });
  });
});
