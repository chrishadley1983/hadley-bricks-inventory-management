/**
 * Order Fulfilment Service
 *
 * Handles the workflow of confirming orders as processed and updating inventory status.
 *
 * Flow:
 * 1. Orders sync from Amazon with status "Paid"
 * 2. User generates picking list - this matches order items to inventory (FIFO by ASIN)
 *    and persists the FK link (order_items.inventory_item_id)
 * 3. User picks items and ships in Amazon - status changes to "Shipped"
 * 4. "Confirm Orders Processed" dialog:
 *    a. Calls Amazon sync to refresh order statuses
 *    b. Shows orders that have inventory linked AND are now "Shipped"
 *    c. Updates inventory to SOLD with sales data
 *
 * This service is used for the "Confirm Orders Processed" dialog which should ONLY show
 * orders that have been:
 * 1. Linked to inventory (order_items.inventory_item_id set by picking list)
 * 2. Now shipped (status = Shipped/Completed after Amazon sync)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, PlatformOrder, OrderItem, InventoryItem } from '@hadley-bricks/database';
import { OrderRepository, InventoryRepository } from '../repositories';
import { AmazonInventoryLinkingService } from '../amazon/amazon-inventory-linking.service';

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
   * Get orders ready for confirmation - these are orders that:
   * 1. Are now shipped (status = Shipped/Completed)
   * 2. Have NOT been marked as fulfilled yet (fulfilled_at is null)
   * 3. Were shipped recently (within last 7 days by default - to avoid old orders)
   *
   * Note: Orders don't need to have inventory_item_id pre-linked - matching
   * will happen during the confirmation process.
   */
  async getOrdersReadyForConfirmation(
    userId: string,
    platform: 'amazon' | 'ebay',
    options?: { maxAgeDays?: number }
  ): Promise<PlatformOrder[]> {
    // Only show orders shipped within the last N days (default 7 for recent orders)
    const maxAgeDays = options?.maxAgeDays ?? 7;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);
    const cutoffDateStr = cutoffDate.toISOString();

    if (platform === 'amazon') {
      // Get ALL shipped Amazon orders that are not fulfilled and are recent
      // No longer filtering by inventory_item_id - we'll match during confirmation
      const { data, error } = await this.supabase
        .from('platform_orders')
        .select('*')
        .eq('user_id', userId)
        .eq('platform', 'amazon')
        .is('fulfilled_at', null)
        .in('status', ['Shipped', 'Completed'])
        .gte('order_date', cutoffDateStr)
        .order('order_date', { ascending: true });

      if (error) {
        throw new Error(`Failed to fetch shipped Amazon orders: ${error.message}`);
      }

      return (data ?? []) as PlatformOrder[];
    }

    if (platform === 'ebay') {
      const { data, error } = await this.supabase
        .from('platform_orders')
        .select('*')
        .eq('user_id', userId)
        .eq('platform', 'ebay')
        .is('fulfilled_at', null)
        .in('status', ['Shipped', 'Completed', 'COMPLETED'])
        .gte('order_date', cutoffDateStr)
        .order('order_date', { ascending: true });

      if (error) {
        throw new Error(`Failed to fetch shipped eBay orders: ${error.message}`);
      }

      return (data ?? []) as PlatformOrder[];
    }

    return [];
  }

  /**
   * @deprecated Use getOrdersReadyForConfirmation instead
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
   *
   * For orders that went through the inventory resolution flow, the order_items
   * will already have inventory_item_id set. This method checks that first.
   *
   * For fresh matching (when inventory_item_id is not set), it uses the same
   * criteria as the inventory resolution services:
   * - Amazon: amazon_asin match + listing_platform = 'amazon' + status in (BACKLOG, LISTED)
   * - eBay: ebay_sku_mappings or sku match + listing_platform = 'ebay' + status in (BACKLOG, LISTED)
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

    // First, check if this order item already has inventory linked (from resolution flow)
    if (orderItem.inventory_item_id) {
      const inventory = await this.inventoryRepo.findById(orderItem.inventory_item_id);
      if (inventory) {
        return {
          ...baseMatch,
          matchedInventoryId: inventory.id,
          matchedInventory: inventory,
          matchStatus: 'matched',
        };
      }
    }

    // If no existing link and no item number, can't match
    if (!orderItem.item_number) {
      return baseMatch;
    }

    // Get inventory IDs already linked to any order (to exclude them)
    const { data: linkedItems } = await this.supabase
      .from('order_items')
      .select('inventory_item_id')
      .not('inventory_item_id', 'is', null);

    const linkedInventoryIds = new Set(
      (linkedItems ?? [])
        .map((item: { inventory_item_id: string | null }) => item.inventory_item_id)
        .filter((id): id is string => id !== null)
    );

    if (platform === 'amazon') {
      // Match by ASIN with platform filter (aligned with AmazonInventoryLinkingService)
      const { data: matches, error } = await this.supabase
        .from('inventory_items')
        .select('*')
        .eq('user_id', userId)
        .eq('amazon_asin', orderItem.item_number)
        .ilike('listing_platform', 'amazon')
        .in('status', ['BACKLOG', 'LISTED'])
        .order('created_at', { ascending: true });

      if (error) {
        console.error(`Failed to match ASIN ${orderItem.item_number}:`, error);
        return baseMatch;
      }

      // Filter out already-linked items
      const availableMatches = (matches ?? []).filter(
        (item) => !linkedInventoryIds.has(item.id)
      );

      if (availableMatches.length === 1) {
        return {
          ...baseMatch,
          matchedInventoryId: availableMatches[0].id,
          matchedInventory: availableMatches[0] as InventoryItem,
          matchStatus: 'matched',
        };
      } else if (availableMatches.length > 1) {
        return {
          ...baseMatch,
          matchStatus: 'multiple',
          matchCandidates: availableMatches as InventoryItem[],
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

      if (mapping && !linkedInventoryIds.has(mapping.inventory_item_id)) {
        const inventory = await this.inventoryRepo.findById(mapping.inventory_item_id);
        if (inventory && ['BACKLOG', 'LISTED'].includes(inventory.status || '')) {
          return {
            ...baseMatch,
            matchedInventoryId: inventory.id,
            matchedInventory: inventory,
            matchStatus: 'matched',
          };
        }
      }

      // Fallback: Try direct SKU match with platform filter
      const { data: matches, error } = await this.supabase
        .from('inventory_items')
        .select('*')
        .eq('user_id', userId)
        .eq('sku', orderItem.item_number)
        .ilike('listing_platform', 'ebay')
        .in('status', ['BACKLOG', 'LISTED'])
        .order('created_at', { ascending: true });

      if (error) {
        console.error(`Failed to match SKU ${orderItem.item_number}:`, error);
        return baseMatch;
      }

      // Filter out already-linked items
      const availableMatches = (matches ?? []).filter(
        (item) => !linkedInventoryIds.has(item.id)
      );

      if (availableMatches.length === 1) {
        return {
          ...baseMatch,
          matchedInventoryId: availableMatches[0].id,
          matchedInventory: availableMatches[0] as InventoryItem,
          matchStatus: 'matched',
        };
      } else if (availableMatches.length > 1) {
        return {
          ...baseMatch,
          matchStatus: 'multiple',
          matchCandidates: availableMatches as InventoryItem[],
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
            // Calculate financial breakdown for this item
            // For single-item orders, we can use order-level fees/shipping
            // For multi-item orders, we prorate fees based on item value proportion
            const itemPrice = orderItem.total_price ?? 0;
            const orderItemCount = order.items.length;

            // Prorate shipping and fees for multi-item orders
            // For single item, use full amounts; for multi, divide equally (simple approach)
            const itemShipping = orderItemCount === 1
              ? (order.shipping ?? 0)
              : (order.shipping ?? 0) / orderItemCount;
            const itemFees = orderItemCount === 1
              ? (order.fees ?? 0)
              : (order.fees ?? 0) / orderItemCount;

            // Gross = item price + shipping received
            const grossAmount = itemPrice + itemShipping;
            // Net = gross - fees
            const netAmount = grossAmount - itemFees;

            // Update inventory item to SOLD with full financial breakdown
            await this.supabase
              .from('inventory_items')
              .update({
                status: 'SOLD',
                sold_at: now,
                sold_date: order.order_date?.split('T')[0] || now.split('T')[0],
                sold_order_id: order.id,
                sold_platform: order.platform,
                sold_price: itemPrice,
                sold_gross_amount: grossAmount,
                sold_postage_received: itemShipping,
                sold_fees_amount: itemFees,
                sold_net_amount: netAmount,
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

        // For Amazon orders, trigger the inventory linking service to calculate financials
        if (order.platform === 'amazon') {
          try {
            const amazonLinkingService = new AmazonInventoryLinkingService(this.supabase, userId);
            await amazonLinkingService.processShippedOrder(orderId, { mode: 'picklist' });
          } catch (linkingError) {
            // Log but don't fail the fulfillment - financials can be added later
            console.error(`[OrderFulfilment] Amazon linking error for order ${orderId}:`, linkingError);
          }
        }

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
   *
   * Only returns orders that:
   * 1. Are shipped
   * 2. Have inventory linked (went through resolution flow)
   * 3. Have not been marked as fulfilled yet
   */
  async getOrdersForConfirmation(
    userId: string,
    platform: 'amazon' | 'ebay'
  ): Promise<OrderMatchResult[]> {
    // Use the new method that only returns orders with linked inventory
    const orders = await this.getOrdersReadyForConfirmation(userId, platform);
    const results: OrderMatchResult[] = [];

    for (const order of orders) {
      const match = await this.matchOrderToInventory(userId, order.id, platform);
      results.push(match);
    }

    return results;
  }
}
