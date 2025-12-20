/**
 * Bricqer Sync Service
 *
 * Handles syncing orders from Bricqer API to local database.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, PlatformOrderInsert, OrderItemInsert } from '@hadley-bricks/database';
import {
  BricqerClient,
  BricqerApiError,
  BricqerRateLimitError,
  BricqerAuthError,
  normalizeOrder,
  type BricqerCredentials,
  type BricqerOrder,
  type NormalizedBricqerOrder,
} from '../bricqer';
import { OrderRepository, CredentialsRepository } from '../repositories';
import type { SyncResult } from '../adapters/platform-adapter.interface';

export interface BricqerSyncOptions {
  /** Filter by order status(es) */
  status?: string[];
  /** Force full sync (ignore last sync time) */
  fullSync?: boolean;
  /** Sync items for each order (slower but more complete) */
  includeItems?: boolean;
  /** Maximum number of orders to sync */
  limit?: number;
}

/**
 * Service for syncing Bricqer orders
 */
export class BricqerSyncService {
  private orderRepo: OrderRepository;
  private credentialsRepo: CredentialsRepository;

  constructor(private supabase: SupabaseClient<Database>) {
    this.orderRepo = new OrderRepository(supabase);
    this.credentialsRepo = new CredentialsRepository(supabase);
  }

  /**
   * Get Bricqer client for a user
   */
  private async getClient(userId: string): Promise<BricqerClient> {
    const credentials = await this.credentialsRepo.getCredentials<BricqerCredentials>(
      userId,
      'bricqer'
    );

    if (!credentials) {
      throw new Error('Bricqer credentials not configured');
    }

    return new BricqerClient(credentials);
  }

  /**
   * Test Bricqer connection with stored credentials
   */
  async testConnection(userId: string): Promise<boolean> {
    const client = await this.getClient(userId);
    return client.testConnection();
  }

  /**
   * Test Bricqer connection with provided credentials (doesn't read from DB)
   */
  async testConnectionWithCredentials(credentials: BricqerCredentials): Promise<boolean> {
    const client = new BricqerClient(credentials);
    return client.testConnection();
  }

  /**
   * Save Bricqer credentials
   */
  async saveCredentials(userId: string, credentials: BricqerCredentials): Promise<void> {
    await this.credentialsRepo.saveCredentials(userId, 'bricqer', credentials);
  }

  /**
   * Delete Bricqer credentials
   */
  async deleteCredentials(userId: string): Promise<void> {
    await this.credentialsRepo.deleteCredentials(userId, 'bricqer');
  }

  /**
   * Check if Bricqer is configured
   */
  async isConfigured(userId: string): Promise<boolean> {
    return this.credentialsRepo.hasCredentials(userId, 'bricqer');
  }

  /**
   * Sync orders from Bricqer
   */
  async syncOrders(userId: string, options: BricqerSyncOptions = {}): Promise<SyncResult> {
    const result: SyncResult = {
      success: false,
      platform: 'bricqer',
      ordersProcessed: 0,
      ordersCreated: 0,
      ordersUpdated: 0,
      errors: [],
      lastSyncedAt: new Date(),
    };

    try {
      const client = await this.getClient(userId);

      // Get sales orders
      const orders = await client.getSalesOrders(undefined, options.limit);
      result.ordersProcessed = orders.length;

      // Process orders
      for (const orderSummary of orders) {
        try {
          // Check if order already exists
          const orderId = orderSummary.order_number || String(orderSummary.id);
          const existing = await this.orderRepo.findByPlatformOrderId(
            userId,
            'bricqer',
            orderId
          );

          await this.processOrder(userId, client, orderSummary, options.includeItems ?? false);

          if (existing) {
            result.ordersUpdated++;
          } else {
            result.ordersCreated++;
          }
        } catch (orderError) {
          const errorMsg = orderError instanceof Error ? orderError.message : 'Unknown error';
          const orderId = orderSummary.order_number || orderSummary.id;
          result.errors.push(`Order ${orderId}: ${errorMsg}`);
        }
      }

      result.success = result.errors.length === 0;
    } catch (error) {
      if (error instanceof BricqerRateLimitError) {
        result.errors.push(`Rate limit exceeded. Resets at: ${error.rateLimitInfo.resetTime}`);
      } else if (error instanceof BricqerAuthError) {
        result.errors.push(`Authentication error: ${error.message}`);
      } else if (error instanceof BricqerApiError) {
        result.errors.push(`Bricqer API error: ${error.message} (code: ${error.code})`);
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
    client: BricqerClient,
    orderSummary: BricqerOrder,
    includeItems: boolean
  ): Promise<void> {
    let normalized: NormalizedBricqerOrder;

    if (includeItems) {
      // Fetch full order with items
      const orderId = orderSummary.id;
      const { order, items } = await client.getOrderWithItems(orderId);
      normalized = normalizeOrder(order, items);
    } else {
      // Just use summary data
      normalized = normalizeOrder(orderSummary, []);
    }

    // Prepare order for database
    const orderInsert: PlatformOrderInsert = {
      user_id: userId,
      platform: 'bricqer',
      platform_order_id: normalized.platformOrderId,
      order_date: normalized.orderDate.toISOString(),
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
  ): Promise<NormalizedBricqerOrder> {
    const client = await this.getClient(userId);
    const { order, items } = await client.getOrderWithItems(orderId);
    const normalized = normalizeOrder(order, items);

    // Prepare and save order
    const orderInsert: PlatformOrderInsert = {
      user_id: userId,
      platform: 'bricqer',
      platform_order_id: normalized.platformOrderId,
      order_date: normalized.orderDate.toISOString(),
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

    const stats = await this.orderRepo.getStats(userId, 'bricqer');

    // Get most recent synced_at
    const { data } = await this.supabase
      .from('platform_orders')
      .select('synced_at')
      .eq('user_id', userId)
      .eq('platform', 'bricqer')
      .order('synced_at', { ascending: false })
      .limit(1) as { data: { synced_at: string }[] | null };

    const lastSyncedAt = data?.[0]?.synced_at ? new Date(data[0].synced_at) : null;

    return {
      isConfigured: true,
      totalOrders: stats.totalOrders,
      lastSyncedAt,
    };
  }
}
