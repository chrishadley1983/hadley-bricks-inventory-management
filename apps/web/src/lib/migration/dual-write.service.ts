import { GoogleSheetsClient, getSheetsClient } from '@/lib/google/sheets-client';
import { newKitInventoryMapping, usedKitInventoryMapping } from './sheet-mappings';

/**
 * Check if dual-write is enabled
 */
export function isDualWriteEnabled(): boolean {
  return process.env.ENABLE_SHEETS_WRITE === 'true';
}

/**
 * Format a date for Google Sheets (DD/MM/YYYY format)
 */
function formatDateForSheets(date: string | null | undefined): string {
  if (!date) return '';
  // Convert from YYYY-MM-DD to DD/MM/YYYY
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const [, year, month, day] = match;
    return `${day}/${month}/${year}`;
  }
  return date;
}

/**
 * Inventory data for dual-write
 */
export interface InventoryDualWriteData {
  sku: string;
  set_number: string;
  item_name?: string | null;
  condition?: 'New' | 'Used' | null;
  status?: string | null;
  source?: string | null;
  purchase_date?: string | null;
  cost?: number | null;
  listing_date?: string | null;
  listing_value?: number | null;
  storage_location?: string | null;
  linked_lot?: string | null;
  amazon_asin?: string | null;
  listing_platform?: string | null;
  notes?: string | null;
}

/**
 * Dual-write service for writing data to both Supabase and Google Sheets
 *
 * During the migration phase, this service ensures data is written to both
 * Supabase (primary) and Google Sheets (legacy) for backwards compatibility.
 *
 * This is a fire-and-forget pattern - if the Sheets write fails, we log the
 * error but don't fail the overall operation.
 */
export class DualWriteService {
  private sheetsClient: GoogleSheetsClient;

  constructor(sheetsClient?: GoogleSheetsClient) {
    this.sheetsClient = sheetsClient || getSheetsClient();
  }

  /**
   * Write an inventory item to Google Sheets (fire-and-forget)
   *
   * @param data The inventory data to write
   * @param operation 'create' | 'update'
   */
  async writeInventoryToSheets(
    data: InventoryDualWriteData,
    operation: 'create' | 'update'
  ): Promise<void> {
    if (!isDualWriteEnabled()) {
      return;
    }

    try {
      const sheetName =
        data.condition === 'New' ? 'Lego New Kit Inventory' : 'Lego Used Kit Inventory';
      const mapping = data.condition === 'New' ? newKitInventoryMapping : usedKitInventoryMapping;

      if (operation === 'update') {
        // Find the existing row by SKU/ID
        const existingRow = await this.sheetsClient.findRow(sheetName, 'ID', data.sku);

        if (existingRow) {
          // Update the existing row
          const rowValues = this.inventoryToSheetRow(data, mapping);
          await this.sheetsClient.updateRow(sheetName, existingRow.rowNumber, rowValues);
          console.log(`[DualWrite] Updated row ${existingRow.rowNumber} in "${sheetName}"`);
        } else {
          // Record doesn't exist in sheet, create it
          const rowValues = this.inventoryToSheetRow(data, mapping);
          await this.sheetsClient.appendRow(sheetName, rowValues);
          console.log(`[DualWrite] Appended new row to "${sheetName}" (update fallback)`);
        }
      } else {
        // Create - append a new row
        const rowValues = this.inventoryToSheetRow(data, mapping);
        await this.sheetsClient.appendRow(sheetName, rowValues);
        console.log(`[DualWrite] Appended new row to "${sheetName}"`);
      }
    } catch (error) {
      // Log error but don't fail - this is fire-and-forget
      console.error('[DualWrite] Failed to write to Google Sheets:', error);
    }
  }

  /**
   * Convert inventory data to a sheet row array
   */
  private inventoryToSheetRow(
    data: InventoryDualWriteData,
    mapping: typeof newKitInventoryMapping
  ): (string | number | null)[] {
    // Create a map of supabase field to value
    const fieldValues: Record<string, string | number | null> = {
      sku: data.sku,
      set_number: data.set_number,
      item_name: data.item_name || null,
      source: data.source || null,
      linked_lot: data.linked_lot || null,
      purchase_date: formatDateForSheets(data.purchase_date),
      cost: data.cost || null,
      notes: data.notes || null,
      status: data.status || 'IN STOCK',
      listing_date: formatDateForSheets(data.listing_date),
      storage_location: data.storage_location || null,
      listing_platform: data.listing_platform || null,
      amazon_asin: data.amazon_asin || null,
      listing_value: data.listing_value || null,
    };

    // Build the row values based on column order in the mapping
    // Get maximum column index
    const maxColIndex = Math.max(
      ...mapping.columns.map((c) => this.columnLetterToIndex(c.sheetColumn))
    );

    const row: (string | number | null)[] = new Array(maxColIndex + 1).fill(null);

    for (const col of mapping.columns) {
      const colIndex = this.columnLetterToIndex(col.sheetColumn);
      const value = fieldValues[col.supabaseField];

      if (value !== null && value !== undefined) {
        row[colIndex] = value;
      }
    }

    return row;
  }

  /**
   * Convert column letter to index (A = 0, B = 1, etc.)
   */
  private columnLetterToIndex(letter: string): number {
    let result = 0;
    for (let i = 0; i < letter.length; i++) {
      result = result * 26 + (letter.charCodeAt(i) - 64);
    }
    return result - 1;
  }
}

// Singleton instance
let dualWriteServiceInstance: DualWriteService | null = null;

/**
 * Get or create the singleton dual-write service
 */
export function getDualWriteService(): DualWriteService {
  if (!dualWriteServiceInstance) {
    dualWriteServiceInstance = new DualWriteService();
  }
  return dualWriteServiceInstance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetDualWriteService(): void {
  dualWriteServiceInstance = null;
}
