import { GoogleSheetsClient } from '@/lib/google/sheets-client';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  SheetMapping,
  transformRow,
  addConditionFromSheet,
  newKitInventoryMapping,
  usedKitInventoryMapping,
  purchasesMapping,
} from './sheet-mappings';

// Generic database type for dynamic table access
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GenericDatabase = any;

/**
 * Result of migrating a single row
 */
export interface MigrationRowResult {
  rowNumber: number;
  sheetId: string;
  success: boolean;
  supabaseId?: string;
  error?: string;
  action: 'created' | 'updated' | 'skipped';
}

/**
 * Result of migrating a sheet
 */
export interface MigrationSheetResult {
  sheetName: string;
  totalRows: number;
  successCount: number;
  errorCount: number;
  skippedCount: number;
  rows: MigrationRowResult[];
  duration: number;
}

/**
 * Overall migration result
 */
export interface MigrationResult {
  startTime: Date;
  endTime: Date;
  duration: number;
  sheets: MigrationSheetResult[];
  totalSuccess: number;
  totalErrors: number;
  totalSkipped: number;
}

/**
 * Migration options
 */
export interface MigrationOptions {
  /** If true, don't actually write to Supabase */
  dryRun?: boolean;
  /** Only process this many rows (for testing) */
  limit?: number;
  /** Skip rows until this row number */
  startFromRow?: number;
  /** User ID to assign to migrated records */
  userId: string;
  /** Whether to update existing records or skip them */
  updateExisting?: boolean;
}

/**
 * Migration service for importing Google Sheets data into Supabase
 */
export class MigrationService {
  private sheetsClient: GoogleSheetsClient;
  private supabase: SupabaseClient<GenericDatabase>;

  constructor(
    sheetsClient: GoogleSheetsClient,
    supabaseUrl: string,
    supabaseServiceKey: string
  ) {
    this.sheetsClient = sheetsClient;
    // Use service role key for migration (bypasses RLS)
    this.supabase = createClient<GenericDatabase>(supabaseUrl, supabaseServiceKey);
  }

  /**
   * Migrate inventory data from both New and Used Kit sheets
   */
  async migrateInventory(options: MigrationOptions): Promise<MigrationResult> {
    const startTime = new Date();
    const sheets: MigrationSheetResult[] = [];

    // Migrate New Kit Inventory
    console.log('Migrating New Kit Inventory...');
    const newKitResult = await this.migrateSheet(newKitInventoryMapping, options);
    sheets.push(newKitResult);

    // Migrate Used Kit Inventory
    console.log('Migrating Used Kit Inventory...');
    const usedKitResult = await this.migrateSheet(usedKitInventoryMapping, options);
    sheets.push(usedKitResult);

    const endTime = new Date();
    const totalSuccess = sheets.reduce((sum, s) => sum + s.successCount, 0);
    const totalErrors = sheets.reduce((sum, s) => sum + s.errorCount, 0);
    const totalSkipped = sheets.reduce((sum, s) => sum + s.skippedCount, 0);

    return {
      startTime,
      endTime,
      duration: endTime.getTime() - startTime.getTime(),
      sheets,
      totalSuccess,
      totalErrors,
      totalSkipped,
    };
  }

  /**
   * Migrate purchases data
   */
  async migratePurchases(options: MigrationOptions): Promise<MigrationResult> {
    const startTime = new Date();
    const sheets: MigrationSheetResult[] = [];

    console.log('Migrating Purchases...');
    const result = await this.migrateSheet(purchasesMapping, options);
    sheets.push(result);

    const endTime = new Date();

    return {
      startTime,
      endTime,
      duration: endTime.getTime() - startTime.getTime(),
      sheets,
      totalSuccess: result.successCount,
      totalErrors: result.errorCount,
      totalSkipped: result.skippedCount,
    };
  }

  /**
   * Migrate a single sheet using the provided mapping
   */
  async migrateSheet(
    mapping: SheetMapping,
    options: MigrationOptions
  ): Promise<MigrationSheetResult> {
    const startTime = Date.now();
    const rows: MigrationRowResult[] = [];
    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;

    // Read all data from the sheet
    const sheetData = await this.sheetsClient.readSheet(mapping.sheetName);
    let dataToProcess = sheetData;

    // Apply start row filter
    if (options.startFromRow && options.startFromRow > 1) {
      dataToProcess = dataToProcess.slice(options.startFromRow - 2); // -2 because header is row 1
    }

    // Apply limit
    if (options.limit) {
      dataToProcess = dataToProcess.slice(0, options.limit);
    }

    console.log(`  Processing ${dataToProcess.length} rows from "${mapping.sheetName}"...`);

    for (let i = 0; i < dataToProcess.length; i++) {
      const row = dataToProcess[i];
      const rowNumber = (options.startFromRow || 2) + i;
      const sheetId = row[mapping.columns.find((c) => c.sheetColumn === mapping.uniqueKeyColumn)?.sheetHeader || ''] || '';

      // Skip empty rows
      if (!sheetId || sheetId.trim() === '') {
        skippedCount++;
        rows.push({
          rowNumber,
          sheetId: '',
          success: true,
          action: 'skipped',
        });
        continue;
      }

      try {
        // Transform the row data
        let transformedData = transformRow(row, mapping);

        // Add condition based on sheet name (for inventory)
        if (mapping.supabaseTable === 'inventory_items') {
          transformedData = addConditionFromSheet(transformedData, mapping.sheetName);
        }

        // Add user_id
        transformedData.user_id = options.userId;

        // Check if record already exists
        const existingRecord = await this.findExistingRecord(
          mapping.supabaseTable,
          sheetId,
          options.userId
        );

        if (options.dryRun) {
          // Dry run - just log what would happen
          const action = existingRecord
            ? options.updateExisting
              ? 'updated'
              : 'skipped'
            : 'created';

          if (action === 'skipped') {
            skippedCount++;
          } else {
            successCount++;
          }

          rows.push({
            rowNumber,
            sheetId,
            success: true,
            action,
          });
          continue;
        }

        if (existingRecord) {
          if (options.updateExisting) {
            // Update existing record
            const { error } = await this.supabase
              .from(mapping.supabaseTable)
              .update(transformedData)
              .eq('id', existingRecord.id);

            if (error) throw error;

            successCount++;
            rows.push({
              rowNumber,
              sheetId,
              success: true,
              supabaseId: existingRecord.id,
              action: 'updated',
            });
          } else {
            // Skip existing record
            skippedCount++;
            rows.push({
              rowNumber,
              sheetId,
              success: true,
              supabaseId: existingRecord.id,
              action: 'skipped',
            });
          }
        } else {
          // Create new record
          const { data, error } = await this.supabase
            .from(mapping.supabaseTable)
            .insert(transformedData)
            .select('id')
            .single();

          if (error) throw error;

          successCount++;
          rows.push({
            rowNumber,
            sheetId,
            success: true,
            supabaseId: data?.id,
            action: 'created',
          });
        }
      } catch (error) {
        errorCount++;
        let errorMessage = 'Unknown error';
        if (error instanceof Error) {
          errorMessage = error.message;
        } else if (typeof error === 'object' && error !== null) {
          // Handle Supabase PostgrestError and other object errors
          errorMessage = JSON.stringify(error);
        }
        rows.push({
          rowNumber,
          sheetId,
          success: false,
          error: errorMessage,
          action: 'skipped',
        });
      }

      // Log progress every 100 rows
      if ((i + 1) % 100 === 0) {
        console.log(`    Processed ${i + 1}/${dataToProcess.length} rows...`);
      }
    }

    const duration = Date.now() - startTime;
    console.log(
      `  Completed "${mapping.sheetName}": ${successCount} success, ${errorCount} errors, ${skippedCount} skipped (${duration}ms)`
    );

    return {
      sheetName: mapping.sheetName,
      totalRows: dataToProcess.length,
      successCount,
      errorCount,
      skippedCount,
      rows,
      duration,
    };
  }

  /**
   * Find an existing record by SKU (for inventory) or sheets_id (for other tables)
   */
  private async findExistingRecord(
    table: string,
    sheetId: string,
    userId: string
  ): Promise<{ id: string } | null> {
    if (table === 'inventory_items') {
      // For inventory, look up by SKU
      const { data } = await this.supabase
        .from(table)
        .select('id')
        .eq('sku', sheetId)
        .eq('user_id', userId)
        .single();
      return data;
    } else {
      // For other tables, look up by sheets_id if it exists
      const { data } = await this.supabase
        .from(table)
        .select('id')
        .eq('sheets_id', sheetId)
        .eq('user_id', userId)
        .single();
      return data;
    }
  }

  /**
   * Get migration status/statistics
   */
  async getMigrationStats(userId: string): Promise<{
    inventory: { total: number; new: number; used: number };
    purchases: { total: number };
  }> {
    const { count: inventoryCount } = await this.supabase
      .from('inventory_items')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    const { count: newCount } = await this.supabase
      .from('inventory_items')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('condition', 'New');

    const { count: usedCount } = await this.supabase
      .from('inventory_items')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('condition', 'Used');

    const { count: purchasesCount } = await this.supabase
      .from('purchases')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    return {
      inventory: {
        total: inventoryCount || 0,
        new: newCount || 0,
        used: usedCount || 0,
      },
      purchases: {
        total: purchasesCount || 0,
      },
    };
  }
}

/**
 * Create a migration service instance
 */
export function createMigrationService(
  sheetsClient: GoogleSheetsClient
): MigrationService {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      'Missing Supabase configuration. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
    );
  }

  return new MigrationService(sheetsClient, supabaseUrl, supabaseServiceKey);
}
