import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DualWriteService,
  isDualWriteEnabled,
  getDualWriteService,
  resetDualWriteService,
} from '../dual-write.service';

// Mock the sheets client
const mockSheetsClient = {
  findRow: vi.fn(),
  appendRow: vi.fn(),
  updateRow: vi.fn(),
};

vi.mock('@/lib/google/sheets-client', () => ({
  getSheetsClient: vi.fn(() => mockSheetsClient),
  GoogleSheetsClient: vi.fn(() => mockSheetsClient),
}));

describe('DualWriteService', () => {
  let service: DualWriteService;
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    resetDualWriteService();
    process.env = { ...originalEnv, ENABLE_SHEETS_WRITE: 'true' };
    service = new DualWriteService(mockSheetsClient as never);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('isDualWriteEnabled', () => {
    it('should return true when ENABLE_SHEETS_WRITE is "true"', () => {
      process.env.ENABLE_SHEETS_WRITE = 'true';
      expect(isDualWriteEnabled()).toBe(true);
    });

    it('should return false when ENABLE_SHEETS_WRITE is not "true"', () => {
      process.env.ENABLE_SHEETS_WRITE = 'false';
      expect(isDualWriteEnabled()).toBe(false);
    });

    it('should return false when ENABLE_SHEETS_WRITE is undefined', () => {
      delete process.env.ENABLE_SHEETS_WRITE;
      expect(isDualWriteEnabled()).toBe(false);
    });
  });

  describe('writeInventoryToSheets', () => {
    it('should skip writing when dual-write is disabled', async () => {
      process.env.ENABLE_SHEETS_WRITE = 'false';

      await service.writeInventoryToSheets(
        {
          sku: 'HB-NEW-75192-001',
          set_number: '75192',
          condition: 'New',
        },
        'create'
      );

      expect(mockSheetsClient.appendRow).not.toHaveBeenCalled();
      expect(mockSheetsClient.updateRow).not.toHaveBeenCalled();
    });

    it('should append row for new items', async () => {
      mockSheetsClient.appendRow.mockResolvedValue(undefined);

      await service.writeInventoryToSheets(
        {
          sku: 'HB-NEW-75192-001',
          set_number: '75192',
          item_name: 'Millennium Falcon',
          condition: 'New',
          status: 'IN STOCK',
          cost: 649.99,
        },
        'create'
      );

      expect(mockSheetsClient.appendRow).toHaveBeenCalledWith(
        'Lego New Kit Inventory',
        expect.any(Array)
      );
    });

    it('should use correct sheet for used items', async () => {
      mockSheetsClient.appendRow.mockResolvedValue(undefined);

      await service.writeInventoryToSheets(
        {
          sku: 'HB-USED-76139-001',
          set_number: '76139',
          item_name: 'Batmobile',
          condition: 'Used',
        },
        'create'
      );

      expect(mockSheetsClient.appendRow).toHaveBeenCalledWith(
        'Lego Used Kit Inventory',
        expect.any(Array)
      );
    });

    it('should update existing row when found', async () => {
      mockSheetsClient.findRow.mockResolvedValue({
        rowNumber: 5,
        data: { ID: 'HB-NEW-75192-001' },
      });
      mockSheetsClient.updateRow.mockResolvedValue(undefined);

      await service.writeInventoryToSheets(
        {
          sku: 'HB-NEW-75192-001',
          set_number: '75192',
          condition: 'New',
          status: 'LISTED',
          listing_value: 899.99,
        },
        'update'
      );

      expect(mockSheetsClient.findRow).toHaveBeenCalledWith(
        'Lego New Kit Inventory',
        'ID',
        'HB-NEW-75192-001'
      );
      expect(mockSheetsClient.updateRow).toHaveBeenCalledWith(
        'Lego New Kit Inventory',
        5,
        expect.any(Array)
      );
    });

    it('should append row when update target not found', async () => {
      mockSheetsClient.findRow.mockResolvedValue(null);
      mockSheetsClient.appendRow.mockResolvedValue(undefined);

      await service.writeInventoryToSheets(
        {
          sku: 'HB-NEW-75192-001',
          set_number: '75192',
          condition: 'New',
        },
        'update'
      );

      expect(mockSheetsClient.appendRow).toHaveBeenCalled();
    });

    it('should handle sheet write errors gracefully', async () => {
      mockSheetsClient.appendRow.mockRejectedValue(new Error('API Error'));

      // Should not throw - fire and forget pattern
      await expect(
        service.writeInventoryToSheets(
          {
            sku: 'HB-NEW-75192-001',
            set_number: '75192',
            condition: 'New',
          },
          'create'
        )
      ).resolves.not.toThrow();
    });

    it('should format dates correctly for sheets', async () => {
      mockSheetsClient.appendRow.mockResolvedValue(undefined);

      await service.writeInventoryToSheets(
        {
          sku: 'HB-NEW-75192-001',
          set_number: '75192',
          condition: 'New',
          purchase_date: '2024-12-20',
          listing_date: '2024-12-25',
        },
        'create'
      );

      const appendCall = mockSheetsClient.appendRow.mock.calls[0];
      const rowValues = appendCall[1] as (string | number | null)[];

      // Check that ISO dates were converted to DD/MM/YYYY format
      expect(rowValues.some((v) => v === '20/12/2024')).toBe(true);
    });

    it('should handle null optional fields', async () => {
      mockSheetsClient.appendRow.mockResolvedValue(undefined);

      await service.writeInventoryToSheets(
        {
          sku: 'HB-NEW-75192-001',
          set_number: '75192',
          condition: 'New',
          item_name: null,
          notes: null,
          storage_location: null,
        },
        'create'
      );

      expect(mockSheetsClient.appendRow).toHaveBeenCalled();
    });
  });

  describe('singleton management', () => {
    it('should return same instance from getDualWriteService', () => {
      resetDualWriteService();
      const service1 = getDualWriteService();
      const service2 = getDualWriteService();

      expect(service1).toBe(service2);
    });

    it('should reset singleton instance', () => {
      const service1 = getDualWriteService();
      resetDualWriteService();
      const service2 = getDualWriteService();

      expect(service1).not.toBe(service2);
    });
  });
});
