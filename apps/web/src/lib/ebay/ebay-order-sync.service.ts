/**
 * eBay Order Sync Service
 *
 * Handles syncing orders from eBay Fulfilment API to the local database.
 * Supports full sync, incremental sync, and historical imports with 90-day chunking.
 *
 * Also denormalizes order data to transactions for reporting purposes.
 */

import { createClient } from '@/lib/supabase/server';
import { ebayAuthService } from './ebay-auth.service';
import { EbayApiAdapter } from './ebay-api.adapter';
import { EbayInventoryLinkingService } from './ebay-inventory-linking.service';
import type {
  EbayOrderResponse,
  EbayOrdersResponse,
  EbayLineItem,
  EbayShippingFulfilmentResponse,
} from './types';
import type { Json } from '@hadley-bricks/database';

// ============================================================================
// Constants
// ============================================================================

const BATCH_SIZE = 100;
const MAX_ORDERS_PER_PAGE = 200; // eBay's max for getOrders
const RATE_LIMIT_DELAY_MS = 150;
const DAYS_PER_CHUNK = 90; // eBay's max date range for orders

// ============================================================================
// Types
// ============================================================================

export interface EbayOrderSyncResult {
  success: boolean;
  syncType: 'FULL' | 'INCREMENTAL' | 'HISTORICAL';
  ordersProcessed: number;
  ordersCreated: number;
  ordersUpdated: number;
  lineItemsCreated: number;
  lineItemsUpdated: number;
  fulfilmentsProcessed: number;
  transactionsEnriched: number;
  inventoryAutoLinked: number;
  inventoryQueuedForResolution: number;
  lastSyncCursor?: string;
  error?: string;
  startedAt: Date;
  completedAt: Date;
}

export interface EbayOrderSyncOptions {
  fullSync?: boolean;
  fromDate?: string;
  toDate?: string;
  enrichTransactions?: boolean; // Denormalize order data to transactions
}

interface OrderRow {
  user_id: string;
  ebay_order_id: string;
  legacy_order_id: string | null;
  creation_date: string;
  last_modified_date: string;
  order_fulfilment_status: string;
  order_payment_status: string;
  cancel_status: Json | null;
  buyer_username: string;
  buyer_checkout_notes: string | null;
  sales_record_reference: string | null;
  total_fee_basis_amount: number | null;
  total_fee_basis_currency: string | null;
  pricing_summary: Json | null;
  payment_summary: Json | null;
  fulfilment_instructions: Json | null;
  raw_response: Json;
}

interface LineItemRow {
  order_id: string;
  ebay_line_item_id: string;
  legacy_item_id: string | null;
  sku: string | null;
  title: string;
  quantity: number;
  line_item_cost_amount: number;
  line_item_cost_currency: string;
  total_amount: number;
  total_currency: string;
  fulfilment_status: string;
  listing_marketplace_id: string | null;
  purchase_marketplace_id: string | null;
  item_location: string | null;
  taxes: Json | null;
  properties: Json | null;
  raw_response: Json;
}

interface FulfilmentRow {
  order_id: string;
  ebay_fulfilment_id: string;
  shipped_date: string | null;
  shipping_carrier_code: string | null;
  tracking_number: string | null;
  line_items: Json;
  raw_response: Json;
}

// ============================================================================
// EbayOrderSyncService Class
// ============================================================================

export class EbayOrderSyncService {
  // ============================================================================
  // Order Sync
  // ============================================================================

  /**
   * Sync orders from eBay Fulfilment API
   */
  async syncOrders(userId: string, options?: EbayOrderSyncOptions): Promise<EbayOrderSyncResult> {
    console.log('[EbayOrderSyncService] Starting order sync for user:', userId, 'options:', options);
    const startedAt = new Date();
    const supabase = await createClient();
    const syncMode = options?.fromDate ? 'HISTORICAL' : options?.fullSync ? 'FULL' : 'INCREMENTAL';
    console.log('[EbayOrderSyncService] Order sync mode:', syncMode);

    // Check for running sync
    const { data: runningSync } = await supabase
      .from('ebay_sync_log')
      .select('id')
      .eq('user_id', userId)
      .eq('sync_type', 'ORDERS')
      .eq('status', 'RUNNING')
      .single();

    if (runningSync) {
      console.log('[EbayOrderSyncService] An order sync is already running, skipping');
      return {
        success: false,
        syncType: syncMode,
        ordersProcessed: 0,
        ordersCreated: 0,
        ordersUpdated: 0,
        lineItemsCreated: 0,
        lineItemsUpdated: 0,
        fulfilmentsProcessed: 0,
        transactionsEnriched: 0,
        inventoryAutoLinked: 0,
        inventoryQueuedForResolution: 0,
        error: 'An order sync is already running',
        startedAt,
        completedAt: new Date(),
      };
    }

    // Create sync log entry
    console.log('[EbayOrderSyncService] Creating order sync log entry');
    const { data: syncLog, error: logError } = await supabase
      .from('ebay_sync_log')
      .insert({
        user_id: userId,
        sync_type: 'ORDERS',
        sync_mode: syncMode,
        status: 'RUNNING',
        started_at: startedAt.toISOString(),
        from_date: options?.fromDate || null,
        to_date: options?.toDate || null,
      })
      .select()
      .single();

    if (logError) {
      console.error('[EbayOrderSyncService] Failed to create sync log:', logError);
      throw new Error('Failed to start sync');
    }

    try {
      // Get access token and create API adapter
      console.log('[EbayOrderSyncService] Getting access token for orders...');
      const accessToken = await ebayAuthService.getAccessToken(userId);
      if (!accessToken) {
        console.error('[EbayOrderSyncService] No valid access token found for orders');
        throw new Error('No valid eBay access token. Please reconnect to eBay.');
      }
      console.log('[EbayOrderSyncService] Access token obtained for orders');

      // Create API adapter with userId (for consistency, orders don't require signatures)
      const apiAdapter = new EbayApiAdapter({ accessToken, userId });

      // Determine date range for sync
      let fromDate: string | undefined;
      let toDate: string | undefined;

      if (options?.fromDate) {
        fromDate = options.fromDate;
        toDate = options.toDate || new Date().toISOString();
      } else if (!options?.fullSync) {
        // Incremental sync - use lastmodifieddate cursor
        const { data: syncConfig } = await supabase
          .from('ebay_sync_config')
          .select('orders_last_modified_cursor')
          .eq('user_id', userId)
          .single();

        if (syncConfig?.orders_last_modified_cursor) {
          fromDate = syncConfig.orders_last_modified_cursor;
        }
      }
      console.log('[EbayOrderSyncService] Date range:', { fromDate, toDate });

      // Fetch orders - use chunking for historical imports
      let allOrders: EbayOrderResponse[];

      if (options?.fromDate && options.toDate) {
        // Historical import - fetch in 90-day chunks
        console.log('[EbayOrderSyncService] Fetching orders in 90-day chunks...');
        allOrders = await this.fetchOrdersInChunks(
          apiAdapter,
          options.fromDate,
          options.toDate
        );
      } else {
        // Regular sync
        const filter = fromDate
          ? EbayApiAdapter.buildOrderDateFilter(fromDate, toDate, 'lastmodifieddate')
          : undefined;
        console.log('[EbayOrderSyncService] Fetching orders with filter:', filter);

        allOrders = await this.fetchAllOrders(apiAdapter, filter);
      }
      console.log('[EbayOrderSyncService] Total orders fetched:', allOrders.length);

      // Process orders and upsert
      console.log('[EbayOrderSyncService] Upserting orders to database...');
      const { ordersCreated, ordersUpdated, orderIdMap } = await this.upsertOrders(userId, allOrders);
      console.log('[EbayOrderSyncService] Orders upserted. Created:', ordersCreated, 'Updated:', ordersUpdated);

      // Upsert line items
      const { lineItemsCreated, lineItemsUpdated } = await this.upsertLineItems(allOrders, orderIdMap);

      // Fetch and upsert shipping fulfilments for each order
      let fulfilmentsProcessed = 0;
      for (const order of allOrders) {
        try {
          const fulfilments = await apiAdapter.getShippingFulfilments(order.orderId);
          const dbOrderId = orderIdMap.get(order.orderId);
          if (dbOrderId && fulfilments.fulfillments.length > 0) {
            await this.upsertFulfilments(dbOrderId, fulfilments.fulfillments);
            fulfilmentsProcessed += fulfilments.fulfillments.length;
          }
          await this.delay(RATE_LIMIT_DELAY_MS);
        } catch (error) {
          // Fulfilment fetch failed - log but continue
          console.warn(`[EbayOrderSyncService] Failed to fetch fulfilments for order ${order.orderId}:`, error);
        }
      }

      // Enrich transactions with order data (denormalize)
      let transactionsEnriched = 0;
      if (options?.enrichTransactions !== false) {
        transactionsEnriched = await this.enrichTransactionsFromOrders(userId, allOrders);
      }

      // Process inventory linking for fulfilled orders
      let inventoryAutoLinked = 0;
      let inventoryQueuedForResolution = 0;
      try {
        const linkingService = new EbayInventoryLinkingService(supabase, userId);

        // Get fulfilled orders that haven't been linked yet
        const fulfilledOrders = allOrders.filter(
          (order) => order.orderFulfillmentStatus === 'FULFILLED'
        );

        for (const order of fulfilledOrders) {
          const dbOrderId = orderIdMap.get(order.orderId);
          if (!dbOrderId) continue;

          // Check if already processed
          // Note: inventory_link_status column added in migration 20250108000003
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: existingOrder } = await (supabase as any)
            .from('ebay_orders')
            .select('inventory_link_status')
            .eq('id', dbOrderId)
            .single();

          if (existingOrder?.inventory_link_status === 'complete') {
            continue; // Already fully linked
          }

          const linkResult = await linkingService.processFulfilledOrder(dbOrderId);
          inventoryAutoLinked += linkResult.autoLinked;
          inventoryQueuedForResolution += linkResult.queuedForResolution;
        }

        console.log(
          '[EbayOrderSyncService] Inventory linking complete. Auto-linked:',
          inventoryAutoLinked,
          'Queued:',
          inventoryQueuedForResolution
        );
      } catch (linkingError) {
        // Log but don't fail the sync
        console.error('[EbayOrderSyncService] Inventory linking error:', linkingError);
      }

      // Update sync cursor to newest lastModifiedDate
      const newestDate = allOrders.length > 0
        ? allOrders.reduce((newest, order) => {
            const orderDate = new Date(order.lastModifiedDate);
            return orderDate > newest ? orderDate : newest;
          }, new Date(0)).toISOString()
        : fromDate;

      if (newestDate) {
        await supabase
          .from('ebay_sync_config')
          .upsert({
            user_id: userId,
            orders_last_modified_cursor: newestDate,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id' });
      }

      const completedAt = new Date();

      // Update sync log
      await supabase
        .from('ebay_sync_log')
        .update({
          status: 'COMPLETED',
          completed_at: completedAt.toISOString(),
          records_processed: allOrders.length,
          records_created: ordersCreated,
          records_updated: ordersUpdated,
          last_sync_cursor: newestDate,
        })
        .eq('id', syncLog.id);

      return {
        success: true,
        syncType: syncMode,
        ordersProcessed: allOrders.length,
        ordersCreated,
        ordersUpdated,
        lineItemsCreated,
        lineItemsUpdated,
        fulfilmentsProcessed,
        transactionsEnriched,
        inventoryAutoLinked,
        inventoryQueuedForResolution,
        lastSyncCursor: newestDate,
        startedAt,
        completedAt,
      };
    } catch (error) {
      const completedAt = new Date();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await supabase
        .from('ebay_sync_log')
        .update({
          status: 'FAILED',
          completed_at: completedAt.toISOString(),
          error_message: errorMessage,
        })
        .eq('id', syncLog.id);

      return {
        success: false,
        syncType: syncMode,
        ordersProcessed: 0,
        ordersCreated: 0,
        ordersUpdated: 0,
        lineItemsCreated: 0,
        lineItemsUpdated: 0,
        fulfilmentsProcessed: 0,
        transactionsEnriched: 0,
        inventoryAutoLinked: 0,
        inventoryQueuedForResolution: 0,
        error: errorMessage,
        startedAt,
        completedAt,
      };
    }
  }

  /**
   * Perform historical order import with 90-day chunking
   */
  async performHistoricalImport(
    userId: string,
    fromDate: string,
    enrichTransactions: boolean = true
  ): Promise<EbayOrderSyncResult> {
    const toDate = new Date().toISOString();
    return this.syncOrders(userId, {
      fromDate,
      toDate,
      enrichTransactions,
    });
  }

  // ============================================================================
  // Private Methods - Fetching
  // ============================================================================

  /**
   * Fetch all orders with pagination
   */
  private async fetchAllOrders(
    apiAdapter: EbayApiAdapter,
    filter?: string
  ): Promise<EbayOrderResponse[]> {
    const allOrders: EbayOrderResponse[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const response: EbayOrdersResponse = await apiAdapter.getOrders({
        filter,
        limit: MAX_ORDERS_PER_PAGE,
        offset,
      });

      allOrders.push(...response.orders);

      if (offset + MAX_ORDERS_PER_PAGE >= response.total) {
        hasMore = false;
      } else {
        offset += MAX_ORDERS_PER_PAGE;
        await this.delay(RATE_LIMIT_DELAY_MS);
      }
    }

    return allOrders;
  }

  /**
   * Fetch orders in 90-day chunks for historical imports
   * eBay limits order queries to 90 days max
   */
  private async fetchOrdersInChunks(
    apiAdapter: EbayApiAdapter,
    fromDate: string,
    toDate: string
  ): Promise<EbayOrderResponse[]> {
    const allOrders: EbayOrderResponse[] = [];
    const startDate = new Date(fromDate);
    const endDate = new Date(toDate);

    let chunkStart = new Date(startDate);

    while (chunkStart < endDate) {
      // Calculate chunk end (90 days from start, or endDate if sooner)
      const chunkEnd = new Date(chunkStart);
      chunkEnd.setDate(chunkEnd.getDate() + DAYS_PER_CHUNK);

      if (chunkEnd > endDate) {
        chunkEnd.setTime(endDate.getTime());
      }

      console.log(`[EbayOrderSyncService] Fetching orders from ${chunkStart.toISOString()} to ${chunkEnd.toISOString()}`);

      const filter = EbayApiAdapter.buildOrderDateFilter(
        chunkStart.toISOString(),
        chunkEnd.toISOString(),
        'creationdate'
      );

      const chunkOrders = await this.fetchAllOrders(apiAdapter, filter);
      allOrders.push(...chunkOrders);

      console.log(`[EbayOrderSyncService] Fetched ${chunkOrders.length} orders for chunk`);

      // Move to next chunk
      chunkStart = new Date(chunkEnd);
      chunkStart.setSeconds(chunkStart.getSeconds() + 1); // Avoid overlap

      // Small delay between chunks
      await this.delay(RATE_LIMIT_DELAY_MS * 2);
    }

    return allOrders;
  }

  // ============================================================================
  // Private Methods - Upserting
  // ============================================================================

  /**
   * Upsert orders to database
   * Returns map of ebay_order_id -> database UUID
   */
  private async upsertOrders(
    userId: string,
    orders: EbayOrderResponse[]
  ): Promise<{ ordersCreated: number; ordersUpdated: number; orderIdMap: Map<string, string> }> {
    if (orders.length === 0) {
      return { ordersCreated: 0, ordersUpdated: 0, orderIdMap: new Map() };
    }

    const supabase = await createClient();

    // Get existing order IDs
    const { data: existingOrders } = await supabase
      .from('ebay_orders')
      .select('id, ebay_order_id')
      .eq('user_id', userId)
      .in('ebay_order_id', orders.map(o => o.orderId));

    const existingMap = new Map(existingOrders?.map(o => [o.ebay_order_id, o.id]) || []);
    const orderIdMap = new Map<string, string>();

    // Transform orders
    const orderRows: OrderRow[] = orders.map(order => ({
      user_id: userId,
      ebay_order_id: order.orderId,
      legacy_order_id: order.legacyOrderId || null,
      creation_date: order.creationDate,
      last_modified_date: order.lastModifiedDate,
      order_fulfilment_status: order.orderFulfillmentStatus,
      order_payment_status: order.orderPaymentStatus,
      cancel_status: order.cancelStatus ? JSON.parse(JSON.stringify(order.cancelStatus)) : null,
      buyer_username: order.buyer.username,
      buyer_checkout_notes: order.buyerCheckoutNotes || null,
      sales_record_reference: order.salesRecordReference || null,
      total_fee_basis_amount: order.totalFeeBasisAmount ? parseFloat(order.totalFeeBasisAmount.value) : null,
      total_fee_basis_currency: order.totalFeeBasisAmount?.currency || null,
      pricing_summary: order.pricingSummary ? JSON.parse(JSON.stringify(order.pricingSummary)) : null,
      payment_summary: order.paymentSummary ? JSON.parse(JSON.stringify(order.paymentSummary)) : null,
      fulfilment_instructions: order.fulfillmentStartInstructions ? JSON.parse(JSON.stringify(order.fulfillmentStartInstructions)) : null,
      raw_response: JSON.parse(JSON.stringify(order)),
    }));

    // Upsert in batches
    let ordersCreated = 0;
    let ordersUpdated = 0;

    for (let i = 0; i < orderRows.length; i += BATCH_SIZE) {
      const batch = orderRows.slice(i, i + BATCH_SIZE);

      const { data: upsertedOrders, error } = await supabase
        .from('ebay_orders')
        .upsert(batch, {
          onConflict: 'user_id,ebay_order_id',
          ignoreDuplicates: false,
        })
        .select('id, ebay_order_id');

      if (error) {
        console.error('[EbayOrderSyncService] Failed to upsert orders:', error);
        throw new Error('Failed to save orders');
      }

      // Build order ID map and count created vs updated
      for (const upserted of upsertedOrders || []) {
        orderIdMap.set(upserted.ebay_order_id, upserted.id);
        if (existingMap.has(upserted.ebay_order_id)) {
          ordersUpdated++;
        } else {
          ordersCreated++;
        }
      }
    }

    return { ordersCreated, ordersUpdated, orderIdMap };
  }

  /**
   * Upsert line items for orders
   */
  private async upsertLineItems(
    orders: EbayOrderResponse[],
    orderIdMap: Map<string, string>
  ): Promise<{ lineItemsCreated: number; lineItemsUpdated: number }> {
    const supabase = await createClient();

    // Collect all line items from all orders
    const allLineItems: { orderId: string; dbOrderId: string; lineItem: EbayLineItem }[] = [];

    for (const order of orders) {
      const dbOrderId = orderIdMap.get(order.orderId);
      if (dbOrderId) {
        for (const lineItem of order.lineItems) {
          allLineItems.push({ orderId: order.orderId, dbOrderId, lineItem });
        }
      }
    }

    if (allLineItems.length === 0) {
      return { lineItemsCreated: 0, lineItemsUpdated: 0 };
    }

    // Get existing line item IDs
    const { data: existingLineItems } = await supabase
      .from('ebay_order_line_items')
      .select('ebay_line_item_id')
      .in('ebay_line_item_id', allLineItems.map(li => li.lineItem.lineItemId));

    const existingIds = new Set(existingLineItems?.map(li => li.ebay_line_item_id) || []);

    // Transform line items
    const lineItemRows: LineItemRow[] = allLineItems.map(({ dbOrderId, lineItem }) => ({
      order_id: dbOrderId,
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
      item_location: lineItem.itemLocation?.countryCode || null,
      taxes: lineItem.taxes ? JSON.parse(JSON.stringify(lineItem.taxes)) : null,
      properties: lineItem.properties ? JSON.parse(JSON.stringify(lineItem.properties)) : null,
      raw_response: JSON.parse(JSON.stringify(lineItem)),
    }));

    // Upsert in batches
    let lineItemsCreated = 0;
    let lineItemsUpdated = 0;

    for (let i = 0; i < lineItemRows.length; i += BATCH_SIZE) {
      const batch = lineItemRows.slice(i, i + BATCH_SIZE);

      const { error } = await supabase
        .from('ebay_order_line_items')
        .upsert(batch, {
          onConflict: 'ebay_line_item_id',
          ignoreDuplicates: false,
        });

      if (error) {
        console.error('[EbayOrderSyncService] Failed to upsert line items:', error);
        throw new Error('Failed to save line items');
      }

      for (const row of batch) {
        if (existingIds.has(row.ebay_line_item_id)) {
          lineItemsUpdated++;
        } else {
          lineItemsCreated++;
        }
      }
    }

    return { lineItemsCreated, lineItemsUpdated };
  }

  /**
   * Upsert shipping fulfilments for an order
   */
  private async upsertFulfilments(
    dbOrderId: string,
    fulfilments: EbayShippingFulfilmentResponse[]
  ): Promise<void> {
    if (fulfilments.length === 0) return;

    const supabase = await createClient();

    const fulfilmentRows: FulfilmentRow[] = fulfilments.map(f => ({
      order_id: dbOrderId,
      ebay_fulfilment_id: f.fulfillmentId,
      shipped_date: f.shippedDate || null,
      shipping_carrier_code: f.shippingCarrierCode || null,
      tracking_number: f.shipmentTrackingNumber || null,
      line_items: JSON.parse(JSON.stringify(f.lineItems)),
      raw_response: JSON.parse(JSON.stringify(f)),
    }));

    const { error } = await supabase
      .from('ebay_shipping_fulfilments')
      .upsert(fulfilmentRows, {
        onConflict: 'ebay_fulfilment_id',
        ignoreDuplicates: false,
      });

    if (error) {
      console.error('[EbayOrderSyncService] Failed to upsert fulfilments:', error);
      // Don't throw - fulfilments are secondary data
    }
  }

  // ============================================================================
  // Private Methods - Transaction Enrichment
  // ============================================================================

  /**
   * Enrich transactions with order data (denormalize for reporting)
   * This populates item_title, custom_label, quantity, sales_record_reference, etc.
   */
  private async enrichTransactionsFromOrders(
    userId: string,
    orders: EbayOrderResponse[]
  ): Promise<number> {
    if (orders.length === 0) return 0;

    const supabase = await createClient();
    let enriched = 0;

    // Build a map of orderId -> order data for quick lookup
    const orderDataMap = new Map<string, {
      salesRecordReference: string | null;
      lineItems: EbayLineItem[];
      deliveryCost: number | null;
      totalPrice: number | null;
    }>();

    for (const order of orders) {
      const pricingSummary = order.pricingSummary;
      orderDataMap.set(order.orderId, {
        salesRecordReference: order.salesRecordReference || null,
        lineItems: order.lineItems,
        deliveryCost: pricingSummary?.deliveryCost ? parseFloat(pricingSummary.deliveryCost.value) : null,
        totalPrice: pricingSummary?.total ? parseFloat(pricingSummary.total.value) : null,
      });
    }

    // Get transactions that match these orders
    const orderIds = orders.map(o => o.orderId);

    // Process in batches to avoid query limits
    for (let i = 0; i < orderIds.length; i += BATCH_SIZE) {
      const batchOrderIds = orderIds.slice(i, i + BATCH_SIZE);

      const { data: transactions } = await supabase
        .from('ebay_transactions')
        .select('id, ebay_order_id')
        .eq('user_id', userId)
        .in('ebay_order_id', batchOrderIds);

      if (!transactions || transactions.length === 0) continue;

      // Update each transaction with order data
      for (const tx of transactions) {
        const orderData = orderDataMap.get(tx.ebay_order_id!);
        if (!orderData) continue;

        // Get first line item data (most transactions are single-item)
        const firstLineItem = orderData.lineItems[0];
        const totalQuantity = orderData.lineItems.reduce((sum, li) => sum + li.quantity, 0);

        const { error } = await supabase
          .from('ebay_transactions')
          .update({
            sales_record_reference: orderData.salesRecordReference,
            item_title: firstLineItem?.title || null,
            custom_label: firstLineItem?.sku || null,
            quantity: totalQuantity,
            postage_and_packaging: orderData.deliveryCost,
            total_price: orderData.totalPrice,
            item_location_country: firstLineItem?.itemLocation?.countryCode || null,
          })
          .eq('id', tx.id);

        if (!error) {
          enriched++;
        }
      }
    }

    return enriched;
  }

  /**
   * Delay helper for rate limiting
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export a default instance
export const ebayOrderSyncService = new EbayOrderSyncService();
