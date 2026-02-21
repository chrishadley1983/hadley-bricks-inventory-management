/**
 * BrickLink Transaction Sync Service
 *
 * Handles syncing ALL BrickLink orders to the bricklink_transactions table
 * with full financial breakdown. Follows the PayPal pattern.
 */

import { createClient } from '@/lib/supabase/server';
import { BrickLinkClient } from './client';
import { CredentialsRepository } from '@/lib/repositories';
import type { BrickLinkCredentials, BrickLinkOrderSummary } from './types';
import type {
  BrickLinkSyncResult,
  BrickLinkSyncMode,
  BrickLinkSyncOptions,
  BrickLinkConnectionStatus,
  Json,
} from './bricklink-transaction.types';
import { parseCurrencyValue } from './bricklink-transaction.types';

// ============================================================================
// Constants
// ============================================================================

const BATCH_SIZE = 100; // Upsert batch size

// ============================================================================
// Types
// ============================================================================

interface TransactionRow {
  user_id: string;
  bricklink_order_id: string;
  order_date: string;
  status_changed_date: string | null;
  buyer_name: string;
  buyer_email: string | null;
  base_currency: string;
  shipping: number;
  insurance: number;
  add_charge_1: number;
  add_charge_2: number;
  credit: number;
  coupon_credit: number;
  order_total: number;
  tax: number;
  base_grand_total: number;
  total_lots: number;
  total_items: number;
  order_status: string;
  payment_status: string | null;
  payment_method: string | null;
  payment_date: string | null;
  tracking_number: string | null;
  shipping_method: string | null;
  buyer_location: string | null;
  order_note: string | null;
  seller_remarks: string | null;
  raw_response: Json;
}

// ============================================================================
// BrickLinkTransactionSyncService Class
// ============================================================================

export class BrickLinkTransactionSyncService {
  // ============================================================================
  // Connection Status
  // ============================================================================

  /**
   * Get connection status and sync information
   */
  async getConnectionStatus(userId: string): Promise<BrickLinkConnectionStatus> {
    const supabase = await createClient();
    const credentialsRepo = new CredentialsRepository(supabase);

    // Check if credentials exist
    const hasCredentials = await credentialsRepo.hasCredentials(userId, 'bricklink');

    if (!hasCredentials) {
      return { isConnected: false };
    }

    // Get transaction count
    const { count: transactionCount } = await supabase
      .from('bricklink_transactions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    // Get sync config
    const { data: syncConfig } = await supabase
      .from('bricklink_sync_config')
      .select('*')
      .eq('user_id', userId)
      .single();

    // Get recent sync logs
    const { data: recentLogs } = await supabase
      .from('bricklink_sync_log')
      .select('*')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(5);

    // Get last successful sync
    const { data: lastSync } = await supabase
      .from('bricklink_sync_log')
      .select('completed_at')
      .eq('user_id', userId)
      .eq('status', 'COMPLETED')
      .order('completed_at', { ascending: false })
      .limit(1)
      .single();

    return {
      isConnected: true,
      transactionCount: transactionCount ?? 0,
      lastSyncAt: lastSync?.completed_at ?? undefined,
      syncConfig: syncConfig
        ? {
            autoSyncEnabled: syncConfig.auto_sync_enabled,
            autoSyncIntervalHours: syncConfig.auto_sync_interval_hours,
            nextAutoSyncAt: syncConfig.next_auto_sync_at ?? undefined,
            lastSyncCursor: syncConfig.last_sync_date_cursor ?? undefined,
            historicalImportCompleted: !!syncConfig.historical_import_completed_at,
            includeFiled: syncConfig.include_filed_orders,
          }
        : undefined,
      recentLogs: recentLogs?.map((log) => ({
        id: log.id,
        syncMode: log.sync_mode as BrickLinkSyncMode,
        status: log.status as 'RUNNING' | 'COMPLETED' | 'FAILED',
        startedAt: log.started_at,
        completedAt: log.completed_at ?? undefined,
        ordersProcessed: log.orders_processed ?? undefined,
        ordersCreated: log.orders_created ?? undefined,
        ordersUpdated: log.orders_updated ?? undefined,
        error: log.error_message ?? undefined,
      })),
    };
  }

  // ============================================================================
  // Transaction Sync
  // ============================================================================

  /**
   * Sync transactions from BrickLink API
   * Stores ALL orders (no filtering)
   */
  async syncTransactions(
    userId: string,
    options?: BrickLinkSyncOptions
  ): Promise<BrickLinkSyncResult> {
    console.log(
      '[BrickLinkTransactionSyncService] Starting transaction sync for user:',
      userId,
      'options:',
      options
    );
    const startedAt = new Date();
    const supabase = await createClient();
    const syncMode: BrickLinkSyncMode = options?.fromDate
      ? 'HISTORICAL'
      : options?.fullSync
        ? 'FULL'
        : 'INCREMENTAL';
    console.log('[BrickLinkTransactionSyncService] Sync mode:', syncMode);

    // Check for running sync
    const { data: runningSync } = await supabase
      .from('bricklink_sync_log')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'RUNNING')
      .single();

    if (runningSync) {
      console.log('[BrickLinkTransactionSyncService] A sync is already running, skipping');
      return {
        success: false,
        syncMode,
        ordersProcessed: 0,
        ordersCreated: 0,
        ordersUpdated: 0,
        ordersSkipped: 0,
        error: 'A sync is already running',
        startedAt,
        completedAt: new Date(),
      };
    }

    // Create sync log entry
    console.log('[BrickLinkTransactionSyncService] Creating sync log entry');
    const { data: syncLog, error: syncLogError } = await supabase
      .from('bricklink_sync_log')
      .insert({
        user_id: userId,
        sync_mode: syncMode,
        status: 'RUNNING',
        started_at: startedAt.toISOString(),
        from_date: options?.fromDate ?? null,
        to_date: options?.toDate ?? null,
      })
      .select()
      .single();

    if (syncLogError || !syncLog) {
      console.error('[BrickLinkTransactionSyncService] Failed to create sync log:', syncLogError);
      return {
        success: false,
        syncMode,
        ordersProcessed: 0,
        ordersCreated: 0,
        ordersUpdated: 0,
        ordersSkipped: 0,
        error: 'Failed to create sync log',
        startedAt,
        completedAt: new Date(),
      };
    }

    console.log('[BrickLinkTransactionSyncService] Sync log created:', syncLog.id);

    try {
      // Get BrickLink client
      console.log('[BrickLinkTransactionSyncService] Getting BrickLink client...');
      const credentialsRepo = new CredentialsRepository(supabase);
      const credentials = await credentialsRepo.getCredentials<BrickLinkCredentials>(
        userId,
        'bricklink'
      );

      if (!credentials) {
        throw new Error('BrickLink credentials not configured');
      }

      const client = new BrickLinkClient(credentials);
      console.log('[BrickLinkTransactionSyncService] BrickLink client ready');

      // Fetch all sales orders from BrickLink
      // BrickLink API: filed=false returns active orders, filed=true returns archived orders
      // We need BOTH to get all orders
      console.log('[BrickLinkTransactionSyncService] Fetching orders from BrickLink API...');
      const includeFiled = options?.includeFiled ?? false;

      // Get active orders (not filed)
      const activeOrders = await client.getSalesOrders(undefined, false);
      console.log('[BrickLinkTransactionSyncService] Active orders fetched:', activeOrders.length);

      // Get filed/archived orders if requested
      let filedOrders: typeof activeOrders = [];
      if (includeFiled) {
        filedOrders = await client.getSalesOrders(undefined, true);
        console.log('[BrickLinkTransactionSyncService] Filed orders fetched:', filedOrders.length);
      }

      // Combine and dedupe (in case of overlap)
      const orderMap = new Map<number, (typeof activeOrders)[0]>();
      for (const order of activeOrders) {
        orderMap.set(order.order_id, order);
      }
      for (const order of filedOrders) {
        orderMap.set(order.order_id, order);
      }
      const allOrders = Array.from(orderMap.values());
      console.log('[BrickLinkTransactionSyncService] Total orders fetched:', allOrders.length);

      // Filter by date if doing incremental sync
      let ordersToProcess = allOrders;
      if (syncMode === 'INCREMENTAL') {
        // Get sync cursor
        const { data: syncConfig } = await supabase
          .from('bricklink_sync_config')
          .select('last_sync_date_cursor')
          .eq('user_id', userId)
          .single();

        if (syncConfig?.last_sync_date_cursor) {
          const cursorDate = new Date(syncConfig.last_sync_date_cursor);
          ordersToProcess = allOrders.filter((order) => {
            const orderDate = new Date(order.date_ordered);
            return orderDate >= cursorDate;
          });
          console.log(
            `[BrickLinkTransactionSyncService] Filtered to ${ordersToProcess.length} orders since ${syncConfig.last_sync_date_cursor}`
          );
        }
      } else if (syncMode === 'HISTORICAL' && options?.fromDate) {
        const fromDate = new Date(options.fromDate);
        const toDate = options?.toDate ? new Date(options.toDate) : new Date();
        ordersToProcess = allOrders.filter((order) => {
          const orderDate = new Date(order.date_ordered);
          return orderDate >= fromDate && orderDate <= toDate;
        });
        console.log(
          `[BrickLinkTransactionSyncService] Filtered to ${ordersToProcess.length} orders in date range`
        );
      }

      // Transform and upsert orders
      console.log('[BrickLinkTransactionSyncService] Upserting orders to database...');
      const { created, updated } = await this.upsertTransactions(userId, ordersToProcess);
      console.log(
        '[BrickLinkTransactionSyncService] Upsert complete. Created:',
        created,
        'Updated:',
        updated
      );

      // Update sync cursor to newest order date
      const newestDate =
        ordersToProcess.length > 0
          ? ordersToProcess
              .reduce((newest, order) => {
                const orderDate = new Date(order.date_ordered);
                return orderDate > newest ? orderDate : newest;
              }, new Date(0))
              .toISOString()
          : new Date().toISOString();

      // Update sync config with cursor
      await supabase.from('bricklink_sync_config').upsert(
        {
          user_id: userId,
          last_sync_date_cursor: newestDate,
          include_filed_orders: includeFiled,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );

      const completedAt = new Date();

      // Update sync log
      await supabase
        .from('bricklink_sync_log')
        .update({
          status: 'COMPLETED',
          completed_at: completedAt.toISOString(),
          orders_processed: ordersToProcess.length,
          orders_created: created,
          orders_updated: updated,
          orders_skipped: 0,
          last_sync_cursor: newestDate,
        })
        .eq('id', syncLog.id);

      return {
        success: true,
        syncMode,
        ordersProcessed: ordersToProcess.length,
        ordersCreated: created,
        ordersUpdated: updated,
        ordersSkipped: 0,
        lastSyncCursor: newestDate,
        startedAt,
        completedAt,
      };
    } catch (error) {
      const completedAt = new Date();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[BrickLinkTransactionSyncService] Sync error:', errorMessage);

      // Update sync log with error
      await supabase
        .from('bricklink_sync_log')
        .update({
          status: 'FAILED',
          completed_at: completedAt.toISOString(),
          error_message: errorMessage,
        })
        .eq('id', syncLog.id);

      return {
        success: false,
        syncMode,
        ordersProcessed: 0,
        ordersCreated: 0,
        ordersUpdated: 0,
        ordersSkipped: 0,
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
  async performHistoricalImport(userId: string, fromDate: string): Promise<BrickLinkSyncResult> {
    const supabase = await createClient();
    const toDate = new Date().toISOString();

    // Update sync config to track historical import
    await supabase.from('bricklink_sync_config').upsert(
      {
        user_id: userId,
        historical_import_started_at: new Date().toISOString(),
        historical_import_from_date: fromDate,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );

    // Perform sync with date range
    const result = await this.syncTransactions(userId, {
      fromDate,
      toDate,
      includeFiled: true, // Include archived orders for historical import
    });

    // Update historical import completion if successful
    if (result.success) {
      await supabase
        .from('bricklink_sync_config')
        .update({
          historical_import_completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId);
    }

    return result;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Transform BrickLink order to database row
   *
   * NOTE: BrickLink's list orders endpoint only returns limited cost info:
   * - subtotal (item cost)
   * - grand_total/final_total (total including shipping/etc)
   * - currency_code
   *
   * It does NOT return shipping, insurance, etc1, etc2 separately.
   * We calculate shipping as: grand_total - subtotal (approximation)
   */
  private transformOrderToRow(userId: string, order: BrickLinkOrderSummary): TransactionRow {
    const cost = order.cost;

    // Parse values
    const subtotal = parseCurrencyValue(cost.subtotal);
    const grandTotal = parseCurrencyValue(cost.grand_total) || parseCurrencyValue(cost.final_total);

    // BrickLink list endpoint doesn't include shipping breakdown
    // Calculate shipping as the difference between grand total and subtotal
    // This includes shipping + insurance + any other charges
    const shippingRaw = parseCurrencyValue(cost.shipping);
    const calculatedShipping = shippingRaw > 0 ? shippingRaw : Math.max(0, grandTotal - subtotal);

    return {
      user_id: userId,
      bricklink_order_id: String(order.order_id),
      order_date: order.date_ordered,
      status_changed_date: order.date_status_changed ?? null,
      buyer_name: order.buyer_name,
      buyer_email: order.buyer_email ?? null,
      base_currency: cost.currency_code || 'GBP',
      shipping: calculatedShipping,
      insurance: parseCurrencyValue(cost.insurance),
      add_charge_1: parseCurrencyValue(cost.etc1),
      add_charge_2: parseCurrencyValue(cost.etc2),
      credit: parseCurrencyValue(cost.credit),
      coupon_credit: parseCurrencyValue(cost.coupon),
      order_total: subtotal,
      tax: parseCurrencyValue(cost.vat_amount) || parseCurrencyValue(cost.salesTax_collected_by_bl),
      base_grand_total: grandTotal,
      total_lots: order.unique_count || 0,
      total_items: order.total_count || 0,
      order_status: order.status,
      payment_status: order.payment?.status ?? null,
      payment_method: order.payment?.method ?? null,
      payment_date: order.payment?.date_paid ?? null,
      tracking_number: order.shipping?.tracking_no ?? null,
      shipping_method: order.shipping?.method ?? null,
      buyer_location: order.shipping?.address?.country_code ?? null,
      order_note: order.remarks ?? null,
      seller_remarks: null, // Not available in order summary
      raw_response: order as unknown as Json,
    };
  }

  /**
   * Upsert transactions to database in batches
   */
  private async upsertTransactions(
    userId: string,
    orders: BrickLinkOrderSummary[]
  ): Promise<{ created: number; updated: number }> {
    const supabase = await createClient();
    let created = 0;
    let updated = 0;

    // Get existing order IDs for this user
    const orderIds = orders.map((o) => String(o.order_id));
    const { data: existingOrders } = await supabase
      .from('bricklink_transactions')
      .select('bricklink_order_id')
      .eq('user_id', userId)
      .in('bricklink_order_id', orderIds);

    const existingOrderIds = new Set(existingOrders?.map((o) => o.bricklink_order_id) || []);

    // Transform orders to rows
    const rows = orders.map((order) => this.transformOrderToRow(userId, order));

    // Count created vs updated
    for (const row of rows) {
      if (existingOrderIds.has(row.bricklink_order_id)) {
        updated++;
      } else {
        created++;
      }
    }

    // Upsert in batches
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from('bricklink_transactions')
        .upsert(batch, { onConflict: 'user_id,bricklink_order_id' });

      if (error) {
        console.error('[BrickLinkTransactionSyncService] Upsert error:', error);
        throw new Error(`Failed to upsert transactions: ${error.message}`);
      }
    }

    return { created, updated };
  }
}

// Export singleton instance factory
export function createBrickLinkTransactionSyncService(): BrickLinkTransactionSyncService {
  return new BrickLinkTransactionSyncService();
}
