import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrderFulfilmentService } from '../order-fulfilment.service';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';

// Create mock implementations at module level for access in tests
const mockFindByIdWithItems = vi.fn();
const mockFindById = vi.fn();
const mockProcessShippedOrder = vi.fn().mockResolvedValue(undefined);

// Mock dependencies with proper class pattern
vi.mock('../../repositories', () => ({
  OrderRepository: class MockOrderRepository {
    findByIdWithItems = mockFindByIdWithItems;
  },
  InventoryRepository: class MockInventoryRepository {
    findById = mockFindById;
  },
}));

vi.mock('../../amazon/amazon-inventory-linking.service', () => ({
  AmazonInventoryLinkingService: class MockAmazonInventoryLinkingService {
    processShippedOrder = mockProcessShippedOrder;
  },
}));

describe('OrderFulfilmentService', () => {
  let service: OrderFulfilmentService;
  let mockSupabase: ReturnType<typeof createMockSupabase>;

  // Track mock responses
  let nextResponse: unknown = { data: null, error: null };

  // Helper to create mock Supabase client with proper thenable chains
  function createMockSupabase() {
    const createThenable = () => {
      const thenable = {
        select: vi.fn().mockImplementation(() => createThenable()),
        update: vi.fn().mockImplementation(() => createThenable()),
        delete: vi.fn().mockImplementation(() => createThenable()),
        insert: vi.fn().mockImplementation(() => createThenable()),
        eq: vi.fn().mockImplementation(() => createThenable()),
        is: vi.fn().mockImplementation(() => createThenable()),
        in: vi.fn().mockImplementation(() => createThenable()),
        gte: vi.fn().mockImplementation(() => createThenable()),
        ilike: vi.fn().mockImplementation(() => createThenable()),
        not: vi.fn().mockImplementation(() => createThenable()),
        order: vi.fn().mockImplementation(() => createThenable()),
        single: vi.fn().mockImplementation(() => Promise.resolve(nextResponse)),
        // Make the chain thenable - this allows awaiting any point in the chain
        then: (resolve: (value: unknown) => void, reject?: (error: unknown) => void) => {
          return Promise.resolve(nextResponse).then(resolve, reject);
        },
      };
      return thenable;
    };

    const mockFrom = vi.fn().mockImplementation(() => createThenable());

    return {
      from: mockFrom,
      setNextResponse: (response: unknown) => {
        nextResponse = response;
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    nextResponse = { data: null, error: null };
    mockSupabase = createMockSupabase();
    service = new OrderFulfilmentService(mockSupabase as unknown as SupabaseClient<Database>);
  });

  describe('getOrdersReadyForConfirmation', () => {
    it('should fetch shipped Amazon orders ready for confirmation', async () => {
      const mockOrders = [
        {
          id: 'order-1',
          user_id: 'user-1',
          platform: 'amazon',
          platform_order_id: 'AMZ-123',
          status: 'Shipped',
          fulfilled_at: null,
          order_date: new Date().toISOString(),
        },
      ];

      mockSupabase.setNextResponse({ data: mockOrders, error: null });

      const result = await service.getOrdersReadyForConfirmation('user-1', 'amazon');

      expect(result).toHaveLength(1);
      expect(result[0].platform_order_id).toBe('AMZ-123');
    });

    it('should fetch shipped eBay orders ready for confirmation', async () => {
      const mockOrders = [
        {
          id: 'order-2',
          user_id: 'user-1',
          platform: 'ebay',
          platform_order_id: 'EBAY-456',
          status: 'Shipped',
          fulfilled_at: null,
          order_date: new Date().toISOString(),
        },
      ];

      mockSupabase.setNextResponse({ data: mockOrders, error: null });

      const result = await service.getOrdersReadyForConfirmation('user-1', 'ebay');

      expect(result).toHaveLength(1);
      expect(result[0].platform_order_id).toBe('EBAY-456');
    });

    it('should filter by max age days', async () => {
      mockSupabase.setNextResponse({ data: [], error: null });

      await service.getOrdersReadyForConfirmation('user-1', 'amazon', { maxAgeDays: 14 });

      expect(mockSupabase.from).toHaveBeenCalledWith('platform_orders');
    });

    it('should throw error on database failure', async () => {
      mockSupabase.setNextResponse({
        data: null,
        error: { message: 'Database error' },
      });

      await expect(
        service.getOrdersReadyForConfirmation('user-1', 'amazon')
      ).rejects.toThrow('Failed to fetch shipped Amazon orders');
    });

    it('should return empty array for unsupported platform', async () => {
      const result = await service.getOrdersReadyForConfirmation(
        'user-1',
        'unsupported' as 'amazon' | 'ebay'
      );

      expect(result).toEqual([]);
    });

    it('should handle empty result set', async () => {
      mockSupabase.setNextResponse({ data: [], error: null });

      const result = await service.getOrdersReadyForConfirmation('user-1', 'amazon');

      expect(result).toHaveLength(0);
    });

    it('should handle null data gracefully', async () => {
      mockSupabase.setNextResponse({ data: null, error: null });

      const result = await service.getOrdersReadyForConfirmation('user-1', 'amazon');

      expect(result).toHaveLength(0);
    });
  });

  describe('getUnfulfilledOrders (deprecated)', () => {
    it('should return empty array for eBay platform', async () => {
      const result = await service.getUnfulfilledOrders('user-1', 'ebay');

      expect(result).toEqual([]);
    });

    it('should fetch Amazon orders with various statuses', async () => {
      const mockOrders = [
        { id: 'order-1', status: 'Shipped' },
        { id: 'order-2', status: 'Unshipped' },
      ];

      mockSupabase.setNextResponse({ data: mockOrders, error: null });

      const result = await service.getUnfulfilledOrders('user-1', 'amazon');

      expect(result).toHaveLength(2);
    });
  });

  describe('matchOrderToInventory', () => {
    it('should throw error when order not found', async () => {
      mockFindByIdWithItems.mockResolvedValue(null);

      await expect(
        service.matchOrderToInventory('user-1', 'nonexistent-order', 'amazon')
      ).rejects.toThrow('Order nonexistent-order not found');
    });

    it('should return match result with all items matched', async () => {
      const mockOrder = {
        id: 'order-1',
        platform_order_id: 'AMZ-123',
        platform: 'amazon',
        buyer_name: 'John Doe',
        order_date: '2024-01-15',
        total: 99.99,
        items: [
          {
            id: 'item-1',
            item_number: 'B08N5LNQCX',
            item_name: 'LEGO Set 75192',
            quantity: 1,
            inventory_item_id: 'inv-1',
          },
        ],
      };

      mockFindByIdWithItems.mockResolvedValue(mockOrder);
      mockFindById.mockResolvedValue({
        id: 'inv-1',
        set_number: '75192',
        status: 'LISTED',
      });

      const result = await service.matchOrderToInventory('user-1', 'order-1', 'amazon');

      expect(result.orderId).toBe('order-1');
      expect(result.allMatched).toBe(true);
      expect(result.unmatchedCount).toBe(0);
    });

    it('should handle orders with no inventory link', async () => {
      const mockOrder = {
        id: 'order-1',
        platform_order_id: 'AMZ-123',
        platform: 'amazon',
        buyer_name: 'John Doe',
        order_date: '2024-01-15',
        total: 99.99,
        items: [
          {
            id: 'item-1',
            item_number: 'B08N5LNQCX',
            item_name: 'LEGO Set 75192',
            quantity: 1,
            inventory_item_id: null,
          },
        ],
      };

      mockFindByIdWithItems.mockResolvedValue(mockOrder);

      const result = await service.matchOrderToInventory('user-1', 'order-1', 'amazon');

      expect(result.allMatched).toBe(false);
      expect(result.unmatchedCount).toBe(1);
    });
  });

  describe('confirmOrdersFulfilled', () => {
    it('should return error when order not found', async () => {
      mockFindByIdWithItems.mockResolvedValue(null);

      const result = await service.confirmOrdersFulfilled('user-1', {
        orderIds: ['nonexistent'],
      });

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Order nonexistent not found');
    });

    it('should return error when order belongs to different user', async () => {
      const mockOrder = {
        id: 'order-1',
        user_id: 'other-user',
        platform: 'amazon',
        items: [],
      };

      mockFindByIdWithItems.mockResolvedValue(mockOrder);

      const result = await service.confirmOrdersFulfilled('user-1', {
        orderIds: ['order-1'],
      });

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Order order-1 does not belong to user');
    });

    it('should skip already fulfilled orders', async () => {
      const mockOrder = {
        id: 'order-1',
        user_id: 'user-1',
        platform_order_id: 'AMZ-123',
        platform: 'amazon',
        fulfilled_at: '2024-01-15T00:00:00Z',
        items: [],
      };

      mockFindByIdWithItems.mockResolvedValue(mockOrder);

      const result = await service.confirmOrdersFulfilled('user-1', {
        orderIds: ['order-1'],
      });

      expect(result.errors).toContain('Order AMZ-123 already fulfilled');
    });

    it('should process multiple orders', async () => {
      mockFindByIdWithItems
        .mockResolvedValueOnce({
          id: 'order-1',
          user_id: 'user-1',
          platform_order_id: 'AMZ-123',
          platform: 'amazon',
          fulfilled_at: null,
          items: [],
        })
        .mockResolvedValueOnce({
          id: 'order-2',
          user_id: 'user-1',
          platform_order_id: 'AMZ-456',
          platform: 'amazon',
          fulfilled_at: null,
          items: [],
        });

      const result = await service.confirmOrdersFulfilled('user-1', {
        orderIds: ['order-1', 'order-2'],
      });

      expect(result.ordersProcessed).toBe(2);
    });

    it('should update order as fulfilled after processing', async () => {
      const mockOrder = {
        id: 'order-1',
        user_id: 'user-1',
        platform_order_id: 'AMZ-123',
        platform: 'amazon',
        fulfilled_at: null,
        items: [
          {
            id: 'item-1',
            item_number: 'SKU123',
            inventory_item_id: 'inv-1',
            quantity: 1,
          },
        ],
      };

      mockFindByIdWithItems.mockResolvedValue(mockOrder);
      mockSupabase.setNextResponse({ data: mockOrder, error: null });

      const result = await service.confirmOrdersFulfilled('user-1', {
        orderIds: ['order-1'],
      });

      expect(result.ordersProcessed).toBe(1);
    });
  });

  describe('getOrdersForConfirmation', () => {
    it('should return match results for all ready orders', async () => {
      const mockOrders = [
        {
          id: 'order-1',
          platform_order_id: 'AMZ-123',
          platform: 'amazon',
          status: 'Shipped',
          fulfilled_at: null,
        },
      ];

      // First call for getOrdersReadyForConfirmation
      mockSupabase.setNextResponse({ data: mockOrders, error: null });

      // Set up findByIdWithItems for matchOrderToInventory
      mockFindByIdWithItems.mockResolvedValue({
        id: 'order-1',
        platform_order_id: 'AMZ-123',
        platform: 'amazon',
        buyer_name: 'Test Buyer',
        order_date: '2024-01-15',
        total: 50.00,
        items: [],
      });

      const results = await service.getOrdersForConfirmation('user-1', 'amazon');

      expect(results).toHaveLength(1);
      expect(results[0].platformOrderId).toBe('AMZ-123');
    });

    it('should handle empty orders list', async () => {
      mockSupabase.setNextResponse({ data: [], error: null });

      const results = await service.getOrdersForConfirmation('user-1', 'amazon');

      expect(results).toHaveLength(0);
    });
  });

  describe('matchOrderToInventory - detailed matching', () => {
    it('should return all matched when items have inventory linked', async () => {
      const mockOrder = {
        id: 'order-1',
        platform_order_id: 'AMZ-123',
        platform: 'amazon',
        buyer_name: 'Test Buyer',
        order_date: '2024-01-15',
        total: 149.99,
        items: [
          {
            id: 'item-1',
            item_number: 'B08N5LNQCX',
            item_name: 'LEGO Set 75192',
            quantity: 1,
            inventory_item_id: 'inv-1',
          },
          {
            id: 'item-2',
            item_number: 'B07ABCDEF',
            item_name: 'LEGO Set 10179',
            quantity: 1,
            inventory_item_id: 'inv-2',
          },
        ],
      };

      mockFindByIdWithItems.mockResolvedValue(mockOrder);
      mockFindById
        .mockResolvedValueOnce({ id: 'inv-1', set_number: '75192', status: 'LISTED' })
        .mockResolvedValueOnce({ id: 'inv-2', set_number: '10179', status: 'LISTED' });

      const result = await service.matchOrderToInventory('user-1', 'order-1', 'amazon');

      expect(result.allMatched).toBe(true);
      expect(result.unmatchedCount).toBe(0);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].matchStatus).toBe('matched');
      expect(result.items[1].matchStatus).toBe('matched');
    });

    it('should handle mixed matched and unmatched items', async () => {
      const mockOrder = {
        id: 'order-1',
        platform_order_id: 'AMZ-123',
        platform: 'amazon',
        buyer_name: 'Test Buyer',
        order_date: '2024-01-15',
        total: 149.99,
        items: [
          {
            id: 'item-1',
            item_number: 'B08N5LNQCX',
            item_name: 'LEGO Set 75192',
            quantity: 1,
            inventory_item_id: 'inv-1', // Has inventory linked
          },
          {
            id: 'item-2',
            item_number: 'B07ABCDEF',
            item_name: 'LEGO Set 10179',
            quantity: 1,
            inventory_item_id: null, // No inventory linked
          },
        ],
      };

      mockFindByIdWithItems.mockResolvedValue(mockOrder);
      mockFindById.mockResolvedValueOnce({ id: 'inv-1', set_number: '75192', status: 'LISTED' });

      const result = await service.matchOrderToInventory('user-1', 'order-1', 'amazon');

      expect(result.allMatched).toBe(false);
      expect(result.unmatchedCount).toBe(1);
      expect(result.items[0].matchStatus).toBe('matched');
      expect(result.items[1].matchStatus).toBe('unmatched');
    });
  });

  describe('confirmOrdersFulfilled - detailed scenarios', () => {
    it('should update inventory with correct financial breakdown for single item order', async () => {
      const mockOrder = {
        id: 'order-1',
        user_id: 'user-1',
        platform_order_id: 'AMZ-123',
        platform: 'amazon',
        fulfilled_at: null,
        order_date: '2024-01-15',
        shipping: 5.99,
        fees: 12.50,
        items: [
          {
            id: 'item-1',
            item_number: 'SKU123',
            inventory_item_id: 'inv-1',
            quantity: 1,
            total_price: 99.99,
          },
        ],
      };

      mockFindByIdWithItems.mockResolvedValue(mockOrder);
      mockSupabase.setNextResponse({ data: mockOrder, error: null });

      const result = await service.confirmOrdersFulfilled('user-1', {
        orderIds: ['order-1'],
      });

      expect(result.ordersProcessed).toBe(1);
      expect(result.success).toBe(true);
    });

    it('should use manual item mappings when provided', async () => {
      const mockOrder = {
        id: 'order-1',
        user_id: 'user-1',
        platform_order_id: 'AMZ-123',
        platform: 'amazon',
        fulfilled_at: null,
        order_date: '2024-01-15',
        items: [
          {
            id: 'item-1',
            item_number: 'SKU123',
            inventory_item_id: null, // Not linked
            quantity: 1,
          },
        ],
      };

      mockFindByIdWithItems.mockResolvedValue(mockOrder);
      mockSupabase.setNextResponse({ data: mockOrder, error: null });

      const result = await service.confirmOrdersFulfilled('user-1', {
        orderIds: ['order-1'],
        itemMappings: { 'item-1': 'manual-inv-1' },
      });

      expect(result.ordersProcessed).toBe(1);
    });

    it('should use custom archive location when provided', async () => {
      const mockOrder = {
        id: 'order-1',
        user_id: 'user-1',
        platform_order_id: 'AMZ-123',
        platform: 'amazon',
        fulfilled_at: null,
        order_date: '2024-01-15',
        items: [],
      };

      mockFindByIdWithItems.mockResolvedValue(mockOrder);
      mockSupabase.setNextResponse({ data: mockOrder, error: null });

      const result = await service.confirmOrdersFulfilled('user-1', {
        orderIds: ['order-1'],
        archiveLocation: 'SOLD-CUSTOM-2024',
      });

      expect(result.ordersProcessed).toBe(1);
    });

    it('should handle errors for individual orders without failing entire batch', async () => {
      mockFindByIdWithItems
        .mockResolvedValueOnce({
          id: 'order-1',
          user_id: 'user-1',
          platform_order_id: 'AMZ-123',
          platform: 'amazon',
          fulfilled_at: null,
          items: [],
        })
        .mockResolvedValueOnce(null) // Second order not found
        .mockResolvedValueOnce({
          id: 'order-3',
          user_id: 'user-1',
          platform_order_id: 'AMZ-789',
          platform: 'amazon',
          fulfilled_at: null,
          items: [],
        });

      const result = await service.confirmOrdersFulfilled('user-1', {
        orderIds: ['order-1', 'order-2', 'order-3'],
      });

      expect(result.ordersProcessed).toBe(2);
      expect(result.errors).toContain('Order order-2 not found');
      expect(result.success).toBe(false);
    });

    it('should trigger Amazon linking service for Amazon orders', async () => {
      const mockOrder = {
        id: 'order-1',
        user_id: 'user-1',
        platform_order_id: 'AMZ-123',
        platform: 'amazon',
        fulfilled_at: null,
        order_date: '2024-01-15',
        items: [],
      };

      mockFindByIdWithItems.mockResolvedValue(mockOrder);
      mockSupabase.setNextResponse({ data: mockOrder, error: null });

      await service.confirmOrdersFulfilled('user-1', {
        orderIds: ['order-1'],
      });

      expect(mockProcessShippedOrder).toHaveBeenCalledWith('order-1', { mode: 'picklist' });
    });

    it('should not trigger Amazon linking for non-Amazon orders', async () => {
      const mockOrder = {
        id: 'order-1',
        user_id: 'user-1',
        platform_order_id: 'EBAY-123',
        platform: 'ebay',
        fulfilled_at: null,
        order_date: '2024-01-15',
        items: [],
      };

      mockFindByIdWithItems.mockResolvedValue(mockOrder);
      mockSupabase.setNextResponse({ data: mockOrder, error: null });

      await service.confirmOrdersFulfilled('user-1', {
        orderIds: ['order-1'],
      });

      expect(mockProcessShippedOrder).not.toHaveBeenCalled();
    });
  });

  describe('getOrdersReadyForConfirmation - edge cases', () => {
    it('should respect maxAgeDays option', async () => {
      const mockOrders = [
        {
          id: 'order-1',
          platform: 'amazon',
          status: 'Shipped',
          fulfilled_at: null,
          order_date: new Date().toISOString(),
        },
      ];

      mockSupabase.setNextResponse({ data: mockOrders, error: null });

      const result = await service.getOrdersReadyForConfirmation('user-1', 'amazon', {
        maxAgeDays: 30,
      });

      expect(result).toHaveLength(1);
      expect(mockSupabase.from).toHaveBeenCalledWith('platform_orders');
    });

    it('should handle eBay orders with COMPLETED status', async () => {
      const mockOrders = [
        {
          id: 'order-1',
          platform: 'ebay',
          status: 'COMPLETED',
          fulfilled_at: null,
        },
      ];

      mockSupabase.setNextResponse({ data: mockOrders, error: null });

      const result = await service.getOrdersReadyForConfirmation('user-1', 'ebay');

      expect(result).toHaveLength(1);
    });

    it('should throw error for eBay database failure', async () => {
      mockSupabase.setNextResponse({
        data: null,
        error: { message: 'Database error' },
      });

      await expect(
        service.getOrdersReadyForConfirmation('user-1', 'ebay')
      ).rejects.toThrow('Failed to fetch shipped eBay orders');
    });
  });

  describe('getUnfulfilledOrders (deprecated)', () => {
    it('should throw error on Amazon query failure', async () => {
      mockSupabase.setNextResponse({
        data: null,
        error: { message: 'Database error' },
      });

      await expect(service.getUnfulfilledOrders('user-1', 'amazon')).rejects.toThrow(
        'Failed to fetch unfulfilled Amazon orders'
      );
    });

    it('should include PartiallyShipped status for Amazon', async () => {
      const mockOrders = [
        { id: 'order-1', status: 'PartiallyShipped' },
      ];

      mockSupabase.setNextResponse({ data: mockOrders, error: null });

      const result = await service.getUnfulfilledOrders('user-1', 'amazon');

      expect(result).toHaveLength(1);
    });
  });
});
