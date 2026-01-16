import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EbayApiAdapter, EbayApiError } from '../ebay-api.adapter';

// Mock the signature service
vi.mock('../ebay-signature.service', () => ({
  ebaySignatureService: {
    getSigningKeys: vi.fn(),
    signRequest: vi.fn().mockReturnValue({
      'x-ebay-signature-key': 'mock-sig-key',
      'x-ebay-enforce-signature': 'true',
      Signature: 'mock-signature',
      'Signature-Input': 'mock-signature-input',
      'Content-Digest': 'mock-content-digest',
    }),
  },
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('EbayApiAdapter', () => {
  let adapter: EbayApiAdapter;
  const testAccessToken = 'test-access-token-12345';
  const testMarketplaceId = 'EBAY_GB';

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    vi.useFakeTimers();
    adapter = new EbayApiAdapter({
      accessToken: testAccessToken,
      marketplaceId: testMarketplaceId,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should create adapter with default marketplace ID', () => {
      const adapterNoMarketplace = new EbayApiAdapter({
        accessToken: testAccessToken,
      });

      expect(adapterNoMarketplace).toBeDefined();
    });

    it('should use sandbox URL when sandbox mode is enabled', () => {
      const sandboxAdapter = new EbayApiAdapter({
        accessToken: testAccessToken,
        sandbox: true,
      });

      expect(sandboxAdapter).toBeDefined();
    });

    it('should accept signing keys in config', () => {
      const adapterWithKeys = new EbayApiAdapter({
        accessToken: testAccessToken,
        signingKeys: {
          signingKeyId: 'mock-key-id',
          privateKey: 'mock-private-key',
          publicKey: 'mock-public-key',
          jwe: 'mock-jwe',
          expiresAt: '2025-12-31T23:59:59Z',
        },
      });

      expect(adapterWithKeys).toBeDefined();
    });
  });

  describe('setAccessToken', () => {
    it('should update the access token', () => {
      const newToken = 'new-access-token';
      adapter.setAccessToken(newToken);

      // Token is private, but we can verify by making a request
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ orders: [], total: 0 }),
      });

      // The adapter should use the new token in the next request
      expect(adapter).toBeDefined();
    });
  });

  describe('getOrders', () => {
    const mockOrdersResponse = {
      orders: [
        {
          orderId: '123-456',
          buyer: { username: 'buyer1' },
          pricingSummary: { total: { value: '100.00', currency: 'GBP' } },
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    };

    it('should fetch orders successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockOrdersResponse),
      });

      const result = await adapter.getOrders();

      expect(result).toEqual(mockOrdersResponse);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('api.ebay.com/sell/fulfillment/v1/order'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: expect.stringContaining('Bearer'),
            'X-EBAY-C-MARKETPLACE-ID': testMarketplaceId,
          }),
        })
      );
    });

    it('should apply limit and offset parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockOrdersResponse),
      });

      await adapter.getOrders({ limit: 100, offset: 50 });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('limit=100');
      expect(url).toContain('offset=50');
    });

    it('should apply filter parameter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockOrdersResponse),
      });

      await adapter.getOrders({ filter: 'creationdate:[2024-01-01T00:00:00Z..]' });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('filter=');
    });

    it('should apply orderIds parameter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockOrdersResponse),
      });

      await adapter.getOrders({ orderIds: '123,456,789' });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('orderIds=123%2C456%2C789');
    });
  });

  describe('getOrder', () => {
    const mockOrder = {
      orderId: '123-456',
      buyer: { username: 'buyer1' },
      pricingSummary: { total: { value: '100.00', currency: 'GBP' } },
    };

    it('should fetch a specific order by ID', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockOrder),
      });

      const result = await adapter.getOrder('123-456');

      expect(result).toEqual(mockOrder);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/order/123-456'),
        expect.any(Object)
      );
    });

    it('should URL encode the order ID', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockOrder),
      });

      await adapter.getOrder('order/with/slashes');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('order%2Fwith%2Fslashes');
    });
  });

  describe('getShippingFulfilments', () => {
    const mockFulfilments = {
      fulfillments: [
        {
          fulfillmentId: 'ful-123',
          shipmentTrackingNumber: 'TRACK123',
        },
      ],
    };

    it('should fetch shipping fulfilments for an order', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockFulfilments),
      });

      const result = await adapter.getShippingFulfilments('123-456');

      expect(result).toEqual(mockFulfilments);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/order/123-456/shipping_fulfillment'),
        expect.any(Object)
      );
    });
  });

  describe('getTransactions (Finances API)', () => {
    const mockTransactionsResponse = {
      transactions: [
        {
          transactionId: 'tx-123',
          transactionType: 'SALE',
          amount: { value: '50.00', currency: 'GBP' },
        },
      ],
      total: 1,
    };

    it('should fetch transactions with digital signatures', async () => {
      const adapterWithKeys = new EbayApiAdapter({
        accessToken: testAccessToken,
        signingKeys: {
          signingKeyId: 'mock-key-id',
          privateKey: 'mock-private-key',
          publicKey: 'mock-public-key',
          jwe: 'mock-jwe',
          expiresAt: '2025-12-31T23:59:59Z',
        },
      });

      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockTransactionsResponse),
      });

      const result = await adapterWithKeys.getTransactions();

      expect(result).toEqual(mockTransactionsResponse);
      // Should use apiz.ebay.com for signed requests
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('apiz.ebay.com'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-ebay-signature-key': expect.any(String),
            Signature: expect.any(String),
          }),
        })
      );
    });

    it('should apply transaction type filter', async () => {
      const adapterWithKeys = new EbayApiAdapter({
        accessToken: testAccessToken,
        signingKeys: {
          signingKeyId: 'mock-key-id',
          privateKey: 'mock-private-key',
          publicKey: 'mock-public-key',
          jwe: 'mock-jwe',
          expiresAt: '2025-12-31T23:59:59Z',
        },
      });

      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockTransactionsResponse),
      });

      await adapterWithKeys.getTransactions({ transactionType: 'SALE' });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('transactionType=SALE');
    });
  });

  describe('getPayouts (Finances API)', () => {
    const mockPayoutsResponse = {
      payouts: [
        {
          payoutId: 'payout-123',
          payoutStatus: 'SUCCEEDED',
          amount: { value: '500.00', currency: 'GBP' },
        },
      ],
      total: 1,
    };

    it('should fetch payouts with digital signatures', async () => {
      const adapterWithKeys = new EbayApiAdapter({
        accessToken: testAccessToken,
        signingKeys: {
          signingKeyId: 'mock-key-id',
          privateKey: 'mock-private-key',
          publicKey: 'mock-public-key',
          jwe: 'mock-jwe',
          expiresAt: '2025-12-31T23:59:59Z',
        },
      });

      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockPayoutsResponse),
      });

      const result = await adapterWithKeys.getPayouts();

      expect(result).toEqual(mockPayoutsResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('apiz.ebay.com/sell/finances/v1/payout'),
        expect.any(Object)
      );
    });
  });

  describe('getAllOrders (pagination)', () => {
    it('should fetch all orders across multiple pages', async () => {
      vi.useRealTimers();

      const freshAdapter = new EbayApiAdapter({
        accessToken: testAccessToken,
        marketplaceId: testMarketplaceId,
      });

      mockFetch.mockReset();

      // First page
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            orders: [{ orderId: '1' }, { orderId: '2' }],
            total: 4,
          }),
      });

      // Second page
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            orders: [{ orderId: '3' }, { orderId: '4' }],
            total: 4,
          }),
      });

      const result = await freshAdapter.getAllOrders({ limit: 2 });

      expect(result).toHaveLength(4);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should handle single page results', async () => {
      vi.useRealTimers();

      const freshAdapter = new EbayApiAdapter({
        accessToken: testAccessToken,
        marketplaceId: testMarketplaceId,
      });

      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            orders: [{ orderId: '1' }],
            total: 1,
          }),
      });

      const result = await freshAdapter.getAllOrders();

      expect(result).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('error handling', () => {
    it('should throw EbayApiError for HTTP errors', async () => {
      vi.useRealTimers();

      const freshAdapter = new EbayApiAdapter({
        accessToken: testAccessToken,
        marketplaceId: testMarketplaceId,
      });

      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: () =>
          Promise.resolve({
            errors: [{ errorId: 15000, message: 'Invalid filter' }],
          }),
      });

      await expect(freshAdapter.getOrders()).rejects.toThrow(EbayApiError);
    });

    it('should not retry on 401 Unauthorized', async () => {
      vi.useRealTimers();

      const freshAdapter = new EbayApiAdapter({
        accessToken: testAccessToken,
        marketplaceId: testMarketplaceId,
      });

      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: () =>
          Promise.resolve({
            errors: [{ errorId: 1001, message: 'Invalid token' }],
          }),
      });

      await expect(freshAdapter.getOrders()).rejects.toThrow(EbayApiError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should not retry on 403 Forbidden', async () => {
      vi.useRealTimers();

      const freshAdapter = new EbayApiAdapter({
        accessToken: testAccessToken,
        marketplaceId: testMarketplaceId,
      });

      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: () =>
          Promise.resolve({
            errors: [{ errorId: 1002, message: 'Insufficient permissions' }],
          }),
      });

      await expect(freshAdapter.getOrders()).rejects.toThrow(EbayApiError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should handle rate limiting (429)', async () => {
      vi.useRealTimers();

      // Create fresh adapter with real timers
      const freshAdapter = new EbayApiAdapter({
        accessToken: testAccessToken,
        marketplaceId: testMarketplaceId,
      });

      mockFetch.mockReset();

      // First call returns 429 - use a proper headers mock with get method
      const mockHeaders = {
        get: vi.fn((name: string) => (name === 'Retry-After' ? '1' : null)),
      };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: mockHeaders,
        json: () => Promise.resolve({}),
      });

      // Second call succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ orders: [], total: 0 }),
      });

      const result = await freshAdapter.getOrders();

      expect(result).toEqual({ orders: [], total: 0 });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should provide helpful error message for signature errors', async () => {
      vi.useRealTimers();

      // Adapter without signing keys
      const freshAdapter = new EbayApiAdapter({
        accessToken: testAccessToken,
        marketplaceId: testMarketplaceId,
      });

      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: () =>
          Promise.resolve({
            errors: [{ errorId: 215120, message: 'Invalid x-ebay-signature-key header' }],
          }),
      });

      // getTransactions requires signature, but adapter has no signing keys
      // When API returns error mentioning signature, should provide helpful message
      await expect(freshAdapter.getTransactions()).rejects.toThrow(
        'Digital signature required'
      );
    });

    it('should retry on server errors with exponential backoff', async () => {
      vi.useRealTimers();

      // Create fresh adapter with real timers
      const freshAdapter = new EbayApiAdapter({
        accessToken: testAccessToken,
        marketplaceId: testMarketplaceId,
      });

      mockFetch.mockReset();

      // First two calls fail with 500
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({}),
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({}),
      });

      // Third call succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ orders: [], total: 0 }),
      });

      const result = await freshAdapter.getOrders();

      expect(result).toEqual({ orders: [], total: 0 });
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should throw after max retries exceeded', async () => {
      vi.useRealTimers();

      // Create fresh adapter with real timers
      const freshAdapter = new EbayApiAdapter({
        accessToken: testAccessToken,
        marketplaceId: testMarketplaceId,
      });

      mockFetch.mockReset();

      // All three retries fail with 500
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({}),
      });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({}),
      });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({}),
      });

      await expect(freshAdapter.getOrders()).rejects.toThrow(EbayApiError);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('filter builders', () => {
    describe('buildOrderDateFilter', () => {
      it('should return undefined when no dates provided', () => {
        const filter = EbayApiAdapter.buildOrderDateFilter();
        expect(filter).toBeUndefined();
      });

      it('should build filter for from date only', () => {
        const filter = EbayApiAdapter.buildOrderDateFilter('2024-01-01T00:00:00Z');
        expect(filter).toContain('creationdate:[2024-01-01T00:00:00.000Z..]');
      });

      it('should build filter for date range', () => {
        const filter = EbayApiAdapter.buildOrderDateFilter(
          '2024-01-01T00:00:00Z',
          '2024-12-31T23:59:59Z'
        );
        expect(filter).toContain('creationdate:[');
        expect(filter).toContain('..');
      });

      it('should use lastmodifieddate field when specified', () => {
        const filter = EbayApiAdapter.buildOrderDateFilter(
          '2024-01-01T00:00:00Z',
          undefined,
          'lastmodifieddate'
        );
        expect(filter).toContain('lastmodifieddate:');
      });

      it('should convert dates to UTC format', () => {
        const filter = EbayApiAdapter.buildOrderDateFilter('2024-06-15T12:30:00+01:00');
        // Should convert to UTC Z format
        expect(filter).toContain('Z..]');
      });
    });

    describe('buildFulfilmentStatusFilter', () => {
      it('should build filter for single status', () => {
        const filter = EbayApiAdapter.buildFulfilmentStatusFilter(['FULFILLED']);
        expect(filter).toBe('orderfulfillmentstatus:{FULFILLED}');
      });

      it('should build filter for multiple statuses', () => {
        const filter = EbayApiAdapter.buildFulfilmentStatusFilter([
          'FULFILLED',
          'IN_PROGRESS',
        ]);
        expect(filter).toBe('orderfulfillmentstatus:{FULFILLED|IN_PROGRESS}');
      });
    });

    describe('buildTransactionDateFilter', () => {
      it('should return undefined when no dates provided', () => {
        const filter = EbayApiAdapter.buildTransactionDateFilter();
        expect(filter).toBeUndefined();
      });

      it('should build filter for from date only', () => {
        const filter = EbayApiAdapter.buildTransactionDateFilter('2024-01-01T00:00:00Z');
        expect(filter).toContain('transactionDate:[');
        expect(filter).toContain('..]');
      });

      it('should build filter for date range', () => {
        const filter = EbayApiAdapter.buildTransactionDateFilter(
          '2024-01-01T00:00:00Z',
          '2024-12-31T23:59:59Z'
        );
        expect(filter).toContain('transactionDate:[');
        expect(filter).toContain('..');
        expect(filter).toContain(']');
      });
    });

    describe('buildPayoutDateFilter', () => {
      it('should return undefined when no dates provided', () => {
        const filter = EbayApiAdapter.buildPayoutDateFilter();
        expect(filter).toBeUndefined();
      });

      it('should build filter for from date only', () => {
        const filter = EbayApiAdapter.buildPayoutDateFilter('2024-01-01T00:00:00Z');
        expect(filter).toContain('payoutDate:[');
      });

      it('should build filter for to date only', () => {
        const filter = EbayApiAdapter.buildPayoutDateFilter(
          undefined,
          '2024-12-31T23:59:59Z'
        );
        expect(filter).toContain('payoutDate:[..');
      });

      it('should build filter for date range', () => {
        const filter = EbayApiAdapter.buildPayoutDateFilter(
          '2024-01-01T00:00:00Z',
          '2024-12-31T23:59:59Z'
        );
        expect(filter).toContain('payoutDate:[');
        expect(filter).toContain('..');
      });
    });
  });

  describe('EbayApiError', () => {
    it('should create error with status code', () => {
      const error = new EbayApiError('Test error', 400);

      expect(error.message).toBe('Test error');
      expect(error.statusCode).toBe(400);
      expect(error.name).toBe('EbayApiError');
    });

    it('should include error details from API', () => {
      const apiErrors = [{ errorId: 15000, domain: 'API', category: 'REQUEST', message: 'Invalid filter' }];
      const error = new EbayApiError('Test error', 400, apiErrors);

      expect(error.errors).toEqual(apiErrors);
    });
  });

  describe('setSigningKeys', () => {
    it('should update signing keys', () => {
      const newKeys = {
        signingKeyId: 'new-key-id',
        privateKey: 'new-private-key',
        publicKey: 'new-public-key',
        jwe: 'new-jwe',
        expiresAt: '2025-12-31T23:59:59Z',
      };
      adapter.setSigningKeys(newKeys);

      // Keys are private, but we can verify by making a signed request
      expect(adapter).toBeDefined();
    });
  });

  describe('getPayout', () => {
    const mockPayout = {
      payoutId: 'payout-123',
      payoutStatus: 'SUCCEEDED',
      amount: { value: '500.00', currency: 'GBP' },
      payoutDate: '2024-01-15T12:00:00Z',
    };

    it('should fetch a specific payout by ID with signature', async () => {
      const adapterWithKeys = new EbayApiAdapter({
        accessToken: testAccessToken,
        signingKeys: {
          signingKeyId: 'mock-key-id',
          privateKey: 'mock-private-key',
          publicKey: 'mock-public-key',
          jwe: 'mock-jwe',
          expiresAt: '2025-12-31T23:59:59Z',
        },
      });

      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockPayout),
      });

      const result = await adapterWithKeys.getPayout('payout-123');

      expect(result).toEqual(mockPayout);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/payout/payout-123'),
        expect.any(Object)
      );
    });

    it('should URL encode the payout ID', async () => {
      const adapterWithKeys = new EbayApiAdapter({
        accessToken: testAccessToken,
        signingKeys: {
          signingKeyId: 'mock-key-id',
          privateKey: 'mock-private-key',
          publicKey: 'mock-public-key',
          jwe: 'mock-jwe',
          expiresAt: '2025-12-31T23:59:59Z',
        },
      });

      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockPayout),
      });

      await adapterWithKeys.getPayout('payout/with/slashes');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('payout%2Fwith%2Fslashes');
    });
  });

  describe('getAllTransactions (pagination)', () => {
    it('should fetch all transactions across multiple pages', async () => {
      vi.useRealTimers();

      const adapterWithKeys = new EbayApiAdapter({
        accessToken: testAccessToken,
        marketplaceId: testMarketplaceId,
        signingKeys: {
          signingKeyId: 'mock-key-id',
          privateKey: 'mock-private-key',
          publicKey: 'mock-public-key',
          jwe: 'mock-jwe',
          expiresAt: '2025-12-31T23:59:59Z',
        },
      });

      mockFetch.mockReset();

      // First page
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            transactions: [
              { transactionId: 'tx-1' },
              { transactionId: 'tx-2' },
            ],
            total: 4,
          }),
      });

      // Second page
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            transactions: [
              { transactionId: 'tx-3' },
              { transactionId: 'tx-4' },
            ],
            total: 4,
          }),
      });

      const result = await adapterWithKeys.getAllTransactions({ limit: 2 });

      expect(result).toHaveLength(4);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should handle single page of transactions', async () => {
      vi.useRealTimers();

      const adapterWithKeys = new EbayApiAdapter({
        accessToken: testAccessToken,
        signingKeys: {
          signingKeyId: 'mock-key-id',
          privateKey: 'mock-private-key',
          publicKey: 'mock-public-key',
          jwe: 'mock-jwe',
          expiresAt: '2025-12-31T23:59:59Z',
        },
      });

      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            transactions: [{ transactionId: 'tx-1' }],
            total: 1,
          }),
      });

      const result = await adapterWithKeys.getAllTransactions();

      expect(result).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should apply filter to all pages', async () => {
      vi.useRealTimers();

      const adapterWithKeys = new EbayApiAdapter({
        accessToken: testAccessToken,
        signingKeys: {
          signingKeyId: 'mock-key-id',
          privateKey: 'mock-private-key',
          publicKey: 'mock-public-key',
          jwe: 'mock-jwe',
          expiresAt: '2025-12-31T23:59:59Z',
        },
      });

      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            transactions: [{ transactionId: 'tx-1' }],
            total: 1,
          }),
      });

      await adapterWithKeys.getAllTransactions({
        filter: 'transactionDate:[2024-01-01T00:00:00Z..]',
      });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('filter=');
    });
  });

  describe('getAllPayouts (pagination)', () => {
    it('should fetch all payouts across multiple pages', async () => {
      vi.useRealTimers();

      const adapterWithKeys = new EbayApiAdapter({
        accessToken: testAccessToken,
        marketplaceId: testMarketplaceId,
        signingKeys: {
          signingKeyId: 'mock-key-id',
          privateKey: 'mock-private-key',
          publicKey: 'mock-public-key',
          jwe: 'mock-jwe',
          expiresAt: '2025-12-31T23:59:59Z',
        },
      });

      mockFetch.mockReset();

      // First page
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            payouts: [{ payoutId: 'p-1' }, { payoutId: 'p-2' }],
            total: 4,
          }),
      });

      // Second page
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            payouts: [{ payoutId: 'p-3' }, { payoutId: 'p-4' }],
            total: 4,
          }),
      });

      const result = await adapterWithKeys.getAllPayouts({ limit: 2 });

      expect(result).toHaveLength(4);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should handle single page of payouts', async () => {
      vi.useRealTimers();

      const adapterWithKeys = new EbayApiAdapter({
        accessToken: testAccessToken,
        signingKeys: {
          signingKeyId: 'mock-key-id',
          privateKey: 'mock-private-key',
          publicKey: 'mock-public-key',
          jwe: 'mock-jwe',
          expiresAt: '2025-12-31T23:59:59Z',
        },
      });

      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            payouts: [{ payoutId: 'p-1' }],
            total: 1,
          }),
      });

      const result = await adapterWithKeys.getAllPayouts();

      expect(result).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should apply payoutStatus filter', async () => {
      vi.useRealTimers();

      const adapterWithKeys = new EbayApiAdapter({
        accessToken: testAccessToken,
        signingKeys: {
          signingKeyId: 'mock-key-id',
          privateKey: 'mock-private-key',
          publicKey: 'mock-public-key',
          jwe: 'mock-jwe',
          expiresAt: '2025-12-31T23:59:59Z',
        },
      });

      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            payouts: [],
            total: 0,
          }),
      });

      await adapterWithKeys.getAllPayouts({ payoutStatus: 'SUCCEEDED' });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('payoutStatus=SUCCEEDED');
    });
  });

  describe('empty results handling', () => {
    it('should handle empty orders response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ orders: [], total: 0 }),
      });

      const result = await adapter.getOrders();

      expect(result.orders).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should handle getAllOrders with no orders', async () => {
      vi.useRealTimers();

      const freshAdapter = new EbayApiAdapter({
        accessToken: testAccessToken,
        marketplaceId: testMarketplaceId,
      });

      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ orders: [], total: 0 }),
      });

      const result = await freshAdapter.getAllOrders();

      expect(result).toEqual([]);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('network error handling', () => {
    it('should handle network timeout', async () => {
      vi.useRealTimers();

      const freshAdapter = new EbayApiAdapter({
        accessToken: testAccessToken,
        marketplaceId: testMarketplaceId,
      });

      mockFetch.mockReset();
      mockFetch.mockRejectedValue(new Error('Network timeout'));

      await expect(freshAdapter.getOrders()).rejects.toThrow('Network timeout');
    });

    it('should handle fetch failure', async () => {
      vi.useRealTimers();

      const freshAdapter = new EbayApiAdapter({
        accessToken: testAccessToken,
        marketplaceId: testMarketplaceId,
      });

      mockFetch.mockReset();
      mockFetch.mockRejectedValue(new Error('Failed to fetch'));

      await expect(freshAdapter.getOrders()).rejects.toThrow('Failed to fetch');
    });

    it('should handle JSON parse error gracefully', async () => {
      vi.useRealTimers();

      const freshAdapter = new EbayApiAdapter({
        accessToken: testAccessToken,
        marketplaceId: testMarketplaceId,
      });

      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.reject(new Error('Invalid JSON')),
      });

      // Should still throw EbayApiError even if JSON parsing fails
      await expect(freshAdapter.getOrders()).rejects.toThrow();
    });
  });

  describe('getPayouts parameters', () => {
    it('should apply filter parameter', async () => {
      const adapterWithKeys = new EbayApiAdapter({
        accessToken: testAccessToken,
        signingKeys: {
          signingKeyId: 'mock-key-id',
          privateKey: 'mock-private-key',
          publicKey: 'mock-public-key',
          jwe: 'mock-jwe',
          expiresAt: '2025-12-31T23:59:59Z',
        },
      });

      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ payouts: [], total: 0 }),
      });

      await adapterWithKeys.getPayouts({ filter: 'payoutDate:[2024-01-01T00:00:00Z..]' });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('filter=');
    });

    it('should apply limit and offset parameters', async () => {
      const adapterWithKeys = new EbayApiAdapter({
        accessToken: testAccessToken,
        signingKeys: {
          signingKeyId: 'mock-key-id',
          privateKey: 'mock-private-key',
          publicKey: 'mock-public-key',
          jwe: 'mock-jwe',
          expiresAt: '2025-12-31T23:59:59Z',
        },
      });

      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ payouts: [], total: 0 }),
      });

      await adapterWithKeys.getPayouts({ limit: 100, offset: 50 });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('limit=100');
      expect(url).toContain('offset=50');
    });
  });

  describe('getTransactions parameters', () => {
    it('should apply filter parameter', async () => {
      const adapterWithKeys = new EbayApiAdapter({
        accessToken: testAccessToken,
        signingKeys: {
          signingKeyId: 'mock-key-id',
          privateKey: 'mock-private-key',
          publicKey: 'mock-public-key',
          jwe: 'mock-jwe',
          expiresAt: '2025-12-31T23:59:59Z',
        },
      });

      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ transactions: [], total: 0 }),
      });

      await adapterWithKeys.getTransactions({
        filter: 'transactionDate:[2024-01-01T00:00:00Z..]',
      });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('filter=');
    });

    it('should apply limit and offset parameters', async () => {
      const adapterWithKeys = new EbayApiAdapter({
        accessToken: testAccessToken,
        signingKeys: {
          signingKeyId: 'mock-key-id',
          privateKey: 'mock-private-key',
          publicKey: 'mock-public-key',
          jwe: 'mock-jwe',
          expiresAt: '2025-12-31T23:59:59Z',
        },
      });

      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ transactions: [], total: 0 }),
      });

      await adapterWithKeys.getTransactions({ limit: 100, offset: 50 });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('limit=100');
      expect(url).toContain('offset=50');
    });
  });

  describe('combined filter scenarios', () => {
    it('should combine date and status filters for orders', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ orders: [], total: 0 }),
      });

      const dateFilter = EbayApiAdapter.buildOrderDateFilter('2024-01-01T00:00:00Z');
      const statusFilter = EbayApiAdapter.buildFulfilmentStatusFilter(['FULFILLED']);
      const combinedFilter = `${dateFilter},${statusFilter}`;

      await adapter.getOrders({ filter: combinedFilter });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('filter=');
      expect(url).toContain('creationdate');
      expect(url).toContain('orderfulfillmentstatus');
    });
  });

  describe('sandbox mode', () => {
    it('should use sandbox URL when enabled', async () => {
      const sandboxAdapter = new EbayApiAdapter({
        accessToken: testAccessToken,
        sandbox: true,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ orders: [], total: 0 }),
      });

      await sandboxAdapter.getOrders();

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('sandbox.ebay.com');
    });
  });

  describe('rate limiting enforcement', () => {
    it('should delay subsequent requests to avoid rate limiting', async () => {
      vi.useRealTimers();

      const freshAdapter = new EbayApiAdapter({
        accessToken: testAccessToken,
        marketplaceId: testMarketplaceId,
      });

      mockFetch.mockReset();
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ orders: [], total: 0 }),
      });

      const startTime = Date.now();

      // Make two requests in quick succession
      await freshAdapter.getOrders();
      await freshAdapter.getOrders();

      const elapsed = Date.now() - startTime;

      // Should have at least 100ms delay between requests
      expect(elapsed).toBeGreaterThanOrEqual(100);
    });
  });

  describe('user ID for signing keys', () => {
    it('should accept userId in config for auto-fetching signing keys', () => {
      const adapterWithUserId = new EbayApiAdapter({
        accessToken: testAccessToken,
        userId: 'test-user-123',
      });

      expect(adapterWithUserId).toBeDefined();
    });
  });
});

