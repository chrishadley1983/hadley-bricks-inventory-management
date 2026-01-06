import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrickOwlSyncService } from '../brickowl-sync.service';

// Mock the BrickOwlClient and related imports
const mockBrickOwlClient = {
  testConnection: vi.fn(),
  getSalesOrders: vi.fn(),
  getOrderWithItems: vi.fn(),
};

vi.mock('../../brickowl', () => ({
  BrickOwlClient: function MockBrickOwlClient() {
    return mockBrickOwlClient;
  },
  BrickOwlApiError: class BrickOwlApiError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
      this.name = 'BrickOwlApiError';
    }
  },
  BrickOwlRateLimitError: class BrickOwlRateLimitError extends Error {
    rateLimitInfo: { remaining: number; resetTime: Date; dailyLimit: number; dailyRemaining: number };
    constructor(message: string, rateLimitInfo: { remaining: number; resetTime: Date; dailyLimit: number; dailyRemaining: number }) {
      super(message);
      this.rateLimitInfo = rateLimitInfo;
      this.name = 'BrickOwlRateLimitError';
    }
  },
  normalizeOrder: vi.fn((order, items) => ({
    platformOrderId: order.order_id || 'BO-123',
    orderDate: new Date('2024-12-20'),
    buyerName: 'Test Buyer',
    buyerEmail: 'buyer@test.com',
    status: 'Paid',
    subtotal: 100,
    shipping: 5,
    fees: 2,
    total: 107,
    currency: 'GBP',
    shippingAddress: { line1: '123 Test St' },
    trackingNumber: null,
    items: items || [],
    rawData: order,
  })),
}));

// Mock repositories
const mockOrderRepo = {
  findByPlatformOrderId: vi.fn(),
  upsert: vi.fn(),
  replaceOrderItems: vi.fn(),
  getStats: vi.fn(),
};

const mockCredentialsRepo = {
  getCredentials: vi.fn(),
  saveCredentials: vi.fn(),
  deleteCredentials: vi.fn(),
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

describe('BrickOwlSyncService', () => {
  let service: BrickOwlSyncService;
  const mockSupabase = {} as never;
  const testUserId = 'test-user-id';

  beforeEach(() => {
    vi.clearAllMocks();
    service = new BrickOwlSyncService(mockSupabase);

    // Default mock: credentials exist
    mockCredentialsRepo.getCredentials.mockResolvedValue({
      apiKey: 'test-api-key',
    });
    mockCredentialsRepo.hasCredentials.mockResolvedValue(true);
  });

  describe('testConnection', () => {
    it('should return true when connection is successful', async () => {
      mockBrickOwlClient.testConnection.mockResolvedValue(true);

      const result = await service.testConnection(testUserId);

      expect(result).toBe(true);
      expect(mockCredentialsRepo.getCredentials).toHaveBeenCalledWith(testUserId, 'brickowl');
    });

    it('should return false when connection fails', async () => {
      mockBrickOwlClient.testConnection.mockResolvedValue(false);

      const result = await service.testConnection(testUserId);

      expect(result).toBe(false);
    });

    it('should throw when credentials not configured', async () => {
      mockCredentialsRepo.getCredentials.mockResolvedValue(null);

      await expect(service.testConnection(testUserId)).rejects.toThrow(
        'Brick Owl credentials not configured'
      );
    });
  });

  describe('testConnectionWithCredentials', () => {
    it('should test connection without reading from DB', async () => {
      mockBrickOwlClient.testConnection.mockResolvedValue(true);

      const result = await service.testConnectionWithCredentials({
        apiKey: 'direct-api-key',
      });

      expect(result).toBe(true);
      expect(mockCredentialsRepo.getCredentials).not.toHaveBeenCalled();
    });
  });

  describe('saveCredentials', () => {
    it('should save credentials', async () => {
      const credentials = { apiKey: 'new-api-key' };

      await service.saveCredentials(testUserId, credentials);

      expect(mockCredentialsRepo.saveCredentials).toHaveBeenCalledWith(
        testUserId,
        'brickowl',
        credentials
      );
    });
  });

  describe('deleteCredentials', () => {
    it('should delete credentials', async () => {
      await service.deleteCredentials(testUserId);

      expect(mockCredentialsRepo.deleteCredentials).toHaveBeenCalledWith(testUserId, 'brickowl');
    });
  });

  describe('isConfigured', () => {
    it('should return true when credentials exist', async () => {
      mockCredentialsRepo.hasCredentials.mockResolvedValue(true);

      const result = await service.isConfigured(testUserId);

      expect(result).toBe(true);
    });

    it('should return false when credentials do not exist', async () => {
      mockCredentialsRepo.hasCredentials.mockResolvedValue(false);

      const result = await service.isConfigured(testUserId);

      expect(result).toBe(false);
    });
  });

  describe('syncOrders', () => {
    const mockOrders = [
      { order_id: 'BO-001', status: 'Paid', total: 100 },
      { order_id: 'BO-002', status: 'Shipped', total: 150 },
    ];

    beforeEach(() => {
      mockBrickOwlClient.getSalesOrders.mockResolvedValue(mockOrders);
      mockOrderRepo.findByPlatformOrderId.mockResolvedValue(null);
      mockOrderRepo.upsert.mockResolvedValue({ id: 'order-id' });
    });

    it('should sync orders successfully', async () => {
      const result = await service.syncOrders(testUserId);

      expect(result.success).toBe(true);
      expect(result.platform).toBe('brickowl');
      expect(result.ordersProcessed).toBe(2);
      expect(result.ordersCreated).toBe(2);
      expect(result.ordersUpdated).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should count updated orders correctly', async () => {
      mockOrderRepo.findByPlatformOrderId
        .mockResolvedValueOnce({ id: 'existing-order' })
        .mockResolvedValueOnce(null);

      const result = await service.syncOrders(testUserId);

      expect(result.ordersCreated).toBe(1);
      expect(result.ordersUpdated).toBe(1);
    });

    it('should respect limit option', async () => {
      await service.syncOrders(testUserId, { limit: 10 });

      expect(mockBrickOwlClient.getSalesOrders).toHaveBeenCalledWith(undefined, 10);
    });

    it('should include items when requested', async () => {
      mockBrickOwlClient.getSalesOrders.mockResolvedValue([{ order_id: 'BO-001' }]);
      mockBrickOwlClient.getOrderWithItems.mockResolvedValue({
        order: { order_id: 'BO-001' },
        items: [{ lot_id: 'item-1', quantity: 2 }],
      });

      await service.syncOrders(testUserId, { includeItems: true });

      expect(mockBrickOwlClient.getOrderWithItems).toHaveBeenCalledWith('BO-001');
    });

    it('should handle order processing errors', async () => {
      mockOrderRepo.upsert.mockRejectedValueOnce(new Error('Database error'));

      const result = await service.syncOrders(testUserId);

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('BO-001');
      expect(result.errors[0]).toContain('Database error');
    });

    it('should handle rate limit errors', async () => {
      const { BrickOwlRateLimitError } = await import('../../brickowl');
      mockBrickOwlClient.getSalesOrders.mockRejectedValue(
        new BrickOwlRateLimitError('Rate limited', {
          remaining: 0,
          resetTime: new Date('2024-12-20T12:00:00Z'),
          dailyLimit: 5000,
          dailyRemaining: 0,
        })
      );

      const result = await service.syncOrders(testUserId);

      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('Rate limit exceeded');
    });

    it('should handle API errors', async () => {
      const { BrickOwlApiError } = await import('../../brickowl');
      mockBrickOwlClient.getSalesOrders.mockRejectedValue(
        new BrickOwlApiError('Invalid API key', 'INVALID_KEY')
      );

      const result = await service.syncOrders(testUserId);

      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('Brick Owl API error');
      expect(result.errors[0]).toContain('INVALID_KEY');
    });

    it('should handle unknown errors', async () => {
      mockBrickOwlClient.getSalesOrders.mockRejectedValue('Unknown error string');

      const result = await service.syncOrders(testUserId);

      expect(result.success).toBe(false);
      expect(result.errors[0]).toBe('Unknown error');
    });
  });

  describe('syncOrderById', () => {
    beforeEach(() => {
      mockBrickOwlClient.getOrderWithItems.mockResolvedValue({
        order: { order_id: 'BO-123' },
        items: [{ lot_id: 'item-1', quantity: 1 }],
      });
      mockOrderRepo.upsert.mockResolvedValue({ id: 'saved-order-id' });
    });

    it('should sync a single order', async () => {
      const result = await service.syncOrderById(testUserId, 'BO-123');

      expect(result.platformOrderId).toBe('BO-123');
      expect(mockBrickOwlClient.getOrderWithItems).toHaveBeenCalledWith('BO-123');
      expect(mockOrderRepo.upsert).toHaveBeenCalled();
    });

    it('should save items by default', async () => {
      const { normalizeOrder } = await import('../../brickowl');
      vi.mocked(normalizeOrder).mockReturnValue({
        platformOrderId: 'BO-123',
        platform: 'brickowl',
        orderDate: new Date(),
        buyerName: 'Test',
        buyerEmail: 'test@test.com',
        status: 'Paid',
        subtotal: 100,
        shipping: 5,
        fees: 2,
        total: 107,
        currency: 'GBP',
        shippingAddress: { name: 'Test Buyer', countryCode: 'GB' },
        trackingNumber: undefined,
        items: [
          {
            itemNumber: 'PART-1',
            itemName: 'Test Part',
            itemType: 'Part',
            colorId: 1,
            colorName: 'Black',
            quantity: 2,
            condition: 'New',
            unitPrice: 0.5,
            totalPrice: 1,
            currency: 'GBP',
          },
        ],
        rawData: {
          order_id: 'BO-123',
          status: 'Payment Received',
          order_time: '1734700800',
          iso_order_time: '2024-12-20T12:00:00Z',
          base_order_total: '100.00',
          order_total: '107.00',
          buyer_name: 'Test Buyer',
          ship_country_code: 'GB',
        },
      });

      await service.syncOrderById(testUserId, 'BO-123');

      expect(mockOrderRepo.replaceOrderItems).toHaveBeenCalledWith('saved-order-id', [
        expect.objectContaining({ item_number: 'PART-1' }),
      ]);
    });

    it('should skip items when includeItems is false', async () => {
      await service.syncOrderById(testUserId, 'BO-123', false);

      expect(mockOrderRepo.replaceOrderItems).not.toHaveBeenCalled();
    });
  });

  describe('getSyncStatus', () => {
    it('should return not configured status when credentials missing', async () => {
      mockCredentialsRepo.hasCredentials.mockResolvedValue(false);

      const result = await service.getSyncStatus(testUserId);

      expect(result).toEqual({
        isConfigured: false,
        totalOrders: 0,
        lastSyncedAt: null,
      });
    });

    it('should return sync status when configured', async () => {
      mockCredentialsRepo.hasCredentials.mockResolvedValue(true);
      mockOrderRepo.getStats.mockResolvedValue({ totalOrders: 50 });

      // Mock the supabase query chain
      const mockQueryResult = { data: [{ synced_at: '2024-12-20T10:00:00Z' }] };
      const mockSupabaseWithQuery = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue(mockQueryResult),
                }),
              }),
            }),
          }),
        }),
      };

      // Access private supabase property through orderRepo
      Object.defineProperty(mockOrderRepo, 'supabase', {
        value: mockSupabaseWithQuery,
        writable: true,
      });

      const result = await service.getSyncStatus(testUserId);

      expect(result.isConfigured).toBe(true);
      expect(result.totalOrders).toBe(50);
    });

    it('should handle null lastSyncedAt', async () => {
      mockCredentialsRepo.hasCredentials.mockResolvedValue(true);
      mockOrderRepo.getStats.mockResolvedValue({ totalOrders: 0 });

      const mockQueryResult = { data: [] };
      Object.defineProperty(mockOrderRepo, 'supabase', {
        value: {
          from: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue(mockQueryResult),
                  }),
                }),
              }),
            }),
          }),
        },
        writable: true,
      });

      const result = await service.getSyncStatus(testUserId);

      expect(result.lastSyncedAt).toBeNull();
    });
  });
});
