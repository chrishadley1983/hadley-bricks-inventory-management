/**
 * Monzo API Service
 *
 * Handles fetching transactions from Monzo API and syncing to database.
 * Implements pagination and duplicate prevention.
 *
 * IMPORTANT: Full history sync must be called immediately after OAuth
 * due to Monzo's 5-minute window restriction.
 */

import { createClient } from '@/lib/supabase/server';
import { monzoAuthService } from './monzo-auth.service';
import type {
  MonzoApiTransaction,
  MonzoSyncResult,
  MonzoSyncStatus,
  TransactionFetchParams,
} from './types';

// ============================================================================
// Constants
// ============================================================================

const MONZO_API_URL = 'https://api.monzo.com';
const MAX_TRANSACTIONS_PER_PAGE = 100; // Monzo's max limit
const RATE_LIMIT_DELAY_MS = 200; // Small delay between paginated requests

// ============================================================================
// MonzoApiService Class
// ============================================================================

export class MonzoApiService {
  // ============================================================================
  // Transaction Fetching
  // ============================================================================

  /**
   * Fetch transactions from Monzo API
   * @param userId The user ID
   * @param params Optional parameters for filtering/pagination
   */
  async fetchTransactions(
    userId: string,
    params?: TransactionFetchParams
  ): Promise<MonzoApiTransaction[]> {
    const accessToken = await monzoAuthService.getAccessToken(userId);
    if (!accessToken) {
      throw new Error('No valid access token. Please reconnect to Monzo.');
    }

    const accountId = await monzoAuthService.getAccountId(userId);
    if (!accountId) {
      throw new Error('No account ID found. Please reconnect to Monzo.');
    }

    const queryParams = new URLSearchParams({
      account_id: accountId,
      limit: String(params?.limit || MAX_TRANSACTIONS_PER_PAGE),
    });

    if (params?.since) {
      queryParams.set('since', params.since);
    }
    if (params?.before) {
      queryParams.set('before', params.before);
    }

    const response = await fetch(`${MONZO_API_URL}/transactions?${queryParams.toString()}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error('Rate limited by Monzo. Please try again later.');
      }
      if (response.status === 401) {
        throw new Error('Access token expired. Please reconnect to Monzo.');
      }
      const errorText = await response.text();
      console.error('[MonzoApiService] Failed to fetch transactions:', errorText);
      throw new Error(`Failed to fetch transactions: ${response.status}`);
    }

    const data = await response.json();
    return data.transactions || [];
  }

  // ============================================================================
  // Sync Operations
  // ============================================================================

  /**
   * Perform a full sync of all available transaction history
   * IMPORTANT: Must be called immediately after OAuth (within 5 minutes)
   * for full history access
   */
  async performFullSync(userId: string): Promise<MonzoSyncResult> {
    const startedAt = new Date();
    const supabase = await createClient();

    // Create sync log entry
    const { data: syncLog, error: logError } = await supabase
      .from('monzo_sync_log')
      .insert({
        user_id: userId,
        sync_type: 'FULL',
        status: 'RUNNING',
        started_at: startedAt.toISOString(),
      })
      .select()
      .single();

    if (logError) {
      console.error('[MonzoApiService] Failed to create sync log:', logError);
      throw new Error('Failed to start sync');
    }

    try {
      let allTransactions: MonzoApiTransaction[] = [];
      let hasMore = true;
      let lastTransactionId: string | undefined;

      // Fetch all transactions by paginating backward
      while (hasMore) {
        const params: TransactionFetchParams = {
          limit: MAX_TRANSACTIONS_PER_PAGE,
        };

        // Use the oldest transaction ID as 'before' cursor
        if (lastTransactionId) {
          params.before = lastTransactionId;
        }

        const transactions = await this.fetchTransactions(userId, params);

        if (transactions.length === 0) {
          hasMore = false;
        } else {
          allTransactions = [...allTransactions, ...transactions];
          // Get the oldest transaction from this batch for next page
          lastTransactionId = transactions[transactions.length - 1].id;

          // Check if we got less than requested, meaning we've reached the end
          if (transactions.length < MAX_TRANSACTIONS_PER_PAGE) {
            hasMore = false;
          }

          // Small delay to avoid rate limiting
          if (hasMore) {
            await this.delay(RATE_LIMIT_DELAY_MS);
          }
        }
      }

      // Upsert all transactions
      const { created, updated } = await this.upsertTransactions(userId, allTransactions);

      // Get the most recent transaction ID for incremental sync cursor
      const newestTransactionId =
        allTransactions.length > 0 ? allTransactions[0].id : undefined;

      const completedAt = new Date();

      // Update sync log
      await supabase
        .from('monzo_sync_log')
        .update({
          status: 'COMPLETED',
          completed_at: completedAt.toISOString(),
          transactions_processed: allTransactions.length,
          transactions_created: created,
          transactions_updated: updated,
          last_transaction_id: newestTransactionId,
        })
        .eq('id', syncLog.id);

      return {
        success: true,
        syncType: 'FULL',
        transactionsProcessed: allTransactions.length,
        transactionsCreated: created,
        transactionsUpdated: updated,
        lastTransactionId: newestTransactionId,
        startedAt,
        completedAt,
      };
    } catch (error) {
      const completedAt = new Date();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Update sync log with error
      await supabase
        .from('monzo_sync_log')
        .update({
          status: 'FAILED',
          completed_at: completedAt.toISOString(),
          error_message: errorMessage,
        })
        .eq('id', syncLog.id);

      return {
        success: false,
        syncType: 'FULL',
        transactionsProcessed: 0,
        transactionsCreated: 0,
        transactionsUpdated: 0,
        error: errorMessage,
        startedAt,
        completedAt,
      };
    }
  }

  /**
   * Perform an incremental sync of new transactions
   * Uses the last transaction ID as cursor
   */
  async performIncrementalSync(userId: string): Promise<MonzoSyncResult> {
    const startedAt = new Date();
    const supabase = await createClient();

    // Get last sync cursor
    const { data: lastCompletedSync } = await supabase
      .from('monzo_sync_log')
      .select('last_transaction_id')
      .eq('user_id', userId)
      .eq('status', 'COMPLETED')
      .order('completed_at', { ascending: false })
      .limit(1)
      .single();

    // If no previous sync, do a full sync instead
    if (!lastCompletedSync?.last_transaction_id) {
      console.log('[MonzoApiService] No previous sync found, performing full sync');
      return this.performFullSync(userId);
    }

    // Create sync log entry
    const { data: syncLog, error: logError } = await supabase
      .from('monzo_sync_log')
      .insert({
        user_id: userId,
        sync_type: 'INCREMENTAL',
        status: 'RUNNING',
        started_at: startedAt.toISOString(),
      })
      .select()
      .single();

    if (logError) {
      console.error('[MonzoApiService] Failed to create sync log:', logError);
      throw new Error('Failed to start sync');
    }

    try {
      let allTransactions: MonzoApiTransaction[] = [];
      let hasMore = true;
      let sinceCursor = lastCompletedSync.last_transaction_id;

      // Fetch new transactions since last sync
      while (hasMore) {
        const transactions = await this.fetchTransactions(userId, {
          since: sinceCursor,
          limit: MAX_TRANSACTIONS_PER_PAGE,
        });

        if (transactions.length === 0) {
          hasMore = false;
        } else {
          allTransactions = [...allTransactions, ...transactions];
          // Get the newest transaction from this batch for next page
          sinceCursor = transactions[0].id;

          // Check if we got less than requested
          if (transactions.length < MAX_TRANSACTIONS_PER_PAGE) {
            hasMore = false;
          }

          // Small delay to avoid rate limiting
          if (hasMore) {
            await this.delay(RATE_LIMIT_DELAY_MS);
          }
        }
      }

      // Upsert all transactions
      const { created, updated } = await this.upsertTransactions(userId, allTransactions);

      // Update cursor to newest transaction
      const newestTransactionId =
        allTransactions.length > 0 ? allTransactions[0].id : lastCompletedSync.last_transaction_id;

      const completedAt = new Date();

      // Update sync log
      await supabase
        .from('monzo_sync_log')
        .update({
          status: 'COMPLETED',
          completed_at: completedAt.toISOString(),
          transactions_processed: allTransactions.length,
          transactions_created: created,
          transactions_updated: updated,
          last_transaction_id: newestTransactionId,
        })
        .eq('id', syncLog.id);

      return {
        success: true,
        syncType: 'INCREMENTAL',
        transactionsProcessed: allTransactions.length,
        transactionsCreated: created,
        transactionsUpdated: updated,
        lastTransactionId: newestTransactionId,
        startedAt,
        completedAt,
      };
    } catch (error) {
      const completedAt = new Date();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Update sync log with error
      await supabase
        .from('monzo_sync_log')
        .update({
          status: 'FAILED',
          completed_at: completedAt.toISOString(),
          error_message: errorMessage,
        })
        .eq('id', syncLog.id);

      return {
        success: false,
        syncType: 'INCREMENTAL',
        transactionsProcessed: 0,
        transactionsCreated: 0,
        transactionsUpdated: 0,
        error: errorMessage,
        startedAt,
        completedAt,
      };
    }
  }

  /**
   * Get sync status and history
   */
  async getSyncStatus(userId: string): Promise<MonzoSyncStatus> {
    const supabase = await createClient();

    // Check for running sync
    const { data: runningSync } = await supabase
      .from('monzo_sync_log')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'RUNNING')
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    if (runningSync) {
      return {
        isRunning: true,
        lastSync: {
          type: runningSync.sync_type as 'FULL' | 'INCREMENTAL',
          status: 'RUNNING',
          startedAt: new Date(runningSync.started_at),
        },
      };
    }

    // Get last sync
    const { data: lastSync } = await supabase
      .from('monzo_sync_log')
      .select('*')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    if (!lastSync) {
      return { isRunning: false };
    }

    return {
      isRunning: false,
      lastSync: {
        type: lastSync.sync_type as 'FULL' | 'INCREMENTAL',
        status: lastSync.status as 'RUNNING' | 'COMPLETED' | 'FAILED',
        startedAt: new Date(lastSync.started_at),
        completedAt: lastSync.completed_at ? new Date(lastSync.completed_at) : undefined,
        transactionsProcessed: lastSync.transactions_processed || 0,
        error: lastSync.error_message || undefined,
      },
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Upsert transactions to database
   * Uses unique constraint on (user_id, monzo_transaction_id) to prevent duplicates
   */
  private async upsertTransactions(
    userId: string,
    transactions: MonzoApiTransaction[]
  ): Promise<{ created: number; updated: number }> {
    if (transactions.length === 0) {
      return { created: 0, updated: 0 };
    }

    const supabase = await createClient();
    const accountId = await monzoAuthService.getAccountId(userId);

    // Get existing transaction IDs to determine created vs updated
    const { data: existingTransactions } = await supabase
      .from('monzo_transactions')
      .select('monzo_transaction_id')
      .eq('user_id', userId)
      .in(
        'monzo_transaction_id',
        transactions.map((t) => t.id)
      );

    const existingIds = new Set(existingTransactions?.map((t) => t.monzo_transaction_id) || []);

    // Transform transactions for insert
    // Cast objects to JSON for Supabase compatibility
    const transactionRows = transactions.map((tx) => ({
      user_id: userId,
      monzo_transaction_id: tx.id,
      account_id: accountId || tx.account_id,
      amount: tx.amount,
      currency: tx.currency,
      description: tx.description,
      merchant: tx.merchant ? JSON.parse(JSON.stringify(tx.merchant)) : null,
      merchant_name: tx.merchant?.name || null,
      category: tx.category,
      is_load: tx.is_load,
      settled: tx.settled || null,
      created: tx.created,
      decline_reason: tx.decline_reason || null,
      metadata: tx.metadata ? JSON.parse(JSON.stringify(tx.metadata)) : null,
      raw_response: JSON.parse(JSON.stringify(tx)),
    }));

    // Upsert in batches to handle large syncs
    const batchSize = 100;
    let created = 0;
    let updated = 0;

    for (let i = 0; i < transactionRows.length; i += batchSize) {
      const batch = transactionRows.slice(i, i + batchSize);

      const { error } = await supabase.from('monzo_transactions').upsert(batch, {
        onConflict: 'user_id,monzo_transaction_id',
        ignoreDuplicates: false,
      });

      if (error) {
        console.error('[MonzoApiService] Failed to upsert transactions:', error);
        throw new Error('Failed to save transactions');
      }

      // Count created vs updated
      for (const row of batch) {
        if (existingIds.has(row.monzo_transaction_id)) {
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
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Export a default instance
export const monzoApiService = new MonzoApiService();
