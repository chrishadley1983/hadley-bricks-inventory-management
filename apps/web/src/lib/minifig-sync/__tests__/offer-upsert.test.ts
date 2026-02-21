/**
 * Tests for the offer upsert logic in ListingStagingService.
 *
 * Since createOrUpdateOffer is private, we test the three scenarios
 * by calling the adapter methods in the same sequence the service uses.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EbayApiAdapter } from '../../ebay/ebay-api.adapter';

// Mock the signature service
vi.mock('../../ebay/ebay-signature.service', () => ({
  ebaySignatureService: {
    getSigningKeys: vi.fn(),
    signRequest: vi.fn().mockReturnValue({}),
  },
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

const TEST_SKU = 'HB-MF-6468-U-302-4';
const KNOWN_OFFER_ID = '989142392016';
const OFFER_BODY = {
  sku: TEST_SKU,
  marketplaceId: 'EBAY_GB',
  format: 'FIXED_PRICE' as const,
  categoryId: '19003',
  listingPolicies: {
    fulfillmentPolicyId: 'fp-1',
    paymentPolicyId: 'pp-1',
    returnPolicyId: 'rp-1',
  },
  pricingSummary: { price: { value: '12.99', currency: 'GBP' } },
};

describe('Offer Upsert Logic (createOrUpdateOffer scenarios)', () => {
  let adapter: EbayApiAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    adapter = new EbayApiAdapter({ accessToken: 'test-token', marketplaceId: 'EBAY_GB' });
  });

  describe('Scenario 1: Known offer ID exists — update succeeds', () => {
    it('should update the existing offer and return its ID', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ offerId: KNOWN_OFFER_ID, sku: TEST_SKU }),
      });

      const result = await adapter.updateOffer(KNOWN_OFFER_ID, OFFER_BODY);

      expect(result.offerId).toBe(KNOWN_OFFER_ID);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain(`/offer/${KNOWN_OFFER_ID}`);
      expect(options.method).toBe('PUT');
    });
  });

  describe('Scenario 2: Known offer ID is stale — falls back to getOffersBySku', () => {
    it('should query offers by SKU when known offer update fails', async () => {
      // updateOffer fails with 404 (offer was deleted) — 4xx errors don't retry
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: () =>
          Promise.resolve({
            errors: [{ errorId: 25002, domain: 'API_INVENTORY', category: 'REQUEST', message: 'Offer not found' }],
          }),
      });

      // getOffersBySku returns a different offer
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            offers: [{ offerId: '999999', sku: TEST_SKU, marketplaceId: 'EBAY_GB', format: 'FIXED_PRICE' }],
            total: 1,
          }),
      });

      // Step 1: updateOffer fails (4xx = no retry)
      let knownOfferWorked = true;
      try {
        await adapter.updateOffer(KNOWN_OFFER_ID, OFFER_BODY);
      } catch {
        knownOfferWorked = false;
      }
      expect(knownOfferWorked).toBe(false);

      // Step 2: Query by SKU finds a different offer
      const offers = await adapter.getOffersBySku(TEST_SKU);
      expect(offers).toHaveLength(1);
      expect(offers[0].offerId).toBe('999999');
    });
  });

  describe('Scenario 3: No known offer, no existing offers — create new', () => {
    it('should create a new offer when getOffersBySku returns empty', async () => {
      // getOffersBySku: 404 → caught internally → returns []
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: () => Promise.resolve({ errors: [] }),
      });

      // createOffer succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ offerId: 'new-offer-123' }),
      });

      const offers = await adapter.getOffersBySku(TEST_SKU);
      expect(offers).toEqual([]);

      const result = await adapter.createOffer(OFFER_BODY);
      expect(result.offerId).toBe('new-offer-123');
    });
  });

  describe('Scenario 4: bio018 exact case — offer exists on eBay for SKU', () => {
    it('should find the orphaned offer via getOffersBySku and update it', async () => {
      // getOffersBySku finds the orphaned offer
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            offers: [
              {
                offerId: KNOWN_OFFER_ID,
                sku: TEST_SKU,
                marketplaceId: 'EBAY_GB',
                format: 'FIXED_PRICE',
                status: 'UNPUBLISHED',
              },
            ],
            total: 1,
          }),
      });

      // updateOffer succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ offerId: KNOWN_OFFER_ID, sku: TEST_SKU }),
      });

      const offers = await adapter.getOffersBySku(TEST_SKU);
      expect(offers).toHaveLength(1);
      expect(offers[0].offerId).toBe(KNOWN_OFFER_ID);

      const result = await adapter.updateOffer(offers[0].offerId, OFFER_BODY);
      expect(result.offerId).toBe(KNOWN_OFFER_ID);

      // Verify the correct API calls were made
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const [getUrl] = mockFetch.mock.calls[0];
      expect(getUrl).toContain('sku=');
      const [putUrl, putOptions] = mockFetch.mock.calls[1];
      expect(putUrl).toContain(`/offer/${KNOWN_OFFER_ID}`);
      expect(putOptions.method).toBe('PUT');
    });
  });

  describe('getOffersBySku edge cases', () => {
    it('should handle eBay returning a 500 error gracefully', async () => {
      // 500 errors would normally retry, but getOffersBySku wraps in try/catch
      // The adapter retries 5xx errors with delays, so we mock 3 consecutive 500s
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: () => Promise.resolve({ errors: [] }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: () => Promise.resolve({ errors: [] }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: () => Promise.resolve({ errors: [] }),
        });

      const result = await adapter.getOffersBySku(TEST_SKU);
      expect(result).toEqual([]);
    }, 30000);

    it('should handle eBay returning 404 (no offers exist)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: () => Promise.resolve({ errors: [{ errorId: 25710, domain: 'API_INVENTORY', category: 'REQUEST', message: 'No offers found' }] }),
      });

      const result = await adapter.getOffersBySku(TEST_SKU);
      expect(result).toEqual([]);
    });

    it('should handle null/undefined response body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(null),
      });

      const result = await adapter.getOffersBySku(TEST_SKU);
      expect(result).toEqual([]);
    });

    it('should handle empty offers array', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ offers: [], total: 0 }),
      });

      const result = await adapter.getOffersBySku(TEST_SKU);
      expect(result).toEqual([]);
    });
  });
});
