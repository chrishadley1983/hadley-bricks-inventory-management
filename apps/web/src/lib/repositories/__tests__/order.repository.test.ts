import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrderRepository } from '../order.repository';
import { testBrickLinkOrders, testBrickOwlOrders } from '@/test/fixtures';

describe('OrderRepository', () => {
  let repository: OrderRepository;
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>;
  };

  const mockOrders = [...testBrickLinkOrders, ...testBrickOwlOrders];

  beforeEach(() => {
    vi.clearAllMocks();

    mockSupabase = {
      from: vi.fn(),
    };

    repository = new OrderRepository(mockSupabase as never);
  });

  describe('findByUser', () => {
    it('should return paginated orders', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              range: vi.fn().mockResolvedValue({
                data: mockOrders,
                count: mockOrders.length,
                error: null,
              }),
            }),
          }),
        }),
      });

      const result = await repository.findByUser('test-user-id');

      expect(result.data).toHaveLength(mockOrders.length);
      expect(result.total).toBe(mockOrders.length);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(50);
    });

    it('should filter by platform', async () => {
      const brickLinkOnly = mockOrders.filter((o) => o.platform === 'bricklink');

      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({
          data: brickLinkOnly,
          count: brickLinkOnly.length,
          error: null,
        }),
      };
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await repository.findByUser('test-user-id', { platform: 'bricklink' });

      expect(mockQuery.eq).toHaveBeenCalledWith('platform', 'bricklink');
      expect(result.data).toHaveLength(brickLinkOnly.length);
    });

    it('should filter by status', async () => {
      const paidOrders = mockOrders.filter((o) => o.status === 'Paid');

      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({
          data: paidOrders,
          count: paidOrders.length,
          error: null,
        }),
      };
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await repository.findByUser('test-user-id', { status: 'Paid' });

      expect(result.data).toEqual(paidOrders);
    });

    it('should filter by date range', async () => {
      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({
          data: mockOrders,
          count: mockOrders.length,
          error: null,
        }),
      };
      mockSupabase.from.mockReturnValue(mockQuery);

      const startDate = new Date('2024-12-01');
      const endDate = new Date('2024-12-31');

      await repository.findByUser('test-user-id', { startDate, endDate });

      expect(mockQuery.gte).toHaveBeenCalledWith('order_date', startDate.toISOString());
      expect(mockQuery.lte).toHaveBeenCalledWith('order_date', endDate.toISOString());
    });

    it('should handle pagination options', async () => {
      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({
          data: [],
          count: 100,
          error: null,
        }),
      };
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await repository.findByUser('test-user-id', undefined, {
        page: 3,
        pageSize: 20,
      });

      expect(mockQuery.range).toHaveBeenCalledWith(40, 59); // (3-1)*20 to (3-1)*20+20-1
      expect(result.page).toBe(3);
      expect(result.pageSize).toBe(20);
      expect(result.totalPages).toBe(5);
    });

    it('should throw error on database failure', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              range: vi.fn().mockResolvedValue({
                data: null,
                count: null,
                error: { message: 'Database error' },
              }),
            }),
          }),
        }),
      });

      await expect(repository.findByUser('test-user-id')).rejects.toThrow(
        'Failed to fetch orders: Database error'
      );
    });
  });

  describe('findByPlatformOrderId', () => {
    it('should find order by platform and platform order ID', async () => {
      const order = testBrickLinkOrders[0];

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: order, error: null }),
              }),
            }),
          }),
        }),
      });

      const result = await repository.findByPlatformOrderId(
        'test-user-id',
        'bricklink',
        order.platform_order_id
      );

      expect(result).toEqual(order);
    });

    it('should return null when order not found', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { code: 'PGRST116', message: 'Not found' },
                }),
              }),
            }),
          }),
        }),
      });

      const result = await repository.findByPlatformOrderId(
        'test-user-id',
        'bricklink',
        'INVALID-ID'
      );

      expect(result).toBeNull();
    });
  });

  describe('findByIdWithItems', () => {
    it('should return order with items', async () => {
      const order = testBrickLinkOrders[0];
      const items = order.items;

      const findByIdSpy = vi.spyOn(repository, 'findById').mockResolvedValue(order as never);
      const getOrderItemsSpy = vi.spyOn(repository, 'getOrderItems').mockResolvedValue(items as never);

      const result = await repository.findByIdWithItems(order.id);

      expect(result).toEqual({ ...order, items });
      expect(findByIdSpy).toHaveBeenCalledWith(order.id);
      expect(getOrderItemsSpy).toHaveBeenCalledWith(order.id);
    });

    it('should return null when order not found', async () => {
      // Need to mock both since Promise.all runs both in parallel
      vi.spyOn(repository, 'findById').mockResolvedValue(null);
      vi.spyOn(repository, 'getOrderItems').mockResolvedValue([]);

      const result = await repository.findByIdWithItems('invalid-id');

      expect(result).toBeNull();
    });
  });

  describe('getOrderItems', () => {
    it('should return items for an order', async () => {
      const items = testBrickLinkOrders[0].items;

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: items, error: null }),
          }),
        }),
      });

      const result = await repository.getOrderItems('order-001');

      expect(result).toEqual(items);
    });

    it('should throw error on failure', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Database error' },
            }),
          }),
        }),
      });

      await expect(repository.getOrderItems('order-001')).rejects.toThrow(
        'Failed to fetch order items: Database error'
      );
    });
  });

  describe('upsert', () => {
    it('should upsert order successfully', async () => {
      const newOrder = {
        user_id: 'test-user-id',
        platform: 'bricklink' as const,
        platform_order_id: 'BL-NEW-123',
        order_date: '2024-12-20T10:00:00Z',
        status: 'Paid',
        total: 100.0,
      };

      const insertedOrder = { id: 'new-id', ...newOrder };

      mockSupabase.from.mockReturnValue({
        upsert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: insertedOrder, error: null }),
          }),
        }),
      });

      const result = await repository.upsert(newOrder as never);

      expect(result).toEqual(insertedOrder);
    });

    it('should throw error on upsert failure', async () => {
      mockSupabase.from.mockReturnValue({
        upsert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Upsert failed' },
            }),
          }),
        }),
      });

      await expect(repository.upsert({} as never)).rejects.toThrow(
        'Failed to upsert order: Upsert failed'
      );
    });
  });

  describe('upsertMany', () => {
    it('should upsert multiple orders', async () => {
      const orders = [
        { platform: 'bricklink', platform_order_id: 'BL-1' },
        { platform: 'bricklink', platform_order_id: 'BL-2' },
      ];

      const insertedOrders = orders.map((o, i) => ({ id: `id-${i}`, ...o }));

      mockSupabase.from.mockReturnValue({
        upsert: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: insertedOrders, error: null }),
        }),
      });

      const result = await repository.upsertMany(orders as never);

      expect(result).toHaveLength(2);
    });

    it('should return empty array for empty input', async () => {
      const result = await repository.upsertMany([]);

      expect(result).toEqual([]);
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });
  });

  describe('insertOrderItems', () => {
    it('should insert order items', async () => {
      const items = [
        { order_id: 'order-001', set_number: '75192', quantity: 1 },
        { order_id: 'order-001', set_number: '76139', quantity: 2 },
      ];

      const insertedItems = items.map((item, i) => ({ id: `item-${i}`, ...item }));

      mockSupabase.from.mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: insertedItems, error: null }),
        }),
      });

      const result = await repository.insertOrderItems(items as never);

      expect(result).toHaveLength(2);
    });

    it('should return empty array for empty input', async () => {
      const result = await repository.insertOrderItems([]);

      expect(result).toEqual([]);
    });
  });

  describe('deleteOrderItems', () => {
    it('should delete items for an order', async () => {
      mockSupabase.from.mockReturnValue({
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      });

      await expect(repository.deleteOrderItems('order-001')).resolves.not.toThrow();
    });

    it('should throw error on failure', async () => {
      mockSupabase.from.mockReturnValue({
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: { message: 'Delete failed' } }),
        }),
      });

      await expect(repository.deleteOrderItems('order-001')).rejects.toThrow(
        'Failed to delete order items: Delete failed'
      );
    });
  });

  describe('replaceOrderItems', () => {
    it('should delete existing items and insert new ones', async () => {
      const newItems = [
        { set_number: '75192', quantity: 1 },
        { set_number: '76139', quantity: 2 },
      ];

      const deleteItemsSpy = vi.spyOn(repository, 'deleteOrderItems').mockResolvedValue();
      const insertItemsSpy = vi.spyOn(repository, 'insertOrderItems').mockResolvedValue([
        { id: 'item-1', order_id: 'order-001', ...newItems[0] },
        { id: 'item-2', order_id: 'order-001', ...newItems[1] },
      ] as never);

      const result = await repository.replaceOrderItems('order-001', newItems as never);

      expect(deleteItemsSpy).toHaveBeenCalledWith('order-001');
      expect(insertItemsSpy).toHaveBeenCalledWith([
        { order_id: 'order-001', ...newItems[0] },
        { order_id: 'order-001', ...newItems[1] },
      ]);
      expect(result).toHaveLength(2);
    });
  });

  describe('getStats', () => {
    it('should return order statistics', async () => {
      const orders = [
        { status: 'Paid', total: 100 },
        { status: 'Paid', total: 150 },
        { status: 'Shipped', total: 200 },
        { status: 'Completed', total: 50 },
      ];

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: orders, error: null }),
        }),
      });

      const result = await repository.getStats('test-user-id');

      expect(result.totalOrders).toBe(4);
      expect(result.totalRevenue).toBe(500);
      expect(result.ordersByStatus).toEqual({
        Paid: 2,
        Shipped: 1,
        Completed: 1,
      });
    });

    it('should filter by platform', async () => {
      // The query calls eq() twice: first for user_id, then for platform
      // The second eq() returns the promise with data
      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockImplementation((field: string, _value: string) => {
          if (field === 'platform') {
            return Promise.resolve({ data: [], error: null });
          }
          return mockQuery; // Return self for user_id call to chain
        }),
      };
      mockSupabase.from.mockReturnValue(mockQuery);

      await repository.getStats('test-user-id', 'bricklink');

      expect(mockQuery.eq).toHaveBeenCalledWith('platform', 'bricklink');
    });

    it('should handle empty orders', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      });

      const result = await repository.getStats('test-user-id');

      expect(result.totalOrders).toBe(0);
      expect(result.totalRevenue).toBe(0);
      expect(result.ordersByStatus).toEqual({});
    });
  });
});
