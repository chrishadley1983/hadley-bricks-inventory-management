/**
 * BrickLink Sync Service
 *
 * Handles syncing orders from BrickLink API to local database.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, PlatformOrderInsert, OrderItemInsert } from '@hadley-bricks/database';
import {
  BrickLinkClient,
  BrickLinkApiError,
  RateLimitError,
  normalizeOrder,
  type BrickLinkCredentials,
  type BrickLinkOrderSummary,
  type NormalizedOrder,
} from '../bricklink';
import { OrderRepository, CredentialsRepository } from '../repositories';

export interface SyncResult {
  success: boolean;
  ordersProcessed: number;
  ordersCreated: number;
  ordersUpdated: number;
  ordersSkipped: number;
  errors: string[];
  lastSyncedAt: Date;
}

export interface BrickLinkSyncOptions {
  /** Include filed/archived orders */
  includeFiled?: boolean;
  /** Force full sync (ignore last sync time) */
  fullSync?: boolean;
  /** Sync items for each order (slower but more complete) */
  includeItems?: boolean;
}

/**
 * Service for syncing BrickLink orders
 */
export class BrickLinkSyncService {
  private orderRepo: OrderRepository;
  private credentialsRepo: CredentialsRepository;

  constructor(supabase: SupabaseClient<Database>) {
    this.orderRepo = new OrderRepository(supabase);
    this.credentialsRepo = new CredentialsRepository(supabase);
  }

  /**
   * Get BrickLink client for a user
   */
  private async getClient(userId: string): Promise<BrickLinkClient> {
    const credentials = await this.credentialsRepo.getCredentials<BrickLinkCredentials>(
      userId,
      'bricklink'
    );

    if (!credentials) {
      throw new Error('BrickLink credentials not configured');
    }

    return new BrickLinkClient(credentials);
  }

  /**
   * Test BrickLink connection with stored credentials
   */
  async testConnection(userId: string): Promise<boolean> {
    const client = await this.getClient(userId);
    return client.testConnection();
  }

  /**
   * Test BrickLink connection with provided credentials (doesn't read from DB)
   */
  async testConnectionWithCredentials(credentials: BrickLinkCredentials): Promise<boolean> {
    const client = new BrickLinkClient(credentials);
    return client.testConnection();
  }

  /**
   * Save BrickLink credentials
   */
  async saveCredentials(userId: string, credentials: BrickLinkCredentials): Promise<void> {
    await this.credentialsRepo.saveCredentials(userId, 'bricklink', credentials);
  }

  /**
   * Check if BrickLink is configured
   */
  async isConfigured(userId: string): Promise<boolean> {
    return this.credentialsRepo.hasCredentials(userId, 'bricklink');
  }

  /**
   * Sync sales orders from BrickLink
   *
   * Incremental sync optimization:
   * - Fetches all order summaries in a single API call
   * - Only fetches full order details (with items) for orders that:
   *   1. Don't exist in the database yet (new orders)
   *   2. Have a newer date_status_changed than our stored timestamp (changed orders)
   * - Orders that haven't changed are skipped (no item fetch needed)
   */
  async syncOrders(userId: string, options: BrickLinkSyncOptions = {}): Promise<SyncResult> {
    const result: SyncResult = {
      success: false,
      ordersProcessed: 0,
      ordersCreated: 0,
      ordersUpdated: 0,
      ordersSkipped: 0,
      errors: [],
      lastSyncedAt: new Date(),
    };

    try {
      const client = await this.getClient(userId);

      // Get sales orders (direction=out) - single API call
      const orders = await client.getSalesOrders(undefined, options.includeFiled);
      result.ordersProcessed = orders.length;

      // For incremental sync, get existing order timestamps from DB
      // This allows us to skip fetching items for unchanged orders
      let existingTimestamps: Map<string, Date | null> = new Map();
      if (!options.fullSync && options.includeItems) {
        existingTimestamps = await this.orderRepo.getOrderStatusTimestamps(userId, 'bricklink');
        console.log(`[BrickLinkSync] Found ${existingTimestamps.size} existing orders for incremental comparison`);
      }

      // Process orders
      for (const orderSummary of orders) {
        try {
          const orderId = String(orderSummary.order_id);
          const existingTimestamp = existingTimestamps.get(orderId);
          const isNewOrder = existingTimestamp === undefined;

          // Determine if we need to fetch items for this order
          let needsItemFetch = false;
          if (options.includeItems) {
            if (options.fullSync) {
              // Full sync: always fetch items
              needsItemFetch = true;
            } else if (isNewOrder) {
              // New order: fetch items
              needsItemFetch = true;
            } else if (orderSummary.date_status_changed) {
              // Existing order: compare timestamps
              const remoteStatusChanged = new Date(orderSummary.date_status_changed);
              if (!existingTimestamp || remoteStatusChanged > existingTimestamp) {
                // Order has been updated since our last sync
                needsItemFetch = true;
              }
            }
          }

          // Process the order (with or without items)
          await this.processOrder(userId, client, orderSummary, needsItemFetch);

          // Track results
          if (isNewOrder) {
            result.ordersCreated++;
          } else if (needsItemFetch) {
            result.ordersUpdated++;
          } else {
            result.ordersSkipped++;
          }
        } catch (orderError) {
          const errorMsg = orderError instanceof Error ? orderError.message : 'Unknown error';
          result.errors.push(`Order ${orderSummary.order_id}: ${errorMsg}`);
        }
      }

      console.log(`[BrickLinkSync] Completed: ${result.ordersCreated} created, ${result.ordersUpdated} updated, ${result.ordersSkipped} skipped (unchanged)`);
      result.success = result.errors.length === 0;
    } catch (error) {
      if (error instanceof RateLimitError) {
        result.errors.push(`Rate limit exceeded. Resets at: ${error.rateLimitInfo.resetTime}`);
      } else if (error instanceof BrickLinkApiError) {
        result.errors.push(`BrickLink API error: ${error.message} (code: ${error.code})`);
      } else {
        result.errors.push(error instanceof Error ? error.message : 'Unknown error');
      }
    }

    return result;
  }

  /**
   * Process a single order
   */
  private async processOrder(
    userId: string,
    client: BrickLinkClient,
    orderSummary: BrickLinkOrderSummary,
    includeItems: boolean
  ): Promise<void> {
    let normalized: NormalizedOrder;

    if (includeItems) {
      // Fetch full order with items
      const { order, items } = await client.getOrderWithItems(orderSummary.order_id);
      normalized = normalizeOrder(order, items);
    } else {
      // Just use summary data
      normalized = normalizeOrder(orderSummary, []);
    }

    // Prepare order for database
    const orderInsert: PlatformOrderInsert = {
      user_id: userId,
      platform: 'bricklink',
      platform_order_id: normalized.platformOrderId,
      order_date: normalized.orderDate.toISOString(),
      platform_status_changed_at: normalized.statusChangedAt?.toISOString() ?? null,
      buyer_name: normalized.buyerName,
      buyer_email: normalized.buyerEmail,
      status: normalized.status,
      subtotal: normalized.subtotal,
      shipping: normalized.shipping,
      fees: normalized.fees,
      total: normalized.total,
      currency: normalized.currency,
      shipping_address: normalized.shippingAddress as unknown as Database['public']['Tables']['platform_orders']['Insert']['shipping_address'],
      tracking_number: normalized.trackingNumber,
      items_count: normalized.items.length,
      raw_data: normalized.rawData as unknown as Database['public']['Tables']['platform_orders']['Insert']['raw_data'],
    };

    // Upsert order
    const savedOrder = await this.orderRepo.upsert(orderInsert);

    // If we have items, save them
    if (includeItems && normalized.items.length > 0) {
      const itemInserts: Omit<OrderItemInsert, 'order_id'>[] = normalized.items.map((item) => ({
        item_number: item.itemNumber,
        item_name: item.itemName,
        item_type: item.itemType,
        color_id: item.colorId,
        color_name: item.colorName,
        quantity: item.quantity,
        condition: item.condition,
        unit_price: item.unitPrice,
        total_price: item.totalPrice,
        currency: item.currency,
      }));

      await this.orderRepo.replaceOrderItems(savedOrder.id, itemInserts);
    }
  }

  /**
   * Sync a single order by ID
   */
  async syncOrderById(
    userId: string,
    orderId: string | number,
    includeItems = true
  ): Promise<NormalizedOrder> {
    const client = await this.getClient(userId);
    const { order, items } = await client.getOrderWithItems(orderId);
    const normalized = normalizeOrder(order, items);

    // Prepare and save order
    const orderInsert: PlatformOrderInsert = {
      user_id: userId,
      platform: 'bricklink',
      platform_order_id: normalized.platformOrderId,
      order_date: normalized.orderDate.toISOString(),
      platform_status_changed_at: normalized.statusChangedAt?.toISOString() ?? null,
      buyer_name: normalized.buyerName,
      buyer_email: normalized.buyerEmail,
      status: normalized.status,
      subtotal: normalized.subtotal,
      shipping: normalized.shipping,
      fees: normalized.fees,
      total: normalized.total,
      currency: normalized.currency,
      shipping_address: normalized.shippingAddress as unknown as Database['public']['Tables']['platform_orders']['Insert']['shipping_address'],
      tracking_number: normalized.trackingNumber,
      items_count: normalized.items.length,
      raw_data: normalized.rawData as unknown as Database['public']['Tables']['platform_orders']['Insert']['raw_data'],
    };

    const savedOrder = await this.orderRepo.upsert(orderInsert);

    // Save items
    if (includeItems && normalized.items.length > 0) {
      const itemInserts: Omit<OrderItemInsert, 'order_id'>[] = normalized.items.map((item) => ({
        item_number: item.itemNumber,
        item_name: item.itemName,
        item_type: item.itemType,
        color_id: item.colorId,
        color_name: item.colorName,
        quantity: item.quantity,
        condition: item.condition,
        unit_price: item.unitPrice,
        total_price: item.totalPrice,
        currency: item.currency,
      }));

      await this.orderRepo.replaceOrderItems(savedOrder.id, itemInserts);
    }

    return normalized;
  }

  /**
   * Get sync status
   */
  async getSyncStatus(userId: string): Promise<{
    isConfigured: boolean;
    totalOrders: number;
    lastSyncedAt: Date | null;
  }> {
    const isConfigured = await this.isConfigured(userId);

    if (!isConfigured) {
      return {
        isConfigured: false,
        totalOrders: 0,
        lastSyncedAt: null,
      };
    }

    const stats = await this.orderRepo.getStats(userId, 'bricklink');

    // Get most recent synced_at
    const { data } = await this.orderRepo['supabase']
      .from('platform_orders')
      .select('synced_at')
      .eq('user_id', userId)
      .eq('platform', 'bricklink')
      .order('synced_at', { ascending: false })
      .limit(1);

    const lastSyncedAt = data?.[0]?.synced_at ? new Date(data[0].synced_at) : null;

    return {
      isConfigured: true,
      totalOrders: stats.totalOrders,
      lastSyncedAt,
    };
  }
}
