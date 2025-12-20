/**
 * Sheets Write Service
 *
 * Implements write-first-to-sheets pattern for the Sheets-primary architecture.
 * Writes go to Google Sheets first, then sync to Supabase asynchronously.
 */

import { GoogleSheetsClient, getSheetsClient } from '@/lib/google/sheets-client';
import { newKitInventoryMapping, usedKitInventoryMapping } from '@/lib/migration/sheet-mappings';

/**
 * Check if Sheets-primary write is enabled
 */
export function isSheetsWriteEnabled(): boolean {
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
 * Inventory data for Sheets write
 */
export interface InventoryWriteData {
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
 * Purchase data for Sheets write
 */
export interface PurchaseWriteData {
  sheets_id?: string;
  short_description: string;
  cost: number;
  purchase_date?: string | null;
  source?: string | null;
  payment_method?: string | null;
  reference?: string | null;
  description?: string | null;
}

/**
 * Write result with async sync status
 */
export interface WriteResult {
  success: boolean;
  sheetsId?: string;
  error?: string;
  syncPromise?: Promise<void>;
}

/**
 * Sheets Write Service for write-first-to-sheets pattern
 */
export class SheetsWriteService {
  private sheetsClient: GoogleSheetsClient;

  constructor(sheetsClient?: GoogleSheetsClient) {
    this.sheetsClient = sheetsClient || getSheetsClient();
  }

  /**
   * Write an inventory item to Google Sheets (primary)
   * Returns immediately, syncs to Supabase asynchronously
   */
  async writeInventory(
    data: InventoryWriteData,
    operation: 'create' | 'update',
    onSupabaseSync?: () => Promise<void>
  ): Promise<WriteResult> {
    if (!isSheetsWriteEnabled()) {
      return { success: true };
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
          console.log(`[SheetsWrite] Updated row ${existingRow.rowNumber} in "${sheetName}"`);
        } else {
          // Record doesn't exist in sheet, create it
          const rowValues = this.inventoryToSheetRow(data, mapping);
          await this.sheetsClient.appendRow(sheetName, rowValues);
          console.log(`[SheetsWrite] Appended new row to "${sheetName}" (update fallback)`);
        }
      } else {
        // Create - append a new row
        const rowValues = this.inventoryToSheetRow(data, mapping);
        await this.sheetsClient.appendRow(sheetName, rowValues);
        console.log(`[SheetsWrite] Appended new row to "${sheetName}"`);
      }

      // Async sync to Supabase (fire-and-forget)
      let syncPromise: Promise<void> | undefined;
      if (onSupabaseSync) {
        syncPromise = onSupabaseSync().catch((err) => {
          console.error('[SheetsWrite] Supabase sync failed:', err);
        });
      }

      return { success: true, sheetsId: data.sku, syncPromise };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[SheetsWrite] Failed to write to Google Sheets:', message);
      return { success: false, error: message };
    }
  }

  /**
   * Write a purchase to Google Sheets (primary)
   */
  async writePurchase(
    data: PurchaseWriteData,
    operation: 'create' | 'update',
    onSupabaseSync?: () => Promise<void>
  ): Promise<WriteResult> {
    if (!isSheetsWriteEnabled()) {
      return { success: true };
    }

    try {
      const sheetName = 'Purchases';

      if (operation === 'update' && data.sheets_id) {
        // Find and update existing row
        const existingRow = await this.sheetsClient.findRow(sheetName, 'ID', data.sheets_id);

        if (existingRow) {
          const rowValues = this.purchaseToSheetRow(data);
          await this.sheetsClient.updateRow(sheetName, existingRow.rowNumber, rowValues);
          console.log(`[SheetsWrite] Updated purchase row ${existingRow.rowNumber}`);
        } else {
          // Fallback to append
          const rowValues = this.purchaseToSheetRow(data);
          await this.sheetsClient.appendRow(sheetName, rowValues);
          console.log(`[SheetsWrite] Appended purchase (update fallback)`);
        }
      } else {
        // Generate new ID and append
        const newId = await this.generatePurchaseId();
        data.sheets_id = newId;
        const rowValues = this.purchaseToSheetRow(data);
        await this.sheetsClient.appendRow(sheetName, rowValues);
        console.log(`[SheetsWrite] Appended new purchase with ID ${newId}`);
      }

      // Async sync to Supabase
      let syncPromise: Promise<void> | undefined;
      if (onSupabaseSync) {
        syncPromise = onSupabaseSync().catch((err) => {
          console.error('[SheetsWrite] Supabase sync failed:', err);
        });
      }

      return { success: true, sheetsId: data.sheets_id, syncPromise };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[SheetsWrite] Failed to write purchase:', message);
      return { success: false, error: message };
    }
  }

  /**
   * Delete an inventory item from Google Sheets
   */
  async deleteInventory(sku: string, condition: 'New' | 'Used'): Promise<WriteResult> {
    if (!isSheetsWriteEnabled()) {
      return { success: true };
    }

    try {
      const sheetName = condition === 'New' ? 'Lego New Kit Inventory' : 'Lego Used Kit Inventory';
      const existingRow = await this.sheetsClient.findRow(sheetName, 'ID', sku);

      if (existingRow) {
        await this.sheetsClient.deleteRow(sheetName, existingRow.rowNumber);
        console.log(`[SheetsWrite] Deleted row ${existingRow.rowNumber} from "${sheetName}"`);
      }

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  /**
   * Delete a purchase from Google Sheets
   */
  async deletePurchase(sheetsId: string): Promise<WriteResult> {
    if (!isSheetsWriteEnabled()) {
      return { success: true };
    }

    try {
      const existingRow = await this.sheetsClient.findRow('Purchases', 'ID', sheetsId);

      if (existingRow) {
        await this.sheetsClient.deleteRow('Purchases', existingRow.rowNumber);
        console.log(`[SheetsWrite] Deleted purchase row ${existingRow.rowNumber}`);
      }

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  // Private helpers

  private inventoryToSheetRow(
    data: InventoryWriteData,
    mapping: typeof newKitInventoryMapping
  ): (string | number | null)[] {
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

  private purchaseToSheetRow(data: PurchaseWriteData): (string | number | null)[] {
    // Purchases sheet column order: ID, Short Description, Cost, Date, Source, Payment Method, Reference, Description
    return [
      data.sheets_id || null,
      data.short_description,
      data.cost,
      formatDateForSheets(data.purchase_date),
      data.source || null,
      data.payment_method || null,
      data.reference || null,
      data.description || null,
    ];
  }

  private columnLetterToIndex(letter: string): number {
    let result = 0;
    for (let i = 0; i < letter.length; i++) {
      result = result * 26 + (letter.charCodeAt(i) - 64);
    }
    return result - 1;
  }

  private async generatePurchaseId(): Promise<string> {
    // Read existing purchases to get next ID
    const data = await this.sheetsClient.readSheet('Purchases');
    const maxId = data.reduce((max, row) => {
      const id = row['ID'];
      if (id) {
        const num = parseInt(id.replace(/\D/g, ''), 10);
        return Math.max(max, isNaN(num) ? 0 : num);
      }
      return max;
    }, 0);

    return `P${String(maxId + 1).padStart(4, '0')}`;
  }
}

// Singleton instance
let sheetsWriteServiceInstance: SheetsWriteService | null = null;

/**
 * Get or create the Sheets write service singleton
 */
export function getSheetsWriteService(): SheetsWriteService {
  if (!sheetsWriteServiceInstance) {
    sheetsWriteServiceInstance = new SheetsWriteService();
  }
  return sheetsWriteServiceInstance;
}

/**
 * Reset the singleton instance (for testing)
 */
export function resetSheetsWriteService(): void {
  sheetsWriteServiceInstance = null;
}
