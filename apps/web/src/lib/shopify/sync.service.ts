import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { ShopifyClient } from './client';
import { calculateShopifyPrice, formatShopifyPrice } from './pricing';
import {
  buildShopifyDescription,
  buildShopifyTitle,
  buildShopifyTags,
} from './descriptions';
import { resolveImages } from './images';
import type {
  ShopifyConfig,
  ShopifyProductPayload,
  BatchSyncSummary,
  SyncResult,
} from './types';

/**
 * Shopify sync service — orchestrates one-way sync from HB → Shopify.
 *
 * Key operations:
 * - CREATE: Push new product to Shopify when item is LISTED
 * - ARCHIVE: Remove product when item is SOLD
 * - UPDATE: Sync price/detail changes
 */
export class ShopifySyncService {
  private supabase: SupabaseClient<Database>;
  private userId: string;
  private client: ShopifyClient | null = null;
  private config: ShopifyConfig | null = null;

  constructor(supabase: SupabaseClient<Database>, userId: string) {
    this.supabase = supabase;
    this.userId = userId;
  }

  /** Load config and initialise client */
  private async getClient(): Promise<ShopifyClient> {
    if (this.client) return this.client;

    const { data, error } = await this.supabase
      .from('shopify_config')
      .select('*')
      .eq('user_id', this.userId)
      .single();

    if (error || !data) {
      throw new Error('Shopify config not found. Please configure Shopify integration first.');
    }

    this.config = data as unknown as ShopifyConfig;

    if (!this.config.sync_enabled) {
      throw new Error('Shopify sync is disabled');
    }

    this.client = new ShopifyClient(this.config);
    return this.client;
  }

  private getConfig(): ShopifyConfig {
    if (!this.config) throw new Error('Config not loaded — call getClient() first');
    return this.config;
  }

  // ── CREATE ────────────────────────────────────────────────────

  /**
   * Push a single inventory item to Shopify as a new product.
   */
  async createProduct(inventoryItemId: string): Promise<SyncResult> {
    const client = await this.getClient();
    const config = this.getConfig();

    // Fetch inventory item with all data
    const { data: item, error: itemError } = await this.supabase
      .from('inventory_items')
      .select('*')
      .eq('id', inventoryItemId)
      .single();

    if (itemError || !item) {
      return { success: false, error: `Item not found: ${inventoryItemId}` };
    }

    // Check not already synced
    const { data: existing } = await this.supabase
      .from('shopify_products')
      .select('id')
      .eq('inventory_item_id', inventoryItemId)
      .single();

    if (existing) {
      return { success: false, error: 'Item already has a Shopify product' };
    }

    // Get Brickset data for rich descriptions
    let bricksetData = null;
    if (item.set_number && item.set_number !== 'NA') {
      const variants = [`${item.set_number}-1`, item.set_number];
      for (const v of variants) {
        const { data } = await this.supabase
          .from('brickset_sets')
          .select('set_number, theme, subtheme, pieces, minifigs, year_from, uk_retail_price')
          .eq('set_number', v)
          .limit(1)
          .single();
        if (data) {
          bricksetData = data;
          break;
        }
      }
    }

    // Resolve images
    const imageResult = await resolveImages(this.supabase, {
      id: item.id,
      set_number: item.set_number,
      item_name: item.item_name,
      ebay_listing_id: item.ebay_listing_id,
      listing_platform: item.listing_platform,
    });

    // Calculate pricing
    const discountPct = config.default_discount_pct ?? 10;
    const priceResult = calculateShopifyPrice(item.listing_value ?? 0, discountPct);

    // Build product payload
    const title = buildShopifyTitle(item, bricksetData);
    const description = buildShopifyDescription(item, bricksetData);
    const tags = buildShopifyTags(item, bricksetData);

    const payload: ShopifyProductPayload = {
      product: {
        title,
        body_html: description,
        vendor: 'Hadley Bricks',
        product_type: 'LEGO Set',
        tags,
        status: 'active',
        variants: [
          {
            price: formatShopifyPrice(priceResult.price),
            ...(priceResult.compare_at_price
              ? { compare_at_price: formatShopifyPrice(priceResult.compare_at_price) }
              : {}),
            sku: item.sku ?? item.id.substring(0, 8),
            inventory_management: 'shopify',
            requires_shipping: true,
          },
        ],
        ...(imageResult.urls.length > 0
          ? { images: imageResult.urls.map((src) => ({ src })) }
          : {}),
      },
    };

    try {
      const response = await client.createProduct(payload);
      const product = response.product;
      const variant = product.variants[0];

      // Set inventory level if location is configured
      if (config.location_id && variant?.inventory_item_id) {
        try {
          await client.setInventoryLevel(
            String(variant.inventory_item_id),
            config.location_id,
            1
          );
        } catch (invErr) {
          console.warn(`[ShopifySync] Failed to set inventory for ${item.id}:`, invErr);
        }
      }

      // Save mapping to shopify_products
      await this.supabase.from('shopify_products').insert({
        user_id: this.userId,
        inventory_item_id: item.id,
        shopify_product_id: String(product.id),
        shopify_variant_id: variant ? String(variant.id) : null,
        shopify_inventory_item_id: variant
          ? String(variant.inventory_item_id)
          : null,
        shopify_handle: product.handle,
        shopify_status: product.status,
        shopify_price: priceResult.price,
        shopify_compare_at_price: priceResult.compare_at_price,
        shopify_title: title,
        shopify_description: description,
        image_source: imageResult.source,
        image_urls: imageResult.urls,
        last_synced_at: new Date().toISOString(),
        sync_status: 'synced',
      });

      return { success: true, shopifyProductId: String(product.id) };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      // Record error in shopify_products
      await this.supabase.from('shopify_products').upsert(
        {
          user_id: this.userId,
          inventory_item_id: item.id,
          shopify_product_id: '',
          sync_status: 'error',
          sync_error: errorMsg.substring(0, 500),
        },
        { onConflict: 'inventory_item_id' }
      );

      return { success: false, error: errorMsg };
    }
  }

  // ── ARCHIVE ───────────────────────────────────────────────────

  /**
   * Archive a Shopify product when the item is sold elsewhere.
   * This is the highest priority sync operation.
   */
  async archiveProduct(inventoryItemId: string): Promise<SyncResult> {
    const client = await this.getClient();

    const { data: mapping } = await this.supabase
      .from('shopify_products')
      .select('*')
      .eq('inventory_item_id', inventoryItemId)
      .single();

    if (!mapping || !mapping.shopify_product_id) {
      return { success: true }; // Nothing to archive
    }

    if (mapping.shopify_status === 'archived') {
      return { success: true }; // Already archived
    }

    try {
      await client.archiveProduct(mapping.shopify_product_id);

      await this.supabase
        .from('shopify_products')
        .update({
          shopify_status: 'archived',
          sync_status: 'synced',
          last_synced_at: new Date().toISOString(),
        })
        .eq('id', mapping.id);

      return { success: true, shopifyProductId: mapping.shopify_product_id };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      await this.supabase
        .from('shopify_products')
        .update({
          sync_status: 'error',
          sync_error: errorMsg.substring(0, 500),
        })
        .eq('id', mapping.id);

      return { success: false, error: errorMsg };
    }
  }

  // ── UPDATE PRICE ──────────────────────────────────────────────

  /**
   * Update the Shopify price for an existing product.
   */
  async updatePrice(
    inventoryItemId: string,
    newPrice?: number,
    newCompareAt?: number | null
  ): Promise<SyncResult> {
    const client = await this.getClient();
    const config = this.getConfig();

    const { data: mapping } = await this.supabase
      .from('shopify_products')
      .select('*')
      .eq('inventory_item_id', inventoryItemId)
      .single();

    if (!mapping?.shopify_variant_id) {
      return { success: false, error: 'No Shopify mapping found' };
    }

    // If no explicit price given, recalculate from listing_value
    if (newPrice === undefined) {
      const { data: item } = await this.supabase
        .from('inventory_items')
        .select('listing_value')
        .eq('id', inventoryItemId)
        .single();

      if (item?.listing_value) {
        const priceResult = calculateShopifyPrice(
          item.listing_value,
          config.default_discount_pct ?? 10
        );
        newPrice = priceResult.price;
        newCompareAt = priceResult.compare_at_price;
      }
    }

    if (newPrice === undefined) {
      return { success: false, error: 'No price available' };
    }

    try {
      await client.updateVariant(mapping.shopify_variant_id, {
        price: formatShopifyPrice(newPrice),
        ...(newCompareAt !== undefined
          ? { compare_at_price: newCompareAt ? formatShopifyPrice(newCompareAt) : '' }
          : {}),
      });

      await this.supabase
        .from('shopify_products')
        .update({
          shopify_price: newPrice,
          shopify_compare_at_price: newCompareAt ?? null,
          sync_status: 'synced',
          last_synced_at: new Date().toISOString(),
        })
        .eq('id', mapping.id);

      return { success: true, shopifyProductId: mapping.shopify_product_id };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // ── BATCH SYNC ────────────────────────────────────────────────

  /**
   * Sync all eligible items to Shopify.
   * Creates products for LISTED items not yet on Shopify,
   * archives products for items no longer LISTED.
   */
  async batchSync(limit = 50): Promise<BatchSyncSummary> {
    const startTime = Date.now();
    const summary: BatchSyncSummary = {
      items_processed: 0,
      items_created: 0,
      items_updated: 0,
      items_archived: 0,
      items_failed: 0,
      errors: [],
      duration_ms: 0,
    };

    await this.getClient();

    // 1. Archive products for items no longer LISTED
    const { data: toArchive } = await this.supabase
      .from('shopify_products')
      .select('inventory_item_id, shopify_status, inventory_items!inner(status)')
      .eq('user_id', this.userId)
      .neq('shopify_status', 'archived')
      .neq('inventory_items.status', 'LISTED');

    if (toArchive) {
      for (const item of toArchive) {
        summary.items_processed++;
        const result = await this.archiveProduct(item.inventory_item_id);
        if (result.success) {
          summary.items_archived++;
        } else {
          summary.items_failed++;
          summary.errors.push({
            item_id: item.inventory_item_id,
            error: result.error || 'Archive failed',
          });
        }
      }
    }

    // 2. Create products for LISTED items not yet on Shopify
    const { data: existingMappings } = await this.supabase
      .from('shopify_products')
      .select('inventory_item_id')
      .eq('user_id', this.userId);

    const existingIds = new Set(existingMappings?.map((m) => m.inventory_item_id) || []);

    const { data: listedItems } = await this.supabase
      .from('inventory_items')
      .select('id')
      .eq('user_id', this.userId)
      .eq('status', 'LISTED')
      .not('set_number', 'is', null)
      .neq('set_number', 'NA')
      .limit(limit + existingIds.size);

    const itemsToCreate = (listedItems || []).filter(
      (item) => !existingIds.has(item.id)
    ).slice(0, limit);

    for (const item of itemsToCreate) {
      summary.items_processed++;
      const result = await this.createProduct(item.id);
      if (result.success) {
        summary.items_created++;
      } else {
        summary.items_failed++;
        summary.errors.push({
          item_id: item.id,
          error: result.error || 'Create failed',
        });
      }
    }

    summary.duration_ms = Date.now() - startTime;

    // Log the sync run
    await this.supabase.from('shopify_sync_log').insert({
      user_id: this.userId,
      sync_type: 'batch',
      items_processed: summary.items_processed,
      items_created: summary.items_created,
      items_updated: summary.items_updated,
      items_archived: summary.items_archived,
      items_failed: summary.items_failed,
      errors: summary.errors.length > 0 ? summary.errors : null,
      duration_ms: summary.duration_ms,
      completed_at: new Date().toISOString(),
    });

    return summary;
  }

  // ── QUEUE PROCESSING ──────────────────────────────────────────

  /**
   * Process pending items from the sync queue, ordered by priority.
   */
  async processQueue(batchSize = 10): Promise<BatchSyncSummary> {
    const startTime = Date.now();
    const summary: BatchSyncSummary = {
      items_processed: 0,
      items_created: 0,
      items_updated: 0,
      items_archived: 0,
      items_failed: 0,
      errors: [],
      duration_ms: 0,
    };

    // Fetch pending jobs ordered by priority (1 = highest)
    const { data: jobs } = await this.supabase
      .from('shopify_sync_queue')
      .select('*')
      .eq('user_id', this.userId)
      .eq('status', 'pending')
      .lte('scheduled_for', new Date().toISOString())
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(batchSize);

    if (!jobs || jobs.length === 0) {
      summary.duration_ms = Date.now() - startTime;
      return summary;
    }

    for (const job of jobs) {
      // Mark as processing
      await this.supabase
        .from('shopify_sync_queue')
        .update({ status: 'processing', attempts: job.attempts + 1 })
        .eq('id', job.id);

      summary.items_processed++;
      let result: SyncResult;

      try {
        switch (job.action) {
          case 'create':
            result = await this.createProduct(job.inventory_item_id!);
            if (result.success) summary.items_created++;
            break;
          case 'archive':
            result = await this.archiveProduct(job.inventory_item_id!);
            if (result.success) summary.items_archived++;
            break;
          case 'update_price':
            result = await this.updatePrice(job.inventory_item_id!);
            if (result.success) summary.items_updated++;
            break;
          default:
            result = { success: false, error: `Unknown action: ${job.action}` };
        }
      } catch (err) {
        result = {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      if (result.success) {
        await this.supabase
          .from('shopify_sync_queue')
          .update({
            status: 'completed',
            processed_at: new Date().toISOString(),
          })
          .eq('id', job.id);
      } else {
        const shouldRetry = job.attempts + 1 < job.max_attempts;
        await this.supabase
          .from('shopify_sync_queue')
          .update({
            status: shouldRetry ? 'pending' : 'failed',
            error_message: result.error?.substring(0, 500),
            // Exponential backoff for retries
            ...(shouldRetry
              ? {
                  scheduled_for: new Date(
                    Date.now() + Math.pow(2, job.attempts + 1) * 60_000
                  ).toISOString(),
                }
              : { processed_at: new Date().toISOString() }),
          })
          .eq('id', job.id);

        summary.items_failed++;
        summary.errors.push({
          item_id: job.inventory_item_id || job.id,
          error: result.error || 'Unknown error',
        });
      }
    }

    summary.duration_ms = Date.now() - startTime;
    return summary;
  }

  // ── HELPERS ───────────────────────────────────────────────────

  /**
   * Enqueue a sync job with priority.
   * Call this when an item status changes (e.g. markItemAsSold).
   */
  async enqueueJob(
    action: 'create' | 'archive' | 'update_price' | 'delete',
    inventoryItemId: string,
    priority = 5,
    payload?: Record<string, unknown>
  ): Promise<void> {
    await this.supabase.from('shopify_sync_queue').insert({
      user_id: this.userId,
      inventory_item_id: inventoryItemId,
      action,
      priority,
      payload: (payload as unknown as null) ?? null,
    });
  }

  /**
   * Get sync status overview.
   */
  async getStatus(): Promise<{
    total: number;
    active: number;
    archived: number;
    errors: number;
    pending_queue: number;
    last_sync: string | null;
  }> {
    const [products, queue, lastLog] = await Promise.all([
      this.supabase
        .from('shopify_products')
        .select('shopify_status, sync_status', { count: 'exact' })
        .eq('user_id', this.userId),
      this.supabase
        .from('shopify_sync_queue')
        .select('id', { count: 'exact' })
        .eq('user_id', this.userId)
        .eq('status', 'pending'),
      this.supabase
        .from('shopify_sync_log')
        .select('completed_at')
        .eq('user_id', this.userId)
        .order('completed_at', { ascending: false })
        .limit(1)
        .single(),
    ]);

    const items = products.data || [];
    return {
      total: items.length,
      active: items.filter((i) => i.shopify_status === 'active').length,
      archived: items.filter((i) => i.shopify_status === 'archived').length,
      errors: items.filter((i) => i.sync_status === 'error').length,
      pending_queue: queue.count || 0,
      last_sync: lastLog.data?.completed_at || null,
    };
  }
}
