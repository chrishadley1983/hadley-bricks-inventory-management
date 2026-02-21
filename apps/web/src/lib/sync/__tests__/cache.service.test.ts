import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CacheService, getCacheService, resetCacheService } from '../cache.service';

// Mock the sheets client
const mockSheetsClient = {
  readSheet: vi.fn(),
};

// Mock the sheet mappings
vi.mock('@/lib/migration/sheet-mappings', () => ({
  transformRow: vi.fn((row) => ({
    sku: row['ID'],
    set_number: row['Set Number'],
    item_name: row['Name'],
  })),
  addConditionFromSheet: vi.fn((data, sheetName) => ({
    ...data,
    condition: sheetName.includes('New') ? 'New' : 'Used',
  })),
  newKitInventoryMapping: { sheetName: 'Lego New Kit Inventory' },
  usedKitInventoryMapping: { sheetName: 'Lego Used Kit Inventory' },
  purchasesMapping: { sheetName: 'Purchases' },
}));

describe('CacheService', () => {
  let service: CacheService;
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>;
  };
  const userId = 'test-user-id';

  beforeEach(() => {
    vi.clearAllMocks();
    resetCacheService();

    mockSupabase = {
      from: vi.fn(),
    };

    service = new CacheService(
      mockSupabase as never,
      mockSheetsClient as never,
      userId,
      { ttlMs: 5 * 60 * 1000 } // 5 minutes
    );
  });

  describe('isCacheStale', () => {
    it('should return true when no cache metadata exists', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      });

      const result = await service.isCacheStale('inventory_items');

      expect(result).toBe(true);
    });

    it('should return true when cache is older than TTL', async () => {
      const oldDate = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                last_sync: oldDate.toISOString(),
                sync_status: 'success',
              },
              error: null,
            }),
          }),
        }),
      });

      const result = await service.isCacheStale('inventory_items');

      expect(result).toBe(true);
    });

    it('should return false when cache is fresh', async () => {
      const recentDate = new Date(Date.now() - 1 * 60 * 1000); // 1 minute ago
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                last_sync: recentDate.toISOString(),
                sync_status: 'success',
              },
              error: null,
            }),
          }),
        }),
      });

      const result = await service.isCacheStale('inventory_items');

      expect(result).toBe(false);
    });
  });

  describe('getSyncStatus', () => {
    it('should return stale status when no metadata', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      });

      const result = await service.getSyncStatus('inventory_items');

      expect(result.status).toBe('stale');
      expect(result.lastSync).toBeNull();
      expect(result.recordCount).toBe(0);
    });

    it('should return synced status when cache is fresh', async () => {
      const recentDate = new Date(Date.now() - 1 * 60 * 1000);
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                last_sync: recentDate.toISOString(),
                sync_status: 'success',
                record_count: 50,
              },
              error: null,
            }),
          }),
        }),
      });

      const result = await service.getSyncStatus('inventory_items');

      expect(result.status).toBe('synced');
      expect(result.recordCount).toBe(50);
    });

    it('should return error status when sync failed', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                last_sync: new Date().toISOString(),
                sync_status: 'error',
                error_message: 'API failure',
                record_count: 0,
              },
              error: null,
            }),
          }),
        }),
      });

      const result = await service.getSyncStatus('inventory_items');

      expect(result.status).toBe('error');
      expect(result.errorMessage).toBe('API failure');
    });
  });

  describe('syncInventory', () => {
    it('should sync inventory from sheets to Supabase', async () => {
      const mockNewKitData = [
        { ID: 'HB-NEW-001', 'Set Number': '75192', Name: 'Millennium Falcon' },
        { ID: 'HB-NEW-002', 'Set Number': '10294', Name: 'Titanic' },
      ];
      const mockUsedKitData = [{ ID: 'HB-USED-001', 'Set Number': '76139', Name: 'Batmobile' }];

      mockSheetsClient.readSheet
        .mockResolvedValueOnce(mockNewKitData)
        .mockResolvedValueOnce(mockUsedKitData);

      const deleteQuery = { eq: vi.fn().mockResolvedValue({ error: null }) };
      const insertQuery = { error: null };

      let inventorySelectCallCount = 0;
      mockSupabase.from.mockImplementation((table) => {
        if (table === 'cache_metadata') {
          return {
            upsert: vi.fn().mockResolvedValue({ error: null }),
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          };
        }
        if (table === 'inventory_items') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                count: inventorySelectCallCount++ === 0 ? 0 : 0, // First call: existing count, second: after delete
              }),
            }),
            delete: vi.fn().mockReturnValue(deleteQuery),
            insert: vi.fn().mockResolvedValue(insertQuery),
          };
        }
        return {};
      });

      const result = await service.syncInventory();

      expect(result.success).toBe(true);
      expect(result.count).toBe(3);
      expect(mockSheetsClient.readSheet).toHaveBeenCalledWith('Lego New Kit Inventory');
      expect(mockSheetsClient.readSheet).toHaveBeenCalledWith('Lego Used Kit Inventory');
    });

    it('should handle sync errors', async () => {
      mockSheetsClient.readSheet.mockRejectedValue(new Error('Sheets API error'));

      mockSupabase.from.mockReturnValue({
        upsert: vi.fn().mockResolvedValue({ error: null }),
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      });

      const result = await service.syncInventory();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Sheets API error');
    });

    it('should skip rows without ID', async () => {
      const mockData = [
        { ID: 'HB-NEW-001', 'Set Number': '75192', Name: 'Millennium Falcon' },
        { ID: '', 'Set Number': '10294', Name: 'Titanic' }, // Empty ID
        { 'Set Number': '76139', Name: 'Batmobile' }, // Missing ID
      ];

      mockSheetsClient.readSheet.mockResolvedValueOnce(mockData).mockResolvedValueOnce([]);

      const deleteQuery = { eq: vi.fn().mockResolvedValue({ error: null }) };

      mockSupabase.from.mockImplementation((table) => {
        if (table === 'cache_metadata') {
          return {
            upsert: vi.fn().mockResolvedValue({ error: null }),
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          };
        }
        if (table === 'inventory_items') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ count: 0 }),
            }),
            delete: vi.fn().mockReturnValue(deleteQuery),
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return {};
      });

      const result = await service.syncInventory();

      expect(result.count).toBe(1); // Only the row with valid ID
    });
  });

  describe('syncPurchases', () => {
    it('should sync purchases from sheets to Supabase', async () => {
      const mockPurchaseData = [
        { ID: 'PUR-001', Description: 'Car Boot Sale' },
        { ID: 'PUR-002', Description: 'eBay Purchase' },
      ];

      mockSheetsClient.readSheet.mockResolvedValue(mockPurchaseData);

      const deleteQuery = { eq: vi.fn().mockResolvedValue({ error: null }) };

      mockSupabase.from.mockImplementation((table) => {
        if (table === 'cache_metadata') {
          return {
            upsert: vi.fn().mockResolvedValue({ error: null }),
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          };
        }
        if (table === 'purchases') {
          return {
            delete: vi.fn().mockReturnValue(deleteQuery),
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return {};
      });

      const result = await service.syncPurchases();

      expect(result.success).toBe(true);
      expect(result.count).toBe(2);
      expect(mockSheetsClient.readSheet).toHaveBeenCalledWith('Purchases');
    });
  });

  describe('invalidateRecord', () => {
    it('should mark cache as stale', async () => {
      const upsertMock = vi.fn().mockResolvedValue({ error: null });
      mockSupabase.from.mockReturnValue({
        upsert: upsertMock,
      });

      await service.invalidateRecord('inventory_items', 'record-123');

      expect(upsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: `${userId}:inventory_items`,
          sync_status: 'pending',
        }),
        { onConflict: 'id' }
      );
    });
  });

  describe('getWithSync', () => {
    it('should fetch from cache when not stale', async () => {
      const recentDate = new Date(Date.now() - 1 * 60 * 1000);
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { last_sync: recentDate.toISOString() },
              error: null,
            }),
          }),
        }),
      });

      const mockData = [{ id: '1' }, { id: '2' }];
      const fetchFromCache = vi.fn().mockResolvedValue(mockData);

      const result = await service.getWithSync('inventory_items', fetchFromCache);

      expect(result).toEqual(mockData);
      expect(fetchFromCache).toHaveBeenCalled();
    });

    it('should trigger background sync when cache is stale', async () => {
      const oldDate = new Date(Date.now() - 10 * 60 * 1000);
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { last_sync: oldDate.toISOString() },
              error: null,
            }),
          }),
        }),
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
        insert: vi.fn().mockResolvedValue({ error: null }),
        upsert: vi.fn().mockResolvedValue({ error: null }),
      });

      mockSheetsClient.readSheet.mockResolvedValue([]);

      const mockData = [{ id: '1' }];
      const fetchFromCache = vi.fn().mockResolvedValue(mockData);

      const result = await service.getWithSync('inventory_items', fetchFromCache);

      expect(result).toEqual(mockData);
      // Sync should be triggered in background but we don't wait for it
      expect(fetchFromCache).toHaveBeenCalled();
    });
  });

  describe('singleton management', () => {
    it('should return same instance for same user', () => {
      resetCacheService();
      const service1 = getCacheService(mockSupabase as never, mockSheetsClient as never, 'user-1');
      const service2 = getCacheService(mockSupabase as never, mockSheetsClient as never, 'user-1');

      expect(service1).toBe(service2);
    });

    it('should create new instance for different user', () => {
      resetCacheService();
      const service1 = getCacheService(mockSupabase as never, mockSheetsClient as never, 'user-1');
      const service2 = getCacheService(mockSupabase as never, mockSheetsClient as never, 'user-2');

      expect(service1).not.toBe(service2);
    });
  });
});
