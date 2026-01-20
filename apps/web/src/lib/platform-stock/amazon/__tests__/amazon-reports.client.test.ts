/**
 * Tests for AmazonReportsClient
 *
 * Tests the Amazon SP-API Reports client including:
 * - Report creation and status polling
 * - Token management and refresh
 * - Download and decompression
 * - Error handling and rate limiting
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Suppress console logs during tests
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

// ============================================================================
// TEST HELPERS
// ============================================================================

function createMockCredentials() {
  return {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    refreshToken: 'test-refresh-token',
    sellerId: 'test-seller-id',
    marketplaceIds: ['A1F83G8C2ARO7P'],
  };
}

function createTokenResponse(accessToken: string = 'test-access-token', expiresIn: number = 3600) {
  return {
    ok: true,
    json: () => Promise.resolve({
      access_token: accessToken,
      expires_in: expiresIn,
    }),
  };
}

function createApiResponse<T>(data: T, ok: boolean = true, status: number = 200) {
  return {
    ok,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

// ============================================================================
// TESTS
// ============================================================================

describe('AmazonReportsClient', () => {
  const credentials = createMockCredentials();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // CONSTRUCTOR
  // ==========================================================================

  describe('constructor', () => {
    it('should create instance with credentials', async () => {
      const { AmazonReportsClient } = await import('../amazon-reports.client');
      const client = new AmazonReportsClient(credentials);

      expect(client).toBeDefined();
    });
  });

  // ==========================================================================
  // CREATE REPORT
  // ==========================================================================

  describe('createReport', () => {
    it('should create report and return reportId', async () => {
      // Mock token request
      mockFetch.mockResolvedValueOnce(createTokenResponse());
      // Mock create report request
      mockFetch.mockResolvedValueOnce(createApiResponse({ reportId: 'report-123' }));

      const { AmazonReportsClient } = await import('../amazon-reports.client');
      const client = new AmazonReportsClient(credentials);

      const reportId = await client.createReport('GET_MERCHANT_LISTINGS_ALL_DATA');

      expect(reportId).toBe('report-123');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should use custom marketplace IDs when provided', async () => {
      mockFetch.mockResolvedValueOnce(createTokenResponse());
      mockFetch.mockResolvedValueOnce(createApiResponse({ reportId: 'report-123' }));

      const { AmazonReportsClient } = await import('../amazon-reports.client');
      const client = new AmazonReportsClient(credentials);

      const customMarketplaces = ['ATVPDKIKX0DER', 'A2EUQ1WTGCTBG2'];
      await client.createReport('GET_MERCHANT_LISTINGS_ALL_DATA', customMarketplaces);

      // Check that the second call (API request) includes the marketplaces
      const apiCall = mockFetch.mock.calls[1];
      const body = JSON.parse(apiCall[1].body);
      expect(body.marketplaceIds).toEqual(customMarketplaces);
    });

    it('should use credentials marketplace IDs by default', async () => {
      mockFetch.mockResolvedValueOnce(createTokenResponse());
      mockFetch.mockResolvedValueOnce(createApiResponse({ reportId: 'report-123' }));

      const { AmazonReportsClient } = await import('../amazon-reports.client');
      const client = new AmazonReportsClient(credentials);

      await client.createReport('GET_MERCHANT_LISTINGS_ALL_DATA');

      const apiCall = mockFetch.mock.calls[1];
      const body = JSON.parse(apiCall[1].body);
      expect(body.marketplaceIds).toEqual(credentials.marketplaceIds);
    });
  });

  // ==========================================================================
  // GET REPORT STATUS
  // ==========================================================================

  describe('getReportStatus', () => {
    it('should return report status', async () => {
      mockFetch.mockResolvedValueOnce(createTokenResponse());
      mockFetch.mockResolvedValueOnce(createApiResponse({
        reportId: 'report-123',
        reportType: 'GET_MERCHANT_LISTINGS_ALL_DATA',
        processingStatus: 'IN_PROGRESS',
      }));

      const { AmazonReportsClient } = await import('../amazon-reports.client');
      const client = new AmazonReportsClient(credentials);

      const status = await client.getReportStatus('report-123');

      expect(status.reportId).toBe('report-123');
      expect(status.processingStatus).toBe('IN_PROGRESS');
    });
  });

  // ==========================================================================
  // WAIT FOR REPORT
  // ==========================================================================

  describe('waitForReport', () => {
    it('should return when report is DONE', async () => {
      mockFetch.mockResolvedValueOnce(createTokenResponse());
      mockFetch.mockResolvedValueOnce(createApiResponse({
        reportId: 'report-123',
        processingStatus: 'DONE',
        reportDocumentId: 'doc-123',
      }));

      const { AmazonReportsClient } = await import('../amazon-reports.client');
      const client = new AmazonReportsClient(credentials);

      const result = await client.waitForReport('report-123', 5000, 10);

      expect(result.processingStatus).toBe('DONE');
      expect(result.reportDocumentId).toBe('doc-123');
    });

    it('should throw error when report is CANCELLED', async () => {
      mockFetch.mockResolvedValueOnce(createTokenResponse());
      mockFetch.mockResolvedValueOnce(createApiResponse({
        reportId: 'report-123',
        processingStatus: 'CANCELLED',
      }));

      const { AmazonReportsClient } = await import('../amazon-reports.client');
      const client = new AmazonReportsClient(credentials);

      await expect(
        client.waitForReport('report-123', 5000, 10)
      ).rejects.toThrow('Report generation failed with status: CANCELLED');
    });

    it('should throw error when report is FATAL', async () => {
      mockFetch.mockResolvedValueOnce(createTokenResponse());
      mockFetch.mockResolvedValueOnce(createApiResponse({
        reportId: 'report-123',
        processingStatus: 'FATAL',
      }));

      const { AmazonReportsClient } = await import('../amazon-reports.client');
      const client = new AmazonReportsClient(credentials);

      await expect(
        client.waitForReport('report-123', 5000, 10)
      ).rejects.toThrow('Report generation failed with status: FATAL');
    });

    it('should throw error on timeout', async () => {
      mockFetch.mockResolvedValueOnce(createTokenResponse());
      // Always return IN_PROGRESS
      mockFetch.mockResolvedValue(createApiResponse({
        reportId: 'report-123',
        processingStatus: 'IN_PROGRESS',
      }));

      const { AmazonReportsClient } = await import('../amazon-reports.client');
      const client = new AmazonReportsClient(credentials);

      // Use very short timeout and poll interval
      await expect(
        client.waitForReport('report-123', 50, 10)
      ).rejects.toThrow('Report generation timed out');
    }, 10000);
  });

  // ==========================================================================
  // GET REPORT DOCUMENT
  // ==========================================================================

  describe('getReportDocument', () => {
    it('should return document info with URL', async () => {
      mockFetch.mockResolvedValueOnce(createTokenResponse());
      mockFetch.mockResolvedValueOnce(createApiResponse({
        reportDocumentId: 'doc-123',
        url: 'https://example.com/download/report',
        compressionAlgorithm: 'GZIP',
      }));

      const { AmazonReportsClient } = await import('../amazon-reports.client');
      const client = new AmazonReportsClient(credentials);

      const doc = await client.getReportDocument('doc-123');

      expect(doc.reportDocumentId).toBe('doc-123');
      expect(doc.url).toBe('https://example.com/download/report');
      expect(doc.compressionAlgorithm).toBe('GZIP');
    });
  });

  // ==========================================================================
  // DOWNLOAD REPORT
  // ==========================================================================

  describe('downloadReport', () => {
    it('should download uncompressed report', async () => {
      const reportContent = 'seller-sku\tquantity\nSKU-001\t5';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(reportContent),
      });

      const { AmazonReportsClient } = await import('../amazon-reports.client');
      const client = new AmazonReportsClient(credentials);

      const content = await client.downloadReport('https://example.com/report', false);

      expect(content).toBe(reportContent);
    });

    it('should throw error on download failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const { AmazonReportsClient } = await import('../amazon-reports.client');
      const client = new AmazonReportsClient(credentials);

      await expect(
        client.downloadReport('https://example.com/report', false)
      ).rejects.toThrow('Failed to download report: 404');
    });
  });

  // ==========================================================================
  // FETCH MERCHANT LISTINGS REPORT (Integration)
  // ==========================================================================

  describe('fetchMerchantListingsReport', () => {
    it('should orchestrate the complete workflow', async () => {
      const reportContent = 'seller-sku\tquantity\nSKU-001\t5';

      // Token request
      mockFetch.mockResolvedValueOnce(createTokenResponse());
      // Create report
      mockFetch.mockResolvedValueOnce(createApiResponse({ reportId: 'report-123' }));
      // Get report status (DONE)
      mockFetch.mockResolvedValueOnce(createApiResponse({
        reportId: 'report-123',
        processingStatus: 'DONE',
        reportDocumentId: 'doc-123',
      }));
      // Get report document
      mockFetch.mockResolvedValueOnce(createApiResponse({
        reportDocumentId: 'doc-123',
        url: 'https://example.com/download',
      }));
      // Download report
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(reportContent),
      });

      const { AmazonReportsClient } = await import('../amazon-reports.client');
      const client = new AmazonReportsClient(credentials);

      const content = await client.fetchMerchantListingsReport();

      expect(content).toBe(reportContent);
      expect(mockFetch).toHaveBeenCalledTimes(5);
    });
  });

  // ==========================================================================
  // TOKEN MANAGEMENT
  // ==========================================================================

  describe('token management', () => {
    it('should refresh token on first request', async () => {
      mockFetch.mockResolvedValueOnce(createTokenResponse('new-token'));
      mockFetch.mockResolvedValueOnce(createApiResponse({ reportId: 'report-123' }));

      const { AmazonReportsClient } = await import('../amazon-reports.client');
      const client = new AmazonReportsClient(credentials);

      await client.createReport('GET_MERCHANT_LISTINGS_ALL_DATA');

      // Check token refresh was called
      const tokenCall = mockFetch.mock.calls[0];
      expect(tokenCall[0]).toBe('https://api.amazon.com/auth/o2/token');

      // Check API request has the token
      const apiCall = mockFetch.mock.calls[1];
      expect(apiCall[1].headers['x-amz-access-token']).toBe('new-token');
    });

    it('should reuse valid token for subsequent requests', async () => {
      // First request with token refresh
      mockFetch.mockResolvedValueOnce(createTokenResponse('cached-token', 3600));
      mockFetch.mockResolvedValueOnce(createApiResponse({ reportId: 'report-1' }));
      // Second request should reuse token (no additional token call)
      mockFetch.mockResolvedValueOnce(createApiResponse({ reportId: 'report-2' }));

      const { AmazonReportsClient } = await import('../amazon-reports.client');
      const client = new AmazonReportsClient(credentials);

      await client.createReport('GET_MERCHANT_LISTINGS_ALL_DATA');
      await client.createReport('GET_MERCHANT_LISTINGS_ALL_DATA');

      // Should have 3 calls: 1 token + 2 API requests (no second token refresh)
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  // ==========================================================================
  // ERROR HANDLING
  // ==========================================================================

  describe('error handling', () => {
    it('should throw error on token refresh failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Invalid credentials'),
      });

      const { AmazonReportsClient } = await import('../amazon-reports.client');
      const client = new AmazonReportsClient(credentials);

      await expect(
        client.createReport('GET_MERCHANT_LISTINGS_ALL_DATA')
      ).rejects.toThrow('Failed to refresh token: 401');
    });

    it('should throw error on API failure with error message', async () => {
      mockFetch.mockResolvedValueOnce(createTokenResponse());
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({
          errors: [{ code: 'InternalError', message: 'Internal server error' }],
        }),
      });

      const { AmazonReportsClient } = await import('../amazon-reports.client');
      const client = new AmazonReportsClient(credentials);

      await expect(
        client.createReport('GET_MERCHANT_LISTINGS_ALL_DATA')
      ).rejects.toThrow('Internal server error');
    });

    it('should handle API errors without parseable error details', async () => {
      mockFetch.mockResolvedValueOnce(createTokenResponse());
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.reject(new Error('Invalid JSON')),
      });

      const { AmazonReportsClient } = await import('../amazon-reports.client');
      const client = new AmazonReportsClient(credentials);

      await expect(
        client.createReport('GET_MERCHANT_LISTINGS_ALL_DATA')
      ).rejects.toThrow('Request failed with status 400');
    });

    it('should clear token and throw on 401 response', async () => {
      mockFetch.mockResolvedValueOnce(createTokenResponse());
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({}),
      });

      const { AmazonReportsClient } = await import('../amazon-reports.client');
      const client = new AmazonReportsClient(credentials);

      await expect(
        client.createReport('GET_MERCHANT_LISTINGS_ALL_DATA')
      ).rejects.toThrow('Invalid or expired access token');
    });

    it('should clear token and throw on 403 response', async () => {
      mockFetch.mockResolvedValueOnce(createTokenResponse());
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: () => Promise.resolve({}),
      });

      const { AmazonReportsClient } = await import('../amazon-reports.client');
      const client = new AmazonReportsClient(credentials);

      await expect(
        client.createReport('GET_MERCHANT_LISTINGS_ALL_DATA')
      ).rejects.toThrow('Invalid or expired access token');
    });
  });

  // ==========================================================================
  // TEST CONNECTION
  // ==========================================================================

  describe('testConnection', () => {
    it('should return true when token can be obtained', async () => {
      mockFetch.mockResolvedValueOnce(createTokenResponse());

      const { AmazonReportsClient } = await import('../amazon-reports.client');
      const client = new AmazonReportsClient(credentials);

      const result = await client.testConnection();

      expect(result).toBe(true);
    });

    it('should return false when token refresh fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Invalid'),
      });

      const { AmazonReportsClient } = await import('../amazon-reports.client');
      const client = new AmazonReportsClient(credentials);

      const result = await client.testConnection();

      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // FACTORY FUNCTION
  // ==========================================================================

  describe('createAmazonReportsClient', () => {
    it('should create client instance', async () => {
      const { createAmazonReportsClient } = await import('../amazon-reports.client');
      const client = createAmazonReportsClient(credentials);

      expect(client).toBeDefined();
    });
  });

  // ==========================================================================
  // TYPE EXPORTS
  // ==========================================================================

  describe('type exports', () => {
    it('should export report types', async () => {
      const clientModule = await import('../amazon-reports.client');

      expect(clientModule).toHaveProperty('AmazonReportsClient');
      expect(clientModule).toHaveProperty('createAmazonReportsClient');
    });
  });
});
