import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { AmazonBackfillService } from '../amazon-backfill.service';
import { AmazonRateLimitError } from '../../amazon';

// Mock repositories
const mockOrderRepo = {
  replaceOrderItems: vi.fn(),
};

const mockCredentialsRepo = {
  getCredentials: vi.fn(),
};

vi.mock('../../repositories', () => ({
  OrderRepository: function MockOrderRepository() {
    return mockOrderRepo;
  },
  CredentialsRepository: function MockCredentialsRepository() {
    return mockCredentialsRepo;
  },
}));

// Mock Amazon client
const mockAmazonClient = {
  getOrderItems: vi.fn(),
};

vi.mock('../../amazon', () => ({
  AmazonClient: class MockAmazonClient {
    getOrderItems = mockAmazonClient.getOrderItems;
  },
  AmazonRateLimitError: class AmazonRateLimitError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'AmazonRateLimitError';
    }
  },
}));

describe('AmazonBackfillService', () => {
  let service: AmazonBackfillService;
  const userId = 'test-user-id';

  // Mock Supabase client
  const mockSupabase = {
    from: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new AmazonBackfillService(mockSupabase as any);
  });

  afterEach(() => {
    vi.useRealTimers();
    service.clearProgress(userId);
  });

  describe('getProgress', () => {
    it('should return initial progress state', () => {
      const progress = service.getProgress(userId);

      expect(progress.total).toBe(0);
      expect(progress.processed).toBe(0);
      expect(progress.success).toBe(0);
      expect(progress.failed).toBe(0);
      expect(progress.isRunning).toBe(false);
      expect(progress.startedAt).toBeNull();
      expect(progress.errors).toHaveLength(0);
    });
  });

  describe('getOrdersNeedingBackfill', () => {
    it('should return orders with 0 or null items_count', async () => {
      const mockOrders = [
        { id: 'order-1', platform_order_id: 'AMZ-001', items_count: 0 },
        { id: 'order-2', platform_order_id: 'AMZ-002', items_count: null },
      ];

      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: mockOrders, error: null })),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      const result = await service.getOrdersNeedingBackfill(userId);

      expect(result).toHaveLength(2);
      expect(mockBuilder.eq).toHaveBeenCalledWith('user_id', userId);
      expect(mockBuilder.eq).toHaveBeenCalledWith('platform', 'amazon');
      expect(mockBuilder.or).toHaveBeenCalledWith('items_count.eq.0,items_count.is.null');
    });

    it('should handle pagination for large result sets', async () => {
      // First page: full page of 1000
      const firstPage = Array.from({ length: 1000 }, (_, i) => ({
        id: `order-${i}`,
        platform_order_id: `AMZ-${i}`,
        items_count: 0,
      }));

      // Second page: partial page
      const secondPage = Array.from({ length: 50 }, (_, i) => ({
        id: `order-${1000 + i}`,
        platform_order_id: `AMZ-${1000 + i}`,
        items_count: 0,
      }));

      let callCount = 0;
      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => {
          callCount++;
          resolve({ data: callCount === 1 ? firstPage : secondPage, error: null });
          return Promise.resolve({ data: callCount === 1 ? firstPage : secondPage, error: null });
        }),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      const result = await service.getOrdersNeedingBackfill(userId);

      expect(result).toHaveLength(1050);
    });

    it('should throw error on database failure', async () => {
      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: null, error: { message: 'DB error' } })),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      await expect(service.getOrdersNeedingBackfill(userId)).rejects.toThrow(
        'Failed to fetch orders needing backfill: DB error'
      );
    });
  });

  describe('countOrdersNeedingBackfill', () => {
    it('should return count of orders needing backfill', async () => {
      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ count: 42, error: null })),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      const result = await service.countOrdersNeedingBackfill(userId);

      expect(result).toBe(42);
      expect(mockBuilder.select).toHaveBeenCalledWith('*', { count: 'exact', head: true });
    });

    it('should return 0 when count is null', async () => {
      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ count: null, error: null })),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      const result = await service.countOrdersNeedingBackfill(userId);

      expect(result).toBe(0);
    });
  });

  describe('startBackfill', () => {
    it('should track progress through lifecycle', async () => {
      // Verify that after starting a backfill, getProgress returns running state
      mockCredentialsRepo.getCredentials.mockResolvedValue({ apiKey: 'test' });

      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: [{ id: 'order-1', platform_order_id: 'AMZ-001' }], error: null })),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);
      mockAmazonClient.getOrderItems.mockResolvedValue([]);

      // Start backfill
      const result = await service.startBackfill(userId, { batchSize: 1, delayMs: 10 });

      // Should be running initially
      expect(result.total).toBe(1);
      expect(result.startedAt).toBeInstanceOf(Date);
    });

    it('should throw error when credentials not configured', async () => {
      mockCredentialsRepo.getCredentials.mockResolvedValue(null);

      await expect(service.startBackfill(userId)).rejects.toThrow(
        'Amazon credentials not configured'
      );
    });

    it('should return empty progress when no orders need backfill', async () => {
      mockCredentialsRepo.getCredentials.mockResolvedValue({ apiKey: 'test' });

      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: [], error: null })),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);

      const result = await service.startBackfill(userId);

      expect(result.total).toBe(0);
      expect(result.isRunning).toBe(false);
    });

    it('should limit batch to specified size', async () => {
      mockCredentialsRepo.getCredentials.mockResolvedValue({ apiKey: 'test' });

      const mockOrders = Array.from({ length: 100 }, (_, i) => ({
        id: `order-${i}`,
        platform_order_id: `AMZ-${i}`,
      }));

      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: mockOrders, error: null })),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);
      mockAmazonClient.getOrderItems.mockResolvedValue([]);

      const result = await service.startBackfill(userId, { batchSize: 10 });

      expect(result.total).toBe(10);
    });

    it('should initialize progress correctly', async () => {
      mockCredentialsRepo.getCredentials.mockResolvedValue({ apiKey: 'test' });

      const mockOrders = [
        { id: 'order-1', platform_order_id: 'AMZ-001' },
        { id: 'order-2', platform_order_id: 'AMZ-002' },
      ];

      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: mockOrders, error: null })),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);
      mockAmazonClient.getOrderItems.mockResolvedValue([]);

      const result = await service.startBackfill(userId, { delayMs: 100 });

      expect(result.total).toBe(2);
      expect(result.isRunning).toBe(true);
      expect(result.startedAt).toBeInstanceOf(Date);
    });
  });

  describe('stopBackfill', () => {
    it('should set isRunning to false', async () => {
      mockCredentialsRepo.getCredentials.mockResolvedValue({ apiKey: 'test' });

      const mockOrders = [{ id: 'order-1', platform_order_id: 'AMZ-001' }];

      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: mockOrders, error: null })),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);
      mockAmazonClient.getOrderItems.mockResolvedValue([]);

      await service.startBackfill(userId, { delayMs: 1000 });
      service.stopBackfill(userId);

      const progress = service.getProgress(userId);
      expect(progress.isRunning).toBe(false);
    });
  });

  describe('clearProgress', () => {
    it('should reset progress to initial state', async () => {
      mockCredentialsRepo.getCredentials.mockResolvedValue({ apiKey: 'test' });

      const mockBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: [{ id: 'order-1', platform_order_id: 'AMZ-001' }], error: null })),
      };
      mockSupabase.from.mockReturnValue(mockBuilder);
      mockAmazonClient.getOrderItems.mockResolvedValue([]);

      await service.startBackfill(userId, { delayMs: 100 });
      service.clearProgress(userId);

      const progress = service.getProgress(userId);
      expect(progress.total).toBe(0);
      expect(progress.isRunning).toBe(false);
    });
  });
});
