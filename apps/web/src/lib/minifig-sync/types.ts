import type { Database } from '@hadley-bricks/database';

// Database row types
export type MinifigSyncItem = Database['public']['Tables']['minifig_sync_items']['Row'];
export type MinifigSyncItemInsert = Database['public']['Tables']['minifig_sync_items']['Insert'];
export type MinifigSyncItemUpdate = Database['public']['Tables']['minifig_sync_items']['Update'];

export type MinifigPriceCache = Database['public']['Tables']['minifig_price_cache']['Row'];
export type MinifigPriceCacheInsert = Database['public']['Tables']['minifig_price_cache']['Insert'];
export type MinifigPriceCacheUpdate = Database['public']['Tables']['minifig_price_cache']['Update'];

export type MinifigRemovalQueue = Database['public']['Tables']['minifig_removal_queue']['Row'];
export type MinifigRemovalQueueInsert =
  Database['public']['Tables']['minifig_removal_queue']['Insert'];
export type MinifigRemovalQueueUpdate =
  Database['public']['Tables']['minifig_removal_queue']['Update'];

export type MinifigSyncJob = Database['public']['Tables']['minifig_sync_jobs']['Row'];
export type MinifigSyncJobInsert = Database['public']['Tables']['minifig_sync_jobs']['Insert'];
export type MinifigSyncJobUpdate = Database['public']['Tables']['minifig_sync_jobs']['Update'];

export type MinifigSyncConfigRow = Database['public']['Tables']['minifig_sync_config']['Row'];

// Listing status enum
export type ListingStatus =
  | 'NOT_LISTED'
  | 'STAGED'
  | 'PUBLISHING'
  | 'REVIEWING'
  | 'PUBLISHED'
  | 'SOLD_EBAY_PENDING_REMOVAL'
  | 'SOLD_EBAY'
  | 'SOLD_BRICQER_PENDING_REMOVAL'
  | 'SOLD_BRICQER'
  | 'ENDED';

// Removal queue status
export type RemovalStatus = 'PENDING' | 'APPROVED' | 'EXECUTED' | 'FAILED' | 'DISMISSED';

// Job types
export type MinifigJobType =
  | 'INVENTORY_PULL'
  | 'MARKET_RESEARCH'
  | 'EBAY_ORDER_POLL'
  | 'BRICQER_ORDER_POLL'
  | 'LISTING_CREATION'
  | 'RESEARCH_REFRESH'
  | 'REPRICING';

// Job status
export type JobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

// Parsed config shape
export interface MinifigSyncConfig {
  min_bricqer_listing_price: number;
  min_sold_count: number;
  min_sell_through_rate: number;
  min_avg_sold_price: number;
  min_estimated_profit: number;
  packaging_cost: number;
  ebay_fvf_rate: number;
  price_cache_months: number;
  reprice_after_days: number;
  poll_interval_minutes: number;
}

// Image types
export interface SourcedImage {
  url: string;
  source: 'google' | 'rebrickable' | 'bricklink' | 'bricqer' | 'uploaded';
  type: 'sourced' | 'stock' | 'original';
}

// Terapeak research result
export interface TerapeakResult {
  avgSoldPrice: number;
  minSoldPrice: number;
  maxSoldPrice: number;
  soldCount: number;
  activeCount: number;
  sellThroughRate: number;
  avgShipping: number;
  source: 'terapeak';
}

// BrickLink research result
export interface BrickLinkResearchResult {
  avgSoldPrice: number;
  minSoldPrice: number;
  maxSoldPrice: number;
  soldCount: number;
  source: 'bricklink';
}

// Combined research result
export type ResearchResult = TerapeakResult | BrickLinkResearchResult;

// Pricing calculation inputs
export interface PricingInput {
  avgSoldPrice: number;
  maxSoldPrice: number;
  avgShipping: number;
  bricqerPrice: number;
}

// Best Offer thresholds
export interface BestOfferThresholds {
  autoAccept: number;
  autoDecline: number;
}

// Dashboard metrics
export interface MinifigDashboardMetrics {
  totalInBricqer: number;
  totalMeetingThreshold: number;
  countByStatus: Record<string, number>;
  totalRevenue: number;
  feeSavings: number;
  avgTimeToSell: number | null;
}

// SKU prefix constant
export const MINIFIG_SKU_PREFIX = 'HB-MF-';

// Default user ID for cron operations
export const DEFAULT_USER_ID = '4b6e94b4-661c-4462-9d14-b21df7d51e5b';

// Build SKU from Bricqer item ID
export function buildSku(bricqerItemId: string | number): string {
  return `${MINIFIG_SKU_PREFIX}${bricqerItemId}`;
}

// Extract Bricqer item ID from SKU
export function parseSku(sku: string): string | null {
  if (!sku.startsWith(MINIFIG_SKU_PREFIX)) return null;
  return sku.slice(MINIFIG_SKU_PREFIX.length);
}

// Check if SKU is a minifig sync SKU
export function isMinifigSku(sku: string): boolean {
  return sku.startsWith(MINIFIG_SKU_PREFIX);
}
