/**
 * Monzo Sheets Sync Service
 *
 * Syncs Monzo transactions from Google Sheets instead of the Monzo API.
 * The source is a live-connected "Monzo Transactions" sheet in the Lego Planning spreadsheet.
 *
 * Features:
 * - Full sync: Load all transactions from sheets
 * - Incremental sync: Only new transactions since last sync
 * - Duplicate prevention via unique constraint
 * - Preserves user's local_category and user_notes edits
 */

import { createClient } from '@/lib/supabase/server';
import { getSheetsClient } from '@/lib/google/sheets-client';

// ============================================================================
// Types
// ============================================================================

interface SheetMonzoTransaction {
  'Transaction ID': string;
  Date: string;
  Time: string;
  Type: string;
  Name: string;
  Emoji: string;
  Category: string;
  Amount: string;
  Currency: string;
  'Local amount': string;
  'Local currency': string;
  'Notes and #tags': string;
  Address: string;
  Receipt: string;
  Description: string;
  'Category split': string;
}

export interface MonzoSheetsSyncResult {
  success: boolean;
  transactionsProcessed: number;
  transactionsCreated: number;
  transactionsUpdated: number;
  error?: string;
}

// ============================================================================
// Constants
// ============================================================================

const MONZO_SHEET_NAME = 'Monzo Transactions';

// ============================================================================
// MonzoSheetsSyncService Class
// ============================================================================

export class MonzoSheetsSyncService {
  /**
   * Perform a full sync from Google Sheets
   * Loads all transactions and upserts them into the database
   */
  async performFullSync(userId: string): Promise<MonzoSheetsSyncResult> {
    return this.performSync(userId, 'FULL');
  }

  /**
   * Perform an incremental sync from Google Sheets
   * Only processes transactions newer than the last sync
   */
  async performIncrementalSync(userId: string): Promise<MonzoSheetsSyncResult> {
    return this.performSync(userId, 'INCREMENTAL');
  }

  /**
   * Main sync logic
   */
  private async performSync(
    userId: string,
    syncType: 'FULL' | 'INCREMENTAL'
  ): Promise<MonzoSheetsSyncResult> {
    const supabase = await createClient();
    const startedAt = new Date();

    // Create sync log entry
    const { data: syncLog, error: syncLogError } = await supabase
      .from('monzo_sync_log')
      .insert({
        user_id: userId,
        sync_type: syncType,
        status: 'RUNNING',
        started_at: startedAt.toISOString(),
        source: 'sheets',
      })
      .select()
      .single();

    if (syncLogError) {
      console.error('[MonzoSheetsSyncService] Failed to create sync log:', syncLogError);
      return {
        success: false,
        transactionsProcessed: 0,
        transactionsCreated: 0,
        transactionsUpdated: 0,
        error: 'Failed to initialize sync',
      };
    }

    try {
      // Read transactions from Google Sheets
      const sheetsClient = getSheetsClient();
      const sheetData = (await sheetsClient.readSheet(MONZO_SHEET_NAME)) as unknown as SheetMonzoTransaction[];

      console.log(`[MonzoSheetsSyncService] Read ${sheetData.length} transactions from sheets`);

      // Get last sync timestamp for incremental
      let lastSyncDate: Date | null = null;
      if (syncType === 'INCREMENTAL') {
        const { data: lastSync } = await supabase
          .from('monzo_sync_log')
          .select('completed_at')
          .eq('user_id', userId)
          .eq('status', 'COMPLETED')
          .eq('source', 'sheets')
          .order('completed_at', { ascending: false })
          .limit(1)
          .single();

        if (lastSync?.completed_at) {
          lastSyncDate = new Date(lastSync.completed_at);
        }
      }

      // Get existing transaction IDs to check for updates vs inserts
      // Use pagination to handle >1000 transactions (Supabase row limit)
      const existingTransactions: Array<{
        monzo_transaction_id: string;
        local_category: string | null;
        user_notes: string | null;
      }> = [];
      const PAGE_SIZE = 1000;
      let page = 0;
      let hasMore = true;

      while (hasMore) {
        const { data } = await supabase
          .from('monzo_transactions')
          .select('monzo_transaction_id, local_category, user_notes')
          .eq('user_id', userId)
          .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

        existingTransactions.push(...(data ?? []));
        hasMore = (data?.length ?? 0) === PAGE_SIZE;
        page++;
      }

      console.log(`[MonzoSheetsSyncService] Found ${existingTransactions.length} existing transactions`);

      const existingMap = new Map(
        existingTransactions.map((t) => [
          t.monzo_transaction_id,
          { local_category: t.local_category, user_notes: t.user_notes },
        ])
      );

      // Transform and filter transactions
      const transactionsToProcess = sheetData
        .filter((row) => row['Transaction ID']) // Skip rows without ID
        .filter((row) => {
          if (!lastSyncDate) return true;
          const txDate = this.parseSheetDate(row.Date, row.Time);
          return txDate && txDate > lastSyncDate;
        })
        .map((row) => this.transformSheetRow(row, userId, existingMap));

      console.log(
        `[MonzoSheetsSyncService] Processing ${transactionsToProcess.length} transactions`
      );

      // Upsert in batches
      const batchSize = 100;
      let created = 0;
      let updated = 0;

      for (let i = 0; i < transactionsToProcess.length; i += batchSize) {
        const batch = transactionsToProcess.slice(i, i + batchSize);

        // Check which ones exist
        const batchIds = batch.map((t) => t.monzo_transaction_id);
        const existingInBatch = new Set(
          batchIds.filter((id) => existingMap.has(id))
        );

        const { error: upsertError } = await supabase
          .from('monzo_transactions')
          .upsert(batch, {
            onConflict: 'user_id,monzo_transaction_id',
            ignoreDuplicates: false,
          });

        if (upsertError) {
          console.error('[MonzoSheetsSyncService] Upsert error:', upsertError);
          throw new Error(`Failed to upsert batch: ${upsertError.message}`);
        }

        // Count creates vs updates
        batch.forEach((t) => {
          if (existingInBatch.has(t.monzo_transaction_id)) {
            updated++;
          } else {
            created++;
          }
        });
      }

      // Update sync log with success
      await supabase
        .from('monzo_sync_log')
        .update({
          status: 'COMPLETED',
          completed_at: new Date().toISOString(),
          transactions_processed: transactionsToProcess.length,
          transactions_created: created,
          transactions_updated: updated,
        })
        .eq('id', syncLog.id);

      return {
        success: true,
        transactionsProcessed: transactionsToProcess.length,
        transactionsCreated: created,
        transactionsUpdated: updated,
      };
    } catch (error) {
      console.error('[MonzoSheetsSyncService] Sync error:', error);

      // Update sync log with failure
      await supabase
        .from('monzo_sync_log')
        .update({
          status: 'FAILED',
          completed_at: new Date().toISOString(),
          error_message: error instanceof Error ? error.message : 'Unknown error',
        })
        .eq('id', syncLog.id);

      return {
        success: false,
        transactionsProcessed: 0,
        transactionsCreated: 0,
        transactionsUpdated: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Transform a sheet row to database format
   */
  private transformSheetRow(
    row: SheetMonzoTransaction,
    userId: string,
    existingMap: Map<string, { local_category: string | null; user_notes: string | null }>
  ) {
    const existing = existingMap.get(row['Transaction ID']);
    const txDate = this.parseSheetDate(row.Date, row.Time);
    const txTime = this.parseSheetTime(row.Time);

    // Parse amount - sheets has decimal (e.g., "5000.00"), DB wants minor units (pence)
    const amountDecimal = parseFloat(row.Amount) || 0;
    const amountPence = Math.round(amountDecimal * 100);

    const localAmountDecimal = parseFloat(row['Local amount']) || amountDecimal;
    const localAmountPence = Math.round(localAmountDecimal * 100);

    return {
      user_id: userId,
      monzo_transaction_id: row['Transaction ID'],
      account_id: null, // Not available from sheets
      amount: amountPence,
      currency: row.Currency || 'GBP',
      description: row.Description || null,
      merchant: null, // Not available from sheets
      merchant_name: row.Name || null,
      category: null, // Monzo's original category not in export
      // Use existing local_category if user edited it, otherwise use sheets category
      local_category: existing?.local_category || row.Category || null,
      // Preserve user's notes if they edited, otherwise use sheets notes
      user_notes: existing?.user_notes || row['Notes and #tags'] || null,
      tags: [],
      is_load: row.Type === 'Pot transfer' || row.Name?.includes('Pot'),
      settled: txDate?.toISOString() || null,
      created: txDate?.toISOString() || new Date().toISOString(),
      decline_reason: null,
      metadata: null,
      raw_response: JSON.parse(JSON.stringify(row)), // Store original sheet row
      transaction_type: row.Type || null,
      emoji: row.Emoji || null,
      local_amount: localAmountPence,
      local_currency: row['Local currency'] || row.Currency || 'GBP',
      address: row.Address || null,
      transaction_time: txTime,
      data_source: 'sheets' as const,
    };
  }

  /**
   * Parse date from sheets format (DD/MM/YYYY) with optional time
   */
  private parseSheetDate(dateStr: string, timeStr?: string): Date | null {
    if (!dateStr) return null;

    // Parse DD/MM/YYYY
    const parts = dateStr.split('/');
    if (parts.length !== 3) return null;

    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1; // JS months are 0-indexed
    const year = parseInt(parts[2], 10);

    let hours = 0;
    let minutes = 0;
    let seconds = 0;

    if (timeStr) {
      const timeParts = timeStr.split(':');
      hours = parseInt(timeParts[0], 10) || 0;
      minutes = parseInt(timeParts[1], 10) || 0;
      seconds = parseInt(timeParts[2], 10) || 0;
    }

    return new Date(year, month, day, hours, minutes, seconds);
  }

  /**
   * Parse time for storage in time column
   */
  private parseSheetTime(timeStr: string): string | null {
    if (!timeStr) return null;
    // Return as-is if it looks like HH:MM:SS
    if (/^\d{2}:\d{2}(:\d{2})?$/.test(timeStr)) {
      return timeStr;
    }
    return null;
  }

  /**
   * Get sync status
   */
  async getSyncStatus(userId: string) {
    const supabase = await createClient();

    // Get latest sync
    const { data: latestSync } = await supabase
      .from('monzo_sync_log')
      .select('*')
      .eq('user_id', userId)
      .eq('source', 'sheets')
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    // Get transaction count
    const { count: transactionCount } = await supabase
      .from('monzo_transactions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    // Check if a sync is currently running
    const { data: runningSync } = await supabase
      .from('monzo_sync_log')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'RUNNING')
      .eq('source', 'sheets')
      .limit(1)
      .single();

    return {
      isConnected: true, // Sheets is always "connected"
      lastSync: latestSync
        ? {
            type: latestSync.sync_type as 'FULL' | 'INCREMENTAL',
            status: latestSync.status as 'RUNNING' | 'COMPLETED' | 'FAILED',
            startedAt: latestSync.started_at,
            completedAt: latestSync.completed_at,
            transactionsProcessed: latestSync.transactions_processed,
            error: latestSync.error_message,
          }
        : null,
      transactionCount: transactionCount || 0,
      isRunning: !!runningSync,
    };
  }
}

// Export singleton instance
export const monzoSheetsSyncService = new MonzoSheetsSyncService();
