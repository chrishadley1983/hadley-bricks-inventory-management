import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AmazonInventoryLinkingService } from '../amazon-inventory-linking.service';

// Mock Supabase server client
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

// Suppress console logs during tests
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

describe('AmazonInventoryLinkingService', () => {
  let service: AmazonInventoryLinkingService;
  let mockSupabase: ReturnType<typeof createMockSupabase>;
  const testUserId = 'test-user-123';

  // Create a properly chainable and thenable mock
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function createChainableMock(finalValue: unknown = { data: null, error: null }): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mock: Record<string, any> = {};

    // All chainable methods return mock
    const chainableMethods = [
      'select',
      'insert',
      'update',
      'upsert',
      'delete',
      'eq',
      'neq',
      'is',
      'not',
      'in',
      'ilike',
      'order',
      'limit',
      'range',
    ];

    chainableMethods.forEach((method) => {
      mock[method] = vi.fn().mockReturnValue(mock);
    });

    // Terminal methods return promises
    mock.single = vi.fn().mockResolvedValue(finalValue);

    // Make the mock itself thenable (for queries without .single())
    mock.then = (resolve: (value: unknown) => void) => {
      resolve(finalValue);
      return Promise.resolve(finalValue);
    };

    return mock;
  }

  function createMockSupabase() {
    const chainableMock = createChainableMock();

    return {
      from: vi.fn(() => chainableMock),
      chainableMock,
    };
  }

  beforeEach(() => {
    vi.resetAllMocks();
    mockSupabase = createMockSupabase();
    service = new AmazonInventoryLinkingService(mockSupabase as never, testUserId);
  });

  // ===========================================================================
  // Service Instantiation
  // ===========================================================================

  describe('service instantiation', () => {
    it('should create service with userId', () => {
      expect(service).toBeDefined();
      expect(service).toBeInstanceOf(AmazonInventoryLinkingService);
    });

    it('should have required public methods', () => {
      expect(typeof service.processShippedOrder).toBe('function');
      expect(typeof service.matchOrderItemToInventory).toBe('function');
      expect(typeof service.processHistoricalOrders).toBe('function');
      expect(typeof service.calculateNetSale).toBe('function');
      expect(typeof service.resolveQueueItem).toBe('function');
      expect(typeof service.skipQueueItem).toBe('function');
      expect(typeof service.searchInventory).toBe('function');
      expect(typeof service.getStats).toBe('function');
    });
  });

  // ===========================================================================
  // processShippedOrder
  // ===========================================================================

  describe('processShippedOrder', () => {
    it('should return error when order not found', async () => {
      mockSupabase.chainableMock.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'Not found' },
      });

      const result = await service.processShippedOrder('nonexistent-order');

      expect(result.orderId).toBe('nonexistent-order');
      expect(result.errors).toContain('Order not found: nonexistent-order');
    });

    it('should return complete status when no items need linking', async () => {
      const mockOrder = {
        id: 'order-123',
        user_id: testUserId,
        platform: 'amazon',
        platform_order_id: '408-1234567-8901234',
        order_date: '2024-12-20T10:00:00Z',
        status: 'Shipped',
      };

      // Order found
      mockSupabase.chainableMock.single.mockResolvedValueOnce({
        data: mockOrder,
        error: null,
      });

      // No order items to link (empty result)
      const fromMock = vi.fn(() => createChainableMock({ data: [], error: null }));
      mockSupabase.from = fromMock;

      const result = await service.processShippedOrder('order-123');

      expect(result.status).toBe('complete');
      expect(result.orderItemsProcessed).toBe(0);
    });

    it('should handle errors gracefully', async () => {
      mockSupabase.chainableMock.single.mockRejectedValueOnce(
        new Error('Database error')
      );

      const result = await service.processShippedOrder('order-123');

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Database error');
    });
  });

  // ===========================================================================
  // matchOrderItemToInventory
  // ===========================================================================

  describe('matchOrderItemToInventory', () => {
    const mockOrderItem = {
      id: 'item-123',
      order_id: 'order-123',
      item_number: 'B09ABC1234',
      item_name: 'LEGO Star Wars Set',
      quantity: 1,
      total_price: 29.99,
      unit_price: 29.99,
      inventory_item_id: null,
      amazon_linked_at: null,
    };

    const mockOrder = {
      id: 'order-123',
      user_id: testUserId,
      platform: 'amazon' as const,
      platform_order_id: 'AMZ-123',
      order_date: '2024-12-20T10:00:00Z',
      status: 'Shipped',
    };

    it('should return unmatched with reason no_asin when ASIN missing', async () => {
      const itemWithoutAsin = { ...mockOrderItem, item_number: null };

      const result = await service.matchOrderItemToInventory(
        itemWithoutAsin as never,
        mockOrder as never,
        'non_picklist'
      );

      expect(result.status).toBe('unmatched');
      expect(result.reason).toBe('no_asin');
    });

    it('should return unmatched when no inventory matches ASIN', async () => {
      // Mock inventory search returns empty
      mockSupabase.from = vi.fn(() => createChainableMock({ data: [], error: null }));

      const result = await service.matchOrderItemToInventory(
        mockOrderItem as never,
        mockOrder as never,
        'non_picklist'
      );

      expect(result.status).toBe('unmatched');
      expect(result.reason).toBe('no_matches');
    });
  });

  // ===========================================================================
  // processHistoricalOrders
  // ===========================================================================

  describe('processHistoricalOrders', () => {
    it('should call onProgress callback', async () => {
      const onProgress = vi.fn();

      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;

        // First call - get orders page 1
        if (callCount === 1) {
          return createChainableMock({
            data: [
              { id: 'order-1', platform_order_id: 'AMZ-001', order_date: '2024-12-20' },
            ],
            error: null,
          });
        }

        // Second call - get orders page 2 (empty)
        if (callCount === 2) {
          return createChainableMock({ data: [], error: null });
        }

        // Get order details
        if (callCount === 3) {
          const mock = createChainableMock();
          mock.single = vi.fn().mockResolvedValue({
            data: {
              id: 'order-1',
              user_id: testUserId,
              platform: 'amazon',
              platform_order_id: 'AMZ-001',
              status: 'Shipped',
            },
            error: null,
          });
          return mock;
        }

        // Get order items
        return createChainableMock({ data: [], error: null });
      });

      await service.processHistoricalOrders({ onProgress });

      expect(onProgress).toHaveBeenCalled();
    });

    it('should respect includeSold option', async () => {
      // Empty orders
      mockSupabase.from = vi.fn(() => createChainableMock({ data: [], error: null }));

      const result = await service.processHistoricalOrders({ includeSold: true });

      expect(result).toBeDefined();
      expect(result.ordersProcessed).toBe(0);
    });
  });

  // ===========================================================================
  // calculateNetSale
  // ===========================================================================

  describe('calculateNetSale', () => {
    it('should return pending_transaction when no transaction found', async () => {
      mockSupabase.from = vi.fn(() => createChainableMock({ data: null, error: null }));

      const result = await service.calculateNetSale('AMZ-123', 'B09ABC1234', 1);

      expect(result.status).toBe('pending_transaction');
    });
  });

  // ===========================================================================
  // resolveQueueItem
  // ===========================================================================

  describe('resolveQueueItem', () => {
    it('should return error when queue item not found', async () => {
      mockSupabase.from = vi.fn(() =>
        createChainableMock({ data: null, error: { message: 'Not found' } })
      );

      const result = await service.resolveQueueItem('nonexistent', ['inv-123']);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Queue item not found');
    });
  });

  // ===========================================================================
  // skipQueueItem
  // ===========================================================================

  describe('skipQueueItem', () => {
    it('should skip queue item with reason', async () => {
      mockSupabase.from = vi.fn(() => createChainableMock({ data: null, error: null }));

      const result = await service.skipQueueItem('queue-123', 'no_inventory');

      expect(result.success).toBe(true);
    });

    it('should return error on database failure', async () => {
      mockSupabase.from = vi.fn(() =>
        createChainableMock({ data: null, error: { message: 'Update failed' } })
      );

      const result = await service.skipQueueItem('queue-123', 'skipped');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Update failed');
    });
  });

  // ===========================================================================
  // searchInventory
  // ===========================================================================

  describe('searchInventory', () => {
    const mockInventory = {
      id: 'inv-123',
      amazon_asin: 'B09ABC1234',
      set_number: '75192',
      item_name: 'LEGO Star Wars',
      condition: 'New',
      storage_location: 'A1',
      listing_value: 29.99,
      listing_platform: 'amazon',
      cost: 20.0,
      status: 'LISTED',
    };

    it('should search by set number first', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;

        // Get linked IDs
        if (callCount === 1) {
          return createChainableMock({ data: [], error: null });
        }

        // Search by set number
        return createChainableMock({
          data: [mockInventory],
          error: null,
        });
      });

      const result = await service.searchInventory('75192');

      expect(result).toHaveLength(1);
      expect(result[0].set_number).toBe('75192');
    });
  });

  // ===========================================================================
  // getStats
  // ===========================================================================

  describe('getStats', () => {
    it('should return linking statistics', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;

        // Get orders
        if (callCount === 1) {
          return createChainableMock({
            data: [
              { inventory_link_status: 'complete' },
              { inventory_link_status: 'complete' },
              { inventory_link_status: 'partial' },
              { inventory_link_status: null },
            ],
            error: null,
          });
        }

        // Get pending queue count
        return createChainableMock({
          count: 5,
          error: null,
        });
      });

      const stats = await service.getStats();

      expect(stats.totalShippedOrders).toBe(4);
      expect(stats.linkedOrders).toBe(2);
      expect(stats.partialOrders).toBe(1);
      expect(stats.pendingOrders).toBe(1);
      expect(stats.pendingQueueItems).toBe(5);
    });

    it('should handle empty results', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;

        if (callCount === 1) {
          return createChainableMock({ data: [], error: null });
        }

        return createChainableMock({ count: 0, error: null });
      });

      const stats = await service.getStats();

      expect(stats.totalShippedOrders).toBe(0);
      expect(stats.linkedOrders).toBe(0);
      expect(stats.pendingQueueItems).toBe(0);
    });
  });
});
