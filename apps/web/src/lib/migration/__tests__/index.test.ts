import { describe, it, expect, vi } from 'vitest';

// Mock dependencies before importing
vi.mock('@/lib/google/sheets-client', () => ({
  GoogleSheetsClient: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(),
  })),
}));

describe('migration/index exports', () => {
  it('should export all sheet-mappings functions', async () => {
    const exports = await import('../index');

    // Type exports (tested by checking they exist)
    expect(exports.parseUKDate).toBeDefined();
    expect(exports.parseCurrency).toBeDefined();
    expect(exports.parsePercentage).toBeDefined();
    expect(exports.normalizeStatus).toBeDefined();
    expect(exports.normalizeCondition).toBeDefined();

    // Mapping objects
    expect(exports.newKitInventoryMapping).toBeDefined();
    expect(exports.usedKitInventoryMapping).toBeDefined();
    expect(exports.purchasesMapping).toBeDefined();

    // Helper functions
    expect(exports.getAllMappings).toBeDefined();
    expect(exports.getMappingBySheetName).toBeDefined();
    expect(exports.getMappingsByTable).toBeDefined();
    expect(exports.transformRow).toBeDefined();
    expect(exports.addConditionFromSheet).toBeDefined();
  });

  it('should export all migration-service functions', async () => {
    const exports = await import('../index');

    expect(exports.MigrationService).toBeDefined();
    expect(exports.createMigrationService).toBeDefined();
  });

  it('should export all dual-write.service functions', async () => {
    const exports = await import('../index');

    expect(exports.DualWriteService).toBeDefined();
    expect(exports.getDualWriteService).toBeDefined();
    expect(exports.resetDualWriteService).toBeDefined();
    expect(exports.isDualWriteEnabled).toBeDefined();
  });

  describe('exported function types', () => {
    it('parseUKDate should be a function', async () => {
      const { parseUKDate } = await import('../index');
      expect(typeof parseUKDate).toBe('function');
    });

    it('parseCurrency should be a function', async () => {
      const { parseCurrency } = await import('../index');
      expect(typeof parseCurrency).toBe('function');
    });

    it('parsePercentage should be a function', async () => {
      const { parsePercentage } = await import('../index');
      expect(typeof parsePercentage).toBe('function');
    });

    it('normalizeStatus should be a function', async () => {
      const { normalizeStatus } = await import('../index');
      expect(typeof normalizeStatus).toBe('function');
    });

    it('normalizeCondition should be a function', async () => {
      const { normalizeCondition } = await import('../index');
      expect(typeof normalizeCondition).toBe('function');
    });

    it('getAllMappings should be a function', async () => {
      const { getAllMappings } = await import('../index');
      expect(typeof getAllMappings).toBe('function');
    });

    it('getMappingBySheetName should be a function', async () => {
      const { getMappingBySheetName } = await import('../index');
      expect(typeof getMappingBySheetName).toBe('function');
    });

    it('getMappingsByTable should be a function', async () => {
      const { getMappingsByTable } = await import('../index');
      expect(typeof getMappingsByTable).toBe('function');
    });

    it('transformRow should be a function', async () => {
      const { transformRow } = await import('../index');
      expect(typeof transformRow).toBe('function');
    });

    it('addConditionFromSheet should be a function', async () => {
      const { addConditionFromSheet } = await import('../index');
      expect(typeof addConditionFromSheet).toBe('function');
    });

    it('createMigrationService should be a function', async () => {
      const { createMigrationService } = await import('../index');
      expect(typeof createMigrationService).toBe('function');
    });

    it('getDualWriteService should be a function', async () => {
      const { getDualWriteService } = await import('../index');
      expect(typeof getDualWriteService).toBe('function');
    });

    it('resetDualWriteService should be a function', async () => {
      const { resetDualWriteService } = await import('../index');
      expect(typeof resetDualWriteService).toBe('function');
    });

    it('isDualWriteEnabled should be a function', async () => {
      const { isDualWriteEnabled } = await import('../index');
      expect(typeof isDualWriteEnabled).toBe('function');
    });
  });

  describe('exported class types', () => {
    it('MigrationService should be a constructor', async () => {
      const { MigrationService } = await import('../index');
      expect(typeof MigrationService).toBe('function');
    });

    it('DualWriteService should be a constructor', async () => {
      const { DualWriteService } = await import('../index');
      expect(typeof DualWriteService).toBe('function');
    });
  });

  describe('mapping objects structure', () => {
    it('newKitInventoryMapping should have required properties', async () => {
      const { newKitInventoryMapping } = await import('../index');

      expect(newKitInventoryMapping.sheetName).toBe('Lego New Kit Inventory');
      expect(newKitInventoryMapping.supabaseTable).toBe('inventory_items');
      expect(newKitInventoryMapping.columns).toBeInstanceOf(Array);
      expect(newKitInventoryMapping.uniqueKeyColumn).toBeDefined();
    });

    it('usedKitInventoryMapping should have required properties', async () => {
      const { usedKitInventoryMapping } = await import('../index');

      expect(usedKitInventoryMapping.sheetName).toBe('Lego Used Kit Inventory');
      expect(usedKitInventoryMapping.supabaseTable).toBe('inventory_items');
      expect(usedKitInventoryMapping.columns).toBeInstanceOf(Array);
      expect(usedKitInventoryMapping.uniqueKeyColumn).toBeDefined();
    });

    it('purchasesMapping should have required properties', async () => {
      const { purchasesMapping } = await import('../index');

      expect(purchasesMapping.sheetName).toBe('Purchases');
      expect(purchasesMapping.supabaseTable).toBe('purchases');
      expect(purchasesMapping.columns).toBeInstanceOf(Array);
      expect(purchasesMapping.uniqueKeyColumn).toBeDefined();
    });
  });
});
