/**
 * eBay Finances Service
 *
 * Handles transaction and payout retrieval and sync from the eBay Finances API.
 * Phase 3 of eBay integration.
 */

import { createClient } from '@/lib/supabase/server';
import { EbayApiAdapter } from './ebay-api.adapter';
import { EbayAuthService } from './ebay-auth.service';
import type { EbayTransactionResponse, EbayPayoutResponse } from './types';

// ============================================================================
// Types
// ============================================================================

export interface TransactionSyncOptions {
  /** Sync transactions since this date */
  sinceDate?: Date;
  /** Sync transactions until this date */
  untilDate?: Date;
  /** Transaction types to sync */
  transactionTypes?: string[];
  /** Maximum number of transactions to sync (for testing) */
  limit?: number;
}

export interface PayoutSyncOptions {
  /** Sync payouts since this date */
  sinceDate?: Date;
  /** Sync payouts until this date */
  untilDate?: Date;
  /** Payout statuses to sync */
  payoutStatuses?: string[];
  /** Maximum number of payouts to sync (for testing) */
  limit?: number;
}

export interface TransactionSyncResult {
  success: boolean;
  transactionsProcessed: number;
  transactionsCreated: number;
  transactionsUpdated: number;
  error?: string;
}

export interface PayoutSyncResult {
  success: boolean;
  payoutsProcessed: number;
  payoutsCreated: number;
  payoutsUpdated: number;
  error?: string;
}

export interface FinancialSummary {
  totalSales: number;
  totalRefunds: number;
  totalFees: number;
  totalPayouts: number;
  pendingPayouts: number;
  currency: string;
  periodStart: Date;
  periodEnd: Date;
  transactionCount: number;
}

export interface TransactionBreakdown {
  type: string;
  count: number;
  totalAmount: number;
  currency: string;
}

// ============================================================================
// EbayFinancesService Class
// ============================================================================

export class EbayFinancesService {
  private authService: EbayAuthService;

  constructor(authService?: EbayAuthService) {
    this.authService = authService || new EbayAuthService();
  }

  // ============================================================================
  // Transaction Sync Methods
  // ============================================================================

  /**
   * Sync transactions from eBay for a user
   */
  async syncTransactions(
    userId: string,
    options: TransactionSyncOptions = {}
  ): Promise<TransactionSyncResult> {
    try {
      // Get access token
      const accessToken = await this.authService.getAccessToken(userId);
      if (!accessToken) {
        return {
          success: false,
          transactionsProcessed: 0,
          transactionsCreated: 0,
          transactionsUpdated: 0,
          error: 'Not connected to eBay',
        };
      }

      // Get connection status for marketplace
      const connectionStatus = await this.authService.getConnectionStatus(userId);
      const marketplaceId = connectionStatus.marketplaceId || 'EBAY_GB';

      // Create API adapter with userId for signing key management (Finances API requires signatures)
      const api = new EbayApiAdapter({
        accessToken,
        marketplaceId,
        sandbox: process.env.EBAY_SANDBOX === 'true',
        userId,
      });

      // Log sync start
      const syncLogId = await this.createSyncLog(userId, 'TRANSACTIONS');

      // Build filter
      const filter = EbayApiAdapter.buildTransactionDateFilter(
        options.sinceDate?.toISOString(),
        options.untilDate?.toISOString()
      );

      // Fetch transactions
      let transactions: EbayTransactionResponse[];
      if (options.limit) {
        const response = await api.getTransactions({
          filter,
          limit: options.limit,
          transactionType: options.transactionTypes?.[0],
        });
        transactions = response.transactions;
      } else {
        transactions = await api.getAllTransactions({
          filter,
          transactionType: options.transactionTypes?.[0],
        });
      }

      console.log(`[EbayFinancesService] Fetched ${transactions.length} transactions from eBay`);

      let transactionsCreated = 0;
      let transactionsUpdated = 0;

      // Process each transaction
      for (const transaction of transactions) {
        const result = await this.upsertTransaction(userId, transaction);
        if (result.created) {
          transactionsCreated++;
        } else {
          transactionsUpdated++;
        }
      }

      // Update sync log
      await this.updateSyncLog(syncLogId, 'COMPLETED', {
        records_processed: transactions.length,
        records_created: transactionsCreated,
        records_updated: transactionsUpdated,
      });

      return {
        success: true,
        transactionsProcessed: transactions.length,
        transactionsCreated,
        transactionsUpdated,
      };
    } catch (error) {
      console.error('[EbayFinancesService] Transaction sync error:', error);

      return {
        success: false,
        transactionsProcessed: 0,
        transactionsCreated: 0,
        transactionsUpdated: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // ============================================================================
  // Payout Sync Methods
  // ============================================================================

  /**
   * Sync payouts from eBay for a user
   */
  async syncPayouts(userId: string, options: PayoutSyncOptions = {}): Promise<PayoutSyncResult> {
    try {
      // Get access token
      const accessToken = await this.authService.getAccessToken(userId);
      if (!accessToken) {
        return {
          success: false,
          payoutsProcessed: 0,
          payoutsCreated: 0,
          payoutsUpdated: 0,
          error: 'Not connected to eBay',
        };
      }

      // Get connection status for marketplace
      const connectionStatus = await this.authService.getConnectionStatus(userId);
      const marketplaceId = connectionStatus.marketplaceId || 'EBAY_GB';

      // Create API adapter with userId for signing key management (Finances API requires signatures)
      const api = new EbayApiAdapter({
        accessToken,
        marketplaceId,
        sandbox: process.env.EBAY_SANDBOX === 'true',
        userId,
      });

      // Log sync start
      const syncLogId = await this.createSyncLog(userId, 'PAYOUTS');

      // Fetch payouts
      let payouts: EbayPayoutResponse[];
      if (options.limit) {
        const response = await api.getPayouts({
          limit: options.limit,
          payoutStatus: options.payoutStatuses?.[0],
        });
        payouts = response.payouts;
      } else {
        payouts = await api.getAllPayouts({
          payoutStatus: options.payoutStatuses?.[0],
        });
      }

      console.log(`[EbayFinancesService] Fetched ${payouts.length} payouts from eBay`);

      let payoutsCreated = 0;
      let payoutsUpdated = 0;

      // Process each payout
      for (const payout of payouts) {
        const result = await this.upsertPayout(userId, payout);
        if (result.created) {
          payoutsCreated++;
        } else {
          payoutsUpdated++;
        }
      }

      // Update sync log
      await this.updateSyncLog(syncLogId, 'COMPLETED', {
        records_processed: payouts.length,
        records_created: payoutsCreated,
        records_updated: payoutsUpdated,
      });

      return {
        success: true,
        payoutsProcessed: payouts.length,
        payoutsCreated,
        payoutsUpdated,
      };
    } catch (error) {
      console.error('[EbayFinancesService] Payout sync error:', error);

      return {
        success: false,
        payoutsProcessed: 0,
        payoutsCreated: 0,
        payoutsUpdated: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // ============================================================================
  // Financial Summary Methods
  // ============================================================================

  /**
   * Get a financial summary for a period
   */
  async getFinancialSummary(
    userId: string,
    periodStart: Date,
    periodEnd: Date
  ): Promise<FinancialSummary | null> {
    const supabase = await createClient();

    // Get transactions in period
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: transactions, error } = await (supabase as any)
      .from('ebay_transactions')
      .select('*')
      .eq('user_id', userId)
      .gte('transaction_date', periodStart.toISOString())
      .lte('transaction_date', periodEnd.toISOString());

    if (error) {
      console.error('[EbayFinancesService] Error fetching transactions:', error);
      return null;
    }

    // Get payouts in period
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: payouts, error: payoutError } = await (supabase as any)
      .from('ebay_payouts')
      .select('*')
      .eq('user_id', userId)
      .gte('payout_date', periodStart.toISOString())
      .lte('payout_date', periodEnd.toISOString());

    if (payoutError) {
      console.error('[EbayFinancesService] Error fetching payouts:', payoutError);
      return null;
    }

    // Calculate summary
    let totalSales = 0;
    let totalRefunds = 0;
    let totalFees = 0;
    let currency = 'GBP';

    for (const tx of transactions || []) {
      currency = tx.currency || currency;

      switch (tx.transaction_type) {
        case 'SALE':
          if (tx.booking_entry === 'CREDIT') {
            totalSales += parseFloat(tx.amount) || 0;
          }
          break;
        case 'REFUND':
          if (tx.booking_entry === 'DEBIT') {
            totalRefunds += parseFloat(tx.amount) || 0;
          }
          break;
      }

      if (tx.total_fee_amount) {
        totalFees += parseFloat(tx.total_fee_amount) || 0;
      }
    }

    // Calculate payouts
    let totalPayouts = 0;
    let pendingPayouts = 0;

    for (const payout of payouts || []) {
      const amount = parseFloat(payout.amount) || 0;
      if (payout.payout_status === 'SUCCEEDED') {
        totalPayouts += amount;
      } else if (payout.payout_status === 'INITIATED' || payout.payout_status === 'PENDING') {
        pendingPayouts += amount;
      }
    }

    return {
      totalSales,
      totalRefunds,
      totalFees,
      totalPayouts,
      pendingPayouts,
      currency,
      periodStart,
      periodEnd,
      transactionCount: transactions?.length || 0,
    };
  }

  /**
   * Get transaction breakdown by type
   */
  async getTransactionBreakdown(
    userId: string,
    periodStart: Date,
    periodEnd: Date
  ): Promise<TransactionBreakdown[]> {
    const supabase = await createClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: transactions, error } = await (supabase as any)
      .from('ebay_transactions')
      .select('transaction_type, amount, currency')
      .eq('user_id', userId)
      .gte('transaction_date', periodStart.toISOString())
      .lte('transaction_date', periodEnd.toISOString());

    if (error) {
      console.error('[EbayFinancesService] Error fetching transactions:', error);
      return [];
    }

    // Group by transaction type
    const breakdown: Record<string, { count: number; totalAmount: number; currency: string }> = {};

    for (const tx of transactions || []) {
      const type = tx.transaction_type;
      if (!breakdown[type]) {
        breakdown[type] = { count: 0, totalAmount: 0, currency: tx.currency || 'GBP' };
      }
      breakdown[type].count++;
      breakdown[type].totalAmount += parseFloat(tx.amount) || 0;
    }

    return Object.entries(breakdown).map(([type, data]) => ({
      type,
      ...data,
    }));
  }

  // ============================================================================
  // Query Methods
  // ============================================================================

  /**
   * Get transactions for a user
   */
  async getTransactions(
    userId: string,
    options: {
      type?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ transactions: unknown[]; total: number }> {
    const supabase = await createClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase as any)
      .from('ebay_transactions')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('transaction_date', { ascending: false });

    if (options.type) {
      query = query.eq('transaction_type', options.type);
    }

    if (options.limit) {
      query = query.limit(options.limit);
    }

    if (options.offset) {
      query = query.range(options.offset, options.offset + (options.limit || 50) - 1);
    }

    const { data, count, error } = await query;

    if (error) {
      console.error('[EbayFinancesService] Error fetching transactions:', error);
      throw new Error('Failed to fetch transactions');
    }

    return {
      transactions: data || [],
      total: count || 0,
    };
  }

  /**
   * Get payouts for a user
   */
  async getPayouts(
    userId: string,
    options: {
      status?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ payouts: unknown[]; total: number }> {
    const supabase = await createClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase as any)
      .from('ebay_payouts')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('payout_date', { ascending: false });

    if (options.status) {
      query = query.eq('payout_status', options.status);
    }

    if (options.limit) {
      query = query.limit(options.limit);
    }

    if (options.offset) {
      query = query.range(options.offset, options.offset + (options.limit || 50) - 1);
    }

    const { data, count, error } = await query;

    if (error) {
      console.error('[EbayFinancesService] Error fetching payouts:', error);
      throw new Error('Failed to fetch payouts');
    }

    return {
      payouts: data || [],
      total: count || 0,
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Upsert a transaction
   */
  private async upsertTransaction(
    userId: string,
    transaction: EbayTransactionResponse
  ): Promise<{ id: string; created: boolean }> {
    const supabase = await createClient();

    const transactionData = {
      user_id: userId,
      ebay_transaction_id: transaction.transactionId,
      ebay_order_id: transaction.orderId || null,
      transaction_type: transaction.transactionType,
      transaction_status: transaction.transactionStatus,
      transaction_date: transaction.transactionDate,
      amount: parseFloat(transaction.amount.value),
      currency: transaction.amount.currency,
      booking_entry: transaction.bookingEntry,
      payout_id: transaction.payoutId || null,
      buyer_username: transaction.buyer?.username || null,
      transaction_memo: transaction.transactionMemo || null,
      order_line_items: transaction.orderLineItems || null,
      total_fee_amount: transaction.totalFeeAmount
        ? parseFloat(transaction.totalFeeAmount.value)
        : null,
      total_fee_currency: transaction.totalFeeAmount?.currency || null,
      raw_response: transaction,
    };

    // Check if exists
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await (supabase as any)
      .from('ebay_transactions')
      .select('id')
      .eq('user_id', userId)
      .eq('ebay_transaction_id', transaction.transactionId)
      .single();

    let id: string;
    let created = false;

    if (existing) {
      // Update
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('ebay_transactions')
        .update(transactionData)
        .eq('id', existing.id)
        .select('id')
        .single();

      if (error) {
        console.error('[EbayFinancesService] Error updating transaction:', error);
        throw error;
      }

      id = data.id;
    } else {
      // Insert
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('ebay_transactions')
        .insert(transactionData)
        .select('id')
        .single();

      if (error) {
        console.error('[EbayFinancesService] Error inserting transaction:', error);
        throw error;
      }

      id = data.id;
      created = true;
    }

    return { id, created };
  }

  /**
   * Upsert a payout
   */
  private async upsertPayout(
    userId: string,
    payout: EbayPayoutResponse
  ): Promise<{ id: string; created: boolean }> {
    const supabase = await createClient();

    const payoutData = {
      user_id: userId,
      ebay_payout_id: payout.payoutId,
      payout_status: payout.payoutStatus,
      payout_date: payout.payoutDate,
      amount: parseFloat(payout.amount.value),
      currency: payout.amount.currency,
      payout_instrument: payout.payoutInstrument || null,
      transaction_count: payout.transactionCount || null,
      raw_response: payout,
    };

    // Check if exists
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await (supabase as any)
      .from('ebay_payouts')
      .select('id')
      .eq('user_id', userId)
      .eq('ebay_payout_id', payout.payoutId)
      .single();

    let id: string;
    let created = false;

    if (existing) {
      // Update
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('ebay_payouts')
        .update(payoutData)
        .eq('id', existing.id)
        .select('id')
        .single();

      if (error) {
        console.error('[EbayFinancesService] Error updating payout:', error);
        throw error;
      }

      id = data.id;
    } else {
      // Insert
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('ebay_payouts')
        .insert(payoutData)
        .select('id')
        .single();

      if (error) {
        console.error('[EbayFinancesService] Error inserting payout:', error);
        throw error;
      }

      id = data.id;
      created = true;
    }

    return { id, created };
  }

  /**
   * Create a sync log entry
   */
  private async createSyncLog(userId: string, syncType: string): Promise<string> {
    const supabase = await createClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('ebay_sync_log')
      .insert({
        user_id: userId,
        sync_type: syncType,
        status: 'RUNNING',
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      console.error('[EbayFinancesService] Error creating sync log:', error);
      throw error;
    }

    return data.id;
  }

  /**
   * Update a sync log entry
   */
  private async updateSyncLog(
    syncLogId: string,
    status: 'COMPLETED' | 'FAILED',
    stats?: {
      records_processed?: number;
      records_created?: number;
      records_updated?: number;
      error_message?: string;
    }
  ): Promise<void> {
    const supabase = await createClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('ebay_sync_log')
      .update({
        status,
        completed_at: new Date().toISOString(),
        ...stats,
      })
      .eq('id', syncLogId);

    if (error) {
      console.error('[EbayFinancesService] Error updating sync log:', error);
    }
  }
}

// Export a default instance
export const ebayFinancesService = new EbayFinancesService();
