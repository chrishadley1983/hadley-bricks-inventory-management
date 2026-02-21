/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PayPalTransactionSyncService } from '../paypal-transaction-sync.service';

// Mock dependencies
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('../paypal-auth.service', () => ({
  paypalAuthService: {
    getAccessToken: vi.fn(),
    getCredentials: vi.fn(),
  },
}));

// Store the mock implementation so tests can override it
let mockGetAllTransactionsInRange = vi.fn().mockResolvedValue([]);
// Track constructor calls for assertions
let mockPayPalApiAdapterConstructorArgs: unknown[] = [];

vi.mock('../paypal-api.adapter', () => {
  // Define mock class inside the factory to avoid hoisting issues
  return {
    PayPalApiAdapter: class {
      constructor(...args: unknown[]) {
        mockPayPalApiAdapterConstructorArgs = args;
      }
      getAllTransactionsInRange(...args: unknown[]) {
        return mockGetAllTransactionsInRange(...args);
      }
    },
  };
});

// Helper to set the mock implementation for PayPalApiAdapter
const setPayPalApiAdapterMock = (mockFn: typeof mockGetAllTransactionsInRange) => {
  mockGetAllTransactionsInRange = mockFn;
};

// Helper to get the last constructor arguments
const getPayPalApiAdapterConstructorArgs = () => mockPayPalApiAdapterConstructorArgs;

describe('PayPalTransactionSyncService', () => {
  let service: PayPalTransactionSyncService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PayPalTransactionSyncService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('syncTransactions', () => {
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

      const result = await service.syncTransactions('user-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('A sync is already running');
    });

    it('should throw when sync log creation fails', async () => {
      const { createClient } = await import('@/lib/supabase/server');

      const mockFrom = vi.fn();

      // First call - check for running sync - none found
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

      // Second call - create sync log - fails
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

      await expect(service.syncTransactions('user-123')).rejects.toThrow('Failed to start sync');
    });

    it('should return error when no access token', async () => {
      const { createClient } = await import('@/lib/supabase/server');
      const { paypalAuthService } = await import('../paypal-auth.service');

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

      vi.mocked(paypalAuthService.getAccessToken).mockResolvedValue(null);

      const result = await service.syncTransactions('user-123');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No valid PayPal access token');
    });

    it('should determine correct sync mode for full sync', async () => {
      const { createClient } = await import('@/lib/supabase/server');
      const { paypalAuthService } = await import('../paypal-auth.service');

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

      // Update sync log
      mockFrom.mockReturnValue({
        update: vi.fn().mockReturnValue({ eq: vi.fn(() => Promise.resolve({ error: null })) }),
        upsert: vi.fn().mockReturnThis(),
        eq: vi.fn(() => Promise.resolve({ error: null })),
      });

      vi.mocked(createClient).mockResolvedValue({
        from: mockFrom,
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      vi.mocked(paypalAuthService.getAccessToken).mockResolvedValue('test-token');
      vi.mocked(paypalAuthService.getCredentials).mockResolvedValue({
        sandbox: false,
      } as unknown as import('../types').PayPalCredentialsRow);

      const result = await service.syncTransactions('user-123', { fullSync: true });

      expect(result.syncMode).toBe('FULL');
    });

    it('should determine correct sync mode for historical import', async () => {
      const { createClient } = await import('@/lib/supabase/server');
      const { paypalAuthService } = await import('../paypal-auth.service');

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

      // Update sync log
      mockFrom.mockReturnValue({
        update: vi.fn().mockReturnValue({ eq: vi.fn(() => Promise.resolve({ error: null })) }),
        upsert: vi.fn().mockReturnThis(),
        eq: vi.fn(() => Promise.resolve({ error: null })),
      });

      vi.mocked(createClient).mockResolvedValue({
        from: mockFrom,
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      vi.mocked(paypalAuthService.getAccessToken).mockResolvedValue('test-token');
      vi.mocked(paypalAuthService.getCredentials).mockResolvedValue({
        sandbox: false,
      } as unknown as import('../types').PayPalCredentialsRow);

      const result = await service.syncTransactions('user-123', {
        fromDate: '2024-01-01',
        toDate: '2024-12-31',
      });

      expect(result.syncMode).toBe('HISTORICAL');
    });
  });

  describe('getSyncStatus', () => {
    it('should return running status when sync is in progress', async () => {
      const { createClient } = await import('@/lib/supabase/server');

      const mockFrom = vi.fn();

      // Check for running sync - found
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({
            data: { id: 'running-sync' },
            error: null,
          })
        ),
      });

      // Get last sync
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({
            data: {
              status: 'RUNNING',
              started_at: new Date().toISOString(),
            },
            error: null,
          })
        ),
      });

      // Get sync config
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

      vi.mocked(createClient).mockResolvedValue({
        from: mockFrom,
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      const result = await service.getSyncStatus('user-123');

      expect(result.isRunning).toBe(true);
    });

    it('should return last sync details when available', async () => {
      const { createClient } = await import('@/lib/supabase/server');

      const mockFrom = vi.fn();

      // Check for running sync - not found
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

      // Get last sync
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({
            data: {
              status: 'COMPLETED',
              completed_at: '2025-01-01T12:00:00Z',
              transactions_processed: 100,
              transactions_created: 80,
              transactions_updated: 20,
              transactions_skipped: 50,
            },
            error: null,
          })
        ),
      });

      // Get sync config
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({
            data: {
              auto_sync_enabled: true,
              next_auto_sync_at: '2025-01-02T00:00:00Z',
              historical_import_completed_at: '2025-01-01T10:00:00Z',
              last_sync_date_cursor: '2025-01-01T12:00:00Z',
            },
            error: null,
          })
        ),
      });

      vi.mocked(createClient).mockResolvedValue({
        from: mockFrom,
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      const result = await service.getSyncStatus('user-123');

      expect(result.isRunning).toBe(false);
      expect(result.lastSync?.status).toBe('COMPLETED');
      expect(result.lastSync?.transactionsProcessed).toBe(100);
      expect(result.lastSync?.transactionsCreated).toBe(80);
      expect(result.config?.autoSyncEnabled).toBe(true);
      expect(result.config?.historicalImportCompleted).toBe(true);
    });

    it('should return empty status when no syncs exist', async () => {
      const { createClient } = await import('@/lib/supabase/server');

      const mockFrom = vi.fn();

      // Check for running sync - not found
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

      // Get last sync - not found
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({
            data: null,
            error: { code: 'PGRST116' },
          })
        ),
      });

      // Get sync config - not found
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

      vi.mocked(createClient).mockResolvedValue({
        from: mockFrom,
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      const result = await service.getSyncStatus('user-123');

      expect(result.isRunning).toBe(false);
      expect(result.lastSync).toBeUndefined();
      expect(result.config).toBeUndefined();
    });
  });

  describe('performHistoricalImport', () => {
    it('should update sync config and call syncTransactions', async () => {
      const { createClient } = await import('@/lib/supabase/server');
      const { paypalAuthService } = await import('../paypal-auth.service');

      const mockFrom = vi.fn();

      // First call - upsert sync config for historical import
      mockFrom.mockReturnValueOnce({
        upsert: vi.fn(() => Promise.resolve({ error: null })),
      });

      // Second call - check for running sync (from syncTransactions)
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

      // Third call - create sync log
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

      // Remaining calls - update sync log with error
      mockFrom.mockReturnValue({
        update: vi.fn().mockReturnValue({ eq: vi.fn(() => Promise.resolve({ error: null })) }),
        upsert: vi.fn().mockReturnThis(),
        eq: vi.fn(() => Promise.resolve({ error: null })),
      });

      vi.mocked(createClient).mockResolvedValue({
        from: mockFrom,
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      vi.mocked(paypalAuthService.getAccessToken).mockResolvedValue(null);

      const result = await service.performHistoricalImport('user-123', '2024-01-01');

      // Should fail due to no token, but sync should have been attempted
      expect(result.syncMode).toBe('HISTORICAL');
    });

    it('should update sync config on successful historical import', async () => {
      const { createClient } = await import('@/lib/supabase/server');
      const { paypalAuthService } = await import('../paypal-auth.service');
      const { PayPalApiAdapter } = await import('../paypal-api.adapter');

      const mockUpdate = vi.fn().mockReturnThis();
      const mockFrom = vi.fn();

      // Call sequence for successful sync
      // 1. Upsert sync config for historical import
      mockFrom.mockReturnValueOnce({
        upsert: vi.fn(() => Promise.resolve({ error: null })),
      });

      // 2. Check for running sync
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST116' } })),
      });

      // 3. Create sync log
      mockFrom.mockReturnValueOnce({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn(() => Promise.resolve({ data: { id: 'sync-log-1' }, error: null })),
      });

      // 4. Get existing transactions
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn(() => Promise.resolve({ data: [], error: null })),
      });

      // 5. Upsert transactions
      mockFrom.mockReturnValueOnce({
        upsert: vi.fn(() => Promise.resolve({ error: null })),
      });

      // 6. Upsert sync config with cursor
      mockFrom.mockReturnValueOnce({
        upsert: vi.fn(() => Promise.resolve({ error: null })),
      });

      // 7. Update sync log as completed
      mockFrom.mockReturnValueOnce({
        update: mockUpdate,
        eq: vi.fn(() => Promise.resolve({ error: null })),
      });

      // 8. Update sync config to mark historical import complete
      mockFrom.mockReturnValueOnce({
        update: mockUpdate,
        eq: vi.fn(() => Promise.resolve({ error: null })),
      });

      vi.mocked(createClient).mockResolvedValue({
        from: mockFrom,
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      vi.mocked(paypalAuthService.getAccessToken).mockResolvedValue('test-token');
      vi.mocked(paypalAuthService.getCredentials).mockResolvedValue({
        sandbox: false,
      } as unknown as import('../types').PayPalCredentialsRow);

      // Mock API adapter with transactions that have fees
      const mockApiAdapter = {
        getAllTransactionsInRange: vi.fn().mockResolvedValue([
          {
            transaction_info: {
              transaction_id: 'TX001',
              transaction_initiation_date: '2024-06-15T10:00:00Z',
              transaction_amount: { value: '100.00', currency_code: 'GBP' },
              fee_amount: { value: '-5.00', currency_code: 'GBP' },
            },
            payer_info: { email_address: 'buyer@test.com' },
          },
        ]),
      };
      setPayPalApiAdapterMock(mockApiAdapter.getAllTransactionsInRange);

      const result = await service.performHistoricalImport('user-123', '2024-01-01');

      expect(result.success).toBe(true);
      expect(result.transactionsCreated).toBe(1);
    });
  });

  describe('syncTransactions with transactions', () => {
    it('should filter out transactions without fees', async () => {
      const { createClient } = await import('@/lib/supabase/server');
      const { paypalAuthService } = await import('../paypal-auth.service');
      const { PayPalApiAdapter } = await import('../paypal-api.adapter');

      const mockFrom = vi.fn();

      // Check for running sync - none found
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST116' } })),
      });

      // Create sync log
      mockFrom.mockReturnValueOnce({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn(() => Promise.resolve({ data: { id: 'sync-log-1' }, error: null })),
      });

      // Get existing transactions
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn(() => Promise.resolve({ data: [], error: null })),
      });

      // Upsert transactions
      mockFrom.mockReturnValueOnce({
        upsert: vi.fn(() => Promise.resolve({ error: null })),
      });

      // Fallback for all remaining supabase calls (sync config, sync log updates, etc.)
      mockFrom.mockReturnValue({
        upsert: vi.fn(() => Promise.resolve({ error: null })),
        update: vi.fn().mockReturnValue({
          eq: vi.fn(() => Promise.resolve({ error: null })),
        }),
        eq: vi.fn(() => Promise.resolve({ error: null })),
        select: vi.fn().mockReturnThis(),
        in: vi.fn(() => Promise.resolve({ data: [], error: null })),
      });

      vi.mocked(createClient).mockResolvedValue({
        from: mockFrom,
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      vi.mocked(paypalAuthService.getAccessToken).mockResolvedValue('test-token');
      vi.mocked(paypalAuthService.getCredentials).mockResolvedValue({
        sandbox: false,
      } as unknown as import('../types').PayPalCredentialsRow);

      // Mock API with mixed transactions
      const mockApiAdapter = {
        getAllTransactionsInRange: vi.fn().mockResolvedValue([
          // Transaction WITH fee
          {
            transaction_info: {
              transaction_id: 'TX001',
              transaction_initiation_date: '2024-06-15T10:00:00Z',
              transaction_amount: { value: '100.00', currency_code: 'GBP' },
              fee_amount: { value: '-5.00', currency_code: 'GBP' },
            },
            payer_info: {},
          },
          // Transaction WITHOUT fee (should be skipped)
          {
            transaction_info: {
              transaction_id: 'TX002',
              transaction_initiation_date: '2024-06-15T10:00:00Z',
              transaction_amount: { value: '50.00', currency_code: 'GBP' },
              fee_amount: { value: '0.00', currency_code: 'GBP' },
            },
            payer_info: {},
          },
          // Transaction with no fee_amount (should be skipped)
          {
            transaction_info: {
              transaction_id: 'TX003',
              transaction_initiation_date: '2024-06-15T10:00:00Z',
              transaction_amount: { value: '25.00', currency_code: 'GBP' },
            },
            payer_info: {},
          },
        ]),
      };
      setPayPalApiAdapterMock(mockApiAdapter.getAllTransactionsInRange);

      const result = await service.syncTransactions('user-123', { fullSync: true });

      expect(result.success).toBe(true);
      expect(result.transactionsProcessed).toBe(3); // All fetched
      expect(result.transactionsSkipped).toBe(2); // Two without fees skipped
      expect(result.transactionsCreated).toBe(1); // Only one with fee
    });

    it('should use incremental sync cursor when available', async () => {
      const { createClient } = await import('@/lib/supabase/server');
      const { paypalAuthService } = await import('../paypal-auth.service');
      const { PayPalApiAdapter } = await import('../paypal-api.adapter');

      const mockFrom = vi.fn();

      // Check for running sync - none found
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST116' } })),
      });

      // Create sync log
      mockFrom.mockReturnValueOnce({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn(() => Promise.resolve({ data: { id: 'sync-log-1' }, error: null })),
      });

      // Get sync config with cursor
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({
            data: { last_sync_date_cursor: '2024-12-01T00:00:00Z' },
            error: null,
          })
        ),
      });

      // Remaining calls
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn(() => Promise.resolve({ data: [], error: null })),
        upsert: vi.fn(() => Promise.resolve({ error: null })),
        update: vi.fn().mockReturnValue({ eq: vi.fn(() => Promise.resolve({ error: null })) }),
      });

      vi.mocked(createClient).mockResolvedValue({
        from: mockFrom,
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      vi.mocked(paypalAuthService.getAccessToken).mockResolvedValue('test-token');
      vi.mocked(paypalAuthService.getCredentials).mockResolvedValue({
        sandbox: false,
      } as unknown as import('../types').PayPalCredentialsRow);

      const mockApiAdapter = {
        getAllTransactionsInRange: vi.fn().mockResolvedValue([]),
      };
      setPayPalApiAdapterMock(mockApiAdapter.getAllTransactionsInRange);

      const result = await service.syncTransactions('user-123'); // No options = incremental

      expect(result.syncMode).toBe('INCREMENTAL');
      expect(mockApiAdapter.getAllTransactionsInRange).toHaveBeenCalled();
    });

    it('should handle upsert failure', async () => {
      const { createClient } = await import('@/lib/supabase/server');
      const { paypalAuthService } = await import('../paypal-auth.service');
      const { PayPalApiAdapter } = await import('../paypal-api.adapter');

      const mockFrom = vi.fn();

      // Check for running sync - none found
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST116' } })),
      });

      // Create sync log
      mockFrom.mockReturnValueOnce({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn(() => Promise.resolve({ data: { id: 'sync-log-1' }, error: null })),
      });

      // Get existing transactions
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn(() => Promise.resolve({ data: [], error: null })),
      });

      // Upsert transactions - FAILS
      mockFrom.mockReturnValueOnce({
        upsert: vi.fn(() => Promise.resolve({ error: { message: 'Upsert failed' } })),
      });

      // Update sync log with error
      mockFrom.mockReturnValue({
        update: vi.fn().mockReturnValue({ eq: vi.fn(() => Promise.resolve({ error: null })) }),
        eq: vi.fn(() => Promise.resolve({ error: null })),
      });

      vi.mocked(createClient).mockResolvedValue({
        from: mockFrom,
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      vi.mocked(paypalAuthService.getAccessToken).mockResolvedValue('test-token');
      vi.mocked(paypalAuthService.getCredentials).mockResolvedValue({
        sandbox: false,
      } as unknown as import('../types').PayPalCredentialsRow);

      const mockApiAdapter = {
        getAllTransactionsInRange: vi.fn().mockResolvedValue([
          {
            transaction_info: {
              transaction_id: 'TX001',
              transaction_initiation_date: '2024-06-15T10:00:00Z',
              transaction_amount: { value: '100.00', currency_code: 'GBP' },
              fee_amount: { value: '-5.00', currency_code: 'GBP' },
            },
            payer_info: {},
          },
        ]),
      };
      setPayPalApiAdapterMock(mockApiAdapter.getAllTransactionsInRange);

      const result = await service.syncTransactions('user-123', { fullSync: true });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to save transactions');
    });

    it('should deduplicate transactions by transaction ID', async () => {
      const { createClient } = await import('@/lib/supabase/server');
      const { paypalAuthService } = await import('../paypal-auth.service');
      const { PayPalApiAdapter } = await import('../paypal-api.adapter');

      const mockFrom = vi.fn();

      // Standard mock setup
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST116' } })),
      });

      mockFrom.mockReturnValueOnce({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn(() => Promise.resolve({ data: { id: 'sync-log-1' }, error: null })),
      });

      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn(() => Promise.resolve({ data: [], error: null })),
      });

      mockFrom.mockReturnValue({
        upsert: vi.fn(() => Promise.resolve({ error: null })),
        update: vi.fn().mockReturnValue({ eq: vi.fn(() => Promise.resolve({ error: null })) }),
        eq: vi.fn(() => Promise.resolve({ error: null })),
      });

      vi.mocked(createClient).mockResolvedValue({
        from: mockFrom,
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      vi.mocked(paypalAuthService.getAccessToken).mockResolvedValue('test-token');
      vi.mocked(paypalAuthService.getCredentials).mockResolvedValue({
        sandbox: false,
      } as unknown as import('../types').PayPalCredentialsRow);

      // Same transaction ID twice (duplicate)
      const mockApiAdapter = {
        getAllTransactionsInRange: vi.fn().mockResolvedValue([
          {
            transaction_info: {
              transaction_id: 'TX001',
              transaction_initiation_date: '2024-06-15T10:00:00Z',
              transaction_amount: { value: '100.00', currency_code: 'GBP' },
              fee_amount: { value: '-5.00', currency_code: 'GBP' },
            },
            payer_info: {},
          },
          {
            transaction_info: {
              transaction_id: 'TX001', // DUPLICATE
              transaction_initiation_date: '2024-06-15T10:00:00Z',
              transaction_amount: { value: '100.00', currency_code: 'GBP' },
              fee_amount: { value: '-5.00', currency_code: 'GBP' },
            },
            payer_info: {},
          },
        ]),
      };
      setPayPalApiAdapterMock(mockApiAdapter.getAllTransactionsInRange);

      const result = await service.syncTransactions('user-123', { fullSync: true });

      expect(result.success).toBe(true);
      expect(result.transactionsCreated).toBe(1); // Deduped to 1
    });

    it('should count updates for existing transactions', async () => {
      const { createClient } = await import('@/lib/supabase/server');
      const { paypalAuthService } = await import('../paypal-auth.service');
      const { PayPalApiAdapter } = await import('../paypal-api.adapter');

      const mockFrom = vi.fn();

      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST116' } })),
      });

      mockFrom.mockReturnValueOnce({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn(() => Promise.resolve({ data: { id: 'sync-log-1' }, error: null })),
      });

      // Get existing transactions - one exists
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn(() =>
          Promise.resolve({
            data: [{ paypal_transaction_id: 'TX001' }], // Already exists
            error: null,
          })
        ),
      });

      mockFrom.mockReturnValue({
        upsert: vi.fn(() => Promise.resolve({ error: null })),
        update: vi.fn().mockReturnValue({ eq: vi.fn(() => Promise.resolve({ error: null })) }),
        eq: vi.fn(() => Promise.resolve({ error: null })),
      });

      vi.mocked(createClient).mockResolvedValue({
        from: mockFrom,
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      vi.mocked(paypalAuthService.getAccessToken).mockResolvedValue('test-token');
      vi.mocked(paypalAuthService.getCredentials).mockResolvedValue({
        sandbox: false,
      } as unknown as import('../types').PayPalCredentialsRow);

      const mockApiAdapter = {
        getAllTransactionsInRange: vi.fn().mockResolvedValue([
          {
            transaction_info: {
              transaction_id: 'TX001', // Existing
              transaction_initiation_date: '2024-06-15T10:00:00Z',
              transaction_amount: { value: '100.00', currency_code: 'GBP' },
              fee_amount: { value: '-5.00', currency_code: 'GBP' },
            },
            payer_info: {},
          },
          {
            transaction_info: {
              transaction_id: 'TX002', // New
              transaction_initiation_date: '2024-06-16T10:00:00Z',
              transaction_amount: { value: '200.00', currency_code: 'GBP' },
              fee_amount: { value: '-10.00', currency_code: 'GBP' },
            },
            payer_info: {},
          },
        ]),
      };
      setPayPalApiAdapterMock(mockApiAdapter.getAllTransactionsInRange);

      const result = await service.syncTransactions('user-123', { fullSync: true });

      expect(result.success).toBe(true);
      expect(result.transactionsCreated).toBe(1);
      expect(result.transactionsUpdated).toBe(1);
    });

    it('should extract payer name from different formats', async () => {
      const { createClient } = await import('@/lib/supabase/server');
      const { paypalAuthService } = await import('../paypal-auth.service');
      const { PayPalApiAdapter } = await import('../paypal-api.adapter');

      const mockFrom = vi.fn();

      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST116' } })),
      });

      mockFrom.mockReturnValueOnce({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn(() => Promise.resolve({ data: { id: 'sync-log-1' }, error: null })),
      });

      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn(() => Promise.resolve({ data: [], error: null })),
      });

      mockFrom.mockReturnValue({
        upsert: vi.fn(() => Promise.resolve({ error: null })),
        update: vi.fn().mockReturnValue({ eq: vi.fn(() => Promise.resolve({ error: null })) }),
        eq: vi.fn(() => Promise.resolve({ error: null })),
      });

      vi.mocked(createClient).mockResolvedValue({
        from: mockFrom,
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      vi.mocked(paypalAuthService.getAccessToken).mockResolvedValue('test-token');
      vi.mocked(paypalAuthService.getCredentials).mockResolvedValue({
        sandbox: false,
      } as unknown as import('../types').PayPalCredentialsRow);

      const mockApiAdapter = {
        getAllTransactionsInRange: vi.fn().mockResolvedValue([
          // Transaction with alternate_full_name
          {
            transaction_info: {
              transaction_id: 'TX001',
              transaction_initiation_date: '2024-06-15T10:00:00Z',
              transaction_amount: { value: '100.00', currency_code: 'GBP' },
              fee_amount: { value: '-5.00', currency_code: 'GBP' },
            },
            payer_info: {
              payer_name: { alternate_full_name: 'John Doe' },
            },
          },
          // Transaction with given_name and surname
          {
            transaction_info: {
              transaction_id: 'TX002',
              transaction_initiation_date: '2024-06-16T10:00:00Z',
              transaction_amount: { value: '200.00', currency_code: 'GBP' },
              fee_amount: { value: '-10.00', currency_code: 'GBP' },
            },
            payer_info: {
              payer_name: { given_name: 'Jane', surname: 'Smith' },
            },
          },
          // Transaction with only given_name
          {
            transaction_info: {
              transaction_id: 'TX003',
              transaction_initiation_date: '2024-06-17T10:00:00Z',
              transaction_amount: { value: '50.00', currency_code: 'GBP' },
              fee_amount: { value: '-2.50', currency_code: 'GBP' },
            },
            payer_info: {
              payer_name: { given_name: 'Bob' },
            },
          },
        ]),
      };
      setPayPalApiAdapterMock(mockApiAdapter.getAllTransactionsInRange);

      const result = await service.syncTransactions('user-123', { fullSync: true });

      expect(result.success).toBe(true);
      expect(result.transactionsCreated).toBe(3);
    });

    it('should handle API adapter errors', async () => {
      const { createClient } = await import('@/lib/supabase/server');
      const { paypalAuthService } = await import('../paypal-auth.service');
      const { PayPalApiAdapter } = await import('../paypal-api.adapter');

      const mockFrom = vi.fn();

      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST116' } })),
      });

      mockFrom.mockReturnValueOnce({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn(() => Promise.resolve({ data: { id: 'sync-log-1' }, error: null })),
      });

      mockFrom.mockReturnValue({
        update: vi.fn().mockReturnValue({ eq: vi.fn(() => Promise.resolve({ error: null })) }),
        eq: vi.fn(() => Promise.resolve({ error: null })),
      });

      vi.mocked(createClient).mockResolvedValue({
        from: mockFrom,
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      vi.mocked(paypalAuthService.getAccessToken).mockResolvedValue('test-token');
      vi.mocked(paypalAuthService.getCredentials).mockResolvedValue({
        sandbox: false,
      } as unknown as import('../types').PayPalCredentialsRow);

      const mockApiAdapter = {
        getAllTransactionsInRange: vi
          .fn()
          .mockRejectedValue(new Error('PayPal API rate limit exceeded')),
      };
      setPayPalApiAdapterMock(mockApiAdapter.getAllTransactionsInRange);

      const result = await service.syncTransactions('user-123', { fullSync: true });

      expect(result.success).toBe(false);
      expect(result.error).toBe('PayPal API rate limit exceeded');
    });

    it('should handle sandbox mode from credentials', async () => {
      const { createClient } = await import('@/lib/supabase/server');
      const { paypalAuthService } = await import('../paypal-auth.service');
      const { PayPalApiAdapter } = await import('../paypal-api.adapter');

      const mockFrom = vi.fn();

      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST116' } })),
      });

      mockFrom.mockReturnValueOnce({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn(() => Promise.resolve({ data: { id: 'sync-log-1' }, error: null })),
      });

      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn(() => Promise.resolve({ data: [], error: null })),
        upsert: vi.fn(() => Promise.resolve({ error: null })),
        update: vi.fn().mockReturnValue({ eq: vi.fn(() => Promise.resolve({ error: null })) }),
      });

      vi.mocked(createClient).mockResolvedValue({
        from: mockFrom,
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      vi.mocked(paypalAuthService.getAccessToken).mockResolvedValue('test-token');
      vi.mocked(paypalAuthService.getCredentials).mockResolvedValue({
        sandbox: true,
      } as unknown as import('../types').PayPalCredentialsRow); // Sandbox mode

      const mockApiAdapter = {
        getAllTransactionsInRange: vi.fn().mockResolvedValue([]),
      };
      setPayPalApiAdapterMock(mockApiAdapter.getAllTransactionsInRange);

      const result = await service.syncTransactions('user-123', { fullSync: true });

      expect(result.success).toBe(true);
      // API adapter should have been constructed with sandbox: true
      const constructorArgs = getPayPalApiAdapterConstructorArgs();
      expect(constructorArgs[0]).toEqual(expect.objectContaining({ sandbox: true }));
    });

    it('should handle null credentials', async () => {
      const { createClient } = await import('@/lib/supabase/server');
      const { paypalAuthService } = await import('../paypal-auth.service');
      const { PayPalApiAdapter } = await import('../paypal-api.adapter');

      const mockFrom = vi.fn();

      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST116' } })),
      });

      mockFrom.mockReturnValueOnce({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn(() => Promise.resolve({ data: { id: 'sync-log-1' }, error: null })),
      });

      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn(() => Promise.resolve({ data: [], error: null })),
        upsert: vi.fn(() => Promise.resolve({ error: null })),
        update: vi.fn().mockReturnValue({ eq: vi.fn(() => Promise.resolve({ error: null })) }),
      });

      vi.mocked(createClient).mockResolvedValue({
        from: mockFrom,
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      vi.mocked(paypalAuthService.getAccessToken).mockResolvedValue('test-token');
      vi.mocked(paypalAuthService.getCredentials).mockResolvedValue(null); // No credentials

      const mockApiAdapter = {
        getAllTransactionsInRange: vi.fn().mockResolvedValue([]),
      };
      setPayPalApiAdapterMock(mockApiAdapter.getAllTransactionsInRange);

      const result = await service.syncTransactions('user-123', { fullSync: true });

      expect(result.success).toBe(true);
      // Should default to sandbox: false
      const constructorArgs = getPayPalApiAdapterConstructorArgs();
      expect(constructorArgs[0]).toEqual(expect.objectContaining({ sandbox: false }));
    });

    it('should handle empty transaction list', async () => {
      const { createClient } = await import('@/lib/supabase/server');
      const { paypalAuthService } = await import('../paypal-auth.service');
      const { PayPalApiAdapter } = await import('../paypal-api.adapter');

      const mockFrom = vi.fn();

      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST116' } })),
      });

      mockFrom.mockReturnValueOnce({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn(() => Promise.resolve({ data: { id: 'sync-log-1' }, error: null })),
      });

      mockFrom.mockReturnValue({
        upsert: vi.fn(() => Promise.resolve({ error: null })),
        update: vi.fn().mockReturnValue({ eq: vi.fn(() => Promise.resolve({ error: null })) }),
        eq: vi.fn(() => Promise.resolve({ error: null })),
      });

      vi.mocked(createClient).mockResolvedValue({
        from: mockFrom,
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      vi.mocked(paypalAuthService.getAccessToken).mockResolvedValue('test-token');
      vi.mocked(paypalAuthService.getCredentials).mockResolvedValue({
        sandbox: false,
      } as unknown as import('../types').PayPalCredentialsRow);

      const mockApiAdapter = {
        getAllTransactionsInRange: vi.fn().mockResolvedValue([]),
      };
      setPayPalApiAdapterMock(mockApiAdapter.getAllTransactionsInRange);

      const result = await service.syncTransactions('user-123', { fullSync: true });

      expect(result.success).toBe(true);
      expect(result.transactionsProcessed).toBe(0);
      expect(result.transactionsCreated).toBe(0);
      expect(result.transactionsUpdated).toBe(0);
      expect(result.transactionsSkipped).toBe(0);
    });
  });
});
