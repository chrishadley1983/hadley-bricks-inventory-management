import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BricqerSyncService } from '../bricqer-sync.service';

// Mock the BricqerClient and related imports
const mockBricqerClient = {
  testConnection: vi.fn(),
  getSalesOrders: vi.fn(),
  getAllOrders: vi.fn(),
  getOrderWithItems: vi.fn(),
};

vi.mock('../../bricqer', () => ({
  BricqerClient: function MockBricqerClient() {
    return mockBricqerClient;
  },
  BricqerApiError: class BricqerApiError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
      this.name = 'BricqerApiError';
    }
  },
  BricqerRateLimitError: class BricqerRateLimitError extends Error {
    rateLimitInfo: { remaining: number; resetTime: Date; limit: number };
    constructor(message: string, rateLimitInfo: { remaining: number; resetTime: Date; limit: number }) {
      super(message);
      this.rateLimitInfo = rateLimitInfo;
      this.name = 'BricqerRateLimitError';
    }
  },
  BricqerAuthError: class BricqerAuthError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'BricqerAuthError';
    }
  },
  normalizeOrder: vi.fn((order, items) => ({
    platformOrderId: order.order_number || String(order.id) || 'BQ-123',
    orderDate: new Date('2024-12-20'),
    buyerName: 'Test Buyer',
    buyerEmail: 'buyer@test.com',
    status: 'Paid',
    subtotal: 100,
    shipping: 5,
    fees: 2,
    total: 107,
    currency: 'EUR',
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

describe('BricqerSyncService', () => {
  let service: BricqerSyncService;
  const mockSupabase = {
    from: vi.fn(),
  } as never;
  const testUserId = 'test-user-id';

  beforeEach(() => {
    vi.clearAllMocks();
    service = new BricqerSyncService(mockSupabase);

    // Default mock: credentials exist
    mockCredentialsRepo.getCredentials.mockResolvedValue({
      tenantUrl: 'https://test.bricqer.com',
      apiKey: 'test-api-key',
    });
    mockCredentialsRepo.hasCredentials.mockResolvedValue(true);
  });

  describe('testConnection', () => {
    it('should return true when connection is successful', async () => {
      mockBricqerClient.testConnection.mockResolvedValue(true);

      const result = await service.testConnection(testUserId);

      expect(result).toBe(true);
      expect(mockCredentialsRepo.getCredentials).toHaveBeenCalledWith(testUserId, 'bricqer');
    });

    it('should return false when connection fails', async () => {
      mockBricqerClient.testConnection.mockResolvedValue(false);

      const result = await service.testConnection(testUserId);

      expect(result).toBe(false);
    });

    it('should throw when credentials not configured', async () => {
      mockCredentialsRepo.getCredentials.mockResolvedValue(null);

      await expect(service.testConnection(testUserId)).rejects.toThrow(
        'Bricqer credentials not configured'
      );
    });
  });

  describe('testConnectionWithCredentials', () => {
    it('should test connection without reading from DB', async () => {
      mockBricqerClient.testConnection.mockResolvedValue(true);

      const result = await service.testConnectionWithCredentials({
        tenantUrl: 'https://direct.bricqer.com',
        apiKey: 'direct-api-key',
      });

      expect(result).toBe(true);
      expect(mockCredentialsRepo.getCredentials).not.toHaveBeenCalled();
    });
  });

  describe('saveCredentials', () => {
    it('should save credentials', async () => {
      const credentials = {
        tenantUrl: 'https://new.bricqer.com',
        apiKey: 'new-api-key',
      };

      await service.saveCredentials(testUserId, credentials);

      expect(mockCredentialsRepo.saveCredentials).toHaveBeenCalledWith(
        testUserId,
        'bricqer',
        credentials
      );
    });
  });

  describe('deleteCredentials', () => {
    it('should delete credentials', async () => {
      await service.deleteCredentials(testUserId);

      expect(mockCredentialsRepo.deleteCredentials).toHaveBeenCalledWith(testUserId, 'bricqer');
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
      { id: 1, order_number: 'BQ-001', status: 'Paid', total: 100 },
      { id: 2, order_number: 'BQ-002', status: 'Shipped', total: 150 },
    ];

    beforeEach(() => {
      mockBricqerClient.getAllOrders.mockResolvedValue(mockOrders);
      mockOrderRepo.findByPlatformOrderId.mockResolvedValue(null);
      mockOrderRepo.upsert.mockResolvedValue({ id: 'order-id' });
    });

    it('should sync orders successfully', async () => {
      const result = await service.syncOrders(testUserId);

      expect(result.success).toBe(true);
      expect(result.platform).toBe('bricqer');
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

    it('should use order_number for platform order ID when available', async () => {
      mockBricqerClient.getAllOrders.mockResolvedValue([
        { id: 1, order_number: 'BQ-001' },
      ]);

      await service.syncOrders(testUserId);

      expect(mockOrderRepo.findByPlatformOrderId).toHaveBeenCalledWith(
        testUserId,
        'bricqer',
        'BQ-001'
      );
    });

    it('should use id as fallback for platform order ID', async () => {
      mockBricqerClient.getAllOrders.mockResolvedValue([{ id: 123 }]);

      await service.syncOrders(testUserId);

      expect(mockOrderRepo.findByPlatformOrderId).toHaveBeenCalledWith(
        testUserId,
        'bricqer',
        '123'
      );
    });

    it('should call getAllOrders for both archived and active orders by default', async () => {
      await service.syncOrders(testUserId);

      expect(mockBricqerClient.getAllOrders).toHaveBeenCalledWith({ filed: true });
      expect(mockBricqerClient.getAllOrders).toHaveBeenCalledWith({ filed: false });
    });

    it('should include items when requested', async () => {
      mockBricqerClient.getAllOrders.mockResolvedValue([{ id: 1, order_number: 'BQ-001' }]);
      mockBricqerClient.getOrderWithItems.mockResolvedValue({
        order: { id: 1, order_number: 'BQ-001' },
        items: [{ id: 'item-1', quantity: 2 }],
      });

      await service.syncOrders(testUserId, { includeItems: true });

      expect(mockBricqerClient.getOrderWithItems).toHaveBeenCalledWith(1);
    });

    it('should handle order processing errors', async () => {
      mockOrderRepo.upsert.mockRejectedValueOnce(new Error('Database error'));

      const result = await service.syncOrders(testUserId);

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('BQ-001');
      expect(result.errors[0]).toContain('Database error');
    });

    it('should handle rate limit errors', async () => {
      const { BricqerRateLimitError } = await import('../../bricqer');
      mockBricqerClient.getAllOrders.mockRejectedValue(
        new BricqerRateLimitError('Rate limited', {
          remaining: 0,
          resetTime: new Date('2024-12-20T12:00:00Z'),
          limit: 100,
        })
      );

      const result = await service.syncOrders(testUserId);

      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('Rate limit exceeded');
    });

    it('should handle auth errors', async () => {
      const { BricqerAuthError } = await import('../../bricqer');
      mockBricqerClient.getAllOrders.mockRejectedValue(
        new BricqerAuthError('Invalid credentials')
      );

      const result = await service.syncOrders(testUserId);

      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('Authentication error');
    });

    it('should handle API errors', async () => {
      const { BricqerApiError } = await import('../../bricqer');
      mockBricqerClient.getAllOrders.mockRejectedValue(
        new BricqerApiError('Invalid request', 'BAD_REQUEST')
      );

      const result = await service.syncOrders(testUserId);

      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('Bricqer API error');
      expect(result.errors[0]).toContain('BAD_REQUEST');
    });

    it('should handle unknown errors', async () => {
      mockBricqerClient.getAllOrders.mockRejectedValue('Unknown error string');

      const result = await service.syncOrders(testUserId);

      expect(result.success).toBe(false);
      expect(result.errors[0]).toBe('Unknown error');
    });
  });

  describe('syncOrderById', () => {
    beforeEach(() => {
      mockBricqerClient.getOrderWithItems.mockResolvedValue({
        order: { id: 123, order_number: 'BQ-123' },
        items: [{ id: 'item-1', quantity: 1 }],
      });
      mockOrderRepo.upsert.mockResolvedValue({ id: 'saved-order-id' });
    });

    it('should sync a single order by string ID', async () => {
      const result = await service.syncOrderById(testUserId, 'BQ-123');

      expect(result.platformOrderId).toBe('BQ-123');
      expect(mockBricqerClient.getOrderWithItems).toHaveBeenCalledWith('BQ-123');
      expect(mockOrderRepo.upsert).toHaveBeenCalled();
    });

    it('should sync a single order by numeric ID', async () => {
      await service.syncOrderById(testUserId, 123);

      expect(mockBricqerClient.getOrderWithItems).toHaveBeenCalledWith(123);
    });

    it('should save items by default', async () => {
      const { normalizeOrder } = await import('../../bricqer');
      vi.mocked(normalizeOrder).mockReturnValue({
        platformOrderId: 'BQ-123',
        platform: 'bricqer',
        orderDate: new Date(),
        buyerName: 'Test',
        buyerEmail: 'test@test.com',
        status: 'Paid',
        subtotal: 100,
        shipping: 5,
        fees: 2,
        total: 107,
        currency: 'EUR',
        shippingAddress: { name: 'Test Buyer', countryCode: 'NL' },
        trackingNumber: undefined,
        items: [
          {
            itemNumber: 'SET-123',
            itemName: 'Test Set',
            itemType: 'Set',
            colorId: undefined,
            colorName: undefined,
            quantity: 1,
            condition: 'New',
            unitPrice: 100,
            totalPrice: 100,
            currency: 'EUR',
          },
        ],
        rawData: { id: 123, status: 'READY', items: [] },
      });

      await service.syncOrderById(testUserId, 123);

      expect(mockOrderRepo.replaceOrderItems).toHaveBeenCalledWith('saved-order-id', [
        expect.objectContaining({ item_number: 'SET-123' }),
      ]);
    });

    it('should skip items when includeItems is false', async () => {
      await service.syncOrderById(testUserId, 123, false);

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
      mockOrderRepo.getStats.mockResolvedValue({ totalOrders: 75 });

      // Mock the supabase query chain on the service's supabase property
      const mockQueryResult = { data: [{ synced_at: '2024-12-20T10:00:00Z' }] };
      const mockSupabaseQuery = {
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

      // The service uses this.supabase directly for the query
      Object.defineProperty(service, 'supabase', {
        value: mockSupabaseQuery,
        writable: true,
      });

      const result = await service.getSyncStatus(testUserId);

      expect(result.isConfigured).toBe(true);
      expect(result.totalOrders).toBe(75);
    });

    it('should handle null lastSyncedAt', async () => {
      mockCredentialsRepo.hasCredentials.mockResolvedValue(true);
      mockOrderRepo.getStats.mockResolvedValue({ totalOrders: 0 });

      const mockQueryResult = { data: [] };
      Object.defineProperty(service, 'supabase', {
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
