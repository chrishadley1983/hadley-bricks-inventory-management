/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  EbayBrowseClient,
  getEbayBrowseClient,
  clearTokenCache,
  type EbaySearchResponse,
  type EbaySearchOptions,
} from '../ebay-browse.client';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('EbayBrowseClient', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    clearTokenCache();
    process.env = {
      ...originalEnv,
      EBAY_CLIENT_ID: 'test-client-id',
      EBAY_CLIENT_SECRET: 'test-client-secret',
    };
  });

  afterEach(() => {
    vi.resetAllMocks();
    process.env = originalEnv;
  });

  // Helper to mock successful token response
  const mockTokenResponse = (token: string = 'test-access-token', expiresIn: number = 7200) => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: token,
        expires_in: expiresIn,
      }),
    });
  };

  describe('constructor', () => {
    it('should create instance with valid environment variables', () => {
      const client = new EbayBrowseClient();
      expect(client).toBeInstanceOf(EbayBrowseClient);
    });

    it('should throw error when EBAY_CLIENT_ID is missing', () => {
      delete process.env.EBAY_CLIENT_ID;

      expect(() => new EbayBrowseClient()).toThrow(
        'Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET environment variables'
      );
    });

    it('should throw error when EBAY_CLIENT_SECRET is missing', () => {
      delete process.env.EBAY_CLIENT_SECRET;

      expect(() => new EbayBrowseClient()).toThrow(
        'Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET environment variables'
      );
    });
  });

  describe('getApplicationToken', () => {
    it('should fetch application token using client credentials', async () => {
      const client = new EbayBrowseClient();
      mockTokenResponse('app-token-123');

      const token = await client.getApplicationToken();

      expect(token).toBe('app-token-123');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.ebay.com/identity/v1/oauth2/token',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/x-www-form-urlencoded',
          }),
        })
      );

      // Verify basic auth header
      const call = mockFetch.mock.calls[0];
      const authHeader = call[1].headers.Authorization;
      expect(authHeader).toMatch(/^Basic /);

      // Verify body contains correct grant_type and scope
      const body = call[1].body.toString();
      expect(body).toContain('grant_type=client_credentials');
      expect(body).toContain('scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope');
    });

    it('should cache token and reuse it', async () => {
      const client = new EbayBrowseClient();
      mockTokenResponse('cached-token');

      const token1 = await client.getApplicationToken();
      const token2 = await client.getApplicationToken();

      expect(token1).toBe('cached-token');
      expect(token2).toBe('cached-token');
      // Should only call API once
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should refresh token when near expiry', async () => {
      const client = new EbayBrowseClient();

      // First token expires in 2 minutes (within 5 minute buffer)
      mockTokenResponse('first-token', 120);
      await client.getApplicationToken();

      // Second call should fetch new token
      mockTokenResponse('second-token', 7200);
      const token = await client.getApplicationToken();

      expect(token).toBe('second-token');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should throw error when token fetch fails', async () => {
      const client = new EbayBrowseClient();

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Invalid credentials',
      });

      await expect(client.getApplicationToken()).rejects.toThrow(
        'Failed to get eBay application token: 401'
      );
    });

    it('should use default expiry when not provided', async () => {
      const client = new EbayBrowseClient();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'token-without-expiry',
          // No expires_in
        }),
      });

      const token = await client.getApplicationToken();

      expect(token).toBe('token-without-expiry');
    });
  });

  describe('searchItems', () => {
    it('should search items with query', async () => {
      const client = new EbayBrowseClient();
      mockTokenResponse();

      const mockSearchResponse: EbaySearchResponse = {
        href: 'https://api.ebay.com/buy/browse/v1/item_summary/search?q=test',
        total: 100,
        limit: 50,
        offset: 0,
        itemSummaries: [
          {
            itemId: 'v1|123456789|0',
            title: 'Test Item',
            price: { value: '49.99', currency: 'GBP' },
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockSearchResponse,
      });

      const result = await client.searchItems('test query');

      expect(result.total).toBe(100);
      expect(result.itemSummaries).toHaveLength(1);
      expect(result.itemSummaries![0].itemId).toBe('v1|123456789|0');

      // Verify API call
      const apiCall = mockFetch.mock.calls[1];
      expect(apiCall[0]).toContain('https://api.ebay.com/buy/browse/v1/item_summary/search');
      expect(apiCall[0]).toContain('q=test+query');
    });

    it('should include search options in request', async () => {
      const client = new EbayBrowseClient();
      mockTokenResponse();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ href: '', total: 0, limit: 50, offset: 0 }),
      });

      const options: EbaySearchOptions = {
        categoryId: '19006',
        filter: 'conditions:{NEW}',
        sort: 'price',
        limit: 100,
        offset: 50,
      };

      await client.searchItems('LEGO', options);

      const apiCall = mockFetch.mock.calls[1];
      expect(apiCall[0]).toContain('category_ids=19006');
      expect(apiCall[0]).toContain('filter=conditions%3A%7BNEW%7D');
      expect(apiCall[0]).toContain('sort=price');
      expect(apiCall[0]).toContain('limit=100');
      expect(apiCall[0]).toContain('offset=50');
    });

    it('should cap limit at 200', async () => {
      const client = new EbayBrowseClient();
      mockTokenResponse();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ href: '', total: 0, limit: 200, offset: 0 }),
      });

      await client.searchItems('test', { limit: 500 });

      const apiCall = mockFetch.mock.calls[1];
      expect(apiCall[0]).toContain('limit=200');
    });

    it('should include marketplace header', async () => {
      const client = new EbayBrowseClient();
      mockTokenResponse();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ href: '', total: 0, limit: 50, offset: 0 }),
      });

      await client.searchItems('test');

      const apiCall = mockFetch.mock.calls[1];
      expect(apiCall[1].headers['X-EBAY-C-MARKETPLACE-ID']).toBe('EBAY_GB');
    });

    it('should throw error when search fails', async () => {
      const client = new EbayBrowseClient();
      mockTokenResponse();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Invalid query',
      });

      await expect(client.searchItems('test')).rejects.toThrow(
        'eBay Browse API search failed: 400'
      );
    });
  });

  describe('searchLegoSet', () => {
    it('should search for LEGO set with default options', async () => {
      const client = new EbayBrowseClient();
      mockTokenResponse();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          href: '',
          total: 10,
          limit: 50,
          offset: 0,
          itemSummaries: [{ itemId: '123', title: 'LEGO 75192' }],
        }),
      });

      const result = await client.searchLegoSet('75192');

      expect(result.total).toBe(10);

      const apiCall = mockFetch.mock.calls[1];
      expect(apiCall[0]).toContain('q=LEGO+75192');
      expect(apiCall[0]).toContain('category_ids=19006');
      expect(apiCall[0]).toContain('conditions%3A%7BNEW%7D');
      expect(apiCall[0]).toContain('buyingOptions%3A%7BFIXED_PRICE%7D');
      expect(apiCall[0]).toContain('itemLocationCountry%3AGB');
      expect(apiCall[0]).toContain('sort=price');
    });

    it('should strip variant suffix from set number', async () => {
      const client = new EbayBrowseClient();
      mockTokenResponse();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ href: '', total: 0, limit: 50, offset: 0 }),
      });

      await client.searchLegoSet('75192-1');

      const apiCall = mockFetch.mock.calls[1];
      expect(apiCall[0]).toContain('q=LEGO+75192');
      expect(apiCall[0]).not.toContain('75192-1');
    });

    it('should allow custom limit', async () => {
      const client = new EbayBrowseClient();
      mockTokenResponse();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ href: '', total: 0, limit: 25, offset: 0 }),
      });

      await client.searchLegoSet('75192', 25);

      const apiCall = mockFetch.mock.calls[1];
      expect(apiCall[0]).toContain('limit=25');
    });
  });

  describe('searchLegoSetUsed', () => {
    it('should search for used LEGO sets', async () => {
      const client = new EbayBrowseClient();
      mockTokenResponse();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          href: '',
          total: 5,
          limit: 50,
          offset: 0,
          itemSummaries: [{ itemId: '456', title: 'LEGO 75192 Used' }],
        }),
      });

      const result = await client.searchLegoSetUsed('75192');

      expect(result.total).toBe(5);

      const apiCall = mockFetch.mock.calls[1];
      expect(apiCall[0]).toContain('q=LEGO+75192');
      expect(apiCall[0]).toContain('conditions%3A%7BUSED%7D');
      expect(apiCall[0]).toContain('category_ids=19006');
    });

    it('should strip variant suffix from set number', async () => {
      const client = new EbayBrowseClient();
      mockTokenResponse();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ href: '', total: 0, limit: 50, offset: 0 }),
      });

      await client.searchLegoSetUsed('40585-1');

      const apiCall = mockFetch.mock.calls[1];
      expect(apiCall[0]).toContain('q=LEGO+40585');
    });
  });

  describe('getItem', () => {
    it('should fetch item by ID', async () => {
      const client = new EbayBrowseClient();
      mockTokenResponse();

      const mockItem = {
        itemId: 'v1|123456789|0',
        title: 'LEGO Star Wars Millennium Falcon',
        price: { value: '649.99', currency: 'GBP' },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockItem,
      });

      const result = await client.getItem('v1|123456789|0');

      expect(result).toEqual(mockItem);

      const apiCall = mockFetch.mock.calls[1];
      expect(apiCall[0]).toContain('/item/v1%7C123456789%7C0');
    });

    it('should throw error when item not found', async () => {
      const client = new EbayBrowseClient();
      mockTokenResponse();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'Item not found',
      });

      await expect(client.getItem('invalid-item-id')).rejects.toThrow(
        'eBay Browse API get item failed: 404'
      );
    });

    it('should include marketplace header', async () => {
      const client = new EbayBrowseClient();
      mockTokenResponse();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      await client.getItem('v1|123|0');

      const apiCall = mockFetch.mock.calls[1];
      expect(apiCall[1].headers['X-EBAY-C-MARKETPLACE-ID']).toBe('EBAY_GB');
    });
  });

  describe('getEbayBrowseClient', () => {
    it('should return singleton instance', () => {
      const client1 = getEbayBrowseClient();
      const client2 = getEbayBrowseClient();

      expect(client1).toBe(client2);
    });

    it('should create new instance if none exists', () => {
      const client = getEbayBrowseClient();
      expect(client).toBeInstanceOf(EbayBrowseClient);
    });
  });

  describe('clearTokenCache', () => {
    it('should clear cached token', async () => {
      const client = new EbayBrowseClient();
      mockTokenResponse('first-token');
      await client.getApplicationToken();

      clearTokenCache();

      mockTokenResponse('second-token');
      const token = await client.getApplicationToken();

      expect(token).toBe('second-token');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('EbayItemSummary type coverage', () => {
    it('should handle full item summary with all fields', async () => {
      const client = new EbayBrowseClient();
      mockTokenResponse();

      const fullItemSummary = {
        itemId: 'v1|123456789|0',
        title: 'LEGO Star Wars Millennium Falcon 75192 Set',
        price: { value: '649.99', currency: 'GBP' },
        condition: 'New',
        conditionId: '1000',
        itemWebUrl: 'https://www.ebay.co.uk/itm/123456789',
        image: { imageUrl: 'https://i.ebayimg.com/images/g/abc/s-l500.jpg' },
        seller: {
          username: 'lego-seller-uk',
          feedbackPercentage: '99.8',
          feedbackScore: 15000,
        },
        shippingOptions: [
          {
            shippingCost: { value: '0.00', currency: 'GBP' },
            type: 'FIXED',
          },
        ],
        itemLocation: {
          country: 'GB',
          postalCode: 'SW1A',
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          href: '',
          total: 1,
          limit: 50,
          offset: 0,
          itemSummaries: [fullItemSummary],
        }),
      });

      const result = await client.searchItems('test');

      expect(result.itemSummaries![0]).toEqual(fullItemSummary);
      expect(result.itemSummaries![0].seller?.feedbackScore).toBe(15000);
      expect(result.itemSummaries![0].shippingOptions?.[0].type).toBe('FIXED');
    });

    it('should handle item summary with minimal fields', async () => {
      const client = new EbayBrowseClient();
      mockTokenResponse();

      const minimalItemSummary = {
        itemId: 'v1|123|0',
        title: 'Test Item',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          href: '',
          total: 1,
          limit: 50,
          offset: 0,
          itemSummaries: [minimalItemSummary],
        }),
      });

      const result = await client.searchItems('test');

      expect(result.itemSummaries![0].itemId).toBe('v1|123|0');
      expect(result.itemSummaries![0].price).toBeUndefined();
      expect(result.itemSummaries![0].seller).toBeUndefined();
    });
  });
});
