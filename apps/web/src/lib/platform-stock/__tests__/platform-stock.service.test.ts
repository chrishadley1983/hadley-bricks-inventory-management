/**
 * Tests for PlatformStockService (Abstract Base Class)
 *
 * Tests the common functionality provided by the base class:
 * - Import management (create, update, get status, history)
 * - Listing management (get, delete, batch insert)
 * - Pagination handling
 * - Database mapping
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { PlatformStockService } from '../platform-stock.service';
import type {
  StockPlatform,
  PlatformListing,
  ListingImport,
  StockComparison,
  ComparisonSummary,
  ComparisonFilters,
} from '../types';

// Suppress console logs during tests
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

// ============================================================================
// CONCRETE TEST IMPLEMENTATION
// ============================================================================

/**
 * Concrete implementation of PlatformStockService for testing
 * since the base class is abstract
 */
class TestPlatformStockService extends PlatformStockService {
  readonly platform: StockPlatform = 'amazon';

  // Mock implementations for abstract methods
  triggerImportMock = vi.fn();
  getStockComparisonMock = vi.fn();

  async triggerImport(): Promise<ListingImport> {
    return this.triggerImportMock();
  }

  async getStockComparison(filters: ComparisonFilters): Promise<{
    comparisons: StockComparison[];
    summary: ComparisonSummary;
  }> {
    return this.getStockComparisonMock(filters);
  }

  // Expose protected methods for testing
  public async testGetAllListings(): Promise<PlatformListing[]> {
    return this.getAllListings();
  }

  public async testDeleteOldListings(): Promise<void> {
    return this.deleteOldListings();
  }

  public async testCreateImportRecord(additionalData?: Record<string, unknown>): Promise<string> {
    return this.createImportRecord(additionalData);
  }

  public async testUpdateImportRecord(
    importId: string,
    update: Record<string, unknown>
  ): Promise<void> {
    return this.updateImportRecord(importId, update);
  }

  public async testInsertListingsBatch(
    importId: string,
    listings: Array<Record<string, unknown>>
  ): Promise<number> {
    return this.insertListingsBatch(importId, listings as never[]);
  }

  public testMapImportRow(row: Record<string, unknown>): ListingImport {
    return this.mapImportRow(row as never);
  }

  public testMapListingRow(row: Record<string, unknown>): PlatformListing {
    return this.mapListingRow(row as never);
  }
}

// ============================================================================
// TEST HELPERS
// ============================================================================

function createMockSupabase(): SupabaseClient<Database> {
  return {
    from: vi.fn(),
  } as unknown as SupabaseClient<Database>;
}

function createMockImportRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'import-001',
    user_id: 'user-123',
    platform: 'amazon',
    import_type: 'full',
    status: 'completed',
    total_rows: 100,
    processed_rows: 100,
    error_count: 0,
    amazon_report_id: null,
    amazon_report_document_id: null,
    amazon_report_type: null,
    started_at: '2024-01-15T10:00:00Z',
    completed_at: '2024-01-15T10:05:00Z',
    error_message: null,
    error_details: null,
    created_at: '2024-01-15T10:00:00Z',
    ...overrides,
  };
}

function createMockListingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'listing-001',
    user_id: 'user-123',
    platform: 'amazon',
    platform_sku: 'SKU-001',
    platform_item_id: 'ASIN123456',
    title: 'Test LEGO Set',
    quantity: 5,
    price: '99.99',
    currency: 'GBP',
    listing_status: 'Active',
    fulfillment_channel: 'FBA',
    import_id: 'import-001',
    raw_data: null,
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-01-15T10:00:00Z',
    ...overrides,
  };
}

function createChainedQuery(overrides: {
  data?: unknown;
  error?: { code?: string; message: string } | null;
  count?: number | null;
} = {}) {
  const { data = null, error = null, count = null } = overrides;

  const mockResult = { data, error, count };

  const chain: Record<string, ReturnType<typeof vi.fn>> = {};

  // Build chainable methods that all return the same chain
  const createChainMethod = () => vi.fn().mockReturnValue(chain);

  chain.select = vi.fn().mockReturnValue(chain);
  chain.insert = vi.fn().mockReturnValue(chain);
  chain.update = vi.fn().mockReturnValue(chain);
  chain.delete = createChainMethod();
  chain.eq = createChainMethod();
  chain.gt = createChainMethod();
  chain.or = createChainMethod();
  chain.order = createChainMethod();
  chain.limit = createChainMethod();
  chain.range = createChainMethod();
  chain.single = vi.fn().mockResolvedValue(mockResult);

  // Make final methods return the result
  chain.range = vi.fn().mockReturnValue({
    ...chain,
    order: vi.fn().mockResolvedValue(mockResult),
  });

  return chain;
}

// ============================================================================
// TESTS
// ============================================================================

describe('PlatformStockService', () => {
  const userId = 'user-123';
  let mockSupabase: SupabaseClient<Database>;
  let service: TestPlatformStockService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase = createMockSupabase();
    service = new TestPlatformStockService(mockSupabase, userId);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // CONSTRUCTOR
  // ==========================================================================

  describe('constructor', () => {
    it('should create instance with supabase client and userId', () => {
      expect(service).toBeDefined();
      expect(service.platform).toBe('amazon');
    });
  });

  // ==========================================================================
  // GET LATEST IMPORT
  // ==========================================================================

  describe('getLatestImport', () => {
    it('should return latest import when found', async () => {
      const mockImport = createMockImportRow();
      const chain = createChainedQuery({ data: mockImport });
      (mockSupabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      const result = await service.getLatestImport();

      expect(result).not.toBeNull();
      expect(result?.id).toBe('import-001');
      expect(result?.status).toBe('completed');
      expect(mockSupabase.from).toHaveBeenCalledWith('platform_listing_imports');
    });

    it('should return null when no import found (PGRST116)', async () => {
      const chain = createChainedQuery({
        data: null,
        error: { code: 'PGRST116', message: 'No rows found' },
      });
      (mockSupabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      const result = await service.getLatestImport();

      expect(result).toBeNull();
    });

    it('should return null on other errors', async () => {
      const chain = createChainedQuery({
        data: null,
        error: { code: '500', message: 'Database error' },
      });
      (mockSupabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      const result = await service.getLatestImport();

      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // GET IMPORT STATUS
  // ==========================================================================

  describe('getImportStatus', () => {
    it('should return import status by ID', async () => {
      const mockImport = createMockImportRow({ status: 'processing' });
      const chain = createChainedQuery({ data: mockImport });
      (mockSupabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      const result = await service.getImportStatus('import-001');

      expect(result).not.toBeNull();
      expect(result?.status).toBe('processing');
    });

    it('should return null when import not found', async () => {
      const chain = createChainedQuery({
        data: null,
        error: { code: 'PGRST116', message: 'No rows found' },
      });
      (mockSupabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      const result = await service.getImportStatus('nonexistent');

      expect(result).toBeNull();
    });

    it('should throw error on database failure', async () => {
      const chain = createChainedQuery({
        data: null,
        error: { code: '500', message: 'Database error' },
      });
      (mockSupabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      await expect(service.getImportStatus('import-001')).rejects.toThrow(
        'Failed to get import status: Database error'
      );
    });
  });

  // ==========================================================================
  // GET LISTINGS
  // ==========================================================================

  describe('getListings', () => {
    it('should return paginated listings', async () => {
      const mockListings = [
        createMockListingRow({ id: 'listing-001' }),
        createMockListingRow({ id: 'listing-002' }),
      ];

      const chain = createChainedQuery({ data: mockListings, count: 2 });
      // Override range to return proper structure for pagination
      chain.range = vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({ data: mockListings, error: null, count: 2 }),
      });
      (mockSupabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      const result = await service.getListings({}, 1, 50);

      expect(result.items).toHaveLength(2);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.total).toBe(2);
      expect(result.pagination.totalPages).toBe(1);
    });

    it('should filter by listing status', async () => {
      const chain = createChainedQuery({ data: [], count: 0 });
      chain.range = vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
      });
      (mockSupabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      await service.getListings({ listingStatus: 'Active' }, 1, 50);

      // Verify eq was called for filtering
      expect(chain.eq).toHaveBeenCalled();
    });

    it('should filter by fulfillment channel', async () => {
      const chain = createChainedQuery({ data: [], count: 0 });
      chain.range = vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
      });
      (mockSupabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      await service.getListings({ fulfillmentChannel: 'FBA' }, 1, 50);

      expect(chain.eq).toHaveBeenCalled();
    });

    it('should filter by hasQuantity', async () => {
      const chain = createChainedQuery({ data: [], count: 0 });
      chain.range = vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
      });
      (mockSupabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      await service.getListings({ hasQuantity: true }, 1, 50);

      expect(chain.gt).toHaveBeenCalledWith('quantity', 0);
    });

    it('should filter by search term', async () => {
      const chain = createChainedQuery({ data: [], count: 0 });
      chain.range = vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
      });
      (mockSupabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      await service.getListings({ search: 'LEGO' }, 1, 50);

      expect(chain.or).toHaveBeenCalled();
    });

    it('should throw error on database failure', async () => {
      const chain = createChainedQuery({ data: null, error: { message: 'Query failed' } });
      chain.range = vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({ data: null, error: { message: 'Query failed' } }),
      });
      (mockSupabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      await expect(service.getListings({}, 1, 50)).rejects.toThrow('Failed to fetch listings');
    });

    it('should calculate pagination correctly', async () => {
      const mockListings = Array.from({ length: 50 }, (_, i) =>
        createMockListingRow({ id: `listing-${i}` })
      );

      const chain = createChainedQuery({ data: mockListings, count: 150 });
      chain.range = vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({ data: mockListings, error: null, count: 150 }),
      });
      (mockSupabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      const result = await service.getListings({}, 2, 50);

      expect(result.pagination.page).toBe(2);
      expect(result.pagination.pageSize).toBe(50);
      expect(result.pagination.total).toBe(150);
      expect(result.pagination.totalPages).toBe(3);
    });
  });

  // ==========================================================================
  // GET ALL LISTINGS (Protected Method)
  // ==========================================================================

  describe('getAllListings', () => {
    it('should fetch all listings with pagination', async () => {
      const allListings = Array.from({ length: 50 }, (_, i) =>
        createMockListingRow({ id: `listing-${i}` })
      );

      // Simulate a single page (less than 1000 items = no more pages)
      const chain = createChainedQuery({ data: allListings });
      chain.range = vi.fn().mockResolvedValue({ data: allListings, error: null });
      (mockSupabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      const result = await service.testGetAllListings();

      expect(result).toHaveLength(50);
    });

    it('should handle multiple pages', async () => {
      // Create exactly 1000 items for first page
      const page1 = Array.from({ length: 1000 }, (_, i) =>
        createMockListingRow({ id: `listing-${i}` })
      );
      // Create 500 items for second page
      const page2 = Array.from({ length: 500 }, (_, i) =>
        createMockListingRow({ id: `listing-${1000 + i}` })
      );

      let callCount = 0;
      const chain = createChainedQuery({});
      chain.range = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ data: page1, error: null });
        }
        return Promise.resolve({ data: page2, error: null });
      });
      (mockSupabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      const result = await service.testGetAllListings();

      expect(result).toHaveLength(1500);
      expect(chain.range).toHaveBeenCalledTimes(2);
    });

    it('should throw error on database failure', async () => {
      const chain = createChainedQuery({});
      chain.range = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      });
      (mockSupabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      await expect(service.testGetAllListings()).rejects.toThrow('Failed to fetch listings');
    });
  });

  // ==========================================================================
  // GET IMPORT HISTORY
  // ==========================================================================

  describe('getImportHistory', () => {
    it('should return import history', async () => {
      const imports = [
        createMockImportRow({ id: 'import-001' }),
        createMockImportRow({ id: 'import-002' }),
      ];

      // Build a proper chain that resolves after limit
      const chain: Record<string, ReturnType<typeof vi.fn>> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.order = vi.fn().mockReturnValue(chain);
      chain.limit = vi.fn().mockResolvedValue({ data: imports, error: null });
      (mockSupabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      const result = await service.getImportHistory(10);

      expect(result).toHaveLength(2);
      expect(chain.limit).toHaveBeenCalledWith(10);
    });

    it('should throw error on database failure', async () => {
      const chain: Record<string, ReturnType<typeof vi.fn>> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.order = vi.fn().mockReturnValue(chain);
      chain.limit = vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } });
      (mockSupabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      await expect(service.getImportHistory()).rejects.toThrow('Failed to fetch import history');
    });
  });

  // ==========================================================================
  // DELETE OLD LISTINGS (Protected Method)
  // ==========================================================================

  describe('deleteOldListings', () => {
    it('should delete all listings for platform', async () => {
      const chain: Record<string, ReturnType<typeof vi.fn>> = {};
      chain.delete = vi.fn().mockReturnValue(chain);
      // First eq returns chain, second eq resolves
      chain.eq = vi.fn()
        .mockReturnValueOnce(chain) // First .eq('user_id', ...) returns chain
        .mockResolvedValueOnce({ error: null }); // Second .eq('platform', ...) resolves
      (mockSupabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      await service.testDeleteOldListings();

      expect(mockSupabase.from).toHaveBeenCalledWith('platform_listings');
      expect(chain.delete).toHaveBeenCalled();
    });

    it('should throw error on database failure', async () => {
      const chain: Record<string, ReturnType<typeof vi.fn>> = {};
      chain.delete = vi.fn().mockReturnValue(chain);
      // First eq returns chain, second eq resolves with error
      chain.eq = vi.fn()
        .mockReturnValueOnce(chain)
        .mockResolvedValueOnce({ error: { message: 'Delete failed' } });
      (mockSupabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      await expect(service.testDeleteOldListings()).rejects.toThrow(
        'Failed to delete old listings'
      );
    });
  });

  // ==========================================================================
  // CREATE IMPORT RECORD (Protected Method)
  // ==========================================================================

  describe('createImportRecord', () => {
    it('should create import record with default values', async () => {
      const chain: Record<string, ReturnType<typeof vi.fn>> = {};
      chain.insert = vi.fn().mockReturnValue(chain);
      chain.select = vi.fn().mockReturnValue(chain);
      chain.single = vi.fn().mockResolvedValue({ data: { id: 'new-import-001' }, error: null });
      (mockSupabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      const result = await service.testCreateImportRecord();

      expect(result).toBe('new-import-001');
      expect(chain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: userId,
          platform: 'amazon',
          import_type: 'full',
          status: 'processing',
        })
      );
    });

    it('should merge additional data', async () => {
      const chain: Record<string, ReturnType<typeof vi.fn>> = {};
      chain.insert = vi.fn().mockReturnValue(chain);
      chain.select = vi.fn().mockReturnValue(chain);
      chain.single = vi.fn().mockResolvedValue({ data: { id: 'new-import-001' }, error: null });
      (mockSupabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      await service.testCreateImportRecord({ amazon_report_id: 'report-123' });

      expect(chain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          amazon_report_id: 'report-123',
        })
      );
    });

    it('should throw error on database failure', async () => {
      const chain: Record<string, ReturnType<typeof vi.fn>> = {};
      chain.insert = vi.fn().mockReturnValue(chain);
      chain.select = vi.fn().mockReturnValue(chain);
      chain.single = vi.fn().mockResolvedValue({ data: null, error: { message: 'Insert failed' } });
      (mockSupabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      await expect(service.testCreateImportRecord()).rejects.toThrow(
        'Failed to create import record'
      );
    });
  });

  // ==========================================================================
  // UPDATE IMPORT RECORD (Protected Method)
  // ==========================================================================

  describe('updateImportRecord', () => {
    it('should update import record', async () => {
      const chain: Record<string, ReturnType<typeof vi.fn>> = {};
      chain.update = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockResolvedValue({ error: null });
      (mockSupabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      await service.testUpdateImportRecord('import-001', { status: 'completed' });

      expect(chain.update).toHaveBeenCalledWith({ status: 'completed' });
      expect(chain.eq).toHaveBeenCalledWith('id', 'import-001');
    });

    it('should throw error on database failure', async () => {
      const chain: Record<string, ReturnType<typeof vi.fn>> = {};
      chain.update = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockResolvedValue({ error: { message: 'Update failed' } });
      (mockSupabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      await expect(
        service.testUpdateImportRecord('import-001', { status: 'failed' })
      ).rejects.toThrow('Failed to update import record');
    });
  });

  // ==========================================================================
  // INSERT LISTINGS BATCH (Protected Method)
  // ==========================================================================

  describe('insertListingsBatch', () => {
    it('should insert listings in batches of 100', async () => {
      // Create 250 listings to test batching
      const listings = Array.from({ length: 250 }, (_, i) => ({
        user_id: userId,
        platform: 'amazon',
        platform_sku: `SKU-${i}`,
        title: `Item ${i}`,
      }));

      const insertChain: Record<string, ReturnType<typeof vi.fn>> = {};
      insertChain.insert = vi.fn().mockResolvedValue({ error: null });

      const updateChain: Record<string, ReturnType<typeof vi.fn>> = {};
      updateChain.update = vi.fn().mockReturnValue(updateChain);
      updateChain.eq = vi.fn().mockResolvedValue({ error: null });

      (mockSupabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
        if (table === 'platform_listings') return insertChain;
        if (table === 'platform_listing_imports') return updateChain;
        return {};
      });

      const result = await service.testInsertListingsBatch('import-001', listings);

      expect(result).toBe(250);
      // 250 items / 100 batch size = 3 batches
      expect(insertChain.insert).toHaveBeenCalledTimes(3);
    });

    it('should continue on batch error', async () => {
      const listings = Array.from({ length: 150 }, (_, i) => ({
        user_id: userId,
        platform: 'amazon',
        platform_sku: `SKU-${i}`,
      }));

      let callCount = 0;
      const insertChain: Record<string, ReturnType<typeof vi.fn>> = {};
      insertChain.insert = vi.fn().mockImplementation(() => {
        callCount++;
        // First batch fails, second succeeds
        if (callCount === 1) {
          return Promise.resolve({ error: { message: 'Batch insert failed' } });
        }
        return Promise.resolve({ error: null });
      });

      const updateChain: Record<string, ReturnType<typeof vi.fn>> = {};
      updateChain.update = vi.fn().mockReturnValue(updateChain);
      updateChain.eq = vi.fn().mockResolvedValue({ error: null });

      (mockSupabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
        if (table === 'platform_listings') return insertChain;
        if (table === 'platform_listing_imports') return updateChain;
        return {};
      });

      const result = await service.testInsertListingsBatch('import-001', listings);

      // First 100 failed, last 50 succeeded
      expect(result).toBe(50);
      expect(insertChain.insert).toHaveBeenCalledTimes(2);
    });

    it('should update progress after each batch', async () => {
      const listings = Array.from({ length: 50 }, (_, i) => ({
        user_id: userId,
        platform: 'amazon',
        platform_sku: `SKU-${i}`,
      }));

      const insertChain: Record<string, ReturnType<typeof vi.fn>> = {};
      insertChain.insert = vi.fn().mockResolvedValue({ error: null });

      const updateChain: Record<string, ReturnType<typeof vi.fn>> = {};
      updateChain.update = vi.fn().mockReturnValue(updateChain);
      updateChain.eq = vi.fn().mockResolvedValue({ error: null });

      (mockSupabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
        if (table === 'platform_listings') return insertChain;
        if (table === 'platform_listing_imports') return updateChain;
        return {};
      });

      await service.testInsertListingsBatch('import-001', listings);

      // Progress update called once for the single batch
      expect(updateChain.update).toHaveBeenCalledWith({ processed_rows: 50 });
    });
  });

  // ==========================================================================
  // MAPPING HELPERS
  // ==========================================================================

  describe('mapImportRow', () => {
    it('should map database row to ListingImport', () => {
      const row = createMockImportRow({
        amazon_report_id: 'report-123',
        amazon_report_document_id: 'doc-456',
        amazon_report_type: 'GET_MERCHANT_LISTINGS_ALL_DATA',
      });

      const result = service.testMapImportRow(row);

      expect(result.id).toBe('import-001');
      expect(result.userId).toBe('user-123');
      expect(result.platform).toBe('amazon');
      expect(result.importType).toBe('full');
      expect(result.status).toBe('completed');
      expect(result.totalRows).toBe(100);
      expect(result.processedRows).toBe(100);
      expect(result.errorCount).toBe(0);
      expect(result.amazonReportId).toBe('report-123');
      expect(result.amazonReportDocumentId).toBe('doc-456');
      expect(result.amazonReportType).toBe('GET_MERCHANT_LISTINGS_ALL_DATA');
    });

    it('should handle null optional fields', () => {
      const row = createMockImportRow({
        amazon_report_id: null,
        error_message: null,
        error_details: null,
      });

      const result = service.testMapImportRow(row);

      expect(result.amazonReportId).toBeNull();
      expect(result.errorMessage).toBeNull();
      expect(result.errorDetails).toBeNull();
    });
  });

  describe('mapListingRow', () => {
    it('should map database row to PlatformListing', () => {
      const row = createMockListingRow({
        raw_data: { extra: 'data' },
      });

      const result = service.testMapListingRow(row);

      expect(result.id).toBe('listing-001');
      expect(result.userId).toBe('user-123');
      expect(result.platform).toBe('amazon');
      expect(result.platformSku).toBe('SKU-001');
      expect(result.platformItemId).toBe('ASIN123456');
      expect(result.title).toBe('Test LEGO Set');
      expect(result.quantity).toBe(5);
      expect(result.price).toBe(99.99);
      expect(result.currency).toBe('GBP');
      expect(result.listingStatus).toBe('Active');
      expect(result.fulfillmentChannel).toBe('FBA');
      expect(result.rawData).toEqual({ extra: 'data' });
    });

    it('should handle null price', () => {
      const row = createMockListingRow({ price: null });

      const result = service.testMapListingRow(row);

      expect(result.price).toBeNull();
    });

    it('should default quantity to 0 if null', () => {
      const row = createMockListingRow({ quantity: null });

      const result = service.testMapListingRow(row);

      expect(result.quantity).toBe(0);
    });

    it('should default listing status to Unknown if missing', () => {
      const row = createMockListingRow({ listing_status: null });

      const result = service.testMapListingRow(row);

      expect(result.listingStatus).toBe('Unknown');
    });

    it('should convert price string to number', () => {
      const row = createMockListingRow({ price: '249.99' });

      const result = service.testMapListingRow(row);

      expect(result.price).toBe(249.99);
      expect(typeof result.price).toBe('number');
    });
  });

  // ==========================================================================
  // ABSTRACT METHODS (Verified through test implementation)
  // ==========================================================================

  describe('abstract methods', () => {
    it('should require platform property', () => {
      expect(service.platform).toBeDefined();
      expect(service.platform).toBe('amazon');
    });

    it('should require triggerImport method', async () => {
      const mockImport: ListingImport = {
        id: 'import-new',
        userId,
        platform: 'amazon',
        importType: 'full',
        status: 'processing',
        totalRows: null,
        processedRows: 0,
        errorCount: 0,
        amazonReportId: null,
        amazonReportDocumentId: null,
        amazonReportType: null,
        startedAt: new Date().toISOString(),
        completedAt: null,
        errorMessage: null,
        errorDetails: null,
        createdAt: new Date().toISOString(),
      };

      service.triggerImportMock.mockResolvedValue(mockImport);

      const result = await service.triggerImport();

      expect(result).toEqual(mockImport);
      expect(service.triggerImportMock).toHaveBeenCalled();
    });

    it('should require getStockComparison method', async () => {
      const mockResult = {
        comparisons: [],
        summary: {
          totalPlatformListings: 0,
          totalInventoryItems: 0,
          matched: 0,
          platformOnly: 0,
          inventoryOnly: 0,
          quantityMismatch: 0,
        },
      };

      service.getStockComparisonMock.mockResolvedValue(mockResult);

      const result = await service.getStockComparison({});

      expect(result).toEqual(mockResult);
      expect(service.getStockComparisonMock).toHaveBeenCalledWith({});
    });
  });
});
