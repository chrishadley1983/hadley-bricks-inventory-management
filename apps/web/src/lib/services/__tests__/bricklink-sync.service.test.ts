import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrickLinkSyncService } from '../bricklink-sync.service';

// Mock the BrickLink client module
const mockBrickLinkClient = {
  getSalesOrders: vi.fn(),
  getOrderWithItems: vi.fn(),
  testConnection: vi.fn(),
};

vi.mock('../../bricklink', () => ({
  BrickLinkClient: function MockBrickLinkClient() {
    return mockBrickLinkClient;
  },
  BrickLinkApiError: class BrickLinkApiError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
  RateLimitError: class RateLimitError extends Error {
    rateLimitInfo: { remaining: number; resetTime: Date; dailyLimit: number; dailyRemaining: number };
    constructor(message: string, rateLimitInfo: { remaining: number; resetTime: Date; dailyLimit: number; dailyRemaining: number }) {
      super(message);
      this.rateLimitInfo = rateLimitInfo;
    }
  },
  normalizeOrder: vi.fn((order, items) => ({
    platformOrderId: String(order.order_id),
    orderDate: new Date(order.date_ordered || '2024-12-20'),
    buyerName: order.buyer_name || 'Test Buyer',
    buyerEmail: order.buyer_email || 'test@example.com',
    status: order.status || 'Paid',
    subtotal: order.disp_cost?.subtotal || 100,
    shipping: order.disp_cost?.shipping || 10,
    fees: 0,
    total: order.disp_cost?.grand_total || 110,
    currency: 'GBP',
    shippingAddress: {},
    trackingNumber: null,
    items: items || [],
    rawData: order,
  })),
}));

// Mock supabase query for getSyncStatus (used by orderRepo internally)
const mockSupabaseQuery = {
  from: vi.fn(),
};

// Mock the repositories
const mockOrderRepo = {
  findByPlatformOrderId: vi.fn(),
  upsert: vi.fn(),
  replaceOrderItems: vi.fn(),
  getStats: vi.fn(),
  getOrderStatusTimestamps: vi.fn(),
  supabase: mockSupabaseQuery,
};

const mockCredentialsRepo = {
  getCredentials: vi.fn(),
  saveCredentials: vi.fn(),
  hasCredentials: vi.fn(),
};

vi.mock('../../repositories', () => ({
  OrderRepository: function MockOrderRepository() {
    return mockOrderRepo;
  },
  CredentialsRepository: function MockCredentialsRepository() {
    return mockCredentialsRepo;
  },
}));

describe('BrickLinkSyncService', () => {
  let service: BrickLinkSyncService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockSupabase: any = {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      }),
    }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new BrickLinkSyncService(mockSupabase);
  });

  describe('testConnection', () => {
    it('should return true when connection is successful', async () => {
      mockCredentialsRepo.getCredentials.mockResolvedValue({
        consumerKey: 'test-key',
        consumerSecret: 'test-secret',
        tokenValue: 'test-token',
        tokenSecret: 'test-token-secret',
      });
      mockBrickLinkClient.testConnection.mockResolvedValue(true);

      const result = await service.testConnection('test-user-id');

      expect(result).toBe(true);
      expect(mockCredentialsRepo.getCredentials).toHaveBeenCalledWith(
        'test-user-id',
        'bricklink'
      );
    });

    it('should throw error when credentials not configured', async () => {
      mockCredentialsRepo.getCredentials.mockResolvedValue(null);

      await expect(service.testConnection('test-user-id')).rejects.toThrow(
        'BrickLink credentials not configured'
      );
    });

    it('should return false when connection fails', async () => {
      mockCredentialsRepo.getCredentials.mockResolvedValue({
        consumerKey: 'test-key',
        consumerSecret: 'test-secret',
        tokenValue: 'test-token',
        tokenSecret: 'test-token-secret',
      });
      mockBrickLinkClient.testConnection.mockResolvedValue(false);

      const result = await service.testConnection('test-user-id');

      expect(result).toBe(false);
    });
  });

  describe('testConnectionWithCredentials', () => {
    it('should test connection with provided credentials', async () => {
      const credentials = {
        consumerKey: 'provided-key',
        consumerSecret: 'provided-secret',
        tokenValue: 'provided-token',
        tokenSecret: 'provided-token-secret',
      };
      mockBrickLinkClient.testConnection.mockResolvedValue(true);

      const result = await service.testConnectionWithCredentials(credentials);

      expect(result).toBe(true);
    });
  });

  describe('saveCredentials', () => {
    it('should save credentials through repository', async () => {
      const credentials = {
        consumerKey: 'test-key',
        consumerSecret: 'test-secret',
        tokenValue: 'test-token',
        tokenSecret: 'test-token-secret',
      };
      mockCredentialsRepo.saveCredentials.mockResolvedValue(undefined);

      await service.saveCredentials('test-user-id', credentials);

      expect(mockCredentialsRepo.saveCredentials).toHaveBeenCalledWith(
        'test-user-id',
        'bricklink',
        credentials
      );
    });
  });

  describe('isConfigured', () => {
    it('should return true when credentials exist', async () => {
      mockCredentialsRepo.hasCredentials.mockResolvedValue(true);

      const result = await service.isConfigured('test-user-id');

      expect(result).toBe(true);
      expect(mockCredentialsRepo.hasCredentials).toHaveBeenCalledWith(
        'test-user-id',
        'bricklink'
      );
    });

    it('should return false when no credentials', async () => {
      mockCredentialsRepo.hasCredentials.mockResolvedValue(false);

      const result = await service.isConfigured('test-user-id');

      expect(result).toBe(false);
    });
  });

  describe('syncOrders', () => {
    beforeEach(() => {
      mockCredentialsRepo.getCredentials.mockResolvedValue({
        consumerKey: 'test-key',
        consumerSecret: 'test-secret',
        tokenValue: 'test-token',
        tokenSecret: 'test-token-secret',
      });
    });

    it('should sync orders successfully', async () => {
      const mockOrders = [
        { order_id: 123, status: 'Paid', disp_cost: { grand_total: 100 } },
        { order_id: 456, status: 'Shipped', disp_cost: { grand_total: 200 } },
      ];

      mockBrickLinkClient.getSalesOrders.mockResolvedValue(mockOrders);
      mockOrderRepo.findByPlatformOrderId.mockResolvedValue(null);
      mockOrderRepo.upsert.mockImplementation((order) =>
        Promise.resolve({ id: 'new-id', ...order })
      );

      const result = await service.syncOrders('test-user-id');

      expect(result.success).toBe(true);
      expect(result.ordersProcessed).toBe(2);
      expect(result.ordersCreated).toBe(2);
      expect(result.ordersUpdated).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should track updated orders when they exist', async () => {
      const mockOrders = [{
        order_id: 123,
        status: 'Paid',
        disp_cost: { grand_total: 100 },
        date_status_changed: '2024-12-20T12:00:00Z' // newer than existing
      }];

      mockBrickLinkClient.getSalesOrders.mockResolvedValue(mockOrders);
      mockBrickLinkClient.getOrderWithItems.mockResolvedValue({
        order: mockOrders[0],
        items: [],
      });
      // Return a map with the existing order having an older timestamp
      mockOrderRepo.getOrderStatusTimestamps.mockResolvedValue(
        new Map([['123', new Date('2024-12-19T12:00:00Z')]])
      );
      mockOrderRepo.upsert.mockResolvedValue({ id: 'existing-id' });
      mockOrderRepo.replaceOrderItems.mockResolvedValue([]);

      // includeItems: true is needed to trigger the update check
      const result = await service.syncOrders('test-user-id', { includeItems: true });

      expect(result.ordersUpdated).toBe(1);
      expect(result.ordersCreated).toBe(0);
    });

    it('should sync with items when includeItems is true', async () => {
      const mockOrders = [{ order_id: 123, status: 'Paid' }];
      const mockItems = [
        { item_no: '75192', quantity: 1, unit_price: 100 },
      ];

      mockBrickLinkClient.getSalesOrders.mockResolvedValue(mockOrders);
      mockBrickLinkClient.getOrderWithItems.mockResolvedValue({
        order: mockOrders[0],
        items: mockItems,
      });
      // Empty map means all orders are new
      mockOrderRepo.getOrderStatusTimestamps.mockResolvedValue(new Map());
      mockOrderRepo.upsert.mockResolvedValue({ id: 'new-id' });
      mockOrderRepo.replaceOrderItems.mockResolvedValue([]);

      const result = await service.syncOrders('test-user-id', { includeItems: true });

      expect(result.success).toBe(true);
      expect(mockBrickLinkClient.getOrderWithItems).toHaveBeenCalled();
    });

    it('should handle rate limit errors', async () => {
      const { RateLimitError } = await import('../../bricklink');
      mockBrickLinkClient.getSalesOrders.mockRejectedValue(
        new RateLimitError('Rate limit exceeded', {
          remaining: 0,
          resetTime: new Date('2024-12-20T12:00:00Z'),
          dailyLimit: 5000,
          dailyRemaining: 0,
        })
      );

      const result = await service.syncOrders('test-user-id');

      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('Rate limit exceeded');
    });

    it('should handle API errors', async () => {
      const { BrickLinkApiError } = await import('../../bricklink');
      mockBrickLinkClient.getSalesOrders.mockRejectedValue(
        new BrickLinkApiError('Invalid token', 401)
      );

      const result = await service.syncOrders('test-user-id');

      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('BrickLink API error');
    });

    it('should continue processing after single order error', async () => {
      const mockOrders = [
        { order_id: 123, status: 'Paid' },
        { order_id: 456, status: 'Shipped' },
      ];

      mockBrickLinkClient.getSalesOrders.mockResolvedValue(mockOrders);
      mockOrderRepo.findByPlatformOrderId.mockResolvedValue(null);
      mockOrderRepo.upsert
        .mockRejectedValueOnce(new Error('Database error'))
        .mockResolvedValueOnce({ id: 'new-id' });

      const result = await service.syncOrders('test-user-id');

      expect(result.ordersProcessed).toBe(2);
      expect(result.ordersCreated).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Order 123');
    });

    it('should include filed orders when includeFiled is true', async () => {
      mockBrickLinkClient.getSalesOrders.mockResolvedValue([]);

      await service.syncOrders('test-user-id', { includeFiled: true });

      expect(mockBrickLinkClient.getSalesOrders).toHaveBeenCalledWith(undefined, true);
    });
  });

  describe('syncOrderById', () => {
    beforeEach(() => {
      mockCredentialsRepo.getCredentials.mockResolvedValue({
        consumerKey: 'test-key',
        consumerSecret: 'test-secret',
        tokenValue: 'test-token',
        tokenSecret: 'test-token-secret',
      });
    });

    it('should sync a single order by ID', async () => {
      const mockOrder = { order_id: 123, status: 'Paid', buyer_name: 'John Doe' };
      const mockItems = [{ item_no: '75192', quantity: 1 }];

      mockBrickLinkClient.getOrderWithItems.mockResolvedValue({
        order: mockOrder,
        items: mockItems,
      });
      mockOrderRepo.upsert.mockResolvedValue({ id: 'saved-id' });
      mockOrderRepo.replaceOrderItems.mockResolvedValue([]);

      const result = await service.syncOrderById('test-user-id', 123);

      expect(result.platformOrderId).toBe('123');
      expect(mockBrickLinkClient.getOrderWithItems).toHaveBeenCalledWith(123);
      expect(mockOrderRepo.upsert).toHaveBeenCalled();
    });

    it('should save order items when present', async () => {
      const mockOrder = { order_id: 123, status: 'Paid' };
      const mockItems = [
        { item_no: '75192', quantity: 1, unit_price: 100 },
        { item_no: '76139', quantity: 2, unit_price: 50 },
      ];

      mockBrickLinkClient.getOrderWithItems.mockResolvedValue({
        order: mockOrder,
        items: mockItems,
      });
      mockOrderRepo.upsert.mockResolvedValue({ id: 'saved-id' });
      mockOrderRepo.replaceOrderItems.mockResolvedValue([]);

      await service.syncOrderById('test-user-id', 123);

      expect(mockOrderRepo.replaceOrderItems).toHaveBeenCalledWith(
        'saved-id',
        expect.any(Array)
      );
    });
  });

  describe('getSyncStatus', () => {
    it('should return not configured status when no credentials', async () => {
      mockCredentialsRepo.hasCredentials.mockResolvedValue(false);

      const result = await service.getSyncStatus('test-user-id');

      expect(result.isConfigured).toBe(false);
      expect(result.totalOrders).toBe(0);
      expect(result.lastSyncedAt).toBeNull();
    });

    it('should return sync status with order stats', async () => {
      mockCredentialsRepo.hasCredentials.mockResolvedValue(true);
      mockOrderRepo.getStats.mockResolvedValue({ totalOrders: 50 });
      mockSupabaseQuery.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [{ synced_at: '2024-12-20T10:00:00Z' }],
                  error: null,
                }),
              }),
            }),
          }),
        }),
      });

      const result = await service.getSyncStatus('test-user-id');

      expect(result.isConfigured).toBe(true);
      expect(result.totalOrders).toBe(50);
      expect(result.lastSyncedAt).toBeInstanceOf(Date);
    });

    it('should handle no synced orders', async () => {
      mockCredentialsRepo.hasCredentials.mockResolvedValue(true);
      mockOrderRepo.getStats.mockResolvedValue({ totalOrders: 0 });
      mockSupabaseQuery.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [],
                  error: null,
                }),
              }),
            }),
          }),
        }),
      });

      const result = await service.getSyncStatus('test-user-id');

      expect(result.isConfigured).toBe(true);
      expect(result.lastSyncedAt).toBeNull();
    });
  });
});
