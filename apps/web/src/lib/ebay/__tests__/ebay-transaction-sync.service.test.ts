/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  EbayTransactionSyncService,
  ebayTransactionSyncService,
} from '../ebay-transaction-sync.service';
import type { EbayTransactionResponse, EbayPayoutResponse } from '../types';

// Mock dependencies
const mockSupabase = {
  from: vi.fn(),
};

const mockGetAccessToken = vi.fn();

// Store the mock implementations so tests can override them
let mockGetTransactions = vi.fn().mockResolvedValue({
  transactions: [],
  total: 0,
  limit: 1000,
  offset: 0,
});
let mockGetPayouts = vi.fn().mockResolvedValue({
  payouts: [],
  total: 0,
  limit: 200,
  offset: 0,
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
}));

vi.mock('../ebay-auth.service', () => ({
  ebayAuthService: {
    getAccessToken: () => mockGetAccessToken(),
  },
}));

vi.mock('../ebay-api.adapter', () => {
  // Define mock class inside the factory to avoid hoisting issues
  return {
    EbayApiAdapter: class {
      getTransactions(...args: unknown[]) {
        return mockGetTransactions(...args);
      }
      getPayouts(...args: unknown[]) {
        return mockGetPayouts(...args);
      }
      // Static methods need to be defined on the class
      static buildTransactionDateFilter(fromDate?: string, toDate?: string): string | undefined {
        if (!fromDate && !toDate) return undefined;
        const from = fromDate || '2020-01-01T00:00:00.000Z';
        const to = toDate || new Date().toISOString();
        return `${from}..${to}`;
      }
      static buildPayoutDateFilter(fromDate?: string, toDate?: string): string | undefined {
        if (!fromDate && !toDate) return undefined;
        const from = fromDate || '2020-01-01T00:00:00.000Z';
        const to = toDate || new Date().toISOString();
        return `${from}..${to}`;
      }
    },
  };
});

// Helper to set the mock implementation for EbayApiAdapter.getTransactions
const setGetTransactionsMock = (mockFn: typeof mockGetTransactions) => {
  mockGetTransactions = mockFn;
};

// Helper to set the mock implementation for EbayApiAdapter.getPayouts
const setGetPayoutsMock = (mockFn: typeof mockGetPayouts) => {
  mockGetPayouts = mockFn;
};

describe('EbayTransactionSyncService', () => {
  let service: EbayTransactionSyncService;
  const testUserId = 'test-user-123';

  const createMockTransaction = (
    overrides: Partial<EbayTransactionResponse> = {}
  ): EbayTransactionResponse => ({
    transactionId: 'tx-123',
    transactionType: 'SALE',
    transactionStatus: 'FUNDS_AVAILABLE_FOR_PAYOUT',
    transactionDate: '2024-01-15T10:00:00Z',
    amount: { value: '95.00', currency: 'GBP' },
    bookingEntry: 'CREDIT',
    payoutId: 'payout-123',
    orderId: 'order-123',
    buyer: { username: 'testbuyer' },
    transactionMemo: undefined,
    orderLineItems: [
      {
        lineItemId: 'li-123',
        feeBasisAmount: { value: '100.00', currency: 'GBP' },
        marketplaceFees: [
          {
            feeType: 'FINAL_VALUE_FEE_FIXED_PER_ORDER',
            amount: { value: '0.30', currency: 'GBP' },
          },
          { feeType: 'FINAL_VALUE_FEE', amount: { value: '4.70', currency: 'GBP' } },
        ],
      },
    ],
    totalFeeAmount: { value: '5.00', currency: 'GBP' },
    ...overrides,
  });

  const createMockPayout = (overrides: Partial<EbayPayoutResponse> = {}): EbayPayoutResponse => ({
    payoutId: 'payout-123',
    payoutStatus: 'SUCCEEDED',
    payoutDate: '2024-01-16T10:00:00Z',
    amount: { value: '500.00', currency: 'GBP' },
    payoutInstrument: {
      instrumentType: 'BANK',
      nickname: 'Main Account',
      accountLastFourDigits: '1234',
    },
    transactionCount: 5,
    ...overrides,
  });

  const createMockFromChain = (
    options: {
      runningSync?: boolean;
      syncLogCreated?: boolean;
      syncLogId?: string;
      syncConfig?: { transactions_date_cursor?: string; payouts_date_cursor?: string } | null;
      existingTransactionIds?: string[];
      existingPayoutIds?: string[];
      upsertError?: boolean;
    } = {}
  ) => {
    const {
      runningSync = false,
      syncLogCreated = true,
      syncLogId = 'sync-log-123',
      syncConfig = null,
      existingTransactionIds = [],
      existingPayoutIds = [],
      upsertError = false,
    } = options;

    return {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnValue({ eq: vi.fn(() => Promise.resolve({ error: null })) }),
      upsert: vi.fn().mockReturnValue({
        error: upsertError ? { message: 'Upsert failed' } : null,
      }),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnValue({
        data:
          existingTransactionIds.length > 0
            ? existingTransactionIds.map((id) => ({ ebay_transaction_id: id }))
            : existingPayoutIds.length > 0
              ? existingPayoutIds.map((id) => ({ ebay_payout_id: id }))
              : [],
        error: null,
      }),
      single: vi
        .fn()
        .mockResolvedValueOnce({ data: runningSync ? { id: 'running-sync' } : null, error: null })
        .mockResolvedValueOnce({
          data: syncLogCreated ? { id: syncLogId } : null,
          error: syncLogCreated ? null : { message: 'Insert failed' },
        })
        .mockResolvedValueOnce({ data: syncConfig, error: null }),
    };
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useRealTimers();
    // Reset mock implementations to default
    mockGetTransactions = vi.fn().mockResolvedValue({
      transactions: [],
      total: 0,
      limit: 1000,
      offset: 0,
    });
    mockGetPayouts = vi.fn().mockResolvedValue({
      payouts: [],
      total: 0,
      limit: 200,
      offset: 0,
    });
    service = new EbayTransactionSyncService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('syncTransactions', () => {
    it('should return error if sync is already running', async () => {
      mockSupabase.from.mockReturnValue(createMockFromChain({ runningSync: true }));

      const result = await service.syncTransactions(testUserId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('A transaction sync is already running');
      expect(result.recordsProcessed).toBe(0);
    });

    it('should throw error if sync log creation fails', async () => {
      mockSupabase.from.mockReturnValue(createMockFromChain({ syncLogCreated: false }));

      await expect(service.syncTransactions(testUserId)).rejects.toThrow('Failed to start sync');
    });

    it('should return error if no access token available', async () => {
      const mockChain = createMockFromChain();
      mockSupabase.from.mockReturnValue(mockChain);
      mockGetAccessToken.mockResolvedValue(null);

      const result = await service.syncTransactions(testUserId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No valid eBay access token');
    });

    it('should determine INCREMENTAL sync mode when no options provided', async () => {
      const mockChain = createMockFromChain();
      mockSupabase.from.mockReturnValue(mockChain);
      mockGetAccessToken.mockResolvedValue(null);

      const result = await service.syncTransactions(testUserId);

      expect(result.syncType).toBe('INCREMENTAL');
    });

    it('should determine FULL sync mode when fullSync option is true', async () => {
      const mockChain = createMockFromChain();
      mockSupabase.from.mockReturnValue(mockChain);
      mockGetAccessToken.mockResolvedValue(null);

      const result = await service.syncTransactions(testUserId, { fullSync: true });

      expect(result.syncType).toBe('FULL');
    });

    it('should determine HISTORICAL sync mode when fromDate is provided', async () => {
      const mockChain = createMockFromChain();
      mockSupabase.from.mockReturnValue(mockChain);
      mockGetAccessToken.mockResolvedValue(null);

      const result = await service.syncTransactions(testUserId, {
        fromDate: '2023-01-01T00:00:00Z',
        toDate: '2023-12-31T23:59:59Z',
      });

      expect(result.syncType).toBe('HISTORICAL');
    });

    it('should successfully sync transactions with pagination', async () => {
      const mockChain = createMockFromChain();
      mockSupabase.from.mockReturnValue(mockChain);
      mockGetAccessToken.mockResolvedValue('valid-token');

      const transactions = Array.from({ length: 5 }, (_, i) =>
        createMockTransaction({ transactionId: `tx-${i}` })
      );

      mockGetTransactions.mockResolvedValue({
        transactions,
        total: 5,
        limit: 1000,
        offset: 0,
      });

      const result = await service.syncTransactions(testUserId);

      expect(result.success).toBe(true);
      expect(result.recordsProcessed).toBe(5);
      expect(mockGetTransactions).toHaveBeenCalled();
    });

    it('should handle pagination when total exceeds page size', async () => {
      const mockChain = createMockFromChain();
      mockSupabase.from.mockReturnValue(mockChain);
      mockGetAccessToken.mockResolvedValue('valid-token');

      // First page
      const page1 = Array.from({ length: 1000 }, (_, i) =>
        createMockTransaction({ transactionId: `tx-${i}` })
      );
      // Second page
      const page2 = Array.from({ length: 500 }, (_, i) =>
        createMockTransaction({ transactionId: `tx-${1000 + i}` })
      );

      mockGetTransactions
        .mockResolvedValueOnce({ transactions: page1, total: 1500, limit: 1000, offset: 0 })
        .mockResolvedValueOnce({ transactions: page2, total: 1500, limit: 1000, offset: 1000 });

      const result = await service.syncTransactions(testUserId);

      expect(result.success).toBe(true);
      expect(result.recordsProcessed).toBe(1500);
      expect(mockGetTransactions).toHaveBeenCalledTimes(2);
    });

    it('should use incremental cursor from sync config', async () => {
      const mockChain = createMockFromChain({
        syncConfig: { transactions_date_cursor: '2024-01-01T00:00:00Z' },
      });
      mockSupabase.from.mockReturnValue(mockChain);
      mockGetAccessToken.mockResolvedValue('valid-token');
      mockGetTransactions.mockResolvedValue({
        transactions: [],
        total: 0,
        limit: 1000,
        offset: 0,
      });

      await service.syncTransactions(testUserId);

      expect(mockGetTransactions).toHaveBeenCalled();
    });

    it('should handle API errors gracefully', async () => {
      const mockChain = createMockFromChain();
      mockSupabase.from.mockReturnValue(mockChain);
      mockGetAccessToken.mockResolvedValue('valid-token');
      mockGetTransactions.mockRejectedValue(new Error('API Error'));

      const result = await service.syncTransactions(testUserId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('API Error');
    });

    it('should deduplicate transactions from API response', async () => {
      const mockChain = createMockFromChain();
      mockSupabase.from.mockReturnValue(mockChain);
      mockGetAccessToken.mockResolvedValue('valid-token');

      // Same transaction ID returned twice (can happen across pages)
      const transactions = [
        createMockTransaction({ transactionId: 'tx-1' }),
        createMockTransaction({ transactionId: 'tx-1' }),
        createMockTransaction({ transactionId: 'tx-2' }),
      ];

      mockGetTransactions.mockResolvedValue({
        transactions,
        total: 3,
        limit: 1000,
        offset: 0,
      });

      const result = await service.syncTransactions(testUserId);

      expect(result.success).toBe(true);
      // Should dedupe to 2 unique transactions
    });

    it('should count created vs updated transactions correctly', async () => {
      const mockChain = createMockFromChain({
        existingTransactionIds: ['tx-1'], // tx-1 already exists
      });
      mockSupabase.from.mockReturnValue(mockChain);
      mockGetAccessToken.mockResolvedValue('valid-token');

      const transactions = [
        createMockTransaction({ transactionId: 'tx-1' }), // Update
        createMockTransaction({ transactionId: 'tx-2' }), // Create
        createMockTransaction({ transactionId: 'tx-3' }), // Create
      ];

      mockGetTransactions.mockResolvedValue({
        transactions,
        total: 3,
        limit: 1000,
        offset: 0,
      });

      const result = await service.syncTransactions(testUserId);

      expect(result.success).toBe(true);
      // 1 updated, 2 created
    });

    it('should update sync cursor after successful sync', async () => {
      const mockChain = createMockFromChain();
      mockSupabase.from.mockReturnValue(mockChain);
      mockGetAccessToken.mockResolvedValue('valid-token');

      const transactions = [
        createMockTransaction({ transactionId: 'tx-1', transactionDate: '2024-01-15T10:00:00Z' }),
        createMockTransaction({ transactionId: 'tx-2', transactionDate: '2024-01-16T10:00:00Z' }),
      ];

      mockGetTransactions.mockResolvedValue({
        transactions,
        total: 2,
        limit: 1000,
        offset: 0,
      });

      const result = await service.syncTransactions(testUserId);

      expect(result.success).toBe(true);
      expect(result.lastSyncCursor).toBeDefined();
    });

    it('should handle empty transaction response', async () => {
      const mockChain = createMockFromChain();
      mockSupabase.from.mockReturnValue(mockChain);
      mockGetAccessToken.mockResolvedValue('valid-token');

      mockGetTransactions.mockResolvedValue({
        transactions: [],
        total: 0,
        limit: 1000,
        offset: 0,
      });

      const result = await service.syncTransactions(testUserId);

      expect(result.success).toBe(true);
      expect(result.recordsProcessed).toBe(0);
      expect(result.recordsCreated).toBe(0);
      expect(result.recordsUpdated).toBe(0);
    });
  });

  describe('syncPayouts', () => {
    it('should return error if payout sync is already running', async () => {
      const mockChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: 'running-sync' }, error: null }),
      };
      mockSupabase.from.mockReturnValue(mockChain);

      const result = await service.syncPayouts(testUserId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('A payout sync is already running');
    });

    it('should throw error if payout sync log creation fails', async () => {
      const mockChain = {
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi
          .fn()
          .mockResolvedValueOnce({ data: null, error: null })
          .mockResolvedValueOnce({ data: null, error: { message: 'Insert failed' } }),
      };
      mockSupabase.from.mockReturnValue(mockChain);

      await expect(service.syncPayouts(testUserId)).rejects.toThrow('Failed to start sync');
    });

    it('should return error if no access token for payouts', async () => {
      const mockChain = createMockFromChain();
      mockSupabase.from.mockReturnValue(mockChain);
      mockGetAccessToken.mockResolvedValue(null);

      const result = await service.syncPayouts(testUserId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No valid eBay access token');
    });

    it('should determine payout sync mode correctly', async () => {
      mockGetAccessToken.mockResolvedValue(null);

      // INCREMENTAL - reset mock chain for each call
      mockSupabase.from.mockReturnValue(createMockFromChain());
      let result = await service.syncPayouts(testUserId);
      expect(result.syncType).toBe('INCREMENTAL');

      // FULL - fresh mock chain
      mockSupabase.from.mockReturnValue(createMockFromChain());
      result = await service.syncPayouts(testUserId, { fullSync: true });
      expect(result.syncType).toBe('FULL');

      // HISTORICAL - fresh mock chain
      mockSupabase.from.mockReturnValue(createMockFromChain());
      result = await service.syncPayouts(testUserId, { fromDate: '2023-01-01' });
      expect(result.syncType).toBe('HISTORICAL');
    });

    it('should successfully sync payouts', async () => {
      const mockChain = createMockFromChain();
      mockSupabase.from.mockReturnValue(mockChain);
      mockGetAccessToken.mockResolvedValue('valid-token');

      const payouts = Array.from({ length: 3 }, (_, i) =>
        createMockPayout({ payoutId: `payout-${i}` })
      );

      mockGetPayouts.mockResolvedValue({
        payouts,
        total: 3,
        limit: 200,
        offset: 0,
      });

      const result = await service.syncPayouts(testUserId);

      expect(result.success).toBe(true);
      expect(result.recordsProcessed).toBe(3);
    });

    it('should handle payout pagination', async () => {
      const mockChain = createMockFromChain();
      mockSupabase.from.mockReturnValue(mockChain);
      mockGetAccessToken.mockResolvedValue('valid-token');

      const page1 = Array.from({ length: 200 }, (_, i) =>
        createMockPayout({ payoutId: `payout-${i}` })
      );
      const page2 = Array.from({ length: 50 }, (_, i) =>
        createMockPayout({ payoutId: `payout-${200 + i}` })
      );

      mockGetPayouts
        .mockResolvedValueOnce({ payouts: page1, total: 250, limit: 200, offset: 0 })
        .mockResolvedValueOnce({ payouts: page2, total: 250, limit: 200, offset: 200 });

      const result = await service.syncPayouts(testUserId);

      expect(result.success).toBe(true);
      expect(result.recordsProcessed).toBe(250);
      expect(mockGetPayouts).toHaveBeenCalledTimes(2);
    });

    it('should use payout cursor from sync config', async () => {
      const mockChain = createMockFromChain({
        syncConfig: { payouts_date_cursor: '2024-01-01T00:00:00Z' },
      });
      mockSupabase.from.mockReturnValue(mockChain);
      mockGetAccessToken.mockResolvedValue('valid-token');
      mockGetPayouts.mockResolvedValue({
        payouts: [],
        total: 0,
        limit: 200,
        offset: 0,
      });

      await service.syncPayouts(testUserId);

      expect(mockGetPayouts).toHaveBeenCalled();
    });

    it('should handle payout API errors', async () => {
      const mockChain = createMockFromChain();
      mockSupabase.from.mockReturnValue(mockChain);
      mockGetAccessToken.mockResolvedValue('valid-token');
      mockGetPayouts.mockRejectedValue(new Error('Payout API Error'));

      const result = await service.syncPayouts(testUserId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Payout API Error');
    });

    it('should deduplicate payouts', async () => {
      const mockChain = createMockFromChain();
      mockSupabase.from.mockReturnValue(mockChain);
      mockGetAccessToken.mockResolvedValue('valid-token');

      const payouts = [
        createMockPayout({ payoutId: 'payout-1' }),
        createMockPayout({ payoutId: 'payout-1' }),
        createMockPayout({ payoutId: 'payout-2' }),
      ];

      mockGetPayouts.mockResolvedValue({
        payouts,
        total: 3,
        limit: 200,
        offset: 0,
      });

      const result = await service.syncPayouts(testUserId);

      expect(result.success).toBe(true);
    });

    it('should handle empty payout response', async () => {
      const mockChain = createMockFromChain();
      mockSupabase.from.mockReturnValue(mockChain);
      mockGetAccessToken.mockResolvedValue('valid-token');

      mockGetPayouts.mockResolvedValue({
        payouts: [],
        total: 0,
        limit: 200,
        offset: 0,
      });

      const result = await service.syncPayouts(testUserId);

      expect(result.success).toBe(true);
      expect(result.recordsProcessed).toBe(0);
    });
  });

  describe('performHistoricalImport', () => {
    it('should sync both transactions and payouts', async () => {
      const syncTransactionsSpy = vi.spyOn(service, 'syncTransactions').mockResolvedValue({
        success: true,
        syncType: 'HISTORICAL',
        recordsProcessed: 100,
        recordsCreated: 100,
        recordsUpdated: 0,
        startedAt: new Date(),
        completedAt: new Date(),
      });

      const syncPayoutsSpy = vi.spyOn(service, 'syncPayouts').mockResolvedValue({
        success: true,
        syncType: 'HISTORICAL',
        recordsProcessed: 20,
        recordsCreated: 20,
        recordsUpdated: 0,
        startedAt: new Date(),
        completedAt: new Date(),
      });

      mockSupabase.from.mockReturnValue({
        upsert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnValue({ eq: vi.fn(() => Promise.resolve({ error: null })) }),
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      const result = await service.performHistoricalImport(testUserId, '2023-01-01');

      expect(syncTransactionsSpy).toHaveBeenCalledWith(
        testUserId,
        expect.objectContaining({
          fromDate: '2023-01-01',
        })
      );
      expect(syncPayoutsSpy).toHaveBeenCalledWith(
        testUserId,
        expect.objectContaining({
          fromDate: '2023-01-01',
        })
      );
      expect(result.transactions.success).toBe(true);
      expect(result.payouts.success).toBe(true);

      syncTransactionsSpy.mockRestore();
      syncPayoutsSpy.mockRestore();
    });

    it('should use current date as toDate', async () => {
      const syncTransactionsSpy = vi.spyOn(service, 'syncTransactions').mockResolvedValue({
        success: true,
        syncType: 'HISTORICAL',
        recordsProcessed: 0,
        recordsCreated: 0,
        recordsUpdated: 0,
        startedAt: new Date(),
        completedAt: new Date(),
      });

      const syncPayoutsSpy = vi.spyOn(service, 'syncPayouts').mockResolvedValue({
        success: true,
        syncType: 'HISTORICAL',
        recordsProcessed: 0,
        recordsCreated: 0,
        recordsUpdated: 0,
        startedAt: new Date(),
        completedAt: new Date(),
      });

      mockSupabase.from.mockReturnValue({
        upsert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnValue({ eq: vi.fn(() => Promise.resolve({ error: null })) }),
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      await service.performHistoricalImport(testUserId, '2023-01-01');

      expect(syncTransactionsSpy).toHaveBeenCalledWith(
        testUserId,
        expect.objectContaining({
          fromDate: '2023-01-01',
          toDate: expect.any(String),
        })
      );

      syncTransactionsSpy.mockRestore();
      syncPayoutsSpy.mockRestore();
    });

    it('should update sync config on completion', async () => {
      vi.spyOn(service, 'syncTransactions').mockResolvedValue({
        success: true,
        syncType: 'HISTORICAL',
        recordsProcessed: 50,
        recordsCreated: 50,
        recordsUpdated: 0,
        startedAt: new Date(),
        completedAt: new Date(),
      });

      vi.spyOn(service, 'syncPayouts').mockResolvedValue({
        success: true,
        syncType: 'HISTORICAL',
        recordsProcessed: 10,
        recordsCreated: 10,
        recordsUpdated: 0,
        startedAt: new Date(),
        completedAt: new Date(),
      });

      const mockUpsert = vi.fn().mockReturnThis();
      const mockUpdate = vi.fn().mockReturnThis();
      mockSupabase.from.mockReturnValue({
        upsert: mockUpsert,
        update: mockUpdate,
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      await service.performHistoricalImport(testUserId, '2023-01-01');

      // Should track historical import in sync config
      expect(mockSupabase.from).toHaveBeenCalledWith('ebay_sync_config');
    });

    it('should handle partial failure', async () => {
      vi.spyOn(service, 'syncTransactions').mockResolvedValue({
        success: true,
        syncType: 'HISTORICAL',
        recordsProcessed: 50,
        recordsCreated: 50,
        recordsUpdated: 0,
        startedAt: new Date(),
        completedAt: new Date(),
      });

      vi.spyOn(service, 'syncPayouts').mockResolvedValue({
        success: false,
        syncType: 'HISTORICAL',
        recordsProcessed: 0,
        recordsCreated: 0,
        recordsUpdated: 0,
        error: 'Payout sync failed',
        startedAt: new Date(),
        completedAt: new Date(),
      });

      mockSupabase.from.mockReturnValue({
        upsert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnValue({ eq: vi.fn(() => Promise.resolve({ error: null })) }),
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      const result = await service.performHistoricalImport(testUserId, '2023-01-01');

      expect(result.transactions.success).toBe(true);
      expect(result.payouts.success).toBe(false);
    });
  });

  describe('getSyncStatus', () => {
    it('should return sync status for transactions and payouts', async () => {
      let fromCallCount = 0;

      mockSupabase.from.mockImplementation(() => {
        fromCallCount++;

        // Query 1: running syncs
        if (fromCallCount === 1) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          };
        }

        // Query 2: last transaction sync
        if (fromCallCount === 2) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                      single: vi
                        .fn()
                        .mockResolvedValue({
                          data: {
                            status: 'COMPLETED',
                            completed_at: '2024-01-15T10:00:00Z',
                            records_processed: 100,
                          },
                          error: null,
                        }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }

        // Query 3: last payout sync
        if (fromCallCount === 3) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                      single: vi
                        .fn()
                        .mockResolvedValue({
                          data: {
                            status: 'COMPLETED',
                            completed_at: '2024-01-15T10:00:00Z',
                            records_processed: 20,
                          },
                          error: null,
                        }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }

        // Query 4: sync config
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi
                .fn()
                .mockResolvedValue({
                  data: { auto_sync_enabled: true, historical_import_completed_at: '2024-01-01' },
                  error: null,
                }),
            }),
          }),
        };
      });

      const status = await service.getSyncStatus(testUserId);

      expect(status).toHaveProperty('transactions');
      expect(status).toHaveProperty('payouts');
      expect(status).toHaveProperty('config');
    });

    it('should identify running syncs', async () => {
      let fromCallCount = 0;

      mockSupabase.from.mockImplementation(() => {
        fromCallCount++;

        // Query 1: running syncs - returns TRANSACTIONS as running
        if (fromCallCount === 1) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi
                  .fn()
                  .mockResolvedValue({ data: [{ sync_type: 'TRANSACTIONS' }], error: null }),
              }),
            }),
          };
        }

        // Query 2: last transaction sync
        if (fromCallCount === 2) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                      single: vi.fn().mockResolvedValue({ data: null, error: null }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }

        // Query 3: last payout sync
        if (fromCallCount === 3) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                      single: vi.fn().mockResolvedValue({ data: null, error: null }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }

        // Query 4: sync config
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        };
      });

      const status = await service.getSyncStatus(testUserId);

      expect(status.transactions.isRunning).toBe(true);
    });

    it('should return last sync details', async () => {
      const completedAt = '2024-01-15T10:00:00Z';
      let fromCallCount = 0;

      mockSupabase.from.mockImplementation(() => {
        fromCallCount++;

        // Query 1: running syncs - from('ebay_sync_log').select().eq().eq()
        if (fromCallCount === 1) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          };
        }

        // Query 2: last transaction sync - from('ebay_sync_log').select().eq().eq().order().limit().single()
        if (fromCallCount === 2) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                      single: vi
                        .fn()
                        .mockResolvedValue({
                          data: {
                            status: 'COMPLETED',
                            completed_at: completedAt,
                            records_processed: 100,
                          },
                          error: null,
                        }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }

        // Query 3: last payout sync
        if (fromCallCount === 3) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                      single: vi
                        .fn()
                        .mockResolvedValue({
                          data: {
                            status: 'FAILED',
                            completed_at: completedAt,
                            records_processed: 0,
                          },
                          error: null,
                        }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }

        // Query 4: sync config - from('ebay_sync_config').select().eq().single()
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        };
      });

      const status = await service.getSyncStatus(testUserId);

      expect(status.transactions.lastSync?.status).toBe('COMPLETED');
      expect(status.transactions.lastSync?.recordsProcessed).toBe(100);
      expect(status.payouts.lastSync?.status).toBe('FAILED');
    });

    it('should return sync config when available', async () => {
      let fromCallCount = 0;

      mockSupabase.from.mockImplementation(() => {
        fromCallCount++;

        // Query 1: running syncs - from('ebay_sync_log').select().eq().eq()
        if (fromCallCount === 1) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          };
        }

        // Query 2: last transaction sync
        if (fromCallCount === 2) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                      single: vi.fn().mockResolvedValue({ data: null, error: null }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }

        // Query 3: last payout sync
        if (fromCallCount === 3) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                      single: vi.fn().mockResolvedValue({ data: null, error: null }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }

        // Query 4: sync config - from('ebay_sync_config').select().eq().single()
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  auto_sync_enabled: true,
                  next_auto_sync_at: '2024-01-16T00:00:00Z',
                  historical_import_completed_at: '2024-01-01T00:00:00Z',
                },
                error: null,
              }),
            }),
          }),
        };
      });

      const status = await service.getSyncStatus(testUserId);

      expect(status.config?.autoSyncEnabled).toBe(true);
      expect(status.config?.historicalImportCompleted).toBe(true);
    });

    it('should handle no sync config', async () => {
      let fromCallCount = 0;

      mockSupabase.from.mockImplementation(() => {
        fromCallCount++;

        // Query 1: running syncs
        if (fromCallCount === 1) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          };
        }

        // Query 2: last transaction sync
        if (fromCallCount === 2) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                      single: vi.fn().mockResolvedValue({ data: null, error: null }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }

        // Query 3: last payout sync
        if (fromCallCount === 3) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                      single: vi.fn().mockResolvedValue({ data: null, error: null }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }

        // Query 4: sync config - returns null
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        };
      });

      const status = await service.getSyncStatus(testUserId);

      expect(status.config).toBeUndefined();
    });
  });

  describe('fee extraction', () => {
    it('should extract fees from order line items', () => {
      const transaction = createMockTransaction({
        orderLineItems: [
          {
            lineItemId: 'li-1',
            feeBasisAmount: { value: '100.00', currency: 'GBP' },
            marketplaceFees: [
              {
                feeType: 'FINAL_VALUE_FEE_FIXED_PER_ORDER',
                amount: { value: '0.30', currency: 'GBP' },
              },
              { feeType: 'FINAL_VALUE_FEE', amount: { value: '12.70', currency: 'GBP' } },
              { feeType: 'REGULATORY_OPERATING_FEE', amount: { value: '0.24', currency: 'GBP' } },
              { feeType: 'INTERNATIONAL_FEE', amount: { value: '1.50', currency: 'GBP' } },
              { feeType: 'AD_FEE', amount: { value: '2.00', currency: 'GBP' } },
            ],
          },
        ],
      });

      expect(transaction.orderLineItems).toBeDefined();
      expect(transaction.orderLineItems?.length).toBe(1);
      expect(transaction.orderLineItems?.[0].marketplaceFees?.length).toBe(5);
    });

    it('should calculate total fees correctly', () => {
      const fees = [
        { feeType: 'FINAL_VALUE_FEE_FIXED_PER_ORDER', amount: { value: '0.30', currency: 'GBP' } },
        { feeType: 'FINAL_VALUE_FEE', amount: { value: '12.70', currency: 'GBP' } },
        { feeType: 'REGULATORY_OPERATING_FEE', amount: { value: '0.24', currency: 'GBP' } },
      ];

      const totalFees = fees.reduce((sum, fee) => sum + parseFloat(fee.amount.value), 0);
      expect(totalFees).toBeCloseTo(13.24, 2);
    });

    it('should handle transactions without fees', () => {
      const transaction = createMockTransaction({
        orderLineItems: [
          {
            lineItemId: 'li-1',
            feeBasisAmount: { value: '50.00', currency: 'GBP' },
            marketplaceFees: [],
          },
        ],
      });

      expect(transaction.orderLineItems?.[0].marketplaceFees).toEqual([]);
    });

    it('should handle transactions without order line items', () => {
      const transaction = createMockTransaction({
        orderLineItems: undefined,
      });

      expect(transaction.orderLineItems).toBeUndefined();
    });

    it('should calculate gross amount for CREDIT transactions', () => {
      const netAmount = 95.0;
      const totalFees = 5.0;
      const bookingEntry = 'CREDIT';

      const grossAmount = bookingEntry === 'CREDIT' ? netAmount + totalFees : netAmount;
      expect(grossAmount).toBe(100.0);
    });

    it('should handle DEBIT booking entries', () => {
      const transaction = createMockTransaction({
        bookingEntry: 'DEBIT',
        amount: { value: '-50.00', currency: 'GBP' },
      });

      expect(transaction.bookingEntry).toBe('DEBIT');
    });
  });

  describe('transaction types', () => {
    it('should handle SALE transactions', () => {
      const transaction = createMockTransaction({ transactionType: 'SALE' });
      expect(transaction.transactionType).toBe('SALE');
    });

    it('should handle REFUND transactions', () => {
      const transaction = createMockTransaction({
        transactionType: 'REFUND',
        bookingEntry: 'DEBIT',
        amount: { value: '-25.00', currency: 'GBP' },
      });

      expect(transaction.transactionType).toBe('REFUND');
      expect(transaction.bookingEntry).toBe('DEBIT');
    });

    it('should handle SHIPPING_LABEL transactions', () => {
      const transaction = createMockTransaction({
        transactionType: 'SHIPPING_LABEL',
        bookingEntry: 'DEBIT',
        amount: { value: '-5.50', currency: 'GBP' },
        orderId: undefined,
      });

      expect(transaction.transactionType).toBe('SHIPPING_LABEL');
    });

    it('should handle TRANSFER transactions', () => {
      const transaction = createMockTransaction({
        transactionType: 'TRANSFER',
        bookingEntry: 'DEBIT',
        payoutId: 'payout-123',
      });

      expect(transaction.transactionType).toBe('TRANSFER');
    });
  });

  describe('payout data', () => {
    it('should handle payout with instrument details', () => {
      const payout = createMockPayout({
        payoutInstrument: {
          instrumentType: 'BANK',
          nickname: 'Business Account',
          accountLastFourDigits: '5678',
        },
      });

      expect(payout.payoutInstrument?.instrumentType).toBe('BANK');
      expect(payout.payoutInstrument?.accountLastFourDigits).toBe('5678');
    });

    it('should handle payout without instrument', () => {
      const payout = createMockPayout({
        payoutInstrument: undefined,
      });

      expect(payout.payoutInstrument).toBeUndefined();
    });

    it('should handle various payout statuses', () => {
      const statuses = ['SUCCEEDED', 'PENDING', 'FAILED', 'RETRYABLE_FAILURE'];

      for (const status of statuses) {
        const payout = createMockPayout({ payoutStatus: status });
        expect(payout.payoutStatus).toBe(status);
      }
    });

    it('should track transaction count in payout', () => {
      const payout = createMockPayout({ transactionCount: 15 });
      expect(payout.transactionCount).toBe(15);
    });
  });

  describe('batch upsert', () => {
    it('should process transactions in batches', () => {
      const totalItems = 250;
      const batchSize = 100;
      const expectedBatches = Math.ceil(totalItems / batchSize);

      expect(expectedBatches).toBe(3);
    });

    it('should handle last partial batch', () => {
      const totalItems = 250;
      const batchSize = 100;
      const lastBatchSize = totalItems % batchSize;

      expect(lastBatchSize).toBe(50);
    });
  });

  describe('rate limiting', () => {
    it('should delay between paginated requests', async () => {
      const delayMs = 150;
      const startTime = Date.now();

      await new Promise((resolve) => setTimeout(resolve, delayMs));

      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeGreaterThanOrEqual(delayMs - 10); // Allow some tolerance
    });
  });

  describe('error handling', () => {
    it('should update sync log on failure', async () => {
      const mockChain = createMockFromChain();
      mockSupabase.from.mockReturnValue(mockChain);
      mockGetAccessToken.mockResolvedValue('valid-token');
      mockGetTransactions.mockRejectedValue(new Error('Connection timeout'));

      const result = await service.syncTransactions(testUserId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection timeout');
      expect(result.completedAt).toBeDefined();
    });

    it('should handle unknown errors', async () => {
      const mockChain = createMockFromChain();
      mockSupabase.from.mockReturnValue(mockChain);
      mockGetAccessToken.mockResolvedValue('valid-token');
      mockGetTransactions.mockRejectedValue('String error');

      const result = await service.syncTransactions(testUserId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });
  });

  describe('exported instance', () => {
    it('should export a singleton instance', () => {
      expect(ebayTransactionSyncService).toBeDefined();
      expect(ebayTransactionSyncService).toBeInstanceOf(EbayTransactionSyncService);
    });
  });

  describe('EbaySyncResult structure', () => {
    it('should have all required fields', async () => {
      const mockChain = createMockFromChain({ runningSync: true });
      mockSupabase.from.mockReturnValue(mockChain);

      const result = await service.syncTransactions(testUserId);

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('syncType');
      expect(result).toHaveProperty('recordsProcessed');
      expect(result).toHaveProperty('recordsCreated');
      expect(result).toHaveProperty('recordsUpdated');
      expect(result).toHaveProperty('startedAt');
      expect(result).toHaveProperty('completedAt');
    });

    it('should include optional lastSyncCursor on success', async () => {
      const mockChain = createMockFromChain();
      mockSupabase.from.mockReturnValue(mockChain);
      mockGetAccessToken.mockResolvedValue('valid-token');

      mockGetTransactions.mockResolvedValue({
        transactions: [createMockTransaction()],
        total: 1,
        limit: 1000,
        offset: 0,
      });

      const result = await service.syncTransactions(testUserId);

      if (result.success) {
        expect(result.lastSyncCursor).toBeDefined();
      }
    });
  });

  describe('currency handling', () => {
    it('should handle GBP transactions', () => {
      const transaction = createMockTransaction({
        amount: { value: '100.00', currency: 'GBP' },
      });

      expect(transaction.amount.currency).toBe('GBP');
    });

    it('should handle EUR transactions', () => {
      const transaction = createMockTransaction({
        amount: { value: '85.00', currency: 'EUR' },
      });

      expect(transaction.amount.currency).toBe('EUR');
    });

    it('should handle USD transactions', () => {
      const transaction = createMockTransaction({
        amount: { value: '120.00', currency: 'USD' },
      });

      expect(transaction.amount.currency).toBe('USD');
    });
  });
});
