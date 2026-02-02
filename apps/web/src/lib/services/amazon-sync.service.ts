/**
 * Amazon Sync Service
 *
 * Handles syncing orders from Amazon SP-API to local database.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, PlatformOrderInsert, OrderItemInsert } from '@hadley-bricks/database';
import {
  AmazonClient,
  AmazonApiError,
  AmazonRateLimitError,
  AmazonAuthError,
  normalizeOrder,
  type AmazonCredentials,
  type AmazonOrder,
  type NormalizedAmazonOrder,
  type AmazonOrderStatus,
} from '../amazon';
import { OrderRepository, CredentialsRepository } from '../repositories';
import type { SyncResult } from '../adapters/platform-adapter.interface';

export interface AmazonSyncOptions {
  /** Sync orders created after this date */
  createdAfter?: Date;
  /** Sync orders updated after this date */
  updatedAfter?: Date;
  /** Filter by order status(es) */
  statuses?: AmazonOrderStatus[];
  /** Only sync merchant fulfilled orders (exclude FBA) */
  merchantFulfilledOnly?: boolean;
  /** Sync items for each order (slower but more complete) */
  includeItems?: boolean;
  /** Maximum number of orders to sync */
  limit?: number;
  /** Force full sync from last 90 days instead of incremental */
  fullSync?: boolean;
}

/**
 * Default marketplaces for EU sellers
 */
const DEFAULT_EU_MARKETPLACES = [
  'A1F83G8C2ARO7P', // UK
  'A1PA6795UKMFR9', // DE
  'A13V1IB3VIYBER', // FR
  'APJ6JRA9NG5V4', // IT
  'A1RKKUPIHCS9HS', // ES
];

/**
 * Service for syncing Amazon orders
 */
export class AmazonSyncService {
  private orderRepo: OrderRepository;
  private credentialsRepo: CredentialsRepository;

  constructor(private supabase: SupabaseClient<Database>) {
    this.orderRepo = new OrderRepository(supabase);
    this.credentialsRepo = new CredentialsRepository(supabase);
  }

  /**
   * Get Amazon client for a user
   */
  private async getClient(userId: string): Promise<AmazonClient> {
    const credentials = await this.credentialsRepo.getCredentials<AmazonCredentials>(
      userId,
      'amazon'
    );

    if (!credentials) {
      throw new Error('Amazon credentials not configured');
    }

    return new AmazonClient(credentials);
  }

  /**
   * Test Amazon connection with stored credentials
   */
  async testConnection(userId: string): Promise<boolean> {
    const client = await this.getClient(userId);
    return client.testConnection();
  }

  /**
   * Test Amazon connection with provided credentials (doesn't read from DB)
   */
  async testConnectionWithCredentials(credentials: AmazonCredentials): Promise<boolean> {
    const client = new AmazonClient(credentials);
    return client.testConnection();
  }

  /**
   * Save Amazon credentials
   */
  async saveCredentials(userId: string, credentials: AmazonCredentials): Promise<void> {
    // Ensure marketplaces are set
    if (!credentials.marketplaceIds || credentials.marketplaceIds.length === 0) {
      credentials.marketplaceIds = DEFAULT_EU_MARKETPLACES;
    }
    await this.credentialsRepo.saveCredentials(userId, 'amazon', credentials);
  }

  /**
   * Delete Amazon credentials
   */
  async deleteCredentials(userId: string): Promise<void> {
    await this.credentialsRepo.deleteCredentials(userId, 'amazon');
  }

  /**
   * Check if Amazon is configured
   */
  async isConfigured(userId: string): Promise<boolean> {
    return this.credentialsRepo.hasCredentials(userId, 'amazon');
  }

  /**
   * Get the most recent sync timestamp from the database for a user
   * Uses synced_at (when we last fetched from Amazon) to properly catch status updates
   * on older orders that may have been modified after newer orders were placed.
   */
  private async getMostRecentSyncDate(userId: string): Promise<Date | null> {
    const { data, error } = await this.supabase
      .from('platform_orders')
      .select('synced_at')
      .eq('user_id', userId)
      .eq('platform', 'amazon')
      .order('synced_at', { ascending: false })
      .limit(1);

    if (error || !data || data.length === 0 || !data[0].synced_at) {
      return null;
    }

    return new Date(data[0].synced_at);
  }

  /**
   * Sync orders from Amazon
   * By default, only syncs orders newer than the most recent order in the database.
   * Use options.createdAfter to override this behavior and sync from a specific date.
   */
  async syncOrders(userId: string, options: AmazonSyncOptions = {}): Promise<SyncResult> {
    const result: SyncResult = {
      success: false,
      platform: 'amazon',
      ordersProcessed: 0,
      ordersCreated: 0,
      ordersUpdated: 0,
      errors: [],
      lastSyncedAt: new Date(),
    };

    console.log('[AmazonSyncService] Starting sync for user:', userId.substring(0, 8) + '...');
    console.log('[AmazonSyncService] Options:', JSON.stringify(options));

    try {
      console.log('[AmazonSyncService] Getting client...');
      const client = await this.getClient(userId);
      console.log('[AmazonSyncService] Client created successfully');

      // Build query params
      const queryParams: Parameters<AmazonClient['getAllOrders']>[0] = {};

      // Determine the start date for fetching orders
      if (options.fullSync) {
        // Full sync requested - fetch all orders from last 90 days
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
        queryParams.LastUpdatedAfter = ninetyDaysAgo.toISOString();
        console.log('[AmazonSyncService] Full sync - fetching orders updated since:', ninetyDaysAgo.toISOString());
      } else if (options.createdAfter) {
        // Explicit date provided - use it
        queryParams.CreatedAfter = options.createdAfter.toISOString();
        console.log('[AmazonSyncService] Using explicit createdAfter:', options.createdAfter.toISOString());
      } else if (options.updatedAfter) {
        // Explicit updatedAfter provided - use it for incremental sync
        queryParams.LastUpdatedAfter = options.updatedAfter.toISOString();
        console.log('[AmazonSyncService] Using explicit updatedAfter:', options.updatedAfter.toISOString());
      } else {
        // No explicit date - check for most recent sync timestamp in database
        const mostRecentSyncDate = await this.getMostRecentSyncDate(userId);

        if (mostRecentSyncDate) {
          // Add a small buffer (1 minute) to avoid missing orders due to clock skew
          const startDate = new Date(mostRecentSyncDate.getTime() - 60000);
          // Use LastUpdatedAfter to catch BOTH new orders AND status changes
          // Amazon API returns orders that were either created or updated after this date
          // Using synced_at (not order_date) ensures we catch status updates on older orders
          queryParams.LastUpdatedAfter = startDate.toISOString();
          console.log('[AmazonSyncService] Syncing orders updated after:', startDate.toISOString());
        } else {
          // No orders in database - default to last 90 days
          const ninetyDaysAgo = new Date();
          ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
          queryParams.CreatedAfter = ninetyDaysAgo.toISOString();
          console.log('[AmazonSyncService] No existing orders, using 90-day default:', ninetyDaysAgo.toISOString());
        }
      }

      if (options.statuses && options.statuses.length > 0) {
        queryParams.OrderStatuses = options.statuses;
      }

      if (options.merchantFulfilledOnly) {
        queryParams.FulfillmentChannels = ['MFN'];
      }

      if (options.limit) {
        queryParams.MaxResultsPerPage = Math.min(options.limit, 100);
      }

      // Fetch orders
      console.log('[AmazonSyncService] Fetching orders...');
      let orders: AmazonOrder[];

      if (options.limit) {
        // If limit specified, just get first page
        orders = await client.getOrders(queryParams);
        if (orders.length > options.limit) {
          orders = orders.slice(0, options.limit);
        }
      } else {
        // Get all orders with pagination
        orders = await client.getAllOrders(queryParams);
      }

      console.log('[AmazonSyncService] Fetched', orders.length, 'orders from Amazon');
      result.ordersProcessed = orders.length;

      // Process orders
      for (const orderSummary of orders) {
        try {
          const orderId = orderSummary.AmazonOrderId;

          // Check if order already exists
          const existing = await this.orderRepo.findByPlatformOrderId(
            userId,
            'amazon',
            orderId
          );

          // Log status changes for debugging
          if (existing) {
            const amazonStatus = orderSummary.OrderStatus;
            const existingStatus = existing.status;
            if (amazonStatus !== existingStatus) {
              console.log(`[AmazonSyncService] Order ${orderId} status change: ${existingStatus} -> ${amazonStatus}`);
            }
          }

          await this.processOrder(userId, client, orderSummary, options.includeItems ?? false);

          if (existing) {
            result.ordersUpdated++;
          } else {
            result.ordersCreated++;
          }
        } catch (orderError) {
          const errorMsg = orderError instanceof Error ? orderError.message : 'Unknown error';
          const orderId = orderSummary.AmazonOrderId;
          result.errors.push(`Order ${orderId}: ${errorMsg}`);
        }
      }

      result.success = result.errors.length === 0;
      console.log('[AmazonSyncService] Sync completed:', {
        success: result.success,
        processed: result.ordersProcessed,
        created: result.ordersCreated,
        updated: result.ordersUpdated,
        errors: result.errors.length,
      });
    } catch (error) {
      console.error('[AmazonSyncService] Sync error:', error);
      if (error instanceof AmazonRateLimitError) {
        result.errors.push(`Rate limit exceeded. Resets at: ${error.rateLimitInfo.resetTime}`);
      } else if (error instanceof AmazonAuthError) {
        result.errors.push(`Authentication error: ${error.message}`);
      } else if (error instanceof AmazonApiError) {
        result.errors.push(`Amazon API error: ${error.message} (code: ${error.code})`);
      } else {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push(errorMsg);
      }
    }

    return result;
  }

  /**
   * Process a single order
   */
  private async processOrder(
    userId: string,
    client: AmazonClient,
    orderSummary: AmazonOrder,
    includeItems: boolean
  ): Promise<void> {
    let normalized: NormalizedAmazonOrder;

    // Always fetch items for orders awaiting dispatch (Unshipped, PartiallyShipped)
    // These need item details for the dispatch workflow UI
    const dispatchStatuses = ['Unshipped', 'PartiallyShipped'];
    const needsItemsForDispatch = dispatchStatuses.includes(orderSummary.OrderStatus);
    const shouldFetchItems = includeItems || needsItemsForDispatch;

    if (shouldFetchItems) {
      // Fetch full order with items
      const orderId = orderSummary.AmazonOrderId;
      const items = await client.getOrderItems(orderId);
      normalized = normalizeOrder(orderSummary, items);
      if (needsItemsForDispatch && !includeItems) {
        console.log(`[AmazonSyncService] Fetched items for dispatch order ${orderId} (status: ${orderSummary.OrderStatus})`);
      }
    } else {
      // Just use summary data
      normalized = normalizeOrder(orderSummary, []);
    }

    // Map normalized status to internal status
    // This ensures internal_status stays in sync with platform status updates
    const internalStatusMap: Record<string, string> = {
      Pending: 'Pending',
      Paid: 'Paid',
      Shipped: 'Shipped',
      'Partially Shipped': 'Shipped', // Treat partial as shipped
      'Cancelled/Refunded': 'Cancelled',
    };
    const internalStatus = internalStatusMap[normalized.status] || null;

    // Prepare order for database
    const orderInsert: PlatformOrderInsert = {
      user_id: userId,
      platform: 'amazon',
      platform_order_id: normalized.platformOrderId,
      order_date: normalized.orderDate.toISOString(),
      buyer_name: normalized.buyerName,
      buyer_email: normalized.buyerEmail,
      status: normalized.status,
      internal_status: internalStatus,
      subtotal: normalized.subtotal,
      shipping: normalized.shipping,
      fees: normalized.fees,
      total: normalized.total,
      currency: normalized.currency,
      shipping_address: normalized.shippingAddress as unknown as Database['public']['Tables']['platform_orders']['Insert']['shipping_address'],
      items_count: normalized.items.length,
      dispatch_by: normalized.latestShipDate?.toISOString() ?? null,
      raw_data: {
        ...normalized.rawData,
        marketplace: normalized.marketplace,
        marketplaceId: normalized.marketplaceId,
        fulfillmentChannel: normalized.fulfillmentChannel,
      } as unknown as Database['public']['Tables']['platform_orders']['Insert']['raw_data'],
      synced_at: new Date().toISOString(),
    };

    // Upsert order
    const savedOrder = await this.orderRepo.upsert(orderInsert);

    // If we have items, save them
    if (shouldFetchItems && normalized.items.length > 0) {
      const itemInserts: Omit<OrderItemInsert, 'order_id'>[] = normalized.items.map((item) => ({
        item_number: item.asin,
        item_name: item.title,
        item_type: 'set', // Amazon items are typically complete sets
        quantity: item.quantity,
        unit_price: item.unitPrice,
        total_price: item.totalPrice,
        currency: item.currency,
        // Amazon-specific fields stored in raw_data if needed
      }));

      console.log(`[AmazonSyncService] Saving ${itemInserts.length} items for order ${normalized.platformOrderId}:`,
        itemInserts.map(i => ({ asin: i.item_number, title: i.item_name?.substring(0, 50) })));
      await this.orderRepo.replaceOrderItems(savedOrder.id, itemInserts);
    } else if (shouldFetchItems) {
      console.log(`[AmazonSyncService] Order ${normalized.platformOrderId} has no items to save`);
    }
  }

  /**
   * Sync a single order by ID
   */
  async syncOrderById(
    userId: string,
    orderId: string,
    includeItems = true
  ): Promise<NormalizedAmazonOrder> {
    const client = await this.getClient(userId);
    const { order, items } = await client.getOrderWithItems(orderId);
    const normalized = normalizeOrder(order, items);

    // Map normalized status to internal status
    const internalStatusMap: Record<string, string> = {
      Pending: 'Pending',
      Paid: 'Paid',
      Shipped: 'Shipped',
      'Partially Shipped': 'Shipped',
      'Cancelled/Refunded': 'Cancelled',
    };
    const internalStatus = internalStatusMap[normalized.status] || null;

    // Prepare and save order
    const orderInsert: PlatformOrderInsert = {
      user_id: userId,
      platform: 'amazon',
      platform_order_id: normalized.platformOrderId,
      order_date: normalized.orderDate.toISOString(),
      buyer_name: normalized.buyerName,
      buyer_email: normalized.buyerEmail,
      status: normalized.status,
      internal_status: internalStatus,
      subtotal: normalized.subtotal,
      shipping: normalized.shipping,
      fees: normalized.fees,
      total: normalized.total,
      currency: normalized.currency,
      shipping_address: normalized.shippingAddress as unknown as Database['public']['Tables']['platform_orders']['Insert']['shipping_address'],
      items_count: normalized.items.length,
      dispatch_by: normalized.latestShipDate?.toISOString() ?? null,
      raw_data: {
        ...normalized.rawData,
        marketplace: normalized.marketplace,
        marketplaceId: normalized.marketplaceId,
        fulfillmentChannel: normalized.fulfillmentChannel,
      } as unknown as Database['public']['Tables']['platform_orders']['Insert']['raw_data'],
      synced_at: new Date().toISOString(),
    };

    const savedOrder = await this.orderRepo.upsert(orderInsert);

    // Save items
    if (includeItems && normalized.items.length > 0) {
      const itemInserts: Omit<OrderItemInsert, 'order_id'>[] = normalized.items.map((item) => ({
        item_number: item.asin,
        item_name: item.title,
        item_type: 'set',
        quantity: item.quantity,
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

    const stats = await this.orderRepo.getStats(userId, 'amazon');

    // Get most recent synced_at
    const { data } = await this.supabase
      .from('platform_orders')
      .select('synced_at')
      .eq('user_id', userId)
      .eq('platform', 'amazon')
      .order('synced_at', { ascending: false })
      .limit(1) as { data: { synced_at: string }[] | null };

    const lastSyncedAt = data?.[0]?.synced_at ? new Date(data[0].synced_at) : null;

    return {
      isConfigured: true,
      totalOrders: stats.totalOrders,
      lastSyncedAt,
    };
  }

  /**
   * Get unshipped orders requiring action
   */
  async getUnshippedOrders(userId: string): Promise<NormalizedAmazonOrder[]> {
    const client = await this.getClient(userId);
    const orders = await client.getUnshippedOrders();
    return orders.map((order) => normalizeOrder(order, []));
  }
}
