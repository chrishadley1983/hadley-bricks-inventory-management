/**
 * Tests for EbayStockService
 *
 * Tests the eBay-specific stock service including:
 * - Import workflow via Trading API
 * - SKU validation (empty and duplicate SKUs)
 * - Stock comparison with condition mismatch tracking
 * - Error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';

// Mock EbayTradingClient
const mockGetAllActiveListings = vi.fn();
vi.mock('../ebay-trading.client', () => {
  return {
    EbayTradingClient: class MockEbayTradingClient {
      getAllActiveListings = mockGetAllActiveListings;
    },
    EbayTradingApiError: class EbayTradingApiError extends Error {
      constructor(
        message: string,
        public errorCode?: string
      ) {
        super(message);
        this.name = 'EbayTradingApiError';
      }
    },
  };
});

// Mock EbayAuthService
const mockGetAccessToken = vi.fn();
vi.mock('@/lib/ebay/ebay-auth.service', () => {
  return {
    EbayAuthService: class MockEbayAuthService {
      getAccessToken = mockGetAccessToken;
    },
  };
});

// Suppress console logs during tests
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

// ============================================================================
// TEST HELPERS
// ============================================================================

function createMockSupabase() {
  const mockSupabase = {
    from: vi.fn(),
  } as unknown as SupabaseClient<Database>;

  return mockSupabase;
}

function createMockPlatformListing(overrides: Partial<{
  id: string;
  user_id: string;
  platform_sku: string | null;
  platform_item_id: string | null;
  title: string | null;
  quantity: number | null;
  price: number | null;
  listing_status: string | null;
  ebay_data: Record<string, unknown> | null;
  created_at: string;
}> = {}) {
  return {
    id: overrides.id ?? 'listing-001',
    user_id: overrides.user_id ?? 'user-123',
    platform_sku: overrides.platform_sku !== undefined ? overrides.platform_sku : 'TEST-SKU-001',
    platform_item_id: overrides.platform_item_id ?? '123456789012',
    title: overrides.title ?? 'LEGO Star Wars Set',
    quantity: overrides.quantity ?? 1,
    price: overrides.price ?? 649.99,
    listing_status: overrides.listing_status ?? 'Active',
    ebay_data: overrides.ebay_data ?? { condition: 'New' },
    created_at: overrides.created_at ?? '2024-01-01T00:00:00Z',
  };
}

function createMockInventoryItem(overrides: Partial<{
  id: string;
  sku: string | null;
  set_number: string;
  item_name: string | null;
  condition: string | null;
  listing_value: number | null;
  storage_location: string | null;
  status: string | null;
  created_at: string;
}> = {}) {
  return {
    id: overrides.id ?? 'inv-001',
    sku: overrides.sku !== undefined ? overrides.sku : 'TEST-SKU-001',
    set_number: overrides.set_number ?? '75192',
    item_name: overrides.item_name ?? 'Millennium Falcon',
    condition: overrides.condition ?? 'New',
    listing_value: overrides.listing_value ?? 649.99,
    storage_location: overrides.storage_location ?? 'A1',
    status: overrides.status ?? 'LISTED',
    created_at: overrides.created_at ?? '2024-01-01T00:00:00Z',
  };
}

// ============================================================================
// TESTS
// ============================================================================

describe('EbayStockService', () => {
  const userId = 'user-123';
  let mockSupabase: SupabaseClient<Database>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase = createMockSupabase();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // CONSTRUCTOR
  // ==========================================================================

  describe('constructor', () => {
    it('should create instance with platform set to ebay', async () => {
      const { EbayStockService } = await import('../ebay-stock.service');
      const service = new EbayStockService(mockSupabase, userId);

      expect(service).toBeDefined();
      expect(service.platform).toBe('ebay');
    });
  });

  // ==========================================================================
  // TRIGGER IMPORT
  // ==========================================================================

  describe('triggerImport', () => {
    it('should throw error when eBay not connected', async () => {
      mockGetAccessToken.mockResolvedValueOnce(null);

      const { EbayStockService } = await import('../ebay-stock.service');
      const service = new EbayStockService(mockSupabase, userId);

      await expect(service.triggerImport()).rejects.toThrow(
        'eBay not connected. Please connect your eBay account first.'
      );
    });

    it('should handle API error during import', async () => {
      mockGetAccessToken.mockResolvedValueOnce('test-access-token');

      // Import the error class and throw it
      const { EbayTradingApiError } = await import('../ebay-trading.client');
      mockGetAllActiveListings.mockRejectedValueOnce(
        new EbayTradingApiError('API rate limit exceeded', '932')
      );

      // Setup Supabase mocks for import record creation
      const importId = 'import-123';
      mockSupabase.from = vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: importId },
              error: null,
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }),
      });

      const { EbayStockService } = await import('../ebay-stock.service');
      const service = new EbayStockService(mockSupabase, userId);

      await expect(service.triggerImport()).rejects.toThrow('API rate limit exceeded');
    });
  });

  // ==========================================================================
  // SKU VALIDATION
  // ==========================================================================

  describe('validateSkus', () => {
    it('should return no issues when all SKUs are valid', async () => {
      const mockListings = [
        createMockPlatformListing({ platform_sku: 'SKU-001' }),
        createMockPlatformListing({ platform_sku: 'SKU-002', id: 'listing-002' }),
      ];

      mockSupabase.from = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: mockListings,
              error: null,
            }),
          }),
        }),
      });

      const { EbayStockService } = await import('../ebay-stock.service');
      const service = new EbayStockService(mockSupabase, userId);

      const result = await service.validateSkus();

      expect(result.hasIssues).toBe(false);
      expect(result.emptySkuCount).toBe(0);
      expect(result.duplicateSkuCount).toBe(0);
      expect(result.totalIssueCount).toBe(0);
    });

    it('should detect empty SKUs', async () => {
      // Create listings with empty SKUs explicitly using null and empty string
      const mockListings = [
        createMockPlatformListing({ platform_sku: 'SKU-001', id: 'listing-001' }),
        { ...createMockPlatformListing({ id: 'listing-002' }), platform_sku: null },
        { ...createMockPlatformListing({ id: 'listing-003' }), platform_sku: '' },
      ];

      mockSupabase.from = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: mockListings,
              error: null,
            }),
          }),
        }),
      });

      const { EbayStockService } = await import('../ebay-stock.service');
      const service = new EbayStockService(mockSupabase, userId);

      const result = await service.validateSkus();

      expect(result.hasIssues).toBe(true);
      expect(result.emptySkuCount).toBe(2);
      expect(result.issues.filter(i => i.issueType === 'empty')).toHaveLength(2);
    });

    it('should detect duplicate SKUs', async () => {
      const mockListings = [
        createMockPlatformListing({ platform_sku: 'SKU-001', id: 'listing-001' }),
        createMockPlatformListing({ platform_sku: 'SKU-001', id: 'listing-002' }),
        createMockPlatformListing({ platform_sku: 'SKU-002', id: 'listing-003' }),
      ];

      mockSupabase.from = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: mockListings,
              error: null,
            }),
          }),
        }),
      });

      const { EbayStockService } = await import('../ebay-stock.service');
      const service = new EbayStockService(mockSupabase, userId);

      const result = await service.validateSkus();

      expect(result.hasIssues).toBe(true);
      expect(result.duplicateSkuCount).toBe(1); // One unique SKU has duplicates
      expect(result.issues.filter(i => i.issueType === 'duplicate')).toHaveLength(2);
    });

    it('should handle database error gracefully', async () => {
      mockSupabase.from = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Database error' },
            }),
          }),
        }),
      });

      const { EbayStockService } = await import('../ebay-stock.service');
      const service = new EbayStockService(mockSupabase, userId);

      const result = await service.validateSkus();

      // Should return empty result on error, not throw
      expect(result.hasIssues).toBe(false);
      expect(result.emptySkuCount).toBe(0);
      expect(result.duplicateSkuCount).toBe(0);
    });

    it('should include viewItemUrl for issues with eBay data', async () => {
      const mockListings = [
        {
          ...createMockPlatformListing({ id: 'listing-001' }),
          platform_sku: null,
          ebay_data: { viewItemUrl: 'https://www.ebay.co.uk/itm/123' },
        },
      ];

      mockSupabase.from = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: mockListings,
              error: null,
            }),
          }),
        }),
      });

      const { EbayStockService } = await import('../ebay-stock.service');
      const service = new EbayStockService(mockSupabase, userId);

      const result = await service.validateSkus();

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].viewItemUrl).toBe('https://www.ebay.co.uk/itm/123');
    });
  });

  // ==========================================================================
  // GET SKU ISSUES
  // ==========================================================================

  describe('getSkuIssues', () => {
    it('should delegate to validateSkus', async () => {
      const mockListings = [
        createMockPlatformListing({ platform_sku: 'SKU-001' }),
      ];

      mockSupabase.from = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: mockListings,
              error: null,
            }),
          }),
        }),
      });

      const { EbayStockService } = await import('../ebay-stock.service');
      const service = new EbayStockService(mockSupabase, userId);

      const result = await service.getSkuIssues();

      expect(result.hasIssues).toBe(false);
    });
  });

  // ==========================================================================
  // STOCK COMPARISON
  // ==========================================================================

  describe('getStockComparison', () => {
    /**
     * Helper to create mock Supabase for stock comparison tests
     */
    function setupStockComparisonMocks(
      mockSupabase: SupabaseClient<Database>,
      options: {
        platformListings?: Array<{
          platform_sku: string | null;
          title: string;
          quantity: number;
          price: number;
          listing_status: string;
          platform_item_id: string;
          raw_data: Record<string, unknown>;
        }>;
        inventoryItems?: Array<ReturnType<typeof createMockInventoryItem>>;
        skuMappings?: Array<{ ebay_sku: string; inventory_item_id: string }>;
        latestImport?: { id: string; completed_at: string } | null;
      } = {}
    ) {
      const {
        platformListings = [],
        inventoryItems = [],
        skuMappings = [],
        latestImport = { id: 'import-123', completed_at: '2024-01-01T00:00:00Z' },
      } = options;

      (mockSupabase as unknown as { from: ReturnType<typeof vi.fn> }).from = vi.fn((table: string) => {
        if (table === 'platform_listings') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  range: vi.fn().mockResolvedValue({
                    data: platformListings.map(l => ({
                      platform_sku: l.platform_sku,
                      title: l.title,
                      quantity: l.quantity,
                      price: l.price,
                      listing_status: l.listing_status,
                      platform_item_id: l.platform_item_id,
                      raw_data: l.raw_data,
                    })),
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'inventory_items') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  ilike: vi.fn().mockReturnValue({
                    not: vi.fn().mockResolvedValue({
                      data: inventoryItems,
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'ebay_sku_mappings') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: skuMappings,
                error: null,
              }),
            }),
          };
        }
        if (table === 'platform_listing_imports') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                      single: vi.fn().mockResolvedValue({
                        data: latestImport,
                        error: latestImport ? null : { code: 'PGRST116', message: 'No rows found' },
                      }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      });
    }

    it('should return match when quantities equal', async () => {
      setupStockComparisonMocks(mockSupabase, {
        platformListings: [
          {
            platform_sku: 'SKU-001',
            title: 'Test Listing',
            quantity: 1,
            price: 99.99,
            listing_status: 'Active',
            platform_item_id: '123456',
            raw_data: { condition: 'New' },
          },
        ],
        inventoryItems: [
          createMockInventoryItem({ sku: 'SKU-001', condition: 'New' }),
        ],
      });

      const { EbayStockService } = await import('../ebay-stock.service');
      const service = new EbayStockService(mockSupabase, userId);

      const result = await service.getStockComparison({});

      expect(result.comparisons).toHaveLength(1);
      expect(result.comparisons[0].discrepancyType).toBe('match');
      expect(result.comparisons[0].platformQuantity).toBe(1);
      expect(result.comparisons[0].inventoryQuantity).toBe(1);
    });

    it('should detect platform_only items', async () => {
      setupStockComparisonMocks(mockSupabase, {
        platformListings: [
          {
            platform_sku: 'SKU-EBAY-ONLY',
            title: 'eBay Only Item',
            quantity: 5,
            price: 49.99,
            listing_status: 'Active',
            platform_item_id: '999888777',
            raw_data: { condition: 'New' },
          },
        ],
        inventoryItems: [],
      });

      const { EbayStockService } = await import('../ebay-stock.service');
      const service = new EbayStockService(mockSupabase, userId);

      const result = await service.getStockComparison({});

      expect(result.comparisons).toHaveLength(1);
      expect(result.comparisons[0].discrepancyType).toBe('platform_only');
      expect(result.comparisons[0].platformQuantity).toBe(5);
      expect(result.comparisons[0].inventoryQuantity).toBe(0);
    });

    it('should detect inventory_only items', async () => {
      setupStockComparisonMocks(mockSupabase, {
        platformListings: [],
        inventoryItems: [
          createMockInventoryItem({ sku: 'SKU-INV-ONLY' }),
        ],
      });

      const { EbayStockService } = await import('../ebay-stock.service');
      const service = new EbayStockService(mockSupabase, userId);

      const result = await service.getStockComparison({});

      expect(result.comparisons).toHaveLength(1);
      expect(result.comparisons[0].discrepancyType).toBe('inventory_only');
    });

    it('should detect quantity_mismatch', async () => {
      setupStockComparisonMocks(mockSupabase, {
        platformListings: [
          {
            platform_sku: 'SKU-001',
            title: 'Test Item',
            quantity: 3,
            price: 99.99,
            listing_status: 'Active',
            platform_item_id: '123456',
            raw_data: { condition: 'New' },
          },
        ],
        inventoryItems: [
          createMockInventoryItem({ sku: 'SKU-001', id: 'inv-1' }),
          createMockInventoryItem({ sku: 'SKU-001', id: 'inv-2' }),
        ],
      });

      const { EbayStockService } = await import('../ebay-stock.service');
      const service = new EbayStockService(mockSupabase, userId);

      const result = await service.getStockComparison({});

      expect(result.comparisons).toHaveLength(1);
      expect(result.comparisons[0].discrepancyType).toBe('quantity_mismatch');
      expect(result.comparisons[0].platformQuantity).toBe(3);
      expect(result.comparisons[0].inventoryQuantity).toBe(2);
      expect(result.comparisons[0].quantityDifference).toBe(1);
    });

    it('should detect condition mismatch between New and Used', async () => {
      setupStockComparisonMocks(mockSupabase, {
        platformListings: [
          {
            platform_sku: 'SKU-001',
            title: 'Test Item',
            quantity: 1,
            price: 99.99,
            listing_status: 'Active',
            platform_item_id: '123456',
            raw_data: { condition: 'New' },
          },
        ],
        inventoryItems: [
          createMockInventoryItem({ sku: 'SKU-001', condition: 'Used' }),
        ],
      });

      const { EbayStockService } = await import('../ebay-stock.service');
      const service = new EbayStockService(mockSupabase, userId);

      const result = await service.getStockComparison({});

      expect(result.comparisons).toHaveLength(1);
      expect(result.comparisons[0].conditionMismatch).toBe(true);
      expect(result.comparisons[0].ebayCondition).toBe('New');
      expect(result.comparisons[0].inventoryCondition).toBe('Used');
    });

    it('should skip listings with empty SKUs', async () => {
      setupStockComparisonMocks(mockSupabase, {
        platformListings: [
          {
            platform_sku: null,
            title: 'No SKU Item',
            quantity: 1,
            price: 99.99,
            listing_status: 'Active',
            platform_item_id: '123456',
            raw_data: {},
          },
          {
            platform_sku: 'SKU-001',
            title: 'Valid SKU Item',
            quantity: 1,
            price: 49.99,
            listing_status: 'Active',
            platform_item_id: '654321',
            raw_data: {},
          },
        ],
        inventoryItems: [],
      });

      const { EbayStockService } = await import('../ebay-stock.service');
      const service = new EbayStockService(mockSupabase, userId);

      const result = await service.getStockComparison({});

      // Only the listing with valid SKU should be in comparisons
      expect(result.comparisons).toHaveLength(1);
      expect(result.comparisons[0].platformSku).toBe('SKU-001');
    });

    it('should apply discrepancy type filter', async () => {
      setupStockComparisonMocks(mockSupabase, {
        platformListings: [
          {
            platform_sku: 'SKU-001',
            title: 'Match Item',
            quantity: 1,
            price: 99.99,
            listing_status: 'Active',
            platform_item_id: '123',
            raw_data: {},
          },
          {
            platform_sku: 'SKU-002',
            title: 'Platform Only',
            quantity: 2,
            price: 49.99,
            listing_status: 'Active',
            platform_item_id: '456',
            raw_data: {},
          },
        ],
        inventoryItems: [
          createMockInventoryItem({ sku: 'SKU-001' }),
        ],
      });

      const { EbayStockService } = await import('../ebay-stock.service');
      const service = new EbayStockService(mockSupabase, userId);

      const result = await service.getStockComparison({
        discrepancyType: 'platform_only',
      });

      expect(result.comparisons).toHaveLength(1);
      expect(result.comparisons[0].discrepancyType).toBe('platform_only');
    });

    it('should apply search filter', async () => {
      setupStockComparisonMocks(mockSupabase, {
        platformListings: [
          {
            platform_sku: 'SKU-FALCON',
            title: 'Millennium Falcon',
            quantity: 1,
            price: 649.99,
            listing_status: 'Active',
            platform_item_id: '123',
            raw_data: {},
          },
          {
            platform_sku: 'SKU-DESTROYER',
            title: 'Star Destroyer',
            quantity: 1,
            price: 499.99,
            listing_status: 'Active',
            platform_item_id: '456',
            raw_data: {},
          },
        ],
        inventoryItems: [],
      });

      const { EbayStockService } = await import('../ebay-stock.service');
      const service = new EbayStockService(mockSupabase, userId);

      const result = await service.getStockComparison({
        search: 'falcon',
      });

      expect(result.comparisons).toHaveLength(1);
      expect(result.comparisons[0].platformTitle).toBe('Millennium Falcon');
    });

    it('should calculate summary correctly', async () => {
      setupStockComparisonMocks(mockSupabase, {
        platformListings: [
          {
            platform_sku: 'SKU-001',
            title: 'Match Item',
            quantity: 1,
            price: 99.99,
            listing_status: 'Active',
            platform_item_id: '123',
            raw_data: {},
          },
          {
            platform_sku: 'SKU-002',
            title: 'Platform Only',
            quantity: 2,
            price: 49.99,
            listing_status: 'Active',
            platform_item_id: '456',
            raw_data: {},
          },
        ],
        inventoryItems: [
          createMockInventoryItem({ sku: 'SKU-001' }),
          createMockInventoryItem({ sku: 'SKU-003', id: 'inv-2' }),
        ],
        latestImport: { id: 'import-123', completed_at: '2024-01-01T00:00:00Z' },
      });

      const { EbayStockService } = await import('../ebay-stock.service');
      const service = new EbayStockService(mockSupabase, userId);

      const result = await service.getStockComparison({});

      expect(result.summary.totalPlatformListings).toBe(2);
      expect(result.summary.totalPlatformQuantity).toBe(3);
      expect(result.summary.totalInventoryItems).toBe(2);
      expect(result.summary.matchedItems).toBe(1);
      expect(result.summary.platformOnlyItems).toBe(1);
      expect(result.summary.inventoryOnlyItems).toBe(1);
      expect(result.summary.missingAsinItems).toBe(0); // Not applicable to eBay
    });

    it('should throw error when inventory fetch fails', async () => {
      (mockSupabase as unknown as { from: ReturnType<typeof vi.fn> }).from = vi.fn((table: string) => {
        if (table === 'platform_listings') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  range: vi.fn().mockResolvedValue({
                    data: [],
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'inventory_items') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  ilike: vi.fn().mockReturnValue({
                    not: vi.fn().mockResolvedValue({
                      data: null,
                      error: { message: 'Database connection failed' },
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'ebay_sku_mappings') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [],
                error: null,
              }),
            }),
          };
        }
        return {};
      });

      const { EbayStockService } = await import('../ebay-stock.service');
      const service = new EbayStockService(mockSupabase, userId);

      await expect(service.getStockComparison({})).rejects.toThrow(
        'Failed to fetch inventory: Database connection failed'
      );
    });

    it('should include eBay-specific fields in comparison', async () => {
      setupStockComparisonMocks(mockSupabase, {
        platformListings: [
          {
            platform_sku: 'SKU-001',
            title: 'Test Item',
            quantity: 1,
            price: 99.99,
            listing_status: 'Active',
            platform_item_id: '123456789012',
            raw_data: {
              condition: 'New',
              listingType: 'FixedPriceItem',
              viewItemUrl: 'https://www.ebay.co.uk/itm/123456789012',
            },
          },
        ],
        inventoryItems: [],
      });

      const { EbayStockService } = await import('../ebay-stock.service');
      const service = new EbayStockService(mockSupabase, userId);

      const result = await service.getStockComparison({});

      expect(result.comparisons).toHaveLength(1);
      expect(result.comparisons[0].ebayCondition).toBe('New');
      expect(result.comparisons[0].listingType).toBe('FixedPriceItem');
      expect(result.comparisons[0].ebayItemId).toBe('123456789012');
      expect(result.comparisons[0].viewItemUrl).toBe('https://www.ebay.co.uk/itm/123456789012');
    });

    it('should sum quantities for duplicate SKUs', async () => {
      setupStockComparisonMocks(mockSupabase, {
        platformListings: [
          {
            platform_sku: 'SKU-DUP',
            title: 'Duplicate SKU Item 1',
            quantity: 2,
            price: 99.99,
            listing_status: 'Active',
            platform_item_id: '111',
            raw_data: {},
          },
          {
            platform_sku: 'SKU-DUP',
            title: 'Duplicate SKU Item 2',
            quantity: 3,
            price: 99.99,
            listing_status: 'Active',
            platform_item_id: '222',
            raw_data: {},
          },
        ],
        inventoryItems: [],
      });

      const { EbayStockService } = await import('../ebay-stock.service');
      const service = new EbayStockService(mockSupabase, userId);

      const result = await service.getStockComparison({});

      // Should combine into single comparison with summed quantity
      expect(result.comparisons).toHaveLength(1);
      expect(result.comparisons[0].platformQuantity).toBe(5); // 2 + 3
    });
  });

  // ==========================================================================
  // TYPE EXPORTS
  // ==========================================================================

  describe('type exports', () => {
    it('should export EbayStockService class', async () => {
      const serviceModule = await import('../ebay-stock.service');
      expect(serviceModule.EbayStockService).toBeDefined();
    });
  });
});
