import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MonzoApiService } from '../monzo-api.service';

// Mock dependencies
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('../monzo-auth.service', () => ({
  monzoAuthService: {
    getAccessToken: vi.fn(),
    getAccountId: vi.fn(),
  },
}));

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('MonzoApiService', () => {
  let service: MonzoApiService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new MonzoApiService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchTransactions', () => {
    it('should throw error when no access token', async () => {
      const { monzoAuthService } = await import('../monzo-auth.service');
      vi.mocked(monzoAuthService.getAccessToken).mockResolvedValue(null);

      await expect(service.fetchTransactions('user-123')).rejects.toThrow(
        'No valid access token'
      );
    });

    it('should throw error when no account ID', async () => {
      const { monzoAuthService } = await import('../monzo-auth.service');
      vi.mocked(monzoAuthService.getAccessToken).mockResolvedValue('test-token');
      vi.mocked(monzoAuthService.getAccountId).mockResolvedValue(null);

      await expect(service.fetchTransactions('user-123')).rejects.toThrow(
        'No account ID found'
      );
    });

    it('should fetch transactions successfully', async () => {
      const { monzoAuthService } = await import('../monzo-auth.service');
      vi.mocked(monzoAuthService.getAccessToken).mockResolvedValue('test-token');
      vi.mocked(monzoAuthService.getAccountId).mockResolvedValue('acc-123');

      const mockTransactions = [
        {
          id: 'tx-1',
          created: '2025-01-01T12:00:00Z',
          description: 'Test Transaction',
          amount: -1000,
          currency: 'GBP',
          category: 'shopping',
          is_load: false,
          account_id: 'acc-123',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ transactions: mockTransactions }),
      });

      const result = await service.fetchTransactions('user-123');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('tx-1');
    });

    it('should handle rate limiting', async () => {
      const { monzoAuthService } = await import('../monzo-auth.service');
      vi.mocked(monzoAuthService.getAccessToken).mockResolvedValue('test-token');
      vi.mocked(monzoAuthService.getAccountId).mockResolvedValue('acc-123');

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: () => Promise.resolve('Rate limited'),
      });

      await expect(service.fetchTransactions('user-123')).rejects.toThrow(
        'Rate limited by Monzo'
      );
    });

    it('should handle expired token', async () => {
      const { monzoAuthService } = await import('../monzo-auth.service');
      vi.mocked(monzoAuthService.getAccessToken).mockResolvedValue('test-token');
      vi.mocked(monzoAuthService.getAccountId).mockResolvedValue('acc-123');

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      });

      await expect(service.fetchTransactions('user-123')).rejects.toThrow(
        'Access token expired'
      );
    });

    it('should apply pagination parameters', async () => {
      const { monzoAuthService } = await import('../monzo-auth.service');
      vi.mocked(monzoAuthService.getAccessToken).mockResolvedValue('test-token');
      vi.mocked(monzoAuthService.getAccountId).mockResolvedValue('acc-123');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ transactions: [] }),
      });

      await service.fetchTransactions('user-123', {
        since: 'tx-previous',
        limit: 50,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('since=tx-previous'),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=50'),
        expect.any(Object)
      );
    });

    it('should apply before parameter for backward pagination', async () => {
      const { monzoAuthService } = await import('../monzo-auth.service');
      vi.mocked(monzoAuthService.getAccessToken).mockResolvedValue('test-token');
      vi.mocked(monzoAuthService.getAccountId).mockResolvedValue('acc-123');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ transactions: [] }),
      });

      await service.fetchTransactions('user-123', {
        before: 'tx-oldest',
        limit: 100,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('before=tx-oldest'),
        expect.any(Object)
      );
    });

    it('should handle generic API errors', async () => {
      const { monzoAuthService } = await import('../monzo-auth.service');
      vi.mocked(monzoAuthService.getAccessToken).mockResolvedValue('test-token');
      vi.mocked(monzoAuthService.getAccountId).mockResolvedValue('acc-123');

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      await expect(service.fetchTransactions('user-123')).rejects.toThrow(
        'Failed to fetch transactions: 500'
      );
    });

    it('should return empty array when response has no transactions', async () => {
      const { monzoAuthService } = await import('../monzo-auth.service');
      vi.mocked(monzoAuthService.getAccessToken).mockResolvedValue('test-token');
      vi.mocked(monzoAuthService.getAccountId).mockResolvedValue('acc-123');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const result = await service.fetchTransactions('user-123');

      expect(result).toEqual([]);
    });

    it('should use default limit when not specified', async () => {
      const { monzoAuthService } = await import('../monzo-auth.service');
      vi.mocked(monzoAuthService.getAccessToken).mockResolvedValue('test-token');
      vi.mocked(monzoAuthService.getAccountId).mockResolvedValue('acc-123');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ transactions: [] }),
      });

      await service.fetchTransactions('user-123');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=100'),
        expect.any(Object)
      );
    });

    it('should include authorization header with bearer token', async () => {
      const { monzoAuthService } = await import('../monzo-auth.service');
      vi.mocked(monzoAuthService.getAccessToken).mockResolvedValue('my-access-token');
      vi.mocked(monzoAuthService.getAccountId).mockResolvedValue('acc-123');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ transactions: [] }),
      });

      await service.fetchTransactions('user-123');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: {
            Authorization: 'Bearer my-access-token',
          },
        })
      );
    });
  });

  describe('performFullSync', () => {
    it('should return error when sync log creation fails', async () => {
      const { createClient } = await import('@/lib/supabase/server');
      vi.mocked(createClient).mockResolvedValue({
        from: vi.fn(() => ({
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn(() =>
            Promise.resolve({
              data: null,
              error: { message: 'Failed to create log' },
            })
          ),
        })),
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      await expect(service.performFullSync('user-123')).rejects.toThrow(
        'Failed to start sync'
      );
    });

    it('should handle errors during sync and update log', async () => {
      const { createClient } = await import('@/lib/supabase/server');
      const { monzoAuthService } = await import('../monzo-auth.service');

      const mockUpdate = vi.fn().mockReturnThis();
      const mockEq = vi.fn(() => Promise.resolve({ error: null }));

      vi.mocked(createClient).mockResolvedValue({
        from: vi.fn(() => ({
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          update: mockUpdate,
          eq: mockEq,
          single: vi.fn(() =>
            Promise.resolve({
              data: { id: 'sync-log-1' },
              error: null,
            })
          ),
        })),
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      // Simulate fetch failure
      vi.mocked(monzoAuthService.getAccessToken).mockResolvedValue(null);

      const result = await service.performFullSync('user-123');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should complete successful full sync with transactions', async () => {
      const { createClient } = await import('@/lib/supabase/server');
      const { monzoAuthService } = await import('../monzo-auth.service');

      vi.mocked(monzoAuthService.getAccessToken).mockResolvedValue('test-token');
      vi.mocked(monzoAuthService.getAccountId).mockResolvedValue('acc-123');

      const mockTransactions = [
        {
          id: 'tx-1',
          created: '2025-01-01T12:00:00Z',
          description: 'Test Transaction 1',
          amount: -1000,
          currency: 'GBP',
          category: 'shopping',
          is_load: false,
          account_id: 'acc-123',
        },
        {
          id: 'tx-2',
          created: '2025-01-01T11:00:00Z',
          description: 'Test Transaction 2',
          amount: -500,
          currency: 'GBP',
          category: 'groceries',
          is_load: false,
          account_id: 'acc-123',
        },
      ];

      // Return transactions on first fetch, empty on second (pagination complete)
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ transactions: mockTransactions }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ transactions: [] }),
        });

      const mockUpsert = vi.fn(() => Promise.resolve({ error: null }));
      const mockUpdate = vi.fn().mockReturnThis();
      const mockEq = vi.fn(() => Promise.resolve({ error: null }));
      let fromCallCount = 0;

      vi.mocked(createClient).mockResolvedValue({
        from: vi.fn((table) => {
          fromCallCount++;
          if (table === 'monzo_sync_log' && fromCallCount === 1) {
            // Create sync log
            return {
              insert: vi.fn().mockReturnThis(),
              select: vi.fn().mockReturnThis(),
              single: vi.fn(() =>
                Promise.resolve({
                  data: { id: 'sync-log-1' },
                  error: null,
                })
              ),
            };
          } else if (table === 'monzo_transactions') {
            // Check existing transactions
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              in: vi.fn(() =>
                Promise.resolve({
                  data: [{ monzo_transaction_id: 'tx-1' }],
                  error: null,
                })
              ),
              upsert: mockUpsert,
            };
          } else {
            // Update sync log
            return {
              update: mockUpdate,
              eq: mockEq,
            };
          }
        }),
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      const result = await service.performFullSync('user-123');

      expect(result.success).toBe(true);
      expect(result.syncType).toBe('FULL');
      expect(result.transactionsProcessed).toBe(2);
      expect(result.transactionsCreated).toBe(1);
      expect(result.transactionsUpdated).toBe(1);
      expect(result.lastTransactionId).toBe('tx-1');
    });

    it('should handle upsert failure during sync', async () => {
      const { createClient } = await import('@/lib/supabase/server');
      const { monzoAuthService } = await import('../monzo-auth.service');

      vi.mocked(monzoAuthService.getAccessToken).mockResolvedValue('test-token');
      vi.mocked(monzoAuthService.getAccountId).mockResolvedValue('acc-123');

      const mockTransactions = [
        {
          id: 'tx-1',
          created: '2025-01-01T12:00:00Z',
          description: 'Test Transaction',
          amount: -1000,
          currency: 'GBP',
          category: 'shopping',
          is_load: false,
          account_id: 'acc-123',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ transactions: mockTransactions }),
      });

      const mockUpdate = vi.fn().mockReturnThis();
      const mockEq = vi.fn(() => Promise.resolve({ error: null }));

      // Create a single shared from function that all createClient calls will use
      const sharedFrom = vi.fn((table: string) => {
        if (table === 'monzo_sync_log') {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn(() =>
                  Promise.resolve({
                    data: { id: 'sync-log-1' },
                    error: null,
                  })
                ),
              }),
            }),
            update: mockUpdate,
            eq: mockEq,
          };
        } else if (table === 'monzo_transactions') {
          // Return a chainable mock with proper chain: select().eq().in()
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn(() =>
                  Promise.resolve({
                    data: [],
                    error: null,
                  })
                ),
              }),
            }),
            upsert: vi.fn(() =>
              Promise.resolve({ error: { message: 'Upsert failed' } })
            ),
          };
        } else {
          return {
            update: mockUpdate,
            eq: mockEq,
          };
        }
      });

      // All calls to createClient return the same mock client with shared from function
      const mockClient = { from: sharedFrom };
      vi.mocked(createClient).mockResolvedValue(mockClient as unknown as Awaited<ReturnType<typeof createClient>>);

      const result = await service.performFullSync('user-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to save transactions');
    });

    it('should handle transactions with merchant data', async () => {
      const { createClient } = await import('@/lib/supabase/server');
      const { monzoAuthService } = await import('../monzo-auth.service');

      vi.mocked(monzoAuthService.getAccessToken).mockResolvedValue('test-token');
      vi.mocked(monzoAuthService.getAccountId).mockResolvedValue('acc-123');

      const mockTransactions = [
        {
          id: 'tx-1',
          created: '2025-01-01T12:00:00Z',
          description: 'Test Transaction',
          amount: -1000,
          currency: 'GBP',
          category: 'shopping',
          is_load: false,
          account_id: 'acc-123',
          merchant: {
            name: 'Test Shop',
            category: 'retail',
            logo: 'https://example.com/logo.png',
          },
          metadata: {
            notes: 'Test notes',
          },
          settled: '2025-01-01T14:00:00Z',
          decline_reason: null,
        },
      ];

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ transactions: mockTransactions }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ transactions: [] }),
        });

      const mockUpsert = vi.fn(() => Promise.resolve({ error: null }));

      // Create a single shared from function with proper chaining
      const sharedFrom = vi.fn((table: string) => {
        if (table === 'monzo_sync_log') {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn(() =>
                  Promise.resolve({
                    data: { id: 'sync-log-1' },
                    error: null,
                  })
                ),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn(() => Promise.resolve({ error: null })),
            }),
          };
        } else if (table === 'monzo_transactions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn(() =>
                  Promise.resolve({
                    data: [],
                    error: null,
                  })
                ),
              }),
            }),
            upsert: mockUpsert,
          };
        } else {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn(() => Promise.resolve({ error: null })),
            }),
          };
        }
      });

      const mockClient = { from: sharedFrom };
      vi.mocked(createClient).mockResolvedValue(mockClient as unknown as Awaited<ReturnType<typeof createClient>>);

      const result = await service.performFullSync('user-123');

      expect(result.success).toBe(true);
      expect(mockUpsert).toHaveBeenCalled();
      // Verify merchant data was transformed correctly
      const calls = mockUpsert.mock.calls as unknown as Array<Array<Array<{ merchant_name: string }>>>;
      expect(calls[0]?.[0]?.[0]?.merchant_name).toBe('Test Shop');
    });

    it('should handle empty transaction result from full sync', async () => {
      const { createClient } = await import('@/lib/supabase/server');
      const { monzoAuthService } = await import('../monzo-auth.service');

      vi.mocked(monzoAuthService.getAccessToken).mockResolvedValue('test-token');
      vi.mocked(monzoAuthService.getAccountId).mockResolvedValue('acc-123');

      // Return empty transactions
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ transactions: [] }),
      });

      // Create a single shared from function with proper chaining
      const sharedFrom = vi.fn((table: string) => {
        if (table === 'monzo_sync_log') {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn(() =>
                  Promise.resolve({
                    data: { id: 'sync-log-1' },
                    error: null,
                  })
                ),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn(() => Promise.resolve({ error: null })),
            }),
          };
        } else if (table === 'monzo_transactions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn(() => Promise.resolve({ data: [], error: null })),
              }),
            }),
            upsert: vi.fn(() => Promise.resolve({ error: null })),
          };
        }
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              in: vi.fn(() => Promise.resolve({ data: [], error: null })),
            }),
          }),
        };
      });

      const mockClient = { from: sharedFrom };
      vi.mocked(createClient).mockResolvedValue(mockClient as unknown as Awaited<ReturnType<typeof createClient>>);

      const result = await service.performFullSync('user-123');

      expect(result.success).toBe(true);
      expect(result.transactionsProcessed).toBe(0);
      expect(result.transactionsCreated).toBe(0);
      expect(result.transactionsUpdated).toBe(0);
      expect(result.lastTransactionId).toBeUndefined();
    });
  });

  describe('performIncrementalSync', () => {
    it('should fall back to full sync when no previous sync exists', async () => {
      const { createClient } = await import('@/lib/supabase/server');
      const { monzoAuthService } = await import('../monzo-auth.service');

      const mockFrom = vi.fn();

      // First call - check for last sync
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

      // Second call - create sync log for full sync
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

      // Additional calls for error handling path (update sync log)
      mockFrom.mockReturnValue({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn(() => Promise.resolve({ error: null })),
      });

      vi.mocked(createClient).mockResolvedValue({
        from: mockFrom,
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      // Simulate no access token to trigger error
      vi.mocked(monzoAuthService.getAccessToken).mockResolvedValue(null);

      const result = await service.performIncrementalSync('user-123');

      // Should fall back to full sync then fail due to no token
      expect(result.syncType).toBe('FULL');
      expect(result.success).toBe(false);
    });

    it('should complete successful incremental sync with transactions', async () => {
      const { createClient } = await import('@/lib/supabase/server');
      const { monzoAuthService } = await import('../monzo-auth.service');

      vi.mocked(monzoAuthService.getAccessToken).mockResolvedValue('test-token');
      vi.mocked(monzoAuthService.getAccountId).mockResolvedValue('acc-123');

      const mockTransactions = [
        {
          id: 'tx-new-1',
          created: '2025-01-02T12:00:00Z',
          description: 'New Transaction',
          amount: -2000,
          currency: 'GBP',
          category: 'transport',
          is_load: false,
          account_id: 'acc-123',
        },
      ];

      // Return new transactions, then empty on second call
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ transactions: mockTransactions }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ transactions: [] }),
        });

      // Track sync log queries vs other queries
      let syncLogCallCount = 0;

      // Create a single shared from function with proper chaining
      const sharedFrom = vi.fn((table: string) => {
        if (table === 'monzo_sync_log') {
          syncLogCallCount++;
          if (syncLogCallCount === 1) {
            // First call: Get last completed sync - select().eq().eq().order().limit().single()
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                      limit: vi.fn().mockReturnValue({
                        single: vi.fn(() =>
                          Promise.resolve({
                            data: { last_transaction_id: 'tx-previous' },
                            error: null,
                          })
                        ),
                      }),
                    }),
                  }),
                }),
              }),
            };
          } else {
            // Subsequent calls: Create and update sync log
            return {
              insert: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn(() =>
                    Promise.resolve({
                      data: { id: 'sync-log-2' },
                      error: null,
                    })
                  ),
                }),
              }),
              update: vi.fn().mockReturnValue({
                eq: vi.fn(() => Promise.resolve({ error: null })),
              }),
            };
          }
        } else if (table === 'monzo_transactions') {
          // Check existing transactions and upsert - select().eq().in()
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn(() =>
                  Promise.resolve({
                    data: [],
                    error: null,
                  })
                ),
              }),
            }),
            upsert: vi.fn(() => Promise.resolve({ error: null })),
          };
        }
        // Default fallback
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn(() => Promise.resolve({ error: null })),
          }),
        };
      });

      const mockClient = { from: sharedFrom };
      vi.mocked(createClient).mockResolvedValue(mockClient as unknown as Awaited<ReturnType<typeof createClient>>);

      const result = await service.performIncrementalSync('user-123');

      expect(result.success).toBe(true);
      expect(result.syncType).toBe('INCREMENTAL');
      expect(result.transactionsProcessed).toBe(1);
      expect(result.transactionsCreated).toBe(1);
      expect(result.lastTransactionId).toBe('tx-new-1');
    });

    it('should handle sync log creation failure in incremental sync', async () => {
      const { createClient } = await import('@/lib/supabase/server');

      const mockFrom = vi.fn();

      // Get last completed sync - found
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({
            data: { last_transaction_id: 'tx-previous' },
            error: null,
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
            error: { message: 'Failed to create log' },
          })
        ),
      });

      vi.mocked(createClient).mockResolvedValue({
        from: mockFrom,
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      await expect(service.performIncrementalSync('user-123')).rejects.toThrow(
        'Failed to start sync'
      );
    });

    it('should handle errors and update sync log status to FAILED', async () => {
      const { createClient } = await import('@/lib/supabase/server');
      const { monzoAuthService } = await import('../monzo-auth.service');

      vi.mocked(monzoAuthService.getAccessToken).mockResolvedValue(null);

      const mockUpdate = vi.fn().mockReturnThis();
      const mockEq = vi.fn(() => Promise.resolve({ error: null }));
      const mockFrom = vi.fn();

      // Get last completed sync
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({
            data: { last_transaction_id: 'tx-previous' },
            error: null,
          })
        ),
      });

      // Create sync log
      mockFrom.mockReturnValueOnce({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({
            data: { id: 'sync-log-2' },
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

      const result = await service.performIncrementalSync('user-123');

      expect(result.success).toBe(false);
      expect(result.syncType).toBe('INCREMENTAL');
      expect(result.error).toContain('No valid access token');
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'FAILED',
          error_message: expect.stringContaining('access token'),
        })
      );
    });

    it('should preserve last transaction ID when no new transactions found', async () => {
      const { createClient } = await import('@/lib/supabase/server');
      const { monzoAuthService } = await import('../monzo-auth.service');

      vi.mocked(monzoAuthService.getAccessToken).mockResolvedValue('test-token');
      vi.mocked(monzoAuthService.getAccountId).mockResolvedValue('acc-123');

      // Return empty transactions
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ transactions: [] }),
      });

      const mockFrom = vi.fn();

      // Get last completed sync
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({
            data: { last_transaction_id: 'tx-previous' },
            error: null,
          })
        ),
      });

      // Create sync log
      mockFrom.mockReturnValueOnce({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({
            data: { id: 'sync-log-2' },
            error: null,
          })
        ),
      });

      // Update sync log
      mockFrom.mockReturnValue({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn(() => Promise.resolve({ error: null })),
      });

      vi.mocked(createClient).mockResolvedValue({
        from: mockFrom,
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      const result = await service.performIncrementalSync('user-123');

      expect(result.success).toBe(true);
      expect(result.lastTransactionId).toBe('tx-previous');
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
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({
            data: {
              sync_type: 'FULL',
              status: 'RUNNING',
              started_at: new Date().toISOString(),
            },
            error: null,
          })
        ),
      });

      vi.mocked(createClient).mockResolvedValue({
        from: mockFrom,
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      const result = await service.getSyncStatus('user-123');

      expect(result.isRunning).toBe(true);
      expect(result.lastSync?.status).toBe('RUNNING');
    });

    it('should return last sync when no sync is running', async () => {
      const { createClient } = await import('@/lib/supabase/server');

      const mockFrom = vi.fn();

      // Check for running sync - not found
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

      // Get last sync
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({
            data: {
              sync_type: 'INCREMENTAL',
              status: 'COMPLETED',
              started_at: '2025-01-01T12:00:00Z',
              completed_at: '2025-01-01T12:05:00Z',
              transactions_processed: 50,
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
      expect(result.lastSync?.transactionsProcessed).toBe(50);
    });

    it('should return empty status when no syncs exist', async () => {
      const { createClient } = await import('@/lib/supabase/server');

      const mockFrom = vi.fn();

      // Check for running sync - not found
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

      vi.mocked(createClient).mockResolvedValue({
        from: mockFrom,
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      const result = await service.getSyncStatus('user-123');

      expect(result.isRunning).toBe(false);
      expect(result.lastSync).toBeUndefined();
    });

    it('should return FAILED status with error message', async () => {
      const { createClient } = await import('@/lib/supabase/server');

      const mockFrom = vi.fn();

      // Check for running sync - not found
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

      // Get last sync - FAILED
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({
            data: {
              sync_type: 'FULL',
              status: 'FAILED',
              started_at: '2025-01-01T12:00:00Z',
              completed_at: '2025-01-01T12:01:00Z',
              transactions_processed: 0,
              error_message: 'Rate limited by Monzo',
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
      expect(result.lastSync?.status).toBe('FAILED');
      expect(result.lastSync?.error).toBe('Rate limited by Monzo');
      expect(result.lastSync?.transactionsProcessed).toBe(0);
    });

    it('should return INCREMENTAL type for incremental syncs', async () => {
      const { createClient } = await import('@/lib/supabase/server');

      const mockFrom = vi.fn();

      // Check for running sync - found incremental
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({
            data: {
              sync_type: 'INCREMENTAL',
              status: 'RUNNING',
              started_at: new Date().toISOString(),
            },
            error: null,
          })
        ),
      });

      vi.mocked(createClient).mockResolvedValue({
        from: mockFrom,
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      const result = await service.getSyncStatus('user-123');

      expect(result.isRunning).toBe(true);
      expect(result.lastSync?.type).toBe('INCREMENTAL');
    });
  });
});

