import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  SheetsWriteService,
  isSheetsWriteEnabled,
  getSheetsWriteService,
  resetSheetsWriteService,
  InventoryWriteData,
  PurchaseWriteData,
} from '../sheets-write.service';

// Mock the sheets client
const mockSheetsClient = {
  findRow: vi.fn(),
  updateRow: vi.fn(),
  appendRow: vi.fn(),
  deleteRow: vi.fn(),
  readSheet: vi.fn(),
};

// Mock getSheetsClient
vi.mock('@/lib/google/sheets-client', () => ({
  getSheetsClient: vi.fn(() => mockSheetsClient),
  GoogleSheetsClient: vi.fn(),
}));

// Mock sheet mappings
vi.mock('@/lib/migration/sheet-mappings', () => ({
  newKitInventoryMapping: {
    sheetName: 'Lego New Kit Inventory',
    columns: [
      { sheetColumn: 'A', supabaseField: 'sku' },
      { sheetColumn: 'B', supabaseField: 'set_number' },
      { sheetColumn: 'C', supabaseField: 'item_name' },
      { sheetColumn: 'D', supabaseField: 'source' },
      { sheetColumn: 'E', supabaseField: 'purchase_date' },
      { sheetColumn: 'F', supabaseField: 'cost' },
      { sheetColumn: 'G', supabaseField: 'status' },
      { sheetColumn: 'H', supabaseField: 'notes' },
    ],
  },
  usedKitInventoryMapping: {
    sheetName: 'Lego Used Kit Inventory',
    columns: [
      { sheetColumn: 'A', supabaseField: 'sku' },
      { sheetColumn: 'B', supabaseField: 'set_number' },
      { sheetColumn: 'C', supabaseField: 'item_name' },
      { sheetColumn: 'D', supabaseField: 'source' },
      { sheetColumn: 'E', supabaseField: 'purchase_date' },
      { sheetColumn: 'F', supabaseField: 'cost' },
      { sheetColumn: 'G', supabaseField: 'status' },
      { sheetColumn: 'H', supabaseField: 'notes' },
    ],
  },
}));

describe('SheetsWriteService', () => {
  let service: SheetsWriteService;
  const originalEnv = process.env.ENABLE_SHEETS_WRITE;

  beforeEach(() => {
    vi.clearAllMocks();
    resetSheetsWriteService();
    process.env.ENABLE_SHEETS_WRITE = 'true';
    service = new SheetsWriteService(mockSheetsClient as never);
  });

  afterEach(() => {
    process.env.ENABLE_SHEETS_WRITE = originalEnv;
  });

  describe('isSheetsWriteEnabled', () => {
    it('should return true when ENABLE_SHEETS_WRITE is true', () => {
      process.env.ENABLE_SHEETS_WRITE = 'true';
      expect(isSheetsWriteEnabled()).toBe(true);
    });

    it('should return false when ENABLE_SHEETS_WRITE is false', () => {
      process.env.ENABLE_SHEETS_WRITE = 'false';
      expect(isSheetsWriteEnabled()).toBe(false);
    });

    it('should return false when ENABLE_SHEETS_WRITE is not set', () => {
      delete process.env.ENABLE_SHEETS_WRITE;
      expect(isSheetsWriteEnabled()).toBe(false);
    });
  });

  describe('writeInventory', () => {
    const inventoryData: InventoryWriteData = {
      sku: 'HB-NEW-001',
      set_number: '75192',
      item_name: 'Millennium Falcon',
      condition: 'New',
      status: 'IN STOCK',
      source: 'Car Boot Sale',
      purchase_date: '2025-01-15',
      cost: 150,
    };

    it('should skip write when sheets write is disabled', async () => {
      process.env.ENABLE_SHEETS_WRITE = 'false';

      const result = await service.writeInventory(inventoryData, 'create');

      expect(result.success).toBe(true);
      expect(mockSheetsClient.appendRow).not.toHaveBeenCalled();
    });

    it('should append row for create operation', async () => {
      mockSheetsClient.appendRow.mockResolvedValue(undefined);

      const result = await service.writeInventory(inventoryData, 'create');

      expect(result.success).toBe(true);
      expect(result.sheetsId).toBe('HB-NEW-001');
      expect(mockSheetsClient.appendRow).toHaveBeenCalledWith(
        'Lego New Kit Inventory',
        expect.any(Array)
      );
    });

    it('should use correct sheet name for New condition', async () => {
      mockSheetsClient.appendRow.mockResolvedValue(undefined);

      await service.writeInventory({ ...inventoryData, condition: 'New' }, 'create');

      expect(mockSheetsClient.appendRow).toHaveBeenCalledWith(
        'Lego New Kit Inventory',
        expect.any(Array)
      );
    });

    it('should use correct sheet name for Used condition', async () => {
      mockSheetsClient.appendRow.mockResolvedValue(undefined);

      await service.writeInventory({ ...inventoryData, condition: 'Used' }, 'create');

      expect(mockSheetsClient.appendRow).toHaveBeenCalledWith(
        'Lego Used Kit Inventory',
        expect.any(Array)
      );
    });

    it('should update existing row for update operation when row exists', async () => {
      mockSheetsClient.findRow.mockResolvedValue({ rowNumber: 5, data: {} });
      mockSheetsClient.updateRow.mockResolvedValue(undefined);

      const result = await service.writeInventory(inventoryData, 'update');

      expect(result.success).toBe(true);
      expect(mockSheetsClient.findRow).toHaveBeenCalledWith(
        'Lego New Kit Inventory',
        'ID',
        'HB-NEW-001'
      );
      expect(mockSheetsClient.updateRow).toHaveBeenCalledWith(
        'Lego New Kit Inventory',
        5,
        expect.any(Array)
      );
    });

    it('should append row for update operation when row does not exist (fallback)', async () => {
      mockSheetsClient.findRow.mockResolvedValue(null);
      mockSheetsClient.appendRow.mockResolvedValue(undefined);

      const result = await service.writeInventory(inventoryData, 'update');

      expect(result.success).toBe(true);
      expect(mockSheetsClient.appendRow).toHaveBeenCalledWith(
        'Lego New Kit Inventory',
        expect.any(Array)
      );
    });

    it('should format date correctly in row data', async () => {
      mockSheetsClient.appendRow.mockResolvedValue(undefined);

      await service.writeInventory(
        { ...inventoryData, purchase_date: '2025-01-15' },
        'create'
      );

      const rowData = mockSheetsClient.appendRow.mock.calls[0][1];
      // Find the purchase_date column value (should be formatted as DD/MM/YYYY)
      expect(rowData).toContain('15/01/2025');
    });

    it('should handle null dates', async () => {
      mockSheetsClient.appendRow.mockResolvedValue(undefined);

      await service.writeInventory(
        { ...inventoryData, purchase_date: null },
        'create'
      );

      expect(mockSheetsClient.appendRow).toHaveBeenCalled();
    });

    it('should call onSupabaseSync callback', async () => {
      mockSheetsClient.appendRow.mockResolvedValue(undefined);
      const syncCallback = vi.fn().mockResolvedValue(undefined);

      const result = await service.writeInventory(inventoryData, 'create', syncCallback);

      expect(result.success).toBe(true);
      expect(result.syncPromise).toBeDefined();
      await result.syncPromise;
      expect(syncCallback).toHaveBeenCalled();
    });

    it('should handle sync callback errors gracefully', async () => {
      mockSheetsClient.appendRow.mockResolvedValue(undefined);
      const syncCallback = vi.fn().mockRejectedValue(new Error('Sync failed'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await service.writeInventory(inventoryData, 'create', syncCallback);

      expect(result.success).toBe(true);
      await result.syncPromise;
      expect(consoleSpy).toHaveBeenCalledWith(
        '[SheetsWrite] Supabase sync failed:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });

    it('should return error on sheets write failure', async () => {
      mockSheetsClient.appendRow.mockRejectedValue(new Error('Sheets API error'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await service.writeInventory(inventoryData, 'create');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Sheets API error');
      consoleSpy.mockRestore();
    });
  });

  describe('writePurchase', () => {
    const purchaseData: PurchaseWriteData = {
      short_description: 'Car Boot Sale - Various Sets',
      cost: 50,
      purchase_date: '2025-01-15',
      source: 'Car Boot Sale',
      payment_method: 'Cash',
      reference: 'CBS-001',
      description: 'Bought several sets at local car boot',
    };

    it('should skip write when sheets write is disabled', async () => {
      process.env.ENABLE_SHEETS_WRITE = 'false';

      const result = await service.writePurchase(purchaseData, 'create');

      expect(result.success).toBe(true);
      expect(mockSheetsClient.appendRow).not.toHaveBeenCalled();
    });

    it('should generate ID and append row for create operation', async () => {
      mockSheetsClient.readSheet.mockResolvedValue([
        { ID: 'P0001' },
        { ID: 'P0002' },
        { ID: 'P0003' },
      ]);
      mockSheetsClient.appendRow.mockResolvedValue(undefined);

      const result = await service.writePurchase(purchaseData, 'create');

      expect(result.success).toBe(true);
      expect(result.sheetsId).toBe('P0004');
      expect(mockSheetsClient.appendRow).toHaveBeenCalledWith('Purchases', expect.any(Array));
    });

    it('should generate ID starting from P0001 when no purchases exist', async () => {
      mockSheetsClient.readSheet.mockResolvedValue([]);
      mockSheetsClient.appendRow.mockResolvedValue(undefined);

      const result = await service.writePurchase(purchaseData, 'create');

      expect(result.sheetsId).toBe('P0001');
    });

    it('should handle non-standard ID formats in existing data', async () => {
      mockSheetsClient.readSheet.mockResolvedValue([
        { ID: 'P0005' },
        { ID: 'INVALID' },
        { ID: '' },
        { ID: 'P0010' },
      ]);
      mockSheetsClient.appendRow.mockResolvedValue(undefined);

      const result = await service.writePurchase(purchaseData, 'create');

      expect(result.sheetsId).toBe('P0011');
    });

    it('should update existing row for update operation when row exists', async () => {
      const dataWithId: PurchaseWriteData = { ...purchaseData, sheets_id: 'P0005' };
      mockSheetsClient.findRow.mockResolvedValue({ rowNumber: 10, data: {} });
      mockSheetsClient.updateRow.mockResolvedValue(undefined);

      const result = await service.writePurchase(dataWithId, 'update');

      expect(result.success).toBe(true);
      expect(mockSheetsClient.findRow).toHaveBeenCalledWith('Purchases', 'ID', 'P0005');
      expect(mockSheetsClient.updateRow).toHaveBeenCalledWith('Purchases', 10, expect.any(Array));
    });

    it('should append row for update operation when row does not exist (fallback)', async () => {
      const dataWithId: PurchaseWriteData = { ...purchaseData, sheets_id: 'P0099' };
      mockSheetsClient.findRow.mockResolvedValue(null);
      mockSheetsClient.appendRow.mockResolvedValue(undefined);

      const result = await service.writePurchase(dataWithId, 'update');

      expect(result.success).toBe(true);
      expect(mockSheetsClient.appendRow).toHaveBeenCalledWith('Purchases', expect.any(Array));
    });

    it('should format purchase row data correctly', async () => {
      mockSheetsClient.readSheet.mockResolvedValue([]);
      mockSheetsClient.appendRow.mockResolvedValue(undefined);

      await service.writePurchase(purchaseData, 'create');

      const rowData = mockSheetsClient.appendRow.mock.calls[0][1];
      expect(rowData).toEqual([
        'P0001', // ID
        'Car Boot Sale - Various Sets', // short_description
        50, // cost
        '15/01/2025', // formatted date
        'Car Boot Sale', // source
        'Cash', // payment_method
        'CBS-001', // reference
        'Bought several sets at local car boot', // description
      ]);
    });

    it('should handle null optional fields', async () => {
      mockSheetsClient.readSheet.mockResolvedValue([]);
      mockSheetsClient.appendRow.mockResolvedValue(undefined);

      const minimalData: PurchaseWriteData = {
        short_description: 'Test Purchase',
        cost: 10,
      };

      await service.writePurchase(minimalData, 'create');

      const rowData = mockSheetsClient.appendRow.mock.calls[0][1];
      expect(rowData).toEqual([
        'P0001',
        'Test Purchase',
        10,
        '', // null date
        null, // source
        null, // payment_method
        null, // reference
        null, // description
      ]);
    });

    it('should call onSupabaseSync callback', async () => {
      mockSheetsClient.readSheet.mockResolvedValue([]);
      mockSheetsClient.appendRow.mockResolvedValue(undefined);
      const syncCallback = vi.fn().mockResolvedValue(undefined);

      const result = await service.writePurchase(purchaseData, 'create', syncCallback);

      expect(result.success).toBe(true);
      await result.syncPromise;
      expect(syncCallback).toHaveBeenCalled();
    });

    it('should return error on sheets write failure', async () => {
      mockSheetsClient.readSheet.mockRejectedValue(new Error('Sheets API error'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await service.writePurchase(purchaseData, 'create');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Sheets API error');
      consoleSpy.mockRestore();
    });
  });

  describe('deleteInventory', () => {
    it('should skip delete when sheets write is disabled', async () => {
      process.env.ENABLE_SHEETS_WRITE = 'false';

      const result = await service.deleteInventory('HB-NEW-001', 'New');

      expect(result.success).toBe(true);
      expect(mockSheetsClient.findRow).not.toHaveBeenCalled();
    });

    it('should delete row when it exists', async () => {
      mockSheetsClient.findRow.mockResolvedValue({ rowNumber: 5, data: {} });
      mockSheetsClient.deleteRow.mockResolvedValue(undefined);

      const result = await service.deleteInventory('HB-NEW-001', 'New');

      expect(result.success).toBe(true);
      expect(mockSheetsClient.findRow).toHaveBeenCalledWith(
        'Lego New Kit Inventory',
        'ID',
        'HB-NEW-001'
      );
      expect(mockSheetsClient.deleteRow).toHaveBeenCalledWith('Lego New Kit Inventory', 5);
    });

    it('should use correct sheet name for Used condition', async () => {
      mockSheetsClient.findRow.mockResolvedValue({ rowNumber: 3, data: {} });
      mockSheetsClient.deleteRow.mockResolvedValue(undefined);

      await service.deleteInventory('HB-USED-001', 'Used');

      expect(mockSheetsClient.findRow).toHaveBeenCalledWith(
        'Lego Used Kit Inventory',
        'ID',
        'HB-USED-001'
      );
    });

    it('should succeed when row does not exist', async () => {
      mockSheetsClient.findRow.mockResolvedValue(null);

      const result = await service.deleteInventory('HB-NEW-999', 'New');

      expect(result.success).toBe(true);
      expect(mockSheetsClient.deleteRow).not.toHaveBeenCalled();
    });

    it('should return error on delete failure', async () => {
      mockSheetsClient.findRow.mockResolvedValue({ rowNumber: 5, data: {} });
      mockSheetsClient.deleteRow.mockRejectedValue(new Error('Delete failed'));

      const result = await service.deleteInventory('HB-NEW-001', 'New');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Delete failed');
    });
  });

  describe('deletePurchase', () => {
    it('should skip delete when sheets write is disabled', async () => {
      process.env.ENABLE_SHEETS_WRITE = 'false';

      const result = await service.deletePurchase('P0001');

      expect(result.success).toBe(true);
      expect(mockSheetsClient.findRow).not.toHaveBeenCalled();
    });

    it('should delete row when it exists', async () => {
      mockSheetsClient.findRow.mockResolvedValue({ rowNumber: 8, data: {} });
      mockSheetsClient.deleteRow.mockResolvedValue(undefined);

      const result = await service.deletePurchase('P0005');

      expect(result.success).toBe(true);
      expect(mockSheetsClient.findRow).toHaveBeenCalledWith('Purchases', 'ID', 'P0005');
      expect(mockSheetsClient.deleteRow).toHaveBeenCalledWith('Purchases', 8);
    });

    it('should succeed when row does not exist', async () => {
      mockSheetsClient.findRow.mockResolvedValue(null);

      const result = await service.deletePurchase('P9999');

      expect(result.success).toBe(true);
      expect(mockSheetsClient.deleteRow).not.toHaveBeenCalled();
    });

    it('should return error on delete failure', async () => {
      mockSheetsClient.findRow.mockResolvedValue({ rowNumber: 5, data: {} });
      mockSheetsClient.deleteRow.mockRejectedValue(new Error('Delete failed'));

      const result = await service.deletePurchase('P0001');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Delete failed');
    });
  });

  describe('singleton management', () => {
    it('should return same instance from getSheetsWriteService', () => {
      resetSheetsWriteService();

      const service1 = getSheetsWriteService();
      const service2 = getSheetsWriteService();

      expect(service1).toBe(service2);
    });

    it('should create new instance after resetSheetsWriteService', () => {
      const service1 = getSheetsWriteService();
      resetSheetsWriteService();
      const service2 = getSheetsWriteService();

      expect(service1).not.toBe(service2);
    });
  });

  describe('date formatting', () => {
    it('should convert YYYY-MM-DD to DD/MM/YYYY', async () => {
      mockSheetsClient.appendRow.mockResolvedValue(undefined);

      await service.writeInventory(
        {
          sku: 'TEST-001',
          set_number: '12345',
          condition: 'New',
          purchase_date: '2025-12-31',
        },
        'create'
      );

      const rowData = mockSheetsClient.appendRow.mock.calls[0][1];
      expect(rowData).toContain('31/12/2025');
    });

    it('should preserve non-standard date formats', async () => {
      mockSheetsClient.appendRow.mockResolvedValue(undefined);

      await service.writeInventory(
        {
          sku: 'TEST-001',
          set_number: '12345',
          condition: 'New',
          purchase_date: '15/01/2025', // Already in target format
        },
        'create'
      );

      const rowData = mockSheetsClient.appendRow.mock.calls[0][1];
      expect(rowData).toContain('15/01/2025');
    });

    it('should handle empty string dates', async () => {
      mockSheetsClient.appendRow.mockResolvedValue(undefined);

      await service.writeInventory(
        {
          sku: 'TEST-001',
          set_number: '12345',
          condition: 'New',
          purchase_date: '',
        },
        'create'
      );

      // Should not throw and row should be appended
      expect(mockSheetsClient.appendRow).toHaveBeenCalled();
    });
  });

  describe('column letter to index conversion', () => {
    it('should handle single letter columns correctly', async () => {
      mockSheetsClient.appendRow.mockResolvedValue(undefined);

      await service.writeInventory(
        {
          sku: 'TEST-001',
          set_number: '12345',
          condition: 'New',
        },
        'create'
      );

      // Row data should be structured according to column mappings
      const rowData = mockSheetsClient.appendRow.mock.calls[0][1];
      expect(Array.isArray(rowData)).toBe(true);
      expect(rowData[0]).toBe('TEST-001'); // Column A = sku
      expect(rowData[1]).toBe('12345'); // Column B = set_number
    });
  });
});
