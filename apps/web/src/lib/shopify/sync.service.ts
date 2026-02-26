import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { ShopifyClient } from './client';
import { calculateShopifyPrice, formatShopifyPrice } from './pricing';
import {
  buildShopifyDescription,
  buildShopifyTitle,
  buildShopifyTags,
  buildSeoDescription,
  getOrGenerateAIDescription,
} from './descriptions';
import { resolveImages, fetchEbayListing } from './images';
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

      // For minifigures without a direct brickset_sets match, derive theme
      // from the BrickLink prefix (e.g. sw→Star Wars, hp→Harry Potter)
      if (!bricksetData && isMinifigure(item)) {
        const theme = getMinifigTheme(item.set_number);
        if (theme) {
          bricksetData = {
            set_number: item.set_number,
            theme,
            subtheme: null,
            pieces: null,
            minifigs: null,
            year_from: null,
            uk_retail_price: null,
          };
        }
      }
    }

    // Fetch eBay listing data (photos + description) if this is an eBay item
    let ebayListing = null;
    if (item.listing_platform === 'ebay' && item.ebay_listing_id) {
      ebayListing = await fetchEbayListing(item.ebay_listing_id);
    }

    // Resolve images (pass eBay data so all photos are used)
    const imageResult = await resolveImages(
      this.supabase,
      {
        id: item.id,
        set_number: item.set_number,
        item_name: item.item_name,
        ebay_listing_id: item.ebay_listing_id,
        listing_platform: item.listing_platform,
      },
      ebayListing
    );

    // Calculate pricing — minifigures use exact listing price (no discount)
    const minifig = isMinifigure(item);
    const priceResult = minifig
      ? { price: item.listing_value ?? 0, compare_at_price: null }
      : calculateShopifyPrice(item.listing_value ?? 0, config.default_discount_pct ?? 10);

    // Get or generate AI description (checks cache, then generates via Claude Haiku)
    // Used for Amazon items (no eBay description) and minifigs without eBay data
    const aiDesc = item.set_number && item.set_number !== 'NA'
      ? await getOrGenerateAIDescription(this.supabase, item.id, item.set_number, {
          item_name: item.item_name,
          condition: item.condition,
          theme: bricksetData?.theme ?? null,
          subtheme: bricksetData?.subtheme ?? null,
          pieces: bricksetData?.pieces ?? null,
          minifigs: bricksetData?.minifigs ?? null,
          year: bricksetData?.year_from ?? null,
          rrp: bricksetData?.uk_retail_price ?? null,
        })
      : null;

    // Build product payload (pass eBay description for badge/title/tag detection)
    const ebayDesc = ebayListing?.description ?? null;
    const title = buildShopifyTitle(item, bricksetData, ebayDesc);
    const description = buildShopifyDescription(item, bricksetData, ebayDesc, aiDesc);
    const tags = buildShopifyTags(item, bricksetData, ebayDesc);

    // Build metafields for storefront filtering
    const metafields = buildMetafields(item, bricksetData);

    // Add SEO meta description (plain text, max 160 chars)
    const seoDesc = buildSeoDescription(item, bricksetData);
    metafields.push({
      namespace: 'global',
      key: 'description_tag',
      value: seoDesc,
      type: 'single_line_text_field',
    });

    const handle = buildHandle(item, title, priceResult.price);

    // Add alt text to images
    const imagesWithAlt = addImageAltText(imageResult.images, title, item.set_number);

    const payload: ShopifyProductPayload = {
      product: {
        title,
        body_html: description,
        vendor: 'LEGO',
        product_type: minifig ? 'Minifigure' : 'LEGO Set',
        tags,
        handle,
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
        ...(imagesWithAlt.length > 0
          ? { images: imagesWithAlt }
          : {}),
        metafields,
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

  // ── CREATE (GROUP) ──────────────────────────────────────────────

  /**
   * Push a group of identical items (same set, condition, price) as a single
   * Shopify product with quantity = group size.
   *
   * Uses the first item as the "representative" for product data.
   * All items in the group get a shopify_products mapping row pointing
   * to the same shopify_product_id.
   */
  async createProductForGroup(
    inventoryItemIds: string[],
    quantity: number
  ): Promise<SyncResult> {
    if (inventoryItemIds.length === 0) {
      return { success: false, error: 'Empty group' };
    }

    // Use first item as representative — createProduct builds the payload
    const representativeId = inventoryItemIds[0];
    const client = await this.getClient();
    const config = this.getConfig();

    // Fetch representative item
    const { data: item, error: itemError } = await this.supabase
      .from('inventory_items')
      .select('*')
      .eq('id', representativeId)
      .single();

    if (itemError || !item) {
      return { success: false, error: `Item not found: ${representativeId}` };
    }

    // Check none already synced (only count non-error entries with a real product ID)
    const { data: existingAny } = await this.supabase
      .from('shopify_products')
      .select('id')
      .in('inventory_item_id', inventoryItemIds)
      .neq('shopify_product_id', '')
      .eq('sync_status', 'synced')
      .limit(1);

    if (existingAny && existingAny.length > 0) {
      return { success: false, error: 'One or more items already synced' };
    }

    // Get Brickset data
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

      if (!bricksetData && isMinifigure(item)) {
        const theme = getMinifigTheme(item.set_number);
        if (theme) {
          bricksetData = {
            set_number: item.set_number,
            theme,
            subtheme: null,
            pieces: null,
            minifigs: null,
            year_from: null,
            uk_retail_price: null,
          };
        }
      }
    }

    // Fetch eBay listing data
    let ebayListing = null;
    if (item.listing_platform === 'ebay' && item.ebay_listing_id) {
      ebayListing = await fetchEbayListing(item.ebay_listing_id);
    }

    // Resolve images
    const imageResult = await resolveImages(
      this.supabase,
      {
        id: item.id,
        set_number: item.set_number,
        item_name: item.item_name,
        ebay_listing_id: item.ebay_listing_id,
        listing_platform: item.listing_platform,
      },
      ebayListing
    );

    // Calculate pricing
    const minifig = isMinifigure(item);
    const priceResult = minifig
      ? { price: item.listing_value ?? 0, compare_at_price: null }
      : calculateShopifyPrice(item.listing_value ?? 0, config.default_discount_pct ?? 10);

    // AI description
    const aiDesc = item.set_number && item.set_number !== 'NA'
      ? await getOrGenerateAIDescription(this.supabase, item.id, item.set_number, {
          item_name: item.item_name,
          condition: item.condition,
          theme: bricksetData?.theme ?? null,
          subtheme: bricksetData?.subtheme ?? null,
          pieces: bricksetData?.pieces ?? null,
          minifigs: bricksetData?.minifigs ?? null,
          year: bricksetData?.year_from ?? null,
          rrp: bricksetData?.uk_retail_price ?? null,
        })
      : null;

    // Build product payload
    const ebayDesc = ebayListing?.description ?? null;
    const title = buildShopifyTitle(item, bricksetData, ebayDesc);
    const description = buildShopifyDescription(item, bricksetData, ebayDesc, aiDesc);
    const tags = buildShopifyTags(item, bricksetData, ebayDesc);
    const metafields = buildMetafields(item, bricksetData);
    const handle = buildHandle(item, title, priceResult.price);

    // Add SEO meta description (plain text, max 160 chars)
    const seoDesc = buildSeoDescription(item, bricksetData);
    metafields.push({
      namespace: 'global',
      key: 'description_tag',
      value: seoDesc,
      type: 'single_line_text_field',
    });

    // Add alt text to images
    const imagesWithAlt = addImageAltText(imageResult.images, title, item.set_number);

    const payload: ShopifyProductPayload = {
      product: {
        title,
        body_html: description,
        vendor: 'LEGO',
        product_type: minifig ? 'Minifigure' : 'LEGO Set',
        tags,
        handle,
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
        ...(imagesWithAlt.length > 0
          ? { images: imagesWithAlt }
          : {}),
        metafields,
      },
    };

    try {
      const response = await client.createProduct(payload);
      const product = response.product;
      const variant = product.variants[0];

      // Set inventory level to GROUP SIZE (not 1)
      if (config.location_id && variant?.inventory_item_id) {
        try {
          await client.setInventoryLevel(
            String(variant.inventory_item_id),
            config.location_id,
            quantity
          );
        } catch (invErr) {
          console.warn(`[ShopifySync] Failed to set inventory for group ${item.set_number}:`, invErr);
        }
      }

      // Save a mapping row for EACH item in the group (upsert to handle pre-existing error rows)
      const mappingRows = inventoryItemIds.map((iid) => ({
        user_id: this.userId,
        inventory_item_id: iid,
        shopify_product_id: String(product.id),
        shopify_variant_id: variant ? String(variant.id) : null,
        shopify_inventory_item_id: variant ? String(variant.inventory_item_id) : null,
        shopify_handle: product.handle,
        shopify_status: product.status,
        shopify_price: priceResult.price,
        shopify_compare_at_price: priceResult.compare_at_price,
        shopify_title: title,
        shopify_description: description,
        image_source: imageResult.source,
        image_urls: imageResult.urls,
        last_synced_at: new Date().toISOString(),
        sync_status: 'synced' as const,
      }));

      await this.supabase
        .from('shopify_products')
        .upsert(mappingRows, { onConflict: 'inventory_item_id' });

      return { success: true, shopifyProductId: String(product.id) };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      // Record error for representative item
      await this.supabase.from('shopify_products').upsert(
        {
          user_id: this.userId,
          inventory_item_id: representativeId,
          shopify_product_id: '',
          sync_status: 'error',
          sync_error: errorMsg.substring(0, 500),
        },
        { onConflict: 'inventory_item_id' }
      );

      return { success: false, error: errorMsg };
    }
  }

  // ── ADD TO EXISTING GROUP ────────────────────────────────────

  /**
   * Add new inventory items to an existing Shopify product group.
   *
   * When items share the same (set_number, condition, listing_value) as items
   * already synced to a Shopify product, this method:
   * 1. Inserts mapping rows for the new items (same shopify_product_id)
   * 2. Updates the Shopify inventory quantity to the new total
   */
  async addItemsToExistingGroup(
    newItemIds: string[],
    existingProductId: string
  ): Promise<SyncResult> {
    if (newItemIds.length === 0) {
      return { success: false, error: 'No new items to add' };
    }

    const client = await this.getClient();
    const config = this.getConfig();

    // Look up the existing mapping to get variant/inventory IDs
    const { data: existingMapping, error: mapError } = await this.supabase
      .from('shopify_products')
      .select('*')
      .eq('shopify_product_id', existingProductId)
      .eq('sync_status', 'synced')
      .limit(1)
      .single();

    if (mapError || !existingMapping) {
      return { success: false, error: `No synced mapping found for product ${existingProductId}` };
    }

    // Count total items that will be in the group after adding new ones
    const { count: existingCount } = await this.supabase
      .from('shopify_products')
      .select('id', { count: 'exact', head: true })
      .eq('shopify_product_id', existingProductId)
      .eq('sync_status', 'synced');

    const newTotal = (existingCount ?? 0) + newItemIds.length;

    try {
      // Insert mapping rows for new items (upsert to handle pre-existing error rows)
      const mappingRows = newItemIds.map((iid) => ({
        user_id: this.userId,
        inventory_item_id: iid,
        shopify_product_id: existingMapping.shopify_product_id,
        shopify_variant_id: existingMapping.shopify_variant_id,
        shopify_inventory_item_id: existingMapping.shopify_inventory_item_id,
        shopify_handle: existingMapping.shopify_handle,
        shopify_status: existingMapping.shopify_status,
        shopify_price: existingMapping.shopify_price,
        shopify_compare_at_price: existingMapping.shopify_compare_at_price,
        shopify_title: existingMapping.shopify_title,
        shopify_description: existingMapping.shopify_description,
        image_source: existingMapping.image_source,
        image_urls: existingMapping.image_urls,
        last_synced_at: new Date().toISOString(),
        sync_status: 'synced' as const,
      }));

      await this.supabase
        .from('shopify_products')
        .upsert(mappingRows, { onConflict: 'inventory_item_id' });

      // Update Shopify inventory quantity
      if (config.location_id && existingMapping.shopify_inventory_item_id) {
        await client.setInventoryLevel(
          existingMapping.shopify_inventory_item_id,
          config.location_id,
          newTotal
        );
      }

      return { success: true, shopifyProductId: existingProductId };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
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
      items_added_to_group: 0,
      items_updated: 0,
      items_archived: 0,
      items_failed: 0,
      errors: [],
      duration_ms: 0,
    };

    await this.getClient();

    // 1. Archive/decrement products for items no longer LISTED
    const { data: toArchive } = await this.supabase
      .from('shopify_products')
      .select('inventory_item_id, shopify_product_id, shopify_status, shopify_inventory_item_id, inventory_items!inner(status)')
      .eq('user_id', this.userId)
      .neq('shopify_status', 'archived')
      .neq('inventory_items.status', 'LISTED');

    if (toArchive) {
      for (const item of toArchive) {
        summary.items_processed++;

        // Check if this is a grouped product with LISTED siblings
        const { data: listedSiblings } = await this.supabase
          .from('shopify_products')
          .select('id, shopify_inventory_item_id')
          .eq('shopify_product_id', item.shopify_product_id)
          .neq('inventory_item_id', item.inventory_item_id)
          .eq('shopify_status', 'active');

        // Count how many siblings are still LISTED in inventory
        let activeSiblingCount = 0;
        if (listedSiblings && listedSiblings.length > 0) {
          const siblingIds = listedSiblings.map((s) => s.id);
          const { data: listedItems } = await this.supabase
            .from('shopify_products')
            .select('inventory_item_id, inventory_items!inner(status)')
            .in('id', siblingIds)
            .eq('inventory_items.status', 'LISTED');
          activeSiblingCount = listedItems?.length ?? 0;
        }

        if (activeSiblingCount > 0) {
          // Grouped product with active siblings — just mark this mapping as archived
          // and decrement inventory quantity instead of archiving the whole product
          try {
            await this.supabase
              .from('shopify_products')
              .update({
                shopify_status: 'archived',
                sync_status: 'synced',
                last_synced_at: new Date().toISOString(),
              })
              .eq('inventory_item_id', item.inventory_item_id);

            // Decrement Shopify inventory to reflect the remaining LISTED count
            const config = this.getConfig();
            if (config.location_id && item.shopify_inventory_item_id) {
              const client = await this.getClient();
              await client.setInventoryLevel(
                item.shopify_inventory_item_id,
                config.location_id,
                activeSiblingCount
              );
            }

            summary.items_archived++;
            console.log(
              `[ShopifySync] Decremented group product ${item.shopify_product_id}: removed sold item, ${activeSiblingCount} remain`
            );
          } catch (err) {
            summary.items_failed++;
            summary.errors.push({
              item_id: item.inventory_item_id,
              error: `Group decrement failed: ${err instanceof Error ? err.message : String(err)}`,
            });
          }
        } else {
          // No active siblings — archive the entire Shopify product
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
    }

    // 2. Create products for LISTED items not yet on Shopify (with grouping)
    const { data: existingMappings } = await this.supabase
      .from('shopify_products')
      .select('inventory_item_id')
      .eq('user_id', this.userId);

    const existingIds = new Set(existingMappings?.map((m) => m.inventory_item_id) || []);

    // Fetch unsynced LISTED items with grouping fields (paginate for >1000)
    const pageSize = 1000;
    let page = 0;
    let hasMore = true;
    const unsyncedItems: Array<{
      id: string;
      set_number: string | null;
      condition: string | null;
      listing_value: number | null;
    }> = [];

    while (hasMore) {
      const { data } = await this.supabase
        .from('inventory_items')
        .select('id, set_number, condition, listing_value')
        .eq('user_id', this.userId)
        .eq('status', 'LISTED')
        .not('set_number', 'is', null)
        .neq('set_number', 'NA')
        .order('created_at', { ascending: true })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      for (const item of data ?? []) {
        if (!existingIds.has(item.id)) {
          unsyncedItems.push(item);
        }
      }
      hasMore = (data?.length ?? 0) === pageSize;
      page++;
    }

    // Group by (set_number, condition, listing_value)
    const groups = new Map<string, typeof unsyncedItems>();
    for (const item of unsyncedItems) {
      const key = `${item.set_number}|${(item.condition ?? 'N').toUpperCase()}|${item.listing_value ?? 0}`;
      const group = groups.get(key);
      if (group) {
        group.push(item);
      } else {
        groups.set(key, [item]);
      }
    }

    // Process up to `limit` groups
    let groupsProcessed = 0;
    for (const [key, group] of groups) {
      if (groupsProcessed >= limit) break;
      groupsProcessed++;

      const ids = group.map((g) => g.id);
      const rep = group[0];

      // Check if any sibling with the same key is already synced
      const { data: syncedSiblings } = await this.supabase
        .from('shopify_products')
        .select('shopify_product_id, inventory_items!inner(set_number, condition, listing_value)')
        .eq('user_id', this.userId)
        .eq('sync_status', 'synced')
        .neq('shopify_product_id', '')
        .eq('inventory_items.set_number', rep.set_number!)
        .eq('inventory_items.condition', rep.condition!)
        .eq('inventory_items.listing_value', rep.listing_value!)
        .limit(1);

      const existingProductId = syncedSiblings?.[0]?.shopify_product_id;

      let result: SyncResult;

      if (existingProductId) {
        // Add to existing group
        result = await this.addItemsToExistingGroup(ids, existingProductId);
        if (result.success) {
          summary.items_added_to_group += ids.length;
        }
      } else if (ids.length === 1) {
        // New single item
        result = await this.createProduct(ids[0]);
        if (result.success) {
          summary.items_created++;
        }
      } else {
        // New group
        result = await this.createProductForGroup(ids, ids.length);
        if (result.success) {
          summary.items_created++;
        }
      }

      summary.items_processed += ids.length;

      if (!result.success) {
        summary.items_failed += ids.length;
        summary.errors.push({
          item_id: ids[0],
          error: result.error || `Failed to sync group ${key}`,
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
      items_added_to_group: 0,
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

// ── Helpers ─────────────────────────────────────────────────

/** BrickLink-style minifigure set_number prefixes */
const MINIFIG_PREFIXES = [
  'sw', 'col', 'coltlbm', 'coltlnm', 'colhp', 'colmar', 'coldis',
  'colsh', 'coltgb', 'fig', 'gen', 'hp', 'iaj', 'jw', 'loc', 'lor',
  'njo', 'poc', 'pot', 'sh', 'scd', 'tnt', 'tlm', 'sim',
];

/** Map BrickLink minifig prefix → LEGO theme name */
const MINIFIG_PREFIX_TO_THEME: Record<string, string> = {
  sw: 'Star Wars',
  hp: 'Harry Potter',
  colhp: 'Harry Potter',
  njo: 'Ninjago',
  sh: 'Super Heroes',
  colsh: 'Super Heroes',
  lor: 'The Lord of the Rings',
  loc: 'Legends of Chima',
  jw: 'Jurassic World',
  poc: 'Pirates of the Caribbean',
  iaj: 'Indiana Jones',
  tlm: 'The LEGO Movie',
  coltlbm: 'The LEGO Batman Movie',
  coltlnm: 'The LEGO Ninjago Movie',
  sim: 'The Simpsons',
  col: 'Collectable Minifigures',
  colmar: 'Marvel',
  coldis: 'Disney',
  coltgb: 'Team GB',
  scd: 'Scooby-Doo',
  tnt: 'Teenage Mutant Ninja Turtles',
  pot: 'Prince of Persia',
  fig: 'Minifigures',
  gen: 'Miscellaneous',
};

/**
 * Detect whether an inventory item is a minifigure (vs a set).
 * Checks set_number prefix patterns and item_name keywords.
 */
function isMinifigure(item: { set_number: string | null; item_name: string | null }): boolean {
  // Check set_number prefix first (most reliable indicator)
  const setNum = (item.set_number ?? '').toLowerCase();
  if (MINIFIG_PREFIXES.some((p) => setNum.startsWith(p) && /^[a-z]+\d/.test(setNum))) {
    return true;
  }

  // Name-based detection: only classify as minifigure if the name indicates it IS a
  // minifigure product, not just a set that includes minifigures
  const name = (item.item_name ?? '').toLowerCase();
  const hasMinifigWord = name.includes('minifigure') || name.includes('minifig');
  if (!hasMinifigWord) return false;

  // If the name also contains set-type words, it's a set that mentions minifigs, not a minifig itself
  const setIndicators = [' set', 'building toy', 'playset', 'building game', 'building kit',
    'starter pack', 'bundle', 'display', 'diorama', 'modular'];
  if (setIndicators.some((s) => name.includes(s))) return false;

  return true;
}

/**
 * Get LEGO theme name from a BrickLink-style minifig set_number.
 * e.g. "SW0810" → "Star Wars", "hp394" → "Harry Potter"
 */
function getMinifigTheme(setNumber: string): string | null {
  const lower = setNumber.toLowerCase();
  // Try longest prefixes first (coltlbm before col)
  const sorted = Object.keys(MINIFIG_PREFIX_TO_THEME).sort((a, b) => b.length - a.length);
  for (const prefix of sorted) {
    if (lower.startsWith(prefix)) {
      return MINIFIG_PREFIX_TO_THEME[prefix];
    }
  }
  return null;
}

/**
 * Build a unique Shopify handle (URL slug) for a product.
 * Includes set_number and condition to avoid collisions when the same set
 * exists in both New and Used conditions.
 */
function buildHandle(
  item: { set_number: string | null; condition: string | null },
  title: string,
  price?: number
): string {
  // Slugify the title
  let handle = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  // Ensure condition is in the handle
  const cond = (item.condition ?? 'new').toLowerCase();
  if (!handle.includes(cond)) {
    handle += `-${cond}`;
  }

  // Append price to handle to differentiate same-set/condition at different prices
  if (price != null) {
    // Format as e.g. "36-99" for £36.99
    const priceSlug = price.toFixed(2).replace('.', '-');
    handle += `-${priceSlug}`;
  }

  return handle;
}

/**
 * Build product metafields for storefront filtering.
 * Creates: theme, year, condition (price range is built into Shopify).
 */
function buildMetafields(
  item: { condition: string | null; set_number?: string | null },
  bricksetData?: { theme: string | null; subtheme: string | null; year_from: number | null } | null
): Array<{ namespace: string; key: string; value: string; type: string }> {
  const metafields: Array<{ namespace: string; key: string; value: string; type: string }> = [];

  // Theme
  if (bricksetData?.theme) {
    metafields.push({
      namespace: 'custom',
      key: 'theme',
      value: bricksetData.theme,
      type: 'single_line_text_field',
    });
  }

  // Subtheme
  if (bricksetData?.subtheme) {
    metafields.push({
      namespace: 'custom',
      key: 'subtheme',
      value: bricksetData.subtheme,
      type: 'single_line_text_field',
    });
  }

  // Year
  if (bricksetData?.year_from) {
    metafields.push({
      namespace: 'custom',
      key: 'year',
      value: String(bricksetData.year_from),
      type: 'number_integer',
    });
  }

  // Condition
  const isUsed =
    item.condition?.toLowerCase() === 'used' ||
    item.condition?.toLowerCase() === 'u';
  metafields.push({
    namespace: 'custom',
    key: 'condition',
    value: isUsed ? 'Used' : 'New',
    type: 'single_line_text_field',
  });

  // Set number (MPN) — used by Shopify for Product schema `mpn` field
  if (item.set_number && item.set_number !== 'NA') {
    const displayNumber = item.set_number.replace(/-1$/, '');
    metafields.push({
      namespace: 'custom',
      key: 'set_number',
      value: displayNumber,
      type: 'single_line_text_field',
    });
  }

  return metafields;
}

/**
 * Position-based alt text suffixes for product images.
 * Provides unique, descriptive alt text for each image position.
 */
const IMAGE_ALT_SUFFIXES = [
  'box front',
  'built set',
  'minifigures',
  'set details',
  'alternate view',
  'close-up',
  'rear view',
  'play features',
  'contents',
  'side view',
];

/**
 * Add unique alt text to each product image based on position.
 * Prevents Shopify from defaulting all images to the product title.
 */
function addImageAltText(
  images: Array<{ src?: string; attachment?: string; filename?: string }>,
  productTitle: string,
  setNumber: string | null
): Array<{ src?: string; attachment?: string; filename?: string; alt?: string }> {
  const setNum = setNumber && setNumber !== 'NA'
    ? setNumber.replace(/-1$/, '')
    : null;

  return images.map((img, i) => {
    const suffix = IMAGE_ALT_SUFFIXES[i] ?? `view ${i + 1}`;
    const alt = setNum
      ? `${productTitle} - ${suffix}`
      : `${productTitle} - ${suffix}`;
    return { ...img, alt };
  });
}
