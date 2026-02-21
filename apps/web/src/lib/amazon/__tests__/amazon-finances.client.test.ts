import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AmazonFinancesClientWithAuth,
  createAmazonFinancesClient,
  MAX_DATE_RANGE_DAYS,
} from '../amazon-finances.client';
import type { AmazonCredentials, AmazonFinancialTransaction } from '../types';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Suppress console logs during tests
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

describe('AmazonFinancesClientWithAuth', () => {
  const mockCredentials: AmazonCredentials = {
    sellerId: 'TEST_SELLER_ID',
    marketplaceIds: ['A1F83G8C2ARO7P'],
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    refreshToken: 'test-refresh-token',
  };

  let client: AmazonFinancesClientWithAuth;

  const mockTokenResponse = {
    access_token: 'test-access-token',
    token_type: 'bearer',
    expires_in: 3600,
  };

  const mockTransaction: AmazonFinancialTransaction = {
    transactionType: 'Order',
    transactionStatus: 'RELEASED',
    description: 'Order Payment',
    postedDate: '2024-12-20T10:00:00Z',
    totalAmount: { currencyCode: 'GBP', currencyAmount: '25.99' },
    sellingPartnerMetadata: {
      sellingPartnerId: 'TEST_SELLER_ID',
      marketplaceId: 'A1F83G8C2ARO7P',
      accountType: 'MERCHANT',
    },
    relatedIdentifiers: [],
  };

  beforeEach(() => {
    vi.resetAllMocks();
    client = new AmazonFinancesClientWithAuth(mockCredentials);
  });

  describe('createAmazonFinancesClient', () => {
    it('should create an instance of AmazonFinancesClientWithAuth', () => {
      const factoryClient = createAmazonFinancesClient(mockCredentials);
      expect(factoryClient).toBeInstanceOf(AmazonFinancesClientWithAuth);
    });
  });

  describe('token management', () => {
    it('should refresh token on first request', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockTokenResponse),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              payload: { transactions: [mockTransaction] },
            }),
        });

      await client.listTransactions({
        postedAfter: '2024-12-01T00:00:00Z',
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);

      // First call should be token refresh
      const tokenCall = mockFetch.mock.calls[0];
      expect(tokenCall[0]).toBe('https://api.amazon.com/auth/o2/token');
      expect(tokenCall[1].method).toBe('POST');
    });

    it('should reuse cached token for subsequent requests', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockTokenResponse),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              payload: { transactions: [mockTransaction] },
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              payload: { transactions: [] },
            }),
        });

      await client.listTransactions({ postedAfter: '2024-12-01T00:00:00Z' });
      await client.listTransactions({ postedAfter: '2024-12-10T00:00:00Z' });

      // Should only have 3 calls: 1 token + 2 API requests
      expect(mockFetch).toHaveBeenCalledTimes(3);

      // Only first call should be token refresh
      expect(mockFetch.mock.calls[0][0]).toBe('https://api.amazon.com/auth/o2/token');
      expect(mockFetch.mock.calls[1][0]).toContain('finances');
      expect(mockFetch.mock.calls[2][0]).toContain('finances');
    });

    it('should handle token refresh failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Invalid credentials'),
      });

      await expect(
        client.listTransactions({ postedAfter: '2024-12-01T00:00:00Z' })
      ).rejects.toThrow('Failed to refresh token: 401');
    });

    it('should clear token on 401 response', async () => {
      // First request works
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockTokenResponse),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              payload: { transactions: [] },
            }),
        });

      await client.listTransactions({ postedAfter: '2024-12-01T00:00:00Z' });

      // Second request gets 401
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ errors: [{ message: 'Unauthorized' }] }),
      });

      await expect(
        client.listTransactions({ postedAfter: '2024-12-10T00:00:00Z' })
      ).rejects.toThrow('Invalid or expired access token');
    });

    it('should clear token on 403 response', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockTokenResponse),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          json: () => Promise.resolve({ errors: [{ message: 'Forbidden' }] }),
        });

      await expect(
        client.listTransactions({ postedAfter: '2024-12-01T00:00:00Z' })
      ).rejects.toThrow('Invalid or expired access token');
    });
  });

  describe('listTransactions', () => {
    it('should fetch transactions with required parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTokenResponse),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            payload: { transactions: [mockTransaction] },
          }),
      });

      const result = await client.listTransactions({
        postedAfter: '2024-12-01T00:00:00Z',
      });

      expect(result.payload?.transactions).toHaveLength(1);
      expect(result.payload?.transactions?.[0]).toEqual(mockTransaction);

      // Verify API call
      const apiCall = mockFetch.mock.calls[1];
      expect(apiCall[0]).toContain('/finances/2024-06-19/transactions');
      expect(apiCall[0]).toContain('postedAfter=');
    });

    it('should include optional parameters when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTokenResponse),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            payload: { transactions: [] },
          }),
      });

      await client.listTransactions({
        postedAfter: '2024-12-01T00:00:00Z',
        postedBefore: '2024-12-20T00:00:00Z',
        marketplaceId: 'A1F83G8C2ARO7P',
      });

      const apiCall = mockFetch.mock.calls[1];
      expect(apiCall[0]).toContain('postedAfter=');
      expect(apiCall[0]).toContain('postedBefore=');
      expect(apiCall[0]).toContain('marketplaceId=');
    });

    it('should include nextToken for pagination', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTokenResponse),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            payload: { transactions: [], nextToken: 'page-2-token' },
          }),
      });

      await client.listTransactions({
        postedAfter: '2024-12-01T00:00:00Z',
        nextToken: 'page-1-token',
      });

      const apiCall = mockFetch.mock.calls[1];
      expect(apiCall[0]).toContain('nextToken=page-1-token');
    });

    it('should handle API errors with message extraction', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTokenResponse),
      });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () =>
          Promise.resolve({
            errors: [{ message: 'Invalid date format' }, { message: 'Missing required parameter' }],
          }),
      });

      await expect(client.listTransactions({ postedAfter: 'invalid-date' })).rejects.toThrow(
        'Invalid date format; Missing required parameter'
      );
    });

    it('should handle API errors without parseable JSON', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTokenResponse),
      });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('Not JSON')),
      });

      await expect(
        client.listTransactions({ postedAfter: '2024-12-01T00:00:00Z' })
      ).rejects.toThrow('Request failed with status 500');
    });

    it('should set correct headers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTokenResponse),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            payload: { transactions: [] },
          }),
      });

      await client.listTransactions({ postedAfter: '2024-12-01T00:00:00Z' });

      const apiCall = mockFetch.mock.calls[1];
      expect(apiCall[1].headers).toEqual({
        'x-amz-access-token': 'test-access-token',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      });
    });

    it('should use EU endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTokenResponse),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            payload: { transactions: [] },
          }),
      });

      await client.listTransactions({ postedAfter: '2024-12-01T00:00:00Z' });

      const apiCall = mockFetch.mock.calls[1];
      expect(apiCall[0]).toContain('sellingpartnerapi-eu.amazon.com');
    });
  });

  describe('getAllTransactions', () => {
    beforeEach(() => {
      // Setup token mock
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTokenResponse),
      });
    });

    it('should fetch all transactions with pagination', async () => {
      const transaction1 = { ...mockTransaction, description: 'Transaction 1' };
      const transaction2 = { ...mockTransaction, description: 'Transaction 2' };
      const transaction3 = { ...mockTransaction, description: 'Transaction 3' };

      // Page 1
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            payload: {
              transactions: [transaction1, transaction2],
              nextToken: 'page-2-token',
            },
          }),
      });

      // Page 2
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            payload: {
              transactions: [transaction3],
              // No nextToken = last page
            },
          }),
      });

      const result = await client.getAllTransactions({
        postedAfter: '2024-12-01T00:00:00Z',
      });

      expect(result).toHaveLength(3);
      expect(result[0].description).toBe('Transaction 1');
      expect(result[1].description).toBe('Transaction 2');
      expect(result[2].description).toBe('Transaction 3');
    });

    it('should handle empty response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            payload: { transactions: [] },
          }),
      });

      const result = await client.getAllTransactions({
        postedAfter: '2024-12-01T00:00:00Z',
      });

      expect(result).toHaveLength(0);
    });

    it('should handle missing payload gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const result = await client.getAllTransactions({
        postedAfter: '2024-12-01T00:00:00Z',
      });

      expect(result).toHaveLength(0);
    });

    it('should stop at max pages limit', async () => {
      // Skip pagination delays for this test
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).sleepMs = () => Promise.resolve();

      // Mock 101 pages of responses (should stop at 100)
      for (let i = 0; i < 101; i++) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              payload: {
                transactions: [{ ...mockTransaction, transactionId: `trans-${i}` }],
                nextToken: `page-${i + 1}-token`,
              },
            }),
        });
      }

      const result = await client.getAllTransactions({
        postedAfter: '2024-12-01T00:00:00Z',
      });

      // Should have fetched 100 pages max
      expect(result.length).toBe(100);
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Hit max pages limit'));
    });
  });

  describe('getTransactionsInDateRange', () => {
    beforeEach(() => {
      // Setup token mock
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTokenResponse),
      });
    });

    it('should make single request for range within 179 days', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            payload: { transactions: [mockTransaction] },
          }),
      });

      const start = new Date('2024-10-01');
      const end = new Date('2024-12-01'); // ~61 days

      const result = await client.getTransactionsInDateRange(start, end);

      expect(result).toHaveLength(1);
      // Should only be 2 fetch calls: token + 1 API request
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should chunk requests for range exceeding 179 days', async () => {
      const transaction1 = { ...mockTransaction, description: 'Chunk 1 Transaction' };
      const transaction2 = { ...mockTransaction, description: 'Chunk 2 Transaction' };
      const transaction3 = { ...mockTransaction, description: 'Chunk 3 Transaction' };

      // 365 days / 179 max = 3 chunks needed
      // Chunk 1
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            payload: { transactions: [transaction1] },
          }),
      });

      // Chunk 2
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            payload: { transactions: [transaction2] },
          }),
      });

      // Chunk 3
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            payload: { transactions: [transaction3] },
          }),
      });

      const start = new Date('2024-01-01');
      const end = new Date('2024-12-31'); // ~365 days = 3 chunks

      const result = await client.getTransactionsInDateRange(start, end);

      expect(result).toHaveLength(3);
      expect(result[0].description).toBe('Chunk 1 Transaction');
      expect(result[1].description).toBe('Chunk 2 Transaction');
      expect(result[2].description).toBe('Chunk 3 Transaction');
    });

    it('should accept string dates', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            payload: { transactions: [] },
          }),
      });

      const result = await client.getTransactionsInDateRange(
        '2024-12-01T00:00:00Z',
        '2024-12-20T00:00:00Z'
      );

      expect(result).toHaveLength(0);
    });

    it('should default end date to now if not provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            payload: { transactions: [] },
          }),
      });

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      await client.getTransactionsInDateRange(thirtyDaysAgo);

      const apiCall = mockFetch.mock.calls[1];
      expect(apiCall[0]).toContain('postedAfter=');
      expect(apiCall[0]).toContain('postedBefore=');
    });
  });

  describe('testConnection', () => {
    it('should return true when connection is successful', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockTokenResponse),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              payload: { transactions: [] },
            }),
        });

      const result = await client.testConnection();

      expect(result).toBe(true);
    });

    it('should return false when token refresh fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Invalid credentials'),
      });

      const result = await client.testConnection();

      expect(result).toBe(false);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Connection test failed'),
        expect.any(Error)
      );
    });

    it('should return false when API request fails', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockTokenResponse),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ errors: [{ message: 'Server error' }] }),
        });

      const result = await client.testConnection();

      expect(result).toBe(false);
    });

    it('should use 30 days ago as start date', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockTokenResponse),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              payload: { transactions: [] },
            }),
        });

      await client.testConnection();

      const apiCall = mockFetch.mock.calls[1];
      expect(apiCall[0]).toContain('postedAfter=');

      // Extract and verify the date is approximately 30 days ago
      const url = new URL(apiCall[0]);
      const postedAfter = new Date(url.searchParams.get('postedAfter')!);
      const now = new Date();
      const diffDays = Math.ceil((now.getTime() - postedAfter.getTime()) / (1000 * 60 * 60 * 24));
      expect(diffDays).toBeGreaterThanOrEqual(29);
      expect(diffDays).toBeLessThanOrEqual(31);
    });
  });

  describe('rate limiting', () => {
    it('should log warning and retry on rate limit (429)', async () => {
      // Monkey-patch sleep to skip waiting BEFORE making calls
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).sleepMs = () => Promise.resolve();

      // Token first
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTokenResponse),
      });

      // First request gets rate limited
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
      });

      // Retry succeeds (token still valid, no refresh needed)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            payload: { transactions: [mockTransaction] },
          }),
      });

      const result = await client.listTransactions({
        postedAfter: '2024-12-01T00:00:00Z',
      });

      expect(result.payload?.transactions).toHaveLength(1);
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Rate limited'));
    });
  });

  describe('MAX_DATE_RANGE_DAYS constant', () => {
    it('should export MAX_DATE_RANGE_DAYS as 179', () => {
      expect(MAX_DATE_RANGE_DAYS).toBe(179);
    });
  });
});
