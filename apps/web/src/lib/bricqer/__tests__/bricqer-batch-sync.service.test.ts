import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { BricqerBatchSyncService } from '../bricqer-batch-sync.service';

// Mock dependencies
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

// Create mock functions for BricqerClient
const mockGetBatchesDefault = vi.fn().mockResolvedValue([]);
const mockGetPurchasesDefault = vi.fn().mockResolvedValue([]);

vi.mock('../client', () => ({
  BricqerClient: class MockBricqerClient {
    getBatches = mockGetBatchesDefault;
    getPurchases = mockGetPurchasesDefault;
  },
}));

// Create a mock class for CredentialsRepository
const mockHasCredentials = vi.fn().mockResolvedValue(true);
const mockGetCredentials = vi.fn().mockResolvedValue({
  tenantUrl: 'https://test.bricqer.com',
  apiKey: 'test-api-key',
});

vi.mock('@/lib/repositories', () => ({
  CredentialsRepository: class MockCredentialsRepository {
    hasCredentials = mockHasCredentials;
    getCredentials = mockGetCredentials;
  },
}));

describe('BricqerBatchSyncService', () => {
  let service: BricqerBatchSyncService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new BricqerBatchSyncService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getConnectionStatus', () => {
    it('should return not connected when no credentials exist', async () => {
      const { createClient } = await import('@/lib/supabase/server');

      mockHasCredentials.mockResolvedValueOnce(false);

      vi.mocked(createClient).mockResolvedValue({
        from: vi.fn(),
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      const result = await service.getConnectionStatus('user-123');

      expect(result.isConnected).toBe(false);
    });

    it('should return connected with stats when credentials exist', async () => {
      const { createClient } = await import('@/lib/supabase/server');

      mockHasCredentials.mockResolvedValueOnce(true);

      const mockFrom = vi.fn();

      // Upload count query
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn(() =>
          Promise.resolve({
            count: 50,
            error: null,
          })
        ),
      });

      // Sync config query
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({
            data: {
              auto_sync_enabled: true,
              auto_sync_interval_hours: 24,
              sync_activated_only: true,
            },
            error: null,
          })
        ),
      });

      // Recent logs query
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn(() =>
          Promise.resolve({
            data: [
              {
                id: 'log-1',
                sync_mode: 'FULL',
                status: 'COMPLETED',
                started_at: '2025-01-01T12:00:00Z',
                completed_at: '2025-01-01T12:05:00Z',
                batches_processed: 50,
                batches_created: 50,
                batches_updated: 0,
              },
            ],
            error: null,
          })
        ),
      });

      // Last sync query
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({
            data: { completed_at: '2025-01-01T12:05:00Z' },
            error: null,
          })
        ),
      });

      vi.mocked(createClient).mockResolvedValue({
        from: mockFrom,
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      const result = await service.getConnectionStatus('user-123');

      expect(result.isConnected).toBe(true);
      expect(result.uploadCount).toBe(50);
      expect(result.syncConfig?.autoSyncEnabled).toBe(true);
    });
  });

  describe('syncBatches', () => {
    it('should return error when a sync is already running', async () => {
      const { createClient } = await import('@/lib/supabase/server');

      vi.mocked(createClient).mockResolvedValue({
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn(() =>
            Promise.resolve({
              data: { id: 'running-sync' },
              error: null,
            })
          ),
        })),
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      const result = await service.syncBatches('user-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('A sync is already running');
    });

    it('should return error when sync log creation fails', async () => {
      const { createClient } = await import('@/lib/supabase/server');

      const mockFrom = vi.fn();

      // Check for running sync - none found
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({
            data: null,
            error: { code: 'PGRST116' },
          })
        ),
      });

      // Create sync log - fails
      mockFrom.mockReturnValueOnce({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({
            data: null,
            error: { message: 'Insert failed' },
          })
        ),
      });

      vi.mocked(createClient).mockResolvedValue({
        from: mockFrom,
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      const result = await service.syncBatches('user-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to create sync log');
    });

    it('should return error when credentials are not configured', async () => {
      const { createClient } = await import('@/lib/supabase/server');
      mockGetCredentials.mockResolvedValueOnce(null);

      const mockFrom = vi.fn();
      const mockUpdate = vi.fn().mockReturnThis();
      const mockEq = vi.fn(() => Promise.resolve({ error: null }));

      // Check for running sync - none found
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({
            data: null,
            error: { code: 'PGRST116' },
          })
        ),
      });

      // Create sync log
      mockFrom.mockReturnValueOnce({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({
            data: { id: 'sync-log-1' },
            error: null,
          })
        ),
      });

      // Update sync log with error
      mockFrom.mockReturnValue({
        update: mockUpdate,
        eq: mockEq,
      });

      vi.mocked(createClient).mockResolvedValue({
        from: mockFrom,
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      const result = await service.syncBatches('user-123');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Bricqer credentials not configured');
    });

    it('should determine correct sync mode for full sync', async () => {
      const { createClient } = await import('@/lib/supabase/server');

      mockGetCredentials.mockResolvedValueOnce({
        tenantUrl: 'https://test.bricqer.com',
        apiKey: 'test-api-key',
      });

      // Use the default mock which returns empty arrays
      mockGetBatchesDefault.mockResolvedValueOnce([]);
      mockGetPurchasesDefault.mockResolvedValueOnce([]);

      const mockFrom = vi.fn();

      // Check for running sync - none found
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({
            data: null,
            error: { code: 'PGRST116' },
          })
        ),
      });

      // Create sync log
      mockFrom.mockReturnValueOnce({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({
            data: { id: 'sync-log-1' },
            error: null,
          })
        ),
      });

      // Update sync config
      mockFrom.mockReturnValue({
        upsert: vi.fn(() => Promise.resolve({ error: null })),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn(() => Promise.resolve({ error: null })),
      });

      vi.mocked(createClient).mockResolvedValue({
        from: mockFrom,
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      const result = await service.syncBatches('user-123', { fullSync: true });

      expect(result.syncMode).toBe('FULL');
    });

    it('should filter batches by activated status when activatedOnly is true', async () => {
      const { createClient } = await import('@/lib/supabase/server');

      mockGetCredentials.mockResolvedValueOnce({
        tenantUrl: 'https://test.bricqer.com',
        apiKey: 'test-api-key',
      });

      // Mock getBatches to return mixed activated/deactivated batches with all required fields
      mockGetBatchesDefault.mockResolvedValueOnce([
        {
          id: 1,
          activated: true,
          totalQuantity: 10,
          lots: 5,
          totalPrice: '100.00',
          purchase: null,
          activationDate: '2025-01-01T00:00:00Z',
          created: '2025-01-01T00:00:00Z',
          remainingQuantity: 10,
          remainingPrice: '100.00',
          condition: 'new',
        },
        {
          id: 2,
          activated: false,
          totalQuantity: 20,
          lots: 8,
          totalPrice: '200.00',
          purchase: null,
          created: '2025-01-02T00:00:00Z',
          remainingQuantity: 20,
          remainingPrice: '200.00',
          condition: 'new',
        },
        {
          id: 3,
          activated: true,
          totalQuantity: 15,
          lots: 3,
          totalPrice: '150.00',
          purchase: null,
          activationDate: '2025-01-03T00:00:00Z',
          created: '2025-01-03T00:00:00Z',
          remainingQuantity: 15,
          remainingPrice: '150.00',
          condition: 'new',
        },
      ]);
      mockGetPurchasesDefault.mockResolvedValueOnce([]);

      const mockFrom = vi.fn();

      // Check for running sync - none found
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({
            data: null,
            error: { code: 'PGRST116' },
          })
        ),
      });

      // Create sync log
      mockFrom.mockReturnValueOnce({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({
            data: { id: 'sync-log-1' },
            error: null,
          })
        ),
      });

      // Get existing batches
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn(() =>
          Promise.resolve({
            data: [],
            error: null,
          })
        ),
      });

      // Upsert batches
      mockFrom.mockReturnValueOnce({
        upsert: vi.fn(() => Promise.resolve({ error: null })),
      });

      // Update sync config and log
      mockFrom.mockReturnValue({
        upsert: vi.fn(() => Promise.resolve({ error: null })),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn(() => Promise.resolve({ error: null })),
      });

      vi.mocked(createClient).mockResolvedValue({
        from: mockFrom,
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      const result = await service.syncBatches('user-123', { activatedOnly: true });

      // Should only process 2 activated batches
      expect(result.batchesProcessed).toBe(2);
    });
  });
});
