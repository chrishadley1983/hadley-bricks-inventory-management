/**
 * PayPal Transaction Sync Service
 *
 * Handles syncing fee transactions from PayPal Transaction Search API
 * to the local database. Supports full sync, incremental sync, and historical imports.
 *
 * Key feature: Only stores transactions where fee_amount != 0
 */

import { createClient } from '@/lib/supabase/server';
import { paypalAuthService } from './paypal-auth.service';
import { PayPalApiAdapter } from './paypal-api.adapter';
import type {
  PayPalTransactionResponse,
  PayPalSyncResult,
  PayPalSyncMode,
  PayPalSyncOptions,
  Json,
} from './types';

// ============================================================================
// Constants
// ============================================================================

const BATCH_SIZE = 100; // Upsert batch size
const DEFAULT_SYNC_DAYS = 31; // Default days back for incremental sync

// ============================================================================
// Types
// ============================================================================

interface TransactionRow {
  user_id: string;
  paypal_transaction_id: string;
  transaction_date: string;
  transaction_updated_date: string | null;
  time_zone: string | null;
  transaction_type: string | null;
  transaction_event_code: string | null;
  transaction_status: string | null;
  gross_amount: number;
  fee_amount: number;
  net_amount: number;
  balance_amount: number | null;
  currency: string;
  description: string | null;
  from_email: string | null;
  payer_name: string | null;
  bank_name: string | null;
  bank_account: string | null;
  postage_amount: number | null;
  vat_amount: number | null;
  invoice_id: string | null;
  reference_txn_id: string | null;
  raw_response: Json;
}

// ============================================================================
// PayPalTransactionSyncService Class
// ============================================================================

export class PayPalTransactionSyncService {
  // ============================================================================
  // Transaction Sync
  // ============================================================================

  /**
   * Sync transactions from PayPal Transaction Search API
   * Only stores transactions where fee_amount != 0
   */
  async syncTransactions(userId: string, options?: PayPalSyncOptions): Promise<PayPalSyncResult> {
    console.log(
      '[PayPalTransactionSyncService] Starting transaction sync for user:',
      userId,
      'options:',
      options
    );
    const startedAt = new Date();
    const supabase = await createClient();
    const syncMode: PayPalSyncMode = options?.fromDate
      ? 'HISTORICAL'
      : options?.fullSync
        ? 'FULL'
        : 'INCREMENTAL';
    console.log('[PayPalTransactionSyncService] Sync mode:', syncMode);

    // Check for running sync
    const { data: runningSync } = await supabase
      .from('paypal_sync_log')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'RUNNING')
      .single();

    if (runningSync) {
      console.log('[PayPalTransactionSyncService] A sync is already running, skipping');
      return {
        success: false,
        syncMode,
        transactionsProcessed: 0,
        transactionsCreated: 0,
        transactionsUpdated: 0,
        transactionsSkipped: 0,
        error: 'A sync is already running',
        startedAt,
        completedAt: new Date(),
      };
    }

    // Create sync log entry
    console.log('[PayPalTransactionSyncService] Creating sync log entry');
    const { data: syncLog, error: logError } = await supabase
      .from('paypal_sync_log')
      .insert({
        user_id: userId,
        sync_mode: syncMode,
        status: 'RUNNING',
        started_at: startedAt.toISOString(),
        from_date: options?.fromDate || null,
        to_date: options?.toDate || null,
      })
      .select()
      .single();

    if (logError) {
      console.error('[PayPalTransactionSyncService] Failed to create sync log:', logError);
      throw new Error('Failed to start sync');
    }
    console.log('[PayPalTransactionSyncService] Sync log created:', syncLog.id);

    try {
      // Get access token and create API adapter
      console.log('[PayPalTransactionSyncService] Getting access token...');
      const accessToken = await paypalAuthService.getAccessToken(userId);
      if (!accessToken) {
        console.error('[PayPalTransactionSyncService] No valid access token found');
        throw new Error('No valid PayPal access token. Please reconnect to PayPal.');
      }
      console.log('[PayPalTransactionSyncService] Access token obtained');

      // Get credentials to determine sandbox mode
      const credentials = await paypalAuthService.getCredentials(userId);
      const sandbox = credentials?.sandbox ?? false;

      // Create API adapter
      const apiAdapter = new PayPalApiAdapter({ accessToken, sandbox });

      // Determine date range for sync
      const now = new Date();
      let startDate: string;
      let endDate: string = now.toISOString();

      if (options?.fromDate) {
        // Historical import with specific date range
        startDate = new Date(options.fromDate).toISOString();
        if (options.toDate) {
          endDate = new Date(options.toDate).toISOString();
        }
      } else if (options?.fullSync) {
        // Full sync - go back 3 years minus 1 day (PayPal's 3-year limit is strict)
        const threeYearsAgo = new Date(now);
        threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
        threeYearsAgo.setDate(threeYearsAgo.getDate() + 1); // Add 1 day to stay within limit
        startDate = threeYearsAgo.toISOString();
      } else {
        // Incremental sync - get cursor from last successful sync
        const { data: syncConfig } = await supabase
          .from('paypal_sync_config')
          .select('last_sync_date_cursor')
          .eq('user_id', userId)
          .single();

        if (syncConfig?.last_sync_date_cursor) {
          startDate = syncConfig.last_sync_date_cursor;
        } else {
          // No cursor, default to last 31 days
          const defaultStart = new Date(now);
          defaultStart.setDate(defaultStart.getDate() - DEFAULT_SYNC_DAYS);
          startDate = defaultStart.toISOString();
        }
      }

      console.log('[PayPalTransactionSyncService] Date range:', startDate, 'to', endDate);

      // Fetch all transactions with pagination (handles 31-day chunking internally)
      console.log(
        '[PayPalTransactionSyncService] Starting to fetch transactions from PayPal API...'
      );
      const allTransactions = await apiAdapter.getAllTransactionsInRange(startDate, endDate, {
        fields: 'all',
        onProgress: (fetched, total) => {
          console.log(`[PayPalTransactionSyncService] Progress: ${fetched}/${total} transactions`);
        },
      });

      console.log(
        '[PayPalTransactionSyncService] Total transactions fetched:',
        allTransactions.length
      );

      // Filter for transactions with fees
      const transactionsWithFees = allTransactions.filter((tx) => {
        const feeAmount = tx.transaction_info.fee_amount;
        if (!feeAmount) return false;

        const fee = parseFloat(feeAmount.value);
        // Only keep transactions where fee is not zero
        return fee !== 0;
      });

      const skipped = allTransactions.length - transactionsWithFees.length;
      console.log(
        `[PayPalTransactionSyncService] Filtered to ${transactionsWithFees.length} transactions with fees (skipped ${skipped})`
      );

      // Upsert transactions
      console.log('[PayPalTransactionSyncService] Upserting transactions to database...');
      const { created, updated } = await this.upsertTransactions(userId, transactionsWithFees);
      console.log(
        '[PayPalTransactionSyncService] Upsert complete. Created:',
        created,
        'Updated:',
        updated
      );

      // Update sync cursor to newest transaction date
      const newestDate =
        transactionsWithFees.length > 0
          ? transactionsWithFees
              .reduce((newest, tx) => {
                const txDate = new Date(tx.transaction_info.transaction_initiation_date);
                return txDate > newest ? txDate : newest;
              }, new Date(0))
              .toISOString()
          : endDate;

      // Update sync config with cursor
      await supabase.from('paypal_sync_config').upsert(
        {
          user_id: userId,
          last_sync_date_cursor: newestDate,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );

      const completedAt = new Date();

      // Update sync log
      await supabase
        .from('paypal_sync_log')
        .update({
          status: 'COMPLETED',
          completed_at: completedAt.toISOString(),
          transactions_processed: allTransactions.length,
          transactions_created: created,
          transactions_updated: updated,
          transactions_skipped: skipped,
          last_sync_cursor: newestDate,
        })
        .eq('id', syncLog.id);

      return {
        success: true,
        syncMode,
        transactionsProcessed: allTransactions.length,
        transactionsCreated: created,
        transactionsUpdated: updated,
        transactionsSkipped: skipped,
        lastSyncCursor: newestDate,
        startedAt,
        completedAt,
      };
    } catch (error) {
      const completedAt = new Date();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Update sync log with error
      await supabase
        .from('paypal_sync_log')
        .update({
          status: 'FAILED',
          completed_at: completedAt.toISOString(),
          error_message: errorMessage,
        })
        .eq('id', syncLog.id);

      return {
        success: false,
        syncMode,
        transactionsProcessed: 0,
        transactionsCreated: 0,
        transactionsUpdated: 0,
        transactionsSkipped: 0,
        error: errorMessage,
        startedAt,
        completedAt,
      };
    }
  }

  // ============================================================================
  // Historical Import
  // ============================================================================

  /**
   * Perform a historical import of transactions
   * @param userId User ID
   * @param fromDate Start date (ISO string, e.g., '2024-01-01')
   */
  async performHistoricalImport(userId: string, fromDate: string): Promise<PayPalSyncResult> {
    const supabase = await createClient();
    const toDate = new Date().toISOString();

    // Update sync config to track historical import
    await supabase.from('paypal_sync_config').upsert(
      {
        user_id: userId,
        historical_import_started_at: new Date().toISOString(),
        historical_import_from_date: fromDate,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );

    // Sync transactions
    const result = await this.syncTransactions(userId, { fromDate, toDate });

    // Update sync config to mark historical import complete
    if (result.success) {
      await supabase
        .from('paypal_sync_config')
        .update({
          historical_import_completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId);
    }

    return result;
  }

  // ============================================================================
  // Sync Status
  // ============================================================================

  /**
   * Get sync status for transactions
   */
  async getSyncStatus(userId: string): Promise<{
    isRunning: boolean;
    lastSync?: {
      status: string;
      completedAt?: Date;
      transactionsProcessed?: number;
      transactionsCreated?: number;
      transactionsUpdated?: number;
      transactionsSkipped?: number;
    };
    config?: {
      autoSyncEnabled: boolean;
      nextSyncAt?: Date;
      historicalImportCompleted: boolean;
      lastSyncDateCursor?: string;
    };
  }> {
    const supabase = await createClient();

    // Get running sync
    const { data: runningSync } = await supabase
      .from('paypal_sync_log')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'RUNNING')
      .single();

    // Get last sync
    const { data: lastSync } = await supabase
      .from('paypal_sync_log')
      .select('*')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    // Get sync config
    const { data: syncConfig } = await supabase
      .from('paypal_sync_config')
      .select('*')
      .eq('user_id', userId)
      .single();

    return {
      isRunning: !!runningSync,
      lastSync: lastSync
        ? {
            status: lastSync.status,
            completedAt: lastSync.completed_at ? new Date(lastSync.completed_at) : undefined,
            transactionsProcessed: lastSync.transactions_processed || 0,
            transactionsCreated: lastSync.transactions_created || 0,
            transactionsUpdated: lastSync.transactions_updated || 0,
            transactionsSkipped: lastSync.transactions_skipped || 0,
          }
        : undefined,
      config: syncConfig
        ? {
            autoSyncEnabled: syncConfig.auto_sync_enabled,
            nextSyncAt: syncConfig.next_auto_sync_at
              ? new Date(syncConfig.next_auto_sync_at)
              : undefined,
            historicalImportCompleted: !!syncConfig.historical_import_completed_at,
            lastSyncDateCursor: syncConfig.last_sync_date_cursor || undefined,
          }
        : undefined,
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Upsert transactions to database
   */
  private async upsertTransactions(
    userId: string,
    transactions: PayPalTransactionResponse[]
  ): Promise<{ created: number; updated: number }> {
    if (transactions.length === 0) {
      return { created: 0, updated: 0 };
    }

    const supabase = await createClient();

    // Deduplicate transactions by transactionId
    const uniqueTransactions = Array.from(
      new Map(transactions.map((tx) => [tx.transaction_info.transaction_id, tx])).values()
    );
    console.log(
      `[PayPalTransactionSyncService] Deduplicated ${transactions.length} -> ${uniqueTransactions.length} transactions`
    );

    // Get existing transaction IDs
    const { data: existingTransactions } = await supabase
      .from('paypal_transactions')
      .select('paypal_transaction_id')
      .eq('user_id', userId)
      .in(
        'paypal_transaction_id',
        uniqueTransactions.map((t) => t.transaction_info.transaction_id)
      );

    const existingIds = new Set(existingTransactions?.map((t) => t.paypal_transaction_id) || []);

    // Transform transactions
    const transactionRows: TransactionRow[] = uniqueTransactions.map((tx) => {
      const info = tx.transaction_info;
      const payer = tx.payer_info;

      // Parse amounts
      const grossAmount = parseFloat(info.transaction_amount.value);
      const feeAmount = info.fee_amount ? parseFloat(info.fee_amount.value) : 0;
      const netAmount = grossAmount - Math.abs(feeAmount); // Fee is usually negative
      const balanceAmount = info.ending_balance ? parseFloat(info.ending_balance.value) : null;

      // Get payer name
      let payerName: string | null = null;
      if (payer?.payer_name) {
        if (payer.payer_name.alternate_full_name) {
          payerName = payer.payer_name.alternate_full_name;
        } else if (payer.payer_name.given_name || payer.payer_name.surname) {
          payerName = [payer.payer_name.given_name, payer.payer_name.surname]
            .filter(Boolean)
            .join(' ');
        }
      }

      return {
        user_id: userId,
        paypal_transaction_id: info.transaction_id,
        transaction_date: info.transaction_initiation_date,
        transaction_updated_date: info.transaction_updated_date || null,
        time_zone: null, // PayPal API returns dates in ISO format with timezone
        transaction_type: info.transaction_subject || null,
        transaction_event_code: info.transaction_event_code || null,
        transaction_status: info.transaction_status || null,
        gross_amount: grossAmount,
        fee_amount: Math.abs(feeAmount), // Store as positive number
        net_amount: netAmount,
        balance_amount: balanceAmount,
        currency: info.transaction_amount.currency_code,
        description: info.transaction_note || info.transaction_subject || null,
        from_email: payer?.email_address || null,
        payer_name: payerName,
        bank_name: null, // Not directly available in API response
        bank_account: null, // Not directly available in API response
        postage_amount: null, // Would need to extract from cart_info
        vat_amount: null, // Would need to extract from cart_info.tax_amounts
        invoice_id: info.invoice_id || null,
        reference_txn_id: null, // Not directly available in transaction_info
        raw_response: tx as unknown as Json,
      };
    });

    // Upsert in batches
    let created = 0;
    let updated = 0;

    for (let i = 0; i < transactionRows.length; i += BATCH_SIZE) {
      const batch = transactionRows.slice(i, i + BATCH_SIZE);

      const { error } = await supabase.from('paypal_transactions').upsert(batch, {
        onConflict: 'user_id,paypal_transaction_id',
        ignoreDuplicates: false,
      });

      if (error) {
        console.error('[PayPalTransactionSyncService] Failed to upsert transactions:', error);
        throw new Error('Failed to save transactions');
      }

      for (const row of batch) {
        if (existingIds.has(row.paypal_transaction_id)) {
          updated++;
        } else {
          created++;
        }
      }
    }

    return { created, updated };
  }
}

// Export a default instance
export const paypalTransactionSyncService = new PayPalTransactionSyncService();
