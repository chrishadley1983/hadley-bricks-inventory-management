/**
 * Tests for /api/platform-stock API Routes
 *
 * Tests the platform stock operations:
 * - GET /api/platform-stock - Get platform listings
 * - GET /api/platform-stock/comparison - Get stock comparison
 * - POST /api/platform-stock/amazon/import - Trigger Amazon import
 * - GET /api/platform-stock/amazon/import - Get import history
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock the Supabase server client
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

// Mock the AmazonStockService - using a shared mock object
const mockServiceMethods = {
  getListings: vi.fn(),
  getLatestImport: vi.fn(),
  getStockComparison: vi.fn(),
  triggerImport: vi.fn(),
  getImportHistory: vi.fn(),
};

vi.mock('@/lib/platform-stock', () => ({
  AmazonStockService: function MockAmazonStockService() {
    return mockServiceMethods;
  },
}));

// Suppress console logs during tests
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

import { createClient } from '@/lib/supabase/server';
import { GET as GetListings } from '../platform-stock/route';
import { GET as GetComparison } from '../platform-stock/comparison/route';
import {
  POST as TriggerImport,
  GET as GetImportHistory,
} from '../platform-stock/amazon/import/route';

// Reference mock functions for easier usage
const mockGetListings = mockServiceMethods.getListings;
const mockGetLatestImport = mockServiceMethods.getLatestImport;
const mockGetStockComparison = mockServiceMethods.getStockComparison;
const mockTriggerImport = mockServiceMethods.triggerImport;
const mockGetImportHistoryFn = mockServiceMethods.getImportHistory;

// ============================================================================
// TEST HELPERS
// ============================================================================

function createMockListing(overrides: Record<string, unknown> = {}) {
  return {
    id: 'listing-001',
    userId: 'user-123',
    platform: 'amazon',
    platformSku: 'SKU-001',
    platformItemId: 'B08XYZ123',
    title: 'LEGO Millennium Falcon 75192',
    quantity: 5,
    price: 799.99,
    currency: 'GBP',
    listingStatus: 'Active',
    fulfillmentChannel: 'FBA',
    ...overrides,
  };
}

function createMockImport(overrides: Record<string, unknown> = {}) {
  return {
    id: 'import-001',
    userId: 'user-123',
    platform: 'amazon',
    importType: 'full',
    status: 'completed',
    totalRows: 100,
    processedRows: 100,
    errorCount: 0,
    startedAt: '2024-01-15T10:00:00Z',
    completedAt: '2024-01-15T10:05:00Z',
    createdAt: '2024-01-15T10:00:00Z',
    ...overrides,
  };
}

function createMockComparison(overrides: Record<string, unknown> = {}) {
  return {
    platformItemId: 'B08XYZ123',
    platformTitle: 'LEGO Millennium Falcon',
    platformQuantity: 5,
    platformListingStatus: 'Active',
    platformFulfillmentChannel: 'FBA',
    platformPrice: 799.99,
    inventoryQuantity: 3,
    inventoryTotalValue: 2400,
    inventoryItems: [],
    discrepancyType: 'quantity_mismatch',
    quantityDifference: 2,
    priceDifference: null,
    ...overrides,
  };
}

function createAuthenticatedClient() {
  // Build a mock that can handle the chained Supabase queries in the comparison route
  const mockChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: [], error: null }),
  };

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-123', email: 'test@example.com' } },
        error: null,
      }),
    },
    from: vi.fn().mockReturnValue(mockChain),
  };
}

function createUnauthenticatedClient() {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: null },
        error: { message: 'Not authenticated' },
      }),
    },
  };
}

// ============================================================================
// TESTS
// ============================================================================

describe('/api/platform-stock API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // GET /api/platform-stock
  // ==========================================================================

  describe('GET /api/platform-stock', () => {
    it('should return 401 when not authenticated', async () => {
      vi.mocked(createClient).mockResolvedValue(createUnauthenticatedClient() as never);

      const request = new NextRequest('http://localhost:3000/api/platform-stock');
      const response = await GetListings(request);

      expect(response.status).toBe(401);
    });

    it('should return listings with pagination', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockGetListings.mockResolvedValue({
        items: [createMockListing(), createMockListing({ id: 'listing-002' })],
        pagination: { page: 1, pageSize: 50, total: 2, totalPages: 1 },
      });
      mockGetLatestImport.mockResolvedValue(createMockImport());

      const request = new NextRequest('http://localhost:3000/api/platform-stock');
      const response = await GetListings(request);

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.data.listings).toHaveLength(2);
      expect(json.data.latestImport).toBeDefined();
    });

    it('should apply search filter', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockGetListings.mockResolvedValue({
        items: [],
        pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 },
      });
      mockGetLatestImport.mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/platform-stock?search=Millennium');
      await GetListings(request);

      expect(mockGetListings).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'Millennium' }),
        1,
        50
      );
    });

    it('should apply status filter', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockGetListings.mockResolvedValue({
        items: [],
        pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 },
      });
      mockGetLatestImport.mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/platform-stock?status=Active');
      await GetListings(request);

      expect(mockGetListings).toHaveBeenCalledWith(
        expect.objectContaining({ listingStatus: 'Active' }),
        1,
        50
      );
    });

    it('should apply channel filter', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockGetListings.mockResolvedValue({
        items: [],
        pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 },
      });
      mockGetLatestImport.mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/platform-stock?channel=FBA');
      await GetListings(request);

      expect(mockGetListings).toHaveBeenCalledWith(
        expect.objectContaining({ fulfillmentChannel: 'FBA' }),
        1,
        50
      );
    });

    it('should apply hasQuantity filter', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockGetListings.mockResolvedValue({
        items: [],
        pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 },
      });
      mockGetLatestImport.mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/platform-stock?hasQuantity=true');
      await GetListings(request);

      expect(mockGetListings).toHaveBeenCalledWith(
        expect.objectContaining({ hasQuantity: true }),
        1,
        50
      );
    });

    it('should apply pagination parameters', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockGetListings.mockResolvedValue({
        items: [],
        pagination: { page: 2, pageSize: 25, total: 50, totalPages: 2 },
      });
      mockGetLatestImport.mockResolvedValue(null);

      const request = new NextRequest(
        'http://localhost:3000/api/platform-stock?page=2&pageSize=25'
      );
      await GetListings(request);

      expect(mockGetListings).toHaveBeenCalledWith(expect.any(Object), 2, 25);
    });

    it('should cap pageSize at 100', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockGetListings.mockResolvedValue({
        items: [],
        pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
      });
      mockGetLatestImport.mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/platform-stock?pageSize=200');
      await GetListings(request);

      expect(mockGetListings).toHaveBeenCalledWith(expect.any(Object), 1, 100);
    });

    it('should return 400 for unsupported platform', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);

      const request = new NextRequest(
        'http://localhost:3000/api/platform-stock?platform=unsupported'
      );
      const response = await GetListings(request);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toContain('not yet supported');
    });

    it('should return 500 on service error', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockGetListings.mockRejectedValue(new Error('Database error'));

      const request = new NextRequest('http://localhost:3000/api/platform-stock');
      const response = await GetListings(request);

      expect(response.status).toBe(500);
    });
  });

  // ==========================================================================
  // GET /api/platform-stock/comparison
  // ==========================================================================

  describe('GET /api/platform-stock/comparison', () => {
    it('should return 401 when not authenticated', async () => {
      vi.mocked(createClient).mockResolvedValue(createUnauthenticatedClient() as never);

      const request = new NextRequest('http://localhost:3000/api/platform-stock/comparison');
      const response = await GetComparison(request);

      expect(response.status).toBe(401);
    });

    it('should return comparison data', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockGetStockComparison.mockResolvedValue({
        comparisons: [
          createMockComparison(),
          createMockComparison({ platformItemId: 'B09ABC456', discrepancyType: 'match' }),
        ],
        summary: {
          totalPlatformListings: 10,
          totalPlatformQuantity: 50,
          totalInventoryItems: 45,
          matchedItems: 8,
          platformOnlyItems: 1,
          inventoryOnlyItems: 1,
          quantityMismatches: 2,
          priceMismatches: 0,
          missingAsinItems: 0,
          lastImportAt: '2024-01-15T10:00:00Z',
        },
      });

      const request = new NextRequest('http://localhost:3000/api/platform-stock/comparison');
      const response = await GetComparison(request);

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.data.comparisons).toHaveLength(2);
      expect(json.data.summary.matchedItems).toBe(8);
    });

    it('should apply discrepancyType filter', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockGetStockComparison.mockResolvedValue({
        comparisons: [],
        summary: {},
      });

      const request = new NextRequest(
        'http://localhost:3000/api/platform-stock/comparison?discrepancyType=quantity_mismatch'
      );
      await GetComparison(request);

      expect(mockGetStockComparison).toHaveBeenCalledWith(
        expect.objectContaining({ discrepancyType: 'quantity_mismatch' })
      );
    });

    it('should apply search filter', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockGetStockComparison.mockResolvedValue({
        comparisons: [],
        summary: {},
      });

      const request = new NextRequest(
        'http://localhost:3000/api/platform-stock/comparison?search=Falcon'
      );
      await GetComparison(request);

      expect(mockGetStockComparison).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'Falcon' })
      );
    });

    it('should return 400 for unsupported platform', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);

      const request = new NextRequest(
        'http://localhost:3000/api/platform-stock/comparison?platform=ebay'
      );
      const response = await GetComparison(request);

      expect(response.status).toBe(400);
    });

    it('should return 500 on service error', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockGetStockComparison.mockRejectedValue(new Error('Database error'));

      const request = new NextRequest('http://localhost:3000/api/platform-stock/comparison');
      const response = await GetComparison(request);

      expect(response.status).toBe(500);
    });
  });

  // ==========================================================================
  // POST /api/platform-stock/amazon/import
  // ==========================================================================

  describe('POST /api/platform-stock/amazon/import', () => {
    it('should return 401 when not authenticated', async () => {
      vi.mocked(createClient).mockResolvedValue(createUnauthenticatedClient() as never);

      const request = new NextRequest('http://localhost:3000/api/platform-stock/amazon/import', {
        method: 'POST',
      });
      const response = await TriggerImport(request);

      expect(response.status).toBe(401);
    });

    it('should trigger import successfully', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockTriggerImport.mockResolvedValue(createMockImport());

      const request = new NextRequest('http://localhost:3000/api/platform-stock/amazon/import', {
        method: 'POST',
      });
      const response = await TriggerImport(request);

      expect(response.status).toBe(201);
      const json = await response.json();
      expect(json.data.import).toBeDefined();
      expect(json.data.message).toBe('Import completed successfully');
    });

    it('should return 400 for unconfigured credentials', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockTriggerImport.mockRejectedValue(
        new Error('Amazon credentials not configured for this user')
      );

      const request = new NextRequest('http://localhost:3000/api/platform-stock/amazon/import', {
        method: 'POST',
      });
      const response = await TriggerImport(request);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe('Amazon credentials not configured');
    });

    it('should return 401 for expired token', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockTriggerImport.mockRejectedValue(new Error('Failed to refresh token'));

      const request = new NextRequest('http://localhost:3000/api/platform-stock/amazon/import', {
        method: 'POST',
      });
      const response = await TriggerImport(request);

      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.error).toBe('Amazon authentication failed');
    });

    it('should return 500 on other errors', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockTriggerImport.mockRejectedValue(new Error('Unknown error'));

      const request = new NextRequest('http://localhost:3000/api/platform-stock/amazon/import', {
        method: 'POST',
      });
      const response = await TriggerImport(request);

      expect(response.status).toBe(500);
    });
  });

  // ==========================================================================
  // GET /api/platform-stock/amazon/import (History)
  // ==========================================================================

  describe('GET /api/platform-stock/amazon/import', () => {
    it('should return 401 when not authenticated', async () => {
      vi.mocked(createClient).mockResolvedValue(createUnauthenticatedClient() as never);

      const request = new NextRequest('http://localhost:3000/api/platform-stock/amazon/import');
      const response = await GetImportHistory(request);

      expect(response.status).toBe(401);
    });

    it('should return import history', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockGetImportHistoryFn.mockResolvedValue([
        createMockImport(),
        createMockImport({ id: 'import-002', status: 'failed' }),
      ]);

      const request = new NextRequest('http://localhost:3000/api/platform-stock/amazon/import');
      const response = await GetImportHistory(request);

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.data.imports).toHaveLength(2);
    });

    it('should apply limit parameter', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockGetImportHistoryFn.mockResolvedValue([]);

      const request = new NextRequest(
        'http://localhost:3000/api/platform-stock/amazon/import?limit=5'
      );
      await GetImportHistory(request);

      expect(mockGetImportHistoryFn).toHaveBeenCalledWith(5);
    });

    it('should cap limit at 50', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockGetImportHistoryFn.mockResolvedValue([]);

      const request = new NextRequest(
        'http://localhost:3000/api/platform-stock/amazon/import?limit=100'
      );
      await GetImportHistory(request);

      expect(mockGetImportHistoryFn).toHaveBeenCalledWith(50);
    });

    it('should return 500 on service error', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockGetImportHistoryFn.mockRejectedValue(new Error('Database error'));

      const request = new NextRequest('http://localhost:3000/api/platform-stock/amazon/import');
      const response = await GetImportHistory(request);

      expect(response.status).toBe(500);
    });
  });
});
