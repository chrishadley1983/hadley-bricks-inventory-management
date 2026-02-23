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
    images?: Array<{ src: string }>;
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

/** Image resolution result */
export interface ImageResolutionResult {
  urls: string[];
  source: 'ebay' | 'brickset' | 'brave' | 'manual' | 'none';
}

/** Sync operation result */
export interface SyncResult {
  success: boolean;
  shopifyProductId?: string;
  error?: string;
}

/** Batch sync summary */
export interface BatchSyncSummary {
  items_processed: number;
  items_created: number;
  items_updated: number;
  items_archived: number;
  items_failed: number;
  errors: Array<{ item_id: string; error: string }>;
  duration_ms: number;
}
