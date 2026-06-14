/**
 * Shopify -> HB order ingestion.
 *
 * This closes the inbound gap: the rest of the Shopify integration only pushes
 * HB -> Shopify and tidies Shopify *after* an Amazon/eBay sale. A sale that
 * originates on Shopify previously propagated nowhere, leaving the same physical
 * item buyable on eBay (double-sell risk).
 *
 * On each run it:
 *  1. Fetches paid Shopify orders updated since the last cursor.
 *  2. Upserts them into `platform_orders` (platform = 'shopify').
 *  3. Resolves each line item to our LISTED `inventory_items` (by SKU, or by id
 *     prefix for SKU-less items), marks them SOLD (sold_platform = 'shopify').
 *  4. Archives/decrements the Shopify product (`archiveShopifyOnSold`) and ends
 *     the matching eBay listing (`EbayDelistingService`) so it can't double-sell.
 *
 * Idempotent: only LISTED items are ever transitioned, so re-fetching recent
 * orders (the poll uses an overlap window) never double-marks a sale.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { ShopifyClient } from './client';
import { archiveShopifyOnSold } from './archive-on-sold';
import { EbayDelistingService } from '@/lib/ebay/ebay-delisting.service';
import { discordService } from '@/lib/notifications';
import type {
  ShopifyConfig,
  ShopifyOrder,
  ShopifyOrderLineItem,
  ShopifyOrderSyncResult,
} from './types';

/** How far before the last cursor to re-scan, to catch late updates. */
const OVERLAP_MS = 60 * 60 * 1000; // 1 hour
/** Lookback for the very first run (no cursor yet). */
const FIRST_RUN_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

const HEX8 = /^[0-9a-f]{8}$/;

interface ListedItem {
  id: string;
  sku: string | null;
  created_at: string;
  storage_location: string | null;
}

export class ShopifyOrderSyncService {
  private config: ShopifyConfig | null = null;
  private client: ShopifyClient | null = null;
  private delisting: EbayDelistingService;

  constructor(
    private supabase: SupabaseClient<Database>,
    private userId: string
  ) {
    this.delisting = new EbayDelistingService(supabase as unknown as SupabaseClient);
  }

  private async getConfig(): Promise<ShopifyConfig> {
    if (this.config) return this.config;
    const { data, error } = await this.supabase
      .from('shopify_config')
      .select('*')
      .eq('user_id', this.userId)
      .single();
    if (error || !data) throw new Error('Shopify config not found');
    this.config = data as unknown as ShopifyConfig;
    return this.config;
  }

  private async getClient(): Promise<ShopifyClient> {
    if (this.client) return this.client;
    const config = await this.getConfig();
    this.client = new ShopifyClient(config);
    return this.client;
  }

  async syncOrders(options?: { fullSync?: boolean }): Promise<ShopifyOrderSyncResult> {
    const startedAt = new Date().toISOString();
    const result: ShopifyOrderSyncResult = {
      success: false,
      syncType: options?.fullSync ? 'FULL' : 'INCREMENTAL',
      ordersFetched: 0,
      ordersIngested: 0,
      lineItemsProcessed: 0,
      itemsMarkedSold: 0,
      ebayListingsEnded: 0,
      shopifyProductsArchived: 0,
      unmatchedLineItems: 0,
      oversoldLineItems: 0,
      errors: [],
      lastCursor: null,
      startedAt,
      completedAt: startedAt,
    };

    let config: ShopifyConfig;
    try {
      config = await this.getConfig();
    } catch (err) {
      result.errors.push({ context: 'config', error: err instanceof Error ? err.message : String(err) });
      result.completedAt = new Date().toISOString();
      return result;
    }

    if (!config.sync_enabled) {
      result.errors.push({ context: 'config', error: 'Shopify sync disabled' });
      result.success = true; // not an error condition, just nothing to do
      result.completedAt = new Date().toISOString();
      return result;
    }

    // Determine the incremental window.
    const now = Date.now();
    let updatedAtMin: string | undefined;
    if (!options?.fullSync) {
      const last = config.last_order_sync_at ? new Date(config.last_order_sync_at).getTime() : null;
      const from = last ? last - OVERLAP_MS : now - FIRST_RUN_LOOKBACK_MS;
      updatedAtMin = new Date(from).toISOString();
    } else {
      updatedAtMin = new Date(now - FIRST_RUN_LOOKBACK_MS).toISOString();
    }

    let orders: ShopifyOrder[];
    try {
      const client = await this.getClient();
      orders = await client.getOrders({ updatedAtMin, financialStatus: 'paid', status: 'any' });
    } catch (err) {
      result.errors.push({ context: 'fetch', error: err instanceof Error ? err.message : String(err) });
      result.completedAt = new Date().toISOString();
      return result;
    }

    result.ordersFetched = orders.length;

    for (const order of orders) {
      if (order.cancelled_at) continue; // skip cancelled
      try {
        await this.upsertOrder(order);
        result.ordersIngested++;
        await this.processOrderLineItems(order, result);
      } catch (err) {
        result.errors.push({
          context: `order ${order.name}`,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Advance the cursor to now (we used an overlap window so a small gap is safe).
    const cursor = new Date(now).toISOString();
    await this.supabase
      .from('shopify_config')
      .update({ last_order_sync_at: cursor })
      .eq('user_id', this.userId);
    result.lastCursor = cursor;

    result.success = result.errors.length === 0;
    result.completedAt = new Date().toISOString();

    if (result.itemsMarkedSold > 0 || result.ebayListingsEnded > 0 || result.oversoldLineItems > 0) {
      discordService
        .sendSyncStatus({
          title: result.oversoldLineItems > 0 ? '⚠️ Shopify Sales Synced (oversell!)' : '🛒 Shopify Sales Synced',
          message: `${result.itemsMarkedSold} item(s) marked sold on Shopify; ${result.ebayListingsEnded} eBay listing(s) ended; ${result.shopifyProductsArchived} Shopify product(s) archived.${result.unmatchedLineItems ? ` ${result.unmatchedLineItems} line item(s) unmatched.` : ''}${result.oversoldLineItems ? ` ${result.oversoldLineItems} OVERSELL line(s) — ordered more than LISTED.` : ''}`,
          success: result.success,
        })
        .catch(() => {});
    }

    return result;
  }

  private async upsertOrder(order: ShopifyOrder): Promise<void> {
    const customerName = order.customer
      ? [order.customer.first_name, order.customer.last_name].filter(Boolean).join(' ') || null
      : null;
    const shipping = order.total_shipping_price_set?.shop_money?.amount
      ? parseFloat(order.total_shipping_price_set.shop_money.amount)
      : null;

    const { error } = await this.supabase.from('platform_orders').upsert(
      {
        user_id: this.userId,
        platform: 'shopify',
        platform_order_id: String(order.id),
        order_date: order.created_at,
        status: order.financial_status ?? null,
        buyer_name: customerName,
        buyer_email: order.email,
        total: order.total_price ? parseFloat(order.total_price) : null,
        subtotal: order.subtotal_price ? parseFloat(order.subtotal_price) : null,
        shipping,
        currency: order.currency,
        items_count: order.line_items?.length ?? null,
        raw_data: order as unknown as Database['public']['Tables']['platform_orders']['Insert']['raw_data'],
        synced_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,platform,platform_order_id' }
    );
    if (error) throw new Error(`platform_orders upsert: ${error.message}`);
  }

  private async processOrderLineItems(
    order: ShopifyOrder,
    result: ShopifyOrderSyncResult
  ): Promise<void> {
    // Units returned via a refund must not be marked sold / de-listed.
    const refundedByLine = new Map<number, number>();
    for (const refund of order.refunds ?? []) {
      for (const rli of refund.refund_line_items ?? []) {
        refundedByLine.set(rli.line_item_id, (refundedByLine.get(rli.line_item_id) ?? 0) + (rli.quantity || 0));
      }
    }
    const effectiveQtyOf = (li: ShopifyOrderLineItem) =>
      Math.max(0, (li.quantity || 0) - (refundedByLine.get(li.id) ?? 0));

    const totalUnits = order.line_items.reduce((s, li) => s + effectiveQtyOf(li), 0) || 1;
    const orderShipping = order.total_shipping_price_set?.shop_money?.amount
      ? parseFloat(order.total_shipping_price_set.shop_money.amount)
      : 0;
    const perUnitPostage = orderShipping / totalUnits;

    for (const lineItem of order.line_items) {
      result.lineItemsProcessed++;
      const effQty = effectiveQtyOf(lineItem);
      if (effQty <= 0) continue; // fully refunded / returned

      const sku = lineItem.sku?.trim() || null;
      const items = await this.resolveListedItems(sku, effQty);

      if (items.length === 0) {
        result.unmatchedLineItems++;
        continue;
      }
      if (items.length < effQty) {
        // Ordered more than we have LISTED — oversell. Surface it, don't fail the sync.
        result.oversoldLineItems++;
        console.warn(
          `[ShopifyOrderSync] Oversell on ${order.name} sku=${sku ?? '?'}: ordered ${effQty}, only ${items.length} LISTED`
        );
      }

      for (const item of items) {
        await this.markItemSold(item, lineItem, order, perUnitPostage);
        result.itemsMarkedSold++;

        const hadMapping = await this.itemHasShopifyMapping(item.id);
        // Archive/decrement Shopify (idempotent, never throws).
        await archiveShopifyOnSold(
          this.supabase as unknown as Parameters<typeof archiveShopifyOnSold>[0],
          this.userId,
          item.id
        );
        if (hadMapping) result.shopifyProductsArchived++;

        // End the matching eBay listing so it can't be double-sold.
        try {
          const delist = await this.delisting.endListingForInventoryItem(this.userId, {
            id: item.id,
            sku: item.sku,
          });
          if (delist.ended) result.ebayListingsEnded++;
          else if (delist.error)
            result.errors.push({ context: `ebay delist ${item.sku ?? item.id}`, error: delist.error });
        } catch (err) {
          result.errors.push({
            context: `ebay delist ${item.sku ?? item.id}`,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  /**
   * Resolve LISTED inventory items for a Shopify line item. Matches by SKU,
   * falling back to id-prefix for SKU-less items (whose Shopify SKU is
   * `id.substring(0,8)`). Returns at most `quantity` items, oldest first.
   */
  private async resolveListedItems(sku: string | null, quantity: number): Promise<ListedItem[]> {
    const qty = Math.max(1, quantity || 1);

    if (sku && HEX8.test(sku)) {
      // SKU-less inventory item — its Shopify SKU is the id prefix.
      const { data } = await this.supabase
        .from('inventory_items')
        .select('id, sku, created_at, storage_location')
        .eq('user_id', this.userId)
        .eq('status', 'LISTED')
        .is('sku', null)
        .order('created_at', { ascending: true });
      const matched = (data ?? []).filter((it) => String(it.id).slice(0, 8) === sku);
      return matched.slice(0, qty) as ListedItem[];
    }

    if (!sku) return [];

    const { data } = await this.supabase
      .from('inventory_items')
      .select('id, sku, created_at, storage_location')
      .eq('user_id', this.userId)
      .eq('status', 'LISTED')
      .eq('sku', sku)
      .order('created_at', { ascending: true })
      .limit(qty);
    return (data ?? []) as ListedItem[];
  }

  private async markItemSold(
    item: ListedItem,
    lineItem: ShopifyOrderLineItem,
    order: ShopifyOrder,
    perUnitPostage: number
  ): Promise<void> {
    // Net the line's discount allocations off the per-unit price so we record
    // the actual proceeds, not the pre-discount list price.
    const lineQty = Math.max(1, lineItem.quantity || 1);
    const lineDiscount = (lineItem.discount_allocations ?? []).reduce(
      (s, d) => s + (parseFloat(d.amount) || 0),
      0
    );
    const unitPrice = Math.max(
      0,
      Math.round((parseFloat(lineItem.price) - lineDiscount / lineQty) * 100) / 100
    );
    const postage = Math.round(perUnitPostage * 100) / 100;
    const gross = Math.round((unitPrice + postage) * 100) / 100;
    const soldDate = order.created_at.slice(0, 10);

    const { error } = await this.supabase
      .from('inventory_items')
      .update({
        status: 'SOLD',
        sold_date: soldDate,
        sold_at: new Date().toISOString(),
        sold_price: unitPrice,
        sold_platform: 'shopify',
        sold_order_id: String(order.id),
        sold_gross_amount: gross,
        sold_postage_received: postage || null,
        archive_location: item.storage_location
          ? `SOLD-${soldDate.replace(/-/g, '')}-${item.storage_location} (shopify ${order.name})`
          : `SOLD-${soldDate.replace(/-/g, '')} (shopify ${order.name})`,
        storage_location: null,
      })
      .eq('id', item.id)
      .eq('user_id', this.userId)
      .eq('status', 'LISTED'); // guard against races / double-processing
    if (error) throw new Error(`mark sold ${item.id}: ${error.message}`);
  }

  private async itemHasShopifyMapping(inventoryItemId: string): Promise<boolean> {
    const { data } = await this.supabase
      .from('shopify_products')
      .select('id')
      .eq('inventory_item_id', inventoryItemId)
      .neq('shopify_status', 'archived')
      .limit(1)
      .maybeSingle();
    return !!data;
  }
}
