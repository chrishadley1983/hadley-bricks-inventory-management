/**
 * Amazon Transaction Sync Service
 *
 * Handles syncing financial transactions from Amazon Finances API v2024-06-19
 * to the local database. Supports full sync, incremental sync, and historical imports.
 */

import { createClient } from '@/lib/supabase/server';
import { CredentialsRepository } from '@/lib/repositories';
import { createAmazonFinancesClient } from './amazon-finances.client';
import {
  AMAZON_FEE_TYPE_MAPPING,
  type AmazonCredentials,
  type AmazonFinancialTransaction,
  type AmazonTransactionBreakdown,
  type AmazonSyncConfigRow,
  type AmazonSyncLogRow,
} from './types';

// JSON type for raw_response fields
type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

// ============================================================================
// Constants
// ============================================================================

const BATCH_SIZE = 100;
const RATE_LIMIT_DELAY_MS = 150;

// ============================================================================
// Types
// ============================================================================

export interface AmazonSyncResult {
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

export interface AmazonSyncOptions {
  fullSync?: boolean;
  fromDate?: string; // ISO date string for historical imports
  toDate?: string; // ISO date string for historical imports
}

interface TransactionRow {
  user_id: string;
  amazon_transaction_id: string;
  amazon_order_id: string | null;
  seller_order_id: string | null;
  marketplace_id: string | null;
  transaction_type: string;
  transaction_status: string | null;
  posted_date: string;
  description: string | null;
  total_amount: number;
  currency: string;
  referral_fee: number | null;
  fba_fulfillment_fee: number | null;
  fba_per_unit_fee: number | null;
  fba_weight_fee: number | null;
  fba_inventory_storage_fee: number | null;
  shipping_credit: number | null;
  shipping_credit_tax: number | null;
  promotional_rebate: number | null;
  sales_tax_collected: number | null;
  marketplace_facilitator_tax: number | null;
  gift_wrap_credit: number | null;
  other_fees: number | null;
  gross_sales_amount: number | null;
  net_amount: number | null;
  total_fees: number | null;
  item_title: string | null;
  asin: string | null;
  seller_sku: string | null;
  quantity: number | null;
  fulfillment_channel: string | null;
  store_name: string | null;
  buyer_name: string | null;
  buyer_email: string | null;
  breakdowns: Json | null;
  contexts: Json | null;
  related_identifiers: Json | null;
  raw_response: Json;
}

// ============================================================================
// AmazonTransactionSyncService Class
// ============================================================================

export class AmazonTransactionSyncService {
  // ============================================================================
  // Transaction Sync
  // ============================================================================

  /**
   * Sync transactions from Amazon Finances API
   */
  async syncTransactions(
    userId: string,
    options?: AmazonSyncOptions
  ): Promise<AmazonSyncResult> {
    console.log(
      '[AmazonTransactionSyncService] Starting transaction sync for user:',
      userId,
      'options:',
      options
    );
    const startedAt = new Date();
    const supabase = await createClient();
    const syncMode = options?.fromDate
      ? 'HISTORICAL'
      : options?.fullSync
        ? 'FULL'
        : 'INCREMENTAL';
    console.log('[AmazonTransactionSyncService] Sync mode:', syncMode);

    // Check for running sync
    const { data: runningSync } = await supabase
      .from('amazon_sync_log')
      .select('id')
      .eq('user_id', userId)
      .eq('sync_type', 'TRANSACTIONS')
      .eq('status', 'RUNNING')
      .single();

    if (runningSync) {
      console.log(
        '[AmazonTransactionSyncService] A sync is already running, skipping'
      );
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
    console.log('[AmazonTransactionSyncService] Creating sync log entry');
    const { data: syncLog, error: logError } = await supabase
      .from('amazon_sync_log')
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
      console.error(
        '[AmazonTransactionSyncService] Failed to create sync log:',
        logError
      );
      throw new Error('Failed to start sync');
    }
    console.log('[AmazonTransactionSyncService] Sync log created:', syncLog.id);

    try {
      // Get Amazon credentials
      console.log('[AmazonTransactionSyncService] Getting Amazon credentials...');
      const credentials = await this.getCredentials(userId);
      if (!credentials) {
        throw new Error(
          'No Amazon credentials found. Please connect Amazon in settings.'
        );
      }
      console.log('[AmazonTransactionSyncService] Credentials obtained');

      // Create Finances API client
      const financesClient = createAmazonFinancesClient(credentials);

      // Determine date range for sync
      // Amazon API requires end date to be at least 2 minutes before current time
      let fromDate: string;
      const twoMinutesAgo = new Date(Date.now() - 3 * 60 * 1000); // Use 3 minutes for safety margin
      let toDate: string = twoMinutesAgo.toISOString();

      if (options?.fromDate) {
        // Historical import with specific date range
        fromDate = options.fromDate;
        if (options.toDate) {
          // Ensure toDate is not too close to current time
          const optionsToDate = new Date(options.toDate);
          toDate = optionsToDate < twoMinutesAgo ? options.toDate : twoMinutesAgo.toISOString();
        }
      } else if (!options?.fullSync) {
        // Incremental sync - get cursor from last successful sync
        const { data: syncConfig } = await supabase
          .from('amazon_sync_config')
          .select('transactions_posted_cursor')
          .eq('user_id', userId)
          .single();

        if (syncConfig?.transactions_posted_cursor) {
          fromDate = syncConfig.transactions_posted_cursor;
        } else {
          // Default to 90 days ago for first incremental sync
          const ninetyDaysAgo = new Date();
          ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
          fromDate = ninetyDaysAgo.toISOString();
        }
      } else {
        // Full sync - default to start of 2025
        fromDate = '2025-01-01T00:00:00.000Z';
      }

      console.log(
        '[AmazonTransactionSyncService] Date range:',
        fromDate,
        'to',
        toDate
      );

      // Fetch all transactions (handles 180-day chunking automatically)
      console.log(
        '[AmazonTransactionSyncService] Starting to fetch transactions from Amazon API...'
      );
      const allTransactions = await financesClient.getTransactionsInDateRange(
        fromDate,
        toDate
      );

      console.log(
        '[AmazonTransactionSyncService] Total transactions fetched:',
        allTransactions.length
      );

      // Upsert transactions
      console.log(
        '[AmazonTransactionSyncService] Upserting transactions to database...'
      );
      const { created, updated } = await this.upsertTransactions(
        userId,
        allTransactions
      );
      console.log(
        '[AmazonTransactionSyncService] Upsert complete. Created:',
        created,
        'Updated:',
        updated
      );

      // Update sync cursor to newest transaction date
      const newestDate =
        allTransactions.length > 0
          ? allTransactions
              .reduce((newest, tx) => {
                const txDate = new Date(tx.postedDate);
                return txDate > newest ? txDate : newest;
              }, new Date(0))
              .toISOString()
          : toDate;

      // Update sync config with cursor
      if (newestDate) {
        await supabase.from('amazon_sync_config').upsert(
          {
            user_id: userId,
            transactions_posted_cursor: newestDate,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );
      }

      const completedAt = new Date();

      // Update sync log
      await supabase
        .from('amazon_sync_log')
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
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      console.error('[AmazonTransactionSyncService] Sync failed:', error);

      // Update sync log with error
      await supabase
        .from('amazon_sync_log')
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
   * Perform a historical import of transactions
   * @param userId User ID
   * @param fromDate Start date (ISO string, e.g., '2025-01-01')
   */
  async performHistoricalImport(
    userId: string,
    fromDate: string
  ): Promise<{ transactions: AmazonSyncResult }> {
    const supabase = await createClient();
    const toDate = new Date().toISOString();

    // Update sync config to track historical import
    await supabase.from('amazon_sync_config').upsert(
      {
        user_id: userId,
        historical_import_started_at: new Date().toISOString(),
        historical_import_from_date: fromDate,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );

    // Sync transactions
    const transactionsResult = await this.syncTransactions(userId, {
      fromDate,
      toDate,
    });

    // Update sync config to mark historical import complete
    if (transactionsResult.success) {
      await supabase
        .from('amazon_sync_config')
        .update({
          historical_import_completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId);
    }

    return {
      transactions: transactionsResult,
    };
  }

  // ============================================================================
  // Sync Status
  // ============================================================================

  /**
   * Get sync status for transactions
   */
  async getSyncStatus(userId: string): Promise<{
    isConnected: boolean;
    transactions: {
      isRunning: boolean;
      lastSync?: {
        status: string;
        completedAt?: Date;
        recordsProcessed?: number;
      };
    };
    config?: AmazonSyncConfigRow;
    logs: AmazonSyncLogRow[];
    transactionCount: number;
  }> {
    const supabase = await createClient();

    // Check if Amazon is connected
    const credentials = await this.getCredentials(userId);
    const isConnected = !!credentials;

    // Get running syncs
    const { data: runningSyncs } = await supabase
      .from('amazon_sync_log')
      .select('sync_type')
      .eq('user_id', userId)
      .eq('status', 'RUNNING');

    const runningTypes = new Set(runningSyncs?.map((s) => s.sync_type) || []);

    // Get last transaction sync
    const { data: lastTxSync } = await supabase
      .from('amazon_sync_log')
      .select('*')
      .eq('user_id', userId)
      .eq('sync_type', 'TRANSACTIONS')
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    // Get sync config
    const { data: syncConfig } = await supabase
      .from('amazon_sync_config')
      .select('*')
      .eq('user_id', userId)
      .single();

    // Get recent sync logs
    const { data: logs } = await supabase
      .from('amazon_sync_log')
      .select('*')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(10);

    // Get transaction count
    const { count: transactionCount } = await supabase
      .from('amazon_transactions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    return {
      isConnected,
      transactions: {
        isRunning: runningTypes.has('TRANSACTIONS'),
        lastSync: lastTxSync
          ? {
              status: lastTxSync.status,
              completedAt: lastTxSync.completed_at
                ? new Date(lastTxSync.completed_at)
                : undefined,
              recordsProcessed: lastTxSync.records_processed || 0,
            }
          : undefined,
      },
      config: (syncConfig as AmazonSyncConfigRow) || undefined,
      logs: (logs as AmazonSyncLogRow[]) || [],
      transactionCount: transactionCount || 0,
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Get Amazon credentials for user
   */
  private async getCredentials(
    userId: string
  ): Promise<AmazonCredentials | null> {
    try {
      const supabase = await createClient();
      const credentialsRepo = new CredentialsRepository(supabase);
      const credentials = await credentialsRepo.getCredentials<AmazonCredentials>(
        userId,
        'amazon'
      );
      return credentials;
    } catch (error) {
      console.error(
        '[AmazonTransactionSyncService] Error getting credentials:',
        error
      );
      return null;
    }
  }

  /**
   * Extract fees from nested breakdowns structure
   */
  private extractFees(
    breakdowns?: AmazonTransactionBreakdown[]
  ): Record<string, number> {
    const fees: Record<string, number> = {};
    let otherFees = 0;

    if (!breakdowns) {
      return fees;
    }

    const processBreakdown = (breakdown: AmazonTransactionBreakdown) => {
      const amount = parseFloat(breakdown.breakdownAmount.currencyAmount);
      const columnName = AMAZON_FEE_TYPE_MAPPING[breakdown.breakdownType];

      if (columnName) {
        fees[columnName] = (fees[columnName] || 0) + amount;
      } else if (breakdown.breakdownType !== 'Principal') {
        // Track unknown fees as "other"
        otherFees += amount;
      }

      // Process nested breakdowns recursively
      if (breakdown.breakdowns) {
        for (const nested of breakdown.breakdowns) {
          processBreakdown(nested);
        }
      }
    };

    for (const breakdown of breakdowns) {
      processBreakdown(breakdown);
    }

    if (otherFees !== 0) {
      fees.other_fees = otherFees;
    }

    return fees;
  }

  /**
   * Generate a unique transaction ID from the transaction data
   */
  private generateTransactionId(tx: AmazonFinancialTransaction): string {
    // Try to find order ID from related identifiers
    const orderId = tx.relatedIdentifiers?.find(
      (id) => id.relatedIdentifierName === 'ORDER_ID'
    )?.relatedIdentifierValue;

    // Create a unique ID combining type, date, amount, and order ID
    const components = [
      tx.transactionType,
      tx.postedDate,
      tx.totalAmount.currencyAmount,
      tx.totalAmount.currencyCode,
      orderId || 'no-order',
      tx.sellingPartnerMetadata?.marketplaceId || 'no-marketplace',
    ];

    // Simple hash for uniqueness
    const str = components.join('|');
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    return `${orderId || 'tx'}_${Math.abs(hash).toString(36)}`;
  }

  /**
   * Upsert transactions to database with fee extraction
   */
  private async upsertTransactions(
    userId: string,
    transactions: AmazonFinancialTransaction[]
  ): Promise<{ created: number; updated: number }> {
    if (transactions.length === 0) {
      return { created: 0, updated: 0 };
    }

    const supabase = await createClient();

    // Generate transaction IDs and deduplicate
    const transactionMap = new Map<string, AmazonFinancialTransaction>();
    for (const tx of transactions) {
      const txId = this.generateTransactionId(tx);
      // Keep the most recent version if duplicates exist
      if (
        !transactionMap.has(txId) ||
        new Date(tx.postedDate) >
          new Date(transactionMap.get(txId)!.postedDate)
      ) {
        transactionMap.set(txId, tx);
      }
    }

    const uniqueTransactions = Array.from(transactionMap.entries());
    console.log(
      `[AmazonTransactionSyncService] Deduplicated ${transactions.length} -> ${uniqueTransactions.length} transactions`
    );

    // Get existing transaction IDs
    const { data: existingTransactions } = await supabase
      .from('amazon_transactions')
      .select('amazon_transaction_id')
      .eq('user_id', userId)
      .in(
        'amazon_transaction_id',
        uniqueTransactions.map(([id]) => id)
      );

    const existingIds = new Set(
      existingTransactions?.map((t) => t.amazon_transaction_id) || []
    );

    // Transform transactions
    const transactionRows: TransactionRow[] = uniqueTransactions.map(
      ([txId, tx]) => {
        // Extract fees from breakdowns
        const fees = this.extractFees(tx.breakdowns);
        // Only sum NEGATIVE values as fees (deductions from the sale)
        // Positive values are credits (shipping credit, gift wrap credit, etc.)
        const totalFees = Object.values(fees).reduce(
          (sum, fee) => sum + (fee < 0 ? Math.abs(fee) : 0),
          0
        );

        // Get order ID from related identifiers
        const orderId =
          tx.relatedIdentifiers?.find(
            (id) => id.relatedIdentifierName === 'ORDER_ID'
          )?.relatedIdentifierValue || null;

        const sellerOrderId =
          tx.relatedIdentifiers?.find(
            (id) => id.relatedIdentifierName === 'SELLER_ORDER_ID'
          )?.relatedIdentifierValue || null;

        // Get context info (ASIN, SKU, etc.)
        const context = tx.contexts?.[0];
        const asin = context?.asin || null;
        const sku = context?.sku || null;
        const quantity = context?.quantityShipped || null;
        const storeName = context?.storeName || null;
        const fulfillmentChannel = context?.fulfillmentNetwork || null;

        // Parse amounts
        const totalAmount = parseFloat(tx.totalAmount.currencyAmount);

        // Calculate gross amount (for sales, this is what buyer paid)
        // totalAmount from Finances API is the net payout after Amazon takes fees
        // gross = net + actual_fees_deducted
        // Credits (shipping_credit, gift_wrap_credit) are ADDED to your payout, not deducted
        // So gross = net + fees_deducted (only negative breakdown amounts)
        const grossAmount =
          tx.transactionType === 'Shipment' ? totalAmount + totalFees : null;

        return {
          user_id: userId,
          amazon_transaction_id: txId,
          amazon_order_id: orderId,
          seller_order_id: sellerOrderId,
          marketplace_id: tx.sellingPartnerMetadata?.marketplaceId || null,
          transaction_type: tx.transactionType,
          transaction_status: tx.transactionStatus || null,
          posted_date: tx.postedDate,
          description: tx.description || null,
          total_amount: totalAmount,
          currency: tx.totalAmount.currencyCode,
          referral_fee: fees.referral_fee || null,
          fba_fulfillment_fee: fees.fba_fulfillment_fee || null,
          fba_per_unit_fee: fees.fba_per_unit_fee || null,
          fba_weight_fee: fees.fba_weight_fee || null,
          fba_inventory_storage_fee: fees.fba_inventory_storage_fee || null,
          shipping_credit: fees.shipping_credit || null,
          shipping_credit_tax: fees.shipping_credit_tax || null,
          promotional_rebate: fees.promotional_rebate || null,
          sales_tax_collected: fees.sales_tax_collected || null,
          marketplace_facilitator_tax: fees.marketplace_facilitator_tax || null,
          gift_wrap_credit: fees.gift_wrap_credit || null,
          other_fees: fees.other_fees || null,
          gross_sales_amount: grossAmount,
          net_amount: totalAmount,
          total_fees: totalFees > 0 ? totalFees : null,
          item_title: null, // Not available in Finances API
          asin,
          seller_sku: sku,
          quantity,
          fulfillment_channel: fulfillmentChannel,
          store_name: storeName,
          buyer_name: null, // Not available in Finances API
          buyer_email: null, // Not available in Finances API
          breakdowns: tx.breakdowns
            ? JSON.parse(JSON.stringify(tx.breakdowns))
            : null,
          contexts: tx.contexts
            ? JSON.parse(JSON.stringify(tx.contexts))
            : null,
          related_identifiers: tx.relatedIdentifiers
            ? JSON.parse(JSON.stringify(tx.relatedIdentifiers))
            : null,
          raw_response: JSON.parse(JSON.stringify(tx)),
        };
      }
    );

    // Upsert in batches
    let created = 0;
    let updated = 0;

    for (let i = 0; i < transactionRows.length; i += BATCH_SIZE) {
      const batch = transactionRows.slice(i, i + BATCH_SIZE);

      const { error } = await supabase.from('amazon_transactions').upsert(
        batch,
        {
          onConflict: 'user_id,amazon_transaction_id',
          ignoreDuplicates: false,
        }
      );

      if (error) {
        console.error(
          '[AmazonTransactionSyncService] Failed to upsert transactions:',
          error
        );
        throw new Error('Failed to save transactions');
      }

      for (const row of batch) {
        if (existingIds.has(row.amazon_transaction_id)) {
          updated++;
        } else {
          created++;
        }
      }

      // Small delay between batches
      if (i + BATCH_SIZE < transactionRows.length) {
        await this.delay(RATE_LIMIT_DELAY_MS);
      }
    }

    return { created, updated };
  }

  /**
   * Delay helper for rate limiting
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Export a default instance
export const amazonTransactionSyncService = new AmazonTransactionSyncService();
