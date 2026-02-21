import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AmazonSyncService } from '../amazon-sync.service';

// Mock AmazonClient and related imports
const mockAmazonClient = {
  testConnection: vi.fn(),
  getOrders: vi.fn(),
  getAllOrders: vi.fn(),
  getOrderItems: vi.fn(),
  getOrderWithItems: vi.fn(),
  getUnshippedOrders: vi.fn(),
};

vi.mock('../../amazon', () => ({
  AmazonClient: function MockAmazonClient() {
    return mockAmazonClient;
  },
  AmazonApiError: class AmazonApiError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
      this.name = 'AmazonApiError';
    }
  },
  AmazonRateLimitError: class AmazonRateLimitError extends Error {
    rateLimitInfo: { remaining: number; resetTime: Date; limit: number };
    constructor(
      message: string,
      rateLimitInfo: { remaining: number; resetTime: Date; limit: number }
    ) {
      super(message);
      this.rateLimitInfo = rateLimitInfo;
      this.name = 'AmazonRateLimitError';
    }
  },
  AmazonAuthError: class AmazonAuthError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'AmazonAuthError';
    }
  },
  normalizeOrder: vi.fn((order, items) => ({
    platformOrderId: order.AmazonOrderId || 'AMZ-123',
    orderDate: new Date('2024-12-20'),
    buyerName: 'Test Buyer',
    buyerEmail: 'buyer@test.com',
    status: 'Shipped',
    subtotal: 25.99,
    shipping: 3.99,
    fees: 0,
    total: 29.98,
    currency: 'GBP',
    shippingAddress: { line1: '123 Test St' },
    marketplace: 'Amazon.co.uk',
    marketplaceId: 'A1F83G8C2ARO7P',
    fulfillmentChannel: 'MFN',
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

// Suppress console logs during tests
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

describe('AmazonSyncService', () => {
  let service: AmazonSyncService;
  const mockSupabase = {
    from: vi.fn(),
  } as never;
  const testUserId = 'test-user-123';

  const mockCredentials = {
    sellerId: 'TEST_SELLER',
    marketplaceIds: ['A1F83G8C2ARO7P'],
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    refreshToken: 'test-refresh-token',
  };

  beforeEach(() => {
    vi.resetAllMocks();
    service = new AmazonSyncService(mockSupabase);

    // Default mock: credentials exist
    mockCredentialsRepo.getCredentials.mockResolvedValue(mockCredentials);
    mockCredentialsRepo.hasCredentials.mockResolvedValue(true);
  });

  describe('testConnection', () => {
    it('should return true when connection is successful', async () => {
      mockAmazonClient.testConnection.mockResolvedValue(true);

      const result = await service.testConnection(testUserId);

      expect(result).toBe(true);
      expect(mockCredentialsRepo.getCredentials).toHaveBeenCalledWith(testUserId, 'amazon');
    });

    it('should return false when connection fails', async () => {
      mockAmazonClient.testConnection.mockResolvedValue(false);

      const result = await service.testConnection(testUserId);

      expect(result).toBe(false);
    });

    it('should throw when credentials not configured', async () => {
      mockCredentialsRepo.getCredentials.mockResolvedValue(null);

      await expect(service.testConnection(testUserId)).rejects.toThrow(
        'Amazon credentials not configured'
      );
    });
  });

  describe('testConnectionWithCredentials', () => {
    it('should test connection without reading from DB', async () => {
      mockAmazonClient.testConnection.mockResolvedValue(true);

      const result = await service.testConnectionWithCredentials(mockCredentials);

      expect(result).toBe(true);
      expect(mockCredentialsRepo.getCredentials).not.toHaveBeenCalled();
    });
  });

  describe('saveCredentials', () => {
    it('should save credentials with default marketplaces when not provided', async () => {
      const credentialsWithoutMarketplaces = {
        ...mockCredentials,
        marketplaceIds: undefined,
      } as unknown as import('../../amazon').AmazonCredentials;

      await service.saveCredentials(testUserId, credentialsWithoutMarketplaces);

      expect(mockCredentialsRepo.saveCredentials).toHaveBeenCalledWith(
        testUserId,
        'amazon',
        expect.objectContaining({
          marketplaceIds: expect.arrayContaining(['A1F83G8C2ARO7P']),
        })
      );
    });

    it('should save credentials with provided marketplaces', async () => {
      const credentialsWithMarketplaces = {
        ...mockCredentials,
        marketplaceIds: ['A1PA6795UKMFR9'],
      };

      await service.saveCredentials(testUserId, credentialsWithMarketplaces);

      expect(mockCredentialsRepo.saveCredentials).toHaveBeenCalledWith(
        testUserId,
        'amazon',
        expect.objectContaining({
          marketplaceIds: ['A1PA6795UKMFR9'],
        })
      );
    });
  });

  describe('deleteCredentials', () => {
    it('should delete credentials', async () => {
      await service.deleteCredentials(testUserId);

      expect(mockCredentialsRepo.deleteCredentials).toHaveBeenCalledWith(testUserId, 'amazon');
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
      {
        AmazonOrderId: '408-1234567-8901234',
        OrderStatus: 'Shipped',
        PurchaseDate: '2024-12-20T10:00:00Z',
        OrderTotal: { Amount: '29.98', CurrencyCode: 'GBP' },
      },
      {
        AmazonOrderId: '408-1234567-8901235',
        OrderStatus: 'Shipped',
        PurchaseDate: '2024-12-21T10:00:00Z',
        OrderTotal: { Amount: '49.99', CurrencyCode: 'GBP' },
      },
    ];

    beforeEach(() => {
      mockAmazonClient.getAllOrders.mockResolvedValue(mockOrders);
      mockOrderRepo.findByPlatformOrderId.mockResolvedValue(null);
      mockOrderRepo.upsert.mockResolvedValue({ id: 'saved-order-id' });

      // Mock getMostRecentSyncDate (supabase query)
      (mockSupabase as { from: typeof vi.fn }).from = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      });
    });

    it('should sync orders successfully', async () => {
      const result = await service.syncOrders(testUserId);

      expect(result.success).toBe(true);
      expect(result.platform).toBe('amazon');
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

    it('should use fullSync option correctly', async () => {
      await service.syncOrders(testUserId, { fullSync: true });

      expect(mockAmazonClient.getAllOrders).toHaveBeenCalledWith(
        expect.objectContaining({
          LastUpdatedAfter: expect.any(String),
        })
      );
    });

    it('should use createdAfter option', async () => {
      const createdAfter = new Date('2024-12-01');
      await service.syncOrders(testUserId, { createdAfter });

      expect(mockAmazonClient.getAllOrders).toHaveBeenCalledWith(
        expect.objectContaining({
          CreatedAfter: createdAfter.toISOString(),
        })
      );
    });

    it('should use updatedAfter option for incremental sync', async () => {
      const updatedAfter = new Date('2024-12-15');
      await service.syncOrders(testUserId, { updatedAfter });

      expect(mockAmazonClient.getAllOrders).toHaveBeenCalledWith(
        expect.objectContaining({
          LastUpdatedAfter: updatedAfter.toISOString(),
        })
      );
    });

    it('should use statuses filter', async () => {
      await service.syncOrders(testUserId, { statuses: ['Shipped', 'Unshipped'] });

      expect(mockAmazonClient.getAllOrders).toHaveBeenCalledWith(
        expect.objectContaining({
          OrderStatuses: ['Shipped', 'Unshipped'],
        })
      );
    });

    it('should use merchantFulfilledOnly filter', async () => {
      await service.syncOrders(testUserId, { merchantFulfilledOnly: true });

      expect(mockAmazonClient.getAllOrders).toHaveBeenCalledWith(
        expect.objectContaining({
          FulfillmentChannels: ['MFN'],
        })
      );
    });

    it('should respect limit option', async () => {
      mockAmazonClient.getOrders.mockResolvedValue(mockOrders);

      await service.syncOrders(testUserId, { limit: 1 });

      expect(mockAmazonClient.getOrders).toHaveBeenCalledWith(
        expect.objectContaining({
          MaxResultsPerPage: 1,
        })
      );
    });

    it('should include items when requested', async () => {
      mockAmazonClient.getOrderItems.mockResolvedValue([
        {
          ASIN: 'B09ABC1234',
          Title: 'Test Item',
          QuantityOrdered: 1,
          ItemPrice: { Amount: '29.99', CurrencyCode: 'GBP' },
        },
      ]);

      await service.syncOrders(testUserId, { includeItems: true });

      expect(mockAmazonClient.getOrderItems).toHaveBeenCalledTimes(2);
    });

    it('should handle order processing errors', async () => {
      mockOrderRepo.upsert
        .mockRejectedValueOnce(new Error('Database error'))
        .mockResolvedValue({ id: 'saved-order-id' });

      const result = await service.syncOrders(testUserId);

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('408-1234567-8901234');
      expect(result.errors[0]).toContain('Database error');
    });

    it('should handle rate limit errors', async () => {
      const { AmazonRateLimitError } = await import('../../amazon');
      mockAmazonClient.getAllOrders.mockRejectedValue(
        new AmazonRateLimitError('Rate limited', {
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
      const { AmazonAuthError } = await import('../../amazon');
      mockAmazonClient.getAllOrders.mockRejectedValue(new AmazonAuthError('Invalid credentials'));

      const result = await service.syncOrders(testUserId);

      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('Authentication error');
    });

    it('should handle API errors', async () => {
      const { AmazonApiError } = await import('../../amazon');
      mockAmazonClient.getAllOrders.mockRejectedValue(
        new AmazonApiError('Invalid request', 'BAD_REQUEST')
      );

      const result = await service.syncOrders(testUserId);

      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('Amazon API error');
      expect(result.errors[0]).toContain('BAD_REQUEST');
    });

    it('should handle unknown errors', async () => {
      mockAmazonClient.getAllOrders.mockRejectedValue(new Error('Unknown error'));

      const result = await service.syncOrders(testUserId);

      expect(result.success).toBe(false);
      expect(result.errors[0]).toBe('Unknown error');
    });

    it('should use most recent sync date for incremental sync', async () => {
      // Mock supabase to return a previous sync date
      (mockSupabase as { from: typeof vi.fn }).from = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [{ synced_at: '2024-12-19T10:00:00Z' }],
          error: null,
        }),
      });

      await service.syncOrders(testUserId);

      expect(mockAmazonClient.getAllOrders).toHaveBeenCalledWith(
        expect.objectContaining({
          LastUpdatedAfter: expect.any(String),
        })
      );
    });

    it('should log status changes', async () => {
      mockOrderRepo.findByPlatformOrderId.mockResolvedValueOnce({
        id: 'existing-order',
        status: 'Unshipped',
      });

      await service.syncOrders(testUserId);

      // The log message contains the full status change in a single string
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('status change: Unshipped -> Shipped')
      );
    });
  });

  describe('syncOrderById', () => {
    beforeEach(() => {
      mockAmazonClient.getOrderWithItems.mockResolvedValue({
        order: {
          AmazonOrderId: '408-1234567-8901234',
          OrderStatus: 'Shipped',
          PurchaseDate: '2024-12-20T10:00:00Z',
        },
        items: [
          {
            ASIN: 'B09ABC1234',
            Title: 'Test Item',
            QuantityOrdered: 1,
          },
        ],
      });
      mockOrderRepo.upsert.mockResolvedValue({ id: 'saved-order-id' });
    });

    it('should sync a single order by ID', async () => {
      const result = await service.syncOrderById(testUserId, '408-1234567-8901234');

      // The mock normalizeOrder uses order.AmazonOrderId for platformOrderId
      expect(result.platformOrderId).toBe('408-1234567-8901234');
      expect(mockAmazonClient.getOrderWithItems).toHaveBeenCalledWith('408-1234567-8901234');
      expect(mockOrderRepo.upsert).toHaveBeenCalled();
    });

    it('should save items by default', async () => {
      const { normalizeOrder } = await import('../../amazon');
      vi.mocked(normalizeOrder).mockReturnValue({
        platformOrderId: '408-1234567-8901234',
        platform: 'amazon',
        orderDate: new Date(),
        buyerName: 'Test',
        buyerEmail: 'test@test.com',
        status: 'Shipped',
        subtotal: 25.99,
        shipping: 3.99,
        fees: 0,
        total: 29.98,
        currency: 'GBP',
        shippingAddress: { countryCode: 'GB' },
        marketplace: 'Amazon.co.uk',
        marketplaceId: 'A1F83G8C2ARO7P',
        fulfillmentChannel: 'MFN',
        items: [
          {
            asin: 'B09ABC1234',
            title: 'Test Item',
            quantity: 1,
            unitPrice: 25.99,
            totalPrice: 25.99,
            currency: 'GBP',
          },
        ],
        rawData: {},
      } as never);

      await service.syncOrderById(testUserId, '408-1234567-8901234');

      expect(mockOrderRepo.replaceOrderItems).toHaveBeenCalledWith(
        'saved-order-id',
        expect.arrayContaining([expect.objectContaining({ item_number: 'B09ABC1234' })])
      );
    });

    it('should skip items when includeItems is false', async () => {
      await service.syncOrderById(testUserId, '408-1234567-8901234', false);

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
      mockOrderRepo.getStats.mockResolvedValue({ totalOrders: 150 });

      // Mock supabase query for lastSyncedAt
      (mockSupabase as { from: typeof vi.fn }).from = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [{ synced_at: '2024-12-20T10:00:00Z' }],
          error: null,
        }),
      });

      const result = await service.getSyncStatus(testUserId);

      expect(result.isConfigured).toBe(true);
      expect(result.totalOrders).toBe(150);
      expect(result.lastSyncedAt).toBeInstanceOf(Date);
    });

    it('should handle null lastSyncedAt', async () => {
      mockCredentialsRepo.hasCredentials.mockResolvedValue(true);
      mockOrderRepo.getStats.mockResolvedValue({ totalOrders: 0 });

      (mockSupabase as { from: typeof vi.fn }).from = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [],
          error: null,
        }),
      });

      const result = await service.getSyncStatus(testUserId);

      expect(result.lastSyncedAt).toBeNull();
    });
  });

  describe('getUnshippedOrders', () => {
    it('should fetch and normalize unshipped orders', async () => {
      mockAmazonClient.getUnshippedOrders.mockResolvedValue([
        {
          AmazonOrderId: '408-1234567-8901234',
          OrderStatus: 'Unshipped',
          PurchaseDate: '2024-12-20T10:00:00Z',
        },
      ]);

      const result = await service.getUnshippedOrders(testUserId);

      expect(result).toHaveLength(1);
      expect(mockAmazonClient.getUnshippedOrders).toHaveBeenCalled();
    });
  });

  describe('internal status mapping', () => {
    beforeEach(() => {
      mockAmazonClient.getAllOrders.mockResolvedValue([
        {
          AmazonOrderId: '408-1234567-8901234',
          OrderStatus: 'Shipped',
        },
      ]);
      mockOrderRepo.findByPlatformOrderId.mockResolvedValue(null);
      mockOrderRepo.upsert.mockResolvedValue({ id: 'saved-order-id' });

      (mockSupabase as { from: typeof vi.fn }).from = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      });
    });

    it('should map Shipped status to internal Shipped', async () => {
      const { normalizeOrder } = await import('../../amazon');
      vi.mocked(normalizeOrder).mockReturnValue({
        platformOrderId: '408-1234567-8901234',
        orderDate: new Date(),
        buyerName: 'Test',
        status: 'Shipped',
        subtotal: 0,
        shipping: 0,
        fees: 0,
        total: 0,
        currency: 'GBP',
        shippingAddress: {},
        items: [],
        rawData: {},
      } as never);

      await service.syncOrders(testUserId);

      expect(mockOrderRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          internal_status: 'Shipped',
        })
      );
    });

    it('should map Pending status to internal Pending', async () => {
      const { normalizeOrder } = await import('../../amazon');
      vi.mocked(normalizeOrder).mockReturnValue({
        platformOrderId: '408-1234567-8901234',
        orderDate: new Date(),
        buyerName: 'Test',
        status: 'Pending',
        subtotal: 0,
        shipping: 0,
        fees: 0,
        total: 0,
        currency: 'GBP',
        shippingAddress: {},
        items: [],
        rawData: {},
      } as never);

      await service.syncOrders(testUserId);

      expect(mockOrderRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          internal_status: 'Pending',
        })
      );
    });

    it('should map Cancelled/Refunded status to internal Cancelled', async () => {
      const { normalizeOrder } = await import('../../amazon');
      vi.mocked(normalizeOrder).mockReturnValue({
        platformOrderId: '408-1234567-8901234',
        orderDate: new Date(),
        buyerName: 'Test',
        status: 'Cancelled/Refunded',
        subtotal: 0,
        shipping: 0,
        fees: 0,
        total: 0,
        currency: 'GBP',
        shippingAddress: {},
        items: [],
        rawData: {},
      } as never);

      await service.syncOrders(testUserId);

      expect(mockOrderRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          internal_status: 'Cancelled',
        })
      );
    });
  });
});
