/**
 * BrickOwl Transaction Sync Service
 *
 * Handles syncing ALL BrickOwl orders to the brickowl_transactions table
 * with full financial breakdown. Follows the BrickLink pattern.
 */

import { createClient } from '@/lib/supabase/server';
import { BrickOwlClient } from './client';
import { CredentialsRepository } from '@/lib/repositories';
import type { BrickOwlCredentials, BrickOwlOrderDetail } from './types';
import type {
  BrickOwlSyncResult,
  BrickOwlSyncMode,
  BrickOwlSyncOptions,
  BrickOwlConnectionStatus,
  Json,
} from './brickowl-transaction.types';
import { parseCurrencyValue } from './brickowl-transaction.types';

// ============================================================================
// Types for list endpoint (minimal fields)
// ============================================================================

/** Order summary from /order/list endpoint (minimal fields) */
interface BrickOwlOrderListItem {
  order_id: string;
  order_date: string; // Unix timestamp as string
  total_quantity?: string;
  total_lots?: string;
  base_order_total?: string;
  status: string;
  status_id?: string;
}

// ============================================================================
// Constants
// ============================================================================

const BATCH_SIZE = 100; // Upsert batch size

// ============================================================================
// Types
// ============================================================================

interface TransactionRow {
  user_id: string;
  brickowl_order_id: string;
  order_date: string;
  status_changed_date: string | null;
  buyer_name: string;
  buyer_email: string | null;
  buyer_username: string | null;
  base_currency: string;
  order_total: number;
  shipping: number;
  tax: number;
  coupon_discount: number;
  combined_shipping_discount: number;
  base_grand_total: number;
  total_lots: number;
  total_items: number;
  order_status: string;
  payment_status: string | null;
  payment_method: string | null;
  tracking_number: string | null;
  shipping_method: string | null;
  buyer_location: string | null;
  buyer_note: string | null;
  seller_note: string | null;
  public_note: string | null;
  raw_response: Json;
}

// ============================================================================
// BrickOwlTransactionSyncService Class
// ============================================================================

export class BrickOwlTransactionSyncService {
  // ============================================================================
  // Connection Status
  // ============================================================================

  /**
   * Get connection status and sync information
   */
  async getConnectionStatus(userId: string): Promise<BrickOwlConnectionStatus> {
    const supabase = await createClient();
    const credentialsRepo = new CredentialsRepository(supabase);

    // Check if credentials exist
    const hasCredentials = await credentialsRepo.hasCredentials(userId, 'brickowl');

    if (!hasCredentials) {
      return { isConnected: false };
    }

    // Get transaction count
    const { count: transactionCount } = await supabase
      .from('brickowl_transactions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    // Get sync config
    const { data: syncConfig } = await supabase
      .from('brickowl_sync_config')
      .select('*')
      .eq('user_id', userId)
      .single();

    // Get recent sync logs
    const { data: recentLogs } = await supabase
      .from('brickowl_sync_log')
      .select('*')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(5);

    // Get last successful sync
    const { data: lastSync } = await supabase
      .from('brickowl_sync_log')
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
          }
        : undefined,
      recentLogs: recentLogs?.map((log) => ({
        id: log.id,
        syncMode: log.sync_mode as BrickOwlSyncMode,
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
   * Sync transactions from BrickOwl API
   * Stores ALL orders (no filtering)
   */
  async syncTransactions(
    userId: string,
    options?: BrickOwlSyncOptions
  ): Promise<BrickOwlSyncResult> {
    console.log(
      '[BrickOwlTransactionSyncService] Starting transaction sync for user:',
      userId,
      'options:',
      options
    );
    const startedAt = new Date();
    const supabase = await createClient();
    const syncMode: BrickOwlSyncMode = options?.fromDate
      ? 'HISTORICAL'
      : options?.fullSync
        ? 'FULL'
        : 'INCREMENTAL';
    console.log('[BrickOwlTransactionSyncService] Sync mode:', syncMode);

    // Check for running sync
    const { data: runningSync } = await supabase
      .from('brickowl_sync_log')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'RUNNING')
      .single();

    if (runningSync) {
      console.log('[BrickOwlTransactionSyncService] A sync is already running, skipping');
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
    console.log('[BrickOwlTransactionSyncService] Creating sync log entry');
    const { data: syncLog, error: syncLogError } = await supabase
      .from('brickowl_sync_log')
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
      console.error('[BrickOwlTransactionSyncService] Failed to create sync log:', syncLogError);
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

    console.log('[BrickOwlTransactionSyncService] Sync log created:', syncLog.id);

    try {
      // Get BrickOwl client
      console.log('[BrickOwlTransactionSyncService] Getting BrickOwl client...');
      const credentialsRepo = new CredentialsRepository(supabase);
      const credentials = await credentialsRepo.getCredentials<BrickOwlCredentials>(
        userId,
        'brickowl'
      );

      if (!credentials) {
        throw new Error('BrickOwl credentials not configured');
      }

      const client = new BrickOwlClient(credentials);
      console.log('[BrickOwlTransactionSyncService] BrickOwl client ready');

      // Fetch order list from BrickOwl (minimal data - just IDs and dates)
      console.log('[BrickOwlTransactionSyncService] Fetching order list from BrickOwl API...');
      const orderList = (await client.getSalesOrders()) as unknown as BrickOwlOrderListItem[];
      console.log('[BrickOwlTransactionSyncService] Total orders in list:', orderList.length);

      // Helper to parse Unix timestamp from order_date field
      const getOrderDateFromList = (order: BrickOwlOrderListItem): Date | null => {
        if (!order.order_date) return null;
        // order_date is a Unix timestamp as string (seconds since epoch)
        const timestamp = parseInt(order.order_date, 10);
        if (isNaN(timestamp)) return null;
        return new Date(timestamp * 1000);
      };

      // Filter by date if doing incremental sync
      let ordersToFetch = orderList;
      if (syncMode === 'INCREMENTAL') {
        // Get sync cursor
        const { data: syncConfig } = await supabase
          .from('brickowl_sync_config')
          .select('last_sync_date_cursor')
          .eq('user_id', userId)
          .single();

        if (syncConfig?.last_sync_date_cursor) {
          const cursorDate = new Date(syncConfig.last_sync_date_cursor);
          ordersToFetch = orderList.filter((order) => {
            const orderDate = getOrderDateFromList(order);
            return orderDate && orderDate >= cursorDate;
          });
          console.log(
            `[BrickOwlTransactionSyncService] Filtered to ${ordersToFetch.length} orders since ${syncConfig.last_sync_date_cursor}`
          );
        }
      } else if (syncMode === 'HISTORICAL' && options?.fromDate) {
        const fromDate = new Date(options.fromDate);
        const toDate = options?.toDate ? new Date(options.toDate) : new Date();
        ordersToFetch = orderList.filter((order) => {
          const orderDate = getOrderDateFromList(order);
          return orderDate && orderDate >= fromDate && orderDate <= toDate;
        });
        console.log(
          `[BrickOwlTransactionSyncService] Filtered to ${ordersToFetch.length} orders in date range`
        );
      }

      // Fetch full details for each order
      console.log(
        `[BrickOwlTransactionSyncService] Fetching details for ${ordersToFetch.length} orders...`
      );
      const fullOrders: BrickOwlOrderDetail[] = [];
      for (const orderSummary of ordersToFetch) {
        try {
          const fullOrder = await client.getOrder(orderSummary.order_id);
          fullOrders.push(fullOrder);
          // Debug: log first order to see available fields
          if (fullOrders.length === 1) {
            console.log(
              '[BrickOwlTransactionSyncService] Sample full order fields:',
              JSON.stringify(fullOrder, null, 2)
            );
          }
        } catch (err) {
          console.warn(
            `[BrickOwlTransactionSyncService] Failed to fetch order ${orderSummary.order_id}:`,
            err
          );
        }
      }
      console.log(
        `[BrickOwlTransactionSyncService] Successfully fetched ${fullOrders.length} order details`
      );

      // Transform and upsert orders
      console.log('[BrickOwlTransactionSyncService] Upserting orders to database...');
      const { created, updated, skipped } = await this.upsertTransactions(userId, fullOrders);
      console.log(
        '[BrickOwlTransactionSyncService] Upsert complete. Created:',
        created,
        'Updated:',
        updated,
        'Skipped:',
        skipped
      );

      // Update sync cursor to newest order date
      const newestDate =
        ordersToFetch.length > 0
          ? ordersToFetch
              .reduce((newest, order) => {
                const orderDate = getOrderDateFromList(order);
                if (!orderDate) return newest;
                return orderDate > newest ? orderDate : newest;
              }, new Date(0))
              .toISOString()
          : new Date().toISOString();

      // Update sync config with cursor
      await supabase.from('brickowl_sync_config').upsert(
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
        .from('brickowl_sync_log')
        .update({
          status: 'COMPLETED',
          completed_at: completedAt.toISOString(),
          orders_processed: ordersToFetch.length,
          orders_created: created,
          orders_updated: updated,
          orders_skipped: skipped,
          last_sync_cursor: newestDate,
        })
        .eq('id', syncLog.id);

      return {
        success: true,
        syncMode,
        ordersProcessed: ordersToFetch.length,
        ordersCreated: created,
        ordersUpdated: updated,
        ordersSkipped: skipped,
        lastSyncCursor: newestDate,
        startedAt,
        completedAt,
      };
    } catch (error) {
      const completedAt = new Date();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[BrickOwlTransactionSyncService] Sync error:', errorMessage);

      // Update sync log with error
      await supabase
        .from('brickowl_sync_log')
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
  async performHistoricalImport(userId: string, fromDate: string): Promise<BrickOwlSyncResult> {
    const supabase = await createClient();
    const toDate = new Date().toISOString();

    // Update sync config to track historical import
    await supabase.from('brickowl_sync_config').upsert(
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
    });

    // Update historical import completion if successful
    if (result.success) {
      await supabase
        .from('brickowl_sync_config')
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
   * Convert a date value to ISO string
   * Handles: Unix timestamps (string or number), ISO strings, and Date objects
   */
  private toISODateString(value: string | number | undefined | null): string | null {
    if (!value) return null;

    // If it's already an ISO string (contains 'T' or '-'), return as-is
    if (typeof value === 'string' && (value.includes('T') || value.includes('-'))) {
      return value;
    }

    // Parse as Unix timestamp (seconds since epoch)
    const timestamp = typeof value === 'string' ? parseInt(value, 10) : value;
    if (isNaN(timestamp)) return null;

    // Convert seconds to milliseconds and create Date
    const date = new Date(timestamp * 1000);
    if (isNaN(date.getTime())) return null;

    return date.toISOString();
  }

  /**
   * Transform BrickOwl order detail to database row
   * Returns null if order has no valid date
   */
  private transformOrderToRow(userId: string, order: BrickOwlOrderDetail): TransactionRow | null {
    // Determine order date - prefer iso_order_time, fallback to order_time
    // Both may be Unix timestamps or ISO strings depending on API version
    const orderDate =
      this.toISODateString(order.iso_order_time) || this.toISODateString(order.order_time);
    if (!orderDate) {
      console.warn(
        `[BrickOwlTransactionSyncService] Order ${order.order_id} has no valid date, skipping`
      );
      return null;
    }

    // Determine the most recent status-changed date (convert timestamps)
    const statusDates = [order.processed_time, order.shipped_time, order.received_time]
      .map((d) => this.toISODateString(d))
      .filter((d): d is string => d !== null);
    const statusChangedDate = statusDates.length > 0 ? statusDates[statusDates.length - 1] : null;

    // Build buyer location from shipping address
    const buyerLocation = order.ship_country || order.ship_country_code || null;

    // Cast to Record to access fields that may not be in TypeScript types
    const orderAny = order as unknown as Record<string, unknown>;

    // Parse numeric/string values - BrickOwl returns most values as strings
    // Field names from actual API response (see Sample full order fields log):
    // - sub_total: subtotal before shipping
    // - ship_total: shipping cost (NOT total_shipping)
    // - tax_amount: tax amount (NOT total_tax)
    // - total_quantity: item count (NOT total_qty)
    // - total_lots: lot count
    // - base_order_total or payment_total: grand total
    const subTotal = parseCurrencyValue(orderAny.sub_total);
    const shipping = parseCurrencyValue(orderAny.ship_total);
    const tax = parseCurrencyValue(orderAny.tax_amount);
    const couponDiscount = parseCurrencyValue(orderAny.coupon_discount);
    const combinedDiscount = parseCurrencyValue(orderAny.combined_shipping_discount);

    // Grand total - use payment_total or base_order_total
    const grandTotal =
      parseCurrencyValue(orderAny.payment_total) || parseCurrencyValue(orderAny.base_order_total);

    // Lot and item counts - BrickOwl returns these as strings
    const totalLots =
      typeof orderAny.total_lots === 'string'
        ? parseInt(orderAny.total_lots, 10) || 0
        : typeof orderAny.total_lots === 'number'
          ? orderAny.total_lots
          : 0;
    const totalItems =
      typeof orderAny.total_quantity === 'string'
        ? parseInt(orderAny.total_quantity, 10) || 0
        : typeof orderAny.total_quantity === 'number'
          ? orderAny.total_quantity
          : 0;

    // Map API field names to our database fields
    // API uses: customer_email, customer_username, ship_method_name, base_currency
    const buyerEmail = (orderAny.customer_email as string) ?? order.buyer_email ?? null;
    const buyerUsername = (orderAny.customer_username as string) ?? order.buyer_username ?? null;
    const shippingMethod = (orderAny.ship_method_name as string) ?? order.shipping_method ?? null;
    const baseCurrency = (orderAny.base_currency as string) ?? order.currency ?? 'GBP';

    return {
      user_id: userId,
      brickowl_order_id: String(order.order_id),
      order_date: orderDate,
      status_changed_date: statusChangedDate ?? null,
      buyer_name: order.buyer_name,
      buyer_email: buyerEmail,
      buyer_username: buyerUsername,
      base_currency: baseCurrency,
      order_total: subTotal,
      shipping: shipping,
      tax: tax,
      coupon_discount: couponDiscount,
      combined_shipping_discount: combinedDiscount,
      base_grand_total: grandTotal,
      total_lots: totalLots,
      total_items: totalItems,
      order_status: order.status,
      payment_status: order.payment_status ?? null,
      payment_method: order.payment_method_text ?? order.payment_method_type ?? null,
      tracking_number: order.tracking_number ?? null,
      shipping_method: shippingMethod,
      buyer_location: buyerLocation,
      buyer_note: order.buyer_note ?? null,
      seller_note: order.seller_note ?? null,
      public_note: order.public_note ?? null,
      raw_response: order as unknown as Json,
    };
  }

  /**
   * Upsert transactions to database in batches
   */
  private async upsertTransactions(
    userId: string,
    orders: BrickOwlOrderDetail[]
  ): Promise<{ created: number; updated: number; skipped: number }> {
    const supabase = await createClient();
    let created = 0;
    let updated = 0;
    let skipped = 0;

    // Get existing order IDs for this user
    const orderIds = orders.map((o) => String(o.order_id));
    const { data: existingOrders } = await supabase
      .from('brickowl_transactions')
      .select('brickowl_order_id')
      .eq('user_id', userId)
      .in('brickowl_order_id', orderIds);

    const existingOrderIds = new Set(existingOrders?.map((o) => o.brickowl_order_id) || []);

    // Transform orders to rows, filtering out nulls (orders without valid dates)
    const rows = orders
      .map((order) => this.transformOrderToRow(userId, order))
      .filter((row): row is TransactionRow => row !== null);

    // Count skipped orders
    skipped = orders.length - rows.length;
    if (skipped > 0) {
      console.log(`[BrickOwlTransactionSyncService] Skipped ${skipped} orders without valid dates`);
    }

    // Count created vs updated
    for (const row of rows) {
      if (existingOrderIds.has(row.brickowl_order_id)) {
        updated++;
      } else {
        created++;
      }
    }

    // Upsert in batches
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from('brickowl_transactions')
        .upsert(batch, { onConflict: 'user_id,brickowl_order_id' });

      if (error) {
        console.error('[BrickOwlTransactionSyncService] Upsert error:', error);
        throw new Error(`Failed to upsert transactions: ${error.message}`);
      }
    }

    return { created, updated, skipped };
  }
}

// Export singleton instance factory
export function createBrickOwlTransactionSyncService(): BrickOwlTransactionSyncService {
  return new BrickOwlTransactionSyncService();
}
