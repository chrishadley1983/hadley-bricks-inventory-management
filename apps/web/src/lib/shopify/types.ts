/** Shopify sync configuration stored in shopify_config table */
export interface ShopifyConfig {
  id: string;
  user_id: string;
  shop_domain: string;
  client_id: string;
  client_secret: string;
  api_version: string;
  location_id: string | null;
  sync_enabled: boolean;
  auto_sync_new_listings: boolean | null;
  default_discount_pct: number | null;
  /** Cursor for the incremental order poll — orders updated after this are fetched. */
  last_order_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Shopify product mapping stored in shopify_products table */
export interface ShopifyProduct {
  id: string;
  user_id: string;
  inventory_item_id: string;
  shopify_product_id: string;
  shopify_variant_id: string | null;
  shopify_inventory_item_id: string | null;
  shopify_handle: string | null;
  shopify_status: string;
  shopify_price: number | null;
  shopify_compare_at_price: number | null;
  shopify_title: string | null;
  shopify_description: string | null;
  image_source: string | null;
  image_urls: string[] | null;
  last_synced_at: string | null;
  sync_status: string;
  sync_error: string | null;
  created_at: string;
  updated_at: string;
}

/** Shopify sync queue job */
export interface ShopifySyncJob {
  id: string;
  user_id: string;
  inventory_item_id: string | null;
  action: 'create' | 'update_price' | 'update_stock' | 'archive' | 'delete';
  priority: number;
  payload: Record<string, unknown> | null;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  attempts: number;
  max_attempts: number;
  error_message: string | null;
  scheduled_for: string;
  processed_at: string | null;
  created_at: string;
}

/** Shopify API product payload */
export interface ShopifyProductPayload {
  product: {
    title: string;
    body_html: string;
    vendor: string;
    product_type: string;
    tags: string;
    handle?: string;
    status: 'active' | 'draft' | 'archived';
    variants: Array<{
      price: string;
      compare_at_price?: string;
      sku: string;
      inventory_management: 'shopify';
      requires_shipping: boolean;
      weight?: number;
      weight_unit?: string;
    }>;
    images?: Array<{ src?: string; attachment?: string; filename?: string; alt?: string }>;
    metafields?: Array<{
      namespace: string;
      key: string;
      value: string;
      type: string;
    }>;
  };
}

/** Shopify API product response */
export interface ShopifyProductResponse {
  product: {
    id: number;
    title: string;
    handle: string;
    status: string;
    variants: Array<{
      id: number;
      price: string;
      compare_at_price: string | null;
      sku: string;
      inventory_item_id: number;
    }>;
    images: Array<{
      id: number;
      src: string;
    }>;
  };
}

/** Price calculation result */
export interface PriceResult {
  price: number;
  compare_at_price: number | null;
}

/** A single resolved image — either a URL or base64 data */
export interface ResolvedImage {
  src?: string;
  attachment?: string;
  filename?: string;
}

/** Image resolution result */
export interface ImageResolutionResult {
  urls: string[];
  images: ResolvedImage[];
  source: 'ebay' | 'brickset' | 'bricklink' | 'brave' | 'manual' | 'none';
}

/** eBay listing data fetched from Browse API */
export interface EbayListingData {
  images: string[];
  description: string | null;
  title: string | null;
}

/** Sync operation result */
export interface SyncResult {
  success: boolean;
  shopifyProductId?: string;
  error?: string;
}

/** A line item on a Shopify order (Admin REST API shape, fields we use). */
export interface ShopifyOrderLineItem {
  id: number;
  variant_id: number | null;
  product_id: number | null;
  sku: string | null;
  title: string;
  quantity: number;
  price: string;
  /** Per-line discount allocations (amount is the total for the line). */
  discount_allocations?: Array<{ amount: string }>;
}

/** A Shopify order (Admin REST API shape, fields we use). */
export interface ShopifyOrder {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
  financial_status: string | null;
  fulfillment_status: string | null;
  currency: string | null;
  total_price: string | null;
  subtotal_price: string | null;
  total_tax: string | null;
  total_shipping_price_set?: { shop_money?: { amount?: string } };
  total_discounts?: string | null;
  email: string | null;
  customer?: { first_name?: string | null; last_name?: string | null } | null;
  line_items: ShopifyOrderLineItem[];
  /** Refunds; refund_line_items tell us which units were returned. */
  refunds?: Array<{
    refund_line_items?: Array<{ line_item_id: number; quantity: number }>;
  }>;
}

/** Result of resolving + marking one Shopify line item as sold. */
export interface ShopifyLineSaleResult {
  sku: string | null;
  matched: number;
  marked_sold: number;
  ebay_delisted: number;
  shopify_archived: number;
  notes: string[];
}

/** Summary of a Shopify order-ingestion run. */
export interface ShopifyOrderSyncResult {
  success: boolean;
  syncType: 'FULL' | 'INCREMENTAL';
  ordersFetched: number;
  ordersIngested: number;
  lineItemsProcessed: number;
  itemsMarkedSold: number;
  ebayListingsEnded: number;
  shopifyProductsArchived: number;
  unmatchedLineItems: number;
  /** Lines where fewer LISTED units existed than were ordered (oversell). */
  oversoldLineItems: number;
  errors: Array<{ context: string; error: string }>;
  lastCursor: string | null;
  startedAt: string;
  completedAt: string;
}

/** Quantity-reconciliation summary. */
export interface ReconcileSummary {
  products_scanned: number;
  variants_scanned: number;
  overstated_found: number;
  reduced: number;
  failed: number;
  reductions: Array<{ sku: string | null; from: number; to: number; mapped: boolean }>;
  errors: Array<{ sku: string | null; error: string }>;
}

/** Batch sync summary */
export interface BatchSyncSummary {
  items_processed: number;
  items_created: number;
  items_added_to_group: number;
  items_updated: number;
  items_archived: number;
  /** Archived products re-activated because their item is LISTED again. */
  items_reactivated?: number;
  items_failed: number;
  errors: Array<{ item_id: string; error: string }>;
  duration_ms: number;
}
