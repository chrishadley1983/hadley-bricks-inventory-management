/**
 * Tests for Platform Stock Types
 *
 * Since TypeScript types are compile-time only and don't exist at runtime,
 * these tests verify:
 * 1. Type exports are available and can be imported
 * 2. Objects can be created that satisfy the type contracts
 * 3. Type literals have expected values
 *
 * These tests serve as documentation and regression tests for the type API.
 */

import { describe, it, expect } from 'vitest';
import type {
  StockPlatform,
  ListingStatus,
  ImportStatus,
  ImportType,
  DiscrepancyType,
  PlatformListing,
  AmazonListing,
  EbayListing,
  BrickLinkListing,
  ListingImport,
  TriggerImportResponse,
  StockComparison,
  InventoryItemSummary,
  ComparisonSummary,
  ListingFilters,
  ComparisonFilters,
  PaginationParams,
  PaginatedResponse,
  PlatformStockListingsResponse,
  PlatformStockComparisonResponse,
  PlatformListingRow,
  PlatformListingImportRow,
} from '../types';

// ============================================================================
// TEST HELPERS - Factory Functions
// ============================================================================

function createPlatformListing(overrides: Partial<PlatformListing> = {}): PlatformListing {
  return {
    id: 'listing-001',
    userId: 'user-123',
    platform: 'amazon',
    platformSku: 'SKU-001',
    platformItemId: 'B0123456789',
    title: 'Test LEGO Set',
    quantity: 5,
    price: 99.99,
    currency: 'GBP',
    listingStatus: 'Active',
    fulfillmentChannel: 'FBA',
    importId: 'import-001',
    rawData: null,
    createdAt: '2024-01-15T10:00:00Z',
    updatedAt: '2024-01-15T10:00:00Z',
    ...overrides,
  };
}

function createAmazonListing(overrides: Partial<AmazonListing> = {}): AmazonListing {
  return {
    ...createPlatformListing(),
    platform: 'amazon',
    asin: 'B0123456789',
    amazonData: {
      fnsku: 'X001234567',
      productType: 'TOYS_AND_GAMES',
      productIdType: 'ASIN',
      itemCondition: 'New',
      itemNote: null,
      itemDescription: 'LEGO Set',
      openDate: '2024-01-01',
      willShipInternationally: true,
      expeditedShipping: false,
      pendingQuantity: 0,
      merchantShippingGroup: 'Standard',
      listingId: 'listing-abc',
    },
    ...overrides,
  } as AmazonListing;
}

function createListingImport(overrides: Partial<ListingImport> = {}): ListingImport {
  return {
    id: 'import-001',
    userId: 'user-123',
    platform: 'amazon',
    importType: 'full',
    status: 'completed',
    totalRows: 100,
    processedRows: 100,
    errorCount: 0,
    amazonReportId: 'report-123',
    amazonReportDocumentId: 'doc-456',
    amazonReportType: 'GET_MERCHANT_LISTINGS_ALL_DATA',
    startedAt: '2024-01-15T10:00:00Z',
    completedAt: '2024-01-15T10:05:00Z',
    errorMessage: null,
    errorDetails: null,
    createdAt: '2024-01-15T10:00:00Z',
    ...overrides,
  };
}

function createStockComparison(overrides: Partial<StockComparison> = {}): StockComparison {
  return {
    platformItemId: 'B0123456789',
    platformTitle: 'Test LEGO Set',
    platformQuantity: 5,
    platformListingStatus: 'Active',
    platformFulfillmentChannel: 'FBA',
    platformPrice: 99.99,
    platformSku: 'SKU-001',
    inventoryQuantity: 5,
    inventoryTotalValue: 499.95,
    inventoryItems: [],
    discrepancyType: 'match',
    quantityDifference: 0,
    priceDifference: null,
    ...overrides,
  };
}

function createComparisonSummary(overrides: Partial<ComparisonSummary> = {}): ComparisonSummary {
  return {
    totalPlatformListings: 100,
    totalPlatformQuantity: 250,
    totalInventoryItems: 100,
    matchedItems: 80,
    platformOnlyItems: 10,
    inventoryOnlyItems: 10,
    quantityMismatches: 5,
    priceMismatches: 2,
    missingAsinItems: 3,
    lastImportAt: '2024-01-15T10:00:00Z',
    ...overrides,
  };
}

// ============================================================================
// TESTS
// ============================================================================

describe('Platform Stock Types', () => {
  // ==========================================================================
  // PLATFORM TYPES
  // ==========================================================================

  describe('StockPlatform', () => {
    it('should support amazon platform', () => {
      const platform: StockPlatform = 'amazon';
      expect(platform).toBe('amazon');
    });

    it('should support ebay platform', () => {
      const platform: StockPlatform = 'ebay';
      expect(platform).toBe('ebay');
    });

    it('should support bricklink platform', () => {
      const platform: StockPlatform = 'bricklink';
      expect(platform).toBe('bricklink');
    });
  });

  describe('ListingStatus', () => {
    it('should support all listing statuses', () => {
      const statuses: ListingStatus[] = [
        'Active',
        'Inactive',
        'Incomplete',
        'Out of Stock',
        'Unknown',
      ];
      expect(statuses).toHaveLength(5);
      expect(statuses).toContain('Active');
      expect(statuses).toContain('Inactive');
      expect(statuses).toContain('Unknown');
    });
  });

  describe('ImportStatus', () => {
    it('should support all import statuses', () => {
      const statuses: ImportStatus[] = ['pending', 'processing', 'completed', 'failed'];
      expect(statuses).toHaveLength(4);
    });
  });

  describe('ImportType', () => {
    it('should support full and incremental import types', () => {
      const types: ImportType[] = ['full', 'incremental'];
      expect(types).toHaveLength(2);
    });
  });

  describe('DiscrepancyType', () => {
    it('should support all discrepancy types', () => {
      const types: DiscrepancyType[] = [
        'match',
        'platform_only',
        'inventory_only',
        'quantity_mismatch',
        'price_mismatch',
        'missing_asin',
      ];
      expect(types).toHaveLength(6);
    });
  });

  // ==========================================================================
  // LISTING INTERFACES
  // ==========================================================================

  describe('PlatformListing', () => {
    it('should create valid platform listing', () => {
      const listing = createPlatformListing();

      expect(listing.id).toBe('listing-001');
      expect(listing.platform).toBe('amazon');
      expect(listing.quantity).toBe(5);
    });

    it('should allow null optional fields', () => {
      const listing = createPlatformListing({
        platformSku: null,
        title: null,
        price: null,
        currency: null,
        fulfillmentChannel: null,
        rawData: null,
      });

      expect(listing.platformSku).toBeNull();
      expect(listing.title).toBeNull();
      expect(listing.price).toBeNull();
    });
  });

  describe('AmazonListing', () => {
    it('should create valid Amazon listing with extended data', () => {
      const listing = createAmazonListing();

      expect(listing.platform).toBe('amazon');
      expect(listing.asin).toBe('B0123456789');
      expect(listing.amazonData.fnsku).toBe('X001234567');
      expect(listing.amazonData.productType).toBe('TOYS_AND_GAMES');
    });

    it('should allow null amazonData fields', () => {
      const listing = createAmazonListing({
        amazonData: {
          fnsku: null,
          productType: null,
          productIdType: null,
          itemCondition: null,
          itemNote: null,
          itemDescription: null,
          openDate: null,
          willShipInternationally: null,
          expeditedShipping: null,
          pendingQuantity: null,
          merchantShippingGroup: null,
          listingId: null,
        },
      });

      expect(listing.amazonData.fnsku).toBeNull();
    });
  });

  describe('EbayListing', () => {
    it('should create valid eBay listing structure', () => {
      const listing: EbayListing = {
        ...createPlatformListing({ platform: 'ebay' }),
        platform: 'ebay',
        ebayData: {
          listingType: 'FixedPriceItem',
          format: 'FixedPrice',
          categoryId: '19006',
          storeCategory: 'LEGO Sets',
        },
      };

      expect(listing.platform).toBe('ebay');
      expect(listing.ebayData.listingType).toBe('FixedPriceItem');
    });
  });

  describe('BrickLinkListing', () => {
    it('should create valid BrickLink listing structure', () => {
      const listing: BrickLinkListing = {
        ...createPlatformListing({ platform: 'bricklink' }),
        platform: 'bricklink',
        bricklinkData: {
          lotId: 'lot-123',
          colorId: '1',
          colorName: 'White',
          categoryId: '65',
          categoryName: 'Sets',
        },
      };

      expect(listing.platform).toBe('bricklink');
      expect(listing.bricklinkData.lotId).toBe('lot-123');
    });
  });

  // ==========================================================================
  // IMPORT INTERFACES
  // ==========================================================================

  describe('ListingImport', () => {
    it('should create valid listing import', () => {
      const importRecord = createListingImport();

      expect(importRecord.id).toBe('import-001');
      expect(importRecord.status).toBe('completed');
      expect(importRecord.totalRows).toBe(100);
    });

    it('should handle processing status', () => {
      const importRecord = createListingImport({
        status: 'processing',
        processedRows: 50,
        completedAt: null,
      });

      expect(importRecord.status).toBe('processing');
      expect(importRecord.processedRows).toBe(50);
      expect(importRecord.completedAt).toBeNull();
    });

    it('should handle failed status with error', () => {
      const importRecord = createListingImport({
        status: 'failed',
        errorCount: 10,
        errorMessage: 'API rate limit exceeded',
        errorDetails: { retryAfter: 60 },
      });

      expect(importRecord.status).toBe('failed');
      expect(importRecord.errorMessage).toBe('API rate limit exceeded');
    });
  });

  describe('TriggerImportResponse', () => {
    it('should create valid trigger response', () => {
      const response: TriggerImportResponse = {
        import: createListingImport({ status: 'processing' }),
        message: 'Import started successfully',
      };

      expect(response.import.status).toBe('processing');
      expect(response.message).toBe('Import started successfully');
    });
  });

  // ==========================================================================
  // COMPARISON INTERFACES
  // ==========================================================================

  describe('StockComparison', () => {
    it('should create match comparison', () => {
      const comparison = createStockComparison({ discrepancyType: 'match' });

      expect(comparison.discrepancyType).toBe('match');
      expect(comparison.quantityDifference).toBe(0);
    });

    it('should create quantity mismatch comparison', () => {
      const comparison = createStockComparison({
        discrepancyType: 'quantity_mismatch',
        platformQuantity: 5,
        inventoryQuantity: 3,
        quantityDifference: 2,
      });

      expect(comparison.discrepancyType).toBe('quantity_mismatch');
      expect(comparison.quantityDifference).toBe(2);
    });

    it('should create platform_only comparison', () => {
      const comparison = createStockComparison({
        discrepancyType: 'platform_only',
        inventoryQuantity: 0,
        inventoryItems: [],
        quantityDifference: 5,
      });

      expect(comparison.discrepancyType).toBe('platform_only');
      expect(comparison.inventoryQuantity).toBe(0);
    });

    it('should create inventory_only comparison', () => {
      const comparison = createStockComparison({
        discrepancyType: 'inventory_only',
        platformQuantity: 0,
        quantityDifference: -3,
      });

      expect(comparison.discrepancyType).toBe('inventory_only');
      expect(comparison.platformQuantity).toBe(0);
    });

    it('should include inventory item summaries', () => {
      const inventoryItems: InventoryItemSummary[] = [
        {
          id: 'inv-001',
          setNumber: '75192',
          itemName: 'Millennium Falcon',
          condition: 'New',
          listingValue: 699.99,
          storageLocation: 'Shelf A1',
          sku: 'MF-75192-001',
          status: 'LISTED',
          createdAt: '2024-01-01T00:00:00Z',
        },
      ];

      const comparison = createStockComparison({ inventoryItems });

      expect(comparison.inventoryItems).toHaveLength(1);
      expect(comparison.inventoryItems[0].setNumber).toBe('75192');
    });
  });

  describe('ComparisonSummary', () => {
    it('should create valid comparison summary', () => {
      const summary = createComparisonSummary();

      expect(summary.totalPlatformListings).toBe(100);
      expect(summary.matchedItems).toBe(80);
      expect(summary.quantityMismatches).toBe(5);
    });

    it('should calculate discrepancy counts', () => {
      const summary = createComparisonSummary({
        totalPlatformListings: 50,
        matchedItems: 40,
        platformOnlyItems: 5,
        inventoryOnlyItems: 5,
      });

      // Total discrepancies = platformOnly + inventoryOnly = 10
      const discrepancies = summary.platformOnlyItems + summary.inventoryOnlyItems;
      expect(discrepancies).toBe(10);
    });
  });

  // ==========================================================================
  // FILTER INTERFACES
  // ==========================================================================

  describe('ListingFilters', () => {
    it('should create empty filters', () => {
      const filters: ListingFilters = {};

      expect(filters.search).toBeUndefined();
      expect(filters.listingStatus).toBeUndefined();
    });

    it('should create filters with all options', () => {
      const filters: ListingFilters = {
        search: 'LEGO',
        listingStatus: 'Active',
        fulfillmentChannel: 'FBA',
        hasQuantity: true,
      };

      expect(filters.search).toBe('LEGO');
      expect(filters.listingStatus).toBe('Active');
      expect(filters.hasQuantity).toBe(true);
    });

    it('should support "all" value for listingStatus', () => {
      const filters: ListingFilters = {
        listingStatus: 'all',
      };

      expect(filters.listingStatus).toBe('all');
    });
  });

  describe('ComparisonFilters', () => {
    it('should create comparison filters', () => {
      const filters: ComparisonFilters = {
        discrepancyType: 'quantity_mismatch',
        search: 'Star Wars',
        hideZeroQuantities: true,
      };

      expect(filters.discrepancyType).toBe('quantity_mismatch');
      expect(filters.hideZeroQuantities).toBe(true);
    });

    it('should support "all" value for discrepancyType', () => {
      const filters: ComparisonFilters = {
        discrepancyType: 'all',
      };

      expect(filters.discrepancyType).toBe('all');
    });
  });

  // ==========================================================================
  // PAGINATION INTERFACES
  // ==========================================================================

  describe('PaginationParams', () => {
    it('should create pagination params', () => {
      const params: PaginationParams = {
        page: 1,
        pageSize: 50,
      };

      expect(params.page).toBe(1);
      expect(params.pageSize).toBe(50);
    });
  });

  describe('PaginatedResponse', () => {
    it('should create paginated response with listings', () => {
      const response: PaginatedResponse<PlatformListing> = {
        items: [createPlatformListing()],
        pagination: {
          page: 1,
          pageSize: 50,
          total: 1,
          totalPages: 1,
        },
      };

      expect(response.items).toHaveLength(1);
      expect(response.pagination.total).toBe(1);
    });

    it('should calculate total pages correctly', () => {
      const response: PaginatedResponse<PlatformListing> = {
        items: [],
        pagination: {
          page: 1,
          pageSize: 50,
          total: 125,
          totalPages: 3, // ceil(125/50) = 3
        },
      };

      expect(response.pagination.totalPages).toBe(3);
    });
  });

  // ==========================================================================
  // API RESPONSE INTERFACES
  // ==========================================================================

  describe('PlatformStockListingsResponse', () => {
    it('should create valid listings response', () => {
      const response: PlatformStockListingsResponse = {
        listings: [createPlatformListing()],
        latestImport: createListingImport(),
        pagination: {
          page: 1,
          pageSize: 50,
          total: 1,
          totalPages: 1,
        },
      };

      expect(response.listings).toHaveLength(1);
      expect(response.latestImport).not.toBeNull();
    });

    it('should allow null latestImport', () => {
      const response: PlatformStockListingsResponse = {
        listings: [],
        latestImport: null,
        pagination: {
          page: 1,
          pageSize: 50,
          total: 0,
          totalPages: 0,
        },
      };

      expect(response.latestImport).toBeNull();
    });
  });

  describe('PlatformStockComparisonResponse', () => {
    it('should create valid comparison response', () => {
      const response: PlatformStockComparisonResponse = {
        comparisons: [createStockComparison()],
        summary: createComparisonSummary(),
      };

      expect(response.comparisons).toHaveLength(1);
      expect(response.summary.totalPlatformListings).toBe(100);
    });
  });

  // ==========================================================================
  // DATABASE ROW TYPES
  // ==========================================================================

  describe('PlatformListingRow', () => {
    it('should match database schema', () => {
      const row: PlatformListingRow = {
        id: 'uuid-001',
        user_id: 'user-123',
        platform: 'amazon',
        platform_sku: 'SKU-001',
        platform_item_id: 'B0123456789',
        title: 'Test Item',
        quantity: 5,
        price: 99.99,
        currency: 'GBP',
        listing_status: 'Active',
        fulfillment_channel: 'FBA',
        amazon_data: { fnsku: 'X001' },
        ebay_data: null,
        bricklink_data: null,
        import_id: 'import-001',
        raw_data: {},
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:00:00Z',
      };

      // Verify snake_case field names match database schema
      expect(row.user_id).toBeDefined();
      expect(row.platform_sku).toBeDefined();
      expect(row.platform_item_id).toBeDefined();
      expect(row.listing_status).toBeDefined();
      expect(row.fulfillment_channel).toBeDefined();
      expect(row.amazon_data).toBeDefined();
      expect(row.import_id).toBeDefined();
      expect(row.raw_data).toBeDefined();
      expect(row.created_at).toBeDefined();
      expect(row.updated_at).toBeDefined();
    });
  });

  describe('PlatformListingImportRow', () => {
    it('should match database schema', () => {
      const row: PlatformListingImportRow = {
        id: 'uuid-001',
        user_id: 'user-123',
        platform: 'amazon',
        import_type: 'full',
        status: 'completed',
        total_rows: 100,
        processed_rows: 100,
        error_count: 0,
        amazon_report_id: 'report-123',
        amazon_report_document_id: 'doc-456',
        amazon_report_type: 'GET_MERCHANT_LISTINGS_ALL_DATA',
        started_at: '2024-01-15T10:00:00Z',
        completed_at: '2024-01-15T10:05:00Z',
        error_message: null,
        error_details: null,
        created_at: '2024-01-15T10:00:00Z',
      };

      // Verify snake_case field names match database schema
      expect(row.user_id).toBeDefined();
      expect(row.import_type).toBeDefined();
      expect(row.total_rows).toBeDefined();
      expect(row.processed_rows).toBeDefined();
      expect(row.error_count).toBeDefined();
      expect(row.amazon_report_id).toBeDefined();
      expect(row.amazon_report_document_id).toBeDefined();
      expect(row.amazon_report_type).toBeDefined();
      expect(row.started_at).toBeDefined();
      expect(row.completed_at).toBeDefined();
      expect(row.error_message).toBeDefined();
      expect(row.error_details).toBeDefined();
      expect(row.created_at).toBeDefined();
    });
  });
});
