/**
 * eBay Transaction Sync Service
 *
 * Handles syncing financial transactions and payouts from eBay Finances API
 * to the local database. Supports full sync, incremental sync, and historical imports.
 *
 * Based on the Monzo sync pattern with adaptations for eBay's API structure.
 */

import { createClient } from '@/lib/supabase/server';
import { ebayAuthService } from './ebay-auth.service';
import { EbayApiAdapter } from './ebay-api.adapter';
import type {
  EbayTransactionResponse,
  EbayPayoutResponse,
  EbayTransactionsResponse,
  EbayPayoutsResponse,
} from './types';
import type { Json } from '@hadley-bricks/database';

// ============================================================================
// Constants
// ============================================================================

const BATCH_SIZE = 100; // Upsert batch size
const MAX_TRANSACTIONS_PER_PAGE = 1000; // eBay's max for getTransactions
const MAX_PAYOUTS_PER_PAGE = 200; // eBay max for getPayouts
const RATE_LIMIT_DELAY_MS = 150; // Delay between paginated requests

// Fee type mappings from eBay to our columns
const FEE_TYPE_MAPPING: Record<string, string> = {
  FINAL_VALUE_FEE_FIXED_PER_ORDER: 'final_value_fee_fixed',
  FINAL_VALUE_FEE: 'final_value_fee_variable',
  REGULATORY_OPERATING_FEE: 'regulatory_operating_fee',
  INTERNATIONAL_FEE: 'international_fee',
  AD_FEE: 'ad_fee',
  INSERTION_FEE: 'insertion_fee',
};

// ============================================================================
// Types
// ============================================================================

export interface EbaySyncResult {
  success: boolean;
  syncType: 'FULL' | 'INCREMENTAL' | 'HISTORICAL';
  recordsProcessed: number;
  recordsCreated: number;
  recordsUpdated: number;
  lastSyncCursor?: string;
  error?: string;
  startedAt: Date;
  completedAt: Date;
}

export interface EbaySyncOptions {
  fullSync?: boolean;
  fromDate?: string; // ISO date string for historical imports
  toDate?: string; // ISO date string for historical imports
}

interface TransactionRow {
  user_id: string;
  ebay_transaction_id: string;
  ebay_order_id: string | null;
  transaction_type: string;
  transaction_status: string;
  transaction_date: string;
  amount: number;
  currency: string;
  booking_entry: string;
  payout_id: string | null;
  buyer_username: string | null;
  transaction_memo: string | null;
  order_line_items: Json | null;
  total_fee_amount: number | null;
  total_fee_currency: string | null;
  final_value_fee_fixed: number | null;
  final_value_fee_variable: number | null;
  regulatory_operating_fee: number | null;
  international_fee: number | null;
  ad_fee: number | null;
  insertion_fee: number | null;
  gross_transaction_amount: number | null;
  sales_record_reference: string | null;
  item_title: string | null;
  custom_label: string | null;
  quantity: number | null;
  raw_response: Json;
}

interface PayoutRow {
  user_id: string;
  ebay_payout_id: string;
  payout_status: string;
  payout_date: string;
  amount: number;
  currency: string;
  payout_instrument: Json | null;
  transaction_count: number | null;
  payout_memo: string | null;
  bank_reference: string | null;
  last_attempted_payout_date: string | null;
  raw_response: Json;
}

// ============================================================================
// EbayTransactionSyncService Class
// ============================================================================

export class EbayTransactionSyncService {
  // ============================================================================
  // Transaction Sync
  // ============================================================================

  /**
   * Sync transactions from eBay Finances API
   */
  async syncTransactions(userId: string, options?: EbaySyncOptions): Promise<EbaySyncResult> {
    console.log('[EbayTransactionSyncService] Starting transaction sync for user:', userId, 'options:', options);
    const startedAt = new Date();
    const supabase = await createClient();
    const syncMode = options?.fromDate ? 'HISTORICAL' : options?.fullSync ? 'FULL' : 'INCREMENTAL';
    console.log('[EbayTransactionSyncService] Sync mode:', syncMode);

    // Check for running sync
    const { data: runningSync } = await supabase
      .from('ebay_sync_log')
      .select('id')
      .eq('user_id', userId)
      .eq('sync_type', 'TRANSACTIONS')
      .eq('status', 'RUNNING')
      .single();

    if (runningSync) {
      console.log('[EbayTransactionSyncService] A sync is already running, skipping');
      return {
        success: false,
        syncType: syncMode,
        recordsProcessed: 0,
        recordsCreated: 0,
        recordsUpdated: 0,
        error: 'A transaction sync is already running',
        startedAt,
        completedAt: new Date(),
      };
    }

    // Create sync log entry
    console.log('[EbayTransactionSyncService] Creating sync log entry');
    const { data: syncLog, error: logError } = await supabase
      .from('ebay_sync_log')
      .insert({
        user_id: userId,
        sync_type: 'TRANSACTIONS',
        sync_mode: syncMode,
        status: 'RUNNING',
        started_at: startedAt.toISOString(),
        from_date: options?.fromDate || null,
        to_date: options?.toDate || null,
      })
      .select()
      .single();

    if (logError) {
      console.error('[EbayTransactionSyncService] Failed to create sync log:', logError);
      throw new Error('Failed to start sync');
    }
    console.log('[EbayTransactionSyncService] Sync log created:', syncLog.id);

    try {
      // Get access token and create API adapter
      console.log('[EbayTransactionSyncService] Getting access token...');
      const accessToken = await ebayAuthService.getAccessToken(userId);
      if (!accessToken) {
        console.error('[EbayTransactionSyncService] No valid access token found');
        throw new Error('No valid eBay access token. Please reconnect to eBay.');
      }
      console.log('[EbayTransactionSyncService] Access token obtained');

      // Create API adapter with userId for signing key management
      const apiAdapter = new EbayApiAdapter({ accessToken, userId });

      // Determine date range for sync
      let fromDate: string | undefined;
      let toDate: string | undefined;

      if (options?.fromDate) {
        // Historical import with specific date range
        fromDate = options.fromDate;
        toDate = options.toDate || new Date().toISOString();
      } else if (!options?.fullSync) {
        // Incremental sync - get cursor from last successful sync
        const { data: syncConfig } = await supabase
          .from('ebay_sync_config')
          .select('transactions_date_cursor')
          .eq('user_id', userId)
          .single();

        if (syncConfig?.transactions_date_cursor) {
          fromDate = syncConfig.transactions_date_cursor;
        }
      }

      // Build filter
      const filter = EbayApiAdapter.buildTransactionDateFilter(fromDate, toDate);
      console.log('[EbayTransactionSyncService] Date filter:', filter);

      // Fetch all transactions with pagination
      const allTransactions: EbayTransactionResponse[] = [];
      let offset = 0;
      let hasMore = true;

      console.log('[EbayTransactionSyncService] Starting to fetch transactions from eBay API...');
      while (hasMore) {
        console.log('[EbayTransactionSyncService] Fetching transactions, offset:', offset);
        try {
          const response: EbayTransactionsResponse = await apiAdapter.getTransactions({
            filter,
            limit: MAX_TRANSACTIONS_PER_PAGE,
            offset,
          });
          console.log('[EbayTransactionSyncService] Received', response.transactions?.length || 0, 'transactions, total:', response.total);

          allTransactions.push(...(response.transactions || []));

          if (offset + MAX_TRANSACTIONS_PER_PAGE >= response.total) {
            hasMore = false;
          } else {
            offset += MAX_TRANSACTIONS_PER_PAGE;
            await this.delay(RATE_LIMIT_DELAY_MS);
          }
        } catch (apiError) {
          console.error('[EbayTransactionSyncService] API error fetching transactions:', apiError);
          throw apiError;
        }
      }

      console.log('[EbayTransactionSyncService] Total transactions fetched:', allTransactions.length);

      // Upsert transactions
      console.log('[EbayTransactionSyncService] Upserting transactions to database...');
      const { created, updated } = await this.upsertTransactions(userId, allTransactions);
      console.log('[EbayTransactionSyncService] Upsert complete. Created:', created, 'Updated:', updated);

      // Update sync cursor to newest transaction date
      const newestDate = allTransactions.length > 0
        ? allTransactions.reduce((newest, tx) => {
            const txDate = new Date(tx.transactionDate);
            return txDate > newest ? txDate : newest;
          }, new Date(0)).toISOString()
        : fromDate;

      // Update sync config with cursor
      if (newestDate) {
        await supabase
          .from('ebay_sync_config')
          .upsert({
            user_id: userId,
            transactions_date_cursor: newestDate,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id' });
      }

      const completedAt = new Date();

      // Update sync log
      await supabase
        .from('ebay_sync_log')
        .update({
          status: 'COMPLETED',
          completed_at: completedAt.toISOString(),
          records_processed: allTransactions.length,
          records_created: created,
          records_updated: updated,
          last_sync_cursor: newestDate,
        })
        .eq('id', syncLog.id);

      return {
        success: true,
        syncType: syncMode,
        recordsProcessed: allTransactions.length,
        recordsCreated: created,
        recordsUpdated: updated,
        lastSyncCursor: newestDate,
        startedAt,
        completedAt,
      };
    } catch (error) {
      const completedAt = new Date();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Update sync log with error
      await supabase
        .from('ebay_sync_log')
        .update({
          status: 'FAILED',
          completed_at: completedAt.toISOString(),
          error_message: errorMessage,
        })
        .eq('id', syncLog.id);

      return {
        success: false,
        syncType: syncMode,
        recordsProcessed: 0,
        recordsCreated: 0,
        recordsUpdated: 0,
        error: errorMessage,
        startedAt,
        completedAt,
      };
    }
  }

  // ============================================================================
  // Payout Sync
  // ============================================================================

  /**
   * Sync payouts from eBay Finances API
   */
  async syncPayouts(userId: string, options?: EbaySyncOptions): Promise<EbaySyncResult> {
    console.log('[EbayTransactionSyncService] Starting payout sync for user:', userId, 'options:', options);
    const startedAt = new Date();
    const supabase = await createClient();
    const syncMode = options?.fromDate ? 'HISTORICAL' : options?.fullSync ? 'FULL' : 'INCREMENTAL';
    console.log('[EbayTransactionSyncService] Payout sync mode:', syncMode);

    // Check for running sync
    const { data: runningSync } = await supabase
      .from('ebay_sync_log')
      .select('id')
      .eq('user_id', userId)
      .eq('sync_type', 'PAYOUTS')
      .eq('status', 'RUNNING')
      .single();

    if (runningSync) {
      console.log('[EbayTransactionSyncService] A payout sync is already running, skipping');
      return {
        success: false,
        syncType: syncMode,
        recordsProcessed: 0,
        recordsCreated: 0,
        recordsUpdated: 0,
        error: 'A payout sync is already running',
        startedAt,
        completedAt: new Date(),
      };
    }

    // Create sync log entry
    console.log('[EbayTransactionSyncService] Creating payout sync log entry');
    const { data: syncLog, error: logError } = await supabase
      .from('ebay_sync_log')
      .insert({
        user_id: userId,
        sync_type: 'PAYOUTS',
        sync_mode: syncMode,
        status: 'RUNNING',
        started_at: startedAt.toISOString(),
        from_date: options?.fromDate || null,
        to_date: options?.toDate || null,
      })
      .select()
      .single();

    if (logError) {
      console.error('[EbayTransactionSyncService] Failed to create payout sync log:', logError);
      throw new Error('Failed to start sync');
    }
    console.log('[EbayTransactionSyncService] Payout sync log created:', syncLog.id);

    try {
      // Get access token and create API adapter
      console.log('[EbayTransactionSyncService] Getting access token for payouts...');
      const accessToken = await ebayAuthService.getAccessToken(userId);
      if (!accessToken) {
        console.error('[EbayTransactionSyncService] No valid access token found for payouts');
        throw new Error('No valid eBay access token. Please reconnect to eBay.');
      }
      console.log('[EbayTransactionSyncService] Access token obtained for payouts');

      // Create API adapter with userId for signing key management
      const apiAdapter = new EbayApiAdapter({ accessToken, userId });

      // Determine date range for sync
      let fromDate: string | undefined;
      let toDate: string | undefined;

      if (options?.fromDate) {
        fromDate = options.fromDate;
        toDate = options.toDate || new Date().toISOString();
      } else if (!options?.fullSync) {
        const { data: syncConfig } = await supabase
          .from('ebay_sync_config')
          .select('payouts_date_cursor')
          .eq('user_id', userId)
          .single();

        if (syncConfig?.payouts_date_cursor) {
          fromDate = syncConfig.payouts_date_cursor;
        }
      }

      // Build filter for payouts using the proper helper
      const filter = EbayApiAdapter.buildPayoutDateFilter(fromDate, toDate);
      console.log('[EbayTransactionSyncService] Payout date filter:', filter);

      // Fetch all payouts with pagination
      const allPayouts: EbayPayoutResponse[] = [];
      let offset = 0;
      let hasMore = true;

      console.log('[EbayTransactionSyncService] Starting to fetch payouts from eBay API...');
      while (hasMore) {
        console.log('[EbayTransactionSyncService] Fetching payouts, offset:', offset);
        try {
          const response: EbayPayoutsResponse = await apiAdapter.getPayouts({
            filter,
            limit: MAX_PAYOUTS_PER_PAGE,
            offset,
          });
          console.log('[EbayTransactionSyncService] Received', response.payouts?.length || 0, 'payouts, total:', response.total);

          allPayouts.push(...(response.payouts || []));

          if (offset + MAX_PAYOUTS_PER_PAGE >= response.total) {
            hasMore = false;
          } else {
            offset += MAX_PAYOUTS_PER_PAGE;
            await this.delay(RATE_LIMIT_DELAY_MS);
          }
        } catch (apiError) {
          console.error('[EbayTransactionSyncService] API error fetching payouts:', apiError);
          throw apiError;
        }
      }

      console.log('[EbayTransactionSyncService] Total payouts fetched:', allPayouts.length);

      // Upsert payouts
      console.log('[EbayTransactionSyncService] Upserting payouts to database...');
      const { created, updated } = await this.upsertPayouts(userId, allPayouts);
      console.log('[EbayTransactionSyncService] Payout upsert complete. Created:', created, 'Updated:', updated);

      // Update sync cursor
      const newestDate = allPayouts.length > 0
        ? allPayouts.reduce((newest, p) => {
            const pDate = new Date(p.payoutDate);
            return pDate > newest ? pDate : newest;
          }, new Date(0)).toISOString()
        : fromDate;

      if (newestDate) {
        await supabase
          .from('ebay_sync_config')
          .upsert({
            user_id: userId,
            payouts_date_cursor: newestDate,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id' });
      }

      const completedAt = new Date();

      // Update sync log
      await supabase
        .from('ebay_sync_log')
        .update({
          status: 'COMPLETED',
          completed_at: completedAt.toISOString(),
          records_processed: allPayouts.length,
          records_created: created,
          records_updated: updated,
          last_sync_cursor: newestDate,
        })
        .eq('id', syncLog.id);

      return {
        success: true,
        syncType: syncMode,
        recordsProcessed: allPayouts.length,
        recordsCreated: created,
        recordsUpdated: updated,
        lastSyncCursor: newestDate,
        startedAt,
        completedAt,
      };
    } catch (error) {
      const completedAt = new Date();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await supabase
        .from('ebay_sync_log')
        .update({
          status: 'FAILED',
          completed_at: completedAt.toISOString(),
          error_message: errorMessage,
        })
        .eq('id', syncLog.id);

      return {
        success: false,
        syncType: syncMode,
        recordsProcessed: 0,
        recordsCreated: 0,
        recordsUpdated: 0,
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
   * Perform a historical import of transactions and payouts
   * @param userId User ID
   * @param fromDate Start date (ISO string, e.g., '2024-01-01')
   */
  async performHistoricalImport(
    userId: string,
    fromDate: string
  ): Promise<{ transactions: EbaySyncResult; payouts: EbaySyncResult }> {
    const supabase = await createClient();
    const toDate = new Date().toISOString();

    // Update sync config to track historical import
    await supabase
      .from('ebay_sync_config')
      .upsert({
        user_id: userId,
        historical_import_started_at: new Date().toISOString(),
        historical_import_from_date: fromDate,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    // Sync transactions and payouts
    const transactionsResult = await this.syncTransactions(userId, { fromDate, toDate });
    const payoutsResult = await this.syncPayouts(userId, { fromDate, toDate });

    // Update sync config to mark historical import complete
    if (transactionsResult.success && payoutsResult.success) {
      await supabase
        .from('ebay_sync_config')
        .update({
          historical_import_completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId);
    }

    return {
      transactions: transactionsResult,
      payouts: payoutsResult,
    };
  }

  // ============================================================================
  // Sync Status
  // ============================================================================

  /**
   * Get sync status for transactions and payouts
   */
  async getSyncStatus(userId: string): Promise<{
    transactions: { isRunning: boolean; lastSync?: { status: string; completedAt?: Date; recordsProcessed?: number } };
    payouts: { isRunning: boolean; lastSync?: { status: string; completedAt?: Date; recordsProcessed?: number } };
    config?: { autoSyncEnabled: boolean; nextSyncAt?: Date; historicalImportCompleted: boolean };
  }> {
    const supabase = await createClient();

    // Get running syncs
    const { data: runningSyncs } = await supabase
      .from('ebay_sync_log')
      .select('sync_type')
      .eq('user_id', userId)
      .eq('status', 'RUNNING');

    const runningTypes = new Set(runningSyncs?.map(s => s.sync_type) || []);

    // Get last transaction sync
    const { data: lastTxSync } = await supabase
      .from('ebay_sync_log')
      .select('*')
      .eq('user_id', userId)
      .eq('sync_type', 'TRANSACTIONS')
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    // Get last payout sync
    const { data: lastPayoutSync } = await supabase
      .from('ebay_sync_log')
      .select('*')
      .eq('user_id', userId)
      .eq('sync_type', 'PAYOUTS')
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    // Get sync config
    const { data: syncConfig } = await supabase
      .from('ebay_sync_config')
      .select('*')
      .eq('user_id', userId)
      .single();

    return {
      transactions: {
        isRunning: runningTypes.has('TRANSACTIONS'),
        lastSync: lastTxSync ? {
          status: lastTxSync.status,
          completedAt: lastTxSync.completed_at ? new Date(lastTxSync.completed_at) : undefined,
          recordsProcessed: lastTxSync.records_processed || 0,
        } : undefined,
      },
      payouts: {
        isRunning: runningTypes.has('PAYOUTS'),
        lastSync: lastPayoutSync ? {
          status: lastPayoutSync.status,
          completedAt: lastPayoutSync.completed_at ? new Date(lastPayoutSync.completed_at) : undefined,
          recordsProcessed: lastPayoutSync.records_processed || 0,
        } : undefined,
      },
      config: syncConfig ? {
        autoSyncEnabled: syncConfig.auto_sync_enabled,
        nextSyncAt: syncConfig.next_auto_sync_at ? new Date(syncConfig.next_auto_sync_at) : undefined,
        historicalImportCompleted: !!syncConfig.historical_import_completed_at,
      } : undefined,
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Upsert transactions to database with fee extraction
   */
  private async upsertTransactions(
    userId: string,
    transactions: EbayTransactionResponse[]
  ): Promise<{ created: number; updated: number }> {
    if (transactions.length === 0) {
      return { created: 0, updated: 0 };
    }

    const supabase = await createClient();

    // Deduplicate transactions by transactionId (eBay API can return duplicates across pages)
    const uniqueTransactions = Array.from(
      new Map(transactions.map(tx => [tx.transactionId, tx])).values()
    );
    console.log(`[EbayTransactionSyncService] Deduplicated ${transactions.length} -> ${uniqueTransactions.length} transactions`);

    // Get existing transaction IDs
    const { data: existingTransactions } = await supabase
      .from('ebay_transactions')
      .select('ebay_transaction_id')
      .eq('user_id', userId)
      .in('ebay_transaction_id', uniqueTransactions.map(t => t.transactionId));

    const existingIds = new Set(existingTransactions?.map(t => t.ebay_transaction_id) || []);

    // Transform transactions
    const transactionRows: TransactionRow[] = uniqueTransactions.map(tx => {
      // Extract fees from orderLineItems
      const fees: Record<string, number> = {};
      let totalFees = 0;

      if (tx.orderLineItems) {
        for (const lineItem of tx.orderLineItems) {
          if (lineItem.marketplaceFees) {
            for (const fee of lineItem.marketplaceFees) {
              const feeAmount = parseFloat(fee.amount.value);
              totalFees += feeAmount;

              const columnName = FEE_TYPE_MAPPING[fee.feeType];
              if (columnName) {
                fees[columnName] = (fees[columnName] || 0) + feeAmount;
              }
            }
          }
        }
      }

      // Calculate gross amount (what buyer paid)
      const netAmount = parseFloat(tx.amount.value);
      const grossAmount = tx.bookingEntry === 'CREDIT'
        ? netAmount + totalFees
        : netAmount;

      return {
        user_id: userId,
        ebay_transaction_id: tx.transactionId,
        ebay_order_id: tx.orderId || null,
        transaction_type: tx.transactionType,
        transaction_status: tx.transactionStatus,
        transaction_date: tx.transactionDate,
        amount: netAmount,
        currency: tx.amount.currency,
        booking_entry: tx.bookingEntry,
        payout_id: tx.payoutId || null,
        buyer_username: tx.buyer?.username || null,
        transaction_memo: tx.transactionMemo || null,
        order_line_items: tx.orderLineItems ? JSON.parse(JSON.stringify(tx.orderLineItems)) : null,
        total_fee_amount: tx.totalFeeAmount ? parseFloat(tx.totalFeeAmount.value) : null,
        total_fee_currency: tx.totalFeeAmount?.currency || null,
        final_value_fee_fixed: fees.final_value_fee_fixed || null,
        final_value_fee_variable: fees.final_value_fee_variable || null,
        regulatory_operating_fee: fees.regulatory_operating_fee || null,
        international_fee: fees.international_fee || null,
        ad_fee: fees.ad_fee || null,
        insertion_fee: fees.insertion_fee || null,
        gross_transaction_amount: grossAmount,
        sales_record_reference: null, // Will be populated from order sync
        item_title: null, // Will be populated from order sync
        custom_label: null, // Will be populated from order sync
        quantity: null, // Will be populated from order sync
        raw_response: JSON.parse(JSON.stringify(tx)),
      };
    });

    // Upsert in batches
    let created = 0;
    let updated = 0;

    for (let i = 0; i < transactionRows.length; i += BATCH_SIZE) {
      const batch = transactionRows.slice(i, i + BATCH_SIZE);

      const { error } = await supabase
        .from('ebay_transactions')
        .upsert(batch, {
          onConflict: 'user_id,ebay_transaction_id',
          ignoreDuplicates: false,
        });

      if (error) {
        console.error('[EbayTransactionSyncService] Failed to upsert transactions:', error);
        throw new Error('Failed to save transactions');
      }

      for (const row of batch) {
        if (existingIds.has(row.ebay_transaction_id)) {
          updated++;
        } else {
          created++;
        }
      }
    }

    return { created, updated };
  }

  /**
   * Upsert payouts to database
   */
  private async upsertPayouts(
    userId: string,
    payouts: EbayPayoutResponse[]
  ): Promise<{ created: number; updated: number }> {
    if (payouts.length === 0) {
      return { created: 0, updated: 0 };
    }

    const supabase = await createClient();

    // Deduplicate payouts by payoutId (eBay API can return duplicates across pages)
    const uniquePayouts = Array.from(
      new Map(payouts.map(p => [p.payoutId, p])).values()
    );
    console.log(`[EbayTransactionSyncService] Deduplicated ${payouts.length} -> ${uniquePayouts.length} payouts`);

    // Get existing payout IDs
    const { data: existingPayouts } = await supabase
      .from('ebay_payouts')
      .select('ebay_payout_id')
      .eq('user_id', userId)
      .in('ebay_payout_id', uniquePayouts.map(p => p.payoutId));

    const existingIds = new Set(existingPayouts?.map(p => p.ebay_payout_id) || []);

    // Transform payouts
    const payoutRows: PayoutRow[] = uniquePayouts.map(p => ({
      user_id: userId,
      ebay_payout_id: p.payoutId,
      payout_status: p.payoutStatus,
      payout_date: p.payoutDate,
      amount: parseFloat(p.amount.value),
      currency: p.amount.currency,
      payout_instrument: p.payoutInstrument ? JSON.parse(JSON.stringify(p.payoutInstrument)) : null,
      transaction_count: p.transactionCount || null,
      payout_memo: null,
      bank_reference: null,
      last_attempted_payout_date: null,
      raw_response: JSON.parse(JSON.stringify(p)),
    }));

    // Upsert in batches
    let created = 0;
    let updated = 0;

    for (let i = 0; i < payoutRows.length; i += BATCH_SIZE) {
      const batch = payoutRows.slice(i, i + BATCH_SIZE);

      const { error } = await supabase
        .from('ebay_payouts')
        .upsert(batch, {
          onConflict: 'user_id,ebay_payout_id',
          ignoreDuplicates: false,
        });

      if (error) {
        console.error('[EbayTransactionSyncService] Failed to upsert payouts:', error);
        throw new Error('Failed to save payouts');
      }

      for (const row of batch) {
        if (existingIds.has(row.ebay_payout_id)) {
          updated++;
        } else {
          created++;
        }
      }
    }

    return { created, updated };
  }

  /**
   * Delay helper for rate limiting
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export a default instance
export const ebayTransactionSyncService = new EbayTransactionSyncService();
