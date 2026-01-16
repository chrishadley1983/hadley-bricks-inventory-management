import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MigrationService, createMigrationService } from '../migration-service';
import type { GoogleSheetsClient } from '@/lib/google/sheets-client';

// Mock supabase client
const mockFrom = vi.fn();
const mockSupabaseClient = {
  from: mockFrom,
};

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockSupabaseClient),
}));

// Mock sheet mappings
// NOTE: uniqueKeyColumn must match a sheetColumn value in the columns array
// because the migration service uses: mapping.columns.find((c) => c.sheetColumn === mapping.uniqueKeyColumn)
vi.mock('../sheet-mappings', () => ({
  newKitInventoryMapping: {
    sheetName: 'New Kit Inventory',
    supabaseTable: 'inventory_items',
    uniqueKeyColumn: 'A', // Must match sheetColumn, not supabaseColumn
    columns: [
      { sheetHeader: 'SKU', supabaseColumn: 'sku', sheetColumn: 'A' },
      { sheetHeader: 'Set Number', supabaseColumn: 'set_number', sheetColumn: 'B' },
    ],
  },
  usedKitInventoryMapping: {
    sheetName: 'Used Kit Inventory',
    supabaseTable: 'inventory_items',
    uniqueKeyColumn: 'A', // Must match sheetColumn, not supabaseColumn
    columns: [
      { sheetHeader: 'SKU', supabaseColumn: 'sku', sheetColumn: 'A' },
      { sheetHeader: 'Set Number', supabaseColumn: 'set_number', sheetColumn: 'B' },
    ],
  },
  purchasesMapping: {
    sheetName: 'Purchases',
    supabaseTable: 'purchases',
    uniqueKeyColumn: 'A', // Must match sheetColumn, not supabaseColumn
    columns: [
      { sheetHeader: 'ID', supabaseColumn: 'sheets_id', sheetColumn: 'A' },
      { sheetHeader: 'Date', supabaseColumn: 'purchase_date', sheetColumn: 'B' },
    ],
  },
  transformRow: vi.fn((row, _mapping) => ({
    sku: row['SKU'],
    set_number: row['Set Number'],
    sheets_id: row['ID'],
    purchase_date: row['Date'],
  })),
  addConditionFromSheet: vi.fn((data, sheetName) => ({
    ...data,
    condition: sheetName.includes('New') ? 'New' : 'Used',
  })),
}));

describe('MigrationService', () => {
  let service: MigrationService;
  let mockSheetsClient: GoogleSheetsClient;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSheetsClient = {
      readSheet: vi.fn(),
      writeSheet: vi.fn(),
      appendToSheet: vi.fn(),
      updateCell: vi.fn(),
      deleteRow: vi.fn(),
    } as unknown as GoogleSheetsClient;

    service = new MigrationService(
      mockSheetsClient,
      'https://test-supabase.co',
      'test-service-key'
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('migrateInventory', () => {
    it('should migrate both new and used kit sheets', async () => {
      // Mock sheet reads
      vi.mocked(mockSheetsClient.readSheet)
        .mockResolvedValueOnce([
          { SKU: 'NEW-001', 'Set Number': '75192' },
          { SKU: 'NEW-002', 'Set Number': '10294' },
        ])
        .mockResolvedValueOnce([
          { SKU: 'USED-001', 'Set Number': '75192' },
        ]);

      // Mock no existing records
      mockFrom.mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() => Promise.resolve({ data: null, error: null })),
        insert: vi.fn().mockReturnThis(),
      }));

      // Mock insert success
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() => Promise.resolve({ data: null, error: null })),
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(() =>
              Promise.resolve({ data: { id: 'new-id' }, error: null })
            ),
          })),
        })),
      });

      const result = await service.migrateInventory({
        userId: 'user-123',
        dryRun: true,
      });

      expect(result.sheets).toHaveLength(2);
      expect(result.sheets[0].sheetName).toBe('New Kit Inventory');
      expect(result.sheets[1].sheetName).toBe('Used Kit Inventory');
      expect(mockSheetsClient.readSheet).toHaveBeenCalledTimes(2);
    });

    it('should calculate totals correctly', async () => {
      vi.mocked(mockSheetsClient.readSheet)
        .mockResolvedValueOnce([
          { SKU: 'NEW-001', 'Set Number': '75192' },
        ])
        .mockResolvedValueOnce([
          { SKU: 'USED-001', 'Set Number': '75192' },
        ]);

      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() => Promise.resolve({ data: null, error: null })),
      });

      const result = await service.migrateInventory({
        userId: 'user-123',
        dryRun: true,
      });

      expect(result.totalSuccess).toBe(2);
      expect(result.totalErrors).toBe(0);
    });
  });

  describe('migratePurchases', () => {
    it('should migrate purchases sheet', async () => {
      vi.mocked(mockSheetsClient.readSheet).mockResolvedValueOnce([
        { ID: 'P001', Date: '2025-01-01' },
        { ID: 'P002', Date: '2025-01-02' },
      ]);

      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() => Promise.resolve({ data: null, error: null })),
      });

      const result = await service.migratePurchases({
        userId: 'user-123',
        dryRun: true,
      });

      expect(result.sheets).toHaveLength(1);
      expect(result.sheets[0].sheetName).toBe('Purchases');
      expect(result.totalSuccess).toBe(2);
    });
  });

  describe('migrateSheet', () => {
    it('should skip empty rows', async () => {
      vi.mocked(mockSheetsClient.readSheet).mockResolvedValueOnce([
        { SKU: '', 'Set Number': '' },
        { SKU: '  ', 'Set Number': '' },
      ]);

      const { newKitInventoryMapping } = await import('../sheet-mappings');

      const result = await service.migrateSheet(newKitInventoryMapping, {
        userId: 'user-123',
        dryRun: true,
      });

      expect(result.skippedCount).toBe(2);
      expect(result.successCount).toBe(0);
    });

    it('should apply limit option', async () => {
      vi.mocked(mockSheetsClient.readSheet).mockResolvedValueOnce([
        { SKU: 'SKU-001', 'Set Number': '75192' },
        { SKU: 'SKU-002', 'Set Number': '10294' },
        { SKU: 'SKU-003', 'Set Number': '42099' },
      ]);

      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() => Promise.resolve({ data: null, error: null })),
      });

      const { newKitInventoryMapping } = await import('../sheet-mappings');

      const result = await service.migrateSheet(newKitInventoryMapping, {
        userId: 'user-123',
        dryRun: true,
        limit: 2,
      });

      expect(result.totalRows).toBe(2);
    });

    it('should apply startFromRow option', async () => {
      vi.mocked(mockSheetsClient.readSheet).mockResolvedValueOnce([
        { SKU: 'SKU-001', 'Set Number': '75192' },
        { SKU: 'SKU-002', 'Set Number': '10294' },
        { SKU: 'SKU-003', 'Set Number': '42099' },
        { SKU: 'SKU-004', 'Set Number': '10298' },
      ]);

      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() => Promise.resolve({ data: null, error: null })),
      });

      const { newKitInventoryMapping } = await import('../sheet-mappings');

      const result = await service.migrateSheet(newKitInventoryMapping, {
        userId: 'user-123',
        dryRun: true,
        startFromRow: 3,
      });

      // Should skip first row (row 2 in sheet, row 0 in array after header)
      expect(result.totalRows).toBe(3);
      expect(result.rows[0].rowNumber).toBe(3);
    });

    it('should create new record when none exists', async () => {
      vi.mocked(mockSheetsClient.readSheet).mockResolvedValueOnce([
        { SKU: 'NEW-SKU', 'Set Number': '75192' },
      ]);

      // First call - check existing (not found)
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() => Promise.resolve({ data: null, error: null })),
      });

      // Second call - insert
      mockFrom.mockReturnValueOnce({
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(() =>
              Promise.resolve({ data: { id: 'created-id' }, error: null })
            ),
          })),
        })),
      });

      const { newKitInventoryMapping } = await import('../sheet-mappings');

      const result = await service.migrateSheet(newKitInventoryMapping, {
        userId: 'user-123',
        dryRun: false,
      });

      expect(result.successCount).toBe(1);
      expect(result.rows[0].action).toBe('created');
      expect(result.rows[0].supabaseId).toBe('created-id');
    });

    it('should update existing record when updateExisting is true', async () => {
      vi.mocked(mockSheetsClient.readSheet).mockResolvedValueOnce([
        { SKU: 'EXISTING-SKU', 'Set Number': '75192' },
      ]);

      // First call - check existing (found)
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({ data: { id: 'existing-id' }, error: null })
        ),
      });

      // Second call - update
      mockFrom.mockReturnValueOnce({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn(() => Promise.resolve({ error: null })),
      });

      const { newKitInventoryMapping } = await import('../sheet-mappings');

      const result = await service.migrateSheet(newKitInventoryMapping, {
        userId: 'user-123',
        dryRun: false,
        updateExisting: true,
      });

      expect(result.successCount).toBe(1);
      expect(result.rows[0].action).toBe('updated');
    });

    it('should skip existing record when updateExisting is false', async () => {
      vi.mocked(mockSheetsClient.readSheet).mockResolvedValueOnce([
        { SKU: 'EXISTING-SKU', 'Set Number': '75192' },
      ]);

      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({ data: { id: 'existing-id' }, error: null })
        ),
      });

      const { newKitInventoryMapping } = await import('../sheet-mappings');

      const result = await service.migrateSheet(newKitInventoryMapping, {
        userId: 'user-123',
        dryRun: false,
        updateExisting: false,
      });

      expect(result.skippedCount).toBe(1);
      expect(result.rows[0].action).toBe('skipped');
    });

    it('should handle errors gracefully', async () => {
      vi.mocked(mockSheetsClient.readSheet).mockResolvedValueOnce([
        { SKU: 'ERROR-SKU', 'Set Number': '75192' },
      ]);

      // Check existing - not found
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() => Promise.resolve({ data: null, error: null })),
      });

      // Insert fails
      mockFrom.mockReturnValueOnce({
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(() =>
              Promise.resolve({
                data: null,
                error: { message: 'Database constraint violation' },
              })
            ),
          })),
        })),
      });

      const { newKitInventoryMapping } = await import('../sheet-mappings');

      const result = await service.migrateSheet(newKitInventoryMapping, {
        userId: 'user-123',
        dryRun: false,
      });

      expect(result.errorCount).toBe(1);
      expect(result.rows[0].success).toBe(false);
      expect(result.rows[0].error).toBeDefined();
    });

    it('should handle Error instance in catch block', async () => {
      vi.mocked(mockSheetsClient.readSheet).mockResolvedValueOnce([
        { SKU: 'ERROR-SKU', 'Set Number': '75192' },
      ]);

      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() => {
          throw new Error('Network error');
        }),
      });

      const { newKitInventoryMapping } = await import('../sheet-mappings');

      const result = await service.migrateSheet(newKitInventoryMapping, {
        userId: 'user-123',
        dryRun: false,
      });

      expect(result.errorCount).toBe(1);
      expect(result.rows[0].error).toBe('Network error');
    });

    it('should handle unknown error types in catch block', async () => {
      vi.mocked(mockSheetsClient.readSheet).mockResolvedValueOnce([
        { SKU: 'ERROR-SKU', 'Set Number': '75192' },
      ]);

      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw 'String error';
        }),
      });

      const { newKitInventoryMapping } = await import('../sheet-mappings');

      const result = await service.migrateSheet(newKitInventoryMapping, {
        userId: 'user-123',
        dryRun: false,
      });

      expect(result.errorCount).toBe(1);
      expect(result.rows[0].error).toBe('Unknown error');
    });

    it('should report dry run actions correctly', async () => {
      vi.mocked(mockSheetsClient.readSheet).mockResolvedValueOnce([
        { SKU: 'NEW-SKU', 'Set Number': '75192' },
        { SKU: 'EXISTING-SKU', 'Set Number': '10294' },
      ]);

      // First - check existing (not found)
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() => Promise.resolve({ data: null, error: null })),
      });

      // Second - check existing (found)
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({ data: { id: 'existing-id' }, error: null })
        ),
      });

      const { newKitInventoryMapping } = await import('../sheet-mappings');

      const result = await service.migrateSheet(newKitInventoryMapping, {
        userId: 'user-123',
        dryRun: true,
        updateExisting: false,
      });

      expect(result.successCount).toBe(1);
      expect(result.skippedCount).toBe(1);
      expect(result.rows[0].action).toBe('created');
      expect(result.rows[1].action).toBe('skipped');
    });

    it('should handle update errors', async () => {
      vi.mocked(mockSheetsClient.readSheet).mockResolvedValueOnce([
        { SKU: 'EXISTING-SKU', 'Set Number': '75192' },
      ]);

      // Check existing - found
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({ data: { id: 'existing-id' }, error: null })
        ),
      });

      // Update fails
      mockFrom.mockReturnValueOnce({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn(() =>
          Promise.resolve({ error: { message: 'Update failed' } })
        ),
      });

      const { newKitInventoryMapping } = await import('../sheet-mappings');

      const result = await service.migrateSheet(newKitInventoryMapping, {
        userId: 'user-123',
        dryRun: false,
        updateExisting: true,
      });

      expect(result.errorCount).toBe(1);
      expect(result.rows[0].success).toBe(false);
    });
  });

  describe('getMigrationStats', () => {
    it('should return migration statistics', async () => {
      // Helper to create a chainable mock that resolves to count
      const createCountChain = (count: number) => {
        const chain = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          then: (resolve: (v: { count: number }) => void) => resolve({ count }),
        };
        return chain;
      };

      mockFrom
        .mockReturnValueOnce(createCountChain(100)) // inventory total
        .mockReturnValueOnce(createCountChain(60)) // inventory new
        .mockReturnValueOnce(createCountChain(40)) // inventory used
        .mockReturnValueOnce(createCountChain(25)); // purchases total

      const stats = await service.getMigrationStats('user-123');

      expect(stats.inventory.total).toBe(100);
      expect(stats.inventory.new).toBe(60);
      expect(stats.inventory.used).toBe(40);
      expect(stats.purchases.total).toBe(25);
    });

    it('should return zero counts when no data', async () => {
      // Helper to create a chainable mock that resolves to null count
      const createNullCountChain = () => {
        const chain = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          then: (resolve: (v: { count: null }) => void) => resolve({ count: null }),
        };
        return chain;
      };

      mockFrom.mockReturnValue(createNullCountChain());

      const stats = await service.getMigrationStats('user-123');

      expect(stats.inventory.total).toBe(0);
      expect(stats.inventory.new).toBe(0);
      expect(stats.inventory.used).toBe(0);
      expect(stats.purchases.total).toBe(0);
    });
  });

  describe('createMigrationService', () => {
    it('should throw error when Supabase URL is missing', () => {
      const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';

      expect(() => createMigrationService(mockSheetsClient)).toThrow(
        'Missing Supabase configuration'
      );

      process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
      process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    });

    it('should throw error when service key is missing', () => {
      const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;

      expect(() => createMigrationService(mockSheetsClient)).toThrow(
        'Missing Supabase configuration'
      );

      process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
      process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    });

    it('should create service when config is present', () => {
      const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

      const svc = createMigrationService(mockSheetsClient);
      expect(svc).toBeInstanceOf(MigrationService);

      process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
      process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    });
  });
});
