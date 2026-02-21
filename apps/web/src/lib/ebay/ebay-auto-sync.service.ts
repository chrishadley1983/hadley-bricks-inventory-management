/**
 * eBay Auto Sync Service
 *
 * Orchestrates automatic background syncing of eBay data.
 * Manages sync configuration and schedules periodic syncs.
 */

import { createClient } from '@/lib/supabase/server';
import { EbayAuthService, ebayAuthService } from './ebay-auth.service';
import {
  EbayTransactionSyncService,
  ebayTransactionSyncService,
  type EbaySyncResult,
} from './ebay-transaction-sync.service';
import {
  EbayOrderSyncService,
  ebayOrderSyncService,
  type EbayOrderSyncResult,
} from './ebay-order-sync.service';
import type { SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// Types
// ============================================================================

export interface EbaySyncConfig {
  autoSyncEnabled: boolean;
  autoSyncIntervalHours: number;
  lastAutoSyncAt?: Date;
  nextAutoSyncAt?: Date;
  ordersLastModifiedCursor?: Date;
  transactionsDateCursor?: Date;
  payoutsDateCursor?: Date;
  historicalImportStartedAt?: Date;
  historicalImportCompletedAt?: Date;
  historicalImportFromDate?: string;
}

export interface EbayFullSyncResult {
  orders: EbayOrderSyncResult;
  transactions: EbaySyncResult;
  payouts: EbaySyncResult;
  totalDuration: number; // milliseconds
}

export interface EbaySyncStatusSummary {
  isConnected: boolean;
  isRunning: boolean;
  runningSyncTypes: string[];
  config?: EbaySyncConfig;
  lastSync?: {
    orders?: { status: string; completedAt?: Date; recordsProcessed?: number };
    transactions?: { status: string; completedAt?: Date; recordsProcessed?: number };
    payouts?: { status: string; completedAt?: Date; recordsProcessed?: number };
  };
}

// ============================================================================
// EbayAutoSyncService Class
// ============================================================================

export class EbayAutoSyncService {
  private injectedSupabase: SupabaseClient | null = null;
  private authService: EbayAuthService;
  private transactionSyncService: EbayTransactionSyncService;
  private orderSyncService: EbayOrderSyncService;

  /**
   * Create a new EbayAutoSyncService
   * @param supabase Optional Supabase client (for cron/background jobs that need service role access)
   */
  constructor(supabase?: SupabaseClient) {
    this.injectedSupabase = supabase || null;
    // Create services with same Supabase client for consistency
    if (supabase) {
      this.authService = new EbayAuthService(undefined, supabase);
      this.transactionSyncService = new EbayTransactionSyncService(supabase);
      this.orderSyncService = new EbayOrderSyncService(supabase);
    } else {
      this.authService = ebayAuthService;
      this.transactionSyncService = ebayTransactionSyncService;
      this.orderSyncService = ebayOrderSyncService;
    }
  }

  /**
   * Get the Supabase client - uses injected client if available, otherwise creates cookie-based client
   */
  private async getSupabase(): Promise<SupabaseClient> {
    if (this.injectedSupabase) {
      return this.injectedSupabase;
    }
    return createClient();
  }

  // ============================================================================
  // Sync Operations
  // ============================================================================

  /**
   * Perform a full sync of all eBay data (orders, transactions, payouts)
   */
  async performFullSync(userId: string): Promise<EbayFullSyncResult> {
    const startTime = Date.now();

    // Sync transactions first (fastest, provides financial data)
    const transactions = await this.transactionSyncService.syncTransactions(userId, {
      fullSync: true,
    });

    // Sync payouts
    const payouts = await this.transactionSyncService.syncPayouts(userId, { fullSync: true });

    // Sync orders last (enriches transactions with item data)
    const orders = await this.orderSyncService.syncOrders(userId, {
      fullSync: true,
      enrichTransactions: true,
    });

    const totalDuration = Date.now() - startTime;

    // Update last auto sync timestamp
    const supabase = await this.getSupabase();
    await supabase.from('ebay_sync_config').upsert(
      {
        user_id: userId,
        last_auto_sync_at: new Date().toISOString(),
        next_auto_sync_at: this.calculateNextSyncTime(userId).toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );

    return { orders, transactions, payouts, totalDuration };
  }

  /**
   * Perform an incremental sync of all eBay data
   * This is what runs during auto-sync
   */
  async performIncrementalSync(userId: string): Promise<EbayFullSyncResult> {
    const startTime = Date.now();

    // Sync in parallel for speed
    const [transactions, payouts, orders] = await Promise.all([
      this.transactionSyncService.syncTransactions(userId),
      this.transactionSyncService.syncPayouts(userId),
      this.orderSyncService.syncOrders(userId, { enrichTransactions: true }),
    ]);

    const totalDuration = Date.now() - startTime;

    // Update last auto sync timestamp
    const supabase = await this.getSupabase();
    const config = await this.getConfig(userId);
    const intervalHours = config?.autoSyncIntervalHours || 24;

    await supabase.from('ebay_sync_config').upsert(
      {
        user_id: userId,
        last_auto_sync_at: new Date().toISOString(),
        next_auto_sync_at: new Date(Date.now() + intervalHours * 60 * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );

    return { orders, transactions, payouts, totalDuration };
  }

  /**
   * Perform historical import of all eBay data
   */
  async performHistoricalImport(userId: string, fromDate: string): Promise<EbayFullSyncResult> {
    const startTime = Date.now();
    const toDate = new Date().toISOString();

    const supabase = await this.getSupabase();

    // Mark historical import as started
    await supabase.from('ebay_sync_config').upsert(
      {
        user_id: userId,
        historical_import_started_at: new Date().toISOString(),
        historical_import_from_date: fromDate,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );

    // Sync transactions and payouts first (5-year history available)
    const transactions = await this.transactionSyncService.syncTransactions(userId, {
      fromDate,
      toDate,
    });
    const payouts = await this.transactionSyncService.syncPayouts(userId, { fromDate, toDate });

    // Sync orders with chunking (90-day limit per request)
    const orders = await this.orderSyncService.syncOrders(userId, {
      fromDate,
      toDate,
      enrichTransactions: true,
    });

    const totalDuration = Date.now() - startTime;

    // Mark historical import as completed
    if (transactions.success && payouts.success && orders.success) {
      await supabase
        .from('ebay_sync_config')
        .update({
          historical_import_completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId);
    }

    return { orders, transactions, payouts, totalDuration };
  }

  // ============================================================================
  // Auto Sync Management
  // ============================================================================

  /**
   * Check if auto sync should run and execute if needed
   * Call this from a cron job or scheduler
   */
  async checkAndRunAutoSync(userId: string): Promise<EbayFullSyncResult | null> {
    const config = await this.getConfig(userId);

    if (!config?.autoSyncEnabled) {
      return null;
    }

    // Check if it's time to sync
    if (config.nextAutoSyncAt && new Date() < config.nextAutoSyncAt) {
      return null; // Not time yet
    }

    // Check if eBay is connected
    const isConnected = await this.authService.isConnected(userId);
    if (!isConnected) {
      console.log('[EbayAutoSyncService] eBay not connected, skipping auto sync');
      return null;
    }

    // Run incremental sync
    console.log(`[EbayAutoSyncService] Running auto sync for user ${userId}`);
    return this.performIncrementalSync(userId);
  }

  /**
   * Calculate next sync time based on config
   */
  private calculateNextSyncTime(_userId: string): Date {
    // Default to 24 hours
    return new Date(Date.now() + 24 * 60 * 60 * 1000);
  }

  // ============================================================================
  // Configuration Management
  // ============================================================================

  /**
   * Get sync configuration for a user
   */
  async getConfig(userId: string): Promise<EbaySyncConfig | null> {
    const supabase = await this.getSupabase();

    const { data } = await supabase
      .from('ebay_sync_config')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!data) return null;

    return {
      autoSyncEnabled: data.auto_sync_enabled,
      autoSyncIntervalHours: data.auto_sync_interval_hours,
      lastAutoSyncAt: data.last_auto_sync_at ? new Date(data.last_auto_sync_at) : undefined,
      nextAutoSyncAt: data.next_auto_sync_at ? new Date(data.next_auto_sync_at) : undefined,
      ordersLastModifiedCursor: data.orders_last_modified_cursor
        ? new Date(data.orders_last_modified_cursor)
        : undefined,
      transactionsDateCursor: data.transactions_date_cursor
        ? new Date(data.transactions_date_cursor)
        : undefined,
      payoutsDateCursor: data.payouts_date_cursor ? new Date(data.payouts_date_cursor) : undefined,
      historicalImportStartedAt: data.historical_import_started_at
        ? new Date(data.historical_import_started_at)
        : undefined,
      historicalImportCompletedAt: data.historical_import_completed_at
        ? new Date(data.historical_import_completed_at)
        : undefined,
      historicalImportFromDate: data.historical_import_from_date || undefined,
    };
  }

  /**
   * Update sync configuration
   */
  async updateConfig(
    userId: string,
    updates: Partial<Pick<EbaySyncConfig, 'autoSyncEnabled' | 'autoSyncIntervalHours'>>
  ): Promise<EbaySyncConfig> {
    const supabase = await this.getSupabase();

    const updateData: {
      user_id: string;
      updated_at: string;
      auto_sync_enabled?: boolean;
      auto_sync_interval_hours?: number;
      next_auto_sync_at?: string;
    } = {
      user_id: userId,
      updated_at: new Date().toISOString(),
    };

    if (updates.autoSyncEnabled !== undefined) {
      updateData.auto_sync_enabled = updates.autoSyncEnabled;

      // If enabling auto sync, calculate next sync time
      if (updates.autoSyncEnabled) {
        const intervalHours = updates.autoSyncIntervalHours || 24;
        updateData.next_auto_sync_at = new Date(
          Date.now() + intervalHours * 60 * 60 * 1000
        ).toISOString();
      }
    }

    if (updates.autoSyncIntervalHours !== undefined) {
      updateData.auto_sync_interval_hours = updates.autoSyncIntervalHours;
    }

    const { data, error } = await supabase
      .from('ebay_sync_config')
      .upsert(updateData, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) {
      console.error('[EbayAutoSyncService] Failed to update config:', error);
      throw new Error('Failed to update sync configuration');
    }

    return {
      autoSyncEnabled: data.auto_sync_enabled,
      autoSyncIntervalHours: data.auto_sync_interval_hours,
      lastAutoSyncAt: data.last_auto_sync_at ? new Date(data.last_auto_sync_at) : undefined,
      nextAutoSyncAt: data.next_auto_sync_at ? new Date(data.next_auto_sync_at) : undefined,
      ordersLastModifiedCursor: data.orders_last_modified_cursor
        ? new Date(data.orders_last_modified_cursor)
        : undefined,
      transactionsDateCursor: data.transactions_date_cursor
        ? new Date(data.transactions_date_cursor)
        : undefined,
      payoutsDateCursor: data.payouts_date_cursor ? new Date(data.payouts_date_cursor) : undefined,
      historicalImportStartedAt: data.historical_import_started_at
        ? new Date(data.historical_import_started_at)
        : undefined,
      historicalImportCompletedAt: data.historical_import_completed_at
        ? new Date(data.historical_import_completed_at)
        : undefined,
      historicalImportFromDate: data.historical_import_from_date || undefined,
    };
  }

  // ============================================================================
  // Status Summary
  // ============================================================================

  /**
   * Get comprehensive sync status summary
   */
  async getSyncStatusSummary(userId: string): Promise<EbaySyncStatusSummary> {
    const supabase = await this.getSupabase();

    // Check connection
    const isConnected = await this.authService.isConnected(userId);

    if (!isConnected) {
      return { isConnected: false, isRunning: false, runningSyncTypes: [] };
    }

    // Get running syncs
    const { data: runningSyncs } = await supabase
      .from('ebay_sync_log')
      .select('sync_type')
      .eq('user_id', userId)
      .eq('status', 'RUNNING');

    const runningSyncTypes = runningSyncs?.map((s) => s.sync_type) || [];

    // Get config
    const config = await this.getConfig(userId);

    // Get last sync for each type
    const { data: lastOrders } = await supabase
      .from('ebay_sync_log')
      .select('status, completed_at, records_processed')
      .eq('user_id', userId)
      .eq('sync_type', 'ORDERS')
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    const { data: lastTransactions } = await supabase
      .from('ebay_sync_log')
      .select('status, completed_at, records_processed')
      .eq('user_id', userId)
      .eq('sync_type', 'TRANSACTIONS')
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    const { data: lastPayouts } = await supabase
      .from('ebay_sync_log')
      .select('status, completed_at, records_processed')
      .eq('user_id', userId)
      .eq('sync_type', 'PAYOUTS')
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    return {
      isConnected: true,
      isRunning: runningSyncTypes.length > 0,
      runningSyncTypes,
      config: config || undefined,
      lastSync: {
        orders: lastOrders
          ? {
              status: lastOrders.status,
              completedAt: lastOrders.completed_at ? new Date(lastOrders.completed_at) : undefined,
              recordsProcessed: lastOrders.records_processed || 0,
            }
          : undefined,
        transactions: lastTransactions
          ? {
              status: lastTransactions.status,
              completedAt: lastTransactions.completed_at
                ? new Date(lastTransactions.completed_at)
                : undefined,
              recordsProcessed: lastTransactions.records_processed || 0,
            }
          : undefined,
        payouts: lastPayouts
          ? {
              status: lastPayouts.status,
              completedAt: lastPayouts.completed_at
                ? new Date(lastPayouts.completed_at)
                : undefined,
              recordsProcessed: lastPayouts.records_processed || 0,
            }
          : undefined,
      },
    };
  }
}

// Export a default instance
export const ebayAutoSyncService = new EbayAutoSyncService();
