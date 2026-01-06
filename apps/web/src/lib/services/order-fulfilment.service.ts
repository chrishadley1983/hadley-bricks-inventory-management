/**
 * Order Fulfilment Service
 *
 * Handles the workflow of confirming orders as processed and updating inventory status.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, PlatformOrder, OrderItem, InventoryItem } from '@hadley-bricks/database';
import { OrderRepository, InventoryRepository } from '../repositories';

/**
 * Matching result for a single order item
 */
export interface OrderItemMatch {
  orderItemId: string;
  itemNumber: string; // SKU/ASIN
  itemName: string;
  quantity: number;
  matchedInventoryId: string | null;
  matchedInventory: InventoryItem | null;
  matchStatus: 'matched' | 'unmatched' | 'multiple';
  matchCandidates?: InventoryItem[]; // For multiple matches
}

/**
 * Result of matching an order to inventory
 */
export interface OrderMatchResult {
  orderId: string;
  platformOrderId: string;
  platform: string;
  buyerName: string | null;
  orderDate: string | null;
  total: number | null;
  items: OrderItemMatch[];
  allMatched: boolean;
  unmatchedCount: number;
}

/**
 * Request to confirm orders as fulfilled
 */
export interface ConfirmOrdersRequest {
  orderIds: string[];
  archiveLocation?: string; // e.g., "SOLD-2025-01"
  itemMappings?: Record<string, string>; // orderItemId -> inventoryId for manual overrides
}

/**
 * Result of confirming orders
 */
export interface ConfirmOrdersResult {
  success: boolean;
  ordersProcessed: number;
  inventoryUpdated: number;
  errors: string[];
  processedOrders: Array<{
    orderId: string;
    platformOrderId: string;
    inventoryItemsUpdated: string[];
  }>;
}

/**
 * Service for order fulfilment workflow
 */
export class OrderFulfilmentService {
  private orderRepo: OrderRepository;
  private inventoryRepo: InventoryRepository;

  constructor(private supabase: SupabaseClient<Database>) {
    this.orderRepo = new OrderRepository(supabase);
    this.inventoryRepo = new InventoryRepository(supabase);
  }

  /**
   * Get unfulfilled orders for a platform that are ready for confirmation
   * (Completed/Shipped status, not yet fulfilled_at set)
   */
  async getUnfulfilledOrders(
    userId: string,
    platform: 'amazon' | 'ebay'
  ): Promise<PlatformOrder[]> {
    // For platform_orders (Amazon uses this)
    if (platform === 'amazon') {
      const { data, error } = await this.supabase
        .from('platform_orders')
        .select('*')
        .eq('user_id', userId)
        .eq('platform', 'amazon')
        .is('fulfilled_at', null)
        .in('status', ['Shipped', 'Completed', 'Unshipped', 'PartiallyShipped'])
        .order('order_date', { ascending: true });

      if (error) {
        throw new Error(`Failed to fetch unfulfilled Amazon orders: ${error.message}`);
      }

      return (data ?? []) as PlatformOrder[];
    }

    // For eBay, we use ebay_orders table
    // This is handled separately through the eBay picking list flow
    return [];
  }

  /**
   * Match order items to inventory based on ASIN (Amazon) or SKU mapping (eBay)
   */
  async matchOrderToInventory(
    userId: string,
    orderId: string,
    platform: 'amazon' | 'ebay'
  ): Promise<OrderMatchResult> {
    // Get order with items
    const order = await this.orderRepo.findByIdWithItems(orderId);
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    const items: OrderItemMatch[] = [];
    let unmatchedCount = 0;

    for (const orderItem of order.items) {
      const match = await this.matchSingleItem(userId, orderItem, platform);
      items.push(match);
      if (match.matchStatus !== 'matched') {
        unmatchedCount++;
      }
    }

    return {
      orderId: order.id,
      platformOrderId: order.platform_order_id,
      platform: order.platform,
      buyerName: order.buyer_name,
      orderDate: order.order_date,
      total: order.total,
      items,
      allMatched: unmatchedCount === 0,
      unmatchedCount,
    };
  }

  /**
   * Match a single order item to inventory
   */
  private async matchSingleItem(
    userId: string,
    orderItem: OrderItem,
    platform: 'amazon' | 'ebay'
  ): Promise<OrderItemMatch> {
    const baseMatch: OrderItemMatch = {
      orderItemId: orderItem.id,
      itemNumber: orderItem.item_number,
      itemName: orderItem.item_name || '',
      quantity: orderItem.quantity,
      matchedInventoryId: null,
      matchedInventory: null,
      matchStatus: 'unmatched',
    };

    if (!orderItem.item_number) {
      return baseMatch;
    }

    if (platform === 'amazon') {
      // Match by ASIN
      const { data: matches, error } = await this.supabase
        .from('inventory_items')
        .select('*')
        .eq('user_id', userId)
        .eq('amazon_asin', orderItem.item_number)
        .in('status', ['IN STOCK', 'LISTED']);

      if (error) {
        console.error(`Failed to match ASIN ${orderItem.item_number}:`, error);
        return baseMatch;
      }

      if (matches && matches.length === 1) {
        return {
          ...baseMatch,
          matchedInventoryId: matches[0].id,
          matchedInventory: matches[0] as InventoryItem,
          matchStatus: 'matched',
        };
      } else if (matches && matches.length > 1) {
        return {
          ...baseMatch,
          matchStatus: 'multiple',
          matchCandidates: matches as InventoryItem[],
        };
      }
    } else if (platform === 'ebay') {
      // Check eBay SKU mappings first
      const { data: mapping } = await this.supabase
        .from('ebay_sku_mappings')
        .select('inventory_item_id')
        .eq('user_id', userId)
        .eq('ebay_sku', orderItem.item_number)
        .single();

      if (mapping) {
        const inventory = await this.inventoryRepo.findById(mapping.inventory_item_id);
        if (inventory && ['IN STOCK', 'LISTED'].includes(inventory.status || '')) {
          return {
            ...baseMatch,
            matchedInventoryId: inventory.id,
            matchedInventory: inventory,
            matchStatus: 'matched',
          };
        }
      }

      // Fallback: Try direct SKU match
      const { data: matches, error } = await this.supabase
        .from('inventory_items')
        .select('*')
        .eq('user_id', userId)
        .eq('sku', orderItem.item_number)
        .in('status', ['IN STOCK', 'LISTED']);

      if (!error && matches && matches.length === 1) {
        return {
          ...baseMatch,
          matchedInventoryId: matches[0].id,
          matchedInventory: matches[0] as InventoryItem,
          matchStatus: 'matched',
        };
      } else if (!error && matches && matches.length > 1) {
        return {
          ...baseMatch,
          matchStatus: 'multiple',
          matchCandidates: matches as InventoryItem[],
        };
      }
    }

    return baseMatch;
  }

  /**
   * Confirm orders as fulfilled and update inventory
   */
  async confirmOrdersFulfilled(
    userId: string,
    request: ConfirmOrdersRequest
  ): Promise<ConfirmOrdersResult> {
    const result: ConfirmOrdersResult = {
      success: false,
      ordersProcessed: 0,
      inventoryUpdated: 0,
      errors: [],
      processedOrders: [],
    };

    const now = new Date().toISOString();
    const archiveLocation = request.archiveLocation || `SOLD-${new Date().toISOString().slice(0, 7)}`;

    for (const orderId of request.orderIds) {
      try {
        // Get order with items
        const order = await this.orderRepo.findByIdWithItems(orderId);
        if (!order) {
          result.errors.push(`Order ${orderId} not found`);
          continue;
        }

        // Verify order belongs to user
        if (order.user_id !== userId) {
          result.errors.push(`Order ${orderId} does not belong to user`);
          continue;
        }

        // Skip if already fulfilled
        if (order.fulfilled_at) {
          result.errors.push(`Order ${order.platform_order_id} already fulfilled`);
          continue;
        }

        const inventoryItemsUpdated: string[] = [];

        // Process each order item
        for (const orderItem of order.items) {
          // Check for manual mapping override
          let inventoryId = request.itemMappings?.[orderItem.id];

          if (!inventoryId) {
            // Auto-match by ASIN or SKU
            const match = await this.matchSingleItem(userId, orderItem, order.platform as 'amazon' | 'ebay');
            inventoryId = match.matchedInventoryId || undefined;
          }

          if (inventoryId) {
            // Update inventory item to SOLD
            await this.supabase
              .from('inventory_items')
              .update({
                status: 'SOLD',
                sold_at: now,
                sold_date: order.order_date?.split('T')[0] || now.split('T')[0],
                sold_order_id: order.id,
                sold_platform: order.platform,
                sold_price: orderItem.total_price,
                archive_location: archiveLocation,
                storage_location: null, // Clear storage location
              })
              .eq('id', inventoryId)
              .eq('user_id', userId);

            // Link order item to inventory
            await this.supabase
              .from('order_items')
              .update({ inventory_item_id: inventoryId })
              .eq('id', orderItem.id);

            inventoryItemsUpdated.push(inventoryId);
            result.inventoryUpdated++;
          }
        }

        // Mark order as fulfilled
        await this.supabase
          .from('platform_orders')
          .update({
            fulfilled_at: now,
            internal_status: 'Completed',
          })
          .eq('id', orderId);

        result.processedOrders.push({
          orderId: order.id,
          platformOrderId: order.platform_order_id,
          inventoryItemsUpdated,
        });
        result.ordersProcessed++;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push(`Order ${orderId}: ${errorMsg}`);
      }
    }

    result.success = result.errors.length === 0;
    return result;
  }

  /**
   * Get orders ready for confirmation with their match status
   */
  async getOrdersForConfirmation(
    userId: string,
    platform: 'amazon' | 'ebay'
  ): Promise<OrderMatchResult[]> {
    const orders = await this.getUnfulfilledOrders(userId, platform);
    const results: OrderMatchResult[] = [];

    for (const order of orders) {
      const match = await this.matchOrderToInventory(userId, order.id, platform);
      results.push(match);
    }

    return results;
  }
}
