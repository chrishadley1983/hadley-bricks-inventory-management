import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrderSyncService } from '../order-sync.service';
import type { Platform } from '@hadley-bricks/database';

// Mock the platform sync services
const mockBrickLinkSync = {
  syncOrders: vi.fn(),
  getSyncStatus: vi.fn(),
  testConnection: vi.fn(),
};

const mockBrickOwlSync = {
  syncOrders: vi.fn(),
  getSyncStatus: vi.fn(),
  testConnection: vi.fn(),
};

const mockBricqerSync = {
  syncOrders: vi.fn(),
  getSyncStatus: vi.fn(),
  testConnection: vi.fn(),
};

const mockCredentialsRepo = {
  getConfiguredPlatforms: vi.fn(),
};

vi.mock('../bricklink-sync.service', () => ({
  BrickLinkSyncService: function MockBrickLinkSyncService() {
    return mockBrickLinkSync;
  },
}));

vi.mock('../brickowl-sync.service', () => ({
  BrickOwlSyncService: function MockBrickOwlSyncService() {
    return mockBrickOwlSync;
  },
}));

vi.mock('../bricqer-sync.service', () => ({
  BricqerSyncService: function MockBricqerSyncService() {
    return mockBricqerSync;
  },
}));

vi.mock('../../repositories', () => ({
  CredentialsRepository: function MockCredentialsRepository() {
    return mockCredentialsRepo;
  },
}));

describe('OrderSyncService', () => {
  let service: OrderSyncService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockSupabase: any = {};

  beforeEach(() => {
    vi.clearAllMocks();
    service = new OrderSyncService(mockSupabase);
  });

  describe('getConfiguredPlatforms', () => {
    it('should return list of configured platforms', async () => {
      const platforms: Platform[] = ['bricklink', 'brickowl'];
      mockCredentialsRepo.getConfiguredPlatforms.mockResolvedValue(platforms);

      const result = await service.getConfiguredPlatforms('test-user-id');

      expect(result).toEqual(platforms);
      expect(mockCredentialsRepo.getConfiguredPlatforms).toHaveBeenCalledWith('test-user-id');
    });
  });

  describe('getPlatformSyncStatus', () => {
    it('should return BrickLink sync status', async () => {
      mockBrickLinkSync.getSyncStatus.mockResolvedValue({
        isConfigured: true,
        totalOrders: 25,
        lastSyncedAt: new Date('2024-12-20T10:00:00Z'),
      });

      const result = await service.getPlatformSyncStatus('test-user-id', 'bricklink');

      expect(result).toEqual({
        platform: 'bricklink',
        isConfigured: true,
        totalOrders: 25,
        lastSyncedAt: expect.any(Date),
        connectionStatus: 'connected',
      });
    });

    it('should return Brick Owl sync status', async () => {
      mockBrickOwlSync.getSyncStatus.mockResolvedValue({
        isConfigured: true,
        totalOrders: 15,
        lastSyncedAt: new Date('2024-12-19T10:00:00Z'),
      });

      const result = await service.getPlatformSyncStatus('test-user-id', 'brickowl');

      expect(result).toEqual({
        platform: 'brickowl',
        isConfigured: true,
        totalOrders: 15,
        lastSyncedAt: expect.any(Date),
        connectionStatus: 'connected',
      });
    });

    it('should return Bricqer sync status', async () => {
      mockBricqerSync.getSyncStatus.mockResolvedValue({
        isConfigured: false,
        totalOrders: 0,
        lastSyncedAt: null,
      });

      const result = await service.getPlatformSyncStatus('test-user-id', 'bricqer');

      expect(result).toEqual({
        platform: 'bricqer',
        isConfigured: false,
        totalOrders: 0,
        lastSyncedAt: null,
        connectionStatus: 'disconnected',
      });
    });

    it('should handle unknown platform', async () => {
      const result = await service.getPlatformSyncStatus('test-user-id', 'amazon' as Platform);

      expect(result).toEqual({
        platform: 'amazon',
        isConfigured: false,
        totalOrders: 0,
        lastSyncedAt: null,
        connectionStatus: 'disconnected',
      });
    });

    it('should handle errors gracefully', async () => {
      mockBrickLinkSync.getSyncStatus.mockRejectedValue(new Error('API Error'));

      const result = await service.getPlatformSyncStatus('test-user-id', 'bricklink');

      expect(result).toEqual({
        platform: 'bricklink',
        isConfigured: false,
        totalOrders: 0,
        lastSyncedAt: null,
        connectionStatus: 'error',
        errorMessage: 'API Error',
      });
    });
  });

  describe('getAllPlatformStatuses', () => {
    it('should return status for all platforms', async () => {
      mockBrickLinkSync.getSyncStatus.mockResolvedValue({
        isConfigured: true,
        totalOrders: 25,
        lastSyncedAt: new Date(),
      });
      mockBrickOwlSync.getSyncStatus.mockResolvedValue({
        isConfigured: true,
        totalOrders: 15,
        lastSyncedAt: new Date(),
      });
      mockBricqerSync.getSyncStatus.mockResolvedValue({
        isConfigured: false,
        totalOrders: 0,
        lastSyncedAt: null,
      });

      const result = await service.getAllPlatformStatuses('test-user-id');

      expect(result).toBeInstanceOf(Map);
      expect(result.get('bricklink')).toBeDefined();
      expect(result.get('brickowl')).toBeDefined();
      expect(result.get('bricqer')).toBeDefined();
    });
  });

  describe('syncFromPlatform', () => {
    it('should sync orders from BrickLink', async () => {
      mockBrickLinkSync.syncOrders.mockResolvedValue({
        success: true,
        ordersProcessed: 10,
        ordersCreated: 5,
        ordersUpdated: 5,
        errors: [],
        lastSyncedAt: new Date(),
      });

      const result = await service.syncFromPlatform('test-user-id', 'bricklink');

      expect(result.success).toBe(true);
      expect(result.platform).toBe('bricklink');
      expect(result.ordersProcessed).toBe(10);
      expect(mockBrickLinkSync.syncOrders).toHaveBeenCalledWith(
        'test-user-id',
        expect.objectContaining({ includeItems: true })
      );
    });

    it('should sync orders from Brick Owl', async () => {
      mockBrickOwlSync.syncOrders.mockResolvedValue({
        success: true,
        ordersProcessed: 8,
        ordersCreated: 3,
        ordersUpdated: 5,
        errors: [],
        lastSyncedAt: new Date(),
      });

      const result = await service.syncFromPlatform('test-user-id', 'brickowl');

      expect(result.success).toBe(true);
      expect(result.platform).toBe('brickowl');
      expect(result.ordersProcessed).toBe(8);
    });

    it('should sync orders from Bricqer', async () => {
      mockBricqerSync.syncOrders.mockResolvedValue({
        success: true,
        ordersProcessed: 12,
        ordersCreated: 12,
        ordersUpdated: 0,
        errors: [],
        lastSyncedAt: new Date(),
      });

      const result = await service.syncFromPlatform('test-user-id', 'bricqer');

      expect(result.success).toBe(true);
      expect(result.platform).toBe('bricqer');
      expect(result.ordersProcessed).toBe(12);
    });

    it('should handle fullSync option', async () => {
      mockBrickLinkSync.syncOrders.mockResolvedValue({
        success: true,
        ordersProcessed: 100,
        ordersCreated: 100,
        ordersUpdated: 0,
        errors: [],
        lastSyncedAt: new Date(),
      });

      await service.syncFromPlatform('test-user-id', 'bricklink', { fullSync: true });

      expect(mockBrickLinkSync.syncOrders).toHaveBeenCalledWith(
        'test-user-id',
        expect.objectContaining({ fullSync: true })
      );
    });

    it('should return error for unsupported platform', async () => {
      const result = await service.syncFromPlatform('test-user-id', 'amazon' as Platform);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Platform amazon sync not implemented');
    });
  });

  describe('syncAllPlatforms', () => {
    it('should sync all configured platforms', async () => {
      mockCredentialsRepo.getConfiguredPlatforms.mockResolvedValue(['bricklink', 'brickowl']);

      mockBrickLinkSync.syncOrders.mockResolvedValue({
        success: true,
        ordersProcessed: 10,
        ordersCreated: 5,
        ordersUpdated: 5,
        errors: [],
        lastSyncedAt: new Date(),
      });

      mockBrickOwlSync.syncOrders.mockResolvedValue({
        success: true,
        ordersProcessed: 8,
        ordersCreated: 3,
        ordersUpdated: 5,
        errors: [],
        lastSyncedAt: new Date(),
      });

      const result = await service.syncAllPlatforms('test-user-id');

      expect(result.success).toBe(true);
      expect(result.totalOrdersProcessed).toBe(18);
      expect(result.totalOrdersCreated).toBe(8);
      expect(result.totalOrdersUpdated).toBe(10);
      expect(result.results.size).toBe(2);
    });

    it('should sync only specified platforms', async () => {
      mockBrickLinkSync.syncOrders.mockResolvedValue({
        success: true,
        ordersProcessed: 10,
        ordersCreated: 10,
        ordersUpdated: 0,
        errors: [],
        lastSyncedAt: new Date(),
      });

      const result = await service.syncAllPlatforms('test-user-id', {
        platforms: ['bricklink'],
      });

      expect(result.results.size).toBe(1);
      expect(result.results.has('bricklink')).toBe(true);
      expect(mockBrickOwlSync.syncOrders).not.toHaveBeenCalled();
    });

    it('should handle partial failures gracefully', async () => {
      mockCredentialsRepo.getConfiguredPlatforms.mockResolvedValue([
        'bricklink',
        'brickowl',
        'bricqer',
      ]);

      mockBrickLinkSync.syncOrders.mockResolvedValue({
        success: true,
        ordersProcessed: 10,
        ordersCreated: 10,
        ordersUpdated: 0,
        errors: [],
        lastSyncedAt: new Date(),
      });

      mockBrickOwlSync.syncOrders.mockRejectedValue(new Error('API rate limit exceeded'));

      mockBricqerSync.syncOrders.mockResolvedValue({
        success: true,
        ordersProcessed: 5,
        ordersCreated: 5,
        ordersUpdated: 0,
        errors: [],
        lastSyncedAt: new Date(),
      });

      const result = await service.syncAllPlatforms('test-user-id');

      expect(result.success).toBe(false);
      expect(result.totalOrdersProcessed).toBe(15);
      expect(result.errors).toContain('[brickowl] Sync failed: API rate limit exceeded');
      expect(result.results.get('brickowl')?.success).toBe(false);
    });

    it('should collect errors from all platforms', async () => {
      mockCredentialsRepo.getConfiguredPlatforms.mockResolvedValue(['bricklink']);

      mockBrickLinkSync.syncOrders.mockResolvedValue({
        success: true,
        ordersProcessed: 10,
        ordersCreated: 10,
        ordersUpdated: 0,
        errors: ['Failed to fetch order BL-123', 'Invalid item data for BL-456'],
        lastSyncedAt: new Date(),
      });

      const result = await service.syncAllPlatforms('test-user-id');

      expect(result.errors).toContain('[bricklink] Failed to fetch order BL-123');
      expect(result.errors).toContain('[bricklink] Invalid item data for BL-456');
    });
  });

  describe('testPlatformConnection', () => {
    it('should test BrickLink connection', async () => {
      mockBrickLinkSync.testConnection.mockResolvedValue(true);

      const result = await service.testPlatformConnection('test-user-id', 'bricklink');

      expect(result).toBe(true);
      expect(mockBrickLinkSync.testConnection).toHaveBeenCalledWith('test-user-id');
    });

    it('should test Brick Owl connection', async () => {
      mockBrickOwlSync.testConnection.mockResolvedValue(true);

      const result = await service.testPlatformConnection('test-user-id', 'brickowl');

      expect(result).toBe(true);
    });

    it('should test Bricqer connection', async () => {
      mockBricqerSync.testConnection.mockResolvedValue(false);

      const result = await service.testPlatformConnection('test-user-id', 'bricqer');

      expect(result).toBe(false);
    });

    it('should return false for unsupported platform', async () => {
      const result = await service.testPlatformConnection('test-user-id', 'ebay' as Platform);

      expect(result).toBe(false);
    });
  });
});
