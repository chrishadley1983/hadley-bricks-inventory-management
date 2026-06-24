import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { fetchAllRecords } from '@/lib/supabase/pagination';
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
  DedupeSummary,
  ReconcileSummary,
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

  // ── DEDUP GUARD ───────────────────────────────────────────────

  /**
   * Adopt an existing Shopify product instead of creating a duplicate.
   *
   * A product for `variantSku` can already exist on Shopify even when our
   * mapping table has no row for these items — e.g. the inventory item was
   * deleted & re-created (minifig-sync re-pull / set re-import), cascading away
   * the old `shopify_products` row while the Shopify product itself survived.
   * Creating again would leave a second, orphaned product (the ghost
   * "Sold out" card). When such a product exists we refresh + re-activate it
   * and (re)link the mapping for every passed item.
   *
   * Returns a SyncResult when it adopted (or failed to), or `null` when no
   * existing product was found — signalling the caller to create normally.
   * Handle + metafields are intentionally left untouched (URL stability +
   * avoiding duplicate metafield creation on a REST product update).
   */
  private async adoptExistingBySku(
    client: ShopifyClient,
    config: ShopifyConfig,
    inventoryItemIds: string[],
    variantSku: string,
    quantity: number,
    built: {
      title: string;
      description: string;
      tags: string;
      price: number;
      compareAt: number | null;
      imageSource: string;
      imageUrls: string[];
    }
  ): Promise<SyncResult | null> {
    let existing: Awaited<ReturnType<ShopifyClient['findProductsBySku']>>;
    try {
      existing = await client.findProductsBySku(variantSku);
    } catch (err) {
      // A lookup failure must never block creation — fall through to create.
      console.warn(`[ShopifySync] SKU dedup lookup failed for ${variantSku}:`, err);
      return null;
    }
    if (existing.length === 0) return null;

    // SKU is NOT a stable identity — distinct items can share a SKU (e.g. a real
    // set vs an unmapped placeholder). Only ever adopt a GENUINELY ORPHANED
    // product: drop any candidate that already has a mapping row pointing at a
    // DIFFERENT inventory item, so we never overwrite/relink a product that
    // belongs to someone else. If nothing orphaned remains, create our own.
    const idSet = new Set(inventoryItemIds);
    const { data: candidateMaps } = await this.supabase
      .from('shopify_products')
      .select('shopify_product_id, inventory_item_id')
      .eq('user_id', this.userId)
      .in(
        'shopify_product_id',
        existing.map((p) => p.productId)
      );
    const mappedElsewhere = new Set<string>();
    for (const m of candidateMaps ?? []) {
      if (m.shopify_product_id && m.inventory_item_id && !idSet.has(m.inventory_item_id)) {
        mappedElsewhere.add(String(m.shopify_product_id));
      }
    }
    const orphans = existing.filter((p) => !mappedElsewhere.has(p.productId));
    if (orphans.length === 0) return null; // every match belongs to another item

    // Prefer an already-active orphan; otherwise adopt the first.
    const target = orphans.find((p) => p.status === 'ACTIVE') ?? orphans[0];

    try {
      await client.updateProduct(target.productId, {
        title: built.title,
        body_html: built.description,
        tags: built.tags,
        status: 'active',
      });
      if (target.variantId) {
        await client.updateVariant(target.variantId, {
          price: formatShopifyPrice(built.price),
          // Always send compare_at_price so a null value actively CLEARS any
          // stale strike-through left on the adopted product (mirrors updatePrice).
          compare_at_price: built.compareAt != null ? formatShopifyPrice(built.compareAt) : '',
          sku: variantSku,
        });
      }
      if (config.location_id && target.inventoryItemId) {
        await client.setInventoryLevel(target.inventoryItemId, config.location_id, quantity);
      }

      const now = new Date().toISOString();
      const mappingRows = inventoryItemIds.map((iid) => ({
        user_id: this.userId,
        inventory_item_id: iid,
        shopify_product_id: target.productId,
        shopify_variant_id: target.variantId,
        shopify_inventory_item_id: target.inventoryItemId,
        shopify_status: 'active',
        shopify_price: built.price,
        shopify_compare_at_price: built.compareAt,
        shopify_title: built.title,
        shopify_description: built.description,
        image_source: built.imageSource,
        image_urls: built.imageUrls,
        last_synced_at: now,
        sync_status: 'synced' as const,
      }));
      await this.supabase
        .from('shopify_products')
        .upsert(mappingRows, { onConflict: 'inventory_item_id' });

      return { success: true, shopifyProductId: target.productId, adopted: true };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `adopt-by-sku failed: ${errorMsg}` };
    }
  }

  /**
   * Archive untracked orphan duplicate products.
   *
   * Belt-and-braces partner to {@link adoptExistingBySku}: scans every live
   * product, groups by first-variant SKU, and for any SKU with more than one
   * product archives the redundant UNTRACKED ones — always keeping the tracked
   * product (or, if none is tracked, the active in-stock one). It only ever
   * archives; it never deletes, never un-archives, and never touches a product
   * that has a `shopify_products` mapping row.
   */
  async dedupeBySku(): Promise<DedupeSummary> {
    const client = await this.getClient();
    const summary: DedupeSummary = {
      products_scanned: 0,
      duplicate_skus: 0,
      archived: 0,
      failed: 0,
      actions: [],
      errors: [],
    };

    const products = await client.getProducts({ fields: 'id,title,status,variants' });
    summary.products_scanned = products.length;

    // Tracked product ids — never archive these.
    const mappings = (await fetchAllRecords(this.supabase, 'shopify_products', {
      select: 'shopify_product_id',
      eq: { user_id: this.userId },
      isNotNull: ['shopify_product_id'],
    })) as unknown as Array<{ shopify_product_id: string | null }>;
    const tracked = new Set<string>();
    for (const m of mappings) if (m.shopify_product_id) tracked.add(String(m.shopify_product_id));

    // Group products by first-variant SKU.
    const bySku = new Map<string, typeof products>();
    for (const p of products) {
      const sku = p.variants?.[0]?.sku;
      if (!sku) continue;
      const arr = bySku.get(sku);
      if (arr) arr.push(p);
      else bySku.set(sku, [p]);
    }

    const inv = (p: (typeof products)[number]) => p.variants?.[0]?.inventory_quantity ?? 0;

    for (const [sku, group] of bySku) {
      if (group.length < 2) continue;
      summary.duplicate_skus++;

      const trackedInGroup = group.filter((p) => tracked.has(String(p.id)));
      const keeper =
        trackedInGroup.find((p) => p.status === 'active') ??
        trackedInGroup[0] ??
        group.find((p) => p.status === 'active' && inv(p) > 0) ??
        group.find((p) => p.status === 'active') ??
        group[0];

      for (const p of group) {
        if (String(p.id) === String(keeper.id)) continue;
        if (tracked.has(String(p.id))) continue; // never archive a tracked product
        if (p.status === 'archived') continue; // already hidden
        try {
          await client.archiveProduct(String(p.id));
          summary.archived++;
          summary.actions.push({
            sku,
            archived_product_id: String(p.id),
            kept_product_id: String(keeper.id),
          });
        } catch (err) {
          summary.failed++;
          summary.errors.push({ sku, error: err instanceof Error ? err.message : String(err) });
        }
      }
    }

    return summary;
  }

  // ── RECONCILE QUANTITIES ──────────────────────────────────────

  /**
   * Clamp every active Shopify variant down to the true number of units we own
   * and have LISTED. Guards against the overstatement that allows oversell:
   * a used single is physically unique, so any qty > 1 is wrong, and a grouped
   * sealed product must never show more than its LISTED member count.
   *
   * The true count is derived from the `shopify_products` mapping where one
   * exists, and otherwise (orphan products with no mapping) by matching the
   * variant SKU back to LISTED `inventory_items` — by SKU, or by id-prefix for
   * SKU-less items whose Shopify SKU is `id.substring(0,8)`. Only ever reduces.
   */
  async reconcileInventoryQuantities(): Promise<ReconcileSummary> {
    const client = await this.getClient();
    const config = this.getConfig();
    const summary: ReconcileSummary = {
      products_scanned: 0,
      variants_scanned: 0,
      overstated_found: 0,
      reduced: 0,
      failed: 0,
      reductions: [],
      errors: [],
    };

    if (!config.location_id) {
      summary.errors.push({ sku: null, error: 'No location_id configured' });
      return summary;
    }

    // 1. Mapped LISTED counts per Shopify product id.
    const mappedListed = new Map<string, number>();
    const mappedPids = new Set<string>();
    const mappings = (await fetchAllRecords(this.supabase, 'shopify_products', {
      select: 'shopify_product_id, inventory_items(status)',
      eq: { user_id: this.userId },
      isNotNull: ['shopify_product_id'],
    })) as unknown as Array<{
      shopify_product_id: string | null;
      inventory_items: { status: string | null } | null;
    }>;
    for (const m of mappings) {
      if (!m.shopify_product_id) continue;
      const k = String(m.shopify_product_id);
      mappedPids.add(k);
      mappedListed.set(k, (mappedListed.get(k) ?? 0) + (m.inventory_items?.status === 'LISTED' ? 1 : 0));
    }

    // 2. LISTED inventory indexed by sku and by id-prefix (for orphan resolution).
    const listedBySku = new Map<string, number>();
    const listedByIdPrefix = new Map<string, number>();
    const listedItems = (await fetchAllRecords(this.supabase, 'inventory_items', {
      select: 'id, sku',
      eq: { user_id: this.userId, status: 'LISTED' },
    })) as unknown as Array<{ id: string; sku: string | null }>;
    for (const it of listedItems) {
      if (it.sku) listedBySku.set(it.sku, (listedBySku.get(it.sku) ?? 0) + 1);
      const pre = String(it.id).slice(0, 8);
      listedByIdPrefix.set(pre, (listedByIdPrefix.get(pre) ?? 0) + 1);
    }

    const isHex8 = (s: string) => /^[0-9a-f]{8}$/.test(s);
    const resolveTarget = (pid: string, sku: string | null): number => {
      if (mappedPids.has(pid)) return mappedListed.get(pid) ?? 0;
      if (!sku) return 0;
      return isHex8(sku) ? (listedByIdPrefix.get(sku) ?? 0) : (listedBySku.get(sku) ?? 0);
    };

    // 3. Scan live products and clamp overstated active variants.
    const products = await client.getProducts({
      fields: 'id,title,status,variants',
    });
    summary.products_scanned = products.length;

    for (const product of products) {
      const pid = String(product.id);
      for (const variant of product.variants ?? []) {
        summary.variants_scanned++;
        const qty = variant.inventory_quantity ?? 0;
        if (product.status !== 'active' || qty <= 1) continue;
        const target = resolveTarget(pid, variant.sku);
        if (target >= qty) continue; // not overstated (or we'd be increasing)
        summary.overstated_found++;
        try {
          await client.setInventoryLevel(
            String(variant.inventory_item_id),
            config.location_id,
            target
          );
          summary.reduced++;
          summary.reductions.push({ sku: variant.sku, from: qty, to: target, mapped: mappedPids.has(pid) });
        } catch (err) {
          summary.failed++;
          summary.errors.push({
            sku: variant.sku,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    return summary;
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

    // Don't publish a £0 product — hold until it has a real listing_value. Both
    // discounted sets and no-discount minifigs derive their price from listing_value,
    // so a null/0 value would otherwise create a free, purchasable Shopify product.
    if (!item.listing_value || item.listing_value <= 0) {
      return {
        success: false,
        skipped: true,
        error: 'Held: item has no listing_value (would publish £0)',
      };
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
    const aiDesc =
      item.set_number && item.set_number !== 'NA'
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
    const variantSku = item.sku ?? item.id.substring(0, 8);

    // Dedup guard: adopt an existing Shopify product for this SKU instead of
    // creating a duplicate (orphaned product left behind by a deleted/re-created
    // inventory item). Returns null when nothing exists → create normally.
    const adopted = await this.adoptExistingBySku(client, config, [item.id], variantSku, 1, {
      title,
      description,
      tags,
      price: priceResult.price,
      compareAt: priceResult.compare_at_price,
      imageSource: imageResult.source,
      imageUrls: imageResult.urls,
    });
    if (adopted) return adopted;

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
            sku: variantSku,
            inventory_management: 'shopify',
            requires_shipping: true,
          },
        ],
        ...(imagesWithAlt.length > 0 ? { images: imagesWithAlt } : {}),
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
          await client.setInventoryLevel(String(variant.inventory_item_id), config.location_id, 1);
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
  async createProductForGroup(inventoryItemIds: string[], quantity: number): Promise<SyncResult> {
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

    // Don't publish a £0 product — hold until priced (see createProduct).
    if (!item.listing_value || item.listing_value <= 0) {
      return {
        success: false,
        skipped: true,
        error: 'Held: representative item has no listing_value (would publish £0)',
      };
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
    const aiDesc =
      item.set_number && item.set_number !== 'NA'
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
    const variantSku = item.sku ?? item.id.substring(0, 8);

    // Add SEO meta description (plain text, max 160 chars)
    const seoDesc = buildSeoDescription(item, bricksetData);
    metafields.push({
      namespace: 'global',
      key: 'description_tag',
      value: seoDesc,
      type: 'single_line_text_field',
    });

    // Dedup guard: adopt an existing Shopify product for this SKU (set inventory
    // to the full group size) rather than creating a duplicate.
    const adopted = await this.adoptExistingBySku(
      client,
      config,
      inventoryItemIds,
      variantSku,
      quantity,
      {
        title,
        description,
        tags,
        price: priceResult.price,
        compareAt: priceResult.compare_at_price,
        imageSource: imageResult.source,
        imageUrls: imageResult.urls,
      }
    );
    if (adopted) return adopted;

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
            sku: variantSku,
            inventory_management: 'shopify',
            requires_shipping: true,
          },
        ],
        ...(imagesWithAlt.length > 0 ? { images: imagesWithAlt } : {}),
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
          console.warn(
            `[ShopifySync] Failed to set inventory for group ${item.set_number}:`,
            invErr
          );
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
        .select('listing_value, set_number, item_name')
        .eq('id', inventoryItemId)
        .single();

      if (item?.listing_value && item.listing_value > 0) {
        // Minifigures use the exact listing value (no direct-sale discount), matching
        // createProduct — otherwise the recompute would wrongly discount them.
        if (isMinifigure(item)) {
          newPrice = item.listing_value;
          newCompareAt = null;
        } else {
          const priceResult = calculateShopifyPrice(
            item.listing_value,
            config.default_discount_pct ?? 10
          );
          newPrice = priceResult.price;
          newCompareAt = priceResult.compare_at_price;
        }
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

  /**
   * Propagate listing_value changes (markdowns, corrections) to Shopify. The create
   * flow is one-shot, so without this Shopify prices freeze at creation while the
   * markdown engine keeps moving listing_value. Reprices any active product whose live
   * Shopify price has drifted from the price its current listing_value implies. Never
   * reprices toward £0 — price-less items are handled by the create-time hold.
   */
  async reconcilePrices(limit = 250): Promise<{
    checked: number;
    updated: number;
    failed: number;
    errors: Array<{ item_id: string; error: string }>;
  }> {
    const config = this.getConfig();
    const discount = config.default_discount_pct ?? 10;
    const out = {
      checked: 0,
      updated: 0,
      failed: 0,
      errors: [] as Array<{ item_id: string; error: string }>,
    };

    let from = 0;
    const page = 1000;
    for (;;) {
      const { data: rows, error } = await this.supabase
        .from('shopify_products')
        .select(
          'inventory_item_id, shopify_price, inventory_items!inner(listing_value, set_number, item_name, status)'
        )
        .eq('user_id', this.userId)
        .eq('shopify_status', 'active')
        .eq('inventory_items.status', 'LISTED')
        .range(from, from + page - 1);

      if (error || !rows || rows.length === 0) break;

      for (const row of rows) {
        // inventory_items is a to-one relation (object), but generated types widen it.
        const inv = (row as unknown as {
          inventory_items: { listing_value: number | null; set_number: string | null; item_name: string | null };
        }).inventory_items;
        const lv = inv?.listing_value ?? 0;
        if (lv <= 0) continue; // never reprice toward £0

        out.checked++;
        const expected = isMinifigure(inv)
          ? lv
          : calculateShopifyPrice(lv, discount).price;
        const current = Number(row.shopify_price) || 0;
        if (Math.abs(expected - current) < 0.01) continue;

        if (out.updated >= limit) return out;
        const res = await this.updatePrice(row.inventory_item_id as string);
        if (res.success) {
          out.updated++;
        } else {
          out.failed++;
          out.errors.push({
            item_id: row.inventory_item_id as string,
            error: res.error || 'updatePrice failed',
          });
        }
      }

      if (rows.length < page) break;
      from += page;
    }
    return out;
  }

  // ── BATCH SYNC ────────────────────────────────────────────────

  /**
   * Sync all eligible items to Shopify.
   * Creates products for LISTED items not yet on Shopify,
   * archives products for items no longer LISTED.
   */
  /**
   * Re-activate Shopify products that are archived in our mapping but whose
   * inventory item is LISTED again (e.g. restocked / wrongly archived). Sets the
   * product back to active, restores quantity to the LISTED-mapped count, and
   * marks the mapping active. Skips products that already have an active mapping.
   */
  private async reactivateRelistedProducts(summary: BatchSyncSummary): Promise<void> {
    const { data: rows } = await this.supabase
      .from('shopify_products')
      .select('shopify_product_id, shopify_inventory_item_id, inventory_items!inner(status)')
      .eq('user_id', this.userId)
      .eq('shopify_status', 'archived')
      .eq('inventory_items.status', 'LISTED');
    if (!rows || rows.length === 0) return;

    const byProduct = new Map<string, string | null>();
    for (const r of rows as Array<{ shopify_product_id: string | null; shopify_inventory_item_id: string | null }>) {
      if (r.shopify_product_id && !byProduct.has(r.shopify_product_id)) {
        byProduct.set(r.shopify_product_id, r.shopify_inventory_item_id);
      }
    }

    const client = await this.getClient();
    const config = this.getConfig();

    let processed = 0;
    for (const [pid, invItem] of byProduct) {
      if (processed >= 100) break; // safety cap
      processed++;
      // Skip if the product already has an active mapping (handled elsewhere).
      const { count: activeCount } = await this.supabase
        .from('shopify_products')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', this.userId)
        .eq('shopify_product_id', pid)
        .eq('shopify_status', 'active');
      if ((activeCount ?? 0) > 0) continue;

      // LISTED items mapped to this product (drives both qty and which mapping
      // rows we re-activate).
      const { data: listedRows } = await this.supabase
        .from('shopify_products')
        .select('inventory_item_id, inventory_items!inner(status)')
        .eq('user_id', this.userId)
        .eq('shopify_product_id', pid)
        .eq('inventory_items.status', 'LISTED');
      const listedMappingIds = (listedRows || [])
        .map((r: { inventory_item_id: string | null }) => r.inventory_item_id)
        .filter((id: string | null): id is string => !!id);
      if (listedMappingIds.length === 0) continue;
      const qty = Math.max(1, listedMappingIds.length);

      try {
        await client.updateProduct(pid, { status: 'active' });
        if (config.location_id && invItem) {
          await client.setInventoryLevel(invItem, config.location_id, qty);
        }
        // Only mark the LISTED items' mappings active — NOT sold siblings of a
        // grouped product, which must stay archived (else the archive step and
        // this step flip-flop on every run).
        await this.supabase
          .from('shopify_products')
          .update({ shopify_status: 'active', sync_status: 'synced', last_synced_at: new Date().toISOString() })
          .eq('user_id', this.userId)
          .eq('shopify_product_id', pid)
          .in('inventory_item_id', listedMappingIds);
        summary.items_reactivated = (summary.items_reactivated ?? 0) + 1;
        summary.items_processed += listedMappingIds.length;
      } catch (err) {
        summary.items_failed++;
        summary.errors.push({
          item_id: pid,
          error: `Reactivate failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  async batchSync(limit = 50): Promise<BatchSyncSummary> {
    const startTime = Date.now();
    const summary: BatchSyncSummary = {
      items_processed: 0,
      items_created: 0,
      items_added_to_group: 0,
      items_updated: 0,
      items_archived: 0,
      items_reactivated: 0,
      items_failed: 0,
      errors: [],
      duration_ms: 0,
    };

    await this.getClient();

    // 1. Archive/decrement products for items no longer LISTED
    const { data: toArchive } = await this.supabase
      .from('shopify_products')
      .select(
        'inventory_item_id, shopify_product_id, shopify_status, shopify_inventory_item_id, inventory_items!inner(status)'
      )
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

    // 1b. Re-activate archived products whose item is LISTED again. The create
    // step below skips any item that already has a mapping (active OR archived),
    // so a re-listed item with an archived mapping would otherwise stay off
    // Shopify forever.
    await this.reactivateRelistedProducts(summary);

    // 2. Create products for LISTED items not yet on Shopify (with grouping)
    const { data: existingMappings } = await this.supabase
      .from('shopify_products')
      .select('inventory_item_id')
      .eq('user_id', this.userId);

    const existingIds = new Set(existingMappings?.map((m) => m.inventory_item_id) || []);

    // Fetch unsynced LISTED items with grouping fields (paginate for >1000)
    const unsyncedItems: Array<{
      id: string;
      set_number: string | null;
      condition: string | null;
      listing_value: number | null;
      item_name: string | null;
      ebay_listing_id: string | null;
    }> = [];

    try {
      // Fetch all LISTED items, then include set-numbered ones PLUS minifigs with
      // no real set number (NA/null) so collectable minifigs also reach Shopify.
      // Non-minifig NA/null items (loose parts, bundles) remain excluded.
      // NA/null-set minifigs are only included when they have an eBay listing, so
      // resolveImages can pull a real photo (avoids imageless products).
      const items = (await fetchAllRecords(this.supabase, 'inventory_items', {
        select: 'id, set_number, condition, listing_value, item_name, ebay_listing_id',
        eq: { user_id: this.userId, status: 'LISTED' },
        orderBy: { column: 'created_at', ascending: true },
      })) as unknown as Array<{
        id: string;
        set_number: string | null;
        condition: string | null;
        listing_value: number | null;
        item_name: string | null;
        ebay_listing_id: string | null;
      }>;

      for (const item of items) {
        if (existingIds.has(item.id)) continue;
        const sn = (item.set_number ?? '').trim();
        const hasRealSet = sn !== '' && sn.toUpperCase() !== 'NA';
        if (hasRealSet) {
          unsyncedItems.push(item);
        } else if (isMinifigure(item) && item.ebay_listing_id) {
          // NA/null-set minifig with an eBay listing -> has a photo source.
          unsyncedItems.push(item);
        }
      }
    } catch (error) {
      // Original pagination loop ignored fetch errors (treated as no data) — preserve that.
      console.error('[ShopifySync] Error fetching unsynced LISTED items:', error);
    }

    // Group by (set_number, condition, listing_value). Minifigs with no real set
    // number must NOT group together — key each individually so they become
    // separate Shopify products.
    const groups = new Map<string, typeof unsyncedItems>();
    for (const item of unsyncedItems) {
      const sn = (item.set_number ?? '').trim();
      const hasRealSet = sn !== '' && sn.toUpperCase() !== 'NA';
      const key = hasRealSet
        ? `${item.set_number}|${(item.condition ?? 'N').toUpperCase()}|${item.listing_value ?? 0}`
        : `MF-${item.id}`;
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
      const repSet = (rep.set_number ?? '').trim();
      const repHasRealSet = repSet !== '' && repSet.toUpperCase() !== 'NA';

      // Check if any sibling with the same (set, condition, value) is already
      // synced — but ONLY for real-set items. NA/null-set minifigs must never
      // merge (they are keyed individually as MF-<id>); a set_number='NA' sibling
      // lookup would wrongly merge distinct minifigs into one product.
      let existingProductId: string | undefined;
      if (repHasRealSet) {
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
        existingProductId = syncedSiblings?.[0]?.shopify_product_id;
      }

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

      if (!result.success && !result.skipped) {
        summary.items_failed += ids.length;
        summary.errors.push({
          item_id: ids[0],
          error: result.error || `Failed to sync group ${key}`,
        });
      }
      // result.skipped (e.g. no price yet) is an intentional hold, not a failure —
      // the item stays unsynced and will be picked up once it has a listing_value.
    }

    // Propagate listing_value changes (markdowns, corrections) to existing active
    // products. Without this the create flow is one-shot and Shopify prices freeze
    // at creation while the markdown engine keeps moving the underlying price.
    try {
      const repriced = await this.reconcilePrices();
      summary.items_updated += repriced.updated;
      summary.items_failed += repriced.failed;
      for (const e of repriced.errors) summary.errors.push(e);
    } catch (err) {
      summary.errors.push({
        item_id: 'reconcilePrices',
        error: err instanceof Error ? err.message : String(err),
      });
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
  'sw',
  'col',
  'coltlbm',
  'coltlnm',
  'colhp',
  'colmar',
  'coldis',
  'colsh',
  'coltgb',
  'fig',
  'gen',
  'hp',
  'iaj',
  'jw',
  'loc',
  'lor',
  'njo',
  'poc',
  'pot',
  'sh',
  'scd',
  'tnt',
  'tlm',
  'sim',
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
  const setIndicators = [
    ' set',
    'building toy',
    'playset',
    'building game',
    'building kit',
    'starter pack',
    'bundle',
    'display',
    'diorama',
    'modular',
  ];
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
  const isUsed = item.condition?.toLowerCase() === 'used' || item.condition?.toLowerCase() === 'u';
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
  const setNum = setNumber && setNumber !== 'NA' ? setNumber.replace(/-1$/, '') : null;

  return images.map((img, i) => {
    const suffix = IMAGE_ALT_SUFFIXES[i] ?? `view ${i + 1}`;
    const alt = setNum ? `${productTitle} - ${suffix}` : `${productTitle} - ${suffix}`;
    return { ...img, alt };
  });
}
