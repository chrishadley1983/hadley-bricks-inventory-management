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
  /** Filter by order status(es) - uppercase: READY, SHIPPED, etc. */
  status?: string[];
  /** Force full sync (ignore last sync time) */
  fullSync?: boolean;
  /** Sync items for each order (slower but more complete) */
  includeItems?: boolean;
  /** Maximum number of orders to sync */
  limit?: number;
  /** Include archived/filed orders (filed=true for archived, filed=false for active only) */
  includeArchived?: boolean;
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

    console.log('[BricqerSyncService] Starting sync for user:', userId.substring(0, 8) + '...');
    console.log('[BricqerSyncService] Options:', JSON.stringify(options));

    try {
      console.log('[BricqerSyncService] Getting client...');
      const client = await this.getClient(userId);
      console.log('[BricqerSyncService] Client created successfully');

      // Get orders - Bricqer uses uppercase status values (READY, SHIPPED, etc.)
      // Default to including archived orders (filed=true) unless explicitly set to false
      console.log('[BricqerSyncService] Fetching orders...');
      const includeArchived = options.includeArchived !== false; // Default true

      let allOrders: BricqerOrder[] = [];

      if (includeArchived) {
        // Fetch both archived (filed=true) and active (filed=false) orders
        // Use getAllOrders to handle pagination properly
        console.log('[BricqerSyncService] Fetching archived orders...');
        const archivedOrders = await client.getAllOrders({ filed: true });
        console.log('[BricqerSyncService] Found', archivedOrders.length, 'archived orders');

        console.log('[BricqerSyncService] Fetching active orders...');
        const activeOrders = await client.getAllOrders({ filed: false });
        console.log('[BricqerSyncService] Found', activeOrders.length, 'active orders');

        // Combine, removing duplicates by id
        const seenIds = new Set<string | number>();
        for (const order of [...archivedOrders, ...activeOrders]) {
          if (!seenIds.has(order.id)) {
            seenIds.add(order.id);
            allOrders.push(order);
          }
        }
      } else {
        // Only fetch active orders
        allOrders = await client.getAllOrders({ filed: false });
      }

      console.log(
        '[BricqerSyncService] Fetched',
        allOrders.length,
        'total orders from Bricqer API'
      );

      // Filter out eBay orders - they're handled by the separate eBay integration
      const orders = allOrders.filter((order) => {
        const isEbay = order.orderProvider?.toLowerCase() === 'ebay';
        return !isEbay;
      });
      console.log('[BricqerSyncService] After filtering eBay:', orders.length, 'orders to process');
      result.ordersProcessed = orders.length;

      // Process orders
      for (const orderSummary of orders) {
        try {
          // Check if order already exists
          const orderId = orderSummary.order_number || String(orderSummary.id);
          const existing = await this.orderRepo.findByPlatformOrderId(userId, 'bricqer', orderId);

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
      console.log('[BricqerSyncService] Sync completed:', {
        success: result.success,
        processed: result.ordersProcessed,
        created: result.ordersCreated,
        updated: result.ordersUpdated,
        errors: result.errors.length,
      });
    } catch (error) {
      console.error('[BricqerSyncService] Sync error:', error);
      if (error instanceof BricqerRateLimitError) {
        result.errors.push(`Rate limit exceeded. Resets at: ${error.rateLimitInfo.resetTime}`);
      } else if (error instanceof BricqerAuthError) {
        result.errors.push(`Authentication error: ${error.message}`);
      } else if (error instanceof BricqerApiError) {
        result.errors.push(`Bricqer API error: ${error.message} (code: ${error.code})`);
      } else {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push(errorMsg);
        // Add more context for credential decryption errors
        if (errorMsg.includes('decrypt') || errorMsg.includes('authenticate')) {
          result.errors.push(
            'Hint: Check that CREDENTIALS_ENCRYPTION_KEY is correctly set in environment'
          );
        }
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
    // Use pieceCount (total pieces) if available, otherwise lotCount, otherwise count from items array
    const itemsCount = normalized.pieceCount || normalized.lotCount || normalized.items.length || 0;

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
      shipping_address:
        normalized.shippingAddress as unknown as Database['public']['Tables']['platform_orders']['Insert']['shipping_address'],
      tracking_number: normalized.trackingNumber,
      items_count: itemsCount,
      // Note: buyer_phone and orderDescription are available in normalized.rawData
      raw_data:
        normalized.rawData as unknown as Database['public']['Tables']['platform_orders']['Insert']['raw_data'],
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
    // Use pieceCount (total pieces) if available, otherwise lotCount, otherwise count from items array
    const itemsCount = normalized.pieceCount || normalized.lotCount || normalized.items.length || 0;

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
      shipping_address:
        normalized.shippingAddress as unknown as Database['public']['Tables']['platform_orders']['Insert']['shipping_address'],
      tracking_number: normalized.trackingNumber,
      items_count: itemsCount,
      // Note: buyer_phone and orderDescription are available in normalized.rawData
      raw_data:
        normalized.rawData as unknown as Database['public']['Tables']['platform_orders']['Insert']['raw_data'],
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
    const { data } = (await this.supabase
      .from('platform_orders')
      .select('synced_at')
      .eq('user_id', userId)
      .eq('platform', 'bricqer')
      .order('synced_at', { ascending: false })
      .limit(1)) as { data: { synced_at: string }[] | null };

    const lastSyncedAt = data?.[0]?.synced_at ? new Date(data[0].synced_at) : null;

    return {
      isConfigured: true,
      totalOrders: stats.totalOrders,
      lastSyncedAt,
    };
  }
}
