/**
 * eBay Fulfilment Service
 *
 * Handles order retrieval, sync, and picking list generation from the eBay Fulfilment API.
 * Phase 2 of eBay integration.
 */

import { createClient } from '@/lib/supabase/server';
import { EbayApiAdapter, EbayApiError } from './ebay-api.adapter';
import { EbayAuthService } from './ebay-auth.service';
import type {
  EbayOrderResponse,
  EbayShippingFulfilmentResponse,
  EbayLineItem,
  EbayFulfilmentStartInstruction,
} from './types';

/**
 * Extract dispatch_by date from eBay fulfillmentStartInstructions
 *
 * eBay provides minEstimatedDeliveryDate and maxEstimatedDeliveryDate.
 * We use minEstimatedDeliveryDate minus 2 days as the ship-by date,
 * which accounts for typical UK domestic shipping time.
 * If that's not available, we fall back to order creation date + 1 day.
 */
function extractDispatchByDate(
  instructions: EbayFulfilmentStartInstruction[] | undefined,
  creationDate: string
): string | null {
  if (!instructions || instructions.length === 0) {
    return null;
  }

  // Use the first instruction (usually there's only one)
  const instruction = instructions[0];

  // Prefer minEstimatedDeliveryDate - subtract 2 days for shipping time
  if (instruction.minEstimatedDeliveryDate) {
    const deliveryDate = new Date(instruction.minEstimatedDeliveryDate);
    deliveryDate.setDate(deliveryDate.getDate() - 2);
    return deliveryDate.toISOString();
  }

  // Fall back to maxEstimatedDeliveryDate - subtract 3 days
  if (instruction.maxEstimatedDeliveryDate) {
    const deliveryDate = new Date(instruction.maxEstimatedDeliveryDate);
    deliveryDate.setDate(deliveryDate.getDate() - 3);
    return deliveryDate.toISOString();
  }

  // No delivery dates available - use order creation + 1 day (standard handling time)
  const creationDateObj = new Date(creationDate);
  creationDateObj.setDate(creationDateObj.getDate() + 1);
  return creationDateObj.toISOString();
}

// ============================================================================
// Types
// ============================================================================

export interface OrderSyncOptions {
  /** Sync orders created/modified since this date */
  sinceDate?: Date;
  /** Sync only orders with specific fulfilment statuses */
  fulfilmentStatuses?: ('FULFILLED' | 'IN_PROGRESS' | 'NOT_STARTED')[];
  /** Force full sync (ignore last sync cursor) */
  fullSync?: boolean;
  /** Maximum number of orders to sync (for testing) */
  limit?: number;
}

export interface OrderSyncResult {
  success: boolean;
  ordersProcessed: number;
  ordersCreated: number;
  ordersUpdated: number;
  lineItemsProcessed: number;
  fulfilmentsProcessed: number;
  error?: string;
}

export interface PickingListItem {
  orderId: string;
  ebayOrderId: string;
  lineItemId: string;
  sku: string | null;
  title: string;
  quantity: number;
  buyerUsername: string;
  shipToName: string | null;
  shipToCity: string | null;
  shipToCountry: string | null;
  creationDate: Date;
  itemLocation: string | null;
}

export interface PickingListOptions {
  /** Only include unfulfilled orders */
  unfulfilledOnly?: boolean;
  /** Sort by field */
  sortBy?: 'creationDate' | 'sku' | 'location';
  /** Sort order */
  sortOrder?: 'asc' | 'desc';
}

// ============================================================================
// EbayFulfilmentService Class
// ============================================================================

export class EbayFulfilmentService {
  private authService: EbayAuthService;

  constructor(authService?: EbayAuthService) {
    this.authService = authService || new EbayAuthService();
  }

  // ============================================================================
  // Order Sync Methods
  // ============================================================================

  /**
   * Sync orders from eBay for a user
   */
  async syncOrders(userId: string, options: OrderSyncOptions = {}): Promise<OrderSyncResult> {
    try {
      // Get access token
      const accessToken = await this.authService.getAccessToken(userId);
      if (!accessToken) {
        return {
          success: false,
          ordersProcessed: 0,
          ordersCreated: 0,
          ordersUpdated: 0,
          lineItemsProcessed: 0,
          fulfilmentsProcessed: 0,
          error: 'Not connected to eBay',
        };
      }

      // Get connection status for marketplace
      const connectionStatus = await this.authService.getConnectionStatus(userId);
      const marketplaceId = connectionStatus.marketplaceId || 'EBAY_GB';

      // Create API adapter with userId (for consistency, orders don't require signatures)
      const api = new EbayApiAdapter({
        accessToken,
        marketplaceId,
        sandbox: process.env.EBAY_SANDBOX === 'true',
        userId,
      });

      // Log sync start
      const syncLogId = await this.createSyncLog(userId, 'ORDERS');

      // Build filter
      let filter: string | undefined;
      const filters: string[] = [];

      if (options.sinceDate) {
        const dateFilter = EbayApiAdapter.buildOrderDateFilter(
          options.sinceDate.toISOString(),
          undefined,
          options.fullSync ? 'creationdate' : 'lastmodifieddate'
        );
        if (dateFilter) filters.push(dateFilter);
      }

      if (options.fulfilmentStatuses && options.fulfilmentStatuses.length > 0) {
        filters.push(EbayApiAdapter.buildFulfilmentStatusFilter(options.fulfilmentStatuses));
      }

      if (filters.length > 0) {
        filter = filters.join(',');
      }

      // Fetch orders
      let orders: EbayOrderResponse[];
      if (options.limit) {
        const response = await api.getOrders({ filter, limit: options.limit });
        orders = response.orders;
      } else {
        orders = await api.getAllOrders({ filter });
      }

      console.log(`[EbayFulfilmentService] Fetched ${orders.length} orders from eBay`);

      let ordersCreated = 0;
      let ordersUpdated = 0;
      let lineItemsProcessed = 0;
      let fulfilmentsProcessed = 0;

      // Process each order
      for (const order of orders) {
        const result = await this.upsertOrder(userId, order);
        if (result.created) {
          ordersCreated++;
        } else {
          ordersUpdated++;
        }
        lineItemsProcessed += order.lineItems.length;

        // Fetch and store shipping fulfilments
        try {
          const fulfilments = await api.getShippingFulfilments(order.orderId);
          for (const fulfilment of fulfilments.fulfillments) {
            await this.upsertShippingFulfilment(result.id, fulfilment);
            fulfilmentsProcessed++;
          }
        } catch (error) {
          // Some orders may not have fulfilments yet
          if (!(error instanceof EbayApiError && error.statusCode === 404)) {
            console.error(`[EbayFulfilmentService] Error fetching fulfilments for order ${order.orderId}:`, error);
          }
        }
      }

      // Update sync log
      await this.updateSyncLog(syncLogId, 'COMPLETED', {
        records_processed: orders.length,
        records_created: ordersCreated,
        records_updated: ordersUpdated,
      });

      return {
        success: true,
        ordersProcessed: orders.length,
        ordersCreated,
        ordersUpdated,
        lineItemsProcessed,
        fulfilmentsProcessed,
      };
    } catch (error) {
      console.error('[EbayFulfilmentService] Sync error:', error);

      return {
        success: false,
        ordersProcessed: 0,
        ordersCreated: 0,
        ordersUpdated: 0,
        lineItemsProcessed: 0,
        fulfilmentsProcessed: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Sync a single order by ID
   */
  async syncOrder(userId: string, ebayOrderId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const accessToken = await this.authService.getAccessToken(userId);
      if (!accessToken) {
        return { success: false, error: 'Not connected to eBay' };
      }

      const connectionStatus = await this.authService.getConnectionStatus(userId);
      const api = new EbayApiAdapter({
        accessToken,
        marketplaceId: connectionStatus.marketplaceId || 'EBAY_GB',
        sandbox: process.env.EBAY_SANDBOX === 'true',
        userId,
      });

      const order = await api.getOrder(ebayOrderId);
      await this.upsertOrder(userId, order);

      // Fetch fulfilments
      try {
        const fulfilments = await api.getShippingFulfilments(ebayOrderId);
        const orderRecord = await this.getOrderByEbayId(userId, ebayOrderId);
        if (orderRecord) {
          for (const fulfilment of fulfilments.fulfillments) {
            await this.upsertShippingFulfilment(orderRecord.id, fulfilment);
          }
        }
      } catch (error) {
        if (!(error instanceof EbayApiError && error.statusCode === 404)) {
          console.error(`[EbayFulfilmentService] Error fetching fulfilments:`, error);
        }
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // ============================================================================
  // Picking List Methods
  // ============================================================================

  /**
   * Generate a picking list from unfulfilled orders
   */
  async generatePickingList(
    userId: string,
    options: PickingListOptions = {}
  ): Promise<PickingListItem[]> {
    const supabase = await createClient();

    // Build query
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase as any)
      .from('ebay_orders')
      .select(`
        id,
        ebay_order_id,
        buyer_username,
        creation_date,
        fulfilment_instructions,
        ebay_order_line_items (
          id,
          ebay_line_item_id,
          sku,
          title,
          quantity,
          fulfilment_status,
          item_location
        )
      `)
      .eq('user_id', userId);

    if (options.unfulfilledOnly !== false) {
      query = query.neq('order_fulfilment_status', 'FULFILLED');
    }

    const { data: orders, error } = await query;

    if (error) {
      console.error('[EbayFulfilmentService] Error generating picking list:', error);
      throw new Error('Failed to generate picking list');
    }

    // Transform to picking list items
    const pickingList: PickingListItem[] = [];

    for (const order of orders || []) {
      // Extract ship-to info from fulfilment instructions
      let shipToName: string | null = null;
      let shipToCity: string | null = null;
      let shipToCountry: string | null = null;

      if (order.fulfilment_instructions?.[0]?.shippingStep?.shipTo) {
        const shipTo = order.fulfilment_instructions[0].shippingStep.shipTo;
        shipToName = shipTo.fullName || null;
        shipToCity = shipTo.contactAddress?.city || null;
        shipToCountry = shipTo.contactAddress?.countryCode || null;
      }

      for (const lineItem of order.ebay_order_line_items || []) {
        // Skip already fulfilled items if showing unfulfilled only
        if (options.unfulfilledOnly !== false && lineItem.fulfilment_status === 'FULFILLED') {
          continue;
        }

        pickingList.push({
          orderId: order.id,
          ebayOrderId: order.ebay_order_id,
          lineItemId: lineItem.ebay_line_item_id,
          sku: lineItem.sku,
          title: lineItem.title,
          quantity: lineItem.quantity,
          buyerUsername: order.buyer_username,
          shipToName,
          shipToCity,
          shipToCountry,
          creationDate: new Date(order.creation_date),
          itemLocation: lineItem.item_location,
        });
      }
    }

    // Sort
    const sortBy = options.sortBy || 'creationDate';
    const sortOrder = options.sortOrder || 'asc';
    const multiplier = sortOrder === 'asc' ? 1 : -1;

    pickingList.sort((a, b) => {
      switch (sortBy) {
        case 'sku':
          return multiplier * (a.sku || '').localeCompare(b.sku || '');
        case 'location':
          return multiplier * (a.itemLocation || '').localeCompare(b.itemLocation || '');
        case 'creationDate':
        default:
          return multiplier * (a.creationDate.getTime() - b.creationDate.getTime());
      }
    });

    return pickingList;
  }

  // ============================================================================
  // Order Query Methods
  // ============================================================================

  /**
   * Get orders for a user with optional filtering
   */
  async getOrders(
    userId: string,
    options: {
      status?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ orders: unknown[]; total: number }> {
    const supabase = await createClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase as any)
      .from('ebay_orders')
      .select('*, ebay_order_line_items(*)', { count: 'exact' })
      .eq('user_id', userId)
      .order('creation_date', { ascending: false });

    if (options.status) {
      query = query.eq('order_fulfilment_status', options.status);
    }

    if (options.limit) {
      query = query.limit(options.limit);
    }

    if (options.offset) {
      query = query.range(options.offset, options.offset + (options.limit || 50) - 1);
    }

    const { data, count, error } = await query;

    if (error) {
      console.error('[EbayFulfilmentService] Error fetching orders:', error);
      throw new Error('Failed to fetch orders');
    }

    return {
      orders: data || [],
      total: count || 0,
    };
  }

  /**
   * Get a specific order by its eBay order ID
   */
  async getOrderByEbayId(userId: string, ebayOrderId: string): Promise<{ id: string } | null> {
    const supabase = await createClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('ebay_orders')
      .select('id')
      .eq('user_id', userId)
      .eq('ebay_order_id', ebayOrderId)
      .single();

    if (error) {
      if (error.code !== 'PGRST116') {
        console.error('[EbayFulfilmentService] Error fetching order:', error);
      }
      return null;
    }

    return data;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Upsert an order and its line items
   */
  private async upsertOrder(
    userId: string,
    order: EbayOrderResponse
  ): Promise<{ id: string; created: boolean }> {
    const supabase = await createClient();

    // Prepare order data
    const orderData = {
      user_id: userId,
      ebay_order_id: order.orderId,
      legacy_order_id: order.legacyOrderId || null,
      creation_date: order.creationDate,
      last_modified_date: order.lastModifiedDate,
      order_fulfilment_status: order.orderFulfillmentStatus,
      order_payment_status: order.orderPaymentStatus,
      cancel_status: order.cancelStatus || null,
      buyer_username: order.buyer.username,
      buyer_checkout_notes: order.buyerCheckoutNotes || null,
      sales_record_reference: order.salesRecordReference || null,
      total_fee_basis_amount: order.totalFeeBasisAmount
        ? parseFloat(order.totalFeeBasisAmount.value)
        : null,
      total_fee_basis_currency: order.totalFeeBasisAmount?.currency || null,
      pricing_summary: order.pricingSummary || null,
      payment_summary: order.paymentSummary || null,
      fulfilment_instructions: order.fulfillmentStartInstructions || null,
      dispatch_by: extractDispatchByDate(order.fulfillmentStartInstructions, order.creationDate),
      raw_response: order,
    };

    // Upsert order
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingOrder } = await (supabase as any)
      .from('ebay_orders')
      .select('id')
      .eq('user_id', userId)
      .eq('ebay_order_id', order.orderId)
      .single();

    let orderId: string;
    let created = false;

    if (existingOrder) {
      // Update existing order
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('ebay_orders')
        .update(orderData)
        .eq('id', existingOrder.id)
        .select('id')
        .single();

      if (error) {
        console.error('[EbayFulfilmentService] Error updating order:', error);
        throw error;
      }

      orderId = data.id;
    } else {
      // Insert new order
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('ebay_orders')
        .insert(orderData)
        .select('id')
        .single();

      if (error) {
        console.error('[EbayFulfilmentService] Error inserting order:', error);
        throw error;
      }

      orderId = data.id;
      created = true;
    }

    // Upsert line items
    for (const lineItem of order.lineItems) {
      await this.upsertLineItem(orderId, lineItem);
    }

    return { id: orderId, created };
  }

  /**
   * Upsert a line item
   */
  private async upsertLineItem(orderId: string, lineItem: EbayLineItem): Promise<void> {
    const supabase = await createClient();

    const lineItemData = {
      order_id: orderId,
      ebay_line_item_id: lineItem.lineItemId,
      legacy_item_id: lineItem.legacyItemId || null,
      sku: lineItem.sku || null,
      title: lineItem.title,
      quantity: lineItem.quantity,
      line_item_cost_amount: parseFloat(lineItem.lineItemCost.value),
      line_item_cost_currency: lineItem.lineItemCost.currency,
      total_amount: parseFloat(lineItem.total.value),
      total_currency: lineItem.total.currency,
      fulfilment_status: lineItem.lineItemFulfillmentStatus,
      listing_marketplace_id: lineItem.listingMarketplaceId || null,
      purchase_marketplace_id: lineItem.purchaseMarketplaceId || null,
      item_location: lineItem.itemLocation?.city || null,
      taxes: lineItem.taxes || null,
      properties: lineItem.properties || null,
      raw_response: lineItem,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('ebay_order_line_items')
      .upsert(lineItemData, { onConflict: 'ebay_line_item_id' });

    if (error) {
      console.error('[EbayFulfilmentService] Error upserting line item:', error);
      throw error;
    }
  }

  /**
   * Upsert a shipping fulfilment
   */
  private async upsertShippingFulfilment(
    orderId: string,
    fulfilment: EbayShippingFulfilmentResponse
  ): Promise<void> {
    const supabase = await createClient();

    const fulfilmentData = {
      order_id: orderId,
      ebay_fulfilment_id: fulfilment.fulfillmentId,
      shipped_date: fulfilment.shippedDate || null,
      shipping_carrier_code: fulfilment.shippingCarrierCode || null,
      tracking_number: fulfilment.shipmentTrackingNumber || null,
      line_items: fulfilment.lineItems,
      raw_response: fulfilment,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('ebay_shipping_fulfilments')
      .upsert(fulfilmentData, { onConflict: 'ebay_fulfilment_id' });

    if (error) {
      console.error('[EbayFulfilmentService] Error upserting fulfilment:', error);
      throw error;
    }
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
      console.error('[EbayFulfilmentService] Error creating sync log:', error);
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
      console.error('[EbayFulfilmentService] Error updating sync log:', error);
    }
  }
}

// Export a default instance
export const ebayFulfilmentService = new EbayFulfilmentService();
