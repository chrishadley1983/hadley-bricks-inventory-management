import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AmazonCatalogClient, createAmazonCatalogClient } from '../amazon-catalog.client';
import type { AmazonCredentials } from '../types';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('AmazonCatalogClient', () => {
  const validCredentials: AmazonCredentials = {
    sellerId: 'A1SELLER123',
    clientId: 'amzn1.application-oa2-client.abc123',
    clientSecret: 'test-client-secret',
    refreshToken: 'Atzr|test-refresh-token',
    marketplaceIds: ['A1F83G8C2ARO7P'],
  };

  const mockAccessToken = 'Atza|test-access-token';

  beforeEach(() => {
    vi.clearAllMocks();
    // Use fake timers but set shouldAdvanceTime to auto-advance pending timers
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.useRealTimers();
  });

  // Helper to mock successful token refresh
  const mockTokenRefresh = () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: mockAccessToken,
        expires_in: 3600,
      }),
    });
  };

  describe('constructor', () => {
    it('should create instance with valid credentials', () => {
      const client = new AmazonCatalogClient(validCredentials);
      expect(client).toBeInstanceOf(AmazonCatalogClient);
    });
  });

  describe('testConnection', () => {
    it('should return true when token refresh succeeds', async () => {
      mockTokenRefresh();
      const client = new AmazonCatalogClient(validCredentials);

      const result = await client.testConnection();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.amazon.com/auth/o2/token',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        })
      );
    });

    it('should return false when token refresh fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Invalid refresh token',
      });

      const client = new AmazonCatalogClient(validCredentials);
      const result = await client.testConnection();

      expect(result).toBe(false);
    });

    it('should return false on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const client = new AmazonCatalogClient(validCredentials);
      const result = await client.testConnection();

      expect(result).toBe(false);
    });
  });

  describe('getCatalogItem', () => {
    it('should fetch catalog item by ASIN', async () => {
      mockTokenRefresh();

      const mockCatalogResponse = {
        asin: 'B09ABC123',
        summaries: [
          {
            marketplaceId: 'A1F83G8C2ARO7P',
            itemName: 'LEGO Star Wars Millennium Falcon 75192',
            brandName: 'LEGO',
          },
        ],
        productTypes: [
          {
            marketplaceId: 'A1F83G8C2ARO7P',
            productType: 'BUILDING_BLOCK_KITS',
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockCatalogResponse,
      });

      const client = new AmazonCatalogClient(validCredentials);
      vi.advanceTimersByTime(1100); // Advance past rate limit delay

      const result = await client.getCatalogItem('B09ABC123');

      expect(result.asin).toBe('B09ABC123');
      expect(result.productType).toBe('BUILDING_BLOCK_KITS');
      expect(result.title).toBe('LEGO Star Wars Millennium Falcon 75192');
      expect(result.brand).toBe('LEGO');
      expect(result.raw).toEqual(mockCatalogResponse);
    });

    it('should use default UK marketplace ID', async () => {
      mockTokenRefresh();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ asin: 'B09ABC123', summaries: [], productTypes: [] }),
      });

      const client = new AmazonCatalogClient(validCredentials);
      vi.advanceTimersByTime(1100);

      await client.getCatalogItem('B09ABC123');

      const apiCall = mockFetch.mock.calls[1];
      expect(apiCall[0]).toContain('marketplaceIds=A1F83G8C2ARO7P');
    });

    it('should allow custom marketplace ID', async () => {
      mockTokenRefresh();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ asin: 'B09ABC123', summaries: [], productTypes: [] }),
      });

      const client = new AmazonCatalogClient(validCredentials);
      vi.advanceTimersByTime(1100);

      await client.getCatalogItem('B09ABC123', 'A1PA6795UKMFR9'); // Germany

      const apiCall = mockFetch.mock.calls[1];
      expect(apiCall[0]).toContain('marketplaceIds=A1PA6795UKMFR9');
    });

    it('should request summaries and productTypes in includedData', async () => {
      mockTokenRefresh();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ asin: 'B09ABC123', summaries: [], productTypes: [] }),
      });

      const client = new AmazonCatalogClient(validCredentials);
      vi.advanceTimersByTime(1100);

      await client.getCatalogItem('B09ABC123');

      const apiCall = mockFetch.mock.calls[1];
      expect(apiCall[0]).toContain('includedData=summaries,productTypes');
    });

    it('should return null productType when not available', async () => {
      mockTokenRefresh();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          asin: 'B09ABC123',
          summaries: [{ marketplaceId: 'A1F83G8C2ARO7P', itemName: 'Test' }],
          productTypes: [],
        }),
      });

      const client = new AmazonCatalogClient(validCredentials);
      vi.advanceTimersByTime(1100);

      const result = await client.getCatalogItem('B09ABC123');

      expect(result.productType).toBeNull();
    });

    it('should handle missing summaries', async () => {
      mockTokenRefresh();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          asin: 'B09ABC123',
          summaries: undefined,
          productTypes: [{ marketplaceId: 'A1F83G8C2ARO7P', productType: 'TOY' }],
        }),
      });

      const client = new AmazonCatalogClient(validCredentials);
      vi.advanceTimersByTime(1100);

      const result = await client.getCatalogItem('B09ABC123');

      expect(result.title).toBeNull();
      expect(result.brand).toBeNull();
      expect(result.productType).toBe('TOY');
    });

    it('should throw error for 404 (ASIN not found)', async () => {
      mockTokenRefresh();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const client = new AmazonCatalogClient(validCredentials);
      vi.advanceTimersByTime(1100);

      await expect(client.getCatalogItem('INVALID123')).rejects.toThrow('ASIN not found');
    });
  });

  describe('searchCatalogByIdentifier', () => {
    it('should search by EAN', async () => {
      mockTokenRefresh();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          numberOfResults: 1,
          items: [
            {
              asin: 'B09ABC123',
              summaries: [
                { marketplaceId: 'A1F83G8C2ARO7P', itemName: 'LEGO 75192', brandName: 'LEGO' },
              ],
              images: [
                {
                  marketplaceId: 'A1F83G8C2ARO7P',
                  images: [{ variant: 'MAIN', link: 'https://example.com/img.jpg', height: 500, width: 500 }],
                },
              ],
            },
          ],
        }),
      });

      const client = new AmazonCatalogClient(validCredentials);
      vi.advanceTimersByTime(1100);

      const result = await client.searchCatalogByIdentifier('5702015869935', 'EAN');

      expect(result.items).toHaveLength(1);
      expect(result.items[0].asin).toBe('B09ABC123');
      expect(result.items[0].title).toBe('LEGO 75192');
      expect(result.items[0].brand).toBe('LEGO');
      expect(result.items[0].imageUrl).toBe('https://example.com/img.jpg');
      expect(result.totalResults).toBe(1);
    });

    it('should search by UPC', async () => {
      mockTokenRefresh();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          numberOfResults: 0,
          items: [],
        }),
      });

      const client = new AmazonCatalogClient(validCredentials);
      vi.advanceTimersByTime(1100);

      await client.searchCatalogByIdentifier('673419266819', 'UPC');

      const apiCall = mockFetch.mock.calls[1];
      expect(apiCall[0]).toContain('identifiersType=UPC');
      expect(apiCall[0]).toContain('identifiers=673419266819');
    });

    it('should return empty result when identifier not found', async () => {
      mockTokenRefresh();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ numberOfResults: 0, items: [] }),
      });

      const client = new AmazonCatalogClient(validCredentials);
      vi.advanceTimersByTime(1100);

      const result = await client.searchCatalogByIdentifier('0000000000000', 'EAN');

      expect(result.items).toHaveLength(0);
      expect(result.totalResults).toBe(0);
    });

    it('should handle "not found" error as empty result', async () => {
      mockTokenRefresh();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ errors: [{ message: 'Resource not found' }] }),
      });

      const client = new AmazonCatalogClient(validCredentials);
      vi.advanceTimersByTime(1100);

      // The implementation catches "not found" errors and returns empty results
      const result = await client.searchCatalogByIdentifier('0000000000000', 'EAN');
      expect(result.items).toEqual([]);
      expect(result.totalResults).toBe(0);
    });

    it('should include pagination token in response', async () => {
      mockTokenRefresh();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          numberOfResults: 100,
          items: [{ asin: 'B001' }],
          pagination: { nextToken: 'next-page-token' },
        }),
      });

      const client = new AmazonCatalogClient(validCredentials);
      vi.advanceTimersByTime(1100);

      const result = await client.searchCatalogByIdentifier('5702015869935', 'EAN');

      expect(result.nextPageToken).toBe('next-page-token');
    });
  });

  describe('searchCatalogByKeywords', () => {
    it('should search by keywords', async () => {
      mockTokenRefresh();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          numberOfResults: 2,
          items: [
            {
              asin: 'B09ABC123',
              summaries: [{ marketplaceId: 'A1F83G8C2ARO7P', itemName: 'LEGO 75192' }],
            },
            {
              asin: 'B09DEF456',
              summaries: [{ marketplaceId: 'A1F83G8C2ARO7P', itemName: 'LEGO 10179' }],
            },
          ],
        }),
      });

      const client = new AmazonCatalogClient(validCredentials);
      vi.advanceTimersByTime(1100);

      const result = await client.searchCatalogByKeywords('LEGO Millennium Falcon');

      expect(result.items).toHaveLength(2);
      expect(result.totalResults).toBe(2);

      const apiCall = mockFetch.mock.calls[1];
      expect(apiCall[0]).toContain('keywords=LEGO+Millennium+Falcon');
    });

    it('should request summaries and images', async () => {
      mockTokenRefresh();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ numberOfResults: 0, items: [] }),
      });

      const client = new AmazonCatalogClient(validCredentials);
      vi.advanceTimersByTime(1100);

      await client.searchCatalogByKeywords('test');

      const apiCall = mockFetch.mock.calls[1];
      expect(apiCall[0]).toContain('includedData=summaries%2Cimages');
    });

    it('should return empty result for no matches', async () => {
      mockTokenRefresh();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ numberOfResults: 0, items: undefined }),
      });

      const client = new AmazonCatalogClient(validCredentials);
      vi.advanceTimersByTime(1100);

      const result = await client.searchCatalogByKeywords('nonexistent product xyz123');

      expect(result.items).toHaveLength(0);
    });
  });

  describe('token management', () => {
    it('should cache access token', async () => {
      mockTokenRefresh();
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ asin: 'B001', summaries: [], productTypes: [] }),
      });

      const client = new AmazonCatalogClient(validCredentials);
      vi.advanceTimersByTime(1100);

      // First request - should refresh token
      await client.getCatalogItem('B001');

      vi.advanceTimersByTime(1100);

      // Second request - should reuse token
      await client.getCatalogItem('B002');

      // Token refresh should only be called once
      const tokenCalls = mockFetch.mock.calls.filter((call) =>
        call[0].includes('api.amazon.com/auth/o2/token')
      );
      expect(tokenCalls).toHaveLength(1);
    });

    it('should refresh token before expiry buffer', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: mockAccessToken,
          expires_in: 300, // 5 minutes - within buffer
        }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ asin: 'B001', summaries: [], productTypes: [] }),
      });

      mockTokenRefresh(); // Second refresh

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ asin: 'B002', summaries: [], productTypes: [] }),
      });

      const client = new AmazonCatalogClient(validCredentials);
      vi.advanceTimersByTime(1100);

      await client.getCatalogItem('B001');

      // Advance time past expiry buffer
      vi.advanceTimersByTime(1100);

      await client.getCatalogItem('B002');

      // Should have refreshed twice due to short expiry
      const tokenCalls = mockFetch.mock.calls.filter((call) =>
        call[0].includes('api.amazon.com/auth/o2/token')
      );
      expect(tokenCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('rate limiting', () => {
    it('should retry on 429 rate limit', async () => {
      mockTokenRefresh();

      // First call - rate limited
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Map([['Retry-After', '1']]),
      });

      // Second call - success
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ asin: 'B001', summaries: [], productTypes: [] }),
      });

      const client = new AmazonCatalogClient(validCredentials);
      vi.advanceTimersByTime(1100);

      const resultPromise = client.getCatalogItem('B001');

      // Advance timers to allow retry
      vi.advanceTimersByTime(61000);

      const result = await resultPromise;
      expect(result.asin).toBe('B001');
    });

    it('should throw after max retries', async () => {
      mockTokenRefresh();

      // All calls rate limited
      for (let i = 0; i < 4; i++) {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: new Map([['Retry-After', '1']]),
        });
      }

      const client = new AmazonCatalogClient(validCredentials);

      const resultPromise = client.getCatalogItem('B001');

      // Advance through all retries
      vi.advanceTimersByTime(250000);

      await expect(resultPromise).rejects.toThrow('Rate limit exceeded');
    });
  });

  describe('auth error handling', () => {
    it('should retry once on 401 auth error', async () => {
      // First token refresh
      mockTokenRefresh();

      // First request - auth error
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      // Second token refresh
      mockTokenRefresh();

      // Retry request - success
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ asin: 'B001', summaries: [], productTypes: [] }),
      });

      const client = new AmazonCatalogClient(validCredentials);
      vi.advanceTimersByTime(2200);

      const result = await client.getCatalogItem('B001');
      expect(result.asin).toBe('B001');
    });

    it('should throw after repeated auth errors', async () => {
      mockTokenRefresh();

      // Both requests return auth error
      mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });

      mockTokenRefresh();
      mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });

      const client = new AmazonCatalogClient(validCredentials);
      vi.advanceTimersByTime(2200);

      await expect(client.getCatalogItem('B001')).rejects.toThrow('Invalid or expired access token');
    });
  });

  describe('error handling', () => {
    it('should parse API error messages', async () => {
      mockTokenRefresh();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          errors: [
            { code: 'InvalidInput', message: 'Invalid ASIN format' },
            { code: 'ValidationError', message: 'Missing required parameter' },
          ],
        }),
      });

      const client = new AmazonCatalogClient(validCredentials);
      vi.advanceTimersByTime(1100);

      await expect(client.getCatalogItem('INVALID')).rejects.toThrow(
        'Invalid ASIN format; Missing required parameter'
      );
    });

    it('should handle non-JSON error responses', async () => {
      mockTokenRefresh();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('Not JSON');
        },
      });

      const client = new AmazonCatalogClient(validCredentials);
      vi.advanceTimersByTime(1100);

      await expect(client.getCatalogItem('B001')).rejects.toThrow('Request failed with status 500');
    });
  });
});

describe('createAmazonCatalogClient', () => {
  it('should create client instance', () => {
    const credentials: AmazonCredentials = {
      sellerId: 'A1SELLER123',
      clientId: 'amzn1.client.abc',
      clientSecret: 'secret',
      refreshToken: 'token',
      marketplaceIds: ['A1F83G8C2ARO7P'],
    };

    const client = createAmazonCatalogClient(credentials);

    expect(client).toBeInstanceOf(AmazonCatalogClient);
  });
});
