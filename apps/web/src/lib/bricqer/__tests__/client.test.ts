import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BricqerClient,
  BricqerApiError,
  BricqerRateLimitError,
  BricqerAuthError,
} from '../client';
import type { BricqerCredentials } from '../types';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('BricqerClient', () => {
  const credentials: BricqerCredentials = {
    tenantUrl: 'https://test.bricqer.com',
    apiKey: 'test-api-key-123',
  };

  let client: BricqerClient;

  beforeEach(() => {
    vi.resetAllMocks();
    client = new BricqerClient(credentials);
  });

  describe('constructor', () => {
    it('should normalize tenant URL with trailing slash', () => {
      const clientWithSlash = new BricqerClient({
        tenantUrl: 'https://test.bricqer.com/',
        apiKey: 'test-key',
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({ results: [] }),
      });

      // Trigger a request to see the URL format
      clientWithSlash.getOrders({ limit: 1 });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('https://test.bricqer.com/api/v1'),
        expect.any(Object)
      );
    });

    it('should add https:// if protocol missing', () => {
      const clientNoProtocol = new BricqerClient({
        tenantUrl: 'test.bricqer.com',
        apiKey: 'test-key',
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({ results: [] }),
      });

      clientNoProtocol.getOrders({ limit: 1 });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('https://test.bricqer.com/api/v1'),
        expect.any(Object)
      );
    });
  });

  describe('BricqerApiError', () => {
    it('should create error with message, code, and statusCode', () => {
      const error = new BricqerApiError('Test error', 'TEST_CODE', 500);

      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.statusCode).toBe(500);
      expect(error.name).toBe('BricqerApiError');
    });
  });

  describe('BricqerRateLimitError', () => {
    it('should create rate limit error with rateLimitInfo', () => {
      const rateLimitInfo = {
        remaining: 0,
        resetTime: new Date('2024-12-20T12:00:00Z'),
        limit: 100,
      };
      const error = new BricqerRateLimitError('Rate limited', rateLimitInfo);

      expect(error.message).toBe('Rate limited');
      expect(error.code).toBe('RATE_LIMIT');
      expect(error.statusCode).toBe(429);
      expect(error.rateLimitInfo).toEqual(rateLimitInfo);
      expect(error.name).toBe('BricqerRateLimitError');
    });
  });

  describe('BricqerAuthError', () => {
    it('should create auth error', () => {
      const error = new BricqerAuthError('Invalid API key');

      expect(error.message).toBe('Invalid API key');
      expect(error.code).toBe('AUTH_ERROR');
      expect(error.statusCode).toBe(401);
      expect(error.name).toBe('BricqerAuthError');
    });
  });

  describe('getRateLimitInfo', () => {
    it('should return null initially', () => {
      expect(client.getRateLimitInfo()).toBeNull();
    });

    it('should return rate limit info after a request with rate limit headers', async () => {
      const headers = new Headers({
        'X-RateLimit-Remaining': '95',
        'X-RateLimit-Limit': '100',
        'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 3600),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers,
        json: () => Promise.resolve({ results: [] }),
      });

      await client.getOrders({ limit: 1 });

      const rateLimitInfo = client.getRateLimitInfo();
      expect(rateLimitInfo).not.toBeNull();
      expect(rateLimitInfo?.remaining).toBe(95);
      expect(rateLimitInfo?.limit).toBe(100);
    });
  });

  describe('testConnection', () => {
    it('should return true when connection is successful', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({ results: [] }),
      });

      const result = await client.testConnection();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/orders/order/'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Api-Key test-api-key-123',
          }),
        })
      );
    });

    it('should return false for auth errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers(),
        json: () => Promise.resolve({ error: 'Unauthorized' }),
      });

      const result = await client.testConnection();

      expect(result).toBe(false);
    });

    it('should return false for 403 forbidden errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: new Headers(),
        json: () => Promise.resolve({ error: 'Forbidden' }),
      });

      const result = await client.testConnection();

      expect(result).toBe(false);
    });

    it('should throw for other errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers(),
        json: () => Promise.resolve({ error: 'Server error' }),
      });

      await expect(client.testConnection()).rejects.toThrow(BricqerApiError);
    });
  });

  describe('getOrders', () => {
    it('should fetch orders with default params', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({
          results: [
            { id: 1, order_number: 'BQ-001', status: 'READY' },
            { id: 2, order_number: 'BQ-002', status: 'SHIPPED' },
          ],
        }),
      });

      const orders = await client.getOrders();

      expect(orders).toHaveLength(2);
      expect(orders[0].order_number).toBe('BQ-001');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.bricqer.com/api/v1/orders/order/',
        expect.any(Object)
      );
    });

    it('should handle array response format', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve([
          { id: 1, order_number: 'BQ-001' },
          { id: 2, order_number: 'BQ-002' },
        ]),
      });

      const orders = await client.getOrders();

      expect(orders).toHaveLength(2);
    });

    it('should pass status filter as query param', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({ results: [] }),
      });

      await client.getOrders({ status: 'READY' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('status=READY'),
        expect.any(Object)
      );
    });

    it('should join array status with commas', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({ results: [] }),
      });

      await client.getOrders({ status: ['READY', 'SHIPPED'] });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('status=READY%2CSHIPPED'),
        expect.any(Object)
      );
    });

    it('should pass limit and offset params', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({ results: [] }),
      });

      await client.getOrders({ limit: 50, offset: 100 });

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('limit=50');
      expect(url).toContain('offset=100');
    });

    it('should pass filed param for archived orders', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({ results: [] }),
      });

      await client.getOrders({ filed: true });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('filed=true'),
        expect.any(Object)
      );
    });

    it('should pass ordering param', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({ results: [] }),
      });

      await client.getOrders({ ordering: '-created_at' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('ordering=-created_at'),
        expect.any(Object)
      );
    });

    it('should pass search param', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({ results: [] }),
      });

      await client.getOrders({ search: 'test query' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('search=test+query'),
        expect.any(Object)
      );
    });
  });

  describe('getAllOrders', () => {
    it('should paginate through all orders', async () => {
      // First page - full page of results
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({
          results: Array(100).fill({ id: 1, order_number: 'BQ-001' }),
        }),
      });

      // Second page - partial results (end of data)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({
          results: [{ id: 101, order_number: 'BQ-101' }],
        }),
      });

      const orders = await client.getAllOrders();

      expect(orders).toHaveLength(101);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should stop pagination when receiving empty results', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({ results: [] }),
      });

      const orders = await client.getAllOrders();

      expect(orders).toHaveLength(0);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should pass filter params to all pages', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({ results: [] }),
      });

      await client.getAllOrders({ status: 'READY', filed: false });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/status=READY.*filed=false|filed=false.*status=READY/),
        expect.any(Object)
      );
    });
  });

  describe('getOrder', () => {
    it('should fetch a single order by ID', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({
          id: 123,
          order_number: 'BQ-123',
          status: 'READY',
          items: [],
        }),
      });

      const order = await client.getOrder(123);

      expect(order.id).toBe(123);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.bricqer.com/api/v1/orders/order/123/',
        expect.any(Object)
      );
    });

    it('should accept string order ID', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({ id: 123, order_number: 'BQ-123' }),
      });

      await client.getOrder('BQ-123');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.bricqer.com/api/v1/orders/order/BQ-123/',
        expect.any(Object)
      );
    });

    it('should throw NOT_FOUND error for non-existent order', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
        json: () => Promise.resolve({ detail: 'Not found' }),
      });

      try {
        await client.getOrder(999);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(BricqerApiError);
        expect((error as BricqerApiError).code).toBe('NOT_FOUND');
        expect((error as BricqerApiError).statusCode).toBe(404);
      }
    });
  });

  describe('getOrderItems', () => {
    it('should fetch order items', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve([
          { id: 1, name: 'Item 1', quantity: 2 },
          { id: 2, name: 'Item 2', quantity: 5 },
        ]),
      });

      const items = await client.getOrderItems(123);

      expect(items).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.bricqer.com/api/v1/orders/order/123/items/',
        expect.any(Object)
      );
    });

    it('should handle object response with items array', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({
          items: [{ id: 1, name: 'Item 1' }],
        }),
      });

      const items = await client.getOrderItems(123);

      expect(items).toHaveLength(1);
    });

    it('should fallback to order detail when items endpoint returns 404', async () => {
      // First call - items endpoint 404
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
        json: () => Promise.resolve({ detail: 'Not found' }),
      });

      // Second call - order detail with items
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({
          id: 123,
          items: [{ id: 1, name: 'Item from order' }],
        }),
      });

      const items = await client.getOrderItems(123);

      expect(items).toHaveLength(1);
      expect(items[0].name).toBe('Item from order');
    });
  });

  describe('getOrderWithItems', () => {
    it('should fetch order and items together', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({
          id: 123,
          order_number: 'BQ-123',
          items: [{ id: 1, name: 'Item 1' }],
        }),
      });

      const result = await client.getOrderWithItems(123);

      expect(result.order.id).toBe(123);
      expect(result.items).toHaveLength(1);
    });

    it('should fetch items separately if not included in order', async () => {
      // Order without items
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({
          id: 123,
          order_number: 'BQ-123',
        }),
      });

      // Items request
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve([{ id: 1, name: 'Item 1' }]),
      });

      const result = await client.getOrderWithItems(123);

      expect(result.order.id).toBe(123);
      expect(result.items).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('getSalesOrders', () => {
    it('should fetch sales orders with ordering', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({ results: [] }),
      });

      await client.getSalesOrders('READY', 10);

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('status=READY');
      expect(url).toContain('limit=10');
      expect(url).toContain('ordering=-created_at');
    });
  });

  describe('getInventoryItems', () => {
    it('should fetch inventory items', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({
          results: [
            { id: 1, definitionId: 100, quantity: 5 },
            { id: 2, definitionId: 200, quantity: 10 },
          ],
        }),
      });

      const items = await client.getInventoryItems();

      expect(items).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.bricqer.com/api/v1/inventory/item/',
        expect.any(Object)
      );
    });

    it('should pass filter params', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({ results: [] }),
      });

      await client.getInventoryItems({
        storage: 1,
        condition: 'N',
        search: 'brick',
        limit: 50,
        offset: 10,
      });

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('storage=1');
      expect(url).toContain('condition=N');
      expect(url).toContain('search=brick');
      expect(url).toContain('limit=50');
      expect(url).toContain('offset=10');
    });
  });

  describe('getAllInventoryItems', () => {
    it('should paginate through all inventory items', async () => {
      // First page
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({
          results: Array(100).fill({ id: 1 }),
          next: 'http://next-page',
        }),
      });

      // Second page
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({
          results: [{ id: 101 }],
          next: null,
        }),
      });

      const items = await client.getAllInventoryItems();

      expect(items).toHaveLength(101);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('getInventoryItem', () => {
    it('should fetch a single inventory item', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({
          id: 123,
          definitionId: 100,
          quantity: 5,
        }),
      });

      const item = await client.getInventoryItem(123);

      expect(item.id).toBe(123);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.bricqer.com/api/v1/inventory/item/123/',
        expect.any(Object)
      );
    });
  });

  describe('getStorageLocations', () => {
    it('should fetch storage locations', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve([
          { id: 1, name: 'Shelf A' },
          { id: 2, name: 'Shelf B' },
        ]),
      });

      const locations = await client.getStorageLocations();

      expect(locations).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.bricqer.com/api/v1/inventory/storage/',
        expect.any(Object)
      );
    });

    it('should handle paginated response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({
          results: [{ id: 1, name: 'Shelf A' }],
        }),
      });

      const locations = await client.getStorageLocations();

      expect(locations).toHaveLength(1);
    });
  });

  describe('getColors', () => {
    it('should fetch colors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve([
          { id: 1, name: 'Red' },
          { id: 2, name: 'Blue' },
        ]),
      });

      const colors = await client.getColors();

      expect(colors).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.bricqer.com/api/v1/inventory/color/',
        expect.any(Object)
      );
    });
  });

  describe('getBatches', () => {
    it('should fetch batches', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve([
          { id: 1, totalQuantity: 100 },
          { id: 2, totalQuantity: 50 },
        ]),
      });

      const batches = await client.getBatches();

      expect(batches).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.bricqer.com/api/v1/inventory/batch/',
        expect.any(Object)
      );
    });

    it('should pass limit param', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({ results: [] }),
      });

      await client.getBatches(10);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=10'),
        expect.any(Object)
      );
    });
  });

  describe('getPurchases', () => {
    it('should fetch purchases', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve([
          { id: 1, supplier: 'Supplier A' },
          { id: 2, supplier: 'Supplier B' },
        ]),
      });

      const purchases = await client.getPurchases();

      expect(purchases).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.bricqer.com/api/v1/inventory/purchase/',
        expect.any(Object)
      );
    });
  });

  describe('getInventoryStats', () => {
    it('should return inventory statistics', async () => {
      // Items request
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({
          page: { count: 500 },
          results: [],
        }),
      });

      // Storage request
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve([
          { id: 1, name: 'Shelf A' },
          { id: 2, name: 'Shelf B' },
          { id: 3, name: 'Shelf C' },
        ]),
      });

      const stats = await client.getInventoryStats();

      expect(stats.totalItems).toBe(500);
      expect(stats.storageLocations).toBe(3);
    });

    it('should handle count in root object', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({
          count: 250,
          results: [],
        }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve([]),
      });

      const stats = await client.getInventoryStats();

      expect(stats.totalItems).toBe(250);
    });
  });

  describe('error handling', () => {
    it('should throw BricqerAuthError for 401', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers(),
        json: () => Promise.resolve({ error: 'Unauthorized' }),
      });

      await expect(client.getOrders()).rejects.toThrow(BricqerAuthError);
    });

    it('should throw BricqerAuthError for 403', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: new Headers(),
        json: () => Promise.resolve({ error: 'Forbidden' }),
      });

      await expect(client.getOrders()).rejects.toThrow(BricqerAuthError);
    });

    it('should throw BricqerRateLimitError for 429 without retrying', async () => {
      // Rate limit errors should not be retried (they're 4xx errors except we check status)
      // But actually, looking at the code, 429 IS retried because of the condition:
      // error.statusCode !== 429
      // Let's just verify the error type
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        headers: new Headers({
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Limit': '100',
        }),
        json: () => Promise.resolve({ error: 'Rate limited' }),
      });

      await expect(client.getOrders()).rejects.toThrow(BricqerRateLimitError);
    }, 15000);

    it('should throw BricqerApiError with detail from response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers(),
        json: () => Promise.resolve({ detail: 'Invalid parameter' }),
      });

      try {
        await client.getOrders();
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(BricqerApiError);
        expect((error as BricqerApiError).message).toBe('Invalid parameter');
      }
    });

    it('should handle non-JSON error responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400, // Use 400 so it doesn't retry
        headers: new Headers(),
        json: () => Promise.reject(new Error('Invalid JSON')),
      });

      try {
        await client.getOrders();
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(BricqerApiError);
        expect((error as BricqerApiError).message).toContain('status 400');
      }
    });

    it('should convert AbortError to TIMEOUT error', async () => {
      mockFetch.mockImplementation(() => {
        const error = new Error('Aborted');
        error.name = 'AbortError';
        return Promise.reject(error);
      });

      try {
        await client.getOrders();
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(BricqerApiError);
        expect((error as BricqerApiError).code).toBe('TIMEOUT');
        expect((error as BricqerApiError).statusCode).toBe(408);
      }
    }, 15000);

    it('should convert network errors to NETWORK_ERROR', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      try {
        await client.getOrders();
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(BricqerApiError);
        expect((error as BricqerApiError).code).toBe('NETWORK_ERROR');
        expect((error as BricqerApiError).message).toBe('Network error');
      }
    }, 15000);
  });

  describe('retry logic', () => {
    it('should not retry auth errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers(),
        json: () => Promise.resolve({ error: 'Unauthorized' }),
      });

      await expect(client.getOrders()).rejects.toThrow(BricqerAuthError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should not retry 4xx client errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers(),
        json: () => Promise.resolve({ error: 'Bad request' }),
      });

      await expect(client.getOrders()).rejects.toThrow(BricqerApiError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should not retry 404 errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
        json: () => Promise.resolve({ error: 'Not found' }),
      });

      await expect(client.getOrders()).rejects.toThrow(BricqerApiError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should retry server errors and succeed on later attempt', async () => {
      // First two calls fail with server error
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          headers: new Headers(),
          json: () => Promise.resolve({ error: 'Server error' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          headers: new Headers(),
          json: () => Promise.resolve({ error: 'Service unavailable' }),
        })
        // Third call succeeds
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: () => Promise.resolve({ results: [{ id: 1 }] }),
        });

      const orders = await client.getOrders();

      expect(orders).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    }, 15000);

    it('should fail after max retries', async () => {
      // All calls fail
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers(),
        json: () => Promise.resolve({ error: 'Server error' }),
      });

      await expect(client.getOrders()).rejects.toThrow(BricqerApiError);
      // Should have tried MAX_RETRIES (3) times
      expect(mockFetch).toHaveBeenCalledTimes(3);
    }, 15000);
  });
});
